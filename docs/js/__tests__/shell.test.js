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
