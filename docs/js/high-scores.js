// High Scores (#174, in part) — the public contribution leaderboard.
//
// PRIVACY: this module has no privacy logic, on purpose. Everything that
// could identify a contributor is resolved inside `get_leaderboard()`
// (supabase/migrations/20260816120000_leaderboard.sql, `security definer`):
// the RPC returns { rank, display, total, songs, tabs, is_you } and NOTHING
// else — no email, no uuid, no auth metadata for anyone but the caller. There
// is nothing here to mask, because the identifiers never arrive. Do not add a
// second data source to this view that would reintroduce them.
//
// `display` is already the final string: Mike's opted-in real name, the
// caller's own email on their own row, or a salted bluegrass alias
// ("Lonesome Fiddler") for everyone else. Render it verbatim.
//
// The RPC is granted to `anon` as well as `authenticated`, so a signed-out
// visitor sees the whole board — aliased, with is_you false everywhere.
//
// `buildScoreRows` / `medalFor` / `breakdownText` are pure and exported for
// unit testing; everything else is rendering + Supabase I/O.

import { escapeHtml } from './utils.js';

/** Medal class for a rank, or null. Ranks are 1-based and may tie. */
export function medalFor(rank) {
    if (rank === 1) return 'gold';
    if (rank === 2) return 'silver';
    if (rank === 3) return 'bronze';
    return null;
}

/** "3 songs · 1 tab" — zero-count halves are dropped, never rendered as "0". */
export function breakdownText({ songs = 0, tabs = 0 } = {}) {
    const parts = [];
    if (songs > 0) parts.push(`${songs} song${songs === 1 ? '' : 's'}`);
    if (tabs > 0) parts.push(`${tabs} tab${tabs === 1 ? '' : 's'}`);
    return parts.join(' · ');
}

/**
 * Normalize `get_leaderboard()` rows into display-ready entries. Pure: no
 * DOM, no network. Rows arrive already ranked and ordered by the RPC; this
 * only fills in the presentation bits and defends against nulls.
 *
 * @param {Array<object>} rpcRows
 * @returns {Array<{rank:number, display:string, total:number, songs:number,
 *                  tabs:number, isYou:boolean, medal:string|null,
 *                  breakdown:string}>}
 */
export function buildScoreRows(rpcRows) {
    return (rpcRows || []).map(row => {
        const songs = Number(row.songs) || 0;
        const tabs = Number(row.tabs) || 0;
        const rank = Number(row.rank) || 0;
        return {
            rank,
            display: row.display || 'Anonymous Picker',
            total: Number(row.total) || 0,
            songs,
            tabs,
            isYou: row.is_you === true,
            medal: medalFor(rank),
            breakdown: breakdownText({ songs, tabs }),
        };
    });
}

// Module-level cache. Keyed by the caller's id (or null when signed out) so
// signing in/out refetches — `is_you` and the caller's own display depend on
// who is asking.
let cache = null;
let cacheUserId;
let fetchStarted = false;
let fetchFailed = false;

function resetCache() {
    cache = null;
    fetchStarted = false;
    fetchFailed = false;
}

async function fetchScores() {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) throw new Error('Supabase not initialized');
    const { data, error } = await supabase.rpc('get_leaderboard');
    if (error) throw error;
    return buildScoreRows(data || []);
}

function shellHtml(inner) {
    return `
        <div class="high-scores-view">
            <div class="high-scores-header">
                <h1 class="bounty-title">High Scores</h1>
                <p class="bounty-subtitle">The folks keeping this songbook filled in.</p>
            </div>
            ${inner}
        </div>
    `;
}

function loadingHtml() {
    return shellHtml('<p class="bounty-filter-hint">Counting up the contributions…</p>');
}

function errorHtml() {
    return shellHtml(`
        <div class="bounty-empty">
            <p>Couldn't load the high scores right now.</p>
            <p class="bounty-empty-sub">Try refreshing the page in a moment.</p>
        </div>
    `);
}

function emptyStateHtml() {
    return shellHtml(`
        <div class="bounty-empty">
            <p>No contributions yet — be the first.</p>
            <p class="bounty-empty-sub">Add a song, fix a chord, or drop in a tab and your name lands right here.</p>
        </div>
    `);
}

export function scoreRowHtml(entry) {
    const classes = ['high-score-row'];
    if (entry.medal) classes.push(`high-score-row-${entry.medal}`);
    if (entry.isYou) classes.push('high-score-row-you');
    return `
        <div class="${classes.join(' ')}">
            <div class="high-score-rank">${entry.rank}</div>
            <div class="high-score-main">
                <div class="high-score-name">${escapeHtml(entry.display)}${entry.isYou ? '<span class="high-score-you-badge">you</span>' : ''}</div>
                ${entry.breakdown ? `<div class="high-score-breakdown">${escapeHtml(entry.breakdown)}</div>` : ''}
            </div>
            <div class="high-score-total">${entry.total}</div>
        </div>
    `;
}

function listHtml(entries) {
    return shellHtml(`
        <div class="high-scores-list">
            ${entries.map(scoreRowHtml).join('')}
        </div>
        <p class="bounty-filter-hint high-scores-privacy-note">
            Contributors show up under a bluegrass handle unless they've asked
            to be named. Nobody's email or account ever leaves the server.
        </p>
    `);
}

/**
 * Render the High Scores view into `container`. Follows the bounty-view /
 * my-submissions pattern: the fetch is lazy and cached, and re-renders the
 * container once it lands — guarded on `container.isConnected` so a stale
 * in-flight fetch never paints over a view the user has navigated away from.
 */
export function renderHighScoresView(container) {
    const userId = window.SupabaseAuth?.getUser?.()?.id || null;

    if (cacheUserId !== userId) {
        cacheUserId = userId;
        resetCache();
    }

    if (!fetchStarted) {
        fetchStarted = true;
        fetchScores()
            .then(rows => {
                cache = rows;
                if (container.isConnected) renderHighScoresView(container);
            })
            .catch(err => {
                console.warn('Could not load high scores:', err);
                fetchFailed = true;
                cache = [];
                if (container.isConnected) renderHighScoresView(container);
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
        return;
    }

    container.innerHTML = listHtml(cache);
}
