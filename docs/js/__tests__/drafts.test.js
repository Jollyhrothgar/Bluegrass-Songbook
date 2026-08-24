// The drafts bucket: IndexedDB-backed in the browser, but every decision it
// makes (id minting, metadata derivation, ordering, pruning, debounced
// autosave, the legacy-localStorage migration, the reopen route) is written
// against an injected backend so it can be tested here.
//
// fake-indexeddb is not a dependency of this repo, so the real idbBackend is
// exercised only by hand; memoryBackend() is the injected shim the store is
// designed around.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    LEGACY_DRAFT_ID,
    LEGACY_DRAFT_KEY,
    MAX_DRAFTS,
    MIGRATION_FLAG_KEY,
    createAutosaver,
    createDraftStore,
    draftMetaFrom,
    draftOpenHash,
    hashPath,
    idbBackend,
    isDraftId,
    memoryBackend,
    migrateLegacyDraft,
    newDraftId,
    parseHashParams,
} from '../drafts.js';

const otf = (title = 'Sally Goodin', instrument = '5-string-banjo') => ({
    metadata: { title },
    tracks: [{ id: 'banjo', instrument }],
    notation: {},
});

const store = () => createDraftStore({ backend: memoryBackend() });

describe('draft ids', () => {
    it('mints unique, URL-safe ids', () => {
        const ids = new Set(Array.from({ length: 200 }, () => newDraftId()));
        expect(ids.size).toBe(200);
        for (const id of ids) expect(isDraftId(id)).toBe(true);
    });

    it('rejects anything that would not survive a hash route', () => {
        expect(isDraftId('a/b')).toBe(false);
        expect(isDraftId('a?b=1')).toBe(false);
        expect(isDraftId('')).toBe(false);
        expect(isDraftId(null)).toBe(false);
        expect(isDraftId('x'.repeat(65))).toBe(false);
    });
});

describe('draftMetaFrom', () => {
    it('reads title and instrument off the document', () => {
        expect(draftMetaFrom(otf())).toEqual({
            title: 'Sally Goodin', instrument: '5-string-banjo',
        });
    });

    it('prefers what the caller knows over what the document guesses', () => {
        expect(draftMetaFrom(otf(), { title: 'Bounty title', instrument: 'dobro' }))
            .toEqual({ title: 'Bounty title', instrument: 'dobro' });
    });

    it('never returns empty strings', () => {
        expect(draftMetaFrom({ tracks: [] })).toEqual({
            title: 'Untitled', instrument: 'unknown',
        });
        expect(draftMetaFrom(null)).toEqual({ title: 'Untitled', instrument: 'unknown' });
    });
});

describe('createDraftStore', () => {
    it('saves, reads back and lists a draft', async () => {
        const s = store();
        const saved = await s.save({ otf: otf() });
        expect(saved.id).toBeTruthy();
        expect(saved.title).toBe('Sally Goodin');
        expect(saved.updatedAt).toMatch(/^\d{4}-/);
        expect(await s.get(saved.id)).toEqual(saved);
        expect(await s.list()).toEqual([saved]);
    });

    it('overwrites in place when the id is reused', async () => {
        const s = store();
        const first = await s.save({ otf: otf('Take one') });
        const second = await s.save({ id: first.id, otf: otf('Take two') });
        expect(second.id).toBe(first.id);
        expect((await s.list()).length).toBe(1);
        expect((await s.get(first.id)).title).toBe('Take two');
    });

    it('carries the target work and take through', async () => {
        const s = store();
        const saved = await s.save({
            otf: otf(), workId: 'foggy-mountain-breakdown', takeRef: 'banjo.otf.json',
        });
        expect(saved.workId).toBe('foggy-mountain-breakdown');
        expect(saved.takeRef).toBe('banjo.otf.json');
    });

    it('lists newest first', async () => {
        let t = Date.parse('2026-08-01T00:00:00Z');
        const s = createDraftStore({ backend: memoryBackend(), now: () => (t += 60_000) });
        const a = await s.save({ otf: otf('First') });
        const b = await s.save({ otf: otf('Second') });
        expect((await s.list()).map(d => d.id)).toEqual([b.id, a.id]);
    });

    it('deletes', async () => {
        const s = store();
        const saved = await s.save({ otf: otf() });
        await s.remove(saved.id);
        expect(await s.get(saved.id)).toBe(null);
        expect(await s.list()).toEqual([]);
    });

    it('ignores reads and deletes of malformed ids', async () => {
        const s = store();
        expect(await s.get('../../etc/passwd')).toBe(null);
        await expect(s.remove('../../etc/passwd')).resolves.toBeUndefined();
    });

    it('prunes to MAX_DRAFTS, oldest first', async () => {
        let t = Date.parse('2026-08-01T00:00:00Z');
        const s = createDraftStore({ backend: memoryBackend(), now: () => (t += 1000) });
        for (let i = 0; i < MAX_DRAFTS + 3; i++) await s.save({ otf: otf(`n${i}`) });
        const rows = await s.list();
        expect(rows.length).toBe(MAX_DRAFTS);
        expect(rows[rows.length - 1].title).toBe('n3');   // n0..n2 pruned
    });
});

