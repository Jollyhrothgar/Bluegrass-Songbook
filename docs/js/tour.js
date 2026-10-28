// The feature tour (G14): a small floating card that points at the real
// controls one at a time — Key, Lists, Edit, a song written into the lyrics &
// chords editor (tour-editor-demo.js), tab playback, tab editing, opening
// your own TablEdit files — so a visitor arriving from Google learns what the
// book can do.
//
// Unobtrusive by construction: no backdrop, the page stays live, nothing is
// clicked for you. If the reader wanders off on their own (follows a link,
// presses Back, opens the editor), the step's control disappears and the
// tour gets out of the way.
//
// The editor demo is the one place the tour does things itself: it plays a
// song into the editor. A trusted press or key in the editor stops it (the
// reader took over), and the tour resets the editor whenever it leaves it,
// so nothing is saved and leaving never asks about unsaved changes.
//
// Lazy (LAZY_MODULE_URLS): main.js imports it on the Tour button's click. No
// module-level side effects; startTour() does all the wiring and stop()
// undoes it. The pure helpers below are exported for tests; the DOM runner
// is covered end to end by e2e/tour.spec.js.

import { writeIn, sortSections, addChords } from './tour-editor-demo.js';

/**
 * Where a step goes when the page the reader started on can't show it.
 * Old Home Place is the design inventory's lead-sheet example and Foggy
 * Mountain Breakdown's banjo tab its tab example (design/ui-states).
 */
export const TOUR_ROUTES = {
    lead: '/#work/old-home-place',
    editor: '/#add',
    tab: '/#work/foggy-mountain-breakdown/banjo-tab',
};

/**
 * The steps, in order. `page` is where the step happens; `targets` are tried
 * in order and the first visible one is ringed (a target may carry a `note`
 * that is appended to the body — the same control lives elsewhere on a
 * phone). `play` steps run a demo once their target shows, and may ring other
 * controls as they go (`point`). `dropZone` steps have no control: the whole
 * page is the target, outlined the way it is while a file is dragged over it
 * (body.file-dragover).
 */
export const TOUR_STEPS = [
    {
        id: 'key',
        page: 'lead',
        targets: ['#key-pill'],
        title: 'Play it in your key',
        body: 'Move every chord to another key, or switch to Nashville numbers.',
    },
    {
        id: 'lists',
        page: 'lead',
        targets: ['#list-picker-btn'],
        title: 'Make a list',
        body: 'Save songs to Favorites or to a setlist for the next jam. No account needed; sign in to keep your lists on every device and share them.',
    },
    {
        id: 'edit',
        page: 'lead',
        targets: ['#edit-song-btn'],
        title: 'Fix a chord',
        body: 'Change the chords or the words. Unless the chart is yours, your edit is saved as your own arrangement and the original stays as it is.',
    },
    {
        id: 'write',
        page: 'editor',
        targets: ['#editor-lead .cm-content'],
        play: writeIn,
        title: 'Write in a song',
        body: 'Add Song opens the editor. Type the words, or paste a chord sheet from anywhere and it is converted for you. (A demo: nothing here is saved.)',
    },
    {
        id: 'sections',
        page: 'editor',
        targets: ['#editor-lead .cm-content'],
        play: sortSections,
        title: 'Sort it into sections',
        body: 'Select some lines, then tap Verse, Chorus or Bridge.',
    },
    {
        id: 'chords',
        page: 'editor',
        targets: ['#editor-lead .cm-content'],
        play: addChords,
        title: 'Add the chords',
        body: 'Switch to Chords, tap a syllable, then tap a chord.',
    },
    {
        id: 'play',
        page: 'tab',
        targets: ['.tab-play-btn'],
        title: 'Play the tab',
        body: 'Tabs play back. Slow the tempo down, loop it, or change the key.',
    },
    {
        id: 'tab-edit',
        page: 'tab',
        targets: [
            '.tab-edit-btn',
            // Phone: Edit is re-parented into the ⚙ sheet (tab-controls-sheet.js)
            { selector: '.tab-more-btn', note: 'On a phone, Edit is under ⚙.' },
        ],
        title: 'Write tab',
        body: 'Use Edit to fix a note in this tab or write your own break. Your work is kept as a draft as you go.',
    },
    {
        id: 'tef',
        page: 'tab',
        // Checked in the app, 2026-10-27: a .tef dropped on the home page, a
        // song page or a tab page opens in the editor signed out (pwa.js
        // enableFileDrop); sign-in is only asked at Submit. A phone cannot
        // drag, and its way in, Add Song ▸ Tablature, asks for sign-in
        // BEFORE the editor (launchTabCreator) and opens an empty take whose
        // band has 📂 Import .tef…, so the copy says exactly that.
        dropZone: true,
        targets: [],
        title: 'Open your own TablEdit files',
        body: 'Drag a .tef file onto any page and it opens in the tab editor, right in your browser. Fix it up, then sign in and submit it to add it to the book. On a phone: sign in, choose the song under Add Song ▸ Tablature, then tap 📂 Import .tef in the editor.',
    },
];

