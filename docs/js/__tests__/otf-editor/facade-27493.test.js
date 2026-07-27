// Facade vs a REAL parsed OTF: 27493 (guitar + bass + mandolin + banjo,
// 2/2 with mid-tune 2/4 measures at 30 and 49). Every instrument gets
// the same treatment — the multi-instrument constraint is a test, not
// a comment.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EditingFacade } from '../../otf-editor/facade.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OTF_PATH = path.join(here, '../../../data/tabs/27493_tef.otf.json');
const otf27493 = JSON.parse(fs.readFileSync(OTF_PATH, 'utf8'));

const EXPECTED_TRACKS = [
    ['guitar', 6],
    ['bass', 4],
    ['mandolin', 4],
    ['banjo', 5],
];

describe('EditingFacade × 27493 (real multi-instrument OTF)', () => {
    it('sees all four instruments with tuning-derived string counts', () => {
        const f = new EditingFacade(otf27493);
        expect(f.getTracks().map(t => t.id)).toEqual(EXPECTED_TRACKS.map(([id]) => id));
        for (const [id, strings] of EXPECTED_TRACKS) {
            expect(f.stringCount(id)).toBe(strings);
        }
    });

    it('ts-aware timing: measures 30 and 49 are short (2/4 in a 2/2 tune)', () => {
        const f = new EditingFacade(otf27493);
        expect(f.ticksFor(29)).toBe(1920);
        expect(f.ticksFor(30)).toBe(960);
        expect(f.ticksFor(31)).toBe(1920);
        expect(f.ticksFor(49)).toBe(960);
        // start of m31 reflects the shortened m30
        expect(f.toAbs(31, 0)).toBe(f.toAbs(30, 0) + 960);
        // locate is the exact inverse at the seam
        expect(f.locate(f.toAbs(30, 0) + 959)).toMatchObject({ measure: 30, tick: 959 });
        expect(f.locate(f.toAbs(30, 0) + 960)).toMatchObject({ measure: 31, tick: 0 });
    });

    it.each(EXPECTED_TRACKS)('%s: insert → copy → paste → undo round-trip leaves the doc untouched', (trackId, strings) => {
        const f = new EditingFacade(otf27493, { trackId });
        const pristine = f.export();

        // Insert on the instrument's outermost strings around the short measure
        f.insertNote({ measure: 30, tick: 480, string: 1, fret: 2, duration: 240 });
        f.insertNote({ measure: 30, tick: 720, string: strings, fret: 0, duration: 240 });

        // Copy the short measure, paste it after the last written measure
        const m30 = f.toAbs(30, 0);
        const clip = f.copyRange(m30, m30 + 960);
        expect(clip.data.length).toBeGreaterThan(0);
        const target = f.toAbs(f.getMeasureCount() + 1, 0);
        expect(f.paste(target)).toBe(true);

        // A duration crossing OUT of the short measure tie-splits at 960
        f.insertNote({ measure: 30, tick: 840, string: 1, fret: 5, duration: 480 });
        const spill = f.getMeasure(31).events.find(e => e.tick === 0)
            ?.notes.find(n => n.s === 1 && n.tie === true);
        expect(spill).toBeTruthy();
        expect(spill.dur).toBe(360); // 480 - (960 - 840)

        // Undo everything — the document must be EXACTLY the parsed original
        while (f.canUndo()) f.undo();
        expect(f.export()).toEqual(pristine);
    });

    it.each(EXPECTED_TRACKS)('%s: string bounds enforced from tuning data', (trackId, strings) => {
        const f = new EditingFacade(otf27493, { trackId });
        expect(() => f.insertNote({ measure: 1, tick: 0, string: strings + 1, fret: 0 }))
            .toThrow(RangeError);
    });

    it('edits stay on their own track', () => {
        const f = new EditingFacade(otf27493, { trackId: 'mandolin' });
        const bassBefore = JSON.stringify(f.getNotation('bass'));
        const banjoBefore = JSON.stringify(f.getNotation('banjo'));
        f.insertNote({ measure: 6, tick: 0, string: 2, fret: 3, duration: 240 });
        f.deleteRange(f.toAbs(6, 0), f.toAbs(7, 0));
        expect(JSON.stringify(f.getNotation('bass'))).toBe(bassBefore);
        expect(JSON.stringify(f.getNotation('banjo'))).toBe(banjoBefore);
    });
});
