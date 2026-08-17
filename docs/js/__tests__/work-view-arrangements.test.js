// Unit tests for the instrument → arrangement grouping in work-view.js.
//
// buildPartsFromIndex collapses tablature_parts into ONE part per instrument
// (one pill), each carrying its arrangements sorted default-first. Two index
// shapes must both work: the old one (no `default` field, a single row per
// instrument) and the new one (several rows per instrument, exactly one
// flagged `default: true`).
import { describe, it, expect } from 'vitest';

import {
    buildPartsFromIndex,
    sortArrangements,
    applyArrangement,
    activeArrangement,
    prettySource,
    tabLabel,
} from '../work-view.js';

const banjo = (over = {}) => ({
    instrument: 'banjo',
    file: 'data/tabs/x-banjo.otf.json',
    source: 'banjo-hangout',
    source_id: '1',
    author: 'schlange',
    ...over,
});

describe('buildPartsFromIndex — old index shape (no default field)', () => {
    it('treats a lone tablature row as the instrument default', () => {
        const parts = buildPartsFromIndex({
            id: 'angeline-baker',
            tablature_parts: [banjo({ author: 'Stringy D' })],
        });

        expect(parts).toHaveLength(1);
        const part = parts[0];
        expect(part.type).toBe('tablature');
        expect(part.partId).toBe('banjo-tab');
        expect(part.default).toBe(true);          // no lead sheet on this work
        expect(part.arrangements).toHaveLength(1);
        expect(part.arrangementIndex).toBe(0);
        expect(activeArrangement(part).author).toBe('Stringy D');
    });

    it('keeps one pill per instrument for a multi-instrument work', () => {
        const parts = buildPartsFromIndex({
            id: 'angeline-the-baker',
            content: '{meta: title Angeline}',
            tablature_parts: [
                banjo({ author: 'mwblake' }),
                { instrument: 'mandolin', file: 'data/tabs/x-mandolin.otf.json',
                  source: 'mandolin-hangout', author: 'MandoTom2' },
            ],
        });

        expect(parts.map(p => p.partId)).toEqual(
            ['lyrics-chords', 'banjo-tab', 'mandolin-tab']);
        expect(parts.filter(p => p.type === 'tablature')
            .every(p => p.arrangements.length === 1)).toBe(true);
        // A lead sheet exists, so the tabs are not the default part
        expect(parts.find(p => p.partId === 'banjo-tab').default).toBe(false);
    });
});

