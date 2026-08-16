// Per-arrangement voting in the Arrangement pill (issue #233).
//
// The contract Phase 2c owes: a fork is a version of the song, so it gets a
// ballot of its own. Votes RANK the takes; the editorial `default` flag still
// PINS which one leads the list.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    openWork, configureWorkPage,
    arrangementVoteKey, sortArrangementRows, defaultFlipSignal,
} from '../work-view.js';
import { setAllSongs, setSongGroups } from '../state.js';
import { clearSongContentCache } from '../song-content.js';
import { mergeCorpus } from '../corpus.js';

const ORIGINAL = '{meta: title How Long Blues}\n[G]How [C]long\n';
const SIMPLE = '{meta: title How Long Blues}\n[G]How long\n';
const CAPO = '{meta: title How Long Blues}\n[A]How [D]long\n';

const PRIMARY = { slug: 'default', label: 'Original', default: true,
                  file: 'data/songs/how-long-blues.pro', key: 'G', chord_count: 2 };
const SIMPLIFIED = { slug: 'simplified', label: 'Simplified',
                     arrangement_by: 'Jane Picker', key: 'G', chord_count: 1,
                     file: 'data/songs/how-long-blues--simplified.pro' };
const CAPO_ARR = { slug: 'capo-2', label: 'Capo 2', key: 'A', chord_count: 2,
                   file: 'data/songs/how-long-blues--capo-2.pro' };

const SONG = {
    id: 'how-long-blues',
    title: 'How Long Blues',
    artist: 'Jimmy Rushing',
    group_id: 'g1',
    key: 'G',
    chord_count: 2,
    has_content: true,
    arrangements: [PRIMARY, SIMPLIFIED, CAPO_ARR],
};

const BODY = {
    'data/songs/how-long-blues.pro': ORIGINAL,
    'data/songs/how-long-blues--simplified.pro': SIMPLE,
    'data/songs/how-long-blues--capo-2.pro': CAPO,
};

const settle = () => new Promise(r => setTimeout(r, 0));

function pillItems() {
    return [...document.querySelectorAll('#arrangement-pill .arrangement-item')];
}
function openPill() {
    document.querySelector('#arrangement-pill .pill-btn').click();
}
function flipNote() {
    return document.querySelector('#arrangement-pill .arrangement-flip-note');
}

/** A SupabaseAuth stand-in whose vote tables the test controls. */
function stubAuth({ arrCounts = {}, arrUserVotes = {}, loggedIn = true } = {}) {
    const auth = {
        isLoggedIn: () => loggedIn,
        fetchGroupVotes: vi.fn(async () => ({ data: {} })),
        fetchUserVotes: vi.fn(async () => ({ data: {} })),
        fetchArrangementVotes: vi.fn(async () => ({ data: arrCounts })),
        fetchUserArrangementVotes: vi.fn(async () => ({ data: arrUserVotes })),
        castVote: vi.fn(async () => ({ error: null })),
        removeVote: vi.fn(async () => ({ error: null })),
    };
    vi.stubGlobal('SupabaseAuth', auth);
    return auth;
}

/** Open the pill and let the async vote fetch re-render it. */
async function openPillWithVotes() {
    openPill();
    await settle();
    await settle();
}

