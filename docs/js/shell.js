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
let bannerEl = null;
let actionsEl = null;
let titleEl = null;
let backBtn = null;
let overflowMenu = null;
let navEl = null;
let navItems = [];
let openPopover = null; // only one pill/overflow popover open at a time

/**
 * Build the top band and bottom band once. `options.nav` is the list of
 * primary destinations; `options.onToggleTheme` keeps theme logic in main.js.
 * The existing #auth-section node is moved (not rebuilt) so supabase-auth
 * wiring keeps working untouched.
 */
export function initShell({ nav = [], onToggleTheme, onReportBug } = {}) {
    if (topbarEl) return;

    topbarEl = document.createElement('header');
    topbarEl.id = 'app-topbar';
    topbarEl.className = 'app-topbar';
    topbarEl.innerHTML = `
        <div class="topbar-left">
            <button id="topbar-back" class="topbar-back hidden" title="Back">&larr;</button>
            <a href="#" id="topbar-brand" class="topbar-brand" title="Home">
                <img src="images/new_bb_logo.svg" alt="Bluegrass Book">
                <img src="images/earl_zombie_face.png" class="brand-dungeon-face" alt="" aria-hidden="true">
            </a>
            <nav class="topbar-nav"></nav>
        </div>
        <div class="topbar-title" id="topbar-title"></div>
        <div class="topbar-actions" id="topbar-actions"></div>
        <div class="topbar-right">
            <button id="topbar-bug" class="topbar-icon-btn" title="Report a bug">🐛</button>
            <button id="topbar-theme" class="topbar-icon-btn" title="Toggle theme">◐</button>
            <div class="topbar-overflow">
                <button id="topbar-overflow-btn" class="topbar-icon-btn" title="More">⋯</button>
                <div id="topbar-overflow-menu" class="pill-popover hidden"></div>
            </div>
        </div>
    `;
    document.body.prepend(topbarEl);

    bannerEl = document.createElement('div');
    bannerEl.id = 'app-banner';
    bannerEl.className = 'app-banner hidden';
    topbarEl.insertAdjacentElement('afterend', bannerEl);

    bottomBandEl = document.createElement('div');
    bottomBandEl.id = 'app-bottomband';
    bottomBandEl.className = 'app-bottomband hidden';
    document.body.appendChild(bottomBandEl);

    // The band is no longer a fixed 52px (the phone tab strip is taller, and
    // it grows again when a settings sheet's controls come home), so anything
    // stacked on top of it — drop-ups, sheets, body padding — reads its live
    // height off --bottomband-h instead of a hardcoded offset.
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncBandHeight).observe(bottomBandEl);
    }

    actionsEl = topbarEl.querySelector('#topbar-actions');
    titleEl = topbarEl.querySelector('#topbar-title');
    backBtn = topbarEl.querySelector('#topbar-back');
    overflowMenu = topbarEl.querySelector('#topbar-overflow-menu');

    navItems = nav;
    navEl = topbarEl.querySelector('.topbar-nav');
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
    topbarEl.querySelector('#topbar-bug').addEventListener('click', () => onReportBug?.());

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
    window.addEventListener('scroll', handleChromeScroll, { passive: true });
    // Tapping the peek strip of a hidden band brings it back
    topbarEl.addEventListener('click', () => {
        document.body.classList.remove('chrome-hidden');
    });

    // The band re-measures on width changes (the observer sees the viewport,
    // since the band is full-width) and whenever supabase-auth swaps the
    // sign-in button for an avatar + display name — that name is the usual
    // reason a band that fit a moment ago no longer does.
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(updateDensity).observe(topbarEl);
    }
    const authEl = topbarEl.querySelector('#auth-section');
    if (authEl && typeof MutationObserver !== 'undefined') {
        new MutationObserver(updateDensity).observe(authEl, {
            subtree: true, childList: true, characterData: true, attributes: true,
        });
    }
    updateDensity();
}

/**
 * Responsive density — the band rolls itself up until it fits.
 *
 * A viewport breakpoint cannot answer "does this fit?", because the band's
 * content width does not follow the viewport: the actions differ per view,
 * the center title is whatever the song is called, and a signed-in name is
 * as long as the person is. That mismatch is what let the nav spill out and
 * paint on top of the actions at ~800-1000px. So the band measures itself
 * instead, shedding one layer of detail at a time until the content fits.
 *
 * Steps are cumulative and ordered cheapest-loss-first. Each is a single
 * `density-*` class handled in style.css, except the last, which re-homes
 * the nav links into the ⋯ menu so they stay reachable rather than simply
 * vanishing. The ladder bottoms out at roughly a 300px band (back · brand ·
 * action icons · ⋯); below that the band overflows, which is deliberate —
 * the phone rules at 640px have already trimmed it further by then.
 */
const DENSITY_STEPS = ['full', 'snug', 'no-name', 'no-title', 'icons', 'nav-icons', 'nav-overflow'];
let navInOverflow = false;
let densityPass = false;

function bandFits() {
    // 1px of slack: sub-pixel layout rounding reports phantom overflow, and a
    // phantom overflow would collapse a band that is actually fine.
    return topbarEl.scrollWidth <= topbarEl.clientWidth + 1;
}

function applyDensity(step) {
    DENSITY_STEPS.forEach((name, i) => {
        topbarEl.classList.toggle(`density-${name}`, i > 0 && i <= step);
    });
    topbarEl.dataset.density = DENSITY_STEPS[step];
    const wantNavInOverflow = DENSITY_STEPS[step] === 'nav-overflow';
    if (wantNavInOverflow !== navInOverflow) {
        navInOverflow = wantNavInOverflow;
        renderOverflow(lastViewOverflow);
    }
}

