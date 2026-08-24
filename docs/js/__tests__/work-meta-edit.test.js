// @vitest-environment jsdom
// Editing a work's METADATA — title / artist / key / notes — from the work
// page.
//
// The case that forced this: a tab-minted work (`works/welcome-to-new-york/`)
// arrives with a title and nothing else, and until now no surface could give
// it an artist. The metadata editor existed but was reachable only from
// `status: 'placeholder'`, which a tab-minted work never has.
//
// Widening that gate alone would have been a bug, not a fix: the old save
// wrote `status: 'placeholder'` plus `content: existingContent || null`, and
// on a tab-only work `getSongContent` resolves to `''` — so the row went down
// the CHART path server-side and stamped `status: placeholder` onto a real
// work. These tests pin the row that replaced it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    metaRowId, submitWorkMetadata, canEditMetadataHere, configureWorkPage,
    openWork,
} from '../work-view.js';
import { canEditWorkMetadata, ownsPartOfWork, workSubmitters } from '../utils.js';
import { setAllSongs, setSongGroups } from '../state.js';

/**
 * Copied from the `pending_songs_meta_id_namespace` CHECK. A row id that
 * fails this is a rejected INSERT in production, so the client's minting is
 * asserted against the constraint rather than against a literal.
 */
const META_ID_CHECK = /^meta:[a-z0-9-]*:[a-z0-9]{6,}$/;

