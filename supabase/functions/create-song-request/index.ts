// Supabase Edge Function to create GitHub issues for song requests
// Allows anonymous users to request songs without a GitHub account

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SongRequestPayload {
  songTitle: string
  artist?: string
  details?: string
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

    const body: SongRequestPayload = await req.json()
    const { songTitle, artist, details, submittedBy } = body
    const attribution = submittedBy || 'Rando Calrissian'

    // Validate required fields
    if (!songTitle?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Song title is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const issueTitle = artist
      ? `Song Request: ${songTitle} by ${artist}`
      : `Song Request: ${songTitle}`

    let issueBody = `## Song Request

**Song Title:** ${songTitle}
**Artist:** ${artist || 'Unknown/Any version'}
**Requested by:** ${attribution}
`

    if (details?.trim()) {
      issueBody += `
### Additional Details
${details}
`
    }

    issueBody += `
---
*Submitted via Bluegrass Songbook. This song will be added if chords are available in public domain sources.*`

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
        labels: ['song-request'],
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
