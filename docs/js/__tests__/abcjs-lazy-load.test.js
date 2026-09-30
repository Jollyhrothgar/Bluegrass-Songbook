// abcjs is loaded on demand with a single cached promise (perf B4).
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('loadAbcjs', () => {
    let loadAbcjs;

    beforeEach(async () => {
        vi.resetModules();
        delete globalThis.ABCJS;
        document.head.innerHTML = '';
        ({ loadAbcjs } = await import('../song-view.js'));
    });

    const scripts = () => document.head.querySelectorAll('script[src*="abcjs"]');

    it('injects one script for concurrent callers and resolves to the global', async () => {
        const a = loadAbcjs();
        const b = loadAbcjs();
        expect(a).toBe(b);
        expect(scripts().length).toBe(1);
        globalThis.ABCJS = { renderAbc: () => [] };
        scripts()[0].onload();
        expect(await a).toBe(globalThis.ABCJS);
        // Already present: no further script
        await loadAbcjs();
        expect(scripts().length).toBe(1);
    });

    it('resolves null on failure and allows a retry', async () => {
        const first = loadAbcjs();
        scripts()[0].onerror();
        expect(await first).toBeNull();
        expect(scripts().length).toBe(0);
        const second = loadAbcjs();
        expect(second).not.toBe(first);
        expect(scripts().length).toBe(1);
    });
});
