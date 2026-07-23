// App shell: one slim persistent top band, one contextual bottom band, and the
// `pill` disclosure primitive. This is the single home for page chrome — views
// declare what they need via setTopBar()/setBottomBand() instead of rendering
// their own headers, collapsible bars, or dropdowns.
//
// The shell owns no app state and imports no app modules; main.js supplies nav
// items and callbacks at init so the dependency arrow points one way.

import { escapeHtml } from './utils.js';

let topbarEl = null;
let bottomBandEl = null;
let actionsEl = null;
let titleEl = null;
let backBtn = null;
let overflowMenu = null;
let openPopover = null; // only one pill/overflow popover open at a time

/**
 * Build the top band and bottom band once. `options.nav` is the list of
 * primary destinations; `options.onToggleTheme` keeps theme logic in main.js.
 * The existing #auth-section node is moved (not rebuilt) so supabase-auth
 * wiring keeps working untouched.
 */
export function initShell({ nav = [], onToggleTheme } = {}) {
    if (topbarEl) return;

    topbarEl = document.createElement('header');
    topbarEl.id = 'app-topbar';
    topbarEl.className = 'app-topbar';
    topbarEl.innerHTML = `
        <div class="topbar-left">
            <button id="topbar-back" class="topbar-back hidden" title="Back">&larr;</button>
            <a href="#" id="topbar-brand" class="topbar-brand" title="Home">
                <img src="images/new_bb_logo.svg" alt="Bluegrass Book">
            </a>
            <nav class="topbar-nav"></nav>
        </div>
        <div class="topbar-title" id="topbar-title"></div>
        <div class="topbar-actions" id="topbar-actions"></div>
        <div class="topbar-right">
            <button id="topbar-theme" class="topbar-icon-btn" title="Toggle theme">◐</button>
            <div class="topbar-overflow">
                <button id="topbar-overflow-btn" class="topbar-icon-btn" title="More">⋯</button>
                <div id="topbar-overflow-menu" class="pill-popover hidden"></div>
            </div>
        </div>
    `;
    document.body.prepend(topbarEl);

    bottomBandEl = document.createElement('div');
    bottomBandEl.id = 'app-bottomband';
    bottomBandEl.className = 'app-bottomband hidden';
    document.body.appendChild(bottomBandEl);

    actionsEl = topbarEl.querySelector('#topbar-actions');
    titleEl = topbarEl.querySelector('#topbar-title');
    backBtn = topbarEl.querySelector('#topbar-back');
    overflowMenu = topbarEl.querySelector('#topbar-overflow-menu');

    const navEl = topbarEl.querySelector('.topbar-nav');
    for (const item of nav) {
        const a = document.createElement('a');
        a.href = item.href;
        a.className = 'topbar-nav-link';
        a.dataset.nav = item.id;
        a.innerHTML = `<span class="topbar-nav-icon">${item.icon || ''}</span><span class="topbar-nav-label">${escapeHtml(item.label)}</span>`;
        if (item.onClick) {
            a.addEventListener('click', (e) => { e.preventDefault(); item.onClick(); });
        }
        navEl.appendChild(a);
    }

    // Auth UI moves into the top band; ids are load-bearing for supabase-auth.
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        topbarEl.querySelector('.topbar-right').insertBefore(
            authSection, topbarEl.querySelector('.topbar-overflow'));
    }

    topbarEl.querySelector('#topbar-theme').addEventListener('click', () => onToggleTheme?.());

    const overflowBtn = topbarEl.querySelector('#topbar-overflow-btn');
    overflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopover(overflowMenu, overflowBtn);
    });

    document.addEventListener('click', (e) => {
        if (openPopover && !openPopover.el.contains(e.target)) closePopover();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openPopover) closePopover();
    });
}

/**
 * Declare per-view chrome. Views call this from their open/render path.
 *   back:     { onClick } | null — shows/hides the back arrow
 *   title:    string | null — center title (mobile: replaces nav labels)
 *   actions:  [{ id, label, icon, title, onClick, primary }] — right-of-title buttons
 *   overflow: [{ id, label, onClick }] — items for the ⋯ menu (in addition to
 *             the persistent entries main.js seeds via setOverflowBase)
 *   navActive: id of the nav item to highlight
 */
