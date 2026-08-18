// Supabase Edge Function to create song requests.
//
// Two branches (Phase 2a — "request a song" is anonymous-capable):
//
//   Signed in  → placeholder: pending_songs row (visible instantly, owned by
//                the requester) + submission_log; trusted users also get the
//                work.yaml auto-commit.
//   Anonymous  → a plain GitHub issue labelled `tune-request`. A placeholder
//                mints a corpus slug the requester "owns" and would later go
//                looking for, which the contract puts behind login; an
//                anonymous request is a report, so it stays report-shaped and
//                a confirmation toast is the complete experience.
//
// Identity, when present, is derived SERVER-SIDE from the verified session.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { attributionFor, callerIp, optionalUser, rateLimited } from "../_shared/identity.ts"

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
    if (!/^[a-z0-9-]+$/.test(entry.id) || entry.id.length > 120) {
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
      JSON.stringify({ success: true, id: entry.id, mode: 'placeholder', committed: !!trustedUser }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error creating placeholder:', error)
    return new Response(
      JSON.stringify({
        error: (error instanceof Error && error.message) || 'Failed to create request',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
