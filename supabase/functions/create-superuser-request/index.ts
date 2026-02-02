// Supabase Edge Function to create GitHub issues for super-user access requests
// Allows users to request trusted/super-user status for instant editing

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SuperUserRequest {
  userId: string
  userEmail: string
  userName?: string
  reason?: string
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

    const body: SuperUserRequest = await req.json()
    const { userId, userEmail, userName, reason } = body

    // Validate required fields
    if (!userId || !userEmail) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields (userId, userEmail)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const displayName = userName || userEmail.split('@')[0]
    const issueTitle = `Super-User Request: ${displayName}`

    const issueBody = `## Super-User Access Request

**Requested by:** ${displayName}

### Why They Want Super-User Access
${reason || 'No reason provided'}

---

### What This Means
Super-users can make instant edits to songs without waiting for approval. Their changes are visible immediately and auto-committed to the repository in the background.

### Admin Instructions
1. Find this user in **Supabase Dashboard > Authentication > Users** (search by name: "${displayName}")
2. Copy their User ID
3. Run in SQL editor:
\`\`\`sql
INSERT INTO trusted_users (user_id, created_by)
VALUES ('<user-id-here>', 'github-approval');
\`\`\`
4. Close this issue with the \`approved\` label

---
*Submitted via Super-User Request flow*
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
        labels: ['superuser-request'],
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
    console.error('Error creating super-user request:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
