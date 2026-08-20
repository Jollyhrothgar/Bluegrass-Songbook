// Unit tests for the per-part local draft store — the thing that makes an
// unmounted editor recoverable instead of final.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
    TAB_DRAFT_PREFIX, DRAFT_TTL_MS,
    tabDraftKey, saveTabDraft, loadTabDraft, clearTabDraft, pruneTabDrafts,
    draftAge,
} from '../../otf-editor/tab-drafts.js';

/** A localStorage stand-in that Object.keys() can enumerate, like the real one. */
function fakeStorage(seed = {}) {
    const store = { ...seed };
    return new Proxy({
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        _store: store,
    }, {
        // Object.keys(storage) must list the DATA keys, not the methods —
        // that is how pruneTabDrafts finds drafts to age out.
        ownKeys: () => Object.keys(store),
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
}

const OTF = { tracks: [{ id: 'banjo' }], notation: { banjo: [] } };

describe('tabDraftKey', () => {
    it('separates two takes of the same instrument on one work', () => {
        const a = tabDraftKey('gold-rush', 'data/tabs/gold-rush-banjo-1.otf.json');
        const b = tabDraftKey('gold-rush', 'data/tabs/gold-rush-banjo-2.otf.json');
        expect(a).not.toBe(b);
        expect(a.startsWith(TAB_DRAFT_PREFIX)).toBe(true);
    });

    it('separates the same part key on two different works', () => {
        expect(tabDraftKey('a', 'banjo')).not.toBe(tabDraftKey('b', 'banjo'));
    });

    it('never collides with the create page\'s single draft slot', () => {
        expect(tabDraftKey('x', 'y')).not.toBe('otf-editor-draft');
    });
});

describe('saveTabDraft / loadTabDraft', () => {
    let storage;
    beforeEach(() => { storage = fakeStorage(); });

    it('round-trips a document with its metadata', () => {
        const key = tabDraftKey('gold-rush', 'banjo');
        expect(saveTabDraft(key, OTF, { title: 'Gold Rush' }, storage)).toBe(true);
        const draft = loadTabDraft(key, storage);
        expect(draft.otf).toEqual(OTF);
        expect(draft.meta.title).toBe('Gold Rush');
        expect(Date.parse(draft.savedAt)).toBeGreaterThan(0);
    });

    it('answers null for a part with no draft', () => {
        expect(loadTabDraft(tabDraftKey('nobody', 'home'), storage)).toBeNull();
    });

    it('refuses (and removes) a trackless document — the editor cannot load one', () => {
        const key = tabDraftKey('w', 'p');
        storage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), otf: { tracks: [] } }));
        expect(loadTabDraft(key, storage)).toBeNull();
        expect(storage.getItem(key)).toBeNull();
    });

    it('refuses (and removes) unparseable junk', () => {
        const key = tabDraftKey('w', 'p');
        storage.setItem(key, 'not json{');
        expect(loadTabDraft(key, storage)).toBeNull();
        expect(storage.getItem(key)).toBeNull();
    });

    it('expires a draft older than the TTL rather than offering stale edits back', () => {
        const key = tabDraftKey('w', 'p');
        const old = new Date(Date.now() - DRAFT_TTL_MS - 1000).toISOString();
        storage.setItem(key, JSON.stringify({ savedAt: old, otf: OTF }));
        expect(loadTabDraft(key, storage)).toBeNull();
        expect(storage.getItem(key)).toBeNull();
    });

    it('is best-effort: a throwing storage never breaks editing', () => {
        const hostile = {
            getItem: () => { throw new Error('SecurityError'); },
            setItem: () => { throw new Error('QuotaExceeded'); },
            removeItem: () => { throw new Error('nope'); },
        };
        expect(() => saveTabDraft('k', OTF, {}, hostile)).not.toThrow();
        expect(saveTabDraft('k', OTF, {}, hostile)).toBe(false);
        expect(loadTabDraft('k', hostile)).toBeNull();
        expect(() => clearTabDraft('k', hostile)).not.toThrow();
    });

    it('a quota failure prunes expired drafts and retries once', () => {
        const stale = tabDraftKey('old', 'p');
        const fresh = tabDraftKey('new', 'p');
        const store = {
            [stale]: JSON.stringify({
                savedAt: new Date(Date.now() - DRAFT_TTL_MS - 1).toISOString(), otf: OTF,
            }),
        };
        let full = true;
        const storage = new Proxy({
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => {
                if (full) throw new Error('QuotaExceededError');
                store[k] = v;
            },
            removeItem: (k) => { delete store[k]; full = false; },
        }, {
            ownKeys: () => Object.keys(store),
            getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
        });
        expect(saveTabDraft(fresh, OTF, {}, storage)).toBe(true);
        expect(store[stale]).toBeUndefined();   // the pile, not the document
        expect(store[fresh]).toBeDefined();
    });
});

describe('pruneTabDrafts', () => {
    it('drops expired and undateable drafts, keeps live ones, ignores other keys', () => {
        const live = tabDraftKey('live', 'p');
        const dead = tabDraftKey('dead', 'p');
        const junk = tabDraftKey('junk', 'p');
        const storage = fakeStorage({
            [live]: JSON.stringify({ savedAt: new Date().toISOString(), otf: OTF }),
            [dead]: JSON.stringify({
                savedAt: new Date(Date.now() - DRAFT_TTL_MS - 1).toISOString(), otf: OTF,
            }),
            [junk]: '{{{',
            'songbook-lists': '[]',       // someone else's key — must survive
            'otf-editor-draft': '{}',     // the create page's slot — must survive
        });
        expect(pruneTabDrafts(storage)).toBe(2);
        expect(storage.getItem(live)).not.toBeNull();
        expect(storage.getItem(dead)).toBeNull();
        expect(storage.getItem(junk)).toBeNull();
        expect(storage.getItem('songbook-lists')).toBe('[]');
        expect(storage.getItem('otf-editor-draft')).toBe('{}');
    });
});

describe('draftAge', () => {
    const now = Date.parse('2026-08-20T12:00:00Z');
    const ago = (ms) => new Date(now - ms).toISOString();

    it('reads as recency, not as a timestamp', () => {
        expect(draftAge(ago(5_000), now)).toBe('just now');
        expect(draftAge(ago(60_000), now)).toBe('1 minute ago');
        expect(draftAge(ago(10 * 60_000), now)).toBe('10 minutes ago');
        expect(draftAge(ago(60 * 60_000), now)).toBe('1 hour ago');
        expect(draftAge(ago(5 * 3600_000), now)).toBe('5 hours ago');
        expect(draftAge(ago(25 * 3600_000), now)).toBe('yesterday');
        expect(draftAge(ago(3 * 86400_000), now)).toBe('3 days ago');
    });

    it('never reads as a negative age from a clock that moved', () => {
        expect(draftAge(ago(-10_000), now)).toBe('just now');
        expect(draftAge('not a date', now)).toBe('just now');
    });
});
