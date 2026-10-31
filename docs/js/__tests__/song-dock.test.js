// The song page's reading dock (G19b): which choices View offers a song, and
// the pieces the dock is drawn from.
import { describe, it, expect, vi } from 'vitest';
import { viewModel, viewControl, sizeControl, fillViewSheet, readingDock, tempoControl } from '../song-dock.js';

const lead = (label = 'Lyrics & Chords') => ({ type: 'lead-sheet', partId: 'lyrics', label });
const chart = { type: 'chord-chart', partId: 'chart', label: 'Chart' };
const banjo = { type: 'tablature', partId: 'banjo-tab', label: 'Banjo Tab' };
const mando = { type: 'tablature', partId: 'mandolin-tab', label: 'Mandolin Tab' };
const ids = (m) => m.choices.map(c => c.id);
const on = (m) => m.choices.filter(c => c.on).map(c => c.id);

describe('viewModel', () => {
    it('a lone lead sheet has nothing to choose', () => {
        const L = lead();
        expect(viewModel({ parts: [L], active: L }).kind).toBe('none');
    });

    it('lyrics and a chart: a Lyrics | Chart segmented control', () => {
        const L = lead('Lyrics');
        const m = viewModel({ parts: [L, chart], active: L });
        expect(m.kind).toBe('segmented');
        expect(ids(m)).toEqual(['lyrics', 'chart']);
        expect(on(m)).toEqual(['lyrics']);
        expect(on(viewModel({ parts: [L, chart], active: chart }))).toEqual(['chart']);
    });

    it('wide screens add Lyrics + Chart, today\'s two columns, and remember which of the two lyric views it is', () => {
        const L = lead('Lyrics');
        const m = viewModel({ parts: [L, chart], active: L, wide: true, beside: true });
        expect(m.kind).toBe('segmented');
        expect(ids(m)).toEqual(['lyrics', 'both', 'chart']);
        expect(on(m)).toEqual(['both']);
        expect(on(viewModel({ parts: [L, chart], active: L, wide: true, beside: false }))).toEqual(['lyrics']);
        expect(on(viewModel({ parts: [L, chart], active: chart, wide: true, beside: true }))).toEqual(['chart']);
    });

    it('a narrow screen shows Lyrics even when Lyrics + Chart is what the reader last chose', () => {
        const L = lead('Lyrics');
        expect(on(viewModel({ parts: [L, chart], active: L, wide: false, beside: true }))).toEqual(['lyrics']);
    });

    it('versions turn it into View ▾ with a sheet, even with nothing else to pick', () => {
        const L = lead();
        const m = viewModel({ parts: [L], active: L, versions: true });
        expect(m.kind).toBe('sheet');
        expect(m.versions).toBe(true);
        expect(viewModel({ parts: [L, chart], active: L, versions: true }).kind).toBe('sheet');
    });

    it('other parts become Tabs in the sheet, the one on screen marked', () => {
        const L = lead();
        const m = viewModel({ parts: [L, banjo, mando], active: banjo });
        expect(m.kind).toBe('sheet');
        expect(m.tabs).toEqual([
            { id: 'banjo-tab', label: 'Banjo Tab', on: true, takes: [] },
            { id: 'mandolin-tab', label: 'Mandolin Tab', on: false, takes: [] },
        ]);
        expect(on(m)).toEqual([]);   // on a tab, no lyric choice is current
    });

    it('a hybrid ABC + chords lead sheet offers Chords and Notation in the sheet', () => {
        const L = { type: 'lead-sheet', partId: 'notation', label: 'Notation' };
        const m = viewModel({ parts: [L], active: L, hybrid: true, abcShown: true });
        expect(m.kind).toBe('sheet');
        expect(ids(m)).toEqual(['chords', 'notation']);
        expect(on(m)).toEqual(['notation']);
        expect(on(viewModel({ parts: [L], active: L, hybrid: true, abcShown: false }))).toEqual(['chords']);
    });

    it('a tab-only song with one tab has nothing to choose; with two instruments it has a sheet', () => {
        expect(viewModel({ parts: [banjo], active: banjo }).kind).toBe('none');
        expect(viewModel({ parts: [banjo, mando], active: banjo }).kind).toBe('sheet');
    });

    it('notation alone, with one tab, still reaches the tab', () => {
        const L = { type: 'lead-sheet', partId: 'notation', label: 'Notation' };
        const m = viewModel({ parts: [L, banjo], active: L });
        expect(m.kind).toBe('sheet');
        expect(ids(m)).toEqual(['lyrics']);
        expect(m.choices[0].label).toBe('Notation');
    });
});

