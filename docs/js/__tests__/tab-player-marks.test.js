// Repeat signs (G15d4): the player is unchanged. It follows reading_list
// only, like TablEdit. TablEdit's Rich-MIDI export of the 7 files whose
// repeats are ONLY barlines plays them straight through (MIDI measures ==
// written measures, note counts match), so ours must too.
//
// Fixtures: tests/parser/fixtures/marks_only_*.tef (frozen copies of the 7
// Hangout downloads named in issue #318, G15d4).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTefBytes } from '../tef-import/reader.js';
import { tefToOtf, toOtfDict } from '../tef-import/otf.js';
import {
    readingListTimeline, expandNotation, maxMeasureIn, measureTimingFromOtf,
    TimelineTiming,
} from '../renderers/measure-timing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, '../../../tests/parser/fixtures');
const FILES = fs.readdirSync(FIX).filter(f => f.startsWith('marks_only_') && f.endsWith('.tef')).sort();

const otfOf = (f) => toOtfDict(tefToOtf(parseTefBytes(
    Uint8Array.from(fs.readFileSync(path.join(FIX, f))), f)));

// What TabPlayer.play() builds before scheduling (tab-player.js ~835):
// the reading-list timeline and each track's notation expanded onto it.
function playbackOf(otf) {
    const timeline = readingListTimeline(otf.reading_list, maxMeasureIn(otf.notation));
    const timing = new TimelineTiming(measureTimingFromOtf(otf), timeline);
    const tracks = Object.fromEntries(Object.entries(otf.notation)
        .map(([id, n]) => [id, expandNotation(n, timeline)]));
    return { timeline, tracks, starts: timeline.map(t => timing.startTick(t.display)) };
}

describe('marks-only files play straight through', () => {
    it('has all seven', () => expect(FILES).toHaveLength(7));

    it.each(FILES)('%s: no reading list, identity timeline, every note once', (f) => {
        const otf = otfOf(f);
        expect(otf.reading_list).toBeUndefined();
        expect(otf.measure_marks.length).toBeGreaterThan(0);
        const { timeline, tracks } = playbackOf(otf);
        const max = maxMeasureIn(otf.notation);
        expect(timeline).toHaveLength(max);
        expect(timeline.every((t, i) => t.display === i + 1 && t.original === i + 1)).toBe(true);
        for (const [id, written] of Object.entries(otf.notation)) {
            const count = (n) => n.reduce((s, m) => s + m.events.reduce((e, ev) => e + ev.notes.length, 0), 0);
            expect(count(tracks[id])).toBe(count(written));
        }
    });

    it.each(FILES)('%s: the marks change nothing the player reads', (f) => {
        const otf = otfOf(f);
        const stripped = { ...otf };
        delete stripped.measure_marks;
        expect(playbackOf(otf)).toEqual(playbackOf(stripped));
    });

    it('tab-player.js never reads measure_marks', () => {
        const src = fs.readFileSync(path.join(__dirname, '../renderers/tab-player.js'), 'utf8');
        expect(src).not.toMatch(/measure_marks|measureMarks|repeatStart|repeatEnd/);
    });
});