/** A control gone this long (after it was found) means the reader left. */
const WANDER_MS = 1500;
const TICK_MS = 120;
const MARGIN = 8;
const GAP = 16;     // room for the card's arrow between it and the ring
const ARROW_INSET = 16;
const BIG_TARGET = 0.45;   // a target taller than this share of the free area gets no card beside it

/** Fixed bars the card keeps out of: the shell's bands, and the editor's docked parts on a phone. */
const TOP_BARS = ['#app-topbar', '.chm-menu.chm-split:not(.hidden) .chm-strip'];
const BOTTOM_BARS = [
    '#app-bottomband:not(.hidden)',
    '.chm-menu.chm-split:not(.hidden) .chm-body',
    '.le-selbar.le-selbar-docked:not(.hidden)',
];

const asTarget = (t) => (typeof t === 'string' ? { selector: t } : t);

/** First of a step's targets that `isVisible` accepts, as { el, note }. */
export function pickTarget(step, query, isVisible) {
    for (const t of step.targets.map(asTarget)) {
        const el = query(t.selector);
        if (el && isVisible(el)) return { el, note: t.note || '' };
    }
    return null;
}

/**
 * Where must the tour go before showing `step`? Returns the page to navigate
 * to, or null to stay. `here` is the page the tour last put the reader on
 * (or found them on).
 */
export function pageToVisit(step, { here }) {
    return here === step.page ? null : step.page;
}

/**
 * Card position for a target box. `area` is the free part of the viewport,
 * between the top band and the bottom band ({ width, top, bottom }): the
 * card sits under both bands, so it must keep out of them or its buttons
 * vanish. Below the target when the target sits in the upper half of that
 * area (or in the top band), above it otherwise (the bottom band); centred on
 * it and clamped. With no target the card rests at the bottom of the area
 * (or the top, `restAt`), and so it does for a target too big to sit beside
 * (the whole editor).
 * `arrow` is where the card's pointer sits along its edge (px from its left),
 * under the target's centre but never past the card's rounded corners.
 */
export function placeCard(target, card, area, restAt = 'bottom') {
    const clampX = (x) => Math.max(MARGIN, Math.min(x, area.width - card.width - MARGIN));
    const clampY = (y) => Math.max(area.top + MARGIN, Math.min(y, area.bottom - card.height - MARGIN));
    if (!target || target.height > (area.bottom - area.top) * BIG_TARGET) {
        return {
            left: clampX((area.width - card.width) / 2),
            top: restAt === 'top' ? clampY(area.top + 16) : clampY(area.bottom - card.height - 16),
            placement: 'rest',
        };
    }
    const left = clampX(target.left + target.width / 2 - card.width / 2);
    const below = target.top + target.height / 2 < (area.top + area.bottom) / 2;
    const top = below
        ? clampY(target.bottom + GAP)
        : clampY(target.top - GAP - card.height);
    const arrow = Math.max(ARROW_INSET,
        Math.min(target.left + target.width / 2 - left, card.width - ARROW_INSET));
    return { left, top, placement: below ? 'below' : 'above', arrow };
}