describe('idbBackend', () => {
    it('degrades to null when IndexedDB is missing, so callers can fall back', () => {
        expect(idbBackend({ indexedDB: undefined })).toBe(null);
    });
});

describe('migrateLegacyDraft', () => {
    const fakeStorage = (seed = {}) => {
        const map = new Map(Object.entries(seed));
        return {
            getItem: (k) => (map.has(k) ? map.get(k) : null),
            setItem: (k, v) => map.set(k, String(v)),
            removeItem: (k) => map.delete(k),
            _map: map,
        };
    };

    it('moves the old single-slot draft into the store, once', async () => {
        const s = store();
        const storage = fakeStorage({
            [LEGACY_DRAFT_KEY]: JSON.stringify({
                savedAt: '2026-08-01T00:00:00Z',
                otf: otf('Old draft'),
                target: { workId: 'sally-goodin', instrument: 'banjo' },
            }),
        });

        const migrated = await migrateLegacyDraft({ store: s, storage });
        expect(migrated.id).toBe(LEGACY_DRAFT_ID);
        expect(migrated.title).toBe('Old draft');
        expect(migrated.workId).toBe('sally-goodin');
        expect(storage.getItem(MIGRATION_FLAG_KEY)).toBeTruthy();

        // Second run is a no-op — not a duplicate.
        expect(await migrateLegacyDraft({ store: s, storage })).toBe(null);
        expect((await s.list()).length).toBe(1);
    });

    it('leaves the localStorage copy in place (a new take still resumes it)', async () => {
        const raw = JSON.stringify({ savedAt: 'x', otf: otf() });
        const storage = fakeStorage({ [LEGACY_DRAFT_KEY]: raw });
        await migrateLegacyDraft({ store: store(), storage });
        expect(storage.getItem(LEGACY_DRAFT_KEY)).toBe(raw);
    });

    it('is a no-op with nothing to migrate, and never throws on garbage', async () => {
        expect(await migrateLegacyDraft({ store: store(), storage: fakeStorage() })).toBe(null);
        expect(await migrateLegacyDraft({
            store: store(), storage: fakeStorage({ [LEGACY_DRAFT_KEY]: 'not json' }),
        })).toBe(null);
        expect(await migrateLegacyDraft({ store: store(), storage: null })).toBe(null);
    });

    it('skips a draft with no tracks', async () => {
        const storage = fakeStorage({
            [LEGACY_DRAFT_KEY]: JSON.stringify({ otf: { tracks: [] } }),
        });
        expect(await migrateLegacyDraft({ store: store(), storage })).toBe(null);
    });
});

