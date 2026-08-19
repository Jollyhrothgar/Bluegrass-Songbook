// Unit tests for the shared GitHub read + the reconciler's triage predicate.
//
// `getFileContent` is small and load-bearing: it is the ONLY thing that tells
// classifyChange whether a work already exists. If a transient GitHub failure
// were ever read as "the file isn't there", every subsequent classification
// would say `create` and the writer would mint a placeholder over live works.
// That distinction is what most of this file guards.
//
// Offline: `globalThis.fetch` is replaced for the duration of each test.
//
// Run: deno task test        (from the repo root)

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts"

import {
  GITHUB_REPO,
  getFileContent,
  type PendingSong,
  unretryableReason,
} from "./commit-song.ts"

/** Base64 of a string's UTF-8 bytes — what the GitHub Contents API sends. */
function b64(text: string): string {
  let binary = ""
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

interface Call {
  url: string
  headers: Record<string, string>
}

async function withFetch(
  respond: (url: string) => Response,
  fn: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const calls: Call[] = []
  const real = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    })
    return Promise.resolve(respond(url))
  }) as typeof fetch
  try {
    await fn(calls)
  } finally {
    globalThis.fetch = real
  }
}

// ============================================
// getFileContent
// ============================================

Deno.test("getFileContent: decodes the Contents API's base64 payload", async () => {
  const yaml = "id: salt-creek\ntitle: Salt Creek\n"
  await withFetch(
    () => new Response(JSON.stringify({ content: b64(yaml) }), { status: 200 }),
    async () => {
      assertEquals(
        await getFileContent("works/salt-creek/work.yaml", "tok"),
        yaml,
      )
    },
  )
})

Deno.test("getFileContent: asks the right repo, with the token and a User-Agent", async () => {
  await withFetch(
    () => new Response(JSON.stringify({ content: b64("id: x\n") }), { status: 200 }),
    async (calls) => {
      await getFileContent("works/x/work.yaml", "s3cret")
      assertEquals(calls.length, 1)
      assertEquals(
        calls[0].url,
        `https://api.github.com/repos/${GITHUB_REPO}/contents/works/x/work.yaml`,
      )
      assertEquals(calls[0].headers["authorization"], "token s3cret")
      // GitHub rejects requests without one.
      assertStringIncludes(calls[0].headers["user-agent"], "Bluegrass")
    },
  )
})

Deno.test("getFileContent: 404 is the ONLY null", async () => {
  await withFetch(
    () => new Response("Not Found", { status: 404 }),
    async () => {
      assertEquals(await getFileContent("works/nope/work.yaml", "tok"), null)
    },
  )
})

Deno.test("getFileContent: every other failure throws, carrying the status", async () => {
  // A 500 read as "no work here" would let a placeholder overwrite a real
  // work.yaml — the whole reason this function does not just `catch`.
  for (const status of [401, 403, 409, 422, 500, 502, 503]) {
    await withFetch(
      () => new Response("boom", { status }),
      async () => {
        await assertRejects(
          () => getFileContent("works/x/work.yaml", "tok"),
          Error,
          String(status),
        )
      },
    )
  }
})

Deno.test("getFileContent: a non-ASCII work.yaml survives well enough to classify", async () => {
  // KNOWN, DELIBERATELY UNFIXED HERE: `atob` yields one char per BYTE, so a
  // UTF-8 title comes back as mojibake ("Éirinn" -> "Ãirinn"). It does not
  // affect the questions asked of this text — uuids, part types and filenames
  // are ASCII, and a UTF-8 continuation byte is never a newline or a colon, so
  // the line structure partBlocks walks is intact. Pinned so that if the
  // decode is ever fixed to TextDecoder, this test says so out loud rather
  // than the change looking like a no-op.
  const yaml = "id: eirinn-go-brach\ntitle: Éirinn go Brách\n"
  await withFetch(
    () => new Response(JSON.stringify({ content: b64(yaml) }), { status: 200 }),
    async () => {
      const got = await getFileContent("works/eirinn-go-brach/work.yaml", "tok")
      // Structure intact: same lines, ASCII keys readable.
      assertEquals(got!.split("\n").length, yaml.split("\n").length)
      assertStringIncludes(got!, "id: eirinn-go-brach")
      // ...but the text is one char per UTF-8 byte, not the original string.
      const latin1 = Array.from(new TextEncoder().encode(yaml), (b) =>
        String.fromCharCode(b)).join("")
      assertEquals(got, latin1)
      assertEquals(got === yaml, false, "if this flips, atob was replaced — good")
    },
  )
})

// ============================================
// unretryableReason
// ============================================

const row = (over: Partial<PendingSong> = {}): PendingSong => ({
  id: "salt-creek",
  title: "Salt Creek",
  content: "{title: Salt Creek}\n[G]…\n",
  ...over,
})

Deno.test("unretryableReason: a complete row is retryable (null)", () => {
  assertEquals(unretryableReason(row()), null)
})

Deno.test("unretryableReason: names the missing field", () => {
  assertEquals(unretryableReason(row({ id: "" })), "missing id")
  assertEquals(unretryableReason(row({ title: "" })), "missing title")
  assertEquals(unretryableReason(row({ content: "" })), "missing content")
  assertEquals(unretryableReason(row({ content: null })), "missing content")
})

Deno.test("unretryableReason: id is checked before title", () => {
  // The reconciler prints one reason; make sure it is a stable one.
  assertEquals(unretryableReason(row({ id: "", title: "" })), "missing id")
})

Deno.test("unretryableReason: a tablature row is judged by the same three fields", () => {
  // An OTF row carries part_type/instrument/part_file, none of which make a
  // row unretryable here — the structural OTF check lives in process_pending.
  const tab = row({
    id: "tab:salt-creek:9f3c",
    part_type: "tablature",
    instrument: "banjo",
    part_file: null,
    content: '{"tracks":[]}',
  })
  assertEquals(unretryableReason(tab), null)
  assertEquals(unretryableReason({ ...tab, content: null }), "missing content")
})

Deno.test("unretryableReason: a metadata row is retryable WITHOUT content", () => {
  // The trap this pins: a metadata row carries no content by construction (a
  // CHECK on pending_songs refuses one, because the row edits work.yaml and
  // writes no part). Asking for content anyway would have made every metadata
  // row permanently unretryable — filed for manual rescue an hour after it
  // was written, with an alert issue opened about a perfectly well-formed row.
  const meta = row({
    id: "meta:salt-creek:9f3c2a",
    part_type: "metadata",
    replaces_id: "salt-creek",
    content: null,
  })
  assertEquals(unretryableReason(meta), null)
  assertEquals(unretryableReason({ ...meta, content: "" }), null)
})

Deno.test("unretryableReason: a metadata row must still name its target work", () => {
  // It is what content is to the other columns: without it there is nothing
  // to do, and no amount of waiting supplies one — a metadata edit can never
  // mint a work, and its `meta:<slug>:<rand>` id is not a work slug.
  const meta = row({
    id: "meta:salt-creek:9f3c2a",
    part_type: "metadata",
    content: null,
  })
  assertEquals(unretryableReason(meta), "metadata row names no target work")
  assertEquals(
    unretryableReason({ ...meta, replaces_id: null }),
    "metadata row names no target work",
  )
  assertEquals(unretryableReason({ ...meta, title: "" }), "missing title")
})
