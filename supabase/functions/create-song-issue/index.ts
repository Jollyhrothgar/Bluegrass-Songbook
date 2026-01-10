// Supabase Edge Function to create GitHub issues for song submissions/corrections
// Allows anonymous users to submit songs without a GitHub account

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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
  submittedBy?: string  // Attribution: logged-in username or "Rando Calrissian"
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

    const body: SongSubmissionRequest = await req.json()
    const { type, title, artist, songId, chordpro, comment, submittedBy } = body
    const attribution = submittedBy || 'Rando Calrissian'

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
