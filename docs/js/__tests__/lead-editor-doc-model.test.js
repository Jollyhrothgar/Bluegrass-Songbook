// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    lineModel, analyzeDocument, countChords, insertionPoint, backspaceRange, deleteForwardRange,
    chordAt, placeChordChange, removeChordChange, lineSeams, syllableEnd,
} from '../lead-editor/doc-model.js';

const apply = (text, { from, to, insert = '' }) => text.slice(0, from) + insert + text.slice(to);

describe('lineModel', () => {
    it('splits chords from lyrics and maps lyric indexes to line offsets', () => {
        const m = lineModel('Ama[G]zing [D]grace');
        expect(m.lyrics).toBe('Amazing grace');
        expect(m.chords.map((c) => [c.chord, c.lyricPos])).toEqual([['G', 3], ['D', 8]]);
        // the seam at lyric index 3 is AFTER the chord that sits there
        expect(m.seamOffset(3)).toBe('Ama[G]'.length);
        expect(m.seamOffset(0)).toBe(0);
        expect(m.seamOffset(m.lyrics.length)).toBe('Ama[G]zing [D]grace'.length);
    });
    it('puts the seam after a run of chords and at the end of a trailing chord', () => {
        const m = lineModel('[G][C]x[D]');
        expect(m.seamOffset(0)).toBe('[G][C]'.length);
        expect(m.seamOffset(1)).toBe('[G][C]x[D]'.length);
    });
});

describe('analyzeDocument', () => {
    const doc = [
        '{meta: title Test}', '{key: G}', '',
        '{start_of_verse: Verse 1}', '[G]Line one', '{end_of_verse}', '',
        '{start_of_chorus: Chorus}', 'Chorus line', '{end_of_chorus}', '',
        'Plain lyric', '', 'Second plain',
        '{comment: Capo 2}',
        '{start_of_abc}', 'X:1', 'K:G', '{end_of_abc}',
    ].join('\n');
    const a = analyzeDocument(doc);
    const kinds = a.lines.map((l) => l.kind);

    it('classifies every line the way the book reads it', () => {
        expect(kinds).toEqual([
            'hidden', 'hidden', 'blank', 'label', 'lyric', 'hidden', 'blank',
            'label', 'lyric', 'hidden', 'blank', 'lyric', 'blank', 'lyric',
            'locked', 'locked', 'locked', 'locked', 'locked',
        ]);
    });
    it('finds sections, implicit verses included, and the chorus indent', () => {
        expect(a.sections.map((s) => [s.type, s.label, s.explicit, s.indent])).toEqual([
            ['verse', 'Verse 1', true, false],
            ['chorus', 'Chorus', true, true],
            ['verse', 'Verse 2', false, false],
            ['verse', 'Verse 3', false, false],
        ]);
    });
    it('gives the first lyric of an implicit verse a label', () => {
        const plain = a.lines.filter((l) => l.implicitLabel);
        expect(plain.map((l) => l.implicitLabel.label)).toEqual(['Verse 2', 'Verse 3']);
    });
    it('locks ABC and comments as blocks', () => {
        expect(a.blocks.map((b) => b.type)).toEqual(['comment', 'abc']);
    });
    it('indents a label that occurs twice (the book repeats rule)', () => {
        const twice = analyzeDocument('{start_of_verse: Verse 1}\na\n{end_of_verse}\n{start_of_verse: Verse 1}\nb\n{end_of_verse}');
        expect(twice.sections.every((s) => s.indent)).toBe(true);
    });
    it('marks the last lyric of a section for its trailing margin', () => {
        expect(a.lines.filter((l) => l.sectionLast).map((l) => l.text)).toEqual(['[G]Line one', 'Chorus line', 'Plain lyric', 'Second plain']);
    });
});

