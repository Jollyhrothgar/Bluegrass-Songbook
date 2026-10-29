// @vitest-environment jsdom
// The feature tour (G14): which control each step rings, when the tour has
// to change page, where the card goes, how the search and editor demos start
// and stop, and how a tour ends. The real pages are walked in e2e/tour.spec.js; here
// the "pages" are a few stub elements and navigate() swaps them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TOUR_STEPS, TOUR_ROUTES, SEARCH_DEMO_QUERY, pickTarget, pageToVisit, placeCard, startTour } from '../tour.js';

describe('TOUR_STEPS', () => {
    it('walks search, key, lists, edit, the editor demo, tab playback, tab editing, your own .tef — in that order', () => {
        expect(TOUR_STEPS.map(s => s.id)).toEqual(
            ['search', 'find', 'key', 'lists', 'edit', 'write', 'sections', 'chords', 'play', 'tab-edit', 'tef']);
    });

    it('every step has a page the tour knows how to reach', () => {
        for (const step of TOUR_STEPS) expect(TOUR_ROUTES[step.page]).toBeTruthy();
    });

    it("keeps each page's steps together, so the tour changes page as little as it can", () => {
        expect(TOUR_STEPS.map(s => s.page)).toEqual(
            ['search', 'search', 'lead', 'lead', 'lead', 'editor', 'editor', 'editor', 'tab', 'tab', 'tab']);
    });

    it('the editor steps each play a demo, in the Add Song editor', () => {
        expect(TOUR_STEPS.filter(s => s.page === 'editor' && s.play).map(s => s.id)).toEqual(['write', 'sections', 'chords']);
        expect(TOUR_ROUTES.editor).toBe('/#add');
        expect(TOUR_STEPS.find(s => s.id === 'write').body).toMatch(/nothing here is saved/);
    });

    it('the search card names what you can search for, and the demo finds the demo song', () => {
        const body = TOUR_STEPS.find(s => s.id === 'search').body;
        for (const what of [/title/, /artist/, /a line of the words/, /prog:I-IV-V/, /Tabs/, /instrumentals/]) {
            expect(body).toMatch(what);
        }
        expect(TOUR_STEPS.find(s => s.id === 'find').play).toBeTypeOf('function');
        expect(TOUR_ROUTES.search).toBe('/#search');
        // The demo types the first line of the song the song steps then open
        expect(TOUR_ROUTES.lead).toBe('/#work/old-home-place');
        expect(SEARCH_DEMO_QUERY).toBe('ten long years since I left my home');
    });

    it('the .tef step says all three things: open it, edit it here, submit it to the book', () => {
        const tef = TOUR_STEPS.find(s => s.id === 'tef');
        expect(tef.dropZone).toBe(true);
        expect(tef.body).toMatch(/\.tef/);
        expect(tef.body).toMatch(/in your browser/);
        expect(tef.body).toMatch(/submit it to add it to the book/);
        // Submitting needs an account, and on a phone so does Add Song ▸
        // Tablature (launchTabCreator gates it): the card must not hide that
        expect(tef.body).toMatch(/sign in and submit/);
        expect(tef.body).toMatch(/On a phone: sign in, choose the song under Add Song ▸ Tablature/);
    });
});

describe('pickTarget', () => {
    const els = { '#a': { id: 'a' }, '#b': { id: 'b' } };
    const query = (sel) => els[sel] || null;

    it('takes the first visible target', () => {
        const step = { targets: ['#a', '#b'] };
        expect(pickTarget(step, query, () => true).el.id).toBe('a');
        expect(pickTarget(step, query, (el) => el.id === 'b').el.id).toBe('b');
    });

    it("carries a target's note, and none for a bare selector", () => {
        const step = { targets: ['#missing', { selector: '#b', note: 'Under ⚙.' }] };
        expect(pickTarget(step, query, () => true)).toEqual({ el: els['#b'], note: 'Under ⚙.' });
        expect(pickTarget({ targets: ['#a'] }, query, () => true).note).toBe('');
    });

    it('is null when nothing is on screen', () => {
        expect(pickTarget({ targets: ['#a', '#b'] }, query, () => false)).toBeNull();
    });
});

