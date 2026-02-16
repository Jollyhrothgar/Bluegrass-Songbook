// Supabase Edge Function to create placeholder song requests
// Requires authenticated user. Inserts pending_songs row + submission_log entry.
// Trusted users also get an auto-commit to GitHub.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

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

function buildPlaceholderWorkYaml(entry: PlaceholderRequest): string {
  const today = new Date().toISOString().split('T')[0]
  const artist = entry.artist ? `"${entry.artist.replace(/"/g, '\\"')}"` : '""'

  return `id: ${entry.id}
title: "${entry.title.replace(/"/g, '\\"')}"
artist: ${artist}
composers: []
default_key: ${entry.key || 'C'}
status: placeholder
${entry.notes ? `notes: "${entry.notes.replace(/"/g, '\\"')}"` : ''}
tags: []
parts: []
`
}

async function commitFile(
  path: string,
  content: string,
  message: string,
  githubToken: string
): Promise<void> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`

  // Check if file exists (need SHA for updates)
  const existResp = await fetch(url, {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Bluegrass-Songbook-Bot',
    }
  })

  const body: Record<string, string> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
  }

  if (existResp.ok) {
    const data = await existResp.json()
    body.sha = data.sha
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Bluegrass-Songbook-Bot',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Failed to commit ${path}:`, response.status, errorText)
    throw new Error(`Failed to commit ${path}: ${response.status}`)
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const githubToken = Deno.env.get('GITHUB_PAT')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured')
    }

    // Require authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
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

    const entry: PlaceholderRequest = await req.json()

    // Validate required fields
    if (!entry.title?.trim() || !entry.id?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Title and ID are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if trusted user
    const { data: trustedUser } = await supabaseAdmin
      .from('trusted_users')
      .select('user_id')
      .eq('user_id', user.id)
      .single()

    // Insert pending_songs entry (visible immediately in the app)
    const { error: pendingError } = await supabaseAdmin
      .from('pending_songs')
      .upsert({
        id: entry.id,
        replaces_id: null,
        title: entry.title,
        artist: entry.artist || '',
        composer: null,
        content: '',
        key: entry.key || 'C',
        mode: null,
        tags: {},
        created_by: user.id,
        github_committed: !!trustedUser,
      }, { onConflict: 'id' })

    if (pendingError) {
      console.error('Failed to insert pending_songs:', pendingError)
      throw new Error(pendingError.message)
    }

    // If trusted user and GitHub token available, commit to repo
    if (trustedUser && githubToken) {
      try {
        const yaml = buildPlaceholderWorkYaml(entry)
        await commitFile(
          `works/${entry.id}/work.yaml`,
          yaml,
          `Add placeholder: ${entry.title}`,
          githubToken
        )
      } catch (commitErr) {
        // Non-fatal: pending_songs row already created for immediate visibility
        console.error('GitHub commit failed (non-fatal):', commitErr)
      }
    }

    // Log to submission_log (service role bypasses RLS)
    await supabaseAdmin.from('submission_log').insert({
      user_id: user.id,
      action: 'placeholder_request',
      target_id: entry.id,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
      metadata: { title: entry.title, artist: entry.artist || null },
    })

    return new Response(
      JSON.stringify({ success: true, id: entry.id, committed: !!trustedUser }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error creating placeholder:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
