// fetchPublicList / copyListToOwn against the REAL get_public_list response.
//
// get_public_list (supabase/migrations/20260109224000) returns snake_case flags
// at the top level: { list: {...}, songs: [...], is_owner, is_follower,
// is_orphaned, can_claim }. fetchPublicList used to pass that through
// untouched while showListView read data.list.songs / data.isOwner /
// data.canClaim, so every share link rendered "0 songs" and no claim button.
//
// supabase-auth.js is a classic script (not an ES module), so it is loaded the
// way the browser loads it: evaluated against a fake `supabase` global, then
// exercised through window.SupabaseAuth.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../supabase-auth.js'), 'utf-8');

const LIST_ID = '11111111-1111-1111-1111-111111111111';
const USER = { id: '00000000-0000-0000-0000-00000000000f' };

// Exactly what the function returns, as PostgREST hands it to supabase-js.
const RPC_SHAPE = {
    list: {
        id: LIST_ID,
        name: 'Sunday Jam',
        user_id: '00000000-0000-0000-0000-00000000000a',
        position: 0,
        owners: [],
        orphaned_at: '2026-09-01T00:00:00+00:00'
    },
    songs: ['man-of-constant-sorrow', 'blue-moon-of-kentucky'],
    is_owner: false,
    is_follower: true,
    is_orphaned: true,
    can_claim: true
};

// A chainable stand-in for a supabase-js query builder. Every method returns
// the builder; awaiting it (or a terminal single/maybeSingle) calls `respond`.
function makeClient(respond, rpc) {
    const calls = [];
    const client = {
        rpc,
        calls,
        from(table) {
            const ops = [];
            const builder = new Proxy({}, {
                get(_, prop) {
                    if (prop === 'then') {
                        return (res, rej) =>
                            Promise.resolve(respond(table, ops, false)).then(res, rej);
                    }
                    return (...args) => {
                        ops.push({ op: prop, args });
                        if (prop === 'single' || prop === 'maybeSingle') {
                            return Promise.resolve(respond(table, ops, true));
                        }
                        return builder;
                    };
                }
            });
            calls.push({ table, ops });
            return builder;
        },
        auth: {
            onAuthStateChange: vi.fn(),
            getSession: vi.fn().mockResolvedValue({ data: { session: { user: USER } } })
        }
    };
    return client;
}

async function loadAuth(client) {
    new Function('supabase', SRC)({ createClient: () => client });
    window.SupabaseAuth.init();
    await Promise.resolve();   // let getSession() resolve so currentUser is set
    await Promise.resolve();
    return window.SupabaseAuth;
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    delete window.SupabaseAuth;
    vi.restoreAllMocks();
});

