// The editor demo's song and the arithmetic it leans on (G14). The demo
// itself drives the real editor, which needs a browser: e2e/tour.spec.js.
import { describe, it, expect } from 'vitest';

import { DEMO_SONG, chordMarks, typedText, linesRange, seamPos } from '../tour-editor-demo.js';

describe('the demo song', () => {
    it('is the 1907 public-domain hymn, not the 1935 Carter Family words', () => {
        const all = [...DEMO_SONG.verse, ...DEMO_SONG.chorus].join(' ');
        expect(all).toMatch(/loved ones in the glory/);
        expect(all).not.toMatch(/standing by my window|undertaker|hearse/i);
        expect(DEMO_SONG.writer).toMatch(/Habershon/);
    });

    it('is chorded in G with the chords everyone plays it with', () => {
        const chords = DEMO_SONG.chorus.flatMap(l => chordMarks(l).marks.map(m => m.chord));
        expect(DEMO_SONG.key).toBe('G');
        expect(new Set(chords)).toEqual(new Set(['G', 'C', 'D']));
    });
});

describe('chordMarks', () => {
    it('splits a chorded line into its words and where each chord goes', () => {
        expect(chordMarks('By and [C]by, by and [G]by?')).toEqual({
            lyric: 'By and by, by and by?',
            marks: [{ at: 7, chord: 'C' }, { at: 18, chord: 'G' }],
        });
        expect(chordMarks('Is a better home awaiting')).toEqual({ lyric: 'Is a better home awaiting', marks: [] });
    });
});

describe('typedText', () => {
    it('is the words alone: a key, the verse, a blank line, the chorus, no chords', () => {
        const text = typedText();
        expect(text.startsWith('{key: G}\nThere are loved ones')).toBe(true);
        expect(text).toContain('their bliss?\n\nWill the circle be unbroken');
        expect(text).not.toMatch(/\[[A-G]/);
    });
});

describe('linesRange', () => {
    it('finds a run of lines by its first line, ignoring chords', () => {
        const text = '{key: G}\nOne\n[G]Two\nThree\nFour';
        const r = linesRange(text, 'Two', 2);
        expect(text.slice(r.from, r.to)).toBe('[G]Two\nThree');
        expect(linesRange(text, 'Five', 1)).toBeNull();
    });
});

describe('seamPos', () => {
    it('is the position of that letter, after chords placed earlier in the line', () => {
        const text = 'x\nBy and [C]by, by and by?';
        // the second "by": after the [C] that sits on it
        expect(text.slice(seamPos(text, 'By and by, by and by?', 7))).toBe('by, by and by?');
        // the last "by": the [C] earlier in the line shifts it by three
        expect(text.slice(seamPos(text, 'By and by, by and by?', 18))).toBe('by?');
        expect(seamPos(text, 'not here', 0)).toBeNull();
    });

    it('placing the chorus chords one by one, as the demo does, writes the chorded chorus', () => {
        let text = typedText();
        for (const line of DEMO_SONG.chorus) {
            const { lyric, marks } = chordMarks(line);
            for (const { at, chord } of marks) {
                const pos = seamPos(text, lyric, at);
                text = `${text.slice(0, pos)}[${chord}]${text.slice(pos)}`;
            }
        }
        expect(text.endsWith(DEMO_SONG.chorus.join('\n'))).toBe(true);
    });
});