/** Install a fake SupabaseAuth with (or without) an active session. */
function mockAuth(token, { userId = 'u1' } = {}) {
    globalThis.window.SupabaseAuth = {
        isLoggedIn: () => !!token,
        signInWithGoogle: () => {},
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

/** A stub `supabase` recording upserts and deletes. */
function mockDb({ error = null } = {}) {
    const calls = [];
    const deletes = [];
    return {
        calls,
        deletes,
        from(table) {
            return {
                upsert(row, options) {
                    calls.push({ table, row, options });
                    return Promise.resolve({ error });
                },
                delete() {
                    return {
                        eq(column, value) {
                            deletes.push({ table, column, value });
                            return Promise.resolve({ error: null });
                        },
                    };
                },
            };
        },
    };
}

const okFetch = (result = { success: true, mode: 'update' }) =>
    vi.fn(async () => ({ ok: true, json: async () => result }));

const failFetch = (status, error) => vi.fn(async () => ({
    ok: false, status, json: async () => ({ error }),
}));

afterEach(() => {
    delete globalThis.window.SupabaseAuth;
    vi.restoreAllMocks();
});

describe('metaRowId', () => {
    it('satisfies the database CHECK, including for awkward work ids', () => {
        expect(metaRowId('welcome-to-new-york')).toMatch(META_ID_CHECK);
        expect(metaRowId('Café Olé!!')).toMatch(META_ID_CHECK);
        // The constraint allows an empty slug half; an id that slugifies to
        // nothing must still be legal rather than throwing at the table.
        expect(metaRowId('')).toMatch(META_ID_CHECK);
    });

    it('is namespaced, never the bare work slug', () => {
        // The work slug as a primary key is what this namespace exists to
        // avoid: two people holding an unlanded edit of one work would collide
        // on the PK, and the owner-gated UPDATE policy turns that collision
        // into a permissions error that describes nothing.
        const id = metaRowId('gold-rush');
        expect(id).not.toBe('gold-rush');
        expect(id.startsWith('meta:gold-rush:')).toBe(true);
    });

    it('reuses one id for repeated saves of the same work', () => {
        // A double-click must update one row, not queue two edits of the same
        // fields against each other.
        const first = metaRowId('salt-creek');
        expect(metaRowId('salt-creek')).toBe(first);
    });

    it('gives different works different rows', () => {
        expect(metaRowId('cripple-creek')).not.toBe(metaRowId('blackberry-blossom'));
    });

    it('does not collide across editors of the same work', () => {
        const rands = new Set();
        for (let i = 0; i < 200; i++) {
            rands.add(metaRowId(`collide-${i}`).split(':')[2]);
        }
        expect(rands.size).toBe(200);
    });
});

describe('submitWorkMetadata', () => {
    it('writes a metadata row: no content, no status, and it names its target', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        const f = okFetch();

        const out = await submitWorkMetadata({
            workId: 'welcome-to-new-york',
            title: 'Welcome to New York',
            artist: 'Bill Emerson',
            key: 'G',
            notes: 'Emerson instrumental',
        }, { fetchImpl: f, supabase: db });

        expect(db.calls).toHaveLength(1);
        const { table, row, options } = db.calls[0];
        expect(table).toBe('pending_songs');
        expect(options).toEqual({ onConflict: 'id' });

        expect(row.id).toMatch(META_ID_CHECK);
        expect(row.part_type).toBe('metadata');
        // The two fields the old save got wrong, pinned. `content: null` keeps
        // the row off the chart path; `replaces_id` is the row's whole address.
        expect(row.content).toBeNull();
        expect(row.replaces_id).toBe('welcome-to-new-york');
        // Nothing here may claim the work is a placeholder — it has a tab.
        expect(row.status).toBeUndefined();
        expect(row.title).toBe('Welcome to New York');
        expect(row.artist).toBe('Bill Emerson');
        expect(row.key).toBe('G');
        expect(row.notes).toBe('Emerson instrumental');
        expect(row.created_by).toBe('u1');

        // Step 2 names the row and nothing else — the server classifies.
        const [url, init] = f.mock.calls[0];
        expect(url).toContain('/functions/v1/auto-commit-song');
        expect(JSON.parse(init.body)).toEqual({ id: row.id });
        expect(init.headers.Authorization).toBe('Bearer user-jwt');

        expect(out).toEqual({
            id: row.id,
            workId: 'welcome-to-new-york',
            live: true,
            synced: true,
            mode: 'update',
            syncError: null,
        });
    });

    it('blanks empty optional fields rather than writing empty strings', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        await submitWorkMetadata(
            { workId: 'gold-rush', title: '  Gold Rush  ', artist: '   ' },
            { fetchImpl: okFetch(), supabase: db });

        const { row } = db.calls[0];
        expect(row.title).toBe('Gold Rush');
        expect(row.artist).toBeNull();
        expect(row.key).toBeNull();
        expect(row.notes).toBeNull();
    });

    it('surfaces a 403 as a refusal and withdraws the row', async () => {
        // auto-commit-song is where permission is decided. A refused edit is
        // NOT "syncing shortly": leaving the row behind would leave the
        // overlay advertising a title change that is never going to land.
        mockAuth('user-jwt');
        const db = mockDb();
        const f = failFetch(403, 'You have not contributed to this song.');

        await expect(submitWorkMetadata(
            { workId: 'gold-rush', title: 'Gold Rush' },
            { fetchImpl: f, supabase: db },
        )).rejects.toThrow('You have not contributed to this song.');

        expect(db.calls).toHaveLength(1);              // it was written…
        expect(db.deletes).toEqual([                    // …and taken back
            { table: 'pending_songs', column: 'id', value: db.calls[0].row.id },
        ]);
    });

    it('withdraws on any permanent 4xx — a 404 target is as dead as a 403', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        await expect(submitWorkMetadata(
            { workId: 'ghost-work', title: 'Ghost Work' },
            { fetchImpl: failFetch(404, 'No such song.'), supabase: db },
        )).rejects.toThrow('No such song.');
        expect(db.deletes).toHaveLength(1);
    });

    it('keeps a rate-limited edit live — 429 is about when, not what', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const out = await submitWorkMetadata(
            { workId: 'gold-rush', title: 'Gold Rush' },
            { fetchImpl: failFetch(429, 'Slow down'), supabase: db });
        expect(out.synced).toBe(false);
        expect(db.deletes).toHaveLength(0);
    });

    it('treats a transient failure as live-but-not-synced, keeping the row', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const out = await submitWorkMetadata(
            { workId: 'gold-rush', title: 'Gold Rush' },
            { fetchImpl: failFetch(500, 'boom'), supabase: db });

        expect(out.live).toBe(true);
        expect(out.synced).toBe(false);
        expect(out.syncError).toMatch(/boom/);
        expect(db.deletes).toHaveLength(0);   // the reconciler owns the retry
    });

    it('refuses to write without a session', async () => {
        mockAuth(null);
        const db = mockDb();
        const f = okFetch();
        await expect(submitWorkMetadata(
            { workId: 'gold-rush', title: 'Gold Rush' },
            { fetchImpl: f, supabase: db },
        )).rejects.toThrow(/Sign in/);
        expect(db.calls).toHaveLength(0);
        expect(f).not.toHaveBeenCalled();
    });

    it('refuses a row with no target work — it would have nothing to edit', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        await expect(submitWorkMetadata(
            { title: 'Orphan' }, { fetchImpl: okFetch(), supabase: db },
        )).rejects.toThrow(/no song/);
        expect(db.calls).toHaveLength(0);
    });

    it('refuses a titleless edit', async () => {
        mockAuth('user-jwt');
        const db = mockDb();
        await expect(submitWorkMetadata(
            { workId: 'gold-rush', title: '   ' },
            { fetchImpl: okFetch(), supabase: db },
        )).rejects.toThrow(/title/);
        expect(db.calls).toHaveLength(0);
    });

    it('surfaces a failed row write — nothing is live then', async () => {
        mockAuth('user-jwt');
        const f = okFetch();
        await expect(submitWorkMetadata(
            { workId: 'gold-rush', title: 'Gold Rush' },
            { fetchImpl: f, supabase: mockDb({ error: { message: 'row rejected' } }) },
        )).rejects.toThrow('row rejected');
        expect(f).not.toHaveBeenCalled();
    });
});

