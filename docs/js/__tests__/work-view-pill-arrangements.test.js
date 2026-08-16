// The Arrangement pill with forked lead sheets on the page (issue #232).
//
// Drives the real song page in jsdom: open a work that holds two lead
// sheets, open the pill, and check that both takes are listed and that
// picking one swaps the chart without navigating.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { openWork } from '../work-view.js';
import { setAllSongs, setSongGroups, currentChordpro } from '../state.js';
import { clearSongContentCache } from '../song-content.js';
import { mergeCorpus } from '../corpus.js';

const ORIGINAL = '{meta: title How Long Blues}\n[G]How [C]long\n';
const FORKED = '{meta: title How Long Blues}\n{meta: x_version_label Simplified}\n[G]How long\n';

const SONG = {
    id: 'how-long-blues',
    title: 'How Long Blues',
    artist: 'Jimmy Rushing',
    group_id: 'g1',
    key: 'G',
    chord_count: 2,
    has_content: true,
    arrangements: [
        { slug: 'default', label: 'Original', default: true,
          file: 'data/songs/how-long-blues.pro', key: 'G', chord_count: 2 },
        { slug: 'simplified', label: 'Simplified', version_type: 'simplified',
          arrangement_by: 'Jane Picker', key: 'G', chord_count: 1,
          file: 'data/songs/how-long-blues--simplified.pro' },
    ],
};

const BODY = {
    'data/songs/how-long-blues.pro': ORIGINAL,
    'data/songs/how-long-blues--simplified.pro': FORKED,
};

function pillItems() {
    return [...document.querySelectorAll('#arrangement-pill .arrangement-item')];
}

function openPill() {
    document.querySelector('#arrangement-pill .pill-btn').click();
}

/** Let the content fetch settle (two microtask hops: fetch -> text). */
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(async () => {
    vi.restoreAllMocks();
    clearSongContentCache();
    document.body.innerHTML = '<div id="song-content"></div>';
    // jsdom has no matchMedia; the top band asks it whether to slim down
    window.matchMedia = () => ({ matches: false, addEventListener() {} });
    global.fetch = vi.fn((url) => Promise.resolve(
        BODY[url] === undefined
            ? { ok: false, status: 404, text: () => Promise.resolve('') }
            : { ok: true, status: 200, text: () => Promise.resolve(BODY[url]) }
    ));
    setAllSongs([SONG]);
    setSongGroups({ g1: [SONG] });
});

describe('Arrangement pill — forked lead sheets on one work', () => {
    it('lists every take of the song, primary first', async () => {
        await openWork('how-long-blues');
        await settle();

        expect(document.getElementById('arrangement-pill')).toBeTruthy();
        expect(document.querySelector('#arrangement-pill .pill-label')
            .textContent).toBe('2 versions');

        openPill();
        const items = pillItems();
        expect(items.map(i => i.dataset.arrSlug))
            .toEqual(['default', 'simplified']);
        expect(items[0].classList.contains('current')).toBe(true);
        expect(items[1].textContent).toContain('Simplified');
        expect(items[1].textContent).toContain('Jane Picker');
    });

    it('gives every published take its own ballot (issue #233)', () => {
        return openWork('how-long-blues').then(async () => {
            await settle();
            openPill();
            const items = pillItems();
            const btns = items.map(i => i.querySelector('.arrangement-vote-btn'));
            expect(btns.every(Boolean)).toBe(true);
            // The primary votes under the work-level (empty) key, so rows
            // written before forks existed keep counting; forks vote as
            // themselves.
            expect(btns[0].dataset.voteSlug).toBe('');
            expect(btns[1].dataset.voteSlug).toBe('simplified');
            // ...and both name the work, which is what song_votes.song_id is
            expect(new Set(btns.map(b => b.dataset.songId)))
                .toEqual(new Set(['how-long-blues']));
        });
    });

    it('swaps the rendered chart without navigating', async () => {
        await openWork('how-long-blues');
        await settle();
        expect(currentChordpro).toBe(ORIGINAL);
        const hashBefore = window.location.hash;

        openPill();
        pillItems()[1].click();
        await settle();

        expect(currentChordpro).toBe(FORKED);
        expect(window.location.hash).toBe(hashBefore);   // same work, same URL

        openPill();
        const items = pillItems();
        expect(items[1].classList.contains('current')).toBe(true);
        expect(items[0].classList.contains('current')).toBe(false);
    });

    it('fetches each take from its own file, once', async () => {
        await openWork('how-long-blues');
        await settle();
        openPill();
        pillItems()[1].click();
        await settle();
        openPill();
        pillItems()[0].click();          // back to the original
        await settle();

        const asked = global.fetch.mock.calls.map(c => c[0]);
        expect(asked).toContain('data/songs/how-long-blues.pro');
        expect(asked).toContain('data/songs/how-long-blues--simplified.pro');
        expect(new Set(asked).size).toBe(asked.length);   // nothing refetched
    });

    it('keeps the fork toast honest before the build lands', async () => {
        // What the browser has seconds after a fork is submitted: a pending
        // overlay on a work with one published lead sheet.
        const published = { ...SONG, arrangements: undefined };
        const { songs, groups } = mergeCorpus({
            canon: [published],
            pending: [{ id: published.id, replaces_id: published.id,
                        content: FORKED, created_by: 'uuid-me' }],
        });
        setAllSongs(songs);
        setSongGroups(groups);

        await openWork('how-long-blues');
        await settle();

        // the submitter sees their own text right away...
        expect(currentChordpro).toBe(FORKED);
        openPill();
        const items = pillItems();
        expect(items.map(i => i.dataset.arrSlug)).toEqual(['default', 'pending']);
        expect(items[1].querySelector('.arrangement-label').textContent)
            .toContain('Your arrangement');
        expect(items[1].textContent).toContain('not published yet');
        expect(items[1].classList.contains('current')).toBe(true);

        // ...and the chart it forked from is still one click away
        items[0].click();
        await settle();
        expect(currentChordpro).toBe(ORIGINAL);
        expect(global.fetch).toHaveBeenCalledWith(
            'data/songs/how-long-blues.pro');
    });

    it('shows no pill at all for a work with a single lead sheet', async () => {
        const plain = { ...SONG, arrangements: undefined };
        setAllSongs([plain]);
        setSongGroups({ g1: [plain] });
        await openWork('how-long-blues');
        await settle();
        expect(document.getElementById('arrangement-pill')).toBeNull();
    });
});
