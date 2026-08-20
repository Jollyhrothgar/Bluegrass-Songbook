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
//   3. On hold          pending_songs rows CI parked (dedup backstop, or a
//                       write target that is suppressed / merged away)
//                       (`dedup_hold`) as likely duplicates. Nothing commits a
//                       held row until a human clears it: admins can "Release
//                       hold" (dedup_hold -> null; the reconciler re-dispatches
//                       it next pass) or "Reject" (delete the pending row).

import { escapeHtml } from './utils.js';
import { searchWorksForTab, tabResultsState } from './add-song-picker.js';

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

/**
 * A pending_songs row is held iff CI wrote a reason on it. `dedup_hold` is
 * the column, but not the only meaning any more: process_pending.py also
 * parks a row whose target work is suppressed or merged away, because that
 * refusal cannot change by waiting either. The reason string says which.
 */
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
        reason: isHeld(row) ? row.dedup_hold.trim() : 'held by CI (no reason recorded)',
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

/**
 * Suppression's only context for a reviewer is the reason box — unlike
 * delete (which has a confirm) or merge (which has a target), there is
 * nothing else on the row that explains the ask. Required, not optional.
 */
export function validateSuppressReason(reason) {
    if (!reason || !reason.trim()) {
        return 'A reason is required — it is the only context a reviewer gets before hiding the song from search.';
    }
    return null;
}

/** True when `id` names a song actually present in the corpus. */
export function targetExists(targetId, songs = []) {
    return (songs || []).some(s => s?.id === targetId);
}

/**
 * Validate a merge-redirect target as the request dialog builds it, before
 * the row is even filed. Stricter than `validateRequest`: a target that
 * isn't really in the corpus (stale id, hand-edited) is refused here
 * instead of failing later at insert or, worse, at the local merge script.
 */
export function validateMergeRedirectTarget({ sourceId, targetId, songs = [] } = {}) {
    if (!targetId) return 'Search for the song this should merge into.';
    if (targetId === sourceId) return 'A work cannot redirect to itself.';
    if (!targetExists(targetId, songs)) return 'That song was not found — pick one from the search results.';
    return null;
}

/** The merge-redirect payload shape `review_requests` expects. */
export function buildMergeRedirectPayload(targetId) {
    return { redirect_to: targetId };
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
 * Pending submissions CI parked: a suspected duplicate, or a write whose
 * target work is suppressed or merged away.
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
// REQUEST DIALOGS
// ============================================
//
// Two small modals, alongside "Request deletion" in the song overflow, that
// collect what `submitReviewRequest` needs and nothing more. Both follow
// `editor.js`'s `showDedupModal` shape (a DOM-built modal wrapped in a
// Promise, resolving to the answer or null on cancel/Escape) rather than a
// native `prompt()`, because the copy has to do real work — telling suppress
// apart from delete, and merge apart from arrangement.

/**
 * Trusted-user suppression ask. Resolves the trimmed reason, or null if the
 * user backed out.
 */
export function showSuppressRequestDialog(song) {
    return new Promise(resolve => {
        document.getElementById('suppress-request-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'suppress-request-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content review-request-modal-content">
                <div class="modal-header">
                    <h2>Request suppression</h2>
                    <button type="button" class="modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="review-request-explainer">
                        Suppressing <strong>${escapeHtml(song?.title || song?.id || 'this song')}</strong>
                        drops it from search but its URL keeps working — direct links still resolve.
                        Want it gone entirely instead? Use <strong>Request deletion</strong>.
                    </p>
                    <label for="suppress-request-reason">Why should it be suppressed? <span class="required">*</span></label>
                    <textarea id="suppress-request-reason" rows="3" placeholder="duplicate, low quality, wrong song…"></textarea>
                    <div class="modal-status error hidden" id="suppress-request-error"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="action-btn" id="suppress-request-cancel">Cancel</button>
                    <button type="button" class="action-btn primary" id="suppress-request-submit">Request suppression</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const textarea = modal.querySelector('#suppress-request-reason');
        const errorEl = modal.querySelector('#suppress-request-error');

        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey);
            modal.remove();
            resolve(value);
        };
        const onKey = (e) => { if (e.key === 'Escape') finish(null); };

        modal.querySelector('#suppress-request-submit').addEventListener('click', () => {
            const reason = textarea.value.trim();
            const invalid = validateSuppressReason(reason);
            if (invalid) {
                errorEl.textContent = invalid;
                errorEl.classList.remove('hidden');
                return;
            }
            finish(reason);
        });
        modal.querySelector('#suppress-request-cancel').addEventListener('click', () => finish(null));
        modal.querySelector('.modal-close').addEventListener('click', () => finish(null));
        modal.addEventListener('click', (e) => { if (e.target === modal) finish(null); });
        document.addEventListener('keydown', onKey);

        textarea.focus();
    });
}

