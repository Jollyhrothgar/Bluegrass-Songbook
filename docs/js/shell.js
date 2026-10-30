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
export function initShell({ nav = [], onToggleTheme, onReportBug, onTour } = {}) {
    if (topbarEl) return;

    topbarEl = document.createElement('header');
    topbarEl.id = 'app-topbar';
    topbarEl.className = 'app-topbar';
    topbarEl.innerHTML = `
        <div class="topbar-left">
            <button id="topbar-back" class="topbar-back hidden" title="Back" aria-label="Back"><span class="topbar-back-arrow" aria-hidden="true">&larr;</span><span class="topbar-back-label hidden"></span></button>
            <a href="#" id="topbar-brand" class="topbar-brand" title="Home">
                <img src="images/new_bb_logo.svg" alt="Bluegrass Book">
                <img src="images/earl_zombie_face.png" class="brand-dungeon-face" alt="" aria-hidden="true">
            </a>
            <nav class="topbar-nav"></nav>
        </div>
        <div class="topbar-title" id="topbar-title"></div>
        <div class="topbar-actions" id="topbar-actions"></div>
        <div class="topbar-right">
            <button id="topbar-tour" class="topbar-tour-btn hidden" title="Take a quick tour of what the book can do"><span class="topbar-tour-icon" aria-hidden="true">✨</span><span class="topbar-tour-label">Tour</span></button>
            <button id="topbar-bug" class="topbar-icon-btn" title="Report a bug">🐛</button>
            <button id="topbar-theme" class="topbar-icon-btn" title="Toggle theme">◐</button>
            <div class="topbar-overflow">
                <button id="topbar-overflow-btn" class="topbar-icon-btn" title="More" aria-label="More" aria-haspopup="true" aria-expanded="false" aria-controls="topbar-overflow-menu">⋯</button>
                <span class="tour-invite-tip" aria-hidden="true">The tour is in here</span>
                <div class="menu-scrim"></div>
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
    topbarEl.querySelector('#topbar-tour').addEventListener('click', () => onTour?.());

    const overflowBtn = topbarEl.querySelector('#topbar-overflow-btn');
    overflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // The dock menu shows the signed-in state, the theme and the tour
        // invitation as they are NOW, so it is built when it opens.
        if (dockKind && overflowMenu.classList.contains('hidden')) renderOverflow(lastViewOverflow);
        togglePopover(overflowMenu, overflowBtn);
    });
    // On a phone the menu is a sheet over a scrim; tapping the scrim closes it
    topbarEl.querySelector('.menu-scrim').addEventListener('click', (e) => {
        e.stopPropagation();
        closePopover();
    });

    document.addEventListener('click', (e) => {
        if (openPopover && !openPopover.el.contains(e.target)) closePopover();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !openPopover) return;
        const opener = openPopover.anchorBtn;
        closePopover();
        opener.focus();   // focus returns to what opened it
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
    const wantNavInOverflow = DENSITY_STEPS[step] === 'nav-overflow' && !dockKind;
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
 *   back:     { onClick, label? } | null — shows/hides the back arrow; a label
 *             names where it goes ("← Old Home Place")
 *   title:    string | null — center title (mobile: replaces nav labels)
 *   actions:  [{ id, label, icon, title, onClick, primary, className, hidden }]
 *             — right-of-title buttons
 *   overflow: [{ id, label, onClick }] — items for the ⋯ menu (in addition to
 *             the persistent entries main.js seeds via setOverflowBase)
 *   navActive: id of the nav item to highlight
 *   dock:     'song' | 'editor' | null — the thin top dock (G19): ← · BB ·
 *             [search] · [actions] · ⋯ and nothing else. The nav, bug, theme,
 *             tour and account leave the band (CSS, `.topbar-dock`) and
 *             live in ⋯. 'song' adds the search icon.
 *   menu:     [{ title, items }] — the page's own groups in the dock's ⋯
 *             (see renderMenu); the site's groups follow (setMenuSite).
 */
export function setTopBar({ back = null, title = null, actions = [], overflow = [], navActive = null, dock = null, menu = [] } = {}) {
    if (!topbarEl) return;
    // Sign-in and trust resolve after first paint and re-declare the band; a
    // dock menu that is open stays open (renderOverflow rebuilds its rows).
    const keepMenu = !!dock && dock === dockKind && openPopover?.popover === overflowMenu;
    if (!keepMenu) closePopover();

    dockKind = dock;
    dockMenu = menu;
    topbarEl.classList.toggle('topbar-dock', !!dock);
    topbarEl.dataset.dock = dock || '';

    backBtn.classList.toggle('hidden', !back);
    backBtn.onclick = back ? back.onClick : null;
    const backLabel = backBtn.querySelector('.topbar-back-label');
    backLabel.textContent = back?.label || '';
    backLabel.classList.toggle('hidden', !back?.label);
    backBtn.setAttribute('aria-label', back?.label ? `Back to ${back.label}` : 'Back');
    // Lets CSS slim the band on pages that have a back button (song pages):
    // on phones, back + brand ARE the navigation there.
    topbarEl.classList.toggle('has-back', !!back);

    titleEl.textContent = title || '';
    titleEl.classList.toggle('hidden', !title);

    actionsEl.textContent = '';
    if (dock === 'song') {
        const search = document.createElement('button');
        search.id = 'topbar-search';
        search.className = 'topbar-icon-btn topbar-search-btn';
        search.title = 'Search';
        search.setAttribute('aria-label', 'Search');
        search.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
        search.addEventListener('click', () => navItems.find(n => n.id === 'search')?.onClick?.());
        actionsEl.appendChild(search);
    }
    for (const action of actions) {
        if (action.el) { // pre-built element (e.g. a pill)
            actionsEl.appendChild(action.el);
            continue;
        }
        const btn = document.createElement('button');
        btn.className = 'topbar-action-btn' + (action.primary ? ' primary' : '') +
            (action.className ? ` ${action.className}` : '') + (action.hidden ? ' hidden' : '');
        if (action.id) btn.id = action.id;
        if (action.title) btn.title = action.title;
        btn.innerHTML = action.icon
            ? `<span class="topbar-action-icon" aria-hidden="true">${action.icon}</span><span class="topbar-action-label">${escapeHtml(action.label)}</span>`
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

/**
 * Show or hide the glowing Tour invitation. main.js decides who sees it
 * (first-time visitors); afterwards the tour lives in the ⋯ menu. Pages with
 * the full band show the Tour button; on the thin dock the ⋯ button itself
 * glows and says so (the Tour button is hidden there by CSS).
 */
export function setTourInvite(on) {
    const btn = topbarEl?.querySelector('#topbar-tour');
    if (!btn) return;
    btn.classList.toggle('hidden', !on);
    const more = topbarEl.querySelector('#topbar-overflow-btn');
    more.classList.toggle('tour-invite', !!on);
    more.title = on ? 'More: the tour is in here' : 'More';
    updateDensity();
}

let overflowBase = [];
let overflowLead = [];
let lastViewOverflow = [];
let dockKind = null;
let dockMenu = [];
let siteMenu = () => [];

/** Persistent overflow entries (About, Patreon, Feedback, …) seeded once by main.js. */
export function setOverflowBase(items) {
    overflowBase = items;
    renderOverflow(lastViewOverflow);
}

/**
 * Persistent entries that lead the ⋯ menu, above the page's own items
 * (the feature tour: on a phone song page the page's items run five deep,
 * and an entry under them was not found).
 */
export function setOverflowLead(items) {
    overflowLead = items;
    renderOverflow(lastViewOverflow);
}

/**
 * The site's own groups in the dock's ⋯ menu (Go to, You), after the page's.
 * A function, not a list, because it answers "who is signed in" and "which
 * theme" and is asked each time the menu opens.
 */
export function setMenuSite(sectionsFn) {
    siteMenu = sectionsFn;
}

function renderOverflow(viewItems) {
    if (!overflowMenu) return;
    lastViewOverflow = viewItems;
    overflowMenu.textContent = '';
    if (dockKind) { renderMenu(); return; }
    // At the last density step the nav links have left the band; they lead
    // the ⋯ menu so navigation is still one tap away.
    const navGroup = navInOverflow ? navItems.map(item => ({
        id: item.id ? `overflow-nav-${item.id}` : null,
        label: item.label,
        onClick: item.onClick || (() => { location.href = item.href; }),
    })) : [];
    const groups = [navGroup, overflowLead, viewItems, overflowBase].filter(group => group.length);
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
 * The dock's ⋯ menu: titled groups of rows. A row is
 *   { id?, label, sub?, badge?, icon?, onClick }          a button
 *   { id?, label, sub?, icon?, items: [row, …] }          expands in place
 *   { type: 'segmented', label, options: [{value, label}], value, onSelect }
 * `sub` is the quiet second line, `badge` a small tag beside the label. The
 * page's groups come first, then the site's (setMenuSite), then the
 * site-wide entries (setOverflowBase) with no title.
 */
function renderMenu() {
    const sections = [...dockMenu, ...siteMenu(), { items: overflowBase }]
        .filter(section => section.items?.length);
    sections.forEach((section, i) => {
        if (i > 0) {
            const hr = document.createElement('div');
            hr.className = 'pill-popover-divider';
            overflowMenu.appendChild(hr);
        }
        const group = document.createElement('div');
        group.className = 'menu-section';
        group.setAttribute('role', 'group');
        if (section.title) {
            const heading = document.createElement('div');
            heading.className = 'menu-section-title';
            heading.textContent = section.title;
            group.appendChild(heading);
            group.setAttribute('aria-label', section.title);
        }
        for (const row of section.items) group.appendChild(menuRow(row));
        overflowMenu.appendChild(group);
    });
}

let menuRowSeq = 0;

function menuRow(row) {
    if (row.type === 'segmented') {
        const wrap = document.createElement('div');
        wrap.className = 'menu-row menu-segmented-row';
        wrap.innerHTML = `<span class="menu-item-label">${escapeHtml(row.label)}</span>`;
        const seg = document.createElement('div');
        seg.className = 'menu-segmented';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', row.label);
        for (const opt of row.options) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'menu-segmented-btn' + (opt.value === row.value ? ' active' : '');
            b.dataset.value = opt.value;
            b.setAttribute('aria-pressed', opt.value === row.value ? 'true' : 'false');
            b.textContent = opt.label;
            b.addEventListener('click', () => {
                seg.querySelectorAll('.menu-segmented-btn').forEach(x => {
                    const on = x === b;
                    x.classList.toggle('active', on);
                    x.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                row.onSelect(opt.value);
            });
            seg.appendChild(b);
        }
        wrap.appendChild(seg);
        return wrap;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill-popover-item menu-item';
    if (row.id) btn.id = row.id;
    btn.innerHTML = `
        <span class="menu-item-icon" aria-hidden="true">${escapeHtml(row.icon || '')}</span>
        <span class="menu-item-text">
            <span class="menu-item-label">${escapeHtml(row.label)}${row.badge ? ` <span class="menu-item-badge">${escapeHtml(row.badge)}</span>` : ''}</span>
            ${row.sub ? `<span class="menu-item-sub">${escapeHtml(row.sub)}</span>` : ''}
        </span>
        ${row.items ? '<span class="menu-item-chevron" aria-hidden="true">›</span>' : ''}`;
    if (!row.items) {
        btn.addEventListener('click', () => { closePopover(); row.onClick(); });
        return btn;
    }

    // An expanding row: its choices open under it, so "Export / Print" can
    // list all five options without a second page to find
    const subId = `menu-sub-${++menuRowSeq}`;
    const sub = document.createElement('div');
    sub.id = subId;
    sub.className = 'menu-sub hidden';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', subId);
    for (const child of row.items) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'pill-popover-item menu-sub-item';
        if (child.id) c.id = child.id;
        if (child.action) c.dataset.action = child.action;
        c.textContent = child.label;
        c.addEventListener('click', () => { closePopover(); child.onClick(); });
        sub.appendChild(c);
    }
    btn.addEventListener('click', () => {
        const open = sub.classList.toggle('hidden') === false;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.classList.toggle('expanded', open);
    });
    const frag = document.createDocumentFragment();
    frag.append(btn, sub);
    return frag;
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
    btn.setAttribute('aria-expanded', 'false');
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
    anchorBtn.setAttribute('aria-expanded', 'true');
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
    openPopover.anchorBtn.setAttribute('aria-expanded', 'false');
    openPopover = null;
}

/**
 * A dialog sheet: slides up from the bottom on a phone, a centred card on a
 * wide screen, over a scrim. It reuses the notes sheet's look (`.notes-sheet*`
 * in style.css), so there is one bottom-sheet design. Esc, the × and a tap
 * on the scrim close it, and focus returns to what opened it.
 *   openSheet({ id, title, opener, build(contentEl, api) }) -> { close, el }
 * Only one is open at a time.
 */
let openSheetApi = null;

export function openSheet({ id, title, opener = null, build }) {
    openSheetApi?.close();

    const backdrop = document.createElement('div');
    backdrop.className = 'notes-sheet-backdrop';
    const sheet = document.createElement('div');
    sheet.className = 'notes-sheet dock-sheet';
    sheet.id = id;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', `${id}-title`);
    sheet.innerHTML = `
        <div class="notes-sheet-header">
            <h2 class="notes-sheet-title" id="${id}-title">${escapeHtml(title)}</h2>
            <button type="button" class="notes-sheet-close" aria-label="Close">&times;</button>
        </div>
        <div class="notes-sheet-content"></div>`;
    const closeBtn = sheet.querySelector('.notes-sheet-close');

    const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
    };
    const api = {
        el: sheet,
        close() {
            if (openSheetApi !== api) return;
            openSheetApi = null;
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
            sheet.remove();
            if (opener) {
                opener.setAttribute('aria-expanded', 'false');
                if (opener.isConnected) opener.focus();
            }
        },
    };
    backdrop.addEventListener('click', api.close);
    closeBtn.addEventListener('click', api.close);
    document.addEventListener('keydown', onKey, true);

    document.body.append(backdrop, sheet);
    build(sheet.querySelector('.notes-sheet-content'), api);
    if (opener) {
        opener.setAttribute('aria-expanded', 'true');
        opener.setAttribute('aria-controls', id);
    }
    openSheetApi = api;
    closeBtn.focus();
    return api;
}
