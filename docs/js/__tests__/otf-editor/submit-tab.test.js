// Tab submission client — the two-step instant pipeline: the pending_songs
// row (live) then the auto-commit-song ask (durable). Payload shape, auth,
// size guard, and the "live but not synced" path.
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    serializeForSubmission, submitTab, accessToken, tabWorkSlug, tabRowId,
} from '../../otf-editor/submit-tab.js';

/**
 * Copied verbatim from `pending_songs_tab_id_namespace` in
 * supabase/migrations/20260818000000_pending_songs_tablature.sql. A row id
 * that fails this is a rejected INSERT in production, so the client's id
 * minting is asserted against the real constraint rather than a literal.
 */
const TAB_ID_CHECK = /^tab:[a-z0-9-]*:[a-z0-9]{6,}$/;

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

    it('is a legal work id even when the 80-char cut lands on a dash', () => {
        // The slug becomes a directory name in works/, and every writer
        // agrees on ^[a-z0-9]+(-[a-z0-9]+)*$. Truncating BEFORE trimming (the
        // old order) left `...-` behind, which the server now refuses.
        const title = 'a'.repeat(79);
        const slug = tabWorkSlug(title, 'Bill Monroe');
        expect(slug).toBe('a'.repeat(79));
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(slug.length).toBeLessThanOrEqual(80);
    });

    it('matches generateSlug at the truncation boundary too', async () => {
        const { generateSlug } = await import('../../utils.js');
        for (const [title, artist] of [
            ['a'.repeat(79), 'Bill Monroe'],
            ['a'.repeat(80), 'Bill Monroe'],
            ['Some Very Long Bluegrass Song Title Indeed', 'The Stanley Brothers'],
        ]) {
            expect(tabWorkSlug(title, artist)).toBe(generateSlug(title, artist));
        }
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
        // The id is in the `tab:` namespace, NOT the work id — keying a tab
        // row by its work collided when two people tabbed the same song. The
        // work it targets rides in replaces_id instead. Asserted against the
        // database's own CHECK (pending_songs_tab_id_namespace), so this test
        // fails if the two ever drift apart.
        expect(row.id).toMatch(TAB_ID_CHECK);
        expect(row.id).toContain(':gold-rush:');
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
        expect(JSON.parse(init.body)).toEqual({ id: row.id });
        expect(init.headers.Authorization).toBe('Bearer user-jwt');

        expect(out).toEqual({
            id: row.id,
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
        expect(row.id).toMatch(TAB_ID_CHECK);
        expect(row.id).toContain(':brand-new-reel:');
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

describe('tabRowId', () => {
    it('satisfies the database CHECK for ordinary and awkward slugs', () => {
        expect(tabRowId('salt-creek', 'banjo')).toMatch(TAB_ID_CHECK);
        // A slug is decorative here, but it still has to pass the constraint,
        // so anything outside [a-z0-9-] is scrubbed rather than trusted.
        expect(tabRowId('Café Olé!!', 'fiddle')).toMatch(TAB_ID_CHECK);
        // The constraint allows an empty slug half; a title that slugifies to
        // nothing must still produce a legal id.
        expect(tabRowId('', 'mandolin')).toMatch(TAB_ID_CHECK);
    });

    it('reuses one id for a repeated submission of the same take', () => {
        // The downstream idempotence marker is keyed by row id, so a
        // double-click that minted two ids would land two banjo parts on the
        // work instead of updating one pending row.
        const first = tabRowId('gold-rush', 'banjo');
        expect(tabRowId('gold-rush', 'banjo')).toBe(first);
    });

    it('gives a different id to a different take of the same work', () => {
        const banjo = tabRowId('gold-rush', 'banjo');
        const fiddle = tabRowId('gold-rush', 'fiddle');
        expect(fiddle).not.toBe(banjo);
        // ...and a correction is a different row again from a new take.
        expect(tabRowId('gold-rush', 'banjo', 'banjo-2.otf.json'))
            .not.toBe(banjo);
    });

    it('does not collide across submitters tabbing the same song', () => {
        // Two browsers, same work, same instrument: the random half is what
        // keeps them from fighting over one primary key.
        const ids = new Set();
        for (let i = 0; i < 200; i++) {
            ids.add(`tab:gold-rush:${tabRowId(`x${i}`, 'banjo').split(':')[2]}`);
        }
        expect(ids.size).toBe(200);
    });
});
