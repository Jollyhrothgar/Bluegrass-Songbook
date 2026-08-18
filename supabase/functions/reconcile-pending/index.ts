// Supabase Edge Function: retry pending_songs rows that never reached git.
//
// The live commit path (auto-commit-song, triggered by the editor) is
// best-effort: if it fails, the row sits in pending_songs with
// github_committed = false. The song is served from the Supabase overlay but
// never lands in works/ -- Live and Durable silently disagree, and nothing
// retries or complains. This function is the retry-and-alert pass.
//
// Called hourly by .github/workflows/reconcile-pending.yml. Gated on the
// service role key: it commits to the repo, so it must never be reachable with
// the (public) anon key.
//
// Phase 2b: the retry no longer commits content itself. It re-fires the same
// `pending-commit` repository_dispatch the live path uses, so a reconciled row
// and a first-try row go through one writer (scripts/lib/works_writer.py) with
// one classification. `committed` therefore counts rows successfully
// RE-DISPATCHED; the workflow flips github_committed once its push lands, and
// a row that is still false next hour gets dispatched again (process_pending
// is idempotent on the row's content marker, so a duplicate dispatch is a
// no-op rather than a second work).
//
// Phase 3b: rows the dedup backstop refused (dedup_hold is not null) are
// counted but never re-dispatched. Without that, a row the backstop holds
// would be re-fired every hour and refused every hour — an alert issue that
// grows a comment an hour and a workflow that is permanently red. Clearing
// dedup_hold is a reviewer saying "land it anyway"; the next pass picks it up.
//
// Response shape (always HTTP 200 so the caller can read the numbers; the
// workflow decides what counts as a failure):
//   { success, drift, held, graceMinutes, eligible, attempted, committed,
//     stuckCount, stuck: [...], unretryable: [...], remaining }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { unretryableReason, type PendingSong } from "../_shared/commit-song.ts"
import { attributionFor } from "../_shared/identity.ts"
import { classifyChange, dispatchPendingCommit } from "../_shared/pending-dispatch.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rows younger than this are still plausibly in flight from the live path;
// retrying them would race auto-commit-song. Matches cleanup-pending's grace.
const GRACE_MINUTES = 15

// Cap per run so a large backlog cannot blow the function's wall clock or the
// GitHub rate limit. The remainder is reported and picked up next hour.
const MAX_PER_RUN = 25

interface StuckRow {
  id: string
  title: string | null
  created_at: string | null
  error: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured')
    }

    // This function writes to the repo. Require the service role key itself,
    // not merely "some valid project JWT" -- the anon key is public.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (token !== supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Not authorized — service role key required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // dryRun measures drift without touching GitHub.
    let dryRun = false
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        dryRun = body?.dryRun === true
      } catch {
        // empty/!json body is the normal case
      }
    }

    const githubToken = Deno.env.get('GITHUB_PAT')
    if (!githubToken && !dryRun) {
      throw new Error('GITHUB_PAT not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Every uncommitted row: this count IS the drift between Live and Durable.
    const { data: rows, error } = await supabase
      .from('pending_songs')
      // One string literal — supabase-js types the row off the literal.
      .select('id, replaces_id, title, artist, composer, content, key, mode, tags, created_at, created_by, dedup_hold, part_type, instrument, part_file')
      .eq('github_committed', false)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error reading pending_songs:', error)
      throw error
    }

    const pending: PendingSong[] = rows || []
    const drift = pending.length

    // Held rows are drift too -- they are live and not durable -- but they are
    // waiting on a human, not on a retry. Re-dispatching them would just make
    // the backstop refuse them again.
    const heldRows = pending.filter(r => !!r.dedup_hold)
    const held = heldRows.length

    const cutoff = Date.now() - GRACE_MINUTES * 60 * 1000
    const eligible = pending.filter(r => {
      if (r.dedup_hold) return false
      const created = r.created_at ? Date.parse(r.created_at) : 0
      return created <= cutoff
    })

    console.log(
      `Drift: ${drift} uncommitted pending_songs row(s); ` +
      `${held} held by the dedup backstop; ` +
      `${eligible.length} past the ${GRACE_MINUTES}-minute grace window`
    )

    const committed: string[] = []
    const stuck: StuckRow[] = []
    const unretryable: StuckRow[] = []

    const batch = eligible.slice(0, MAX_PER_RUN)
    const remaining = Math.max(0, eligible.length - batch.length)

    for (const row of batch) {
      const reason = unretryableReason(row)
      if (reason) {
        // Never going to succeed on its own -- surface it for manual rescue
        // rather than burning a GitHub call on it every hour.
        unretryable.push({ id: row.id, title: row.title, created_at: row.created_at ?? null, error: reason })
        continue
      }

      if (dryRun) continue

      try {
        const actorId = (row as { created_by?: string | null }).created_by
        if (!actorId) {
          // Pre-2b rows can predate mandatory ownership. Without an owner
          // there is nobody to attribute the work to and no way to decide
          // update-vs-fork, so it needs a human, not another retry.
          throw new Error('row has no created_by — cannot classify or attribute')
        }

        const { data: trustedUser } = await supabase
          .from('trusted_users')
          .select('user_id')
          .eq('user_id', actorId)
          .maybeSingle()

        // part_type / part_file ride along so a retried TAB is classified the
        // way the live path would have classified it. Without them a tab row
        // would be re-dispatched as a chart and land as lead-sheet.pro
        // holding an OTF document.
        const classification = await classifyChange({
          rowId: row.id,
          replacesId: row.replaces_id,
          userId: actorId,
          trusted: !!trustedUser,
          githubToken: githubToken as string,
          partType: row.part_type,
          partFile: row.part_file,
        })

        let actor = actorId
        try {
          const { data: userData } = await supabase.auth.admin.getUserById(actorId)
          actor = attributionFor(userData?.user ?? null)
        } catch (_e) {
          // Attribution is nice-to-have; the uuid still identifies the author.
        }

        await dispatchPendingCommit({
          row_id: row.id,
          mode: classification.mode,
          work_id: classification.workId,
          actor_id: actorId,
          actor,
        }, githubToken as string)

        // github_committed is flipped by process-pending.yml once its push
        // lands. Flipping it here would re-create the 0a bug: a row marked
        // durable before it actually is, then reaped by cleanup-pending.
        committed.push(row.id)
        console.log(`Re-dispatched ${row.id} as ${classification.mode}`)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error(`Failed to reconcile ${row.id}:`, message)
        stuck.push({ id: row.id, title: row.title, created_at: row.created_at ?? null, error: message })
      }
    }

    const stuckCount = stuck.length + unretryable.length

    console.log(
      `Reconcile summary: attempted=${dryRun ? 0 : batch.length - unretryable.length} ` +
      `committed=${committed.length} stuck=${stuck.length} ` +
      `unretryable=${unretryable.length} remaining=${remaining} dryRun=${dryRun}`
    )

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        drift,
        held,
        heldIds: heldRows.map(r => r.id),
        graceMinutes: GRACE_MINUTES,
        eligible: eligible.length,
        attempted: dryRun ? 0 : batch.length - unretryable.length,
        committed: committed.length,
        committedIds: committed,
        stuckCount,
        stuck,
        unretryable,
        remaining,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error reconciling pending songs:', error)
    const message = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ error: message || 'Failed to reconcile pending songs' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
