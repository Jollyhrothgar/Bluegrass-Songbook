// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseSong, serializeSong, resetIdsForTest,
    addSection, setSectionType, relabelSection, moveSection,
    duplicateSection, deleteSection, moveSectionTo, updateLyrics, splitSectionOnBlankLines,
    spliceSectionWithParsed
} from '../visual-editor/model.js';

const SRC = `{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}

{start_of_chorus: Chorus}
[C]sing it loud
{end_of_chorus}
`;

let doc, verseId, chorusId;
beforeEach(() => {
    resetIdsForTest();
    doc = parseSong(SRC);
    [verseId, chorusId] = doc.sections.map(s => s.id);
});

describe('section ops', () => {
    it('addSection appends with auto-numbered label', () => {
        const next = addSection(addSection(doc, 'verse'), 'bridge');
        expect(next.sections[2].label).toBe('Verse 2');
        expect(next.sections[3].label).toBe('Bridge');
        expect(next.sections[2].implicit).toBe(false);
        expect(next.sections[2].lines).toEqual([]);
    });

    it('setSectionType regenerates directives on serialize (auto-numbered past existing)', () => {
        const next = setSectionType(doc, verseId, 'chorus');
        expect(next.sections[0].openRaw).toBeNull();
        // the fixture already has a Chorus, so this one becomes Chorus 2
        expect(serializeSong(next)).toContain('{start_of_chorus: Chorus 2}');
        expect(serializeSong(next)).toContain('{end_of_chorus}');
    });

    it('relabelSection updates the label and directive', () => {
        const next = relabelSection(doc, verseId, 'Verse 1 (quiet)');
        expect(serializeSong(next)).toContain('{start_of_verse: Verse 1 (quiet)}');
    });

    it('moveSection reorders and clamps at edges', () => {
        const next = moveSection(doc, chorusId, -1);
        expect(next.sections[0].id).toBe(chorusId);
        const clamped = moveSection(next, chorusId, -1);
        expect(clamped.sections[0].id).toBe(chorusId);
    });

    it('duplicateSection inserts a copy with a fresh id after the original', () => {
        const next = duplicateSection(doc, chorusId);
        expect(next.sections).toHaveLength(3);
        expect(next.sections[2].label).toBe('Chorus (copy)');
        expect(next.sections[2].id).not.toBe(chorusId);
        expect(next.sections[2].lines[0].chords[0].chord).toBe('C');
    });

    it('deleteSection removes it', () => {
        const next = deleteSection(doc, verseId);
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0].id).toBe(chorusId);
    });
});

describe('updateLyrics re-anchoring', () => {
    it('keeps chords on unchanged words when text is edited around them', () => {
        const { doc: next, droppedChords } =
            updateLyrics(doc, verseId, 'well hello world my friend');
        expect(droppedChords).toBe(0);
        const line = next.sections[0].lines[0];
        expect(line.lyrics).toBe('well hello world my friend');
        // 'G' was on 'hello' (offset 0 in word) → new position = start of 'hello'
        expect(line.chords[0]).toEqual({ chord: 'G', position: 5 });
    });

    it('keeps mid-word offsets within a surviving word', () => {
        const d = parseSong('{start_of_verse: V1}\nD[D/F]own the street\n{end_of_verse}');
        const { doc: next } = updateLyrics(d, d.sections[0].id, 'go D own the street'.replace('D own', 'Down'));
        const line = next.sections[0].lines[0];
        expect(line.lyrics).toBe('go Down the street');
        expect(line.chords[0]).toEqual({ chord: 'D/F', position: 4 }); // still over 'own'
    });

    it('drops chords on deleted words and reports the count', () => {
        const { doc: next, droppedChords } = updateLyrics(doc, verseId, 'completely different text');
        expect(droppedChords).toBe(1);
        expect(next.sections[0].lines[0].chords).toHaveLength(0);
    });

    it('handles added and removed lines', () => {
        const { doc: next, droppedChords } =
            updateLyrics(doc, verseId, 'new first line\nhello world friend');
        expect(droppedChords).toBe(0);
        expect(next.sections[0].lines).toHaveLength(2);
        expect(next.sections[0].lines[1].chords[0]).toEqual({ chord: 'G', position: 0 });
    });

    it('carries chord-only lines through when the blank/whitespace line survives by index', () => {
        const d = parseSong('{start_of_verse: V1}\n[G] [C]\nhello there\n{end_of_verse}');
        const { doc: next, droppedChords } = updateLyrics(d, d.sections[0].id, ' \nhello there friend');
        expect(droppedChords).toBe(0);
        expect(next.sections[0].lines[0].chords.map(c => c.chord)).toEqual(['G', 'C']);
    });
});

describe('splitSectionOnBlankLines', () => {
    it('splits a card at blank lines into auto-numbered sections of the same type', () => {
        const d = parseSong('{start_of_verse: Verse 1}\n[G]line one\n\nline two\n\nline three\n{end_of_verse}');
        const next = splitSectionOnBlankLines(d, d.sections[0].id);
        expect(next.sections).toHaveLength(3);
        expect(next.sections.map(s => s.label)).toEqual(['Verse 1', 'Verse 2', 'Verse 3']);
        expect(next.sections[0].id).toBe(d.sections[0].id);        // first keeps identity
        expect(next.sections[0].lines[0].chords[0].chord).toBe('G'); // chords travel with lines
        expect(next.sections[1].lines[0].lyrics).toBe('line two');
    });

    it('is a no-op when there are no internal blank lines', () => {
        const d = parseSong('{start_of_verse: Verse 1}\nonly line\n{end_of_verse}');
        const next = splitSectionOnBlankLines(d, d.sections[0].id);
        expect(next.sections).toHaveLength(1);
    });
});