describe('editing rules', () => {
    it('Backspace deletes the letter, never the chord: Ama[G]zing, caret before z', () => {
        const text = 'Ama[G]zing';
        const caret = 'Ama[G]'.length;
        const r = backspaceRange(text, caret);
        expect(apply(text, r)).toBe('Am[G]zing');
    });
    it('Backspace with the caret before the chord deletes the letter before it too', () => {
        const text = 'Ama[G]zing';
        expect(apply(text, backspaceRange(text, 3))).toBe('Am[G]zing');
    });
    it('Backspace at the start of a line removes the line break, not a chord', () => {
        const text = 'one\n[G]two';
        expect(apply(text, backspaceRange(text, 'one\n[G]'.length))).toBe('one[G]two');
    });
    it('Backspace at the very start does nothing', () => {
        expect(backspaceRange('[G]a', 3)).toBe(null);
        expect(backspaceRange('abc', 0)).toBe(null);
    });
    it('Delete removes the letter after, hopping over chords', () => {
        const text = 'Am[G]azing';
        expect(apply(text, deleteForwardRange(text, 2))).toBe('Am[G]zing');
    });
    it('text typed where a chord sits goes BEFORE the chord', () => {
        const text = 'Ama[G]zing';
        expect(insertionPoint(text, 'Ama[G]'.length)).toBe(3);
        // elsewhere it stays put
        expect(insertionPoint(text, 2)).toBe(2);
        expect(insertionPoint('x\n[G]y', 'x\n[G]'.length)).toBe(2); // line start: the chord stays with its syllable
    });
    it('stacked chords are hopped as one run', () => {
        expect(insertionPoint('a[G][C]b', 'a[G][C]'.length)).toBe(1);
    });
    it('counts the chords in a range (for "Removed N chords")', () => {
        expect(countChords('a[G]b[Am7]c [D/F#]')).toBe(3);
        expect(countChords('no chords here')).toBe(0);
    });
});

describe('chord placement', () => {
    it('places, replaces and removes the chord on a syllable', () => {
        const text = 'Amazing grace';
        const pos = 'Ama'.length;
        const placed = apply(text, placeChordChange(text, pos, 'G'));
        expect(placed).toBe('Ama[G]zing grace');
        const at = 'Ama[G]'.length;
        expect(chordAt(placed, at).chord).toBe('G');
        expect(apply(placed, placeChordChange(placed, at, 'D7'))).toBe('Ama[D7]zing grace');
        expect(apply(placed, removeChordChange(placed, at))).toBe(text);
        expect(removeChordChange(text, pos)).toBe(null);
    });
    it('seams are syllable and word starts plus the line end, as document positions', () => {
        const seams = lineSeams('One [G]two', 0);
        expect(seams[0]).toBe(0);
        expect(seams).toContain('One [G]'.length);
        expect(seams[seams.length - 1]).toBe('One [G]two'.length);
    });
});

describe('currentSongKey: ONE owner for the toolbar, the chord sheet and the submitted key', () => {
    it('a declared {key:} wins over the detected key', async () => {
        const { currentSongKey } = await import('../lead-editor/doc-model.js');
        expect(currentSongKey('{key: A}\n[G]one [C]two [D]three')).toEqual({ key: 'A', mode: 'major' });
        expect(currentSongKey('{meta: key Em}\n[G]one')).toEqual({ key: 'Em', mode: 'minor' });
    });
    it('without one it is the detected key; with no chords at all, nothing', async () => {
        const { currentSongKey } = await import('../lead-editor/doc-model.js');
        expect(currentSongKey('[G]one [C]two [D]three [G]four').key).toBe('G');
        expect(currentSongKey('just words')).toEqual({ key: null, mode: null });
    });
});

describe('syllableEnd: the box outline', () => {
    const text = 'Many long years ago\nsecond [G]line';
    it('a syllable start gives that syllable\'s end', () => {
        const start = text.indexOf('years');
        expect(syllableEnd(text, start)).toBe(start + 'years'.length);
    });
    it('a position INSIDE a syllable (the glide letter tier) outlines to the syllable end', () => {
        const mid = text.indexOf('years') + 2;
        expect(syllableEnd(text, mid)).toBe(text.indexOf('years') + 5);
        expect(syllableEnd(text, mid)).toBeGreaterThan(mid);
    });
    it('with a chord inside the word the end still lands after the last letter', () => {
        const t = 'Ama[G]zing grace';
        const mid = 2;
        expect(syllableEnd(t, mid)).toBeGreaterThan(mid);
    });
});
