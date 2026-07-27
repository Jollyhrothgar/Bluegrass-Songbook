// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseSong, serializeSong, resetIdsForTest,
    placeChord, moveChord, changeChord, removeChord, transposeDoc, allChords
} from '../visual-editor/model.js';

const SRC = `{start_of_verse: Verse 1}
[G]hello world friend
plain line here
{end_of_verse}
`;

let doc, sid;
beforeEach(() => {
    resetIdsForTest();
    doc = parseSong(SRC);
    sid = doc.sections[0].id;
});

describe('chord ops', () => {
    it('placeChord inserts at a position and keeps chords sorted', () => {
        const next = placeChord(doc, sid, 0, 6, 'C');
        expect(next.sections[0].lines[0].chords).toEqual([
            { chord: 'G', position: 0 }, { chord: 'C', position: 6 }
        ]);
        expect(doc.sections[0].lines[0].chords).toHaveLength(1); // original untouched
        expect(serializeSong(next)).toContain('[G]hello [C]world friend');
    });

    it('placeChord works on a line with no chords', () => {
        const next = placeChord(doc, sid, 1, 0, 'D7');
        expect(serializeSong(next)).toContain('[D7]plain line here');
    });

    it('moveChord changes position and re-sorts', () => {
        const next = moveChord(placeChord(doc, sid, 0, 6, 'C'), sid, 0, 1, 12);
        expect(next.sections[0].lines[0].chords[1]).toEqual({ chord: 'C', position: 12 });
    });

    it('changeChord swaps the symbol, keeps position', () => {
        const next = changeChord(doc, sid, 0, 0, 'Em');
        expect(next.sections[0].lines[0].chords[0]).toEqual({ chord: 'Em', position: 0 });
    });

    it('removeChord deletes by index', () => {
        const next = removeChord(doc, sid, 0, 0);
        expect(next.sections[0].lines[0].chords).toHaveLength(0);
        expect(serializeSong(next)).toContain('hello world friend');
    });
});

describe('transposeDoc', () => {
    it('transposes every chord and the key field', () => {
        doc.metadata.fields.key = 'G';
        const next = transposeDoc(placeChord(doc, sid, 0, 6, 'C'), 2);
        expect(next.sections[0].lines[0].chords.map(c => c.chord)).toEqual(['A', 'D']);
        expect(next.metadata.fields.key).toBe('A');
    });

    it('skips opaque lines and passthrough sections', () => {
        const d = parseSong('{start_of_verse: V1}\n[G]hi\n{comment: [G] not a chord}\n{end_of_verse}');
        const next = transposeDoc(d, 2);
        expect(next.sections[0].lines[1].lyrics).toBe('{comment: [G] not a chord}');
    });
});

describe('allChords', () => {
    it('returns every chord occurrence in document order', () => {
        const next = placeChord(doc, sid, 0, 6, 'C');
        expect(allChords(next)).toEqual(['G', 'C']);
    });
});
