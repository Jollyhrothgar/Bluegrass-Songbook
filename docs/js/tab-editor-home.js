// The tab editor's front door (`/tab-editor/`, G15c).
//
// An empty state, nothing more: three ways to reach the editor that already
// exists, and a line about where your files live. It has no renderer, player
// or editor code of its own. Every choice ends on the existing `#new-tab`
// page: Open goes through pwa.js (parse, park as a draft, route), Start goes
// straight to `#new-tab?title=&instrument=`, and My tabs reuses drafts-view's
// rows (and their Open / Delete handling).
//
// The generated page at /tab-editor/ (scripts/lib/build_song_pages.py) ships
// this page's heading and privacy line already in the results panel, so a
// crawler and a reader see the same words; keep them in step (a pytest
// reads this file for both strings).

import { escapeAttr, escapeHtml } from './utils.js';
import { getDraftStore } from './drafts.js';
import { draftRowHtml, attachDraftActions } from './drafts-view.js';
import { chooseTabFile } from './pwa.js';
import { TARGET_PRESETS } from './otf-editor/create-tab-entry.js';
import { track as trackEvent } from './analytics.js';

/** How many tabs the front door lists before "All my tabs". */
export const HOME_DRAFTS = 5;

/** The tab the tour uses; the example link opens it. */
export const EXAMPLE_TAB_HREF = '/#work/foggy-mountain-breakdown/banjo-tab';

const LABELS = {
    'banjo': 'Banjo', 'guitar': 'Guitar', 'mandolin': 'Mandolin', 'fiddle': 'Fiddle',
    'dobro': 'Dobro', 'bass': 'Bass', 'tenor-banjo': 'Tenor banjo',
};

/** What "Start a new tab" offers: the instruments `#new-tab?instrument=` understands. */
export const INSTRUMENT_CHOICES = Object.keys(TARGET_PRESETS)
    .map(value => ({ value, label: LABELS[value] || value }));

/** `#new-tab` plus whatever title and instrument were filled in. */
export function newTabHash({ title = '', instrument = '' } = {}) {
    const params = new URLSearchParams();
    if (title.trim()) params.set('title', title.trim());
    if (instrument) params.set('instrument', instrument);
    const query = params.toString();
    return query ? `#new-tab?${query}` : '#new-tab';
}

function myTabsHtml(drafts, now) {
    const body = drafts.length
        ? `<div class="drafts-list">${drafts.map(d => draftRowHtml(d, now)).join('')}</div>`
        : '<p class="tab-home-none">No tabs yet.</p>';
    return `
        <section class="tab-home-mytabs">
            <h2>My tabs</h2>
            ${body}
            <p class="tab-home-all"><a href="#drafts">All my tabs</a></p>
        </section>
    `;
}

export function tabEditorHomeHtml(drafts, now = Date.now()) {
    const options = INSTRUMENT_CHOICES.map(({ value, label }) =>
        `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join('');
    return `
        <div class="tab-home drafts-view">
            <div class="drafts-header">
                <h1 class="bounty-title">Free tab editor for TablEdit (.tef) files</h1>
                <p class="bounty-subtitle">Open a tab file or start a new tab. It's free
                   and needs no account.</p>
            </div>
            <div class="tab-home-cards">
                <section class="tab-home-card tab-home-open">
                    <h2>Open a tab file</h2>
                    <p>A TablEdit <code>.tef</code> or a <code>.otf.json</code>. You can also
                       drop one anywhere on this page.</p>
                    <button type="button" class="qc-toggle-btn tab-open-file">Open a tab file…</button>
                </section>
                <form class="tab-home-card tab-home-new">
                    <h2>Start a new tab</h2>
                    <label>Title (optional)
                        <input type="text" class="tab-home-title" maxlength="200" autocomplete="off">
                    </label>
                    <label>Instrument
                        <select class="tab-home-instrument">${options}</select>
                    </label>
                    <button type="submit" class="qc-toggle-btn">Start a new tab</button>
                </form>
            </div>
            ${myTabsHtml(drafts, now)}
            <p class="tab-home-privacy">Your tabs stay on this device. Nothing is uploaded unless you submit it to the book.</p>
            <p class="tab-home-example"><a href="${escapeAttr(EXAMPLE_TAB_HREF)}">See an example tab</a></p>
        </div>
    `;
}

/**
 * Render the front door into `container`.
 *
 * @param {HTMLElement} container
 * @param {Object} [options] - all injected in tests
 * @param {Object} [options.store] - draft store
 * @param {Function} [options.navigate] - (hash) => void
 * @param {Function} [options.chooseFile] - ({source}) => void; the shared picker
 * @param {Function} [options.confirmDelete]
 * @param {Function} [options.track]
 */
export async function renderTabEditorHome(container, {
    store = getDraftStore(),
    navigate = (hash) => {
        // In place, like the app's own `#…` links on a path that isn't `/`:
        // location.hash would land on /tab-editor/#new-tab, and a router step
        // later rewrites it. Same URL either way, but this is one step.
        history.pushState(null, '', `/${hash}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    chooseFile = chooseTabFile,
    confirmDelete = null,
    now = () => Date.now(),
    track = trackEvent,
} = {}) {
    if (!container) return;
    track('tab_editor_home');

    let drafts = [];
    try {
        drafts = (await store.list()).slice(0, HOME_DRAFTS);
    } catch {
        // Private browsing can block IndexedDB; the front door still works.
    }
    // The reader may have gone elsewhere while IndexedDB answered.
    if (!container.isConnected && container.ownerDocument) return;

    const draw = (list) => {
        container.innerHTML = tabEditorHomeHtml(list, now());
        const root = container.querySelector('.tab-home');
        root.querySelector('.tab-open-file').addEventListener('click',
            () => chooseFile({ source: 'front-door' }));
        root.querySelector('.tab-home-new').addEventListener('submit', (e) => {
            e.preventDefault();
            navigate(newTabHash({
                title: root.querySelector('.tab-home-title').value,
                instrument: root.querySelector('.tab-home-instrument').value,
            }));
        });
        attachDraftActions(root, {
            drafts: list, store, navigate, confirmDelete,
            onEmpty: () => draw([]),
        });
    };
    draw(drafts);
}
