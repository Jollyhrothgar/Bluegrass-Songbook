// Supabase Edge Function to auto-commit songs to GitHub for trusted users
// Called after a pending_songs entry is created - commits directly to the repo

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Attachment {
  filename: string   // e.g., 'tab-reference.pdf'
  base64: string     // Base64-encoded file content
  label: string      // Human-readable label
}

interface PendingSong {
  id: string
  replaces_id: string | null
  title: string
  artist: string | null
  composer: string | null
  content: string | null
  key: string | null
  mode: string | null
  tags: Record<string, unknown>
  attachment?: Attachment
  create_placeholder?: boolean
  instrument?: string
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

function buildPlaceholderWorkYaml(entry: PendingSong, docFilename: string, label: string): string {
  const today = new Date().toISOString().split('T')[0]
  const artist = entry.artist ? `"${entry.artist.replace(/"/g, '\\"')}"` : '""'

  const instrumentLine = entry.instrument ? `\n    instrument: ${entry.instrument}` : ''

  return `id: ${entry.id}
title: "${entry.title.replace(/"/g, '\\"')}"
artist: ${artist}
composers: []
default_key: ${entry.key || 'C'}
status: placeholder
tags: []
parts:
  - type: document
    format: pdf
    file: ${docFilename}${instrumentLine}
    label: "${label.replace(/"/g, '\\"')}"
    provenance:
      source: user-submission
      submitted_by: trusted-user
      submitted_at: '${today}'
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

/**
 * Commit a binary file (already base64-encoded) to the repo
 */
async function commitBinaryFile(
  path: string,
  base64Content: string,
  message: string,
  githubToken: string
): Promise<void> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`
  const sha = await getFileSha(path, githubToken)

  const body: Record<string, string> = {
    message,
    content: base64Content,
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
    console.error(`Failed to commit binary ${path}:`, response.status, errorText)
    throw new Error(`Failed to commit binary ${path}: ${response.status}`)
  }
}

/**
 * Append a document part to an existing work.yaml
 */
function appendDocumentPart(existingYaml: string, filename: string, label: string): string {
  const today = new Date().toISOString().split('T')[0]
  const partYaml = `  - type: document
    format: pdf
    file: ${filename}
    label: "${label.replace(/"/g, '\\"')}"
    provenance:
      source: user-submission
      submitted_by: trusted-user
      submitted_at: '${today}'`

  // If work.yaml has "parts: []", replace it
  if (existingYaml.includes('parts: []')) {
    return existingYaml.replace('parts: []', `parts:\n${partYaml}`)
  }

  // Otherwise append to existing parts
  return existingYaml.trimEnd() + '\n' + partYaml + '\n'
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
      const { filename, base64, label } = entry.attachment
      const binaryPath = `works/${entry.id}/${filename}`
      const commitMessage = `Add document: ${label} for ${entry.id}\n\nSubmitted via trusted user flow`

      // Commit the binary file
      await commitBinaryFile(binaryPath, base64, commitMessage, githubToken)

      // Update work.yaml to include the new document part
      const workYamlPath = `works/${entry.id}/work.yaml`
      const existingSha = await getFileSha(workYamlPath, githubToken)

      if (existingSha) {
        // Fetch existing work.yaml content
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${workYamlPath}`
        const resp = await fetch(url, {
          headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Bluegrass-Songbook-Bot',
          }
        })
        if (resp.ok) {
          const data = await resp.json()
          const existingYaml = atob(data.content)
          const updatedYaml = appendDocumentPart(existingYaml, filename, label)
          await commitFile(workYamlPath, updatedYaml, `Update work.yaml: add document part for ${entry.id}`, githubToken)
        }
      } else if (entry.create_placeholder) {
        // Create NEW placeholder work.yaml with the document part
        const newYaml = buildPlaceholderWorkYaml(entry, filename, label)
        await commitFile(workYamlPath, newYaml, `Add placeholder: ${entry.title}`, githubToken)
      }

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
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to commit song' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
