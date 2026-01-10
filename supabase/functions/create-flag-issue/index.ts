// Supabase Edge Function to create GitHub issues from song flags
// Allows anonymous users to report issues without a GitHub account

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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
  submittedBy?: string  // Attribution: logged-in username or "Rando Calrissian"
}

const FLAG_TYPE_LABELS: Record<string, string> = {
  'wrong-chord': 'Wrong chord',
  'wrong-placement': 'Chord in wrong place',
  'lyric-error': 'Lyric error',
  'missing-section': 'Missing section',
  'other': 'Other issue',
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

    const body: FlagRequest = await req.json()
    const { songId, songTitle, songArtist, flagType, description, submittedBy } = body
    const attribution = submittedBy || 'Rando Calrissian'

    // Validate required fields
    if (!songId || !flagType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
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