// G19c: what View offers on a tab page: the parts with their takes, and the tracks
describe('viewModel on a tab', () => {
    const take = (i, who, extra = {}) => ({ index: i, who, source: 'Banjo Hangout', pinned: i === 0, on: i === 0, ...extra });
    const nineTakes = Array.from({ length: 9 }, (_, i) => take(i, `picker${i}`));
    const banjo9 = { ...banjo, takes: nineTakes };
    const ensemble = { type: 'tablature', partId: 'ensemble-tab', label: 'Ensemble', takes: [take(0, 'GuitarTom2')] };
    const tr = (id, on) => ({ id, label: id, on });

    it('hands each tab its takes, and a part with more than one take drills', () => {
        const m = viewModel({ parts: [banjo9, ensemble], active: ensemble });
        expect(m.tabs.map(t => [t.id, t.takes.length])).toEqual([['banjo-tab', 9], ['ensemble-tab', 1]]);
        expect(m.tabs[1].on).toBe(true);
    });

    it('one tab with several takes is enough for a sheet, one take is not', () => {
        expect(viewModel({ parts: [banjo9], active: banjo9 }).kind).toBe('sheet');
        const one = { ...banjo, takes: [take(0, 'schlange')] };
        expect(viewModel({ parts: [one], active: one }).kind).toBe('none');
    });

    it('tracks appear only when the tab has more than one', () => {
        const one = { ...banjo, takes: [take(0, 'a')] };
        const alone = viewModel({ parts: [one], active: one, tracks: [tr('banjo', true)] });
        expect(alone.tracks).toEqual([]);
        expect(alone.kind).toBe('none');
        const m = viewModel({ parts: [one], active: one, tracks: [tr('banjo', true), tr('guitar', false), tr('all', false)] });
        expect(m.tracks.map(t => t.id)).toEqual(['banjo', 'guitar', 'all']);
        expect(m.kind).toBe('sheet');
    });

    it('a lyric page lists the same tabs with their takes', () => {
        const L = lead('Lyrics');
        const m = viewModel({ parts: [L, banjo9], active: L });
        expect(m.tabs[0].takes).toHaveLength(9);
        expect(m.kind).toBe('sheet');
    });
});

