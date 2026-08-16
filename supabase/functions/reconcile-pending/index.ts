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
// Response shape (always HTTP 200 so the caller can read the numbers; the
// workflow decides what counts as a failure):
//   { success, drift, graceMinutes, eligible, attempted, committed,
//     stuckCount, stuck: [...], unretryable: [...], remaining }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  commitPendingSong,
  unretryableReason,
  type PendingSong,
} from "../_shared/commit-song.ts"

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
      .select('id, replaces_id, title, artist, composer, content, key, mode, tags, created_at')
      .eq('github_committed', false)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error reading pending_songs:', error)
      throw error
    }

    const pending: PendingSong[] = rows || []
    const drift = pending.length

    const cutoff = Date.now() - GRACE_MINUTES * 60 * 1000
    const eligible = pending.filter(r => {
      const created = r.created_at ? Date.parse(r.created_at) : 0
      return created <= cutoff
    })

    console.log(
      `Drift: ${drift} uncommitted pending_songs row(s); ` +
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
        await commitPendingSong(row, githubToken as string)

        const { error: updateError } = await supabase
          .from('pending_songs')
          .update({ github_committed: true })
          .eq('id', row.id)

        if (updateError) {
          // The files ARE in git; failing to flip the flag just means we try
          // again next hour (the commit is idempotent). Still worth alerting.
          throw new Error(`Committed but failed to mark committed: ${updateError.message}`)
        }

        committed.push(row.id)
        console.log(`Reconciled ${row.id}`)
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
