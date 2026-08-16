// Supabase Edge Function to create GitHub issues for song submissions/corrections
//
// Login required (Phase 2a): a song submission or correction is something the
// submitter will later go looking for, so it needs an identity. That identity
// is derived SERVER-SIDE from the verified session — there is no
// client-supplied `submittedBy` and no anonymous fallback.
//
// Anonymous users still get report/request: create-flag-issue and the
// anonymous branch of create-song-request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { attributionFor, callerIp, rateLimited, requireUser } from "../_shared/identity.ts"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SongSubmissionRequest {
  type: 'submission' | 'correction'
  title: string
  artist?: string
  songId?: string  // Required for corrections
  chordpro: string
  comment?: string  // Required for corrections
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

    // Identity from the verified session — never from the request body
    const { user, admin, response: authFailure } = await requireUser(req, corsHeaders)
    if (authFailure) return authFailure
    const attribution = attributionFor(user)

    // Per-user throttle (the IP is only a tiebreaker for shared NATs)
    if (rateLimited(`song-issue:${user!.id}`, { max: 20 })) {
      return new Response(
        JSON.stringify({ error: 'Too many submissions — try again later' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body: SongSubmissionRequest = await req.json()
    const { type, title, artist, songId, chordpro, comment } = body

    // Validate required fields
    if (!title || !chordpro) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: title and chordpro are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (type === 'correction' && (!songId || !comment)) {
      return new Response(
        JSON.stringify({ error: 'Corrections require songId and comment' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let issueTitle: string
    let issueBody: string
    let labels: string[]

    if (type === 'correction') {
      issueTitle = `Correction: ${title}`
      labels = ['song-correction']
      issueBody = `## Song Correction

**Song ID:** ${songId}
**Title:** ${title}
**Artist:** ${artist || 'Unknown'}
**Submitted by:** ${attribution}

### Changes Made
${comment}

### Updated ChordPro Content

\`\`\`chordpro
${chordpro}
\`\`\`

---
*Submitted via Bluegrass Songbook. Add the \`approved\` label to process automatically.*`

    } else {
      issueTitle = artist
        ? `Song: ${title} by ${artist}`
        : `Song: ${title}`
      labels = ['song-submission']
      issueBody = `## Song Submission

**Title:** ${title}
**Artist:** ${artist || 'Unknown'}
**Submitted by:** ${attribution}

### ChordPro Content

\`\`\`chordpro
${chordpro}
\`\`\`

---
*Submitted via Bluegrass Songbook. Add the \`approved\` label to process automatically.*`
    }

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
        labels: labels,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GitHub API error:', response.status, errorText)
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const issue = await response.json()

    // Log the write so a contributor surface can find it later (Phase 4a)
    await admin!.from('submission_log').insert({
      user_id: user!.id,
      action: type === 'correction' ? 'song_correction' : 'song_submit',
      target_id: songId || null,
      ip_address: callerIp(req) === 'unknown' ? null : callerIp(req),
      user_agent: req.headers.get('user-agent') || null,
      metadata: { title, issue_number: issue.number },
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
      JSON.stringify({ error: error.message || 'Failed to create issue' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
