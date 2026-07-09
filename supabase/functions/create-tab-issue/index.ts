// Supabase Edge Function to create GitHub issues for TAB submissions
// and corrections from the OTF editor — the tab twin of
// create-song-issue, riding the same approve-label pipeline.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

// GitHub issue bodies cap at 65536 chars; leave headroom for the
// template. The client compacts the JSON and pre-checks, but never
// trust the client.
const MAX_OTF_CHARS = 60000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TabSubmissionRequest {
  type: 'tab-correction' | 'tab-submission'
  title: string
  workId?: string      // Required for corrections
  instrument: string   // e.g. 'banjo'
  otf: string          // compact-serialized OTF JSON
  comment?: string     // Required for corrections
  submittedBy?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const githubToken = Deno.env.get('GITHUB_PAT')
    if (!githubToken) {
      throw new Error('GITHUB_PAT not configured')
    }

    const body: TabSubmissionRequest = await req.json()
    const { type, title, workId, instrument, otf, comment, submittedBy } = body
    const attribution = submittedBy || 'Rando Calrissian'

    if (!title || !otf || !instrument) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: title, instrument, otf' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (type === 'tab-correction' && (!workId || !comment)) {
      return new Response(
        JSON.stringify({ error: 'Tab corrections require workId and comment' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (otf.length > MAX_OTF_CHARS) {
      return new Response(
        JSON.stringify({ error: `Tab too large for submission (${otf.length} chars, max ${MAX_OTF_CHARS}). Download the OTF and attach it to a manual issue instead.` }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // Must at least be JSON with tracks
    try {
      const parsed = JSON.parse(otf)
      if (!Array.isArray(parsed.tracks) || parsed.tracks.length === 0) {
        throw new Error('no tracks')
      }
    } catch (_e) {
      return new Response(
        JSON.stringify({ error: 'otf is not a valid OTF JSON document' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let issueTitle: string
    let issueBody: string
    let labels: string[]

    if (type === 'tab-correction') {
      issueTitle = `Tab correction: ${title} (${instrument})`
      labels = ['tab-correction']
      issueBody = `## Tab Correction

**Work ID:** ${workId}
**Title:** ${title}
**Instrument:** ${instrument}
**Submitted by:** ${attribution}

### Changes Made
${comment}

### Updated OTF Content

\`\`\`json
${otf}
\`\`\`

---
*Submitted via the Bluegrass Songbook tab editor. Add the \`approved\` label to process automatically.*`
    } else {
      issueTitle = `Tab: ${title} (${instrument})`
      labels = ['tab-submission']
      issueBody = `## Tab Submission

**Title:** ${title}
**Instrument:** ${instrument}
**Submitted by:** ${attribution}

### OTF Content

\`\`\`json
${otf}
\`\`\`

---
*Submitted via the Bluegrass Songbook tab editor. Add the \`approved\` label to process automatically.*`
    }

    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Bluegrass-Songbook-Bot',
      },
      body: JSON.stringify({ title: issueTitle, body: issueBody, labels }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GitHub API error:', response.status, errorText)
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const issue = await response.json()
    return new Response(
      JSON.stringify({ success: true, issueNumber: issue.number, issueUrl: issue.html_url }),
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
