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

/** What the writer is being asked to do with this row. */
export type ChangeMode = 'create' | 'update' | 'fork'

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
 * Every `submitted_by` value in a work.yaml.
 *
 * Deliberately a regex and not a YAML parse: the only question asked of the
 * file here is "has this caller contributed a part to this work?", and the
 * authoritative write is done by works_writer in Python a minute later. A
 * parser in the edge function would be a second opinion about work.yaml,
 * which is exactly what phase 1c removed.
 */
export function submittersOf(workYaml: string): string[] {
  const out: string[] = []
  const re = /^\s*submitted_by:\s*['"]?([^'"\n]+?)['"]?\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(workYaml)) !== null) out.push(m[1])
  return out
}

export interface ClassifyInput {
  /** pending_songs row id (the slug the client wrote under). */
  rowId: string
  /** pending_songs.replaces_id — set when the submission edits a known work. */
  replacesId?: string | null
  /** Verified caller id (auth.uid()), never client-supplied. */
  userId: string
  /** Whether the caller is in trusted_users. */
  trusted: boolean
  githubToken: string
}

/**
 * Decide create / update / fork.
 *
 *   no work at the target                    -> create
 *   caller submitted a part of that work     -> update (they own it)
 *   caller is trusted                        -> update (in-place edit right)
 *   otherwise                                -> fork to a new arrangement
 *
 * The client may believe whatever it likes; this is the answer that reaches
 * the writer.
 */
export async function classifyChange(input: ClassifyInput): Promise<Classification> {
  const workId = input.replacesId || input.rowId
  const yaml = await getFileContent(`works/${workId}/work.yaml`, input.githubToken)

  if (yaml === null) {
    return { mode: 'create', workId: input.rowId, reason: 'no existing work at this id' }
  }
  if (submittersOf(yaml).includes(input.userId)) {
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
