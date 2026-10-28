// @vitest-environment jsdom
// A song page that does not exist is logged (`song_not_found`), so
// `./scripts/utility search-gaps` can list the links visitors arrive by and
// find nothing. A redirect to a surviving twin is not a miss and logs nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../analytics.js', async (importOriginal) => ({
    ...await importOriginal(),
    trackSongNotFound: vi.fn(),
}));

const survivors = { redirect: null, suggestions: [] };
vi.mock('../work-suggest.js', () => ({
    findSurvivors: vi.fn(() => survivors),
    loadDeletedSongs: vi.fn(async () => new Set()),
}));

import { openWork } from '../work-view.js';
import { setAllSongs } from '../state.js';
import { trackSongNotFound } from '../analytics.js';

beforeEach(() => {
    document.body.innerHTML = '<div id="song-content"></div>';
    window.isArchiveLoaded = () => true;      // nothing left to load: a real miss
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    delete window.refreshPendingSongs;
    setAllSongs([{ id: 'tall-pines', title: 'Tall Pines' }]);
    survivors.redirect = null;
    survivors.suggestions = [];
    trackSongNotFound.mockClear();
});

describe('song not found', () => {
    it('logs the id, how the visitor got here, and how many suggestions they saw', async () => {
        survivors.suggestions = [{ id: 'tall-pines', title: 'Tall Pines' }];
        await openWork('tall-pine', { fromDeepLink: true });

        expect(document.querySelector('.not-found')).not.toBeNull();
        expect(trackSongNotFound).toHaveBeenCalledWith('tall-pine', 'deep_link', 1);
    });

    it.each([
        [{ fromList: true }, 'list'],
        [{ fromHistory: true }, 'history'],
        [{}, 'app'],
    ])('names the source %o as %s', async (options, source) => {
        await openWork('gone-song', options);
        expect(trackSongNotFound).toHaveBeenCalledWith('gone-song', source, 0);
    });

    it('logs nothing when a surviving twin takes the visitor there instead', async () => {
        survivors.redirect = { id: 'tall-pines' };
        await openWork('tall-pine', { fromDeepLink: true });
        expect(trackSongNotFound).not.toHaveBeenCalled();
    });
});
