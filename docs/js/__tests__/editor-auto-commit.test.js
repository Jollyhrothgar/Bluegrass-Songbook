// @vitest-environment jsdom
// The trusted-user save path is two steps: write pending_songs (instant, live)
// then trigger auto-commit-song (durable, in git). Step 2 used to be truly
// fire-and-forget — it awaited the fetch but never checked response.ok, so a
// failing commit resolved successfully and left a pending_songs row that
// nothing retried and nobody heard about.
//
// These cover the client half of the fix: the trigger rejects when the commit
// did not happen, and the toast tells the user their edit is live but unsynced.
// The retry half lives in supabase/functions/reconcile-pending.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { triggerAutoCommit } from '../editor.js';
import { showToast, TOAST_DURATION_MS } from '../toast.js';

const ENTRY = { id: 'blue-moon-of-kentucky', title: 'Blue Moon of Kentucky', content: '[G]hello' };

function mockSession(token = 'tok') {
    window.SupabaseAuth = {
        supabase: {
            auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) }
        }
    };
}

describe('triggerAutoCommit', () => {
    beforeEach(() => {
        mockSession();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.SupabaseAuth;
    });

    it('resolves when the function commits', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
        vi.stubGlobal('fetch', fetchMock);

        // Resolves with the function's body: the server's classification of
        // what the submission actually did (create / update / fork).
        await expect(triggerAutoCommit(ENTRY)).resolves.toEqual({ success: true });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/functions/v1/auto-commit-song');
        expect(init.headers.Authorization).toBe('Bearer tok');
        expect(JSON.parse(init.body).id).toBe('blue-moon-of-kentucky');
    });

    it('rejects on a non-ok response instead of resolving silently', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 500,
            json: async () => ({ error: 'GITHUB_PAT not configured' }),
        })));

        await expect(triggerAutoCommit(ENTRY)).rejects.toThrow(/500.*GITHUB_PAT not configured/);
    });

    it('rejects on a non-ok response with an unparseable body', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 502,
            json: async () => { throw new SyntaxError('not json'); },
        })));

        await expect(triggerAutoCommit(ENTRY)).rejects.toThrow(/502/);
    });

    it('rejects when there is no session rather than pretending it synced', async () => {
        mockSession(null);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(triggerAutoCommit(ENTRY)).rejects.toThrow(/session/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when the network call itself fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

        await expect(triggerAutoCommit(ENTRY)).rejects.toThrow(/Failed to fetch/);
    });
});

describe('showToast', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
        // jsdom's rAF is timer-backed; make it synchronous for the visibility check
        vi.stubGlobal('requestAnimationFrame', (cb) => cb());
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('shows a success toast by default and removes it afterwards', () => {
        const el = showToast('Saved!');
        expect(el.className).toBe('auth-toast visible');
        expect(el.textContent).toBe('Saved!');
        expect(document.body.contains(el)).toBe(true);

        vi.advanceTimersByTime(TOAST_DURATION_MS + 300);
        expect(document.body.contains(el)).toBe(false);
    });

    it('marks a warning toast so the still-syncing case reads differently', () => {
        const el = showToast('still syncing', { variant: 'warning', duration: 6000 });
        expect(el.classList.contains('warning')).toBe(true);

        // honours the longer duration
        vi.advanceTimersByTime(TOAST_DURATION_MS + 300);
        expect(document.body.contains(el)).toBe(true);
        vi.advanceTimersByTime(6000);
        expect(document.body.contains(el)).toBe(false);
    });

    it('escapes nothing into markup — message is set as text', () => {
        const el = showToast('<img src=x onerror=alert(1)>');
        expect(el.querySelector('img')).toBeNull();
        expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
    });
});
