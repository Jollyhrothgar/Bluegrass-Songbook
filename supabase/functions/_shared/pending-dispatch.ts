// Phase 2b: classify a pending_songs row, then hand the WRITE to git.
//
// Before this module, auto-commit-song authored work.yaml in TypeScript and
// PUT it straight to the Contents API. That made it the fifth writer of
// works/ -- with its own YAML quoting bugs, no suppression check, and a
// silent overwrite of whatever work already lived at that id. Phase 1c gave
// the repo ONE writer (scripts/lib/works_writer.py); this module is how an
// edge function reaches it: classify the change, fire a repository_dispatch,
// and let .github/workflows/process-pending.yml run the Python.
//
// The edge function therefore decides *what kind of change this is* and
// nothing else. It never decides what the YAML looks like.
//
// Imported by:
//   auto-commit-song   the live, user-triggered path
//   reconcile-pending  the hourly retry pass
// Supabase bundles relative imports, so BOTH must be redeployed when this
// file changes.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { GITHUB_REPO, getFileContent } from "./commit-song.ts"

/** repository_dispatch event consumed by .github/workflows/process-pending.yml */
export const DISPATCH_EVENT = 'pending-commit'

/**
 * What the writer is being asked to do with this row.
 *
 * ``add`` is the tablature answer to the question ``fork`` answers for a
 * chart: an edit of content the caller does not own must not overwrite it,
 * so it lands beside it. A chart forks (one work, several *arrangements* of
 * the same chart, ``x_version_*`` metadata, the Arrangement pill picks); a
 * tab simply becomes another sibling part on the same instrument, which is
 * a shape the corpus has carried for years (foggy-mountain-breakdown has
 * eight banjo takes) and which PR #240 already made the tab flow's answer
 * to a same-instrument collision. Same rule, different noun.
 */
export type ChangeMode = 'create' | 'update' | 'fork' | 'add'

export interface Classification {
  mode: ChangeMode
  /** The work in works/ this row targets. */
  workId: string
  /** Why, in one phrase — echoed to the client and into the commit log. */
  reason: string
}

/**
 * Durable per-user rate limit.
 *
 * identity.ts's `rateLimited` is a per-isolate in-memory bucket: it resets on
 * every cold start, which was tolerable when only trusted users could reach
 * the write path. With the gate open to any logged-in user the limit has to
 * survive isolate churn, so it is counted from submission_log — the table
 * these functions already write on every submission.
 */
export const RATE_LIMIT_PER_HOUR = 20

export async function submissionsInLastHour(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error } = await admin
    .from('submission_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)

  if (error) {
    // Fail open on a counting error rather than locking everyone out of
    // contributing because one SELECT hiccuped; the size caps and RLS are
    // still in force.
    console.warn('Rate-limit count failed; allowing the write:', error.message)
    return 0
  }
  return count ?? 0
}

/**
 * Every block-sequence entry in a work.yaml, as raw text, with the leading
 * `- ` flattened so every key inside a block reads as a plain `key:` line.
 *
 * Still not a YAML parse — the question asked of this file is only "has this
 * caller contributed a part of this kind?", and the authoritative write is
 * done by works_writer in Python a minute later. A parser in the edge
 * function would be a second opinion about work.yaml, which is exactly what
 * phase 1c removed. But it can no longer be a regex over the FLAT file
 * either: ownership is a per-part question (see {@link submittersOf}), and a
 * flat scan cannot see where one part ends and the next begins.
 *
 * `tags:` and `composers:` are block sequences too, but their entries are
 * bare scalars with no `type:` or `file:` line, so they never match anything
 * a caller here looks for.
 */
export function partBlocks(workYaml: string): string[] {
  const blocks: string[] = []
  let current: string[] | null = null
  for (const line of workYaml.split('\n')) {
    // `-\s` alone was wrong, and unsafely so. A bare `-` with the entry's
    // keys on the FOLLOWING lines is valid YAML and did not open a new
    // block, so two parts merged into one — and because blockValue takes
    // the first match of each key, the merged block answered with part A's
    // `type:` and part B's `submitted_by:`. An imported chart followed by
    // the caller's own tab therefore read as "the caller owns a lead
    // sheet", handing them an in-place edit of somebody else's chart: the
    // very escalation the type scoping below exists to close, reached
    // through whitespace instead. `works/` is the hand-editable store, so
    // "nothing we emit writes it that way" is not a defence.
    if (/^\s*-(\s|$)/.test(line)) {
      if (current) blocks.push(current.join('\n'))
      current = [line.replace(/^(\s*)-(\s|$)/, '$1  ')]
    } else if (current) {
      current.push(line)
    }
  }
  if (current) blocks.push(current.join('\n'))
  return blocks
}

