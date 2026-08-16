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
//   3. classify the change — create / update / fork-to-arrangement
//   4. repository_dispatch to .github/workflows/process-pending.yml, which
//      runs scripts/lib/process_pending.py -> works_writer (THE writer)
//
// Trusted status no longer gates SPEED — any logged-in user's row reaches
// git this way. It only decides whether an edit of somebody else's content
// may land in place, or forks into a new arrangement instead.
//
// The document-attachment branch is untouched; phase 2d removes the whole
// doc-upload feature, including that branch and commitAttachment.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { commitAttachment, type PendingSong } from "../_shared/commit-song.ts"
import { attributionFor, requireUser } from "../_shared/identity.ts"
import {
  classifyChange,
  dispatchPendingCommit,
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

    // --- attachment branch: behaviour unchanged, owned by phase 2d --------
    // Still trusted-only. Opening the TEXT path to everyone is the point of
    // 2b; binaries are not text — they can't be diffed, forked or deduped,
    // which is why 2d deletes this branch outright rather than widening it.
    if (entry.attachment && entry.id) {
      if (!trusted) {
        return json({ error: 'Document upload requires trusted user status' }, 403)
      }
      const { binaryPath } = await commitAttachment(entry, githubToken)

      await supabaseAdmin.from('submission_log').insert({
        user_id: caller.id,
        action: 'doc_upload',
        target_id: entry.id,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
        metadata: { title: entry.title, filename: entry.attachment.filename },
      })

      return json({ success: true, binaryPath })
    }

    if (!entry.id) {
      return json({ error: 'Missing required field: id' }, 400)
    }

    // --- 1. the row must exist, and must belong to the caller -------------
    // The body is a convenience echo of what the client just wrote; the row
    // in the table is the truth, and the workflow reads it from there.
    const { data: row, error: rowError } = await supabaseAdmin
      .from('pending_songs')
      .select('id, replaces_id, title, artist, content, created_by, github_committed')
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
    if (!row.title || !row.content) {
      return json({ error: 'Missing required fields: title and content are required' }, 400)
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
    })

    // --- 4. dispatch ------------------------------------------------------
    await dispatchPendingCommit({
      row_id: row.id,
      mode: classification.mode,
      work_id: classification.workId,
      actor_id: caller.id,
      actor: attributionFor(caller),
    }, githubToken)

    await supabaseAdmin.from('submission_log').insert({
      user_id: caller.id,
      action: 'song_submit',
      target_id: row.id,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
      metadata: { title: row.title, artist: row.artist, mode: classification.mode },
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
    console.error('Error dispatching song commit:', error)
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message || 'Failed to commit song' }, 500)
  }
})
