// Supabase Edge Function to create GitHub issues from song flags / feedback.
//
// ANONYMOUS-CAPABLE (Phase 2a): flagging a problem is a report, not content
// the reporter will come back looking for — a confirmation toast is the
// complete experience, so login is not required. Abuse guards are an IP
// throttle (same limiter shape as create-tab-pr) plus the fact that the
// output is a labelled GitHub issue a human reads.
//
// If the caller IS signed in, their identity is derived SERVER-SIDE from the
// verified session and attached to the issue and submission_log. A
// client-supplied `submittedBy` is ignored — the field no longer exists.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { attributionFor, callerIp, optionalUser, rateLimited } from "../_shared/identity.ts"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface FlagRequest {
  songId: string
  songTitle: string
  songArtist: string
  flagType: string
  description?: string
}

const FLAG_TYPE_LABELS: Record<string, string> = {
  'wrong-chord': 'Wrong chord',
  'wrong-placement': 'Chord in wrong place',
  'lyric-error': 'Lyric error',
  'missing-section': 'Missing section',
  'other': 'Other issue',
}

// Anonymous reports get a tighter budget than signed-in ones.
const ANON_MAX_PER_HOUR = 5
const USER_MAX_PER_HOUR = 20

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

    // Anonymous is allowed; a valid session just supplies identity.
    const { user, admin } = await optionalUser(req)
    const attribution = attributionFor(user)
    const ip = callerIp(req)

    const limitKey = user ? `flag:user:${user.id}` : `flag:ip:${ip}`
    if (rateLimited(limitKey, { max: user ? USER_MAX_PER_HOUR : ANON_MAX_PER_HOUR })) {
      return new Response(
        JSON.stringify({ error: 'Too many reports — try again later' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body: FlagRequest = await req.json()
    const { songId, songTitle, songArtist, flagType, description } = body

    // Validate required fields
    if (!songId || !flagType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (description && description.length > 5_000) {
      return new Response(
        JSON.stringify({ error: 'Description too long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const flagLabel = FLAG_TYPE_LABELS[flagType] || flagType
    const issueTitle = `Song Issue: ${songTitle || songId}`

    let issueBody = `## Song Issue Report

**Song:** ${songTitle || 'Unknown'}
**Artist:** ${songArtist || 'Unknown'}
**Song ID:** \`${songId}\`
**Issue Type:** ${flagLabel}
**Reported by:** ${attribution}
`

    if (description) {
      issueBody += `
### Details
${description}
`
    }

    issueBody += `
---
*Submitted via Report Issue button*
`

    // Create GitHub issue
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Bluegrass-Songbook-Bot',
      },
      body: JSON.stringify({
        title: issueTitle,
        body: issueBody,
        labels: ['song-flag', flagType],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GitHub API error:', response.status, errorText)
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const issue = await response.json()

    // Log to submission_log (user_id is nullable — anonymous reports log too)
    await admin.from('submission_log').insert({
      user_id: user?.id || null,
      action: 'flag_report',
      target_id: songId,
      ip_address: ip === 'unknown' ? null : ip,
      user_agent: req.headers.get('user-agent') || null,
      metadata: { flag_type: flagType, issue_number: issue.number, anonymous: !user },
    })

    return new Response(
      JSON.stringify({
        success: true,
        issueNumber: issue.number,
        issueUrl: issue.html_url
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error creating issue:', error)
    return new Response(
      JSON.stringify({
        error: (error instanceof Error && error.message) || 'Failed to create issue',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