/**
 * Trusted-user merge-redirect ask. Search reuses `searchWorksForTab` — the
 * same normalize+similarity pair the add-song picker's tab flow already
 * uses to find a work by title, so this dialog doesn't grow a second one.
 *
 * Resolves `{ targetId, targetTitle, reason }` (reason may be null — it's
 * optional here, unlike suppression), or null if the user backed out.
 */
export function showMergeRequestDialog(song, { songs = [], search = searchWorksForTab } = {}) {
    return new Promise(resolve => {
        document.getElementById('merge-request-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'merge-request-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content review-request-modal-content">
                <div class="modal-header">
                    <h2>Request merge</h2>
                    <button type="button" class="modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="review-request-explainer">
                        Folds <strong>${escapeHtml(song?.title || song?.id || 'this song')}</strong> into another
                        song and redirects its URL there. Use this for a true duplicate — a different
                        arrangement of the same song stays separate as an arrangement instead.
                    </p>
                    <label for="merge-target-search">Search for the song to merge into</label>
                    <input type="text" id="merge-target-search" placeholder="Song title…" autocomplete="off">
                    <ul class="merge-target-results" id="merge-target-results"></ul>
                    <div class="merge-target-preview hidden" id="merge-target-preview"></div>
                    <label for="merge-request-reason">Why should it merge? (optional)</label>
                    <textarea id="merge-request-reason" rows="2" placeholder="duplicate submission, same song different chart…"></textarea>
                    <div class="modal-status error hidden" id="merge-request-error"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="action-btn" id="merge-request-cancel">Cancel</button>
                    <button type="button" class="action-btn primary" id="merge-request-submit" disabled>Request merge</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const searchInput = modal.querySelector('#merge-target-search');
        const resultsEl = modal.querySelector('#merge-target-results');
        const previewEl = modal.querySelector('#merge-target-preview');
        const reasonEl = modal.querySelector('#merge-request-reason');
        const errorEl = modal.querySelector('#merge-request-error');
        const submitBtn = modal.querySelector('#merge-request-submit');

        const sourceId = song?.id;
        // Excluded up front so a self-match never even appears as a result —
        // validateMergeRedirectTarget is the backstop, not the first line.
        const candidates = (songs || []).filter(s => s?.id && s.id !== sourceId);
        let selected = null;

        const clearError = () => { errorEl.classList.add('hidden'); errorEl.textContent = ''; };

        const renderResults = () => {
            const query = searchInput.value.trim();
            if (!query) { resultsEl.innerHTML = ''; return; }
            const matches = search(query, candidates, 8);
            // Same corpus-loaded-vs-empty distinction as the tab picker's
            // renderTabResults (reused via tabResultsState, not rebuilt):
            // "No matching song" must not read as a searched-and-confirmed
            // result when the corpus never loaded in the first place.
            const state = tabResultsState(query, matches, (songs || []).length === 0);
            resultsEl.innerHTML = state.kind === 'matches'
                ? matches.map(s => `
                    <li>
                        <button type="button" class="merge-target-result"
                                data-target-id="${escapeHtml(s.id)}"
                                data-target-title="${escapeHtml(s.title || s.id)}">
                            <span class="merge-target-result-title">${escapeHtml(s.title || s.id)}</span>
                            ${s.artist ? `<span class="merge-target-result-artist">${escapeHtml(s.artist)}</span>` : ''}
                        </button>
                    </li>
                `).join('')
                : `<li class="merge-target-empty${state.kind === 'corpus-empty' ? ' merge-target-error' : ''}">${
                    state.kind === 'corpus-empty' ? escapeHtml(state.message) : 'No matching song.'
                }</li>`;
        };

        const selectTarget = (targetId, targetTitle) => {
            selected = { id: targetId, title: targetTitle };
            clearError();
            searchInput.value = targetTitle;
            resultsEl.innerHTML = '';
            previewEl.classList.remove('hidden');
            previewEl.innerHTML = `Redirect <strong>${escapeHtml(song?.title || sourceId)}</strong> &rarr; `
                + `<strong>${escapeHtml(targetTitle)}</strong> (this song's URL will forward)`;
            submitBtn.disabled = false;
        };

        searchInput.addEventListener('input', () => {
            if (selected) {
                selected = null;
                previewEl.classList.add('hidden');
                previewEl.innerHTML = '';
                submitBtn.disabled = true;
            }
            renderResults();
        });

        resultsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.merge-target-result');
            if (!btn) return;
            selectTarget(btn.dataset.targetId, btn.dataset.targetTitle);
        });

        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey);
            modal.remove();
            resolve(value);
        };
        const onKey = (e) => { if (e.key === 'Escape') finish(null); };

        submitBtn.addEventListener('click', () => {
            const invalid = validateMergeRedirectTarget({ sourceId, targetId: selected?.id, songs });
            if (invalid) {
                errorEl.textContent = invalid;
                errorEl.classList.remove('hidden');
                return;
            }
            finish({ targetId: selected.id, targetTitle: selected.title, reason: reasonEl.value.trim() || null });
        });
        modal.querySelector('#merge-request-cancel').addEventListener('click', () => finish(null));
        modal.querySelector('.modal-close').addEventListener('click', () => finish(null));
        modal.addEventListener('click', (e) => { if (e.target === modal) finish(null); });
        document.addEventListener('keydown', onKey);

        searchInput.focus();
    });
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

    // Two independent reads. A hold list that fails (the column ships with the
    // 3b backstop migration) must not take the request queue down with it, so
    // its error is carried into the render rather than thrown.
    const [requestsResult, holdsResult] = await Promise.all([
        fetchReviewRequests(),
        fetchHeldSubmissions(),
    ]);

    if (requestsResult.error) {
        panel.innerHTML = `<div class="review-queue-error">Could not load the review queue: ${escapeHtml(requestsResult.error.message)}</div>`;
        return;
    }
    renderReviewQueue(panel, {
        requests: requestsResult.data,
        holds: holdsResult.data,
        holdsError: holdsResult.error,
        isAdmin,
    });
}

