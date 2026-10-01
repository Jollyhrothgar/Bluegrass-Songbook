// song-view.js performance behaviours: markWrappedLines batches its layout
// reads before its writes, and the list nav bar warms the next song's chart.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../lists.js', () => ({
    updateListPickerButton: vi.fn(),
    updateFavoriteButton: vi.fn(),
    getSongMetadata: vi.fn(() => null),
    updateSongMetadata: vi.fn(),
}));
vi.mock('../tags.js', () => ({
    renderTagBadges: vi.fn(() => ''),
    getTagCategory: vi.fn(() => 'genre'),
    formatTagName: vi.fn((tag) => tag),
}));
vi.mock('../analytics.js', () => ({
    trackSongView: vi.fn(), trackTranspose: vi.fn(), trackVersionPicker: vi.fn(),
    trackTagVote: vi.fn(), trackTagSuggest: vi.fn(), endSongView: vi.fn(),
    trackTagsExpand: vi.fn(),
}));
vi.mock('../flags.js', () => ({ openFlagModal: vi.fn() }));
vi.mock('../work-view.js', () => ({ openWork: vi.fn() }));

const prefetch = vi.fn();
vi.mock('../song-content.js', async (importOriginal) => ({
    ...await importOriginal(),
    prefetchSongContent: (...args) => prefetch(...args),
}));

import { markWrappedLines, prefetchNextInList } from '../song-view.js';
import { allSongs } from '../state.js';

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    prefetch.mockClear();
    allSongs.length = 0;
});

describe('markWrappedLines', () => {
    function buildLines(n) {
        document.body.innerHTML = Array.from({ length: n }, (_, i) =>
            `<div class="cl-line" id="l${i}"><span class="cl-segment">x</span></div>`).join('');
    }

    it('does every layout read before the first class write', () => {
        buildLines(5);
        const log = [];
        // jsdom has no layout; report heights through getters that log, and
        // make line 2 (only) taller than a single row.
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
            log.push('read'); return 20;
        });
        vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
            log.push('read'); return this.id === 'l2' ? 60 : 20;
        });
        const toggle = DOMTokenList.prototype.toggle;
        vi.spyOn(DOMTokenList.prototype, 'toggle').mockImplementation(function (...args) {
            log.push('write'); return toggle.apply(this, args);
        });

        markWrappedLines();

        const firstWrite = log.indexOf('write');
        const lastRead = log.lastIndexOf('read');
        expect(firstWrite).toBeGreaterThan(-1);
        expect(lastRead).toBeLessThan(firstWrite);       // reads, THEN writes
        expect(log.filter(x => x === 'write')).toHaveLength(5);
    });

    it('still marks exactly the wrapped lines', () => {
        buildLines(4);
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
        vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
            return this.id === 'l1' || this.id === 'l3' ? 44 : 21;   // 21 = within the 2px slack
        });
        markWrappedLines();
        const wrapped = [...document.querySelectorAll('.cl-line.wrapped')].map(l => l.id);
        expect(wrapped).toEqual(['l1', 'l3']);
    });

    it('clears a stale mark when a line no longer wraps', () => {
        buildLines(1);
        document.getElementById('l0').classList.add('wrapped');
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
        vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20);
        markWrappedLines();
        expect(document.getElementById('l0').classList.contains('wrapped')).toBe(false);
    });

    it('skips lines with no segment', () => {
        document.body.innerHTML = '<div class="cl-line" id="empty"></div>';
        expect(() => markWrappedLines()).not.toThrow();
        expect(document.getElementById('empty').classList.contains('wrapped')).toBe(false);
    });
});

describe('prefetchNextInList', () => {
    const lean = (id) => ({ id, title: id, has_content: true });
    beforeEach(() => { allSongs.push(lean('a'), lean('b'), lean('c')); });

    it('warms the song after the current one', () => {
        prefetchNextInList({ songIds: ['a', 'b', 'c'], currentIndex: 0 });
        expect(prefetch).toHaveBeenCalledTimes(1);
        expect(prefetch).toHaveBeenCalledWith(allSongs[1]);
    });

    it('does nothing on the last song', () => {
        prefetchNextInList({ songIds: ['a', 'b', 'c'], currentIndex: 2 });
        expect(prefetch).not.toHaveBeenCalled();
    });

    it('leaves part-qualified items alone (they may open a tab)', () => {
        prefetchNextInList({ songIds: ['a', 'b/banjo'], currentIndex: 0 });
        expect(prefetch).not.toHaveBeenCalled();
    });

    it('tolerates an unknown id and a missing context', () => {
        prefetchNextInList({ songIds: ['a', 'zzz'], currentIndex: 0 });
        expect(prefetch).toHaveBeenCalledWith(undefined);   // prefetchSongContent ignores it
        prefetchNextInList(null);
        prefetchNextInList({ songIds: [], currentIndex: 0 });
    });
});