/** The viewport minus the fixed bars at its top and bottom (the top band may be auto-hidden). */
function freeArea() {
    let top = 0;
    let bottom = window.innerHeight;
    for (const sel of TOP_BARS) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) top = Math.max(top, el.getBoundingClientRect().bottom);
    }
    for (const sel of BOTTOM_BARS) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) bottom = Math.min(bottom, el.getBoundingClientRect().top);
    }
    return { width: window.innerWidth, top, bottom };
}

function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

/** Too big to sit beside, ring or ripple around (the whole editor), by the placeCard rule. */
function isBig(rect, area = freeArea()) {
    return rect.height > (area.bottom - area.top) * BIG_TARGET;
}

/** Where a target is on screen: a control's box, or the box a demo computes (`{ rect() }`). */
const rectOf = (t) => (t ? (t.rect ? t.rect() : t.el.getBoundingClientRect()) : null);

function cardMarkup() {
    return `
        <div class="tour-card-head">
            <span class="tour-label"><span aria-hidden="true">✨</span> Tour <span class="tour-count"></span></span>
            <button type="button" class="tour-close" aria-label="Close the tour" title="Close the tour">&times;</button>
        </div>
        <h2 class="tour-title" id="tour-title"></h2>
        <p class="tour-body" id="tour-body"></p>
        <div class="tour-actions">
            <button type="button" class="tour-back">Back</button>
            <button type="button" class="tour-next">Next</button>
        </div>
    `;
}

/**
 * Same mechanism as main.js's in-page link handler: push the URL, then let
 * the router's hashchange listener route it (it handles song paths too).
 */