describe('pageToVisit', () => {
    const lead = { page: 'lead' };

    it("stays when the reader is already on the step's page", () => {
        expect(pageToVisit(lead, { here: 'lead' })).toBeNull();
    });

    it("goes to the step's page from anywhere else", () => {
        expect(pageToVisit(lead, { here: null })).toBe('lead');
        expect(pageToVisit(lead, { here: 'tab' })).toBe('lead');
    });
});

describe('placeCard', () => {
    const card = { width: 300, height: 150 };
    const area = { width: 1000, top: 48, bottom: 800 };
    const box = (left, top, width = 80, height = 30) =>
        ({ left, top, width, height, right: left + width, bottom: top + height });

    it('goes below a control in the top band, centred on it', () => {
        const p = placeCard(box(460, 10), card, area);
        expect(p.placement).toBe('below');
        expect(p.top).toBe(56);   // 40 + 16 gap, which also clears the 48px band + margin
        expect(p.left).toBe(350); // 500 - 150
        expect(p.arrow).toBe(150); // the arrow sits under the control's centre
    });

    it('goes above a control in the bottom band', () => {
        const p = placeCard(box(100, 820), card, area);
        expect(p.placement).toBe('above');
        expect(p.top).toBe(800 - 8 - 150);   // the band starts at 800: stay out of it
    });

    it('sits a gap away from a control in the content', () => {
        const p = placeCard(box(460, 200), card, area);
        expect(p.top).toBe(246);  // 230 + 16
    });

    it('never leaves the free area between the bands', () => {
        const right = placeCard(box(980, 300), card, area);
        expect(right.left).toBe(1000 - 300 - 8);
        expect(right.arrow).toBe(300 - 16);   // clamped short of the rounded corner
        const left = placeCard(box(0, 300), card, area);
        expect(left.left).toBe(8);
        // a control low in the content: the card goes above it, not under the band
        const low = placeCard(box(400, 760), card, area);
        expect(low.top + card.height).toBeLessThanOrEqual(area.bottom - 8);
    });

    it('rests at the bottom of the free area when there is nothing to ring', () => {
        const p = placeCard(null, card, area);
        expect(p.placement).toBe('rest');
        expect(p.top + card.height).toBeLessThanOrEqual(area.bottom - 8);
        expect(p.left).toBe(350);
        expect(p.arrow).toBeUndefined();
    });

    it('rests beside nothing when the target is too big to sit beside (the whole editor)', () => {
        const p = placeCard(box(40, 100, 900, 600), card, area);
        expect(p.placement).toBe('rest');
        expect(p.arrow).toBeUndefined();
    });

    it('can rest at the top instead, off a line a demo is working on', () => {
        const p = placeCard(null, card, area, 'top');
        expect(p.top).toBe(48 + 16);   // the same inset as resting at the bottom
    });
});

// --- The runner, on stub pages ----------------------------------------------

/** What each page shows. The top band is on every page. */
const PAGES = {
    home: '',
    search: `
        <input id="search-input">
        <div id="results"><div class="result-item" data-id="old-home-place"></div></div>`,
    lead: `
        <div id="key-pill"></div>
        <button id="edit-song-btn"></button>`,
    editor: `
        <div id="editor-panel"><div id="editor-lead"><div class="cm-content"></div></div>
        <button id="editor-mode-chords"></button></div>`,
    tab: `
        <button class="tab-play-btn"></button>
        <button class="tab-edit-btn"></button>`,
};

/** Pages render into #app, as the real views do: body (and the card) stays. */
function renderPage(name) {
    let app = document.getElementById('app');
    if (!app) {
        app = document.createElement('div');
        app.id = 'app';
        document.body.prepend(app);
    }
    app.innerHTML = `
        <header id="app-topbar" class="app-topbar">
            <a class="topbar-nav-link" data-nav="add"></a>
            ${name === 'home' ? '' : '<button id="list-picker-btn"></button>'}
        </header>
        <main>${PAGES[name]}</main>`;
}

