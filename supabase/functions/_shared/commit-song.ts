// Shared GitHub helpers for the edge functions.
//
// SCOPE NOTE (phase 2b): this module no longer authors work.yaml for song
// submissions. `buildWorkYaml` / `commitPendingSong` are gone — a pending row
// now becomes files in works/ via repository_dispatch ->
// .github/workflows/process-pending.yml -> scripts/lib/works_writer.py, the
// repo's ONE writer. See ./pending-dispatch.ts.
//
// Phase 2d deleted the document-attachment path with the rest of the
// doc-upload feature. Nothing here writes to GitHub any more: what remains
// is the repo constant, one Contents-API read used by classification, and
// the row-triage predicate the reconciler uses.
//
// Imported by:
//   auto-commit-song   the live, user-triggered path
//   reconcile-pending  the hourly retry pass
//
// Deployment note: Supabase bundles relative imports, so BOTH functions must be
// redeployed after changing this file.

export const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

export interface PendingSong {
  id: string
  replaces_id?: string | null
  title: string
  artist?: string | null
  composer?: string | null
  content?: string | null
  key?: string | null
  mode?: string | null
  tags?: Record<string, unknown>
  created_at?: string
  github_committed?: boolean
  /** Phase 3b: non-null means the dedup backstop refused to write this row. */
  dedup_hold?: string | null
  /**
   * 'lead-sheet' (content is ChordPro), 'tablature' (content is a serialized
   * OTF JSON document), or 'metadata' (NO content — the row edits the work's
   * own title/artist/key/notes). Absent on every row written before
   * 2026-08-18; the column defaults to 'lead-sheet', so absent means chart.
   */
  part_type?: string | null
  /** Tablature only: which instrument. Required by a CHECK on those rows. */
  instrument?: string | null
  /** Tab corrections only: the works/ filename being corrected. */
  part_file?: string | null
}

const githubHeaders = (githubToken: string) => ({
  'Authorization': `token ${githubToken}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'Bluegrass-Songbook-Bot',
})

/**
 * Fetch and decode a text file from the repo. Returns null ONLY for a genuine
 * 404 -- any other error throws, so a transient GitHub failure can never be
 * mistaken for "the file isn't there" (which would let a caller overwrite a
 * real work.yaml with a placeholder).
 */
export async function getFileContent(path: string, githubToken: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`

  const response = await fetch(url, { headers: githubHeaders(githubToken) })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Failed to read ${path}: ${response.status}`)
  }

  const data = await response.json()
  return atob(data.content)
}

/**
 * Why a pending row cannot be committed at all, or null if it can.
 * Rows that fail this are not retryable: no amount of waiting supplies the
 * missing field, so the reconciler reports them for manual rescue instead of
 * hammering GitHub on every run.
 */
export function unretryableReason(entry: PendingSong): string | null {
  if (!entry.id) return 'missing id'
  if (!entry.title) return 'missing title'

  // A metadata row is the one shape with NOTHING in `content` — a CHECK on
  // pending_songs refuses it there. Asking for content anyway would have
  // made every metadata row permanently "unretryable", i.e. the reconciler
  // would file it for manual rescue an hour after it was written and open an
  // alert issue about a row that is perfectly well formed. What it must name
  // instead is its target work, since a metadata edit can never mint one.
  if ((entry.part_type || 'lead-sheet') === 'metadata') {
    if (!entry.replaces_id) return 'metadata row names no target work'
    return null
  }

  if (!entry.content) return 'missing content'
  return null
}
