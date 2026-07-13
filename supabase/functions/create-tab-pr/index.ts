// Supabase Edge Function: submit a tab as a PULL REQUEST.
//
// Commits the OTF file itself to a branch via the GitHub contents API
// and opens a labeled PR — no issue-body size cap, native PR review,
// merge = approve. A repo workflow (process-tab-pr.yml) then adds
// work.yaml provenance and the rebuilt index to the same branch so the
// reviewer sees the complete diff.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"
const API = `https://api.github.com/repos/${GITHUB_REPO}`

// Sanity cap — a tab should never be near this (corpus max ~180KB)
const MAX_OTF_CHARS = 2_000_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Best-effort per-IP throttle (per isolate — resets on cold start).
// Abuse ultimately ends at the human merge gate; this keeps a script
// from burning the PAT's API quota with branch/PR spam.
const RATE_WINDOW_MS = 60 * 60 * 1000
const RATE_MAX = 5
const recentByIp = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentByIp.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS)
  const limited = hits.length >= RATE_MAX
  if (!limited) hits.push(now)
  recentByIp.set(ip, hits)
  return limited
}

interface TabPrRequest {
  type: 'tab-correction' | 'tab-submission'
  title: string
  workId?: string      // Required for corrections
  instrument: string   // e.g. 'banjo' — becomes <instrument>.otf.json
  otf: string          // serialized OTF JSON
  comment?: string     // Required for corrections
  submittedBy?: string
}

function bad(status: number, error: string) {
  return new Response(JSON.stringify({ error }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function slugify(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-') || 'untitled'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (rateLimited(ip)) return bad(429, 'Too many submissions — try again later')

    const githubToken = Deno.env.get('GITHUB_PAT')
    if (!githubToken) throw new Error('GITHUB_PAT not configured')

    const gh = (path: string, init: RequestInit = {}) =>
      fetch(`${API}${path}`, {
        ...init,
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Bluegrass-Songbook-Bot',
          ...(init.headers || {}),
        },
      })

    const body: TabPrRequest = await req.json()
    const { type, title, workId, instrument, otf, comment, submittedBy } = body
    const attribution = submittedBy || 'Rando Calrissian'

    if (type !== 'tab-correction' && type !== 'tab-submission') {
      return bad(400, 'Bad type')
    }
    if (!title || !otf || !instrument) {
      return bad(400, 'Missing required fields: title, instrument, otf')
    }
    if (typeof otf !== 'string' || typeof title !== 'string') {
      return bad(400, 'Bad field types')
    }
    if (title.length > 200) return bad(400, 'Title too long')
    if (!/^[a-z0-9-]+$/.test(instrument) || instrument.length > 40) {
      return bad(400, 'Bad instrument')
    }
    // workId always slug-validated when present — it becomes a repo path
    // and branch name, so nothing outside [a-z0-9-] may ever reach it.
    if (workId !== undefined && !/^[a-z0-9-]+$/.test(workId)) {
      return bad(400, 'Bad work id')
    }
    if (type === 'tab-correction' && (!workId || !comment)) {
      return bad(400, 'Tab corrections require workId and comment')
    }
    if (comment && comment.length > 5_000) return bad(400, 'Comment too long')
    if (attribution.length > 100) return bad(400, 'Attribution too long')
    if (otf.length > MAX_OTF_CHARS) return bad(413, 'Tab too large')

    let parsed
    try {
      parsed = JSON.parse(otf)
      if (!Array.isArray(parsed.tracks) || parsed.tracks.length === 0) throw new Error()
    } catch (_e) {
      return bad(400, 'otf is not a valid OTF JSON document')
    }

    // Resolve the target path
    let targetWorkId = workId
    if (type === 'tab-submission') {
      const base = slugify(title)
      targetWorkId = base
      // find a free slug (works/<slug> must not exist on main)
      for (let i = 0; i < 20; i++) {
        const probe = await gh(`/contents/works/${targetWorkId}?ref=main`)
        if (probe.status === 404) break
        targetWorkId = `${base}-${i + 1}`
      }
    }
    const filePath = `works/${targetWorkId}/${instrument}.otf.json`

    // Branch off main
    const mainRef = await gh('/git/ref/heads/main')
    if (!mainRef.ok) throw new Error(`ref lookup failed: ${mainRef.status}`)
    const baseSha = (await mainRef.json()).object.sha
    const branch = `tab/${type === 'tab-correction' ? 'fix' : 'new'}-${targetWorkId}-${Date.now()}`
    const mkBranch = await gh('/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    })
    if (!mkBranch.ok) throw new Error(`branch create failed: ${mkBranch.status}`)

    // Corrections replace an existing file — the contents API needs its sha
    let existingSha: string | undefined
    const existing = await gh(`/contents/${filePath}?ref=${branch}`)
    if (existing.ok) existingSha = (await existing.json()).sha

    // Commit the OTF itself (pretty-printed for reviewable diffs)
    const pretty = JSON.stringify(parsed, null, 1)
    const put = await gh(`/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: type === 'tab-correction'
          ? `Tab correction: ${title} (${instrument})`
          : `New tab: ${title} (${instrument})`,
        content: btoa(unescape(encodeURIComponent(pretty))),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    })
    if (!put.ok) throw new Error(`file commit failed: ${put.status} ${await put.text()}`)

    // Open the PR (metadata in the body drives process-tab-pr.yml)
    const prBody = `## ${type === 'tab-correction' ? 'Tab Correction' : 'Tab Submission'}

**Work ID:** ${targetWorkId}
**Title:** ${title}
**Instrument:** ${instrument}
**Submitted by:** ${attribution}

${comment ? `### Changes Made\n${comment}\n` : ''}
---
*Submitted via the Bluegrass Songbook tab editor. A workflow will add
provenance + the rebuilt index to this branch; review the diff and
MERGE to publish.*`

    const pr = await gh('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: type === 'tab-correction'
          ? `Tab correction: ${title} (${instrument})`
          : `Tab: ${title} (${instrument})`,
        head: branch,
        base: 'main',
        body: prBody,
      }),
    })
    if (!pr.ok) throw new Error(`PR create failed: ${pr.status} ${await pr.text()}`)
    const prJson = await pr.json()

    // Label it (PRs are issues for labeling purposes)
    await gh(`/issues/${prJson.number}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels: [type] }),
    })

    return new Response(
      JSON.stringify({ success: true, prNumber: prJson.number, prUrl: prJson.html_url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    // Detail stays server-side — error.message can carry GitHub API
    // response text, which callers have no business seeing.
    console.error('Error creating tab PR:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to create tab PR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