function defaultNavigate(url) {
    history.pushState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Start the tour. Returns { stop }.
 *   onStep(step, index)   — each step shown (analytics)
 *   onClose({ finished, step, index }) — once, however it ends
 *   navigate(url)         — injectable for tests
 *   editor                — { lead(): Promise<controller|null>, reset() } for the
 *                           editor demo (main.js); without it the demo steps
 *                           show their card and play nothing
 */
export function startTour({ steps = TOUR_STEPS, routes = TOUR_ROUTES, onStep, onClose, navigate = defaultNavigate, editor = null } = {}) {
    const query = (sel) => document.querySelector(sel);

    // Can the page the reader is on already host the song-page steps? Then
    // they happen here, on their own song, and Done has nowhere to return.
    const startUrl = location.pathname + location.search + location.hash;
    const onLead = !!(pickTarget({ targets: ['#key-pill'] }, query, isVisible)
        && pickTarget({ targets: ['#edit-song-btn'] }, query, isVisible));
    const onTab = !!pickTarget({ targets: ['.tab-play-btn'] }, query, isVisible);
    const pageUrl = {
        ...routes,
        ...(onLead ? { lead: startUrl } : {}),
        ...(onTab ? { tab: startUrl } : {}),
    };
    let here = onLead ? 'lead' : onTab ? 'tab' : null;
    let hereUrl = startUrl;

    const card = document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-labelledby', 'tour-title');
    card.setAttribute('aria-roledescription', 'tour');
    card.setAttribute('aria-describedby', 'tour-body');
    card.innerHTML = cardMarkup();

    const ring = document.createElement('div');
    ring.className = 'tour-ring hidden';
    ring.setAttribute('aria-hidden', 'true');

    document.body.append(ring, card);

    const els = {
        count: card.querySelector('.tour-count'),
        title: card.querySelector('.tour-title'),
        body: card.querySelector('.tour-body'),
        back: card.querySelector('.tour-back'),
        next: card.querySelector('.tour-next'),
        close: card.querySelector('.tour-close'),
    };

    let index = -1;
    let found = false;    // has the current step's target been seen yet?
    let lastSeen = 0;
    let stopped = false;
    let run = 0;          // bumped by every step change, and when the reader takes over: a demo checks it
    let focus = null;     // what the demo is pointing at (a selector, or { rect() }), ringed instead of the step's target
    let lead = null;      // the editor's controller, once a demo step has it
    let restAt = 'bottom';   // where a resting card sits; a demo moves it off the line it is working on
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    /**
     * The card stays with the step's target; the ring goes to what a demo is
     * pointing at, so the card does not chase the ring around the editor.
     */
    function position(target, ringTarget = target) {
        const area = freeArea();
        const rect = rectOf(target);
        const box = card.getBoundingClientRect();
        const { left, top, placement, arrow } = placeCard(rect,
            { width: box.width, height: box.height }, area, restAt);
        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(top)}px`;
        card.dataset.placement = placement;
        if (arrow != null) card.style.setProperty('--tour-arrow-x', `${Math.round(arrow)}px`);

        // A drop-zone step rings the page itself, inside the bands.
        const zone = steps[index].dropZone;
        const ringRect = rectOf(ringTarget);
        const ringBox = zone
            ? { left: MARGIN, top: area.top + MARGIN, width: area.width - 2 * MARGIN, height: area.bottom - area.top - 2 * MARGIN }
            : ringRect && { left: ringRect.left - 4, top: ringRect.top - 4, width: ringRect.width + 8, height: ringRect.height + 8 };
        // A popover the reader opened from the ringed control wins: the ring
        // sits above the bands, so hide it rather than draw over the menu.
        const opened = ringTarget?.el && (ringTarget.el.matches('.open, [aria-expanded="true"]')
            || ringTarget.el.querySelector('.open, [aria-expanded="true"]'));
        // A ring around the whole editor says nothing and, on a phone, cuts across the card
        const big = !zone && ringRect && isBig(ringRect, area);
        ring.classList.toggle('hidden', !ringBox || !!opened || big);
        ring.classList.toggle('tour-ring-zone', !!zone);
        if (ringBox) {
            ring.style.left = `${Math.round(ringBox.left)}px`;
            ring.style.top = `${Math.round(ringBox.top)}px`;
            ring.style.width = `${Math.round(ringBox.width)}px`;
            ring.style.height = `${Math.round(ringBox.height)}px`;
        }
    }

    // Make the landing impossible to miss: the card slides in from the
    // control's side and the ring sends out a ripple (style.css; none under
    // reduced motion). Played when a step shows and again when its control
    // turns up, so a step that waited for a page to load still announces
    // where it landed.
    const replay = (el, cls) => {
        el.classList.remove(cls);
        void el.offsetWidth;   // restart the animation
        el.classList.add(cls);
    };
    function arrive({ ping }) {
        replay(card, 'tour-arrive');
        if (ping) replay(ring, 'tour-ping');
    }

    function tick() {
        if (stopped || index < 0) return;
        const step = steps[index];
        const target = pickTarget(step, query, isVisible);
        const pointed = typeof focus === 'string' ? pickTarget({ targets: [focus] }, query, isVisible)
            : focus?.rect ? focus : null;
        const now = performance.now();
        let landed = false;
        if (target) {
            if (!found) {
                found = true;
                landed = true;
                bringIntoView(target.el);
            }
            // The note follows the control actually ringed: a resize can
            // move Edit between the band and the phone's ⚙ sheet.
            const text = target.note ? `${step.body} ${target.note}` : step.body;
            if (els.body.textContent !== text) els.body.textContent = text;
            lastSeen = now;
        } else if (found && now - lastSeen > WANDER_MS) {
            stop({ finished: false });   // the reader went somewhere else
            return;
        }
        // A control that never turns up (a tab that failed to load) is not a
        // dead end: the card rests bottom-centre, text and buttons intact.
        position(target, pointed || target);
        // A ripple suits a control; around the whole editor it scales out
        // across the page, so a big target lands without one.
        if (landed) arrive({ ping: !isBig(rectOf(pointed || target)) });
        if (landed && step.play && editor) play(step);
    }

    /**
     * Ring what the demo is pointing at: a control (a selector), a box it
     * computes (`{ rect() }`: lines it selected), or null for the step's own
     * target. Each new thing pointed at gets a ripple.
     */
    function point(target) {
        const changed = target !== focus;
        focus = target;
        tick();
        if (changed && target) replay(ring, 'tour-ping');
    }

    /** Run a step's demo. It stops at its next wait once the step changes or the reader takes over. */
    async function play(step) {
        const mine = run;
        const alive = () => !stopped && run === mine;
        const wait = (ms) => new Promise(resolve => setTimeout(() => resolve(alive()), ms));
        lead = lead || await editor.lead();
        if (!lead || !alive()) return;
        try {
            await step.play({
                lead, reset: editor.reset, wait, reduced,
                point: (selector) => { if (alive()) point(selector); },
                reveal: (rect) => { if (alive()) reveal(rect); },
            });
        } catch (err) {
            console.error('The tour demo stopped:', err);
        }
        if (alive()) point(null);
    }

    /**
     * Keep what the demo is working on out from under the card: on a phone
     * the editor scrolls the working line into the gap above its docked
     * picker or section bar, which is just where the card rests.
     */
    function reveal(rect) {
        if (!rect) return;
        const under = (c) => rect.bottom > c.top && rect.top < c.bottom;
        if (!under(card.getBoundingClientRect())) return;
        // First move the card to the other end of the free area...
        const area = freeArea();
        restAt = (rect.top + rect.bottom) / 2 > (area.top + area.bottom) / 2 ? 'top' : 'bottom';
        tick();
        // ...and only if that is not enough (a tall selection), scroll the page
        const c = card.getBoundingClientRect();
        if (!under(c)) return;
        if (c.top - area.top >= area.bottom - c.bottom) window.scrollBy({ top: rect.bottom - (c.top - MARGIN) });
        else window.scrollBy({ top: rect.top - (c.bottom + MARGIN) });
        tick();
    }

    /** A real press or key in the editor: the reader has taken over, so the demo stops where it is. */
    function takeOver(e) {
        if (!e.isTrusted || !steps[index]?.play || e.target.closest?.('.tour-card')) return;
        if (!e.target.closest?.('#editor-panel, .chm-menu, .le-selbar')) return;
        run++;
        focus = null;
        lead?.present?.end();
    }

    function bringIntoView(el) {
        // The top band auto-hides on song pages; bring it back for a step
        // that points into it.
        if (el.closest('.app-topbar')) document.body.classList.remove('chrome-hidden');
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) {
            el.scrollIntoView({ block: 'center' });
        }
    }

    function show(i) {
        index = i;
        const step = steps[i];
        run++;                 // the last step's demo stops at its next wait
        focus = null;
        restAt = 'bottom';
        lead?.present?.end();
        const go = pageToVisit(step, { here });
        if (go) {
            // Leaving the editor: drop the demo song first, or leaving would
            // ask about "unsaved changes" the reader never made.
            if (here === 'editor') editor?.reset();
            here = go;
            hereUrl = pageUrl[go];
            navigate(hereUrl);
        }
        found = false;
        ring.classList.remove('tour-ping');   // the last step's ripple must not follow
        els.count.textContent = `${i + 1} of ${steps.length}`;
        els.title.textContent = step.title;
        els.body.textContent = step.body;
        els.back.disabled = i === 0;
        const last = i === steps.length - 1;
        els.next.textContent = last ? 'Done' : 'Next';
        onStep?.(step, i);
        tick();
        if (!found) arrive({ ping: false });   // still waiting, or a drop zone
        els.next.focus({ preventScroll: true });
    }

    function stop({ finished }) {
        if (stopped) return;
        stopped = true;
        run++;
        lead?.present?.end();
        if (here === 'editor') editor?.reset();
        clearInterval(timer);
        window.removeEventListener('resize', tick);
        window.removeEventListener('scroll', tick, true);
        document.removeEventListener('pointerdown', takeOver, true);
        document.removeEventListener('keydown', takeOver, true);
        card.remove();
        ring.remove();
        onClose?.({ finished, step: steps[index], index });
    }

    els.next.addEventListener('click', () => {
        if (index < steps.length - 1) { show(index + 1); return; }
        // Done: back to the page the tour was started from
        if (hereUrl !== startUrl) navigate(startUrl);
        stop({ finished: true });
    });
    els.back.addEventListener('click', () => { if (index > 0) show(index - 1); });
    els.close.addEventListener('click', () => stop({ finished: false }));
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); stop({ finished: false }); }
    });

    const timer = setInterval(tick, TICK_MS);
    window.addEventListener('resize', tick);
    window.addEventListener('scroll', tick, { capture: true, passive: true });
    document.addEventListener('pointerdown', takeOver, true);
    document.addEventListener('keydown', takeOver, true);

    show(0);
    return { stop: () => stop({ finished: false }) };
}
