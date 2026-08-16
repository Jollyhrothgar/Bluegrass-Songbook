// Review queue — the reviewed residue of the contribution pipeline.
//
// Phase 2d of docs/plans/contribution-pipeline.md. Adding content is instant
// for everyone (2b/2c); DESTROYING content is not. The three destructive asks
// are queued instead:
//
//   delete          soft-delete a work (deleted_songs, via the delete_song RPC)
//   suppress        drop a work from the built index (curation/registry.yaml)
//   merge-redirect  fold a duplicate into another work, redirect the old URL
//
// Who can do what:
//   admin    keeps the instant path — admins ARE the reviewers, so making them
//            file a request against themselves would be pure ceremony
//   trusted  files a request; sees the queue; cannot decide
//   everyone else sees none of it
//
// Honesty about execution: approving a `delete` really deletes (the app owns
// deleted_songs). Approving a `suppress` or `merge-redirect` records the
// decision and prints the command a maintainer runs locally — both edit files
// in the repo, and nothing in CI is wired to do that from a table. The panel
// says so out loud rather than implying the work is done.
//
// The panel has three sections:
//   1. Waiting on you   pending review_requests (approve / reject)
//   2. Decided          the history, with any command still owed a local run
//   3. On hold          pending_songs rows the CI dedup backstop parked
//                       (`dedup_hold`) as likely duplicates. Nothing commits a
//                       held row until a human clears it: admins can "Release
//                       hold" (dedup_hold -> null; the reconciler re-dispatches
//                       it next pass) or "Reject" (delete the pending row).

import { escapeHtml } from './utils.js';

const PANEL_ID = 'review-queue-panel';

export const REVIEW_KINDS = {
    'delete': {
        label: 'Delete',
        blurb: 'Remove the song from the site',
        // the app can carry this one all the way out
        executable: true,
    },
    'suppress': {
        label: 'Suppress',
        blurb: 'Drop from the search index, keep the URL alive',
        executable: false,
    },
    'merge-redirect': {
        label: 'Merge + redirect',
        blurb: 'Fold into another work and redirect this URL',
        executable: false,
    },
};

// ============================================
// PURE LOGIC (unit-tested)
// ============================================

/**
 * Which delete affordance a viewer gets on a song page.
 * Admins keep the instant path; trusted users get to ask; nobody else sees it.
 */
export function deleteAffordance({ isAdmin = false, isTrusted = false } = {}) {
    if (isAdmin) return 'instant';
    if (isTrusted) return 'request';
    return 'none';
}

/** Whether a viewer may decide requests (approve/reject). Admins only. */
export function canReview({ isAdmin = false } = {}) {
    return !!isAdmin;
}

/** Whether a viewer may see the queue at all. */
export function canSeeQueue({ isAdmin = false, isTrusted = false } = {}) {
    return !!(isAdmin || isTrusted);
}

/**
 * Status as the panel reports it. A row whose kind cannot be executed by the
 * app is never "done" on approval — it is waiting on a maintainer's terminal,
 * and saying "approved" full stop would be a lie.
 */
export function deriveStatus(request) {
    const status = request?.status || 'pending';
    if (status !== 'approved') {
        return { status, label: status === 'rejected' ? 'Rejected' : 'Pending', needsLocalRun: false };
    }
    const executable = REVIEW_KINDS[request.kind]?.executable ?? false;
    return executable
        ? { status, label: 'Approved — done', needsLocalRun: false }
        : { status, label: 'Approved — run locally', needsLocalRun: true };
}

/**
 * The local command that actually carries out an approved request, or null
 * when the app already did it.
 */