beforeEach(async () => {
    vi.restoreAllMocks();
    clearSongContentCache();
    configureWorkPage({ isTrusted: () => false });
    document.body.innerHTML = '<div id="song-content"></div>';
    window.matchMedia = () => ({ matches: false, addEventListener() {} });
    global.fetch = vi.fn((url) => Promise.resolve(
        BODY[url] === undefined
            ? { ok: false, status: 404, text: () => Promise.resolve('') }
            : { ok: true, status: 200, text: () => Promise.resolve(BODY[url]) }
    ));
    setAllSongs([SONG]);
    setSongGroups({ g1: [SONG] });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('arrangementVoteKey', () => {
    it('keys the default take work-level, so old votes still count', () => {
        expect(arrangementVoteKey(PRIMARY)).toBe('');
    });

    it('keys a fork by its (build-stable) slug', () => {
        expect(arrangementVoteKey(SIMPLIFIED)).toBe('simplified');
    });

    it('treats a work with no arrangement at all as work-level', () => {
        expect(arrangementVoteKey(null)).toBe('');
        expect(arrangementVoteKey({})).toBe('');
    });
});

describe('sortArrangementRows', () => {
    const arrangements = [PRIMARY, SIMPLIFIED, CAPO_ARR];

    it('ranks the challengers by votes', () => {
        const order = sortArrangementRows(arrangements,
            { '': 1, simplified: 2, 'capo-2': 9 }).map(a => a.slug);
        expect(order).toEqual(['default', 'capo-2', 'simplified']);
    });

    it('keeps the default first even when it is losing — the flag is editorial', () => {
        const order = sortArrangementRows(arrangements,
            { '': 0, simplified: 40, 'capo-2': 12 }).map(a => a.slug);
        expect(order[0]).toBe('default');
    });

    it('keeps index order on a tie and does not mutate its input', () => {
        const input = [...arrangements];
        expect(sortArrangementRows(input, {}).map(a => a.slug))
            .toEqual(['default', 'simplified', 'capo-2']);
        expect(input.map(a => a.slug))
            .toEqual(['default', 'simplified', 'capo-2']);
    });
});

describe('defaultFlipSignal', () => {
    it('stays quiet while the default leads', () => {
        expect(defaultFlipSignal([PRIMARY, SIMPLIFIED],
            { '': 5, simplified: 2 })).toBeNull();
    });

    it('stays quiet on a tie — a tie is not a mandate', () => {
        expect(defaultFlipSignal([PRIMARY, SIMPLIFIED],
            { '': 3, simplified: 3 })).toBeNull();
    });

    it('reports the strongest challenger and its margin', () => {
        const signal = defaultFlipSignal([PRIMARY, SIMPLIFIED, CAPO_ARR],
            { '': 2, simplified: 4, 'capo-2': 7 });
        expect(signal).toMatchObject({
            slug: 'capo-2', label: 'Capo 2',
            votes: 7, defaultVotes: 2, margin: 5,
        });
    });

    it('ignores an unpublished fork — nobody else can vote on it', () => {
        const pending = { slug: 'pending', label: 'Your arrangement', pending: true };
        expect(defaultFlipSignal([PRIMARY, pending], { '': 0, pending: 99 }))
            .toBeNull();
    });

    it('says nothing about a work with no editorial default', () => {
        expect(defaultFlipSignal([SIMPLIFIED, CAPO_ARR], { simplified: 9 }))
            .toBeNull();
    });
});

describe('Arrangement pill — per-arrangement ballots', () => {
    it('shows each take its own count and the reader their own vote', async () => {
        stubAuth({
            arrCounts: { '': 3, simplified: 8 },
            arrUserVotes: { simplified: 1 },
        });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        const items = pillItems();
        const bySlug = Object.fromEntries(
            items.map(i => [i.dataset.arrSlug, i]));
        expect(bySlug.default.querySelector('.vote-count').textContent).toBe('3');
        expect(bySlug.simplified.querySelector('.vote-count').textContent).toBe('8');
        expect(bySlug['capo-2'].querySelector('.vote-count').textContent).toBe('0');

        expect(bySlug.simplified.querySelector('.arrangement-vote-btn')
            .classList.contains('voted')).toBe(true);
        expect(bySlug.default.querySelector('.arrangement-vote-btn')
            .classList.contains('voted')).toBe(false);
    });

    it('orders the challengers by votes, default pinned on top', async () => {
        stubAuth({ arrCounts: { '': 0, simplified: 1, 'capo-2': 6 } });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        expect(pillItems().map(i => i.dataset.arrSlug))
            .toEqual(['default', 'capo-2', 'simplified']);
    });

    it('casts a fork vote under the fork slug', async () => {
        const auth = stubAuth({ arrCounts: { '': 0, simplified: 2 } });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        const row = pillItems().find(i => i.dataset.arrSlug === 'simplified');
        row.querySelector('.arrangement-vote-btn').click();
        await settle();

        expect(auth.castVote).toHaveBeenCalledWith(
            'how-long-blues', 'g1', 1, 'simplified');
        expect(row.querySelector('.vote-count').textContent).toBe('3');
    });

    it('casts the primary vote work-level, exactly as before forks existed', async () => {
        const auth = stubAuth({ arrCounts: {} });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        pillItems()[0].querySelector('.arrangement-vote-btn').click();
        await settle();

        expect(auth.castVote).toHaveBeenCalledWith(
            'how-long-blues', 'g1', 1, null);
    });

    it('removes a fork vote without touching the work-level one', async () => {
        const auth = stubAuth({
            arrCounts: { '': 4, simplified: 2 },
            arrUserVotes: { '': 1, simplified: 1 },
        });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        const row = pillItems().find(i => i.dataset.arrSlug === 'simplified');
        row.querySelector('.arrangement-vote-btn').click();
        await settle();

        expect(auth.removeVote).toHaveBeenCalledWith('how-long-blues', 'simplified');
        expect(row.querySelector('.vote-count').textContent).toBe('1');
        // the primary's tally is untouched on screen
        expect(pillItems()[0].querySelector('.vote-count').textContent).toBe('4');
    });

    it('refuses to vote when signed out, and casts nothing', async () => {
        const auth = stubAuth({ loggedIn: false });
        window.alert = vi.fn();
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        pillItems()[1].querySelector('.arrangement-vote-btn').click();
        await settle();

        expect(auth.castVote).not.toHaveBeenCalled();
        expect(window.alert).toHaveBeenCalled();
    });

    it('gives an unpublished fork no ballot', async () => {
        stubAuth();
        const published = { ...SONG, arrangements: undefined };
        const { songs, groups } = mergeCorpus({
            canon: [published],
            pending: [{ id: published.id, replaces_id: published.id,
                        content: SIMPLE, created_by: 'uuid-me' }],
        });
        setAllSongs(songs);
        setSongGroups(groups);

        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        const items = pillItems();
        const pending = items.find(i => i.dataset.arrSlug === 'pending');
        expect(pending.querySelector('.arrangement-vote-btn')).toBeNull();
        expect(items.find(i => i.dataset.arrSlug === 'default')
            .querySelector('.arrangement-vote-btn')).toBeTruthy();
    });
});

describe('Arrangement pill — the default-flip signal', () => {
    it('surfaces the imbalance without changing anything', async () => {
        stubAuth({ arrCounts: { '': 1, simplified: 6 } });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        const note = flipNote();
        expect(note).toBeTruthy();
        expect(note.textContent).toContain('Simplified');
        expect(note.textContent).toContain('6');
        expect(note.textContent).toMatch(/editorial/i);
        // the default is still the default: it is still row one
        expect(pillItems()[0].dataset.arrSlug).toBe('default');
    });

    it('tells a trusted user which file makes it real', async () => {
        configureWorkPage({ isTrusted: () => true });
        stubAuth({ arrCounts: { '': 1, simplified: 6 } });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        expect(flipNote().textContent)
            .toContain('works/how-long-blues/work.yaml');
    });

    it('keeps the file path out of an ordinary reader\'s way', async () => {
        stubAuth({ arrCounts: { '': 1, simplified: 6 } });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        expect(flipNote().textContent).not.toContain('work.yaml');
    });

    it('shows nothing while the default is winning', async () => {
        stubAuth({ arrCounts: { '': 9, simplified: 1 } });
        await openWork('how-long-blues');
        await settle();
        await openPillWithVotes();

        expect(flipNote()).toBeNull();
    });
});
