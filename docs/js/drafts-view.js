// The Drafts list (`#drafts`) — the one new surface the PWA adds.
//
// Deliberately plain: title, instrument, when it was last touched, Open and
// Delete. It renders inside the app shell like every other non-song view
// (main.js routes it into #results, same as High Scores), and it works
// offline because its whole data source is IndexedDB.
//
// Markup builders are pure and exported so the tests can assert on strings
// rather than driving a DOM.

import { escapeAttr, escapeHtml } from './utils.js';
import { draftOpenHash, getDraftStore } from './drafts.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now" / "12 min ago" / "3 hours ago" / a date. Pure. */
export function formatUpdated(iso, now = Date.now()) {
    const then = Date.parse(iso || '');
    if (!Number.isFinite(then)) return 'unknown';
    const delta = now - then;
    if (delta < 0) return 'just now';
    if (delta < MINUTE) return 'just now';
    if (delta < HOUR) {
        const mins = Math.round(delta / MINUTE);
        return `${mins} min ago`;
    }
    if (delta < DAY) {
        const hours = Math.round(delta / HOUR);
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    if (delta < 7 * DAY) {
        const days = Math.round(delta / DAY);
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }
    return new Date(then).toLocaleDateString();
}

/** Where this draft came from, in one phrase. Pure. */
export function draftContextText(draft) {
    if (draft?.workId && draft?.takeRef) return `correction to ${draft.workId}`;
    if (draft?.workId) return `new take for ${draft.workId}`;
    return 'new song';
}

export function draftRowHtml(draft, now = Date.now()) {
    return `
        <div class="draft-row" data-draft-id="${escapeAttr(draft.id)}">
            <div class="draft-row-main">
                <div class="draft-row-title">${escapeHtml(draft.title || 'Untitled')}</div>
                <div class="draft-row-meta">${escapeHtml(draft.instrument || 'unknown')}
                    · ${escapeHtml(draftContextText(draft))}
                    · ${escapeHtml(formatUpdated(draft.updatedAt, now))}</div>
            </div>
            <div class="draft-row-actions">
                <button type="button" class="qc-toggle-btn draft-open"
                        data-draft-id="${escapeAttr(draft.id)}">Open</button>
                <button type="button" class="qc-toggle-btn draft-delete"
                        data-draft-id="${escapeAttr(draft.id)}">Delete</button>
            </div>
        </div>
    `;
}

function shellHtml(inner) {
    return `
        <div class="drafts-view">
            <div class="drafts-header">
                <h1 class="bounty-title">Drafts</h1>
                <p class="bounty-subtitle">Tabs you've started. They live on this
                   device and survive going offline.</p>
            </div>
            ${inner}
        </div>
    `;
}

export function draftsViewHtml(drafts, now = Date.now()) {
    if (!drafts.length) {
        return shellHtml(`
            <div class="bounty-empty">
                <p>No drafts yet.</p>
                <p class="bounty-empty-sub">Start a tab and it saves itself here as
                   you type — no button to remember.</p>
            </div>
        `);
    }
    return shellHtml(`
        <div class="drafts-list">${drafts.map(d => draftRowHtml(d, now)).join('')}</div>
        <p class="bounty-filter-hint">Drafts are stored in this browser only.
           Submitting a tab clears its draft.</p>
    `);
}

/**
 * Render the Drafts view into `container`.
 *
 * @param {HTMLElement} container
 * @param {Object} [options]
 * @param {Object} [options.store] - draft store (injected in tests)
 * @param {Function} [options.navigate] - (hash) => void
 * @param {Function} [options.confirmDelete] - (draft) => boolean|Promise<boolean>.
 *   Default: an INLINE confirm drawn into the row (never `window.confirm` —
 *   a native dialog is outside the DOM, so nothing can drive it: not a
 *   Playwright run, not a screen reader's own review cursor, not the theme).
 */
export async function renderDraftsView(container, {
    store = getDraftStore(),
    navigate = (hash) => { globalThis.location.hash = hash; },
    confirmDelete = null,
    now = () => Date.now(),
} = {}) {
    if (!container) return;
    container.innerHTML = shellHtml('<p class="bounty-filter-hint">Loading drafts…</p>');

    let drafts = [];
    try {
        drafts = await store.list();
    } catch (err) {
        container.innerHTML = shellHtml(`
            <div class="bounty-empty">
                <p>Couldn't open the drafts store.</p>
                <p class="bounty-empty-sub">Private browsing blocks it in some
                   browsers; drafts then last only for the session.</p>
            </div>
        `);
        return;
    }
    // The user may have navigated on while we awaited IndexedDB.
    if (!container.isConnected && container.ownerDocument) return;

    container.innerHTML = draftsViewHtml(drafts, now());

    container.addEventListener('click', async (e) => {
        const open = e.target.closest?.('.draft-open');
        if (open) {
            const draft = drafts.find(d => d.id === open.dataset.draftId);
            if (draft) navigate(draftOpenHash(draft));
            return;
        }
        const del = e.target.closest?.('.draft-delete');
        if (del) {
            const draft = drafts.find(d => d.id === del.dataset.draftId);
            if (!draft) return;
            const ok = confirmDelete
                ? await confirmDelete(draft)
                : await askInRow(del.closest('.draft-row'));
            if (!ok) return;
            await store.remove(draft.id);
            drafts = drafts.filter(d => d.id !== draft.id);
            [...container.querySelectorAll('.draft-row')]
                .find(el => el.dataset.draftId === draft.id)?.remove();
            if (!drafts.length) container.innerHTML = draftsViewHtml([], now());
        }
    });
}

/**
 * The inline "Delete this draft?" strip, drawn into the row it is about.
 *
 * Resolves true/false when the reader answers, and false if the row goes
 * away underneath it. Only one question stands at a time: clicking Delete
 * again re-focuses the standing one instead of stacking a second.
 */
export function askInRow(row) {
    if (!row) return Promise.resolve(false);
    const standing = row.querySelector('.draft-confirm');
    if (standing) {
        standing.querySelector('.draft-confirm-yes')?.focus();
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const strip = document.createElement('div');
        strip.className = 'draft-confirm';
        strip.setAttribute('role', 'alertdialog');
        strip.setAttribute('aria-label', 'Delete this draft?');
        strip.innerHTML = `
            <span class="draft-confirm-question">Delete this draft?</span>
            <button type="button" class="qc-toggle-btn draft-confirm-yes">Delete</button>
            <button type="button" class="qc-toggle-btn draft-confirm-no">Keep</button>
        `;
        const answer = (value) => {
            strip.remove();
            resolve(value);
        };
        strip.querySelector('.draft-confirm-yes')
            .addEventListener('click', (e) => { e.stopPropagation(); answer(true); });
        strip.querySelector('.draft-confirm-no')
            .addEventListener('click', (e) => { e.stopPropagation(); answer(false); });
        strip.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); answer(false); }
        });
        row.appendChild(strip);
        strip.querySelector('.draft-confirm-yes').focus();
    });
}