/** Value of a scalar key inside one part block, or null. */
function blockValue(block: string, key: string): string | null {
  const m = block.match(
    new RegExp(`^\\s*${key}:\\s*['"]?([^'"\\n]+?)['"]?\\s*$`, 'm'))
  return m ? m[1] : null
}

/**
 * Every `submitted_by` value on a work's parts OF ONE TYPE.
 *
 * The type scoping is load-bearing, not tidiness. This used to scan the flat
 * file, which was safe only by accident: `submitted_by` was written on
 * lead-sheet parts alone, because the old PR-based tab flow recorded
 * `author` instead. Now that tabs come through pending_songs they carry
 * `submitted_by` too — and an unscoped scan would read "Alice submitted a
 * banjo tab to this work" as "Alice owns content here", classify her edit of
 * somebody else's CHART as `update`, and hand her an in-place overwrite of
 * the primary chart and the work's title/artist/key. Contributing a tab
 * would have bought edit rights over a stranger's lyrics.
 *
 * So: chart ownership is answered by chart parts, tab ownership by tab
 * parts. `process_pending.owns_content` is the same question asked on the
 * other side of the dispatch, and is scoped the same way.
 */
export function submittersOf(workYaml: string, partType: string): string[] {
  const out: string[] = []
  for (const block of partBlocks(workYaml)) {
    if (blockValue(block, 'type') !== partType) continue
    const submitter = blockValue(block, 'submitted_by')
    if (submitter) out.push(submitter)
  }
  return out
}

/**
 * Who owns the tablature part stored as `file`, or null if no part names it.
 *
 * One part, not the work: a work holding somebody else's banjo take and your
 * mandolin take must not answer "you own the banjo one".
 *
 * Both identity fields count. `submitted_by` is the verified auth.uid() this
 * pipeline stamps; `author` is what the retired PR flow (and every Banjo
 * Hangout import) records — a display name, so a uuid will simply never
 * match one, which is the correct outcome for imported content.
 *
 * "no part names it" and "a part names it but you don't own it" are
 * different answers on purpose: the first means the client is talking about
 * a file that isn't published, the second means it is somebody's.
 */
export function tabPartOwners(workYaml: string, file: string): string[] | null {
  const needle = file.trim()
  for (const block of partBlocks(workYaml)) {
    if (blockValue(block, 'file') !== needle) continue
    if (blockValue(block, 'type') !== 'tablature') continue
    const owners: string[] = []
    for (const key of ['submitted_by', 'author']) {
      const value = blockValue(block, key)
      if (value) owners.push(value)
    }
    return owners
  }
  return null
}

/**
 * Work slug from a title. Same rule as `work_schema.slugify` in Python,
 * which is what actually mints the directory a moment later.
 */
