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

// G19: the thin top dock, its ⋯ menu and the dialog sheet.
describe('the thin top dock', () => {
    async function dockShell() {
        vi.resetModules();
        document.body.innerHTML = '';
        const mod = await import('../shell.js');
        const search = vi.fn();
        mod.initShell({ nav: [{ id: 'search', label: 'Search', href: '#search', onClick: search }] });
        return { ...mod, search };
    }
    const menuText = () => document.getElementById('topbar-overflow-menu').textContent;
    const open = () => document.getElementById('topbar-overflow-btn').click();

    it('marks the band as a dock, adds search for a song page, and labels the back arrow', async () => {
        const { setTopBar, search } = await dockShell();
        setTopBar({ dock: 'song', back: { onClick() {}, label: 'Friday Jam' } });

        const bar = document.getElementById('app-topbar');
        expect(bar.classList.contains('topbar-dock')).toBe(true);
        expect(document.querySelector('#topbar-back .topbar-back-label').textContent).toBe('Friday Jam');
        expect(document.getElementById('topbar-back').getAttribute('aria-label')).toBe('Back to Friday Jam');
        document.getElementById('topbar-search').click();
        expect(search).toHaveBeenCalledTimes(1);

        // the editor's dock has no search, and a plain page is not a dock
        setTopBar({ dock: 'editor', back: { onClick() {} } });
        expect(document.getElementById('topbar-search')).toBeNull();
        setTopBar({});
        expect(bar.classList.contains('topbar-dock')).toBe(false);
    });

    it('builds the ⋯ menu from the page, the site, then the site-wide entries, skipping empty groups', async () => {
        const { setTopBar, setMenuSite, setOverflowBase } = await dockShell();
        setMenuSite(() => [{ title: 'Go to', items: [{ label: 'Favorites', onClick() {} }] }]);
        setOverflowBase([{ label: 'About', onClick() {} }]);
        setTopBar({
            dock: 'song',
            menu: [
                { title: 'This song', items: [{ label: 'Save to list…', onClick() {} }] },
                { title: 'Trusted and admin', items: [] },
            ],
        });
        open();
        const titles = [...document.querySelectorAll('.menu-section-title')].map(t => t.textContent);
        expect(titles).toEqual(['This song', 'Go to']);
        expect(menuText().indexOf('Save to list')).toBeLessThan(menuText().indexOf('Favorites'));
        expect(menuText().indexOf('Favorites')).toBeLessThan(menuText().indexOf('About'));
    });

    it('runs an item and closes the menu', async () => {
        const { setTopBar } = await dockShell();
        const onClick = vi.fn();
        setTopBar({ dock: 'song', menu: [{ title: 'This song', items: [{ id: 'save', label: 'Save', onClick }] }] });
        open();
        document.getElementById('save').click();
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(document.getElementById('topbar-overflow-menu').classList.contains('hidden')).toBe(true);
    });

    it('expands a row in place with aria-expanded, and its choices run and close', async () => {
        const { setTopBar } = await dockShell();
        const print = vi.fn();
        setTopBar({
            dock: 'song',
            menu: [{ title: 'This song', items: [{
                id: 'export', label: 'Export / Print',
                items: [{ label: 'Print', action: 'print', onClick: print }, { label: 'Copy', onClick() {} }],
            }] }],
        });
        open();
        const row = document.getElementById('export');
        const sub = document.getElementById(row.getAttribute('aria-controls'));
        expect(row.getAttribute('aria-expanded')).toBe('false');
        expect(sub.classList.contains('hidden')).toBe(true);

        row.click();
        expect(row.getAttribute('aria-expanded')).toBe('true');
        expect(sub.classList.contains('hidden')).toBe(false);

        sub.querySelector('[data-action="print"]').click();
        expect(print).toHaveBeenCalledTimes(1);
        expect(document.getElementById('topbar-overflow-menu').classList.contains('hidden')).toBe(true);
    });

    it('draws a segmented row and reports the choice', async () => {
        const { setTopBar, setMenuSite } = await dockShell();
        const onSelect = vi.fn();
        setMenuSite(() => [{ title: 'You', items: [{
            type: 'segmented', label: 'Theme', value: 'auto', onSelect,
            options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'Auto' }],
        }] }]);
        setTopBar({ dock: 'song' });
        open();
        const dark = document.querySelector('.menu-segmented-btn[data-value="dark"]');
        expect(document.querySelector('.menu-segmented-btn[aria-pressed="true"]').dataset.value).toBe('auto');
        dark.click();
        expect(onSelect).toHaveBeenCalledWith('dark');
        expect(dark.getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps ⋯ honest for assistive tech: aria-expanded follows it, Esc closes and refocuses it', async () => {
        const { setTopBar } = await dockShell();
        setTopBar({ dock: 'song', menu: [{ title: 'This song', items: [{ label: 'Save', onClick() {} }] }] });
        const btn = document.getElementById('topbar-overflow-btn');
        expect(btn.getAttribute('aria-controls')).toBe('topbar-overflow-menu');
        expect(btn.getAttribute('aria-expanded')).toBe('false');

        btn.click();
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        document.body.focus();
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(btn.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(btn);
    });

    it('rebuilds the menu each time it opens, so "who is signed in" is never stale', async () => {
        const { setTopBar, setMenuSite } = await dockShell();
        let who = 'Sign in';
        setMenuSite(() => [{ title: 'You', items: [{ label: who, onClick() {} }] }]);
        setTopBar({ dock: 'song' });
        open();
        expect(menuText()).toContain('Sign in');
        open();                      // close
        who = 'Mike';
        open();
        expect(menuText()).toContain('Mike');
    });

    it('a first visit glows ⋯ instead of showing the Tour button', async () => {
        const { setTourInvite } = await dockShell();
        setTourInvite(true);
        expect(document.getElementById('topbar-overflow-btn').classList.contains('tour-invite')).toBe(true);
        expect(document.getElementById('topbar-tour').classList.contains('hidden')).toBe(false);
        setTourInvite(false);
        expect(document.getElementById('topbar-overflow-btn').classList.contains('tour-invite')).toBe(false);
    });

    it('does not move the nav into ⋯ at the last density step (Go to already has it)', async () => {
        const { setTopBar, updateDensity } = await dockShell();
        setTopBar({ dock: 'song' });
        const bar = document.getElementById('app-topbar');
        Object.defineProperty(bar, 'clientWidth', { get: () => 100, configurable: true });
        Object.defineProperty(bar, 'scrollWidth', { get: () => 1000, configurable: true });
        updateDensity();
        expect(document.getElementById('overflow-nav-search')).toBeNull();
    });
});