export function localCommandFor(request) {
    if (!request) return null;
    const target = request.target_id;
    if (request.kind === 'suppress') {
        const reason = (request.reason || 'reviewed request').replace(/"/g, "'");
        return `./scripts/utility curate suppress ${target} --reason "${reason}"`;
    }
    if (request.kind === 'merge-redirect') {
        const into = request.payload?.redirect_to;
        if (!into) return null;
        const plan = JSON.stringify([{ canonical: into, merge: [target], tier: 'high' }]);
        return [
            `echo '${plan}' > /tmp/merge-plan.json`,
            'uv run python scripts/lib/merge_works.py /tmp/merge-plan.json --execute',
        ].join('\n');
    }
    return null;
}

/** Counts for the panel header. */
export function summarizeQueue(requests = []) {
    const summary = { total: requests.length, pending: 0, approved: 0, rejected: 0, awaitingLocalRun: 0 };
    for (const r of requests) {
        const { status, needsLocalRun } = deriveStatus(r);
        if (status in summary) summary[status] += 1;
        if (needsLocalRun) summary.awaitingLocalRun += 1;
    }
    return summary;
}

/** Pending first (oldest first), then everything else newest first. */
export function sortQueue(requests = []) {
    const time = (r) => Date.parse(r?.created_at || '') || 0;
    return [...requests].sort((a, b) => {
        const aPending = (a.status || 'pending') === 'pending';
        const bPending = (b.status || 'pending') === 'pending';
        if (aPending !== bPending) return aPending ? -1 : 1;
        return aPending ? time(a) - time(b) : time(b) - time(a);
    });
}

/** A pending_songs row is held iff the dedup backstop wrote a reason on it. */
export function isHeld(row) {
    return typeof row?.dedup_hold === 'string' && row.dedup_hold.trim().length > 0;
}

/**
 * Display shape for a held submission. The reason comes from CI, so treat a
 * blank one as "held, reason not recorded" rather than rendering an empty box —
 * the row is still blocked either way and the reviewer needs to see it.
 */
export function describeHold(row) {
    return {
        id: row?.id || '',
        title: row?.title || '(untitled submission)',
        artist: row?.artist || null,
        reason: isHeld(row) ? row.dedup_hold.trim() : 'held by the dedup backstop (no reason recorded)',
    };
}

/** Oldest first: a hold blocks a real person's submission, so age is the queue. */
export function sortHolds(rows = []) {
    const time = (r) => Date.parse(r?.created_at || '') || 0;
    return [...rows].filter(r => r && r.id).sort((a, b) => time(a) - time(b));
}

/**
 * Validate a request before it is filed. Returns an error string, or null.
 */
export function validateRequest({ kind, targetId, payload } = {}) {
    if (!REVIEW_KINDS[kind]) return `Unknown request kind: ${kind}`;
    if (!targetId) return 'Missing target song id';
    if (kind === 'merge-redirect') {
        const into = payload?.redirect_to;
        if (!into) return 'A merge-redirect needs the work it redirects to';
        if (into === targetId) return 'A work cannot redirect to itself';
    }
    return null;
}

// ============================================
// DATA
// ============================================

function client() {
    return window.SupabaseAuth?.supabase || null;
}

export async function fetchReviewRequests({ limit = 50 } = {}) {
    const supabase = client();
    if (!supabase) return { data: [], error: { message: 'Not connected to database' } };
    const { data, error } = await supabase
        .from('review_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    return { data: data || [], error };
}

/**
 * File a destructive request. Identity is the session's — the row's
 * requested_by must equal auth.uid() or RLS rejects it.
 */
export async function submitReviewRequest({ kind, targetId, payload = {}, reason = null }) {
    const invalid = validateRequest({ kind, targetId, payload });
    if (invalid) return { error: { message: invalid } };

    const supabase = client();
    if (!supabase) return { error: { message: 'Not connected to database' } };

    const user = window.SupabaseAuth?.getUser?.();
    if (!user?.id) return { error: { message: 'Not logged in' } };

    const { data, error } = await supabase
        .from('review_requests')
        .insert({
            kind,
            target_id: targetId,
            payload,
            reason,
            requested_by: user.id,
        })
        .select()
        .maybeSingle();
    return { data, error };
}

/**
 * Pending submissions parked by the CI dedup backstop.
 *
 * The `dedup_hold` column ships with the backstop; until that migration is
 * applied the select fails, so the caller gets the error and the panel shows a
 * quiet note instead of losing the whole queue.
 */
export async function fetchHeldSubmissions({ limit = 50 } = {}) {
    const supabase = client();
    if (!supabase) return { data: [], error: { message: 'Not connected to database' } };
    const { data, error } = await supabase
        .from('pending_songs')
        .select('id, title, artist, dedup_hold, created_at, created_by')
        .not('dedup_hold', 'is', null)
        .order('created_at', { ascending: true })
        .limit(limit);
    return { data: data || [], error };
}

/**
 * Clear the hold. The row goes back to looking like any other uncommitted
 * submission, so the hourly reconciler picks it up and dispatches it — this
 * function deliberately does NOT commit anything itself.
 */
export async function releaseHold(id) {
    const supabase = client();
    if (!supabase) return { error: { message: 'Not connected to database' } };
    const { data, error } = await supabase
        .from('pending_songs')
        .update({ dedup_hold: null })
        .eq('id', id)
        .select()
        .maybeSingle();
    return { data, error };
}

/** Reject a held submission outright: the pending row goes away. */
export async function rejectHeldSubmission(id) {
    const supabase = client();
    if (!supabase) return { error: { message: 'Not connected to database' } };
    const { error } = await supabase.from('pending_songs').delete().eq('id', id);
    return { error };
}

/** Approve or reject. RLS lets admins only past this point. */
export async function decideReviewRequest(id, status, note = null) {
    const supabase = client();
    if (!supabase) return { error: { message: 'Not connected to database' } };
    const patch = { status };
    if (note) patch.review_note = note;
    const { data, error } = await supabase
        .from('review_requests')
        .update(patch)
        .eq('id', id)
        .select()
        .maybeSingle();
    return { data, error };
}

// ============================================
// VIEW
// ============================================

let hooks = {};

/**
 * Wire host behaviours:
 *   isAdmin()          - current admin status
 *   isTrusted()        - current trusted status
 *   onDeleteExecuted(id) - an approved delete landed; refresh the corpus
 */
export function configureReviewQueue(options = {}) {
    hooks = options;
}

function panelEl() {
    return document.getElementById(PANEL_ID);
}

export function hideReviewQueue() {
    const panel = panelEl();
    if (!panel) return;
    panel.classList.add('hidden');
    panel.innerHTML = '';
}

/**
 * Fetch and render the queue into the Dungeon panel. No-op (and hidden) for
 * viewers who are neither trusted nor admin.
 */
export async function showReviewQueue() {
    const panel = panelEl();
    if (!panel) return;

    const isAdmin = !!hooks.isAdmin?.();
    const isTrusted = !!hooks.isTrusted?.();
    if (!canSeeQueue({ isAdmin, isTrusted })) {
        hideReviewQueue();
        return;
    }

    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="review-queue-loading">Loading review queue…</div>';

    const { data, error } = await fetchReviewRequests();
    if (error) {
        panel.innerHTML = `<div class="review-queue-error">Could not load the review queue: ${escapeHtml(error.message)}</div>`;
        return;
    }
    renderReviewQueue(panel, { requests: data, isAdmin });
}

/**
 * Render the queue. Pure-ish: everything it needs is passed in, so a test can
 * hand it a container and a fixture.
 */
export function renderReviewQueue(panel, { requests = [], isAdmin = false } = {}) {
    const sorted = sortQueue(requests);
    const summary = summarizeQueue(sorted);
    const reviewer = canReview({ isAdmin });

    const rows = sorted.map(r => renderRow(r, reviewer)).join('');

    panel.innerHTML = `
        <div class="review-queue">
            <div class="review-queue-header">
                <span class="review-queue-title">🗂️ Review queue</span>
                <span class="review-queue-counts">${summary.pending} pending · ${summary.total} total</span>
            </div>
            <p class="review-queue-note">
                Deletions, suppressions and merge-redirects are the only asks that still
                wait on a human — everything additive goes live on its own.
                ${reviewer
                    ? 'Approving a deletion removes the song right away. Suppress and merge-redirect edit files in the repo, so approving them records the decision and hands you the command to run locally — the app cannot do it for you.'
                    : 'An admin decides these. You can file a request and watch it here.'}
            </p>
            ${sorted.length
                ? `<ul class="review-queue-list">${rows}</ul>`
                : '<div class="review-queue-empty">Nothing waiting. The residue is small by design.</div>'}
        </div>
    `;

    if (!reviewer) return;
    panel.querySelectorAll('[data-review-action]').forEach(btn => {
        btn.addEventListener('click', () => handleDecision(panel, btn));
    });
}

function renderRow(request, reviewer) {
    const kind = REVIEW_KINDS[request.kind] || { label: request.kind, blurb: '' };
    const { status, label, needsLocalRun } = deriveStatus(request);
    const command = status === 'approved' ? localCommandFor(request) : null;
    const into = request.payload?.redirect_to;

    return `
        <li class="review-queue-item" data-status="${escapeHtml(status)}" data-id="${escapeHtml(request.id || '')}">
            <div class="review-item-head">
                <span class="review-item-kind">${escapeHtml(kind.label)}</span>
                <a class="review-item-target" href="#work/${encodeURIComponent(request.target_id)}">${escapeHtml(request.target_id)}</a>
                ${into ? `<span class="review-item-into">→ ${escapeHtml(into)}</span>` : ''}
                <span class="review-item-status">${escapeHtml(label)}</span>
            </div>
            <div class="review-item-blurb">${escapeHtml(kind.blurb)}</div>
            ${request.reason ? `<div class="review-item-reason">“${escapeHtml(request.reason)}”</div>` : ''}
            ${needsLocalRun && command
                ? `<div class="review-item-command">
                       <div class="review-item-command-label">Run this locally to finish it:</div>
                       <pre class="review-item-command-code">${escapeHtml(command)}</pre>
                   </div>`
                : ''}
            ${reviewer && status === 'pending'
                ? `<div class="review-item-actions">
                       <button class="review-action approve" data-review-action="approved">Approve</button>
                       <button class="review-action reject" data-review-action="rejected">Reject</button>
                   </div>`
                : ''}
        </li>
    `;
}

async function handleDecision(panel, btn) {
    const item = btn.closest('.review-queue-item');
    const id = item?.dataset.id;
    if (!id) return;

    const status = btn.dataset.reviewAction;
    const actions = item.querySelector('.review-item-actions');
    if (actions) actions.innerHTML = '<span class="review-item-working">Working…</span>';

    const request = (await fetchReviewRequests()).data.find(r => r.id === id);
    if (!request) {
        await showReviewQueue();
        return;
    }

    // Execute BEFORE recording approval: a row marked approved whose delete
    // failed is exactly the Live/Durable lie phase 2b spent its time removing.
    if (status === 'approved' && REVIEW_KINDS[request.kind]?.executable) {
        const { error } = await window.SupabaseAuth.deleteSong(request.target_id, request.reason || null);
        if (error) {
            alert(`Could not delete ${request.target_id}: ${error.message}`);
            await showReviewQueue();
            return;
        }
        hooks.onDeleteExecuted?.(request.target_id);
    }

    const { error } = await decideReviewRequest(id, status);
    if (error) alert(`Could not record the decision: ${error.message}`);
    await showReviewQueue();
}