export function setTopBar({ back = null, title = null, actions = [], overflow = [], navActive = null } = {}) {
    if (!topbarEl) return;
    closePopover();

    backBtn.classList.toggle('hidden', !back);
    backBtn.onclick = back ? back.onClick : null;
    // Lets CSS slim the band on pages that have a back button (song pages):
    // on phones, back + brand ARE the navigation there.
    topbarEl.classList.toggle('has-back', !!back);

    titleEl.textContent = title || '';
    titleEl.classList.toggle('hidden', !title);

    actionsEl.textContent = '';
    for (const action of actions) {
        if (action.el) { // pre-built element (e.g. a pill)
            actionsEl.appendChild(action.el);
            continue;
        }
        const btn = document.createElement('button');
        btn.className = 'topbar-action-btn' + (action.primary ? ' primary' : '');
        if (action.id) btn.id = action.id;
        if (action.title) btn.title = action.title;
        btn.innerHTML = action.icon
            ? `<span class="topbar-action-icon">${action.icon}</span><span class="topbar-action-label">${escapeHtml(action.label)}</span>`
            : escapeHtml(action.label);
        btn.addEventListener('click', action.onClick);
        actionsEl.appendChild(btn);
    }

    renderOverflow(overflow);

    topbarEl.querySelectorAll('.topbar-nav-link').forEach(a => {
        a.classList.toggle('active', a.dataset.nav === navActive);
    });
}

let overflowBase = [];

/** Persistent overflow entries (About, Patreon, Feedback, …) seeded once by main.js. */
export function setOverflowBase(items) {
    overflowBase = items;
    renderOverflow([]);
}

function renderOverflow(viewItems) {
    if (!overflowMenu) return;
    overflowMenu.textContent = '';
    const groups = viewItems.length ? [viewItems, overflowBase] : [overflowBase];
    groups.forEach((group, i) => {
        if (i > 0 && group.length) {
            const hr = document.createElement('div');
            hr.className = 'pill-popover-divider';
            overflowMenu.appendChild(hr);
        }
        for (const item of group) {
            const btn = document.createElement('button');
            btn.className = 'pill-popover-item';
            if (item.id) btn.id = item.id;
            btn.textContent = item.label;
            btn.addEventListener('click', () => { closePopover(); item.onClick(); });
            overflowMenu.appendChild(btn);
        }
    });
}

/**
 * Mount content into the bottom band (or hide it with null). The band is the
 * one home for practice/playback controls; body padding adjusts so content
 * never hides beneath it.
 */
export function setBottomBand(contentEl) {
    if (!bottomBandEl) return;
    bottomBandEl.textContent = '';
    if (contentEl) {
        bottomBandEl.appendChild(contentEl);
        bottomBandEl.classList.remove('hidden');
        document.body.classList.add('has-bottomband');
    } else {
        bottomBandEl.classList.add('hidden');
        document.body.classList.remove('has-bottomband');
    }
}

/**
 * Immersive (focus) mode: the top band slides away; the bottom band and
 * content remain. Replaces the old fullscreen-mode view fork.
 */
export function setImmersive(on) {
    document.body.classList.toggle('immersive', on);
}

export function isImmersive() {
    return document.body.classList.contains('immersive');
}

/**
 * The one disclosure primitive. Returns a root element suitable for
 * setTopBar actions ({el}) or inline mounting. Content is built lazily on
 * first open; only one popover is open at any time.
 *   pill('Key of G', (container, api) => { …render…, api.close() })
 */
export function pill(label, buildContent, { id, title, className } = {}) {
    const root = document.createElement('div');
    root.className = 'pill' + (className ? ` ${className}` : '');
    if (id) root.id = id;

    const btn = document.createElement('button');
    btn.className = 'pill-btn';
    if (title) btn.title = title;
    btn.innerHTML = `<span class="pill-label">${escapeHtml(label)}</span><span class="pill-caret">▾</span>`;

    const popover = document.createElement('div');
    popover.className = 'pill-popover hidden';

    let built = false;
    const api = {
        close: closePopover,
        setLabel(text) { btn.querySelector('.pill-label').textContent = text; },
        refresh() { popover.textContent = ''; buildContent(popover, api); },
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openPopover?.popover === popover) { closePopover(); return; }
        if (!built) { buildContent(popover, api); built = true; }
        togglePopover(popover, btn);
    });

    root.appendChild(btn);
    root.appendChild(popover);
    root.pillApi = api;
    return root;
}

function togglePopover(popover, anchorBtn) {
    if (openPopover?.popover === popover) { closePopover(); return; }
    closePopover();
    popover.classList.remove('hidden');
    anchorBtn.classList.add('open');
    // Keep the popover on-screen: flip to right-aligned when it would overflow.
    popover.classList.remove('align-right');
    const rect = popover.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) popover.classList.add('align-right');
    openPopover = { el: popover.parentElement, popover, anchorBtn };
}

function closePopover() {
    if (!openPopover) return;
    openPopover.popover.classList.add('hidden');
    openPopover.anchorBtn.classList.remove('open');
    openPopover = null;
}
