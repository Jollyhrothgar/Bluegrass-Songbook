// Supabase Edge Function to create GitHub issues from song flags
// Requires authenticated user. Logs submissions to submission_log.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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
  submittedBy?: string
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    // Require authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify user token
    let userId: string | null = null
    if (supabaseUrl && supabaseServiceKey) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userId = user.id

      const body: FlagRequest = await req.json()
      const { songId, songTitle, songArtist, flagType, description, submittedBy } = body
      const attribution = submittedBy || user.user_metadata?.full_name || user.email || 'Authenticated User'

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

      // Log to submission_log
      await supabaseAdmin.from('submission_log').insert({
        user_id: userId,
        action: 'flag_report',
        target_id: songId,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
        metadata: { flag_type: flagType, issue_number: issue.number },
      })

      return new Response(
        JSON.stringify({
          success: true,
          issueNumber: issue.number,
          issueUrl: issue.html_url
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    throw new Error('Supabase credentials not configured')

  } catch (error) {
    console.error('Error creating issue:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create issue' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
