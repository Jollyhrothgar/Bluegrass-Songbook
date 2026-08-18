// Tab submission client — the two-step instant pipeline: the pending_songs
// row (live) then the auto-commit-song ask (durable). Payload shape, auth,
// size guard, and the "live but not synced" path.
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    serializeForSubmission, submitTab, accessToken, tabWorkSlug,
} from '../../otf-editor/submit-tab.js';

/** Install a fake SupabaseAuth with (or without) an active session. */
function mockAuth(token, { userId = 'u1' } = {}) {
    globalThis.window.SupabaseAuth = {
        getUser: () => (token ? { id: userId } : null),
        supabase: {
            auth: {
                getSession: async () => ({
                    data: { session: token ? { access_token: token } : null },
                }),
            },
        },
    };
}

/** A stub `supabase` whose upsert records the row it was handed. */
function mockDb({ error = null } = {}) {
    const calls = [];
    return {
        calls,
        from(table) {
            return {
                upsert(row, options) {
                    calls.push({ table, row, options });
                    return Promise.resolve({ error });
                },
            };
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

describe('tabWorkSlug', () => {
    it('matches utils.generateSlug for the same inputs', () => {
        expect(tabWorkSlug('Gold Rush')).toBe('gold-rush');
        expect(tabWorkSlug('Blue Moon of Kentucky', 'Bill Monroe'))
            .toBe('blue-moon-of-kentucky-bill-monroe');
    });
});

describe('submitTab', () => {
    const okFetch = (result = { success: true, mode: 'update' }) =>
        vi.fn(async () => ({ ok: true, json: async () => result }));

    it('writes a tablature pending row, then asks auto-commit-song for the commit', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        const f = okFetch();

        const out = await submitTab({
            type: 'tab-correction', otf: smallOtf(), title: 'Gold Rush',
            instrument: 'banjo', workId: 'gold-rush', file: 'banjo.otf.json',
            comment: 'fixed m3',
        }, { fetchImpl: f, supabase: db });

        // Step 1 — the row. `content` is the OTF, and the three new columns
        // are what make it a PART rather than a song.
        expect(db.calls).toHaveLength(1);
        const { table, row, options } = db.calls[0];
        expect(table).toBe('pending_songs');
        expect(options).toEqual({ onConflict: 'id' });
        expect(row.id).toBe('gold-rush');
        expect(row.replaces_id).toBe('gold-rush');
        expect(row.part_type).toBe('tablature');
        expect(row.instrument).toBe('banjo');
        expect(row.part_file).toBe('banjo.otf.json');
        expect(row.notes).toBe('fixed m3');
        expect(JSON.parse(row.content).tracks[0].id).toBe('banjo');

        // Identity is the verified session, derived server-side: the client
        // sends its token and claims no attribution of its own.
        expect(row.submittedBy).toBeUndefined();

        // Step 2 — the durable ask names the row and nothing else. No mode,
        // no work shape: the server decides create/add/update.
        const [url, init] = f.mock.calls[0];
        expect(url).toContain('/functions/v1/auto-commit-song');
        expect(url).not.toContain('create-tab-pr');
        expect(JSON.parse(init.body)).toEqual({ id: 'gold-rush' });
        expect(init.headers.Authorization).toBe('Bearer user-jwt');

        expect(out).toEqual({
            id: 'gold-rush',
            workId: 'gold-rush',
            instrument: 'banjo',
            partFile: 'banjo.otf.json',
            live: true,
            synced: true,
            mode: 'update',
            syncError: null,
        });
    });

    it('mints a work slug and leaves part_file null for a brand-new tab', async () => {
        mockAuth('user-jwt');
        const db = mockDb();

        const out = await submitTab({
            type: 'tab-submission', otf: smallOtf(), title: 'Brand New Reel',
            instrument: 'mandolin',
        }, { fetchImpl: okFetch({ success: true, mode: 'create' }), supabase: db });

        const { row } = db.calls[0];
        expect(row.id).toBe('brand-new-reel');
        expect(row.replaces_id).toBeNull();   // nothing to attach to yet
        expect(row.part_file).toBeNull();     // a new take, not a correction
        expect(out.workId).toBe('brand-new-reel');
        expect(out.mode).toBe('create');
    });

    it('is LIVE even when the durable ask fails — the reconciler owns the retry', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        const f = vi.fn(async () => ({
            ok: false, json: async () => ({ error: 'rate limited' }),
        }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const out = await submitTab({
            type: 'tab-submission', otf: smallOtf(), title: 'X', instrument: 'banjo',
        }, { fetchImpl: f, supabase: db });

        expect(db.calls).toHaveLength(1);     // the row landed
        expect(out.live).toBe(true);
        expect(out.synced).toBe(false);
        expect(out.syncError).toMatch(/rate limited/);
    });

    it('surfaces a failed row write as a failure — nothing is live then', async () => {
        mockAuth('user-jwt');
        const f = okFetch();
        await expect(submitTab({
            type: 'tab-submission', otf: smallOtf(), title: 'X', instrument: 'banjo',
        }, { fetchImpl: f, supabase: mockDb({ error: { message: 'row too large' } }) }))
            .rejects.toThrow('row too large');
        expect(f).not.toHaveBeenCalled();
    });

    it('refuses to submit without a session', async () => {
        mockAuth(null);
        const db = mockDb();
        const f = okFetch();
        await expect(submitTab({
            type: 'tab-correction', otf: smallOtf(), title: 'Gold Rush',
            instrument: 'banjo', workId: 'gold-rush', comment: 'fixed m3',
        }, { fetchImpl: f, supabase: db })).rejects.toThrow(/Sign in/);
        expect(db.calls).toHaveLength(0);
        expect(f).not.toHaveBeenCalled();
    });

    it('refuses a tablature row with no instrument — it would have nowhere to land', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        await expect(submitTab({
            type: 'tab-submission', otf: smallOtf(), title: 'X', instrument: '',
        }, { fetchImpl: okFetch(), supabase: db })).rejects.toThrow(/instrument/);
        expect(db.calls).toHaveLength(0);
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
