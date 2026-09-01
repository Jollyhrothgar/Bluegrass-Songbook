// @vitest-environment jsdom
// The shell's global notice bar (bannerMarkup + setBanner), added for the
// corpus-load-failure banner (triage, 2026-08-16 — "Tab a Song" said "No
// song by that name" for Foggy Mountain because index.jsonl failed to load
// and nothing surfaced that beyond a hidden results div). The shell owns no
// app state, so these tests exercise the generic notice-bar primitive, not
// anything corpus-specific.
import { describe, it, expect, vi } from 'vitest';

import { bannerMarkup } from '../shell.js';

describe('bannerMarkup (pure)', () => {
    it('includes the message, escaped', () => {
        const html = bannerMarkup('Oops <b>bad</b>');
        expect(html).toContain('Oops &lt;b&gt;bad&lt;/b&gt;');
    });

    it('includes a retry button by default', () => {
        const html = bannerMarkup('Failed to load');
        expect(html).toContain('app-banner-retry');
        expect(html).toContain('Retry');
    });

    it('omits the retry button when retry: false', () => {
        const html = bannerMarkup('Just a notice', { retry: false });
        expect(html).not.toContain('app-banner-retry');
    });

    it('always includes a dismiss button', () => {
        const html = bannerMarkup('Anything');
        expect(html).toContain('app-banner-dismiss');
    });

    it('honors a custom retry label', () => {
        const html = bannerMarkup('Failed', { retryLabel: 'Try again' });
        expect(html).toContain('Try again');
    });
});

// initShell() no-ops on a second call (module-scoped `if (topbarEl) return`
// guard, by design — see shell.js). Each test below resets the module
// registry so it gets a fresh shell mounted onto a fresh document.body.
describe('setBanner (DOM)', () => {
    it('shows a message with a working retry and dismiss', async () => {
        vi.resetModules();
        document.body.innerHTML = '';
        const { initShell, setBanner } = await import('../shell.js');
        initShell({ nav: [] });

        const onRetry = vi.fn();
        const onDismiss = vi.fn();
        setBanner('The songbook index failed to load — search and song lists will be empty.', { onRetry, onDismiss });

        const banner = document.getElementById('app-banner');
        expect(banner.classList.contains('hidden')).toBe(false);
        expect(banner.textContent).toContain('The songbook index failed to load');

        banner.querySelector('.app-banner-retry').click();
        expect(onRetry).toHaveBeenCalledTimes(1);

        banner.querySelector('.app-banner-dismiss').click();
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(banner.classList.contains('hidden')).toBe(true);
    });

    it('hides when called with a falsy message', async () => {
        vi.resetModules();
        document.body.innerHTML = '';
        const { initShell, setBanner } = await import('../shell.js');
        initShell({ nav: [] });

        setBanner('Something went wrong');
        expect(document.getElementById('app-banner').classList.contains('hidden')).toBe(false);

        setBanner(null);
        expect(document.getElementById('app-banner').classList.contains('hidden')).toBe(true);
    });

    it('omits the retry button when no onRetry is given', async () => {
        vi.resetModules();
        document.body.innerHTML = '';
        const { initShell, setBanner } = await import('../shell.js');
        initShell({ nav: [] });

        setBanner('Just a notice');
        const banner = document.getElementById('app-banner');
        expect(banner.querySelector('.app-banner-retry')).toBeNull();
    });
});

