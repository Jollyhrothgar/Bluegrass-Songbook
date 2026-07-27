// Theme reactivity: SVG attributes bake colors in, so the renderer must
// re-read CSS variables and re-render when data-theme flips — a stale
// palette left inverted fret chips over the staff after toggling.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TabRenderer } from '../renderers/tablature.js';

const TRACK = {
    id: 'banjo', instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};
const NOTATION = [
    { measure: 1, events: [{ tick: 0, notes: [{ s: 1, f: 0 }] }] },
];

function setVars(vars) {
    for (const [k, v] of Object.entries(vars)) {
        document.documentElement.style.setProperty(k, v);
    }
}

describe('TabRenderer theme handling', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        setVars({ '--bg': '#fff', '--text': '#000', '--text-secondary': '#666', '--accent': '#007bff' });
    });

    afterEach(() => {
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.removeAttribute('style');
        container.remove();
    });

    it('reads the palette from CSS variables at construction', () => {
        const r = new TabRenderer(container);
        expect(r.options.fretColor).toBe('#000');
        expect(r.options.fretBgColor).toBe('#fff');
        expect(r.options.stemColor).toBe('#666');   // was hardcoded #333
        expect(r.options.mutedColor).toBe('#666');
    });

    it('explicit color options are never overwritten by theme refreshes', () => {
        const r = new TabRenderer(container, { fretColor: 'red' });
        expect(r.options.fretColor).toBe('red');
        setVars({ '--text': '#fff' });
        r._refreshThemeColors();
        expect(r.options.fretColor).toBe('red');      // caller's choice wins
        expect(r.options.stemColor).toBe('#666');     // themed keys still update
    });

    it('re-renders with the new palette when data-theme changes', async () => {
        const r = new TabRenderer(container);
        r.render(TRACK, NOTATION);
        const spy = vi.spyOn(r, '_renderInternal');

        setVars({ '--bg': '#000', '--text': '#fff' });
        document.documentElement.setAttribute('data-theme', 'dark');
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        expect(r.options.fretColor).toBe('#fff');
        expect(r.options.fretBgColor).toBe('#000');
    });

    it('destroy() disconnects the theme observer', async () => {
        const r = new TabRenderer(container);
        r.render(TRACK, NOTATION);
        expect(r._themeObserver).toBeTruthy();
        r.destroy();
        expect(r._themeObserver).toBeNull();
        const spy = vi.spyOn(r, '_renderInternal');
        document.documentElement.setAttribute('data-theme', 'dark');
        await new Promise(res => setTimeout(res, 20));
        expect(spy).not.toHaveBeenCalled();
    });
});