/**
 * Re-measure and pick the smallest density step the content fits in. Called
 * on resize, on every setTopBar(), and when the auth chip changes.
 */
export function updateDensity() {
    if (!topbarEl || densityPass) return;
    densityPass = true;
    try {
        // Walk from the top every pass rather than nudging the current step:
        // the previous answer is stale the moment the view's actions change,
        // and only a full walk can climb back up when room is returned. Every
        // step is applied inside this one synchronous task, so no
        // intermediate state ever reaches the screen.
        let step = 0;
        applyDensity(step);
        while (step < DENSITY_STEPS.length - 1 && !bandFits()) {
            applyDensity(++step);
        }
    } finally {
        densityPass = false;
    }
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

    // Actions and title just changed, so the width that fit a moment ago
    // tells us nothing — measure again.
    updateDensity();
}

let overflowBase = [];
let lastViewOverflow = [];

/** Persistent overflow entries (About, Patreon, Feedback, …) seeded once by main.js. */
export function setOverflowBase(items) {
    overflowBase = items;
    renderOverflow([]);
}

function renderOverflow(viewItems) {
    if (!overflowMenu) return;
    lastViewOverflow = viewItems;
    overflowMenu.textContent = '';
    // At the last density step the nav links have left the band; they lead
    // the ⋯ menu so navigation is still one tap away.
    const navGroup = navInOverflow ? navItems.map(item => ({
        id: item.id ? `overflow-nav-${item.id}` : null,
        label: item.label,
        onClick: item.onClick || (() => { location.href = item.href; }),
    })) : [];
    const groups = [navGroup, viewItems, overflowBase].filter(group => group.length);
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
    syncBandHeight();
}

/** Publish the bottom band's live height as --bottomband-h (0 when hidden). */
function syncBandHeight() {
    if (!bottomBandEl) return;
    const h = bottomBandEl.classList.contains('hidden') ? 0 : bottomBandEl.offsetHeight;
    document.documentElement.style.setProperty('--bottomband-h', `${h}px`);
}

/**
 * Pure: builds the banner's inner markup for a given message. No DOM, so
 * it's unit-testable without mounting the shell. `retry: false` omits the
 * retry button (a dismiss-only notice).
 */
export function bannerMarkup(message, { retry = true, retryLabel = 'Retry' } = {}) {
    return `
        <span class="app-banner-text">${escapeHtml(message)}</span>
        <span class="app-banner-actions">
            ${retry ? `<button type="button" class="app-banner-retry">${escapeHtml(retryLabel)}</button>` : ''}
            <button type="button" class="app-banner-dismiss" aria-label="Dismiss">&times;</button>
        </span>
    `;
}

/**
 * Show (or hide, with a falsy message) a dismissible, prominent notice bar
 * below the top band. The shell owns no app state — callers (main.js)
 * decide when to show it and supply the retry callback.
 */
export function setBanner(message, { onRetry, onDismiss, retryLabel = 'Retry' } = {}) {
    if (!bannerEl) return;
    if (!message) {
        bannerEl.classList.add('hidden');
        bannerEl.innerHTML = '';
        return;
    }
    bannerEl.innerHTML = bannerMarkup(message, { retry: !!onRetry, retryLabel });
    bannerEl.querySelector('.app-banner-retry')?.addEventListener('click', () => onRetry?.());
    bannerEl.querySelector('.app-banner-dismiss').addEventListener('click', () => {
        setBanner(null);
        onDismiss?.();
    });
    bannerEl.classList.remove('hidden');
}

/**
 * Auto-hiding chrome (progressive disclosure — replaces focus mode):
 * on pages that enable it, the top band slides away as you scroll down
 * into the content and returns on scroll-up, tapping the top edge, or
 * returning to the top. No mode, no toggle, no state to learn.
 */
let autoHideEnabled = false;
let lastScrollY = 0;
let scrollTickPending = false;

export function setChromeAutoHide(on) {
    autoHideEnabled = on;
    lastScrollY = window.scrollY;
    if (!on) document.body.classList.remove('chrome-hidden');
}

function handleChromeScroll() {
    if (!autoHideEnabled || scrollTickPending) return;
    scrollTickPending = true;
    requestAnimationFrame(() => {
        scrollTickPending = false;
        const y = window.scrollY;
        const dy = y - lastScrollY;
        lastScrollY = y;
        if (y < 48) {
            document.body.classList.remove('chrome-hidden');
        } else if (dy > 6) {
            document.body.classList.add('chrome-hidden');
            closePopover();
        } else if (dy < -6) {
            document.body.classList.remove('chrome-hidden');
        }
    });
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
    // Keep the popover on-screen: flip to right-aligned when it would
    // overflow right, then clamp whatever edge still pokes out (narrow
    // viewports can overflow BOTH ways depending on the anchor position).
    popover.classList.remove('align-right');
    popover.style.transform = '';
    const rect = popover.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) popover.classList.add('align-right');
    const r2 = popover.getBoundingClientRect();
    let shift = 0;
    if (r2.left < 8) shift = 8 - r2.left;
    else if (r2.right > window.innerWidth - 8) shift = (window.innerWidth - 8) - r2.right;
    if (shift) popover.style.transform = `translateX(${Math.round(shift)}px)`;
    openPopover = { el: popover.parentElement, popover, anchorBtn };
}

function closePopover() {
    if (!openPopover) return;
    openPopover.popover.classList.add('hidden');
    openPopover.anchorBtn.classList.remove('open');
    openPopover = null;
}
