// Unit tests for chords.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock state.js to avoid circular dependencies
vi.mock('../state.js', () => ({
    currentDetectedKey: 'G'
}));

import {
    normalizeChord,
    getChordRoot,
    getChordQuality,
    extractChords,
    detectKey,
    toNashville,
    transposeChord,
    transposeNote,
    getSemitonesBetweenKeys,
    parseLineWithChords,
    KEYS,
    CHROMATIC,
    ENHARMONIC
} from '../chords.js';

describe('normalizeChord', () => {
    it('returns null for empty input', () => {
        expect(normalizeChord(null)).toBeNull();
        expect(normalizeChord('')).toBeNull();
    });

    it('extracts major chords', () => {
        expect(normalizeChord('G')).toBe('G');
        expect(normalizeChord('C')).toBe('C');
        expect(normalizeChord('D7')).toBe('D');
        expect(normalizeChord('Gmaj7')).toBe('G');
    });

    it('extracts minor chords', () => {
        expect(normalizeChord('Am')).toBe('Am');
        expect(normalizeChord('Em7')).toBe('Em');
        expect(normalizeChord('Bm')).toBe('Bm');
    });

    it('extracts diminished chords', () => {
        expect(normalizeChord('Bdim')).toBe('Bdim');
        // F# is preserved as special case for key name compatibility
        expect(normalizeChord('F#dim')).toBe('F#dim');
    });

    it('normalizes enharmonic equivalents', () => {
        expect(normalizeChord('C#')).toBe('Db');
        expect(normalizeChord('D#m')).toBe('Ebm');
        expect(normalizeChord('A#')).toBe('Bb');
    });

    it('preserves F# as special case', () => {
        // F# is kept for key name compatibility
        expect(normalizeChord('F#')).toBe('F#');
    });
});

describe('getChordRoot', () => {
    it('extracts root from major chords', () => {
        expect(getChordRoot('G')).toBe('G');
        expect(getChordRoot('C7')).toBe('C');
        expect(getChordRoot('Dmaj7')).toBe('D');
    });

    it('extracts root from minor chords', () => {
        expect(getChordRoot('Am')).toBe('A');
        expect(getChordRoot('Em7')).toBe('E');
    });

    it('handles sharps and flats', () => {
        expect(getChordRoot('F#m')).toBe('F#');
        expect(getChordRoot('Bb')).toBe('Bb');
        expect(getChordRoot('Ebm')).toBe('Eb');
    });

    it('returns null for invalid input', () => {
        expect(getChordRoot(null)).toBeNull();
        expect(getChordRoot('')).toBeNull();
        expect(getChordRoot('xyz')).toBeNull();
    });
});

describe('getChordQuality', () => {
    it('identifies major chords', () => {
        expect(getChordQuality('G')).toBe('major');
        expect(getChordQuality('C7')).toBe('major');
        expect(getChordQuality('Dmaj7')).toBe('major');
        expect(getChordQuality('Gmaj9')).toBe('major');
    });

    it('identifies minor chords', () => {
        expect(getChordQuality('Am')).toBe('minor');
        expect(getChordQuality('Em7')).toBe('minor');
        expect(getChordQuality('F#m')).toBe('minor');
    });

    it('identifies diminished chords', () => {
        expect(getChordQuality('Bdim')).toBe('dim');
        expect(getChordQuality('C#dim7')).toBe('dim');
    });

    it('defaults to major for unknown', () => {
        expect(getChordQuality(null)).toBe('major');
        expect(getChordQuality('')).toBe('major');
    });
});

describe('extractChords', () => {
    it('extracts chords from ChordPro format', () => {
        const content = '[G]Hello [C]world [D]!';
        expect(extractChords(content)).toEqual(['G', 'C', 'D']);
    });

    it('handles multiple lines', () => {
        const content = '[G]Line one\n[Am]Line [D]two';
        expect(extractChords(content)).toEqual(['G', 'Am', 'D']);
    });

    it('handles complex chords', () => {
        const content = '[Gmaj7]Start [F#m7]middle [Bdim]end';
        expect(extractChords(content)).toEqual(['Gmaj7', 'F#m7', 'Bdim']);
    });

    it('returns empty array for no chords', () => {
        expect(extractChords('Hello world')).toEqual([]);
        expect(extractChords('')).toEqual([]);
    });

    it('handles slash chords', () => {
        const content = '[G/B]bass note [C/E]another';
        expect(extractChords(content)).toEqual(['G/B', 'C/E']);
    });
});

