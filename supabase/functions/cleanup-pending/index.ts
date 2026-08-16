// Supabase Edge Function to cleanup pending_songs after successful deploy
// Called by GitHub Action after CI completes

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Delete pending songs that have been committed to GitHub — they are in
    // the static index.jsonl now, so the overlay no longer needs them.
    //
    // Grace period: the flag means "pushed to main", not "deployed". Phase 2b
    // moved the flip out of auto-commit-song and into process-pending.yml,
    // where it happens after the push lands — but the deploy that publishes
    // the work still has to build afterwards. Any unrelated deploy landing in
    // that window would reap the row and the song would vanish from the live
    // overlay until its own deploy finished. Keep rows younger than 15
    // minutes regardless of the flag.
    const graceCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('pending_songs')
      .delete()
      .eq('github_committed', true)
      .lt('created_at', graceCutoff)
      .select('id')

    if (error) {
      console.error('Error deleting committed pending songs:', error)
      throw error
    }

    const deletedCount = data?.length || 0
    console.log(`Cleaned up ${deletedCount} pending songs`)

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount,
        deletedIds: data?.map(s => s.id) || []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error cleaning up pending songs:', error)
    const message = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ error: message || 'Failed to cleanup pending songs' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
