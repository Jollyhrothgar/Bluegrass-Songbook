// Shared GitHub commit logic for pending_songs -> works/.
//
// Imported by two functions:
//   auto-commit-song   the live, user-triggered path (trusted user saves a song)
//   reconcile-pending  the hourly retry pass for rows the live path failed to commit
//
// This is deliberately the ONLY place that knows how a pending row becomes
// files in the repo. The two callers differ only in how they authenticate and
// what they do afterwards, so the commit itself must not fork.
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
  attachment?: Attachment
  create_placeholder?: boolean
  instrument?: string
}

export function buildWorkYaml(entry: PendingSong): string {
  const composers = entry.composer ? `[${entry.composer}]` : '[]'
  const today = new Date().toISOString().split('T')[0]

  return `id: ${entry.id}
title: "${entry.title.replace(/"/g, '\\"')}"
artist: "${(entry.artist || '').replace(/"/g, '\\"')}"
composers: ${composers}
default_key: ${entry.key || 'C'}
tags: []
parts:
  - type: lead-sheet
    format: chordpro
    file: lead-sheet.pro
    default: true
    provenance:
      source: trusted-user
      imported_at: '${today}'
`
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
 * Commit a pending lead-sheet row to works/{id}/. Idempotent: re-running
 * overwrites the same two files with the same content, so a retry after a
 * partial failure is safe.
 */
export async function commitPendingSong(
  entry: PendingSong,
  githubToken: string
): Promise<{ workPath: string; proPath: string }> {
  const reason = unretryableReason(entry)
  if (reason) {
    throw new Error(`Cannot commit ${entry.id || '(no id)'}: ${reason}`)
  }

  const workYaml = buildWorkYaml(entry)
  const leadSheetPro = entry.content as string

  const action = entry.replaces_id ? 'Update' : 'Add'
  const commitMessage = `${action} ${entry.title}${entry.artist ? ` by ${entry.artist}` : ''}\n\nSubmitted via trusted user flow`

  const workPath = `works/${entry.id}/work.yaml`
  const proPath = `works/${entry.id}/lead-sheet.pro`

  await commitFile(workPath, workYaml, commitMessage, githubToken)
  await commitFile(proPath, leadSheetPro, commitMessage, githubToken)

  return { workPath, proPath }
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