const pageForUrl = (url) => ({
    [TOUR_ROUTES.search]: 'search', [TOUR_ROUTES.lead]: 'lead', [TOUR_ROUTES.editor]: 'editor', [TOUR_ROUTES.tab]: 'tab',
}[url] || 'home');

describe('startTour', () => {
    let navigate;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] });
        // jsdom lays nothing out: a stub element is "on screen" unless hidden
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
            if (this.closest('.hidden')) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
            return { left: 10, top: 10, width: 40, height: 20, right: 50, bottom: 30 };
        });
        Element.prototype.scrollIntoView = () => {};
        navigate = vi.fn((url) => renderPage(pageForUrl(url)));
        history.replaceState(null, '', '/');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    const card = () => document.querySelector('.tour-card');
    const next = () => card().querySelector('.tour-next').click();
    const back = () => card().querySelector('.tour-back').click();

    it('from the home page: search, the demo song, the editor, the demo tab, then home on Done', () => {
        renderPage('home');
        const onStep = vi.fn();
        const onClose = vi.fn();
        startTour({ navigate, onStep, onClose });

        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.search);
        expect(card().querySelector('.tour-label').textContent).toMatch(/Tour\s+1 of 11/);
        next();                                 // find: same page
        expect(navigate).toHaveBeenCalledTimes(1);
        next();                                 // key: the song the demo found
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.lead);
        next(); next();                         // lists, edit: same page
        expect(navigate).toHaveBeenCalledTimes(2);
        next();                                 // write: the Add Song editor
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.editor);
        next(); next();                         // sections, chords: same page
        expect(navigate).toHaveBeenCalledTimes(3);
        next();                                 // play
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.tab);
        next();                                 // tab-edit
        next();                                 // tef: the page itself is the target
        expect(navigate).toHaveBeenCalledTimes(4);
        expect(document.querySelector('.tour-ring').classList.contains('tour-ring-zone')).toBe(true);
        expect(card().querySelector('.tour-next').textContent).toBe('Done');
        next();                                 // Done
        expect(navigate).toHaveBeenLastCalledWith('/');
        expect(onClose).toHaveBeenCalledWith({ finished: true, step: TOUR_STEPS[10], index: 10 });
        expect(onStep.mock.calls.map(([s]) => s.id)).toEqual(TOUR_STEPS.map(s => s.id));
        expect(card()).toBeNull();
        expect(document.querySelector('.tour-ring')).toBeNull();
    });

    it("on a song page: the tour still searches and shows the demo song, and Done goes back to the reader's song", () => {
        history.replaceState(null, '', '/songs/salty-dog-blues/');
        renderPage('lead');
        startTour({ navigate });
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.search);
        next(); next();                         // find, then key: the demo song
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.lead);
        for (let i = 0; i < 8; i++) next();     // lists … tef
        next();                                 // Done: back to their song
        expect(navigate).toHaveBeenLastCalledWith('/songs/salty-dog-blues/');
    });

    it("on a tab page: the tab steps use the reader's own tab", () => {
        history.replaceState(null, '', '/#work/salt-creek/banjo');
        renderPage('tab');
        startTour({ navigate });
        for (let i = 0; i < 8; i++) next();     // play
        expect(navigate).toHaveBeenLastCalledWith('/#work/salt-creek/banjo');
    });

    it('Back returns through the editor to the song', () => {
        renderPage('home');
        startTour({ navigate });
        for (let i = 0; i < 8; i++) next();     // play → the demo tab
        back();                                 // chords: the editor
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.editor);
        back(); back(); back();                 // edit: back to the song
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.lead);
        back(); back(); back();                 // lists, key, then find: the search page
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.search);
    });

    it('rings the control and appends the note of a fallback target', () => {
        renderPage('home');
        navigate = vi.fn((url) => {
            renderPage(pageForUrl(url));
            // phone tab band: Edit has moved into the hidden ⚙ sheet
            if (pageForUrl(url) === 'tab') {
                document.querySelector('main').innerHTML = `
                    <button class="tab-play-btn"></button>
                    <button class="tab-more-btn"></button>
                    <div class="hidden"><button class="tab-edit-btn"></button></div>`;
            }
        });
        startTour({ navigate });
        expect(document.querySelector('.tour-ring').classList.contains('hidden')).toBe(false);
        for (let i = 0; i < 9; i++) next();     // tab-edit
        expect(card().querySelector('.tour-body').textContent).toContain('On a phone, Edit is under ⚙.');
    });

    it('every step lands visibly: the card animates in and the ring ripples', () => {
        renderPage('home');
        startTour({ navigate });
        expect(card().classList.contains('tour-arrive')).toBe(true);
        expect(document.querySelector('.tour-ring').classList.contains('tour-ping')).toBe(true);
        expect(card().dataset.placement).toBe('below');
        expect(card().style.getPropertyValue('--tour-arrow-x')).toMatch(/px$/);
    });

    it('a drop-zone step never ends itself: it has no control to lose', () => {
        renderPage('home');
        const onClose = vi.fn();
        startTour({ navigate, onClose });
        for (let i = 0; i < 10; i++) next();    // tef
        vi.advanceTimersByTime(5000);
        expect(onClose).not.toHaveBeenCalled();
        const ring = document.querySelector('.tour-ring');
        expect(ring.classList.contains('hidden')).toBe(false);
        expect(ring.classList.contains('tour-ping')).toBe(false);   // the last step's ripple stopped
    });

    // --- the search demo (what it looks like on the real page: e2e/tour.spec.js)

    const words = SEARCH_DEMO_QUERY.split(' ');
    const searchHooks = () => ({ fill: vi.fn(), run: vi.fn() });

    it('the search demo types the line, searching at each word, then rings the top result', async () => {
        renderPage('home');
        Element.prototype.getBoundingClientRect.mockImplementation(function () {
            if (this.closest('.hidden')) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
            if (this.matches('.result-item')) return { left: 100, top: 200, width: 300, height: 40, right: 400, bottom: 240 };
            return { left: 10, top: 10, width: 40, height: 20, right: 50, bottom: 30 };
        });
        const search = searchHooks();
        startTour({ navigate, search });
        await vi.advanceTimersByTimeAsync(3000);
        expect(search.fill).not.toHaveBeenCalled();     // the first card only talks
        next();                                         // find
        await vi.advanceTimersByTimeAsync(5000);
        expect(search.run.mock.calls.map(([text]) => text))
            .toEqual(words.map((_, i) => words.slice(0, i + 1).join(' ')));
        expect(search.fill).toHaveBeenLastCalledWith(SEARCH_DEMO_QUERY);
        expect(document.querySelector('.tour-ring').style.left).toBe('96px');   // the result, not the box
    });

    it('stepping on stops the search demo where it is', async () => {
        renderPage('home');
        const search = searchHooks();
        startTour({ navigate, search });
        next();                                         // find
        await vi.advanceTimersByTimeAsync(300);
        next();                                         // key
        const typed = search.fill.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5000);
        expect(search.fill.mock.calls.length).toBe(typed);
        expect(search.run).not.toHaveBeenCalledWith(SEARCH_DEMO_QUERY);
    });

    it('under reduced motion the search demo runs the whole line at once', async () => {
        window.matchMedia = vi.fn(() => ({ matches: true }));
        try {
            renderPage('home');
            const search = searchHooks();
            startTour({ navigate, search });
            next();
            await vi.advanceTimersByTimeAsync(100);
            expect(search.fill).not.toHaveBeenCalled();
            expect(search.run.mock.calls).toEqual([[SEARCH_DEMO_QUERY]]);
        } finally {
            delete window.matchMedia;
        }
    });

    it('without search hooks the search demo shows its card and plays nothing', async () => {
        renderPage('home');
        startTour({ navigate });
        next();
        await vi.advanceTimersByTimeAsync(5000);
        expect(card().querySelector('.tour-title').textContent).toBe('Find it by the words');
    });

    // --- the editor demo's lifecycle (what it does in the editor: e2e/tour.spec.js)

    /** Two steps: a demo on the editor page that counts its waits, then the tab. */
    function demoSteps(log) {
        return [
            {
                id: 'demo', page: 'editor', targets: ['#editor-lead .cm-content'], title: 'Demo', body: '',
                async play({ wait, point }) {
                    log.push('start');
                    point('#editor-mode-chords');
                    for (let i = 0; i < 5; i++) {
                        if (!await wait(100)) { log.push('stopped'); return; }
                    }
                    log.push('done');
                },
            },
            { id: 'tab', page: 'tab', targets: ['.tab-play-btn'], title: 'Tab', body: '' },
        ];
    }
    const fakeEditor = () => ({ lead: vi.fn(async () => ({ present: { end: vi.fn() } })), reset: vi.fn() });

    it('plays a demo step once its target shows, to the end when left alone', async () => {
        renderPage('home');
        const log = [];
        const editor = fakeEditor();
        startTour({ steps: demoSteps(log), navigate, editor });
        await vi.advanceTimersByTimeAsync(0);
        expect(log).toEqual(['start']);
        expect(editor.lead).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(600);
        expect(log).toEqual(['start', 'done']);
    });

    it('a step change stops the demo, and the editor is reset BEFORE the tour leaves it', async () => {
        renderPage('home');
        const log = [];
        const editor = fakeEditor();
        startTour({ steps: demoSteps(log), navigate, editor });
        await vi.advanceTimersByTimeAsync(150);
        next();                                 // to the tab
        await vi.advanceTimersByTimeAsync(200);
        expect(log).toEqual(['start', 'stopped']);
        expect(editor.reset).toHaveBeenCalledTimes(1);
        // reset ran before the navigation, so leaving never asks about unsaved changes
        expect(editor.reset.mock.invocationCallOrder[0])
            .toBeLessThan(navigate.mock.invocationCallOrder.at(-1));
        expect(navigate).toHaveBeenLastCalledWith(TOUR_ROUTES.tab);
    });

    it('closing the tour in the editor resets it; closing elsewhere leaves the editor alone', async () => {
        renderPage('home');
        const editor = fakeEditor();
        startTour({ steps: demoSteps([]), navigate, editor });
        await vi.advanceTimersByTimeAsync(0);
        card().querySelector('.tour-close').click();
        expect(editor.reset).toHaveBeenCalledTimes(1);

        renderPage('home');
        const other = fakeEditor();
        startTour({ navigate, editor: other });   // the real steps: step 1 is on the search page
        card().querySelector('.tour-close').click();
        expect(other.reset).not.toHaveBeenCalled();
    });

    it('without editor hooks a demo step shows its card and plays nothing', async () => {
        renderPage('home');
        const log = [];
        startTour({ steps: demoSteps(log), navigate });
        await vi.advanceTimersByTimeAsync(600);
        expect(log).toEqual([]);
        expect(card().querySelector('.tour-title').textContent).toBe('Demo');
    });

    it('× closes the tour without moving the reader', () => {
        renderPage('home');
        const onClose = vi.fn();
        startTour({ navigate, onClose });
        card().querySelector('.tour-close').click();
        expect(onClose).toHaveBeenCalledWith({ finished: false, step: TOUR_STEPS[0], index: 0 });
        expect(navigate).toHaveBeenCalledTimes(1);   // only step 1's own visit
        expect(card()).toBeNull();
    });

    it('Escape in the card closes it', () => {
        renderPage('home');
        const onClose = vi.fn();
        startTour({ navigate, onClose });
        card().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('gets out of the way when the reader wanders off (the control is gone)', () => {
        renderPage('home');
        const onClose = vi.fn();
        startTour({ navigate, onClose });
        vi.advanceTimersByTime(300);
        document.querySelector('main').innerHTML = '';   // they opened something else
        vi.advanceTimersByTime(1000);
        expect(onClose).not.toHaveBeenCalled();          // a re-render is not leaving
        vi.advanceTimersByTime(1000);
        expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ finished: false }));
        expect(card()).toBeNull();
    });

    it('waits for a control that has not rendered yet instead of giving up', () => {
        renderPage('home');
        const onClose = vi.fn();
        navigate = vi.fn(() => renderPage('home'));   // the song never arrives
        startTour({ navigate, onClose });
        vi.advanceTimersByTime(30000);
        expect(onClose).not.toHaveBeenCalled();
        expect(card().dataset.placement).toBe('rest');
    });
});
