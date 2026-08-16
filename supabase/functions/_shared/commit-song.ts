// Shared GitHub helpers for the edge functions.
//
// SCOPE NOTE (phase 2b): this module no longer authors work.yaml for song
// submissions. `buildWorkYaml` / `commitPendingSong` are gone — a pending row
// now becomes files in works/ via repository_dispatch ->
// .github/workflows/process-pending.yml -> scripts/lib/works_writer.py, the
// repo's ONE writer. See ./pending-dispatch.ts.
//
// What remains here is the raw Contents-API plumbing plus the document
// attachment path, which phase 2d deletes along with the doc-upload feature.
//
// Imported by:
//   auto-commit-song   the live, user-triggered path
//   reconcile-pending  the hourly retry pass
//
// Deployment note: Supabase bundles relative imports, so BOTH functions must be
// redeployed after changing this file.

export const GITHUB_REPO = "Jollyhrothgar/Bluegrass-Songbook"

export interface Attachment {
  filename: string   // e.g., 'tab-reference.pdf'
  base64: string     // Base64-encoded file content
  label: string      // Human-readable label
}

export interface PendingSong {
  id: string
  replaces_id?: string | null
  title: string
  artist?: string | null
  composer?: string | null
  content?: string | null
  key?: string | null
  mode?: string | null
  tags?: Record<string, unknown>
  created_at?: string
  github_committed?: boolean
  /** Phase 3b: non-null means the dedup backstop refused to write this row. */
  dedup_hold?: string | null
  attachment?: Attachment
  create_placeholder?: boolean
  instrument?: string
}

export function buildPlaceholderWorkYaml(entry: PendingSong, docFilename: string, label: string): string {
  const today = new Date().toISOString().split('T')[0]
  const artist = entry.artist ? `"${entry.artist.replace(/"/g, '\\"')}"` : '""'

  const instrumentLine = entry.instrument ? `\n    instrument: ${entry.instrument}` : ''

  return `id: ${entry.id}
title: "${entry.title.replace(/"/g, '\\"')}"
artist: ${artist}
composers: []
default_key: ${entry.key || 'C'}
status: placeholder
tags: []
parts:
  - type: document
    format: pdf
    file: ${docFilename}${instrumentLine}
    label: "${label.replace(/"/g, '\\"')}"
    provenance:
      source: user-submission
      submitted_by: trusted-user
      submitted_at: '${today}'
`
}

const githubHeaders = (githubToken: string) => ({
  'Authorization': `token ${githubToken}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'Bluegrass-Songbook-Bot',
})

export async function getFileSha(path: string, githubToken: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`

  const response = await fetch(url, { headers: githubHeaders(githubToken) })

  if (response.ok) {
    const data = await response.json()
    return data.sha
  }

  return null
}

/**
 * Fetch and decode a text file from the repo. Returns null ONLY for a genuine
 * 404 -- any other error throws, so a transient GitHub failure can never be
 * mistaken for "the file isn't there" (which would let a caller overwrite a
 * real work.yaml with a placeholder).
 */
export async function getFileContent(path: string, githubToken: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`

  const response = await fetch(url, { headers: githubHeaders(githubToken) })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Failed to read ${path}: ${response.status}`)
  }

  const data = await response.json()
  return atob(data.content)
}

export async function commitFile(
  path: string,
  content: string,
  message: string,
  githubToken: string
): Promise<void> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`

  // Get current file SHA if it exists (needed for updates)
  const sha = await getFileSha(path, githubToken)

  // Base64 encode the content
  const encodedContent = btoa(unescape(encodeURIComponent(content)))

  const body: Record<string, string> = {
    message,
    content: encodedContent,
  }

  if (sha) {
    body.sha = sha
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...githubHeaders(githubToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Failed to commit ${path}:`, response.status, errorText)
    throw new Error(`Failed to commit ${path}: ${response.status}`)
  }
}

/**
 * Commit a binary file (already base64-encoded) to the repo
 */
export async function commitBinaryFile(
  path: string,
  base64Content: string,
  message: string,
  githubToken: string
): Promise<void> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`
  const sha = await getFileSha(path, githubToken)

  const body: Record<string, string> = {
    message,
    content: base64Content,
  }

  if (sha) {
    body.sha = sha
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...githubHeaders(githubToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Failed to commit binary ${path}:`, response.status, errorText)
    throw new Error(`Failed to commit binary ${path}: ${response.status}`)
  }
}

/**
 * Append a document part to an existing work.yaml
 */
export function appendDocumentPart(existingYaml: string, filename: string, label: string): string {
  const today = new Date().toISOString().split('T')[0]
  const partYaml = `  - type: document
    format: pdf
    file: ${filename}
    label: "${label.replace(/"/g, '\\"')}"
    provenance:
      source: user-submission
      submitted_by: trusted-user
      submitted_at: '${today}'`

  // If work.yaml has "parts: []", replace it
  if (existingYaml.includes('parts: []')) {
    return existingYaml.replace('parts: []', `parts:\n${partYaml}`)
  }

  // Otherwise append to existing parts
  return existingYaml.trimEnd() + '\n' + partYaml + '\n'
}

/**
 * Why a pending row cannot be committed at all, or null if it can.
 * Rows that fail this are not retryable: no amount of waiting supplies the
 * missing field, so the reconciler reports them for manual rescue instead of
 * hammering GitHub on every run.
 */
export function unretryableReason(entry: PendingSong): string | null {
  if (!entry.id) return 'missing id'
  if (!entry.title) return 'missing title'
  if (!entry.content) return 'missing content (doc-upload rows carry no retryable payload)'
  return null
}

/**
 * Commit a document attachment and wire it into work.yaml (creating a
 * placeholder work if the caller asked for one). Live path only: pending_songs
 * does not persist attachments, so this is never retryable.
 */
export async function commitAttachment(
  entry: PendingSong,
  githubToken: string
): Promise<{ binaryPath: string }> {
  const { filename, base64, label } = entry.attachment as Attachment
  const binaryPath = `works/${entry.id}/${filename}`
  const commitMessage = `Add document: ${label} for ${entry.id}\n\nSubmitted via trusted user flow`

  await commitBinaryFile(binaryPath, base64, commitMessage, githubToken)

  const workYamlPath = `works/${entry.id}/work.yaml`
  const existingYaml = await getFileContent(workYamlPath, githubToken)

  if (existingYaml !== null) {
    const updatedYaml = appendDocumentPart(existingYaml, filename, label)
    await commitFile(workYamlPath, updatedYaml, `Update work.yaml: add document part for ${entry.id}`, githubToken)
  } else if (entry.create_placeholder) {
    const newYaml = buildPlaceholderWorkYaml(entry, filename, label)
    await commitFile(workYamlPath, newYaml, `Add placeholder: ${entry.title}`, githubToken)
  }

  return { binaryPath }
}