describe('fetchPublicList', () => {
    it('normalizes the real RPC shape to { list, songs, isOwner, isFollower, isOrphaned, canClaim }', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: RPC_SHAPE, error: null });
        const auth = await loadAuth(makeClient(() => ({ data: null, error: null }), rpc));

        const { data, error } = await auth.fetchPublicList(LIST_ID);

        expect(rpc).toHaveBeenCalledWith('get_public_list', { p_list_id: LIST_ID });
        expect(error).toBeNull();
        expect(data.songs).toEqual(['man-of-constant-sorrow', 'blue-moon-of-kentucky']);
        expect(data.list.name).toBe('Sunday Jam');
        expect(data.isOwner).toBe(false);
        expect(data.isFollower).toBe(true);
        expect(data.isOrphaned).toBe(true);
        expect(data.canClaim).toBe(true);
    });

    it('has no list.songs: the songs live at the top level', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: RPC_SHAPE, error: null });
        const auth = await loadAuth(makeClient(() => ({}), rpc));
        const { data } = await auth.fetchPublicList(LIST_ID);
        expect(data.list.songs).toBeUndefined();
    });

    it('does not leak the snake_case keys, so a caller cannot read the wrong one', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: RPC_SHAPE, error: null });
        const auth = await loadAuth(makeClient(() => ({}), rpc));
        const { data } = await auth.fetchPublicList(LIST_ID);
        for (const key of ['is_owner', 'is_follower', 'is_orphaned', 'can_claim']) {
            expect(data).not.toHaveProperty(key);
        }
    });

    it('a signed-out, non-member view of an ordinary list: flags all false, songs present', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: {
                list: { id: LIST_ID, name: 'Shared', user_id: 'u', position: 0, owners: ['u'], orphaned_at: null },
                songs: ['a', 'b', 'c'],
                is_owner: false, is_follower: false, is_orphaned: false, can_claim: false
            },
            error: null
        });
        const auth = await loadAuth(makeClient(() => ({}), rpc));
        const { data } = await auth.fetchPublicList(LIST_ID);
        expect(data.songs).toHaveLength(3);
        expect(data).toMatchObject({ isOwner: false, isFollower: false, isOrphaned: false, canClaim: false });
    });

    it('an empty list has songs: []', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: { list: { id: LIST_ID, name: 'Empty', owners: ['u'], orphaned_at: null }, songs: [],
                    is_owner: true, is_follower: false, is_orphaned: false, can_claim: false },
            error: null
        });
        const auth = await loadAuth(makeClient(() => ({}), rpc));
        const { data } = await auth.fetchPublicList(LIST_ID);
        expect(data.songs).toEqual([]);
        expect(data.isOwner).toBe(true);
    });

    it('falls back to list.orphaned_at when is_orphaned is absent', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: { list: { id: LIST_ID, name: 'Old shape', orphaned_at: '2026-09-01T00:00:00+00:00' }, songs: [] },
            error: null
        });
        const auth = await loadAuth(makeClient(() => ({}), rpc));
        const { data } = await auth.fetchPublicList(LIST_ID);
        expect(data.isOrphaned).toBe(true);
    });

    it("maps the RPC's { error } payload to an error and no data", async () => {
        const rpc = vi.fn().mockResolvedValue({ data: { error: 'List not found' }, error: null });
        const auth = await loadAuth(makeClient(() => ({}), rpc));
        const result = await auth.fetchPublicList(LIST_ID);
        expect(result.data).toBeNull();
        expect(result.error.message).toBe('List not found');
    });

    it('passes a transport error through and returns no data', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom', code: '500' } });
        const auth = await loadAuth(makeClient(() => ({}), rpc));
        const result = await auth.fetchPublicList(LIST_ID);
        expect(result.data).toBeNull();
        expect(result.error.message).toBe('boom');
    });

    it('treats a null payload as not found rather than crashing', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
        const auth = await loadAuth(makeClient(() => ({}), rpc));
        const result = await auth.fetchPublicList(LIST_ID);
        expect(result.data).toBeNull();
        expect(result.error.message).toBe('List not found');
    });
});

describe('copyListToOwn', () => {
    it("copies the songs of a get_public_list response into a new list", async () => {
        const rpc = vi.fn().mockResolvedValue({ data: RPC_SHAPE, error: null });
        const client = makeClient((table, ops, terminal) => {
            const has = (op) => ops.some(o => o.op === op);
            if (table === 'user_lists' && has('insert')) {
                return { data: { id: 'new-list-id', name: 'My copy' }, error: null };
            }
            if (table === 'user_lists' && has('maybeSingle')) return { data: null, error: null };   // name not taken
            if (table === 'user_lists') return { data: [], error: null };                            // max position
            if (table === 'user_list_items' && has('upsert')) return { error: null };
            if (table === 'user_list_items') return { data: [], error: null };                       // max position
            return { data: null, error: null };
        }, rpc);
        const auth = await loadAuth(client);

        const { data, error } = await auth.copyListToOwn(LIST_ID, 'My copy');

        expect(error).toBeNull();
        expect(data).toEqual({
            id: 'new-list-id',
            name: 'My copy',
            songs: ['man-of-constant-sorrow', 'blue-moon-of-kentucky']
        });
        const upserts = client.calls
            .filter(c => c.table === 'user_list_items')
            .flatMap(c => c.ops.filter(o => o.op === 'upsert').map(o => o.args[0]));
        expect(upserts.map(u => u.song_id)).toEqual(['man-of-constant-sorrow', 'blue-moon-of-kentucky']);
        expect(upserts.every(u => u.list_id === 'new-list-id')).toBe(true);
    });

    it("defaults the new list's name to the source list's name", async () => {
        const rpc = vi.fn().mockResolvedValue({ data: RPC_SHAPE, error: null });
        const client = makeClient((table, ops) => {
            const has = (op) => ops.some(o => o.op === op);
            if (table === 'user_lists' && has('insert')) {
                return { data: { id: 'n', name: ops.find(o => o.op === 'insert').args[0].name }, error: null };
            }
            if (table === 'user_lists' && has('maybeSingle')) return { data: null, error: null };
            return { data: [], error: null };
        }, rpc);
        const auth = await loadAuth(client);
        const { data } = await auth.copyListToOwn(LIST_ID);
        expect(data.name).toBe('Sunday Jam');
    });
});
