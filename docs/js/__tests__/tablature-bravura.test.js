// Bravura (the SMuFL music font): pinned, loaded once, and a staff is
// re-engraved when it arrives ONLY if the drawing on screen was made without
// it. Before this, every TabRenderer redrew itself on every open because the
// font promise resolves on a microtask even when the font was ready long ago.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { TabRenderer } from '../renderers/tablature.js';

const TRACK = {
    id: 'banjo',
    instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};
const NOTATION = [{ measure: 1, events: [{ tick: 0, notes: [{ s: 1, f: 0, dur: 480 }] }] }];

const hadReady = TabRenderer._bravuraReady;
const hadPromise = TabRenderer._bravuraPromise;
afterEach(() => {
    TabRenderer._bravuraReady = hadReady;
    TabRenderer._bravuraPromise = hadPromise;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

/** A promise the test settles by hand. */
function deferred() {
    let resolve;
    const promise = new Promise(res => { resolve = res; });
    return { promise, resolve };
}

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderer = new TabRenderer(container);
    const draws = vi.spyOn(renderer, '_renderInternal');
    return { renderer, draws };
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('redraw when Bravura arrives', () => {
    it('does NOT redraw when the font was already ready for the first draw', async () => {
        TabRenderer._bravuraReady = true;
        vi.spyOn(TabRenderer, '_ensureBravura').mockResolvedValue();
        const { renderer, draws } = mount();
        renderer.render(TRACK, NOTATION, 480, '4/4');
        await flush();
        expect(draws).toHaveBeenCalledTimes(1);
    });

    it('redraws exactly once when the font lands AFTER a fallback-digit draw', async () => {
        TabRenderer._bravuraReady = false;
        const font = deferred();
        vi.spyOn(TabRenderer, '_ensureBravura').mockReturnValue(font.promise);
        const { renderer, draws } = mount();
        renderer.render(TRACK, NOTATION, 480, '4/4');
        expect(draws).toHaveBeenCalledTimes(1);

        TabRenderer._bravuraReady = true;      // what _ensureBravura does on load
        font.resolve();
        await flush();
        expect(draws).toHaveBeenCalledTimes(2);   // the fallback draw, then the engraved one
    });

    it('does not redraw a second time once the staff has been drawn WITH the font', async () => {
        TabRenderer._bravuraReady = false;
        const font = deferred();
        vi.spyOn(TabRenderer, '_ensureBravura').mockReturnValue(font.promise);
        const { renderer, draws } = mount();
        renderer.render(TRACK, NOTATION, 480, '4/4');
        TabRenderer._bravuraReady = true;
        renderer._renderInternal();            // e.g. a resize or theme redraw got there first
        draws.mockClear();
        font.resolve();
        await flush();
        expect(draws).not.toHaveBeenCalled();
    });

    it('never redraws when the font failed to load (fallback digits are final)', async () => {
        TabRenderer._bravuraReady = false;
        vi.spyOn(TabRenderer, '_ensureBravura').mockResolvedValue();
        const { renderer, draws } = mount();
        renderer.render(TRACK, NOTATION, 480, '4/4');
        await flush();
        expect(draws).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a renderer that was never given a track', async () => {
        TabRenderer._bravuraReady = true;
        vi.spyOn(TabRenderer, '_ensureBravura').mockResolvedValue();
        const { draws } = mount();
        await flush();
        expect(draws).not.toHaveBeenCalled();
    });
});

describe('the pinned font', () => {
    it('is a release tag, not @latest (which is the repo HEAD)', () => {
        expect(TabRenderer.BRAVURA_URL).toMatch(/steinbergmedia\/bravura@bravura-\d+\.\d+\//);
        expect(TabRenderer.BRAVURA_URL).not.toMatch(/@latest|@master|@main/);
        expect(TabRenderer.BRAVURA_URL).toMatch(/Bravura\.woff2$/);
    });

    it('is what the injected @font-face points at', () => {
        TabRenderer._bravuraPromise = undefined;
        TabRenderer._ensureBravura();
        const css = [...document.head.querySelectorAll('style')].map(s => s.textContent).join('\n');
        expect(css).toContain(TabRenderer.BRAVURA_URL);
        expect(css).toContain("font-family: 'Bravura'");
    });

    it('is loaded once per page however many staves ask', () => {
        TabRenderer._bravuraPromise = undefined;
        const before = document.head.querySelectorAll('style').length;
        const a = TabRenderer._ensureBravura();
        const b = TabRenderer._ensureBravura();
        expect(a).toBe(b);
        expect(document.head.querySelectorAll('style').length).toBe(before + 1);
    });
});

describe('whenBravuraReady', () => {
    beforeEach(() => vi.useFakeTimers());

    it('resolves as soon as the font settles, without waiting out the cap', async () => {
        const font = deferred();
        vi.spyOn(TabRenderer, '_ensureBravura').mockReturnValue(font.promise);
        let done = false;
        TabRenderer.whenBravuraReady(250).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(10);
        expect(done).toBe(false);
        font.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(done).toBe(true);
        expect(vi.getTimerCount()).toBe(0);      // the cap timer is cleaned up
    });

    it('gives up after the cap so a slow CDN cannot hold the page hostage', async () => {
        vi.spyOn(TabRenderer, '_ensureBravura').mockReturnValue(new Promise(() => {}));
        let done = false;
        TabRenderer.whenBravuraReady(250).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(249);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(done).toBe(true);
    });
});