// The density ladder (shell.js updateDensity), added for the overlapping-band
// bug: at ~810-830px the "Lists" nav link painted 22px over the "Lists" action
// button, and "Add Song" wrapped to two lines from ~840px down. The old
// collapse was a single @media (max-width: 800px) breakpoint, which cannot
// know what the band is currently carrying — the actions differ per view and
// a signed-in display name is as long as the person is. So the band measures
// itself instead. jsdom has no layout, so these tests drive the measurement
// directly: clientWidth is the band, scrollWidth is what the content needs at
// whatever density step is currently applied.
describe('density ladder', () => {
    const NAV = [
        { id: 'search', label: 'Search', href: '#search', onClick: () => {} },
        { id: 'lists', label: 'Lists', href: '#lists', onClick: () => {} },
    ];

    // Each rung is worth 100px, so a band of width W settles on the first
    // step whose content fits: full=1000, snug=900, no-name=800, no-title=700,
    // icons=600, nav-icons=500, nav-overflow=400.
    function mountBand(bandWidth) {
        const bar = document.getElementById('app-topbar');
        Object.defineProperty(bar, 'clientWidth', { get: () => bandWidth, configurable: true });
        Object.defineProperty(bar, 'scrollWidth', {
            configurable: true,
            get: () => 1000 - 100 * [...bar.classList].filter(c => c.startsWith('density-')).length,
        });
        return bar;
    }

    async function freshShell() {
        vi.resetModules();
        document.body.innerHTML = '';
        const mod = await import('../shell.js');
        mod.initShell({ nav: NAV });
        return mod;
    }

    it('stays at full density when the content already fits', async () => {
        const { updateDensity } = await freshShell();
        const bar = mountBand(1000);
        updateDensity();

        expect(bar.dataset.density).toBe('full');
        expect([...bar.classList].filter(c => c.startsWith('density-'))).toEqual([]);
    });

    it('sheds only as many steps as it takes to fit', async () => {
        const { updateDensity } = await freshShell();
        const bar = mountBand(850);
        updateDensity();

        // 1000 and 900 overflow an 850px band; 800 fits.
        expect(bar.dataset.density).toBe('no-name');
        expect(bar.classList.contains('density-snug')).toBe(true);
        expect(bar.classList.contains('density-no-name')).toBe(true);
        expect(bar.classList.contains('density-no-title')).toBe(false);
    });

    it('bottoms out at nav-overflow and moves the nav into the ⋯ menu', async () => {
        const { updateDensity } = await freshShell();
        const bar = mountBand(200);   // nothing fits
        updateDensity();

        expect(bar.dataset.density).toBe('nav-overflow');
        const menuLabels = [...document.querySelectorAll('#topbar-overflow-menu .pill-popover-item')]
            .map(b => b.textContent);
        expect(menuLabels).toEqual(['Search', 'Lists']);
        // and the rolled-up entries are wired to the same handlers
        expect(document.getElementById('overflow-nav-search')).not.toBeNull();
    });

    it('climbs back up and returns the nav to the band when room comes back', async () => {
        const { updateDensity } = await freshShell();
        let width = 200;
        const bar = document.getElementById('app-topbar');
        Object.defineProperty(bar, 'clientWidth', { get: () => width, configurable: true });
        Object.defineProperty(bar, 'scrollWidth', {
            configurable: true,
            get: () => 1000 - 100 * [...bar.classList].filter(c => c.startsWith('density-')).length,
        });

        updateDensity();
        expect(bar.dataset.density).toBe('nav-overflow');

        width = 1000;
        updateDensity();
        expect(bar.dataset.density).toBe('full');
        expect([...bar.classList].filter(c => c.startsWith('density-'))).toEqual([]);
        // nav is back in the band, so it must not be duplicated in the menu
        const menuLabels = [...document.querySelectorAll('#topbar-overflow-menu .pill-popover-item')]
            .map(b => b.textContent);
        expect(menuLabels).toEqual([]);
    });

    it('re-measures when a view swaps its actions in', async () => {
        const { updateDensity, setTopBar } = await freshShell();
        const bar = mountBand(850);
        updateDensity();
        expect(bar.dataset.density).toBe('no-name');

        // A view whose actions are wider: every step now costs the band 50px
        // less, so it has to shed further to fit the same 850px.
        Object.defineProperty(bar, 'scrollWidth', {
            configurable: true,
            get: () => 1200 - 100 * [...bar.classList].filter(c => c.startsWith('density-')).length,
        });
        setTopBar({ actions: [{ id: 'export', label: 'Export', onClick: () => {} }] });

        expect(bar.dataset.density).toBe('icons');
    });
});
