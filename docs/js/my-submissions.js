// My Submissions (Phase 4a, #227 / #207) — a logged-in user's own
// contribution history: what they submitted, what kind, when, and where it
// stands today.
//
// Data model (see docs/plans/contribution-pipeline.md #Phase 4a):
//   submission_log  — one row per write attempt (RLS: `user_id = auth.uid()`
//                      already lets a user read their own rows — no
//                      migration needed; see the note in supabase/CLAUDE.md
//                      history / this feature's report).
//   pending_songs   — the Live overlay for additive/correction writes.
//                      World-readable; filtered here to `created_by = user`.
//
// Status is derived, not stored — three cases, checked in this order:
//   1. A matching pending_songs row exists and is NOT yet committed → Live
//      (it's in the browser overlay for everyone, durable commit pending).
//   2. A matching pending_songs row IS committed, OR the target id already
//      resolves in the corpus (canon/archive, not an overlay row) → In the
//      songbook.
//   3. Neither — a log-only action (a report, a request still awaiting
//      review, a PR not yet merged) → Requested/Reported.
//
// `deriveSubmissionStatus` and `buildSubmissionRows` are pure and exported
// for unit testing; everything else here is rendering + Supabase I/O.

import { allSongs } from './state.js';
import { escapeHtml } from './utils.js';
import { openAddSongPicker } from './add-song-picker.js';

/** Human label for each submission_log.action value seen in the wild. */
export const ACTION_LABELS = {
    song_submit: 'New song',
    song_correction: 'Correction',
    placeholder_request: 'Song request',
    song_request: 'Song request',
    flag_report: 'Issue report',
    tab_submit: 'New tab',
    tab_correction: 'Tab correction',
    doc_upload: 'Document upload',
};

export const STATUS_LABELS = {
    live: 'Live',
    in_songbook: 'In the songbook',
    requested: 'Requested/Reported',
};

/**
 * Pure status derivation for one submission_log row, given the matching
 * pending_songs row (if any, already filtered to this user) and whether the
 * target id resolves to a real (non-overlay) corpus row.
 *
 * @param {{ pendingRow: object|null, workExists: boolean }} args
 * @returns {'live'|'in_songbook'|'requested'}
 */
export function deriveSubmissionStatus({ pendingRow, workExists }) {
    if (pendingRow) {
        return pendingRow.github_committed ? 'in_songbook' : 'live';
    }
    return workExists ? 'in_songbook' : 'requested';
}

/**
 * Combine submission_log rows with the user's own pending_songs rows and a
 * set of "real" corpus ids (canon/archive — NOT the pending overlay) into
 * display-ready entries. Pure: no DOM, no network.
 *
 * @param {Array<object>} logRows - submission_log rows for this user
 * @param {Array<object>} pendingRows - pending_songs rows created_by this user
 * @param {Set<string>} corpusIds - ids that resolve to a durable work
 * @returns {Array<object>}
 */