describe('createAutosaver', () => {
    beforeEach(() => { vi.useFakeTimers(); });

    it('coalesces a burst of edits into one write', async () => {
        const s = store();
        const saver = createAutosaver({ store: s, delay: 1000 });

        saver.save(otf('a'));
        saver.save(otf('b'));
        saver.save(otf('c'));
        expect(await s.list()).toEqual([]);          // nothing yet

        await vi.advanceTimersByTimeAsync(1000);
        const rows = await s.list();
        expect(rows.length).toBe(1);
        expect(rows[0].title).toBe('c');             // the last one wins
    });

    it('keeps writing to the same draft across the session', async () => {
        const s = store();
        const saver = createAutosaver({ store: s, delay: 10 });
        saver.save(otf('first'));
        await vi.advanceTimersByTimeAsync(10);
        const id = saver.draftId;
        saver.save(otf('second'));
        await vi.advanceTimersByTimeAsync(10);
        expect(saver.draftId).toBe(id);
        expect((await s.list()).length).toBe(1);
    });

    it('reuses an id it was handed (reopening a draft)', async () => {
        const s = store();
        const existing = await s.save({ otf: otf('on disk') });
        const saver = createAutosaver({ store: s, id: existing.id, delay: 10 });
        saver.save(otf('edited'));
        await vi.advanceTimersByTimeAsync(10);
        expect((await s.list()).length).toBe(1);
        expect((await s.get(existing.id)).title).toBe('edited');
    });

    it('flush() writes the pending document immediately', async () => {
        const s = store();
        const saver = createAutosaver({ store: s, delay: 100000 });
        saver.save(otf('flushed'));
        await saver.flush();
        expect((await s.list())[0].title).toBe('flushed');
    });

    it('cancel() drops the pending write', async () => {
        const s = store();
        const saver = createAutosaver({ store: s, delay: 10 });
        saver.save(otf());
        saver.cancel();
        await vi.advanceTimersByTimeAsync(50);
        expect(await s.list()).toEqual([]);
    });

    it('clear() removes the draft (submitted)', async () => {
        const s = store();
        const saver = createAutosaver({ store: s, delay: 10 });
        saver.save(otf());
        await vi.advanceTimersByTimeAsync(10);
        await saver.clear();
        expect(await s.list()).toEqual([]);
        expect(saver.draftId).toBe(null);
    });

    it('carries the session metadata onto every save', async () => {
        const s = store();
        const saver = createAutosaver({
            store: s, delay: 10,
            meta: { workId: 'sally-goodin', takeRef: 'banjo.otf.json', instrument: 'banjo' },
        });
        saver.save(otf());
        await vi.advanceTimersByTimeAsync(10);
        const [row] = await s.list();
        expect(row.workId).toBe('sally-goodin');
        expect(row.takeRef).toBe('banjo.otf.json');
        expect(row.instrument).toBe('banjo');
    });

    it('reports a failed write instead of throwing at the editor', async () => {
        const onError = vi.fn();
        const broken = {
            save: () => Promise.reject(new Error('quota')),
            remove: () => Promise.resolve(),
        };
        const saver = createAutosaver({ store: broken, delay: 10, onError });
        saver.save(otf());
        await vi.advanceTimersByTimeAsync(10);
        expect(onError).toHaveBeenCalled();
    });
});

describe('draftOpenHash', () => {
    it('routes a brand-new song to #new-tab', () => {
        expect(draftOpenHash({ id: 'd-1' })).toBe('#new-tab?draft=d-1');
    });

    it('routes a draft for a known work to that work’s add-tab route', () => {
        expect(draftOpenHash({ id: 'd-1', workId: 'sally-goodin' }))
            .toBe('#work/sally-goodin/add-tab?draft=d-1');
    });

    it('routes a correction back to the take being corrected', () => {
        expect(draftOpenHash({ id: 'd-1', workId: 'sally-goodin', takeRef: 'banjo.otf.json' }))
            .toBe('#work/sally-goodin/edit/banjo.otf.json?draft=d-1');
    });

    it('degrades to #new-tab rather than minting a link into a bad slug', () => {
        expect(draftOpenHash({ id: 'd-1', workId: '../evil' })).toBe('#new-tab?draft=d-1');
        expect(draftOpenHash({ id: 'nope/nope' })).toBe('#new-tab');
        expect(draftOpenHash(null)).toBe('#new-tab');
    });
});

describe('hash parsing', () => {
    it('reads ?draft= and ?file= off a hash route', () => {
        expect(parseHashParams('#new-tab?draft=d-1&file=1'))
            .toMatchObject({ draft: 'd-1', file: true });
        expect(parseHashParams('#new-tab')).toMatchObject({ draft: null, file: false });
        expect(parseHashParams('#new-tab?draft=../x')).toMatchObject({ draft: null });
    });

    it('splits the path from the query', () => {
        expect(hashPath('#work/x/add-tab?draft=d-1')).toBe('#work/x/add-tab');
        expect(hashPath('#drafts')).toBe('#drafts');
        expect(hashPath(null)).toBe('');
    });
});
