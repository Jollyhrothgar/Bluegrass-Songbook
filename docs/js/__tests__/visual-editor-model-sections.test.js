// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseSong, serializeSong, resetIdsForTest,
    addSection, setSectionType, relabelSection, moveSection,
    duplicateSection, deleteSection, updateLyrics, splitSectionOnBlankLines
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
