// Change gate for pending_songs -> works/.
//
// Phase 2b of docs/plans/contribution-pipeline.md. This function used to be
// two things at once: a trusted-user permission check, and a writer that
// authored work.yaml in TypeScript and PUT it to the Contents API. Both are
// gone.
//
// It is now a gate and a dispatcher:
//
//   1. verify the caller owns the pending_songs row they are asking to commit
//   2. durable per-user rate limit (counted from submission_log)
//   3. classify the change — create / update / fork-to-arrangement / add /
//      metadata, or refuse it (the metadata column is the only one that can)
//   4. repository_dispatch to .github/workflows/process-pending.yml, which
//      runs scripts/lib/process_pending.py -> works_writer (THE writer)
//
// Trusted status no longer gates SPEED — any logged-in user's row reaches
// git this way. It only decides whether an edit of somebody else's content
// may land in place, or forks into a new arrangement instead.
//
// Phase 2d removed the document-attachment branch along with the whole
// doc-upload feature: binaries can't be diffed, forked or deduped, and the
// intake staged files that nothing downstream ever read.
//
// Tabs (2026-08-18) come through here too. They used to open a pull request
// (create-tab-pr + process-tab-pr.yml), which left the contract split down
// the middle: a chart was live in seconds, a tab waited for a human to merge.
// Nothing about an OTF justified that — it is text, it diffs, it validates —
// only the shape of pending_songs did, and that is fixed. A tablature row
// carries the serialized OTF in `content` plus part_type / instrument /
// part_file; the classification gains `add` (a sibling tab part) where a
// chart would fork. See docs/plans/contribution-pipeline.md, phase 4c.
//
// Metadata edits (2026-08-18) are the third column: part_type = 'metadata',
// no content at all, and the write touches only the work's own title /
// artist / key / notes. They exist because a work minted by a TAB had a
// title and nothing else, and no part anybody would want to rewrite in order
// to fix that. Own any part of the work — or be trusted — and you may edit
// its details; anyone else is refused, because unlike the other two columns
// there is nothing additive to land a stranger's edit in.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { type PendingSong } from "../_shared/commit-song.ts"
import { attributionFor, requireUser } from "../_shared/identity.ts"
import {
  classifyChange,
  dispatchPendingCommit,
  MetadataRefusedError,
  RATE_LIMIT_PER_HOUR,
  submissionsInLastHour,
} from "../_shared/pending-dispatch.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const githubToken = Deno.env.get('GITHUB_PAT')
    if (!githubToken) {
      throw new Error('GITHUB_PAT not configured')
    }

    // Identity comes from the verified session (phase 2a) — never the body.
    const { user, admin, response } = await requireUser(req, corsHeaders)
    if (response) return response
    const supabaseAdmin = admin!
    const caller = user!

    const entry: PendingSong = await req.json()

    const { data: trustedUser } = await supabaseAdmin
      .from('trusted_users')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle()
    const trusted = !!trustedUser

    if (!entry.id) {
      return json({ error: 'Missing required field: id' }, 400)
    }

    // --- 1. the row must exist, and must belong to the caller -------------
    // The body is a convenience echo of what the client just wrote; the row
    // in the table is the truth, and the workflow reads it from there.
    const { data: row, error: rowError } = await supabaseAdmin
      .from('pending_songs')
      // One string literal on purpose: supabase-js infers the row's type from
      // the literal, and a concatenated expression collapses it to an error
      // type that makes every row.* read a compile failure.
      .select('id, replaces_id, title, artist, content, created_by, github_committed, part_type, instrument, part_file')
      .eq('id', entry.id)
      .maybeSingle()

    if (rowError) {
      console.error('Failed to read pending_songs row:', rowError)
      throw new Error(`Could not read pending_songs row: ${rowError.message}`)
    }
    if (!row) {
      return json({ error: `No pending_songs row for '${entry.id}' — save it before asking for a commit` }, 404)
    }
    if (row.created_by !== caller.id) {
      return json({ error: 'That submission belongs to someone else' }, 403)
    }
    // --- 1b. what KIND of row is this? -------------------------------------
    // The column has a default and a CHECK, so a well-formed row is already
    // one of these three; the checks here exist so a client that guessed gets
    // a 400 it can show a person, instead of a CI failure it never sees.
    const partType = (row.part_type as string | null) || 'lead-sheet'
    if (partType !== 'lead-sheet' && partType !== 'tablature' && partType !== 'metadata') {
      return json({ error: `Unknown part_type '${partType}'` }, 400)
    }
    const isTab = partType === 'tablature'
    const isMetadata = partType === 'metadata'

    if (!row.title) {
      return json({ error: 'Missing required field: title' }, 400)
    }
    // A metadata row edits work.yaml and writes no part, so it carries no
    // content at all (a CHECK on pending_songs enforces that). Demanding it
    // here would reject the whole feature at the door.
    if (!isMetadata && !row.content) {
      return json({ error: 'Missing required field: content' }, 400)
    }
    if (isMetadata && !row.replaces_id) {
      return json({ error: 'A metadata edit has to say which work it edits' }, 400)
    }

    if (isTab) {
      if (!row.instrument) {
        return json({ error: 'A tablature row needs an instrument' }, 400)
      }
      // The real structural validation walks every measure and runs in CI
      // (process_pending.validate_otf). This is only the "is it even an OTF"
      // question, asked while the submitter is still looking at the screen —
      // a CI failure an hour later is not an error message.
      try {
        const parsed = JSON.parse(row.content as string)
        if (!Array.isArray(parsed?.tracks) || parsed.tracks.length === 0) {
          throw new Error('no tracks')
        }
      } catch (_e) {
        return json({ error: 'content is not a valid OTF JSON document' }, 400)
      }
    }

    // --- 2. durable rate limit -------------------------------------------
    const recent = await submissionsInLastHour(supabaseAdmin, caller.id)
    if (recent >= RATE_LIMIT_PER_HOUR) {
      return json({
        error: `Rate limit reached (${RATE_LIMIT_PER_HOUR} submissions per hour). Your song is saved and live — it will sync shortly.`,
      }, 429)
    }

    // --- 3. classify ------------------------------------------------------
    const classification = await classifyChange({
      rowId: row.id,
      replacesId: row.replaces_id,
      userId: caller.id,
      trusted,
      githubToken,
      title: row.title,
      partType,
      partFile: row.part_file,
    })

    // --- 4. dispatch ------------------------------------------------------
    await dispatchPendingCommit({
      row_id: row.id,
      mode: classification.mode,
      work_id: classification.workId,
      actor_id: caller.id,
      actor: attributionFor(caller),
    }, githubToken)

    // The action string is the contributor's whole public record: it is what
    // get_leaderboard() counts and what My Submissions labels.
    // Only `update` is a correction — an `add` mints a NEW sibling part, so
    // it is a submission even when the user set out to fix somebody's tab.
    //
    // `metadata_edit` is deliberately NOT one of the four scoring actions.
    // get_leaderboard() (20260816120000_leaderboard.sql) aggregates exactly
    // `song_submit, song_correction, tab_submit, tab_correction` and buckets
    // them into `songs` and `tabs`; a new string is counted by neither, which
    // is the whole point. Fixing a work's artist is worth doing and worth
    // logging — it is not a song and it is not a tab, and letting a typo fix
    // score the same as an arrangement would turn the board into a
    // click-count. It still lands in submission_log, so it still counts
    // against the durable rate limit and is still auditable.
    const action = isMetadata
      ? 'metadata_edit'
      : isTab
      ? (classification.mode === 'update' ? 'tab_correction' : 'tab_submit')
      : 'song_submit'

    await supabaseAdmin.from('submission_log').insert({
      user_id: caller.id,
      action,
      // A chart row's id IS its work slug; tab and metadata ids are synthetic
      // (`tab:`/`meta:` namespaces), so those log the work they landed on.
      target_id: (isTab || isMetadata) ? classification.workId : row.id,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
      metadata: {
        title: row.title,
        artist: row.artist,
        mode: classification.mode,
        ...(isTab ? { instrument: row.instrument, part_file: row.part_file } : {}),
      },
    })

    // github_committed is flipped by the workflow AFTER the push lands, not
    // here. Marking it now is what used to let cleanup-pending reap a row
    // whose commit had not actually happened.
    return json({
      success: true,
      mode: classification.mode,
      workId: classification.workId,
      reason: classification.reason,
      dispatched: true,
    })

  } catch (error) {
    // A refused metadata edit is a decision, not a failure: the caller has no
    // claim on this work (403), or named one that isn't there (404). Both
    // carry a message written for a person, so pass it through rather than
    // burying it in a 500 the client renders as "something went wrong".
    if (error instanceof MetadataRefusedError) {
      console.log(`Refused metadata edit of '${error.workId}': ${error.message}`)
      return json({ error: error.message }, error.status)
    }
    console.error('Error dispatching song commit:', error)
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message || 'Failed to commit song' }, 500)
  }
})