describe('detectKey', () => {
    it('detects G major from typical bluegrass chords', () => {
        const chords = ['G', 'C', 'D', 'G', 'Em', 'D', 'G'];
        const result = detectKey(chords);
        expect(result.key).toBe('G');
        expect(result.mode).toBe('major');
    });

    it('detects C major', () => {
        const chords = ['C', 'F', 'G', 'Am', 'C'];
        const result = detectKey(chords);
        expect(result.key).toBe('C');
        expect(result.mode).toBe('major');
    });

    it('detects D major', () => {
        const chords = ['D', 'G', 'A', 'D', 'Bm', 'A', 'D'];
        const result = detectKey(chords);
        expect(result.key).toBe('D');
        expect(result.mode).toBe('major');
    });

    it('detects A major', () => {
        const chords = ['A', 'D', 'E', 'A'];
        const result = detectKey(chords);
        expect(result.key).toBe('A');
        expect(result.mode).toBe('major');
    });

    it('detects Am (A minor)', () => {
        const chords = ['Am', 'Dm', 'E', 'Am', 'G', 'Am'];
        const result = detectKey(chords);
        expect(result.key).toBe('Am');
        expect(result.mode).toBe('minor');
    });

    it('detects Em (E minor)', () => {
        const chords = ['Em', 'Am', 'B', 'Em', 'D', 'Em'];
        const result = detectKey(chords);
        expect(result.key).toBe('Em');
        expect(result.mode).toBe('minor');
    });

    it('returns null for empty chord list', () => {
        const result = detectKey([]);
        expect(result.key).toBeNull();
        expect(result.mode).toBeNull();
    });

    it('handles common key of F', () => {
        const chords = ['F', 'Bb', 'C', 'F', 'Dm', 'F'];
        const result = detectKey(chords);
        expect(result.key).toBe('F');
    });

    it('provides confidence score', () => {
        const chords = ['G', 'C', 'D', 'G'];
        const result = detectKey(chords);
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(100);
    });

    it('detects E major for songs with non-diatonic bVII and bIII (issue #170)', () => {
        // "Runnin' Down a Dream" - E is the tonic (most frequent chord),
        // D is bVII (mixolydian borrowing), G is bIII - common in rock/country.
        // Previously detected as A because A appeared before E in preferred key order.
        const chords = [
            // Verse 1
            'E', 'D', 'E', 'D', 'E',
            // Chorus
            'A', 'G', 'E', 'G', 'A', 'G', 'E', 'E', 'G', 'A', 'G', 'E',
            // Verse 2
            'E', 'D', 'E', 'D', 'E',
            // Chorus
            'A', 'G', 'E', 'G', 'A', 'G', 'E', 'E', 'G', 'A', 'G', 'E',
            // Verse 3
            'E', 'D', 'E', 'D', 'E',
            // Chorus x2
            'A', 'G', 'E', 'G', 'A', 'G', 'E', 'E', 'G', 'A', 'G', 'E',
            'A', 'G', 'E', 'G', 'A', 'G', 'E', 'E', 'G', 'A', 'G', 'E',
        ];
        const result = detectKey(chords);
        expect(result.key).toBe('E');
        expect(result.mode).toBe('major');
    });

    it('still prefers common keys when tonic frequency is equal', () => {
        // When two keys score similarly and tonic frequency is equal,
        // the preferred order should still apply
        const chords = ['G', 'C', 'D', 'Am'];
        const result = detectKey(chords);
        expect(result.key).toBe('G');
    });
});

describe('toNashville', () => {
    describe('in key of G major', () => {
        it('converts G to I', () => {
            expect(toNashville('G', 'G')).toBe('I');
        });

        it('converts C to IV', () => {
            expect(toNashville('C', 'G')).toBe('IV');
        });

        it('converts D to V', () => {
            expect(toNashville('D', 'G')).toBe('V');
        });

        it('converts Em to vi', () => {
            expect(toNashville('Em', 'G')).toBe('vi');
        });

        it('converts Am to ii', () => {
            expect(toNashville('Am', 'G')).toBe('ii');
        });

        it('preserves extensions', () => {
            expect(toNashville('G7', 'G')).toBe('I7');
            expect(toNashville('D7', 'G')).toBe('V7');
        });
    });

    describe('in key of C major', () => {
        it('converts C to I', () => {
            expect(toNashville('C', 'C')).toBe('I');
        });

        it('converts F to IV', () => {
            expect(toNashville('F', 'C')).toBe('IV');
        });

        it('converts G to V', () => {
            expect(toNashville('G', 'C')).toBe('V');
        });

        it('converts Am to vi', () => {
            expect(toNashville('Am', 'C')).toBe('vi');
        });
    });

    describe('in key of A minor', () => {
        it('converts Am to i', () => {
            expect(toNashville('Am', 'Am')).toBe('i');
        });

        it('converts Dm to iv', () => {
            expect(toNashville('Dm', 'Am')).toBe('iv');
        });

        it('converts E to V (dominant)', () => {
            // In minor keys, V is often major (harmonic minor)
            expect(toNashville('E', 'Am')).toBe('V');
        });
    });

    it('returns original chord if key not found', () => {
        expect(toNashville('G', 'X')).toBe('G');
        expect(toNashville('G', null)).toBe('G');
    });
});

