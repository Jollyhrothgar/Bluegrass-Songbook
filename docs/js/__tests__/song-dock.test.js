// The song page's reading dock (G19b): which choices View offers a song, and
// the pieces the dock is drawn from.
import { describe, it, expect, vi } from 'vitest';
import { viewModel, viewControl, sizeControl, fillViewSheet, readingDock } from '../song-dock.js';

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
            { id: 'banjo-tab', label: 'Banjo Tab', on: true },
            { id: 'mandolin-tab', label: 'Mandolin Tab', on: false },
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

describe('the dock pieces', () => {
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
        expect(rows.map(r => r.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Lyrics✓', 'Chart', 'Banjo Tab']);
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