describe('buildPartsFromIndex — new index shape (arrangements per instrument)', () => {
    const song = {
        id: 'blackberry-blossom',
        tablature_parts: [
            banjo({ author: 'Freddie.D.Holt', source_id: '2',
                    file: 'f.otf.json', difficulty: 'Intermediate', tuning: 'Open G' }),
            banjo({ author: 'Yohansen', source_id: '3', file: 'y.otf.json',
                    default: true, difficulty: 'Intermediate', tuning: 'Open G' }),
            banjo({ author: 'Lefty5string', source_id: '4', file: 'l.otf.json',
                    difficulty: 'Beginner', tuning: 'Open G' }),
            { instrument: 'fiddle', file: 'fid.otf.json', source: 'fiddle-hangout',
              author: 'Live on What You Grow', default: true, tuning: 'GDAE' },
        ],
    };

    it('groups by instrument with the pinned arrangement first', () => {
        const parts = buildPartsFromIndex(song);

        expect(parts).toHaveLength(2);
        const [banjoPart, fiddlePart] = parts;
        expect(banjoPart.partId).toBe('banjo-tab');
        expect(banjoPart.label).toBe('Banjo Tab');
        expect(banjoPart.arrangements).toHaveLength(3);   // the count badge's N
        expect(banjoPart.arrangements.map(a => a.author)).toEqual(
            ['Yohansen', 'Freddie.D.Holt', 'Lefty5string']);
        expect(fiddlePart.arrangements).toHaveLength(1);
    });

    it('exposes the pinned arrangement fields on the part itself', () => {
        const banjoPart = buildPartsFromIndex(song)[0];
        expect(banjoPart.file).toBe('y.otf.json');
        expect(banjoPart.author).toBe('Yohansen');
        expect(banjoPart.difficulty).toBe('Intermediate');
        expect(banjoPart.tuning).toBe('Open G');
        expect(banjoPart.source).toBe('banjo-hangout');
    });

    it('never mints extra partIds for extra arrangements', () => {
        // Three banjo takes must not become banjo-tab / banjo-tab-2 / -3:
        // the URL is instrument-shaped and the arrangement is page state.
        const ids = buildPartsFromIndex(song).map(p => p.partId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(['banjo-tab', 'fiddle-tab']);
    });
});

describe('label fallbacks', () => {
    it('derives the pill label from the instrument', () => {
        expect(tabLabel('banjo')).toBe('Banjo Tab');
        expect(tabLabel('tenor-banjo')).toBe('Tenor Banjo Tab');
        expect(tabLabel(undefined)).toBe('Tab');
    });

    it('honours an explicit label on the default arrangement', () => {
        const parts = buildPartsFromIndex({
            id: 'x',
            tablature_parts: [{ instrument: 'mandolin', file: 'm.otf.json',
                                label: 'Mandolin Break' }],
        });
        expect(parts[0].label).toBe('Mandolin Break');
        expect(parts[0].partId).toBe('mandolin-break');
        // ...and still answers to the instrument-shaped slug
        expect(parts[0].aliases).toContain('mandolin-tab');
    });

    it('falls back for a tablature row with no instrument at all', () => {
        const parts = buildPartsFromIndex({
            id: 'x',
            tablature_parts: [{ file: 'a.otf.json' }, { file: 'b.otf.json' }],
        });
        expect(parts).toHaveLength(1);              // both fall in one group
        expect(parts[0].label).toBe('Tab');
        expect(parts[0].arrangements).toHaveLength(2);
    });
});

describe('sortArrangements', () => {
    it('is stable when nothing is flagged (old shape)', () => {
        const rows = [{ author: 'a' }, { author: 'b' }, { author: 'c' }];
        expect(sortArrangements(rows).map(r => r.author)).toEqual(['a', 'b', 'c']);
    });

    it('floats the flagged default to the front', () => {
        const rows = [{ author: 'a' }, { author: 'b', default: true }, { author: 'c' }];
        expect(sortArrangements(rows).map(r => r.author)).toEqual(['b', 'a', 'c']);
    });

    it('tolerates a bad group with several defaults', () => {
        const rows = [{ author: 'a' }, { author: 'b', default: true },
                      { author: 'c', default: true }];
        expect(sortArrangements(rows).map(r => r.author)).toEqual(['b', 'c', 'a']);
    });

    it('does not mutate the input array', () => {
        const rows = [{ author: 'a' }, { author: 'b', default: true }];
        sortArrangements(rows);
        expect(rows.map(r => r.author)).toEqual(['a', 'b']);
    });
});

describe('applyArrangement', () => {
    const part = () => buildPartsFromIndex({
        id: 'x',
        tablature_parts: [
            banjo({ author: 'Pinned', file: 'p.otf.json', default: true,
                    source_page_url: 'https://bh/1', author_url: 'https://bh/u/1' }),
            banjo({ author: 'Other', file: 'o.otf.json', difficulty: 'Beginner',
                    source: 'flatpicker-hangout',
                    source_page_url: 'https://fh/2', author_url: 'https://fh/u/2' }),
        ],
    })[0];

    it('swaps the arrangement-scoped fields onto the part', () => {
        const p = part();
        expect(applyArrangement(p, 1)).toBe(true);
        expect(p.arrangementIndex).toBe(1);
        expect(p.file).toBe('o.otf.json');
        expect(p.author).toBe('Other');
        expect(p.author_url).toBe('https://fh/u/2');
        expect(p.source_page_url).toBe('https://fh/2');
        expect(p.difficulty).toBe('Beginner');
        expect(activeArrangement(p).author).toBe('Other');
    });

    it('carries src_file, the file a correction to this take must name', () => {
        // The index publishes `file` as the flattened data/tabs/ name,
        // which can't be mapped back to works/. Without src_file on the
        // ACTIVE arrangement, a correction to any take but the first was
        // submitted against `{instrument}.otf.json` — a different part.
        const p = buildPartsFromIndex({
            id: 'x',
            tablature_parts: [
                banjo({ file: 'data/tabs/x-banjo-1.otf.json',
                        src_file: 'banjo.otf.json', default: true }),
                banjo({ source_id: '2', file: 'data/tabs/x-banjo-2.otf.json',
                        src_file: 'banjo-2.otf.json' }),
            ],
        })[0];
        expect(p.src_file).toBe('banjo.otf.json');
        applyArrangement(p, 1);
        expect(p.src_file).toBe('banjo-2.otf.json');
    });

    it('leaves the pill label and partId alone', () => {
        const p = part();
        applyArrangement(p, 1);
        expect(p.label).toBe('Banjo Tab');
        expect(p.partId).toBe('banjo-tab');
    });

    it('reports no change when reselecting the loaded arrangement', () => {
        const p = part();
        expect(applyArrangement(p, 0)).toBe(false);
    });

    it('clamps out-of-range indexes', () => {
        const p = part();
        expect(applyArrangement(p, 99)).toBe(true);
        expect(p.arrangementIndex).toBe(1);
        expect(applyArrangement(p, -5)).toBe(true);
        expect(p.arrangementIndex).toBe(0);
    });

    it('is a no-op for parts without arrangements (lead sheets)', () => {
        const lead = buildPartsFromIndex({ id: 'x', content: '{meta: title X}' })[0];
        expect(applyArrangement(lead, 1)).toBe(false);
        expect(activeArrangement(lead)).toBe(null);
    });
});

describe('prettySource', () => {
    it('humanises source slugs for the bar and attribution line', () => {
        expect(prettySource('banjo-hangout')).toBe('Banjo Hangout');
        expect(prettySource('flatpicker-hangout')).toBe('Flatpicker Hangout');
        expect(prettySource('tunearch')).toBe('Tunearch');
        expect(prettySource(undefined)).toBe('');
    });
});
