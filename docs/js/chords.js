// Chord utilities for Bluegrass Songbook

import { currentDetectedKey } from './state.js';

// Key detection using diatonic chord analysis
// Major keys: I, ii, iii, IV, V, vi, vii°
// Minor keys (natural): i, ii°, III, iv, v, VI, VII
export const KEYS = {
    // Major keys
    'C':  { scale: ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'], tonic: 'C', mode: 'major', relative: 'Am' },
    'G':  { scale: ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'], tonic: 'G', mode: 'major', relative: 'Em' },
    'D':  { scale: ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'], tonic: 'D', mode: 'major', relative: 'Bm' },
    'A':  { scale: ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim'], tonic: 'A', mode: 'major', relative: 'F#m' },
    'E':  { scale: ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'], tonic: 'E', mode: 'major', relative: 'C#m' },
    'B':  { scale: ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim'], tonic: 'B', mode: 'major', relative: 'G#m' },
    'F#': { scale: ['F#', 'G#m', 'A#m', 'B', 'C#', 'D#m', 'E#dim'], tonic: 'F#', mode: 'major', relative: 'D#m' },
    'F':  { scale: ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim'], tonic: 'F', mode: 'major', relative: 'Dm' },
    'Bb': { scale: ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'], tonic: 'Bb', mode: 'major', relative: 'Gm' },
    'Eb': { scale: ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim'], tonic: 'Eb', mode: 'major', relative: 'Cm' },
    'Ab': { scale: ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm', 'Gdim'], tonic: 'Ab', mode: 'major', relative: 'Fm' },
    'Db': { scale: ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim'], tonic: 'Db', mode: 'major', relative: 'Bbm' },
    // Minor keys (natural minor - same chords as relative major, different tonic)
    'Am':  { scale: ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G'], tonic: 'Am', mode: 'minor', relative: 'C' },
    'Em':  { scale: ['Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D'], tonic: 'Em', mode: 'minor', relative: 'G' },
    'Bm':  { scale: ['Bm', 'C#dim', 'D', 'Em', 'F#m', 'G', 'A'], tonic: 'Bm', mode: 'minor', relative: 'D' },
    'F#m': { scale: ['F#m', 'G#dim', 'A', 'Bm', 'C#m', 'D', 'E'], tonic: 'F#m', mode: 'minor', relative: 'A' },
    'C#m': { scale: ['C#m', 'D#dim', 'E', 'F#m', 'G#m', 'A', 'B'], tonic: 'C#m', mode: 'minor', relative: 'E' },
    'G#m': { scale: ['G#m', 'A#dim', 'B', 'C#m', 'D#m', 'E', 'F#'], tonic: 'G#m', mode: 'minor', relative: 'B' },
    'D#m': { scale: ['D#m', 'E#dim', 'F#', 'G#m', 'A#m', 'B', 'C#'], tonic: 'D#m', mode: 'minor', relative: 'F#' },
    'Dm':  { scale: ['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C'], tonic: 'Dm', mode: 'minor', relative: 'F' },
    'Gm':  { scale: ['Gm', 'Adim', 'Bb', 'Cm', 'Dm', 'Eb', 'F'], tonic: 'Gm', mode: 'minor', relative: 'Bb' },
    'Cm':  { scale: ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb'], tonic: 'Cm', mode: 'minor', relative: 'Eb' },
    'Fm':  { scale: ['Fm', 'Gdim', 'Ab', 'Bbm', 'Cm', 'Db', 'Eb'], tonic: 'Fm', mode: 'minor', relative: 'Ab' },
    'Bbm': { scale: ['Bbm', 'Cdim', 'Db', 'Ebm', 'Fm', 'Gb', 'Ab'], tonic: 'Bbm', mode: 'minor', relative: 'Db' },
};

// Nashville numbers for major keys (I, ii, iii, IV, V, vi, vii°)
export const NASHVILLE_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
// Nashville numbers for minor keys (i, ii°, III, iv, v, VI, VII)
export const NASHVILLE_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

// Chromatic scale for interval calculation
export const CHROMATIC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Chromatic key order for UI (transposition matches vocal range adjustments)
// Using sharps for common bluegrass keys, flats for others
export const CHROMATIC_MAJOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const CHROMATIC_MINOR_KEYS = ['Am', 'Bbm', 'Bm', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m'];

// Normalize enharmonic equivalents
export const ENHARMONIC = {
    'C#': 'Db', 'D#': 'Eb', 'E#': 'F', 'Fb': 'E',
    'G#': 'Ab', 'A#': 'Bb', 'B#': 'C', 'Cb': 'B',
    'F#': 'Gb', // For chromatic lookup
};

/**
 * Normalize a chord to root + basic quality (major, minor, dim)
 */
export function normalizeChord(chord) {
    if (!chord) return null;

    const rootMatch = chord.match(/^([A-G][#b]?)/);
    if (!rootMatch) return null;

    let root = rootMatch[1];
    const rest = chord.slice(root.length).toLowerCase();

    // Normalize enharmonics (except F# which we keep for key names)
    if (ENHARMONIC[root] && root !== 'F#') {
        root = ENHARMONIC[root];
    }

    let quality = '';
    if (rest.startsWith('m') && !rest.startsWith('maj')) {
        quality = 'm';
    } else if (rest.includes('dim') || rest === 'o' || rest.startsWith('o7')) {
        quality = 'dim';
    }

    return root + quality;
}

/**
 * Get just the root of a chord
 */
export function getChordRoot(chord) {
    if (!chord) return null;
    const match = chord.match(/^([A-G][#b]?)/);
    if (!match) return null;
    let root = match[1];
    if (ENHARMONIC[root] && root !== 'F#') {
        root = ENHARMONIC[root];
    }
    return root;
}

/**
 * Get chord quality (major, minor, dim)
 */
export function getChordQuality(chord) {
    if (!chord) return 'major';
    const root = chord.match(/^[A-G][#b]?/);
    if (!root) return 'major';
    const rest = chord.slice(root[0].length);
    if (rest === 'm' || (rest.startsWith('m') && !rest.startsWith('maj'))) return 'minor';
    if (rest === 'dim' || rest.includes('dim')) return 'dim';
    return 'major';
}

/**
 * Extract all chords from chordpro content
 */
export function extractChords(chordpro) {
    const chordRegex = /\[([^\]]+)\]/g;
    const chords = [];
    let match;

    while ((match = chordRegex.exec(chordpro)) !== null) {
        chords.push(match[1]); // Keep original for Nashville conversion
    }

    return chords;
}

/**
 * Detect key from chord list
 */
export function detectKey(chords) {
    if (!chords || chords.length === 0) {
        return { key: null, mode: null, confidence: 0 };
    }

    // Normalize and count chords
    const chordCounts = {};
    for (const chord of chords) {
        const normalized = normalizeChord(chord);
        if (normalized) {
            chordCounts[normalized] = (chordCounts[normalized] || 0) + 1;
        }
    }

    const totalChords = chords.length;

    // Score each possible key
    const scores = {};

    for (const [keyName, keyInfo] of Object.entries(KEYS)) {
        const normalizedScale = new Set(keyInfo.scale.map(c => normalizeChord(c)));
        const normalizedTonic = normalizeChord(keyInfo.tonic);

        let matchWeight = 0;
        let tonicWeight = 0;

        for (const [chord, count] of Object.entries(chordCounts)) {
            if (normalizedScale.has(chord)) {
                matchWeight += count;
                // Extra weight for tonic chord
                if (chord === normalizedTonic) {
                    tonicWeight += count * 0.5; // 50% bonus for tonic
                }
            }
        }

        scores[keyName] = (matchWeight + tonicWeight) / totalChords;
    }

    // Find best key, using tonic frequency as tiebreaker
    let bestKey = null;
    let bestScore = 0;
    let bestTonicFreq = 0;

    for (const [key, score] of Object.entries(scores)) {
        const tonicFreq = chordCounts[normalizeChord(KEYS[key].tonic)] || 0;
        if (score > bestScore || (score === bestScore && tonicFreq > bestTonicFreq)) {
            bestScore = score;
            bestKey = key;
            bestTonicFreq = tonicFreq;
        }
    }

    // For relative major/minor pairs with similar scores, check tonic frequency
    if (bestKey && KEYS[bestKey]) {
        const relative = KEYS[bestKey].relative;
        if (relative && scores[relative]) {
            const scoreDiff = Math.abs(scores[bestKey] - scores[relative]);
            // If scores are close, prefer the one with more tonic occurrences
            if (scoreDiff < 0.1) {
                const bestTonic = normalizeChord(KEYS[bestKey].tonic);
                const relativeTonic = normalizeChord(KEYS[relative].tonic);
                const bestTonicCount = chordCounts[bestTonic] || 0;
                const relativeTonicCount = chordCounts[relativeTonic] || 0;

                if (relativeTonicCount > bestTonicCount) {
                    bestKey = relative;
                    bestScore = scores[relative];
                }
            }
        }
    }

    // Prefer common keys when scores are very close,
    // but only if the preferred key's tonic is at least as frequent as the current best's tonic.
    // This prevents overriding a key with strong tonic evidence (e.g., E with 25 occurrences)
    // in favor of a common key with a weaker tonic (e.g., A with 12 occurrences).
    const preferredOrder = ['G', 'C', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'F', 'Bm', 'Bb', 'Eb'];
    if (bestKey) {
        const bestTonic = normalizeChord(KEYS[bestKey].tonic);
        const bestTonicCount = chordCounts[bestTonic] || 0;
        for (const key of preferredOrder) {
            if (key === bestKey) break; // Already the best and preferred
            if (scores[key] && scores[key] >= bestScore - 0.03) {
                const preferredTonic = normalizeChord(KEYS[key].tonic);
                const preferredTonicCount = chordCounts[preferredTonic] || 0;
                if (preferredTonicCount >= bestTonicCount) {
                    bestKey = key;
                    bestScore = scores[key];
                    break;
                }
            }
        }
    }

    return {
        key: bestKey,
        mode: bestKey ? KEYS[bestKey].mode : null,
        confidence: Math.round((bestScore / 1.5) * 100) // Normalize since we added tonic bonus
    };
}

/**
 * Convert a chord to Nashville number given a key
 */
export function toNashville(chord, keyName) {
    if (!chord || !keyName || !KEYS[keyName]) return chord;

    const keyInfo = KEYS[keyName];
    const chordRoot = getChordRoot(chord);
    const chordQuality = getChordQuality(chord);

    if (!chordRoot) return chord;

    // Extract extension (7, maj7, sus4, etc.) to preserve it
    const rootMatch = chord.match(/^[A-G][#b]?/);
    const afterRoot = rootMatch ? chord.slice(rootMatch[0].length) : '';
    // Get extension after quality indicator (m, dim, etc.)
    let extension = '';
    if (afterRoot.startsWith('m') && !afterRoot.startsWith('maj')) {
        extension = afterRoot.slice(1); // After 'm'
    } else if (afterRoot.includes('dim')) {
        extension = afterRoot.replace(/dim/, '');
    } else {
        extension = afterRoot; // No quality prefix, rest is extension
    }
    // Clean up extension - remove leading quality markers that might remain
    extension = extension.replace(/^(aj|in)/, '');

    // Get the key's tonic root
    const tonicRoot = getChordRoot(keyInfo.tonic);
    if (!tonicRoot) return chord;

    // Find interval (semitones from tonic)
    let tonicIndex = CHROMATIC.indexOf(tonicRoot);
    let chordIndex = CHROMATIC.indexOf(chordRoot);

    // Handle F# specially
    if (tonicRoot === 'F#' || tonicRoot === 'Gb') tonicIndex = 6;
    if (chordRoot === 'F#' || chordRoot === 'Gb') chordIndex = 6;

    if (tonicIndex === -1 || chordIndex === -1) return chord;

    const interval = (chordIndex - tonicIndex + 12) % 12;

    // Map interval to scale degree
    const intervalToScaleDegree = {
        0: 0,   // I/i
        2: 1,   // ii/ii°
        3: 2,   // iii (minor) or bIII (from minor key)
        4: 2,   // iii (major)
        5: 3,   // IV/iv
        7: 4,   // V/v
        8: 5,   // vi (minor) or bVI
        9: 5,   // vi (major)
        10: 6,  // bVII
        11: 6,  // vii°
    };

    const scaleDegree = intervalToScaleDegree[interval];
    if (scaleDegree === undefined) {
        // Non-diatonic - just show the interval
        const symbols = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
        let num = symbols[interval];
        if (chordQuality === 'minor') num = num.toLowerCase();
        if (chordQuality === 'dim') num = num.toLowerCase() + '°';
        return num + extension;
    }

    // Get the Nashville number based on key mode
    const nashville = keyInfo.mode === 'minor' ? NASHVILLE_MINOR : NASHVILLE_MAJOR;
    let num = nashville[scaleDegree];

    // Adjust for actual chord quality vs expected
    const expectedQuality = num === num.toLowerCase() ? 'minor' : 'major';
    if (num.includes('°')) {
        // Expected diminished
        if (chordQuality === 'major') num = num.replace('°', '').toUpperCase();
        if (chordQuality === 'minor') num = num.replace('°', '');
    } else if (chordQuality === 'dim') {
        num = num.toLowerCase() + '°';
    } else if (chordQuality === 'minor' && expectedQuality === 'major') {
        num = num.toLowerCase();
    } else if (chordQuality === 'major' && expectedQuality === 'minor') {
        num = num.toUpperCase();
    }

    return num + extension;
}

/**
 * Transpose a chord by a number of semitones
 */
export function transposeChord(chord, semitones) {
    if (!chord || semitones === 0) return chord;

    // Normalize semitones to 0-11
    semitones = ((semitones % 12) + 12) % 12;
    if (semitones === 0) return chord;

    // Parse the chord: root, quality, bass note
    const match = chord.match(/^([A-G][#b]?)(.*)$/);
    if (!match) return chord;

    let [, root, rest] = match;

    // Check for slash chord
    let bassNote = null;
    const slashMatch = rest.match(/^(.*)\/([A-G][#b]?)$/);
    if (slashMatch) {
        rest = slashMatch[1];
        bassNote = slashMatch[2];
    }

    // Transpose root
    const transposedRoot = transposeNote(root, semitones);

    // Transpose bass note if present
    const transposedBass = bassNote ? transposeNote(bassNote, semitones) : null;

    // Rebuild chord
    let result = transposedRoot + rest;
    if (transposedBass) {
        result += '/' + transposedBass;
    }

    return result;
}

/**
 * Transpose a single note by semitones
 */
export function transposeNote(note, semitones) {
    // Use sharps for upward transposition, flats for keys that prefer flats
    const sharpNotes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const flatNotes = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

    // Normalize the input note
    let normalized = note;
    const noteMap = {
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
        'E': 4, 'Fb': 4, 'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6,
        'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10,
        'B': 11, 'Cb': 11, 'B#': 0
    };

    const noteIndex = noteMap[normalized];
    if (noteIndex === undefined) return note;

    const newIndex = (noteIndex + semitones) % 12;

    // Use flats for flat keys, sharps otherwise
    const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm'];
    const useFlats = flatKeys.includes(currentDetectedKey);

    return useFlats ? flatNotes[newIndex] : sharpNotes[newIndex];
}

/**
 * Calculate semitones between two keys
 */
export function getSemitonesBetweenKeys(fromKey, toKey) {
    if (!fromKey || !toKey) return 0;

    // Extract root from key (handle minor keys like "Am")
    const fromRoot = fromKey.replace('m', '');
    const toRoot = toKey.replace('m', '');

    const noteMap = {
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
        'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
        'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
    };

    const fromIndex = noteMap[fromRoot];
    const toIndex = noteMap[toRoot];

    if (fromIndex === undefined || toIndex === undefined) return 0;

    return ((toIndex - fromIndex) + 12) % 12;
}

/**
 * Parse a line with chords into chord positions and lyrics
 */
export function parseLineWithChords(line) {
    const chords = [];
    let lyrics = '';

    const regex = /\[([^\]]+)\]/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(line)) !== null) {
        lyrics += line.slice(lastIndex, match.index);
        chords.push({
            chord: match[1],
            position: lyrics.length
        });
        lastIndex = regex.lastIndex;
    }

    lyrics += line.slice(lastIndex);
    return { chords, lyrics };
}

/**
 * Generate key options for dropdown
 */
export function generateKeyOptions(currentKey) {
    const keys = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
                  'Am', 'Bbm', 'Bm', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m'];
    return keys.map(k => `<option value="${k}"${k === currentKey ? ' selected' : ''}>${k}</option>`).join('');
}
