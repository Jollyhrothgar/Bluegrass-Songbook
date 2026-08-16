// Supabase Edge Function to auto-commit songs to GitHub for trusted users
// Called after a pending_songs entry is created - commits directly to the repo
//
// The commit itself lives in ../_shared/commit-song.ts so that the hourly
// retry pass (reconcile-pending) runs exactly the same code path. Redeploy
// both functions when that module changes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  commitAttachment,
  commitPendingSong,
  type PendingSong,
} from "../_shared/commit-song.ts"

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
    const githubToken = Deno.env.get('GITHUB_PAT')
    if (!githubToken) {
      throw new Error('GITHUB_PAT not configured')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured')
    }

    // Verify caller is a trusted user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: trustedUser } = await supabaseAdmin
      .from('trusted_users')
      .select('user_id')
      .eq('user_id', user.id)
      .single()

    if (!trustedUser) {
      return new Response(
        JSON.stringify({ error: 'Not authorized — trusted user status required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const entry: PendingSong = await req.json()

    // Handle document attachment uploads (no lead sheet content required)
    if (entry.attachment && entry.id) {
      const { binaryPath } = await commitAttachment(entry, githubToken)

      // Log to submission_log
      await supabaseAdmin.from('submission_log').insert({
        user_id: user.id,
        action: 'doc_upload',
        target_id: entry.id,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
        metadata: { title: entry.title, filename: entry.attachment.filename },
      })

      return new Response(
        JSON.stringify({ success: true, binaryPath }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate required fields for lead sheet submissions
    if (!entry.id || !entry.title || !entry.content) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: id, title, and content are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { workPath, proPath } = await commitPendingSong(entry, githubToken)

    // Mark as committed in pending_songs
    const { error: updateError } = await supabaseAdmin
      .from('pending_songs')
      .update({ github_committed: true })
      .eq('id', entry.id)

    if (updateError) {
      console.error('Failed to mark as committed:', updateError)
      // Don't fail the request - the commit succeeded
    }

    // Log to submission_log
    await supabaseAdmin.from('submission_log').insert({
      user_id: user.id,
      action: 'song_submit',
      target_id: entry.id,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
      metadata: { title: entry.title, artist: entry.artist },
    })

    return new Response(
      JSON.stringify({
        success: true,
        workPath,
        proPath,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error committing song:', error)
    const message = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ error: message || 'Failed to commit song' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