export function buildSubmissionRows(logRows, pendingRows, corpusIds) {
    const pendingById = new Map((pendingRows || []).map(p => [p.id, p]));
    const ids = corpusIds || new Set();

    return (logRows || []).map(row => {
        const pendingRow = row.target_id ? pendingById.get(row.target_id) || null : null;
        const workExists = !!row.target_id && ids.has(row.target_id);
        const status = deriveSubmissionStatus({ pendingRow, workExists });

        const title = pendingRow?.title || row.metadata?.title || row.target_id || 'Untitled';
        const artist = pendingRow?.artist || row.metadata?.artist || '';

        return {
            id: row.id,
            action: row.action,
            kind: ACTION_LABELS[row.action] || row.action,
            targetId: row.target_id || null,
            title,
            artist,
            status,
            statusLabel: STATUS_LABELS[status] || status,
            createdAt: row.created_at,
            // Only Live/In-the-songbook rows have somewhere to click through
            // to — a log-only report/request has no work page yet.
            linkable: status !== 'requested' && !!row.target_id,
        };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Corpus ids that are durable (canon/archive), excluding the pending overlay. */
function realCorpusIds() {
    const ids = new Set();
    for (const song of allSongs) {
        if (song.source === 'pending') continue;
        ids.add(song.id);
    }
    return ids;
}

function formatWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Module-level cache, keyed by user id so switching accounts refetches.
let cache = null;
let cacheUserId = null;
let fetchStarted = false;
let fetchFailed = false;

function resetCache() {
    cache = null;
    fetchStarted = false;
    fetchFailed = false;
}

async function fetchSubmissions(user) {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) return [];

    const [logResult, pendingResult] = await Promise.all([
        supabase.from('submission_log').select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
        supabase.from('pending_songs').select('*').eq('created_by', user.id),
    ]);

    if (logResult.error) throw logResult.error;
    const pendingRows = pendingResult.error ? [] : (pendingResult.data || []);

    return buildSubmissionRows(logResult.data || [], pendingRows, realCorpusIds());
}

function signedOutHtml() {
    return `
        <div class="my-submissions-view">
            <div class="bounty-empty my-submissions-empty">
                <p>Sign in to see your submissions.</p>
                <p class="bounty-empty-sub">Everything you've added, corrected, requested, or reported lives here — even the parts that aren't public to everyone yet.</p>
                <button class="bounty-cta-btn" id="my-submissions-sign-in-btn">Sign In</button>
            </div>
        </div>
    `;
}

function loadingHtml() {
    return `
        <div class="my-submissions-view">
            <div class="my-submissions-header">
                <h1 class="bounty-title">My Submissions</h1>
            </div>
            <p class="bounty-filter-hint">Loading your submissions…</p>
        </div>
    `;
}

function errorHtml() {
    return `
        <div class="my-submissions-view">
            <div class="my-submissions-header">
                <h1 class="bounty-title">My Submissions</h1>
            </div>
            <div class="bounty-empty">
                <p>Couldn't load your submissions right now.</p>
                <p class="bounty-empty-sub">Try refreshing the page in a moment.</p>
            </div>
        </div>
    `;
}

function emptyStateHtml() {
    return `
        <div class="my-submissions-view">
            <div class="my-submissions-header">
                <h1 class="bounty-title">My Submissions</h1>
            </div>
            <div class="bounty-empty">
                <p>You haven't submitted anything yet.</p>
                <p class="bounty-empty-sub">Add a song, request one, or fix a chord — everything you contribute shows up here.</p>
                <button class="bounty-cta-btn" id="my-submissions-add-btn">Add a Song</button>
            </div>
        </div>
    `;
}

function statusClass(status) {
    return `my-submission-status my-submission-status-${status.replace(/_/g, '-')}`;
}

function submissionRowHtml(entry) {
    const meta = [entry.kind, formatWhen(entry.createdAt)].filter(Boolean).join(' · ');
    const inner = `
        <div class="my-submission-main">
            <div class="my-submission-title">${escapeHtml(entry.title)}</div>
            ${entry.artist ? `<div class="my-submission-artist">${escapeHtml(entry.artist)}</div>` : ''}
            <div class="my-submission-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="${statusClass(entry.status)}">${escapeHtml(entry.statusLabel)}</div>
    `;
    return entry.linkable
        ? `<a href="#work/${escapeHtml(entry.targetId)}" class="my-submission-row">${inner}</a>`
        : `<div class="my-submission-row my-submission-row-static">${inner}</div>`;
}

function listHtml(entries) {
    return `
        <div class="my-submissions-view">
            <div class="my-submissions-header">
                <h1 class="bounty-title">My Submissions</h1>
                <p class="bounty-subtitle">Everything you've contributed, and where it stands.</p>
            </div>
            <div class="my-submissions-list">
                ${entries.map(submissionRowHtml).join('')}
            </div>
        </div>
    `;
}

/**
 * Render the My Submissions view into `container`. Follows the bounty-view
 * pattern: fetch is lazy and cached, re-rendering the container once the
 * fetch lands (guarded on `container.isConnected` so a stale in-flight
 * fetch never overwrites a view the user has since navigated away from).
 */
export function renderMySubmissionsView(container) {
    const user = window.SupabaseAuth?.getUser?.();

    if (!user) {
        resetCache();
        container.innerHTML = signedOutHtml();
        container.querySelector('#my-submissions-sign-in-btn')?.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('open-auth-modal'));
        });
        return;
    }

    if (cacheUserId !== user.id) {
        cacheUserId = user.id;
        resetCache();
    }

    if (!fetchStarted) {
        fetchStarted = true;
        fetchSubmissions(user)
            .then(rows => {
                cache = rows;
                if (container.isConnected) renderMySubmissionsView(container);
            })
            .catch(err => {
                console.warn('Could not load submissions:', err);
                fetchFailed = true;
                cache = [];
                if (container.isConnected) renderMySubmissionsView(container);
            });
    }

    if (cache === null) {
        container.innerHTML = loadingHtml();
        return;
    }

    if (fetchFailed) {
        container.innerHTML = errorHtml();
        return;
    }

    if (!cache.length) {
        container.innerHTML = emptyStateHtml();
        container.querySelector('#my-submissions-add-btn')?.addEventListener('click', () => {
            openAddSongPicker();
        });
        return;
    }

    container.innerHTML = listHtml(cache);
}