export function slugify(text: string): string {
  return (text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

export interface ClassifyInput {
  /**
   * pending_songs row id.
   *
   * For a CHART this is the work slug the client wrote under. For a TAB it
   * is a synthetic `tab:<slug>:<rand>` — one row per song is the wrong
   * shape for a part, so tab rows live in their own id namespace (see
   * 20260818000000_pending_songs_tablature.sql) and this value is never a
   * work id.
   */
  rowId: string
  /** pending_songs.replaces_id — set when the submission edits a known work. */
  replacesId?: string | null
  /** Verified caller id (auth.uid()), never client-supplied. */
  userId: string
  /** Whether the caller is in trusted_users. */
  trusted: boolean
  githubToken: string
  /**
   * pending_songs.title. Only a tablature CREATE reads it: a tab row's id
   * is synthetic, so the slug for a work it mints has to come from the
   * title. (The authoritative answer is still works_writer's — see below.)
   */
  title?: string | null
  /** pending_songs.part_type — 'lead-sheet' (default) or 'tablature'. */
  partType?: string | null
  /**
   * pending_songs.part_file — for a tab CORRECTION, the works/ filename it
   * targets. Null/absent means "a new tab", which can never be an update.
   */
  partFile?: string | null
}

/**
 * Decide create / update / fork / add.
 *
 * Lead sheet (unchanged, except that "they own it" is now answered by the
 * work's CHART parts alone — see {@link submittersOf}):
 *
 *   no work at the target                    -> create
 *   caller submitted a chart of that work    -> update (they own it)
 *   caller is trusted                        -> update (in-place edit right)
 *   otherwise                                -> fork to a new arrangement
 *
 * Tablature:
 *
 *   no work at the target                    -> create (the tab mints the work)
 *   part_file names a tab they own, or they
 *   are trusted                              -> update (rewrite that file)
 *   otherwise                                -> add (a NEW sibling part)
 *
 * The tab rules are the chart rules with the fallback changed, and the
 * fallback is the whole point: a "correction" from someone who does not own
 * the tab becomes a sibling arrangement rather than a rewrite. Nothing
 * published is overwritten by a non-owner in either column.
 *
 * A tab with no `part_file` is a submission, not a correction, so it skips
 * the ownership question entirely — there is no file to own yet.
 *
 * WHICH work a tab targets is not the row id. A chart row is keyed by its
 * work slug; a tab row is keyed by a synthetic `tab:<slug>:<rand>` so two
 * people can tab the same song without colliding on the primary key. So a
 * tab targets `replaces_id`, or — when it is minting a new work —
 * `slugify(title)`. The slug returned here is ADVISORY: `create_work`
 * resolves the real one on a checkout of main, suffixing past anything
 * taken, suppressed or redirected. The retired create-tab-pr probed the
 * Contents API for a free slug instead, which two concurrent branches could
 * not see each other doing.
 *
 * The client may believe whatever it likes; this is the answer that reaches
 * the writer.
 */
export async function classifyChange(input: ClassifyInput): Promise<Classification> {
  const isTab = input.partType === 'tablature'
  const fallbackId = isTab ? slugify(input.title || '') : input.rowId
  const workId = input.replacesId || fallbackId
  if (!workId) {
    throw new Error('cannot classify: no target work id (a tab needs a title)')
  }
  const yaml = await getFileContent(`works/${workId}/work.yaml`, input.githubToken)

  if (yaml === null) {
    return { mode: 'create', workId: fallbackId, reason: 'no existing work at this id' }
  }

  if (isTab) {
    const file = (input.partFile || '').trim()
    if (!file) {
      return { mode: 'add', workId, reason: 'new tab for an existing work' }
    }
    const owners = tabPartOwners(yaml, file)
    if (owners === null) {
      return {
        mode: 'add', workId,
        reason: `no published tablature part named '${file}' — landing as a new one`,
      }
    }
    if (owners.includes(input.userId)) {
      return { mode: 'update', workId, reason: 'caller submitted this tab' }
    }
    if (input.trusted) {
      return { mode: 'update', workId, reason: 'trusted user in-place edit' }
    }
    return {
      mode: 'add', workId,
      reason: "correction to another contributor's tab — landing as a sibling arrangement",
    }
  }

  if (submittersOf(yaml, 'lead-sheet').includes(input.userId)) {
    return { mode: 'update', workId, reason: 'caller submitted this content' }
  }
  if (input.trusted) {
    return { mode: 'update', workId, reason: 'trusted user in-place edit' }
  }
  return { mode: 'fork', workId, reason: "edit of another contributor's content" }
}

export interface DispatchPayload {
  row_id: string
  mode: ChangeMode
  work_id: string
  /** Verified user id — becomes provenance.submitted_by in works/. */
  actor_id: string
  /** Display name for x_arrangement_by / the commit trailer. */
  actor: string
}

/**
 * Fire the repository_dispatch that runs the real writer.
 *
 * Throws on anything but 204 so the caller can surface "live but not yet
 * synced" instead of pretending the song is durable.
 */
export async function dispatchPendingCommit(
  payload: DispatchPayload,
  githubToken: string,
): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Bluegrass-Songbook-Bot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: DISPATCH_EVENT, client_payload: payload }),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('repository_dispatch failed:', response.status, detail)
    throw new Error(`repository_dispatch failed: ${response.status}`)
  }
}
