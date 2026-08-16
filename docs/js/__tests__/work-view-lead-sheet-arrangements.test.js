// Forked lead sheets in the Arrangement pill (issue #232).
//
// A work can hold more than one lead sheet: editing somebody else's chart
// lands yours as an extra part on the SAME work rather than overwriting
// theirs. The index publishes those as `arrangements` on the row; these
// tests pin how the pill turns that into a choice, and how the pending
// overlay keeps its promise before the build has caught up.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    leadSheetArrangements,
    initialArrangementSlug,
} from '../work-view.js';
import { mergeCorpus, pendingForkArrangements } from '../corpus.js';
import {
    getArrangementContent, peekArrangementContent,
    primeSongContent, clearSongContentCache,
} from '../song-content.js';

const PRIMARY = {
    slug: 'default', label: 'Original', default: true,
    file: 'data/songs/how-long-blues.pro', key: 'G', chord_count: 3,
};
const FORK = {
    slug: 'simplified', label: 'Simplified', version_type: 'simplified',
    arrangement_by: 'Jane Picker',
    file: 'data/songs/how-long-blues--simplified.pro', key: 'G',
    chord_count: 2,
};

const work = (over = {}) => ({
    id: 'how-long-blues', title: 'How Long Blues', has_content: true,
    key: 'G', chord_count: 3, group_id: 'g1', ...over,
});

describe('leadSheetArrangements', () => {
    it('is empty for a work with one lead sheet (the whole corpus today)', () => {
        expect(leadSheetArrangements(work())).toEqual([]);
        expect(leadSheetArrangements(work({ arrangements: [PRIMARY] })))
            .toEqual([]);
    });

    it('lists every chart once a fork exists', () => {
        const list = leadSheetArrangements(
            work({ arrangements: [PRIMARY, FORK] }));
        expect(list.map(a => a.slug)).toEqual(['default', 'simplified']);
        expect(list[1].arrangement_by).toBe('Jane Picker');
    });

    it('backfills a slug so a hand-written entry can never collide', () => {
        const list = leadSheetArrangements(work({
            arrangements: [{ file: 'a.pro' }, { file: 'b.pro' }],
        }));
        expect(list.map(a => a.slug)).toEqual(['p0', 'p1']);
    });

    it('ignores junk entries', () => {
        expect(leadSheetArrangements(work({ arrangements: [null, PRIMARY] })))
            .toEqual([]);
    });
});

describe('initialArrangementSlug', () => {
    it('opens on the primary chart', () => {
        const list = leadSheetArrangements(
            work({ arrangements: [FORK, PRIMARY] }));
        expect(initialArrangementSlug(work(), list)).toBe('default');
    });

    it('opens on the arrangement the row is already showing', () => {
        // a pending fork: the row carries the submitter's text inline
        const song = work({ content: '[G]my take' });
        const list = leadSheetArrangements(work({
            arrangements: [PRIMARY, { slug: 'pending', content: '[G]my take' }],
        }));
        expect(initialArrangementSlug(song, list)).toBe('pending');
    });

    it('is null when there is nothing to choose between', () => {
        expect(initialArrangementSlug(work(), [])).toBe(null);
    });
});

describe('pendingForkArrangements — the interim state', () => {
    const base = work({ submitted_by: 'uuid-original' });

    it('advertises both takes while the build catches up', () => {
        const list = pendingForkArrangements(
            base, { id: base.id, content: '[G]my take', created_by: 'uuid-me' });
        expect(list.map(a => a.slug)).toEqual(['default', 'pending']);
        expect(list[0].file).toBe('data/songs/how-long-blues.pro');
        expect(list[1].content).toBe('[G]my take');
        expect(list[1].pending).toBe(true);
    });

    it('treats an unowned chart as a fork (matches owns_content)', () => {
        // no submitted_by anywhere = nobody owns it = the server forks
        const list = pendingForkArrangements(
            work(), { content: '[G]my take', created_by: 'uuid-me' });
        expect(list).not.toBe(null);
    });

    it('is not a fork when you already own the chart', () => {
        expect(pendingForkArrangements(
            base, { content: '[G]my take', created_by: 'uuid-original' }
        )).toBe(null);
    });

    it('keeps the published forks that are already indexed', () => {
        const list = pendingForkArrangements(
            work({ arrangements: [PRIMARY, FORK] }),
            { content: '[G]my take', created_by: 'uuid-me' });
        expect(list.map(a => a.slug))
            .toEqual(['default', 'simplified', 'pending']);
    });

    it('ignores a metadata-only row with no chart', () => {
        expect(pendingForkArrangements(base, { created_by: 'uuid-me' }))
            .toBe(null);
    });

    it('rides through mergeCorpus onto the overlaid row', () => {
        const { songs } = mergeCorpus({
            canon: [base],
            pending: [{ id: base.id, replaces_id: base.id,
                        content: '[G]my take', created_by: 'uuid-me' }],
        });
        expect(songs).toHaveLength(1);
        expect(songs[0].arrangements.map(a => a.slug))
            .toEqual(['default', 'pending']);
        // the overlay still shows the submitter their own text
        expect(songs[0].content).toBe('[G]my take');
    });

    it('leaves an ordinary update alone', () => {
        const { songs } = mergeCorpus({
            canon: [base],
            pending: [{ id: base.id, replaces_id: base.id,
                        content: '[G]my fix', created_by: 'uuid-original' }],
        });
        expect(songs[0].arrangements).toBeUndefined();
    });
});

describe('getArrangementContent', () => {
    beforeEach(() => {
        clearSongContentCache();
        vi.restoreAllMocks();
    });

    it('returns an inline (pending) chart without a request', async () => {
        global.fetch = vi.fn();
        await expect(getArrangementContent(
            work(), { slug: 'pending', content: '[G]my take' }
        )).resolves.toBe('[G]my take');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('fetches a fork by its own file, not by the work id', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true, status: 200, text: () => Promise.resolve('[G]fork'),
        }));
        await expect(getArrangementContent(work(), FORK))
            .resolves.toBe('[G]fork');
        expect(global.fetch).toHaveBeenCalledWith(
            'data/songs/how-long-blues--simplified.pro');
    });

    it('caches by file — a second ask makes no second request', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true, status: 200, text: () => Promise.resolve('[G]fork'),
        }));
        await getArrangementContent(work(), FORK);
        await getArrangementContent(work(), FORK);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(peekArrangementContent(work(), FORK)).toBe('[G]fork');
    });

    it('sees a primed edit through the primary entry too', async () => {
        global.fetch = vi.fn();
        primeSongContent('how-long-blues', '[G]just saved');
        await expect(getArrangementContent(work(), PRIMARY))
            .resolves.toBe('[G]just saved');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('falls back to the work when there is no arrangement', async () => {
        primeSongContent('how-long-blues', '[G]primary');
        await expect(getArrangementContent(work(), null))
            .resolves.toBe('[G]primary');
    });

    it('has nothing in hand for an unfetched fork', () => {
        expect(peekArrangementContent(work(), FORK)).toBe(null);
    });
});