describe('transposeChord', () => {
    it('transposes up by semitones', () => {
        expect(transposeChord('C', 2)).toBe('D');
        expect(transposeChord('G', 2)).toBe('A');
        expect(transposeChord('D', 2)).toBe('E');
    });

    it('transposes down (using negative)', () => {
        expect(transposeChord('D', -2)).toBe('C');
        expect(transposeChord('A', -2)).toBe('G');
    });

    it('handles minor chords', () => {
        expect(transposeChord('Am', 2)).toBe('Bm');
        expect(transposeChord('Em', 2)).toBe('F#m');
    });

    it('handles chord extensions', () => {
        expect(transposeChord('G7', 2)).toBe('A7');
        expect(transposeChord('Cmaj7', 2)).toBe('Dmaj7');
    });

    it('handles slash chords', () => {
        expect(transposeChord('G/B', 2)).toBe('A/C#');
        expect(transposeChord('C/E', 2)).toBe('D/F#');
    });

    it('returns original for 0 semitones', () => {
        expect(transposeChord('G', 0)).toBe('G');
        expect(transposeChord('Am7', 0)).toBe('Am7');
    });

    it('wraps around the octave', () => {
        expect(transposeChord('B', 1)).toBe('C');
        expect(transposeChord('C', -1)).toBe('B');
    });
});

describe('getSemitonesBetweenKeys', () => {
    it('calculates semitones between major keys', () => {
        expect(getSemitonesBetweenKeys('C', 'D')).toBe(2);
        expect(getSemitonesBetweenKeys('G', 'A')).toBe(2);
        expect(getSemitonesBetweenKeys('C', 'G')).toBe(7);
    });

    it('calculates semitones for minor keys', () => {
        expect(getSemitonesBetweenKeys('Am', 'Bm')).toBe(2);
        expect(getSemitonesBetweenKeys('Em', 'Am')).toBe(5);
    });

    it('handles sharps and flats', () => {
        expect(getSemitonesBetweenKeys('C', 'F#')).toBe(6);
        expect(getSemitonesBetweenKeys('G', 'Bb')).toBe(3);
    });

    it('returns 0 for same key', () => {
        expect(getSemitonesBetweenKeys('G', 'G')).toBe(0);
        expect(getSemitonesBetweenKeys('Am', 'Am')).toBe(0);
    });

    it('returns 0 for null keys', () => {
        expect(getSemitonesBetweenKeys(null, 'G')).toBe(0);
        expect(getSemitonesBetweenKeys('G', null)).toBe(0);
    });
});

describe('parseLineWithChords', () => {
    it('extracts chords and lyrics', () => {
        const result = parseLineWithChords('[G]Hello [C]world');
        expect(result.lyrics).toBe('Hello world');
        expect(result.chords).toHaveLength(2);
        expect(result.chords[0]).toEqual({ chord: 'G', position: 0 });
        expect(result.chords[1]).toEqual({ chord: 'C', position: 6 });
    });

    it('handles line with no chords', () => {
        const result = parseLineWithChords('Just lyrics here');
        expect(result.lyrics).toBe('Just lyrics here');
        expect(result.chords).toHaveLength(0);
    });

    it('handles chords at end of line', () => {
        const result = parseLineWithChords('End of line [G]');
        expect(result.lyrics).toBe('End of line ');
        expect(result.chords).toHaveLength(1);
    });

    it('handles consecutive chords', () => {
        const result = parseLineWithChords('[G][C][D]');
        expect(result.lyrics).toBe('');
        expect(result.chords).toHaveLength(3);
    });
});

describe('KEYS constant', () => {
    it('contains all major keys', () => {
        const majorKeys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];
        for (const key of majorKeys) {
            expect(KEYS[key]).toBeDefined();
            expect(KEYS[key].mode).toBe('major');
        }
    });

    it('contains all minor keys', () => {
        const minorKeys = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm'];
        for (const key of minorKeys) {
            expect(KEYS[key]).toBeDefined();
            expect(KEYS[key].mode).toBe('minor');
        }
    });

    it('has relative major/minor relationships', () => {
        expect(KEYS['G'].relative).toBe('Em');
        expect(KEYS['Em'].relative).toBe('G');
        expect(KEYS['C'].relative).toBe('Am');
        expect(KEYS['Am'].relative).toBe('C');
    });
});
