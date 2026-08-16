// Tab submission client — payload shape, auth, size guard, error paths.
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    serializeForSubmission, submitTab, accessToken,
} from '../../otf-editor/submit-tab.js';

/** Install a fake SupabaseAuth with (or without) an active session. */
function mockAuth(token) {
    globalThis.window.SupabaseAuth = {
        supabase: {
            auth: {
                getSession: async () => ({
                    data: { session: token ? { access_token: token } : null },
                }),
            },
        },
    };
}

afterEach(() => { delete globalThis.window.SupabaseAuth; });

const smallOtf = () => ({
    otf_version: '1.0',
    _partFile: 'data/tabs/x.otf.json', // view-cache junk — must be stripped
    metadata: { title: 'T' },
    tracks: [{ id: 'banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
    notation: { banjo: [] },
});

describe('serializeForSubmission', () => {
    it('compacts and strips underscore-prefixed cache fields', () => {
        const s = serializeForSubmission(smallOtf());
        expect(s).not.toContain('_partFile');
        expect(s).not.toContain('\n');
        expect(JSON.parse(s).tracks[0].id).toBe('banjo');
    });

    it('refuses implausibly large payloads', () => {
        const big = smallOtf();
        big.notation.banjo = Array.from({ length: 400000 }, (_, i) => ({
            measure: i + 1,
            events: [{ tick: 0, notes: [{ s: 1, f: 0 }] }],
        }));
        expect(() => serializeForSubmission(big)).toThrow(/large/);
    });
});

describe('submitTab', () => {
    const okFetch = (result = { success: true, prNumber: 7, prUrl: 'https://x/pull/7' }) =>
        vi.fn(async () => ({ ok: true, json: async () => result }));

    it('posts the correction payload to the PR edge function', async () => {
        mockAuth('user-jwt');
        const f = okFetch();
        const out = await submitTab({
            type: 'tab-correction', otf: smallOtf(), title: 'Gold Rush',
            instrument: 'banjo', workId: 'gold-rush', comment: 'fixed m3',
        }, f);
        expect(out).toEqual({ prNumber: 7, prUrl: 'https://x/pull/7' });

        const [url, init] = f.mock.calls[0];
        expect(url).toContain('/functions/v1/create-tab-pr');
        const body = JSON.parse(init.body);
        expect(body.type).toBe('tab-correction');
        expect(body.workId).toBe('gold-rush');
        expect(body.comment).toBe('fixed m3');
        expect(JSON.parse(body.otf).tracks[0].id).toBe('banjo');

        // Identity is the verified session, derived server-side: the client
        // sends its token and claims no attribution of its own.
        expect(body.submittedBy).toBeUndefined();
        expect(init.headers.Authorization).toBe('Bearer user-jwt');
    });

    it('refuses to submit without a session', async () => {
        mockAuth(null);
        const f = okFetch();
        await expect(submitTab({
            type: 'tab-correction', otf: smallOtf(), title: 'Gold Rush',
            instrument: 'banjo', workId: 'gold-rush', comment: 'fixed m3',
        }, f)).rejects.toThrow(/Sign in/);
        expect(f).not.toHaveBeenCalled();
    });

    it('surfaces server errors', async () => {
        mockAuth('user-jwt');
        const f = vi.fn(async () => ({
            ok: false, json: async () => ({ error: 'Tab too large' }),
        }));
        await expect(submitTab({
            type: 'tab-submission', otf: smallOtf(), title: 'X', instrument: 'banjo',
        }, f)).rejects.toThrow('Tab too large');
    });
});

describe('accessToken', () => {
    it('is null when nobody is signed in', async () => {
        mockAuth(null);
        expect(await accessToken()).toBeNull();
    });

    it('is null when the auth module has not loaded', async () => {
        expect(await accessToken()).toBeNull();
    });

    it('returns the session token when signed in', async () => {
        mockAuth('abc123');
        expect(await accessToken()).toBe('abc123');
    });
});
