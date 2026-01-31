// Supabase Edge Function to auto-commit songs to GitHub for trusted users
// Called after a pending_songs entry is created - commits directly to the repo

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PendingSong {
  id: string
  replaces_id: string | null
  title: string
  artist: string | null
  composer: string | null
  content: string
  key: string | null
  mode: string | null
  tags: Record<string, unknown>
}

function buildWorkYaml(entry: PendingSong): string {
  const composers = entry.composer ? `[${entry.composer}]` : '[]'
  const today = new Date().toISOString().split('T')[0]

  return `id: ${entry.id}
title: "${entry.title.replace(/"/g, '\\"')}"
artist: "${(entry.artist || '').replace(/"/g, '\\"')}"
composers: ${composers}
default_key: ${entry.key || 'C'}
tags: []
parts:
  - type: lead-sheet
    format: chordpro
    file: lead-sheet.pro
    default: true
    provenance:
      source: trusted-user
      imported_at: '${today}'
`
}

async function getFileSha(path: string, githubToken: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`

  const response = await fetch(url, {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Bluegrass-Songbook-Bot',
    }
  })

  if (response.ok) {
    const data = await response.json()
    return data.sha
  }

  return null
}

async function commitFile(
  path: string,
  content: string,
  message: string,
  githubToken: string
): Promise<void> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`

  // Get current file SHA if it exists (needed for updates)
  const sha = await getFileSha(path, githubToken)

  // Base64 encode the content
  const encodedContent = btoa(unescape(encodeURIComponent(content)))

  const body: Record<string, string> = {
    message,
    content: encodedContent,
  }

  if (sha) {
    body.sha = sha
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
    const githubToken = Deno.env.get('GITHUB_PAT')
    if (!githubToken) {
      throw new Error('GITHUB_PAT not configured')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured')
    }

    const entry: PendingSong = await req.json()

    // Validate required fields
    if (!entry.id || !entry.title || !entry.content) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: id, title, and content are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build file contents
    const workYaml = buildWorkYaml(entry)
    const leadSheetPro = entry.content

    // Commit message
    const action = entry.replaces_id ? 'Update' : 'Add'
    const commitMessage = `${action} ${entry.title}${entry.artist ? ` by ${entry.artist}` : ''}\n\nSubmitted via trusted user flow`

    // Commit both files
    const workPath = `works/${entry.id}/work.yaml`
    const proPath = `works/${entry.id}/lead-sheet.pro`

    await commitFile(workPath, workYaml, commitMessage, githubToken)
    await commitFile(proPath, leadSheetPro, commitMessage, githubToken)

    // Mark as committed in pending_songs using service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { error: updateError } = await supabase
      .from('pending_songs')
      .update({ github_committed: true })
      .eq('id', entry.id)

    if (updateError) {
      console.error('Failed to mark as committed:', updateError)
      // Don't fail the request - the commit succeeded
    }

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
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to commit song' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