/**
 * Render the queue. Pure-ish: everything it needs is passed in, so a test can
 * hand it a container and a fixture.
 */
export function renderReviewQueue(panel, {
    requests = [], holds = [], holdsError = null, isAdmin = false,
} = {}) {
    const sorted = sortQueue(requests);
    const summary = summarizeQueue(sorted);
    const reviewer = canReview({ isAdmin });

    const waiting = sorted.filter(r => (r.status || 'pending') === 'pending');
    const decided = sorted.filter(r => (r.status || 'pending') !== 'pending');
    const heldRows = sortHolds(holds);

    const openWork = waiting.length + heldRows.length;

    panel.innerHTML = `
        <div class="review-queue">
            <div class="review-queue-header">
                <span class="review-queue-title">🗂️ Review queue</span>
                <span class="review-queue-counts">${openWork} awaiting a decision</span>
            </div>
            <p class="review-queue-note">
                Deletions, suppressions and merge-redirects are the only asks that still
                wait on a human — everything additive goes live on its own.
                ${reviewer
                    ? 'Approving a deletion removes the song right away. Suppress and merge-redirect edit files in the repo, so approving them records the decision and hands you the command to run locally — the app cannot do it for you.'
                    : 'An admin decides these. You can file a request and watch it here.'}
            </p>

            <section class="review-queue-section" data-section="waiting">
                <h4 class="review-section-title">Waiting on you <span class="review-section-count">${waiting.length}</span></h4>
                ${waiting.length
                    ? `<ul class="review-queue-list">${waiting.map(r => renderRow(r, reviewer)).join('')}</ul>`
                    : '<div class="review-queue-empty">Nothing waiting. The residue is small by design.</div>'}
            </section>

            ${decided.length
                ? `<section class="review-queue-section" data-section="decided">
                       <h4 class="review-section-title">Decided <span class="review-section-count">${decided.length}</span></h4>
                       <ul class="review-queue-list">${decided.map(r => renderRow(r, reviewer)).join('')}</ul>
                   </section>`
                : ''}

            <section class="review-queue-section" data-section="holds">
                <h4 class="review-section-title">Held by CI <span class="review-section-count">${heldRows.length}</span></h4>
                <p class="review-section-note">
                    CI refused to write these — a suspected duplicate of something already
                    in the songbook, or a target work that has been suppressed or merged
                    away — and parked the row rather than retrying it hourly. Each one's
                    reason is below. Nothing commits them until
                    ${reviewer ? 'you decide' : 'an admin decides'}: releasing a hold sends it
                    back through the normal writer on the next reconciler pass (within the hour);
                    rejecting throws the submission away.
                </p>
                ${holdsError
                    ? `<div class="review-queue-error">Could not read the hold list: ${escapeHtml(holdsError.message)}</div>`
                    : heldRows.length
                        ? `<ul class="review-queue-list">${heldRows.map(r => renderHold(r, reviewer)).join('')}</ul>`
                        : '<div class="review-queue-empty">No held submissions.</div>'}
            </section>
        </div>
    `;

    if (!reviewer) return;
    panel.querySelectorAll('[data-review-action]').forEach(btn => {
        btn.addEventListener('click', () => handleDecision(panel, btn));
    });
    panel.querySelectorAll('[data-hold-action]').forEach(btn => {
        btn.addEventListener('click', () => handleHoldDecision(panel, btn));
    });
}