describe('openSheet', () => {
    async function sheetShell() {
        vi.resetModules();
        document.body.innerHTML = '<button id="opener">Details</button>';
        return import('../shell.js');
    }

    it('opens a labelled dialog, and Esc closes it and returns focus to the opener', async () => {
        const { openSheet } = await sheetShell();
        const opener = document.getElementById('opener');
        openSheet({ id: 'demo-sheet', title: 'Details', opener, build(el) { el.textContent = 'facts'; } });

        const sheet = document.getElementById('demo-sheet');
        expect(sheet.getAttribute('role')).toBe('dialog');
        expect(sheet.getAttribute('aria-labelledby')).toBe('demo-sheet-title');
        expect(sheet.textContent).toContain('facts');
        expect(opener.getAttribute('aria-expanded')).toBe('true');
        expect(opener.getAttribute('aria-controls')).toBe('demo-sheet');

        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.getElementById('demo-sheet')).toBeNull();
        expect(document.querySelector('.notes-sheet-backdrop')).toBeNull();
        expect(opener.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(opener);
    });

    it('closes from the × and from the scrim, and only one is open at a time', async () => {
        const { openSheet } = await sheetShell();
        openSheet({ id: 'a-sheet', title: 'A', build() {} });
        openSheet({ id: 'b-sheet', title: 'B', build() {} });
        expect(document.getElementById('a-sheet')).toBeNull();

        document.querySelector('#b-sheet .notes-sheet-close').click();
        expect(document.getElementById('b-sheet')).toBeNull();

        openSheet({ id: 'c-sheet', title: 'C', build() {} });
        document.querySelector('.notes-sheet-backdrop').click();
        expect(document.getElementById('c-sheet')).toBeNull();
    });
});