describe('spliceSectionWithParsed', () => {
    it('single anonymous block populates the target card, keeping its identity', () => {
        const doc = parseSong('{start_of_verse: Verse 1}\nold [G]words\n{end_of_verse}');
        const id = doc.sections[0].id;
        const parsed = parseSong('[C]new words here\n[D]second line');
        const next = spliceSectionWithParsed(doc, id, parsed);
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0].id).toBe(id);
        expect(next.sections[0].label).toBe('Verse 1');
        expect(next.sections[0].implicit).toBe(false);
        expect(serializeSong(next)).toContain('[C]new words here');
        expect(serializeSong(next)).not.toContain('old');
    });

    it('multi-block parse splices multiple sections in place of the target', () => {
        const doc = parseSong(
            '{start_of_verse: Verse 1}\nfirst\n{end_of_verse}\n' +
            '{start_of_verse: Verse 2}\nreplace me\n{end_of_verse}\n' +
            '{start_of_chorus}\nchorus line\n{end_of_chorus}');
        const target = doc.sections[1].id;
        const parsed = parseSong('[G]block one\n\n[C]block two');
        const next = spliceSectionWithParsed(doc, target, parsed);
        expect(next.sections).toHaveLength(4);
        expect(next.sections[1].lines[0].lyrics).toBe('block one');
        expect(next.sections[2].lines[0].lyrics).toBe('block two');
        // implicit verses renumber past the doc's existing verse count
        expect(next.sections[1].label).toBe('Verse 2');
        expect(next.sections[2].label).toBe('Verse 3');
        // untouched neighbors keep their place
        expect(next.sections[0].lines[0].lyrics).toBe('first');
        expect(next.sections[3].type).toBe('chorus');
    });

    it('explicit sections in the paste keep their own labels and types', () => {
        const doc = parseSong('{start_of_verse: Verse 1}\nreplace me\n{end_of_verse}');
        const parsed = parseSong('{soc}\n[G]glory glory\n{eoc}\n{sov: Verse 9}\nwords\n{eov}');
        const next = spliceSectionWithParsed(doc, doc.sections[0].id, parsed);
        expect(next.sections.map(s => s.label)).toEqual(['Chorus', 'Verse 9']);
        expect(next.sections[0].type).toBe('chorus');
    });

    it('merges pasted metadata into empty fields without clobbering existing ones', () => {
        const doc = parseSong('{meta: title Kept Title}\n\n{start_of_verse: Verse 1}\nx\n{end_of_verse}');
        const parsed = parseSong('{meta: title Pasted Title}\n{meta: artist Pasted Artist}\n\n[G]hello');
        const next = spliceSectionWithParsed(doc, doc.sections[0].id, parsed);
        expect(next.metadata.fields.title).toBe('Kept Title');
        expect(next.metadata.fields.artist).toBe('Pasted Artist');
        expect(serializeSong(next)).toContain('{meta: artist Pasted Artist}');
    });

    it('is a pure op: the input doc is untouched', () => {
        const doc = parseSong('{start_of_verse: Verse 1}\nkeep\n{end_of_verse}');
        spliceSectionWithParsed(doc, doc.sections[0].id, parseSong('a\n\nb'));
        expect(doc.sections).toHaveLength(1);
        expect(doc.sections[0].lines[0].lyrics).toBe('keep');
    });

    it('unknown section id returns the doc unchanged', () => {
        const doc = parseSong('hello');
        const next = spliceSectionWithParsed(doc, 'nope', parseSong('x'));
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0].lines[0].lyrics).toBe('hello');
    });
});

describe('moveSectionTo', () => {
    let bridgeId;
    beforeEach(() => {
        doc = addSection(doc, 'bridge');   // [verse, chorus, bridge]
        bridgeId = doc.sections[2].id;
    });

    const order = d => d.sections.map(s => s.id);

    it('moves a section to an absolute index (down and up)', () => {
        expect(order(moveSectionTo(doc, verseId, 2))).toEqual([chorusId, bridgeId, verseId]);
        expect(order(moveSectionTo(doc, bridgeId, 0))).toEqual([bridgeId, verseId, chorusId]);
        expect(order(moveSectionTo(doc, verseId, 1))).toEqual([chorusId, verseId, bridgeId]);
    });

    it('is a no-op when the target equals the current index', () => {
        expect(order(moveSectionTo(doc, chorusId, 1))).toEqual(order(doc));
    });

    it('clamps out-of-bounds targets to the ends', () => {
        expect(order(moveSectionTo(doc, verseId, 99))).toEqual([chorusId, bridgeId, verseId]);
        expect(order(moveSectionTo(doc, bridgeId, -5))).toEqual([bridgeId, verseId, chorusId]);
    });

    it('ignores an unknown section id', () => {
        expect(order(moveSectionTo(doc, 'sec-nope', 0))).toEqual(order(doc));
    });

    it('preserves ids and content, and does not mutate the input doc', () => {
        const before = JSON.stringify(doc);
        const next = moveSectionTo(doc, verseId, 2);
        expect(JSON.stringify(doc)).toBe(before);
        const moved = next.sections.find(s => s.id === verseId);
        expect(moved.lines[0].lyrics).toBe('hello world friend');
        expect(serializeSong(next).indexOf('{start_of_chorus')).toBeLessThan(
            serializeSong(next).indexOf('{start_of_verse'));
    });
});