function renderHold(row, reviewer) {
    const hold = describeHold(row);
    return `
        <li class="review-queue-item review-hold-item" data-hold-id="${escapeHtml(hold.id)}">
            <div class="review-item-head">
                <span class="review-item-kind">Held</span>
                <a class="review-item-target" href="#work/${encodeURIComponent(hold.id)}">${escapeHtml(hold.id)}</a>
                <span class="review-item-status">needs a decision</span>
            </div>
            <div class="review-item-blurb">${escapeHtml(hold.title)}${hold.artist ? ` — ${escapeHtml(hold.artist)}` : ''}</div>
            <div class="review-item-reason">${escapeHtml(hold.reason)}</div>
            ${reviewer
                ? `<div class="review-item-actions">
                       <button class="review-action approve" data-hold-action="release">Release hold</button>
                       <button class="review-action reject" data-hold-action="reject">Reject</button>
                   </div>`
                : ''}
        </li>
    `;
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
                ${into ? `<span class="review-item-into">→ <a href="#work/${encodeURIComponent(into)}">${escapeHtml(into)}</a></span>` : ''}
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

async function handleHoldDecision(panel, btn) {
    const item = btn.closest('.review-hold-item');
    const id = item?.dataset.holdId;
    if (!id) return;

    const action = btn.dataset.holdAction;
    if (action === 'reject' && !confirm(
        `Reject the held submission "${id}"?\n\nThe pending row is deleted. Whoever sent it will not get it back.`
    )) return;

    const actions = item.querySelector('.review-item-actions');
    if (actions) actions.innerHTML = '<span class="review-item-working">Working…</span>';

    const { error } = action === 'release'
        ? await releaseHold(id)
        : await rejectHeldSubmission(id);

    if (error) {
        alert(`Could not ${action === 'release' ? 'release' : 'reject'} ${id}: ${error.message}`);
    } else if (action === 'release') {
        alert(`Hold cleared on "${id}".\n\nThe reconciler re-dispatches it on its next hourly pass — it is not committed yet.`);
    }
    await showReviewQueue();
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
