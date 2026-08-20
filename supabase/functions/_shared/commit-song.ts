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
  /**
   * Non-null means a write was refused by a DECISION, not by bad luck, and
   * the row is parked until a human clears it. Written by
   * `scripts/lib/process_pending.py:hold_reason` for either kind:
   * the phase-3b dedup backstop (its original meaning), or a target work
   * that is suppressed / soft-deleted / merged away. The column keeps its
   * dedup-era name because the reconciler, the RLS policies and the
   * Bluegrass Dungeon's Release-hold/Reject actions all already key on it;
   * {@link holdReason} is the general question it now answers.
   */
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
  /**
   * 'placeholder' on a song REQUEST — a work that is wanted and has no chart
   * yet. `process_pending` copies it straight into work.yaml's `status`,
   * which is what `utils.isPlaceholder` and the bounty board read. The other
   * legal value is 'complete'; a CHECK on pending_songs enforces both.
   */
  status?: string | null
  /** Free text from the submitter. On a request, why they want the song. */
  notes?: string | null
}

/**
 * Is this row a song REQUEST — a placeholder, with no chart behind it yet?
 *
 * THE one definition, because three parties have to agree: the reconciler
 * (which must not file a contentless request as broken), `classifyChange`
 * (which puts it in the placeholder column), and `process_pending.py`'s
 * `is_placeholder_row` on the other side of the dispatch.
 *
 * Two conditions, and the second is load-bearing rather than belt-and-braces.
 * `status` is a STICKY column: a chart save upserts on the same id (a chart
 * row's id is its work slug, and so is a request's), so a row that was a
 * request and has since grown a real chart can still be carrying
 * `status: 'placeholder'`. Content is what settles it — once there is a chart
 * this is a chart row, whatever the status column still says. Asking `status`
 * alone would drop that submitter's ChordPro on the floor and mint an empty
 * work over the top of their song, which is the exact failure this whole
 * column was rewritten to stop.
 */
export function isPlaceholderRow(entry: PendingSong): boolean {
  if ((entry.part_type || 'lead-sheet') !== 'lead-sheet') return false
  if (entry.status !== 'placeholder') return false
  return !(entry.content || '').trim()
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
/**
 * Why this row is parked awaiting a human, or null if it may be retried.
 *
 * The sibling of {@link unretryableReason}, and the reason there are two:
 * that one judges the row's own SHAPE (a field the row will never grow),
 * which the edge runtime can see for itself. This one reports a verdict
 * reached where the repo is — `process_pending.py` refusing to write to a
 * suppressed or merged-away work, or the dedup backstop holding a create —
 * and handed back through `dedup_hold`. Neither can be fixed by waiting, so
 * neither is worth a GitHub call every hour; the difference is only who
 * worked it out.
 *
 * Blank strings count as not-held: a held row's reason is what the admin
 * queue shows, and an empty box there is worse than no hold at all.
 */
export function holdReason(entry: PendingSong): string | null {
  const held = entry.dedup_hold?.trim()
  return held ? held : null
}

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

  // A song REQUEST is the other contentless shape, and for the same reason a
  // metadata row is: a placeholder is a work with metadata and `parts: []`,
  // so there is no chart to carry. Demanding content would have made every
  // request permanently "unretryable" — filed for manual rescue an hour after
  // it was made, with an alert issue opened about a well-formed row. (That is
  // not hypothetical: before this column existed, every untrusted user's
  // request sat here as `missing content` forever.)
  if (isPlaceholderRow(entry)) return null

  if (!entry.content) return 'missing content'
  return null
}