describe('the dock pieces', () => {
    it('the tempo control steps through the classes and ids it is given', () => {
        const el = tempoControl({ n: 120, display: { className: 'tab-tempo-display' },
            down: { className: 'tab-tempo-down' }, up: { id: 'up', className: 'tab-tempo-up' } });
        expect(el.querySelector('.tab-tempo-display').textContent).toBe('120');
        expect(el.querySelector('.tab-tempo-down').getAttribute('aria-label')).toBe('Slower');
        expect(el.querySelector('#up.tab-tempo-up').textContent).toBe('+');
        expect(el.getAttribute('aria-label')).toBe('Tempo');
    });

    it('Size steps while it may, and disables a button at its limit', () => {
        let level = 0;
        const el = sizeControl({
            canStep: (d) => level + d >= -1 && level + d <= 1,
            step: (d) => { level += d; },
        });
        const [dec, inc] = el.querySelectorAll('button');
        expect([dec.disabled, inc.disabled]).toEqual([false, false]);
        inc.click();
        expect(level).toBe(1);
        expect(inc.disabled).toBe(true);
        inc.click();
        expect(level).toBe(1);
        dec.click(); dec.click(); dec.click();
        expect(level).toBe(-1);
        expect(dec.disabled).toBe(true);
    });

    it('the segmented control picks the other segment, and the current one does nothing', () => {
        const onPick = vi.fn();
        const m = viewModel({ parts: [lead('Lyrics'), chart], active: null });
        m.choices[0].on = true;
        const el = viewControl(m, { onPick, onOpen: vi.fn() });
        const [a, b] = el.querySelectorAll('button');
        expect([a.getAttribute('aria-pressed'), b.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
        a.click();
        expect(onPick).not.toHaveBeenCalled();
        b.click();
        expect(onPick).toHaveBeenCalledWith('chart');
    });

    it('a sheet model gives a View ▾ button that opens it, and nothing gives nothing', () => {
        const onOpen = vi.fn();
        const btn = viewControl({ kind: 'sheet', choices: [], tabs: [] }, { onPick: vi.fn(), onOpen });
        expect(btn.id).toBe('dock-view-btn');
        expect(btn.textContent).toContain('View');
        btn.click();
        expect(onOpen).toHaveBeenCalledWith(btn);
        expect(viewControl({ kind: 'none', choices: [], tabs: [] }, {})).toBeNull();
    });

    it('the dock keeps what it is given, in order, and drops what it is not', () => {
        const a = document.createElement('i'); const b = document.createElement('b');
        expect([...readingDock(a, null, b).children]).toEqual([a, b]);
    });
});

describe('the View sheet', () => {
    const model = {
        kind: 'sheet', versions: true,
        choices: [{ id: 'lyrics', label: 'Lyrics', on: true }, { id: 'chart', label: 'Chart', on: false }],
        tabs: [{ id: 'banjo-tab', label: 'Banjo Tab', on: false }],
    };

    it('lists the choices, then Versions (filled by the page), then Tabs', () => {
        const el = document.createElement('div');
        const renderVersions = vi.fn((host) => { host.innerHTML = '<div class="arrangement-item">Original</div>'; });
        fillViewSheet(el, model, { onPick: vi.fn(), onPickTab: vi.fn(), renderVersions });
        expect([...el.querySelectorAll('.dock-sheet-heading')].map(h => h.textContent)).toEqual(['Versions', 'Tabs']);
        expect(el.querySelector('.dock-versions .arrangement-item')).toBeTruthy();
        const rows = [...el.querySelectorAll('.dock-row')];
        expect(rows.map(r => r.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Lyrics✓', 'Chart', 'Banjo']);
        expect(rows[0].getAttribute('aria-checked')).toBe('true');
    });

    it('a row reports its choice or its part', () => {
        const el = document.createElement('div');
        const onPick = vi.fn(); const onPickTab = vi.fn();
        fillViewSheet(el, model, { onPick, onPickTab, renderVersions: () => {} });
        el.querySelector('[data-view="chart"]').click();
        el.querySelector('[data-part="banjo-tab"]').click();
        expect(onPick).toHaveBeenCalledWith('chart');
        expect(onPickTab).toHaveBeenCalledWith('banjo-tab');
    });

    it('leaves out Versions and Tabs when the song has none', () => {
        const el = document.createElement('div');
        fillViewSheet(el, { ...model, versions: false, tabs: [] }, { onPick: vi.fn(), onPickTab: vi.fn(), renderVersions: vi.fn() });
        expect(el.querySelector('.dock-sheet-heading')).toBeNull();
    });
});

describe('the View sheet on a tab (G19c)', () => {
    const take = (i, who, source = 'Banjo Hangout') => ({ index: i, who, source, pinned: i === 0, on: i === 1 });
    const model = {
        kind: 'sheet', versions: false,
        choices: [{ id: 'lyrics', label: 'Lyrics', on: false }],
        tabs: [
            { id: 'mando', label: 'Mandolin Break', on: false, takes: [take(0, 'solo')] },
            { id: 'banjo', label: 'Banjo Tab', on: true, takes: [take(0, 'schlange'), take(1, 'banjomike'), take(2, 'tabmaster')] },
        ],
        tracks: [{ id: 'banjo', label: 'banjo', on: true }, { id: 'all', label: 'All', on: false }],
    };
    const build = (over = {}) => {
        const sheet = document.createElement('div');
        sheet.innerHTML = '<div class="notes-sheet-header"><h2 class="notes-sheet-title">View</h2></div><div class="c"></div>';
        const content = sheet.querySelector('.c');
        const fns = { onPick: vi.fn(), onPickTab: vi.fn(), onPickTake: vi.fn(), onPickTrack: vi.fn(), renderVersions: vi.fn(),
            title: sheet.querySelector('.notes-sheet-title'), ...over };
        fillViewSheet(content, model, fns);
        return { sheet, content, fns };
    };

    it('lists the tabs with their take counts, then the tracks', () => {
        const { content } = build();
        expect([...content.querySelectorAll('.dock-sheet-heading')].map(h => h.textContent)).toEqual(['Tabs', 'Tracks']);
        const banjo = content.querySelector('[data-part="banjo"]');
        expect(banjo.querySelector('.dock-count').textContent).toBe('3');
        expect(banjo.querySelector('.dock-chev')).toBeTruthy();
        expect(content.querySelector('[data-part="mando"] .dock-chev')).toBeNull();   // one take: picks straight away
        expect(content.querySelectorAll('[data-track]')).toHaveLength(2);
    });

    it('a part with one take picks it; a track picks itself', () => {
        const { content, fns } = build();
        content.querySelector('[data-part="mando"]').click();
        expect(fns.onPickTab).toHaveBeenCalledWith('mando');
        content.querySelector('[data-track="all"]').click();
        expect(fns.onPickTrack).toHaveBeenCalledWith('all');
    });

    it('a part with takes drills in: a back header, the takes with the pick and the one showing, and back again', () => {
        const { content, fns, sheet } = build();
        content.querySelector('[data-part="banjo"]').click();
        expect(fns.onPickTab).not.toHaveBeenCalled();
        const title = sheet.querySelector('.notes-sheet-title');
        expect(title.textContent).toContain('Banjo');
        expect(title.textContent).toContain('3 takes');
        const rows = [...content.querySelectorAll('.dock-take')];
        expect(rows.map(r => r.querySelector('.dock-take-who').textContent)).toEqual(['schlange', 'banjomike', 'tabmaster']);
        expect(rows[0].querySelector('.dock-pin').textContent).toBe('★');
        expect(rows[1].classList.contains('on')).toBe(true);
        expect(rows[1].getAttribute('aria-checked')).toBe('true');
        rows[2].click();
        expect(fns.onPickTake).toHaveBeenCalledWith('banjo', 2);

        title.querySelector('.dock-back').click();
        expect(sheet.querySelector('.notes-sheet-title').textContent).toBe('View');
        expect(content.querySelector('[data-part="banjo"]')).toBeTruthy();
    });
});
