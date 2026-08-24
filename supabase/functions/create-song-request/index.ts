// Supabase Edge Function to create song requests.
//
// Two branches (Phase 2a — "request a song" is anonymous-capable):
//
//   Signed in  → placeholder: pending_songs row (visible instantly, owned by
//                the requester) + submission_log, then the SAME dispatch
//                every other contribution takes.
//   Anonymous  → a plain GitHub issue labelled `tune-request`. A placeholder
//                mints a corpus slug the requester "owns" and would later go
//                looking for, which the contract puts behind login; an
//                anonymous request is a report, so it stays report-shaped and
//                a confirmation toast is the complete experience.
//
// Identity, when present, is derived SERVER-SIDE from the verified session.
//
// WHAT THIS FUNCTION USED TO DO, and why it does not any more
// -----------------------------------------------------------
// The trusted-user branch hand-interpolated a `work.yaml` string ending
// `parts: []` and PUT it straight to the GitHub Contents API — passing the
// existing file's SHA when the path was already taken, i.e. OVERWRITING
// rather than refusing. The id was the client-generated slug. So a trusted
// user requesting a song whose slug collided with a real work replaced that
// work's parts, artist, composers and tags with an empty stub. No suppression
// check, no redirect check, no collision handling; the dedup warning in front
// of it was advisory.
//
// It also set `github_committed: !!trustedUser` — marking the row durable on
// the basis of TRUST, before the commit was even attempted, while the commit
// itself was wrapped in a try/catch and called "non-fatal". A failed commit
// left a row that said it had reached git, which cleanup-pending is then free
// to reap. That is the phase-0a failure the "flipped by the workflow AFTER
// the push lands, never by a function" rule exists to prevent.
//
// This function predates phase 1c/2b and was simply never converted. It is
// now: classify → write the pending row → repository_dispatch, which lands in
// `.github/workflows/process-pending.yml` → `scripts/lib/works_writer.py`,
// the repo's ONE writer, with the suppression, redirect and never-overwrite
// guards it enforces for everybody else.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GITHUB_REPO } from "../_shared/commit-song.ts"
import { attributionFor, callerIp, optionalUser, rateLimited } from "../_shared/identity.ts"
import {
  classifyChange,
  dispatchPendingCommit,
  DispatchRefusedError,
  RATE_LIMIT_PER_HOUR,
  submissionsInLastHour,
  WORK_SLUG_RE,
} from "../_shared/pending-dispatch.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PlaceholderRequest {
  id: string          // slug
  title: string
  artist?: string
  key?: string
  notes?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const githubToken = Deno.env.get('GITHUB_PAT')

    // Anonymous is allowed here; a valid session supplies identity.
    const { user, admin: supabaseAdmin } = await optionalUser(req)
    const ip = callerIp(req)

    const limitKey = user ? `song-request:user:${user.id}` : `song-request:ip:${ip}`
    if (rateLimited(limitKey, { max: user ? 20 : 5 })) {
      return new Response(
        JSON.stringify({ error: 'Too many requests — try again later' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const entry: PlaceholderRequest = await req.json()

    // Validate required fields
    if (!entry.title?.trim() || !entry.id?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Title and ID are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // The id is client-supplied and becomes a directory name inside works/.
    // WORK_SLUG_RE is the shape work_schema.slugify emits and the shape
    // process_pending re-checks before it mints anything; the old
    // `^[a-z0-9-]+$` here also admitted `-`, `--`, `foo-` and `-foo`.
    if (!WORK_SLUG_RE.test(entry.id) || entry.id.length > 120) {
      return new Response(
        JSON.stringify({ error: 'Bad request id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (entry.title.length > 200 || (entry.notes && entry.notes.length > 5_000)) {
      return new Response(
        JSON.stringify({ error: 'Request too long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Anonymous branch: report-shaped, no corpus placeholder
    if (!user) {
      if (!githubToken) throw new Error('GITHUB_PAT not configured')

      const issueBody = `## Song Request

**Title:** ${entry.title}
**Artist:** ${entry.artist || 'Unknown'}
**Key:** ${entry.key || 'Unspecified'}
**Requested by:** ${attributionFor(null)}
${entry.notes ? `\n### Notes\n${entry.notes}\n` : ''}
---
*Requested via the Bluegrass Songbook song-request form (no account).*`

      const ghResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Bluegrass-Songbook-Bot',
        },
        body: JSON.stringify({
          title: `Song request: ${entry.title}`,
          body: issueBody,
          labels: ['tune-request'],
        }),
      })

      if (!ghResp.ok) {
        console.error('GitHub API error:', ghResp.status, await ghResp.text())
        throw new Error(`GitHub API error: ${ghResp.status}`)
      }
      const issue = await ghResp.json()

      await supabaseAdmin.from('submission_log').insert({
        user_id: null,
        action: 'song_request',
        target_id: entry.id,
        ip_address: ip === 'unknown' ? null : ip,
        user_agent: req.headers.get('user-agent') || null,
        metadata: { title: entry.title, issue_number: issue.number, anonymous: true },
      })

      return new Response(
        JSON.stringify({
          success: true,
          id: entry.id,
          mode: 'issue',
          issueNumber: issue.number,
          issueUrl: issue.html_url,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // The signed-in branch mints a corpus slug, so it needs to be able to ASK
    // whether that slug is free. Without the token it cannot, and writing
    // blind is precisely the bug.
    if (!githubToken) throw new Error('GITHUB_PAT not configured')

    // Durable per-user rate limit, counted from submission_log — the same one
    // auto-commit-song enforces. `rateLimited` above is a per-isolate bucket
    // that resets on every cold start; this one survives isolate churn, which
    // matters now that a request reaches works/ instead of stopping at a row.
    const recent = await submissionsInLastHour(supabaseAdmin, user.id)
    if (recent >= RATE_LIMIT_PER_HOUR) {
      return new Response(
        JSON.stringify({
          error: `Rate limit reached (${RATE_LIMIT_PER_HOUR} submissions per hour) — try again later`,
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- classify FIRST ---------------------------------------------------
    // Before writing anything, including the pending row. This is the check
    // whose absence destroyed works: if there is already a work at this slug
    // the request is refused (409) and nothing at all is written — no stub in
    // git, and no bounty-board entry for a song we already have. Trust does
    // not enter into it; nothing about being trusted makes an empty stub a
    // safe thing to put on top of somebody's chart.
    const classification = await classifyChange({
      rowId: entry.id,
      replacesId: null,
      userId: user.id,
      // A placeholder is never an edit of anybody's content, so there is no
      // in-place-edit right for trust to grant. Reading trusted_users here
      // would be asking a question with no consumer.
      trusted: false,
      githubToken,
      title: entry.title,
      partType: 'lead-sheet',
      placeholder: true,
    })

    // --- the row: live in the overlay in seconds --------------------------
    // `status: 'placeholder'` is what makes this a request rather than a
    // chart submission with an empty chart — it is read here (isPlaceholderRow),
    // by process_pending on the far side of the dispatch, and by the frontend
    // (utils.isPlaceholder, the bounty board). `content: null`, not '': an
    // empty chart is a claim that the song has one. (`''` is also exactly the
    // value that made 20260209000000's DROP NOT NULL look applied for six
    // months while it had never run — see 20260819000000.)
    const { error: pendingError } = await supabaseAdmin
      .from('pending_songs')
      .upsert({
        id: entry.id,
        replaces_id: null,
        title: entry.title,
        artist: entry.artist || '',
        composer: null,
        content: null,
        key: entry.key || 'C',
        notes: entry.notes || null,
        status: 'placeholder',
        part_type: 'lead-sheet',
        mode: null,
        tags: {},
        created_by: user.id,
        // NEVER true here. It means "durable in git", and only
        // process-pending.yml — after its push lands — is in a position to
        // know that. Setting it on the basis of trust is what let
        // cleanup-pending reap requests that never reached the repo.
        github_committed: false,
      }, { onConflict: 'id' })

    if (pendingError) {
      console.error('Failed to insert pending_songs:', pendingError)
      throw new Error(pendingError.message)
    }

    // Log to submission_log (service role bypasses RLS). `placeholder_request`
    // is deliberately not one of get_leaderboard()'s scoring actions — asking
    // for a song is not contributing one — but it still counts against the
    // durable rate limit above and is still auditable.
    await supabaseAdmin.from('submission_log').insert({
      user_id: user.id,
      action: 'placeholder_request',
      target_id: entry.id,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
      metadata: { title: entry.title, artist: entry.artist || null },
    })

    // --- make it durable --------------------------------------------------
    // Best-effort, and honestly reported. The row is already live and still
    // flagged uncommitted, so a failure here is picked up by the hourly
    // reconciler rather than lost — which is only true because nothing above
    // claimed it was committed.
    let dispatched = false
    try {
      await dispatchPendingCommit({
        row_id: entry.id,
        mode: classification.mode,
        work_id: classification.workId,
        actor_id: user.id,
        actor: attributionFor(user),
      }, githubToken)
      dispatched = true
    } catch (dispatchErr) {
      console.error('Dispatch failed; the request is live but not yet in git:', dispatchErr)
    }

    return new Response(
      JSON.stringify({ success: true, id: entry.id, mode: 'placeholder', dispatched }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    // A refused request is a decision, not a breakage — almost always "that
    // song is already in the songbook". Its message is written to be shown to
    // a person, so pass it through with its own status instead of a 500 the
    // client renders as "something went wrong".
    if (error instanceof DispatchRefusedError) {
      console.log(`Refused song request for '${error.workId}': ${error.message}`)
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: error.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    console.error('Error creating placeholder:', error)
    return new Response(
      JSON.stringify({
        error: (error instanceof Error && error.message) || 'Failed to create request',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
