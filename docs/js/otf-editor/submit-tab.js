// Tab submission client — posts editor output to the create-tab-pr
// edge function, which commits the OTF FILE to a branch and opens a
// labeled pull request (Mike's design: the file itself travels, no
// issue-body size cap, native PR review, merge = approve).

const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

// Sanity cap only — the PR flow commits the file itself, so there is
// no issue-body limit (corpus max is ~180KB)
export const MAX_OTF_CHARS = 2_000_000;

/**
 * Compact-serialize an OTF for submission: strips view-cache fields
 * (like _partFile).
 */
export function serializeForSubmission(otf) {
    const clean = JSON.parse(JSON.stringify(otf));
    for (const k of Object.keys(clean)) {
        if (k.startsWith('_')) delete clean[k];
    }
    const compact = JSON.stringify(clean);
    if (compact.length > MAX_OTF_CHARS) {
        throw new Error(
            `This tab is implausibly large `
            + `(${Math.round(compact.length / 1024)}KB) — refusing to submit.`);
    }
    return compact;
}

/** Attribution string, same convention as song submissions. */
export function submitterAttribution() {
    const user = globalThis.window?.SupabaseAuth?.getUser?.();
    if (user) {
        return user.user_metadata?.full_name || user.email || 'Anonymous User';
    }
    return 'Rando Calrissian';
}

/**
 * Submit a tab correction or new tab.
 *
 * @param {Object} p
 * @param {'tab-correction'|'tab-submission'} p.type
 * @param {Object} p.otf - the document (serialized internally)
 * @param {string} p.title
 * @param {string} p.instrument - part instrument (correction target file)
 * @param {string} [p.workId] - required for corrections
 * @param {string} [p.comment] - required for corrections
 * @param {Function} [fetchImpl] - injectable for tests
 * @returns {Promise<{prNumber: number, prUrl: string}>}
 */
export async function submitTab(
    { type, otf, title, instrument, workId, comment },
    fetchImpl = globalThis.fetch,
) {
    const payload = {
        type,
        title,
        instrument,
        workId,
        comment,
        otf: serializeForSubmission(otf),
        submittedBy: submitterAttribution(),
    };
    const response = await fetchImpl(`${SUPABASE_URL}/functions/v1/create-tab-pr`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to submit tab');
    }
    return { prNumber: result.prNumber, prUrl: result.prUrl };
}