describe('canEditWorkMetadata — the affordance gate', () => {
    const tabWork = {
        id: 'welcome-to-new-york',
        title: 'Welcome to New York',
        tablature_parts: [{ instrument: 'banjo', submitted_by: 'u1' }],
    };

    it('lets a part owner edit', () => {
        expect(canEditWorkMetadata(tabWork, { userId: 'u1' })).toBe(true);
    });

    it('refuses a stranger', () => {
        expect(canEditWorkMetadata(tabWork, { userId: 'u2' })).toBe(false);
    });

    it('lets a trusted user edit anything', () => {
        expect(canEditWorkMetadata(tabWork, { userId: 'u2', trusted: true })).toBe(true);
    });

    it('refuses anonymous visitors, trusted flag or not', () => {
        expect(canEditWorkMetadata(tabWork, { userId: null })).toBe(false);
        expect(canEditWorkMetadata(tabWork, { userId: null, trusted: true })).toBe(false);
    });

    it('reads every kind of part the index row publishes', () => {
        expect([...workSubmitters({
            submitted_by: 'chart-owner',
            arrangements: [{ slug: 'default' }, { slug: 'x', submitted_by: 'fork-owner' }],
            tablature_parts: [{ instrument: 'banjo', submitted_by: 'tab-owner' }],
            document_parts: [{ submitted_by: 'doc-owner' }],
            created_by: 'overlay-author',
        })].sort()).toEqual([
            'chart-owner', 'doc-owner', 'fork-owner', 'overlay-author', 'tab-owner',
        ]);
    });

    it('never mistakes a tab AUTHOR name for a submitter uuid', () => {
        // `tablature_parts[].author` is a display name ('schlange'), which is
        // what an imported Hangout tab carries. Comparing it to auth.uid()
        // would be nonsense; the ownership field is `submitted_by`.
        const imported = {
            id: 'gold-rush',
            tablature_parts: [{ instrument: 'banjo', author: 'schlange' }],
        };
        expect(ownsPartOfWork(imported, 'schlange')).toBe(false);
        expect(canEditWorkMetadata(imported, { userId: 'schlange' })).toBe(false);
    });
});

describe('canEditMetadataHere — the page asking the gate', () => {
    beforeEach(() => configureWorkPage({ isTrusted: () => false }));

    it('reads the signed-in user from the live auth module', () => {
        mockAuth('user-jwt', { userId: 'u1' });
        const work = { id: 'w', tablature_parts: [{ submitted_by: 'u1' }] };
        expect(canEditMetadataHere(work)).toBe(true);
        expect(canEditMetadataHere({ id: 'w2' })).toBe(false);
    });

    it('picks up trusted status when it resolves late', () => {
        mockAuth('user-jwt', { userId: 'stranger' });
        const work = { id: 'w', tablature_parts: [{ submitted_by: 'u1' }] };
        expect(canEditMetadataHere(work)).toBe(false);
        configureWorkPage({ isTrusted: () => true });
        expect(canEditMetadataHere(work)).toBe(true);
    });
});

// ---------------------------------------------------------------------
// The affordance on the page
// ---------------------------------------------------------------------
//
// This is where the feature was actually stranded. `updateWorkTopBar` hid the
// title-row Edit button whenever `partUsesSongActions` was false — which it is
// for a tablature part — so on the one kind of work that most needs its
// details filled in, nothing was clickable at all.

const OTF = '{"otf_version":"1.0","tracks":[{"id":"banjo","tuning":["D4","B3","G3","D3","G4"]}],"notation":{"banjo":[]}}';

const TAB_WORK = {
    id: 'welcome-to-new-york',
    title: 'Welcome to New York',
    tablature_parts: [{
        instrument: 'banjo', file: null, content: OTF, pending: true,
        pending_id: 'tab:welcome-to-new-york:bciu053d', submitted_by: 'u1',
    }],
};

const settle = () => new Promise(r => setTimeout(r, 0));

async function openTabWork(work = TAB_WORK) {
    document.body.innerHTML = '<div id="song-content"></div>';
    setAllSongs([work]);
    setSongGroups({});
    await openWork(work.id);
    await settle();
}

describe('the Details affordance on a tab-only work', () => {
    beforeEach(() => {
        configureWorkPage({ isTrusted: () => false });
        window.matchMedia = () => ({ matches: false, addEventListener() {} });
        global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
    });

    it('is offered to the submitter of the work\'s tab', async () => {
        mockAuth('user-jwt', { userId: 'u1' });
        await openTabWork();

        const metaBtn = document.getElementById('edit-meta-btn');
        expect(metaBtn).toBeTruthy();
        expect(metaBtn.classList.contains('hidden')).toBe(false);
        // The chart Edit stays hidden — this part has no chart to edit. That
        // rule is not what was broken; reaching the DETAILS through it was.
        expect(document.getElementById('edit-song-btn').classList.contains('hidden'))
            .toBe(true);
        // …and the empty artist line becomes an invitation instead of a blank.
        expect(document.querySelector('.song-artist-missing').classList.contains('hidden'))
            .toBe(false);
    });

    it('is hidden from a visitor with no stake in the work', async () => {
        mockAuth('user-jwt', { userId: 'somebody-else' });
        await openTabWork();
        expect(document.getElementById('edit-meta-btn').classList.contains('hidden'))
            .toBe(true);
        expect(document.querySelector('.song-artist-missing').classList.contains('hidden'))
            .toBe(true);
    });

    it('is offered to a trusted user on a work they have never touched', async () => {
        mockAuth('user-jwt', { userId: 'somebody-else' });
        configureWorkPage({ isTrusted: () => true });
        await openTabWork();
        expect(document.getElementById('edit-meta-btn').classList.contains('hidden'))
            .toBe(false);
    });

    it('opens the details editor rather than the ChordPro editor', async () => {
        const onEdit = vi.fn();
        mockAuth('user-jwt', { userId: 'u1' });
        configureWorkPage({ isTrusted: () => false, onEdit });
        await openTabWork();

        document.getElementById('edit-meta-btn').click();
        await settle();

        const form = document.querySelector('.placeholder-editor');
        expect(form).toBeTruthy();
        expect(form.querySelector('#ph-edit-title').value).toBe('Welcome to New York');
        expect(form.querySelector('#ph-edit-artist').value).toBe('');
        expect(onEdit).not.toHaveBeenCalled();
    });

    it('announces an edit that is live in the overlay and still syncing', async () => {
        mockAuth('user-jwt', { userId: 'u1' });
        await openTabWork({
            ...TAB_WORK, artist: 'Bill Emerson',
            pending_metadata: { id: 'meta:welcome-to-new-york:aaaaaa', created_by: 'u1' },
        });
        expect(document.querySelector('.pending-meta-badge')).toBeTruthy();
        expect(document.querySelector('.song-artist-line').textContent)
            .toContain('Bill Emerson');
    });
});
