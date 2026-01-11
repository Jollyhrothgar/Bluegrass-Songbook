// Music theory module for chord progression explorer
// Generates diatonic and non-diatonic chords with voicings

// Note name to semitone offset from C
const NOTE_TO_SEMITONE = {
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4, 'E#': 5,
    'F': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10,
    'B': 11, 'Cb': 11, 'B#': 0
};

// Semitone to note name (prefer sharps for sharp keys, flats for flat keys)
const SEMITONE_TO_NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SEMITONE_TO_NOTE_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Keys that prefer flats
const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db'];

// Chord quality intervals from root (in semitones)
const CHORD_INTERVALS = {
    'maj':    [0, 4, 7],           // Major triad
    'min':    [0, 3, 7],           // Minor triad
    'dim':    [0, 3, 6],           // Diminished triad
    'aug':    [0, 4, 8],           // Augmented triad
    'maj7':   [0, 4, 7, 11],       // Major 7th
    'min7':   [0, 3, 7, 10],       // Minor 7th
    'dom7':   [0, 4, 7, 10],       // Dominant 7th
    'dim7':   [0, 3, 6, 9],        // Diminished 7th
    'min7b5': [0, 3, 6, 10],       // Half-diminished (m7b5)
};

// Diatonic chord qualities for major keys
// I, ii, iii, IV, V, vi, vii°
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11]; // Semitones from tonic
const DIATONIC_QUALITIES_TRIAD = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
const DIATONIC_QUALITIES_7TH = ['maj7', 'min7', 'min7', 'maj7', 'dom7', 'min7', 'min7b5'];
const DIATONIC_NUMERALS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];

/**
 * Get note name from semitone, respecting key's sharp/flat preference
 */
function semitoneToNote(semitone, key) {
    const normalized = ((semitone % 12) + 12) % 12;
    const useFlats = FLAT_KEYS.includes(key);
    return useFlats ? SEMITONE_TO_NOTE_FLAT[normalized] : SEMITONE_TO_NOTE_SHARP[normalized];
}

/**
 * Convert note name to MIDI number
 * C4 = 60 (middle C)
 */
export function noteToMidi(noteName, octave = 4) {
    const semitone = NOTE_TO_SEMITONE[noteName];
    if (semitone === undefined) return null;
    return 12 + (octave * 12) + semitone;
}

/**
 * Convert MIDI number to note name
 */
export function midiToNote(midi, key = 'C') {
    const semitone = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    return { note: semitoneToNote(semitone, key), octave };
}

/**
 * Format chord display name
 */
function formatChordName(root, quality, use7ths) {
    if (use7ths) {
        switch (quality) {
            case 'maj7': return root + 'maj7';
            case 'min7': return root + 'm7';
            case 'dom7': return root + '7';
            case 'min7b5': return root + 'm7b5';
            case 'dim7': return root + '°7';
            default: return root + quality;
        }
    } else {
        switch (quality) {
            case 'maj':
            case 'maj7':
            case 'dom7':
                return root;
            case 'min':
            case 'min7':
                return root + 'm';
            case 'dim':
            case 'dim7':
            case 'min7b5':
                return root + '°';
            default:
                return root + quality;
        }
    }
}

/**
 * Get diatonic chords for a major key
 * @param {string} key - The key (e.g., 'G', 'C', 'F')
 * @param {boolean} use7ths - Whether to use 7th chords
 * @returns {Array} Array of chord objects
 */
export function getDiatonicChords(key, use7ths = false) {
    const tonicSemitone = NOTE_TO_SEMITONE[key];
    if (tonicSemitone === undefined) return [];

    const qualities = use7ths ? DIATONIC_QUALITIES_7TH : DIATONIC_QUALITIES_TRIAD;

    return MAJOR_SCALE_INTERVALS.map((interval, i) => {
        const rootSemitone = (tonicSemitone + interval) % 12;
        const root = semitoneToNote(rootSemitone, key);
        const quality = qualities[i];

        return {
            root,
            quality,
            numeral: DIATONIC_NUMERALS[i],
            display: formatChordName(root, quality, use7ths),
            semitone: rootSemitone,
            isDiatonic: true
        };
    });
}

/**
 * Get non-diatonic chords for a key
 * Includes: secondary dominants, borrowed chords, major versions of minor chords
 * @param {string} key - The key
 * @param {boolean} use7ths - Whether to use 7th chords
 * @returns {Array} Array of chord objects
 */
export function getNonDiatonicChords(key, use7ths = false) {
    const tonicSemitone = NOTE_TO_SEMITONE[key];
    if (tonicSemitone === undefined) return [];

    const chords = [];

    // Secondary dominants (V of ii, iii, IV, V, vi)
    // V/ii = III (e.g., in G: B7 resolves to Am)
    // V/iii = #IV (e.g., in G: C#7 resolves to Bm) - less common, skip
    // V/IV = I7 (e.g., in G: G7 resolves to C) - but I7 is common already
    // V/V = II (e.g., in G: A7 resolves to D)
    // V/vi = III (e.g., in G: B7 resolves to Em)

    const secondaryDominants = [
        { interval: 4, numeral: 'V/ii', target: 'ii' },   // Major III (V of ii)
        { interval: 9, numeral: 'V/V', target: 'V' },     // Major II (V of V)
        { interval: 11, numeral: 'V/vi', target: 'vi' },  // Major VII (V of vi)
    ];

    secondaryDominants.forEach(({ interval, numeral, target }) => {
        const rootSemitone = (tonicSemitone + interval) % 12;
        const root = semitoneToNote(rootSemitone, key);
        const quality = use7ths ? 'dom7' : 'maj';

        chords.push({
            root,
            quality,
            numeral,
            display: formatChordName(root, quality, use7ths),
            semitone: rootSemitone,
            isDiatonic: false,
            resolution: `→ ${target}`
        });
    });

    // Borrowed chords from parallel minor (bIII, bVI, bVII)
    const borrowedChords = [
        { interval: 3, numeral: 'bIII' },   // Flat III (e.g., Bb in G)
        { interval: 8, numeral: 'bVI' },    // Flat VI (e.g., Eb in G)
        { interval: 10, numeral: 'bVII' },  // Flat VII (e.g., F in G)
    ];

    borrowedChords.forEach(({ interval, numeral }) => {
        const rootSemitone = (tonicSemitone + interval) % 12;
        const root = semitoneToNote(rootSemitone, key);
        const quality = use7ths ? 'maj7' : 'maj';

        chords.push({
            root,
            quality,
            numeral,
            display: formatChordName(root, quality, use7ths),
            semitone: rootSemitone,
            isDiatonic: false,
            resolution: '→ I'
        });
    });

    // Major versions of minor chords (II, III, VI)
    const majorVersions = [
        { interval: 2, numeral: 'II', diatonicNumeral: 'ii' },
        { interval: 4, numeral: 'III', diatonicNumeral: 'iii' },
        { interval: 9, numeral: 'VI', diatonicNumeral: 'vi' },
    ];

    // Only add if not already covered by secondary dominants
    majorVersions.forEach(({ interval, numeral, diatonicNumeral }) => {
        // Skip II and III as they overlap with V/V and V/ii
        if (numeral === 'II' || numeral === 'III') return;

        const rootSemitone = (tonicSemitone + interval) % 12;
        const root = semitoneToNote(rootSemitone, key);
        const quality = use7ths ? 'maj7' : 'maj';

        chords.push({
            root,
            quality,
            numeral,
            display: formatChordName(root, quality, use7ths),
            semitone: rootSemitone,
            isDiatonic: false,
            resolution: `(major ${diatonicNumeral})`
        });
    });

    return chords;
}

/**
 * Check if a chord quality is a 7th chord
 */
export function is7thChord(quality) {
    return ['maj7', 'min7', 'dom7', 'dim7', 'min7b5'].includes(quality);
}

/**
 * Get the number of inversions for a chord quality
 */
export function getInversionCount(quality) {
    return is7thChord(quality) ? 4 : 3;
}

/**
 * Convert a chord to its dominant 7 variant
 * maj -> dom7, min -> min7, dim -> min7b5
 */
export function toDominant7(chord) {
    const qualityMap = {
        'maj': 'dom7',
        'min': 'min7',
        'dim': 'min7b5',
        'aug': 'dom7',      // Augmented -> dominant 7
        'maj7': 'dom7',
        'min7': 'min7',
        'dom7': 'dom7',
        'dim7': 'min7b5',
        'min7b5': 'min7b5'
    };
    const newQuality = qualityMap[chord.quality] || 'dom7';
    return {
        ...chord,
        quality: newQuality,
        display: formatChordName(chord.root, newQuality, true)
    };
}

/**
 * Convert a chord to its major 7 variant
 * maj -> maj7, min -> min7, dim -> dim7
 */
export function toMajor7(chord) {
    const qualityMap = {
        'maj': 'maj7',
        'min': 'min7',
        'dim': 'dim7',
        'aug': 'maj7',
        'maj7': 'maj7',
        'min7': 'min7',
        'dom7': 'maj7',
        'dim7': 'dim7',
        'min7b5': 'dim7'
    };
    const newQuality = qualityMap[chord.quality] || 'maj7';
    return {
        ...chord,
        quality: newQuality,
        display: formatChordName(chord.root, newQuality, true)
    };
}

/**
 * Convert a chord to its triad (non-7th) variant
 */
export function toTriad(chord) {
    const qualityMap = {
        'maj': 'maj',
        'min': 'min',
        'dim': 'dim',
        'aug': 'aug',
        'maj7': 'maj',
        'min7': 'min',
        'dom7': 'maj',
        'dim7': 'dim',
        'min7b5': 'dim'
    };
    const newQuality = qualityMap[chord.quality] || 'maj';
    return {
        ...chord,
        quality: newQuality,
        display: formatChordName(chord.root, newQuality, false)
    };
}

/**
 * Convert a chord to its minor variant
 */
export function toMinor(chord) {
    const qualityMap = {
        'maj': 'min',
        'min': 'min',           // Already minor
        'dim': 'dim',           // Diminished stays
        'aug': 'min',           // Augmented -> minor
        'maj7': 'min7',
        'min7': 'min7',         // Already minor
        'dom7': 'min7',
        'dim7': 'dim7',
        'min7b5': 'min7b5'
    };
    const newQuality = qualityMap[chord.quality] || chord.quality;
    const use7ths = is7thChord(newQuality);
    return {
        ...chord,
        quality: newQuality,
        display: formatChordName(chord.root, newQuality, use7ths)
    };
}

/**
 * Get MIDI notes for a chord voicing
 * Triads: 4 notes (1-3-5-1, 3-5-1-3, 5-1-3-5)
 * 7ths: 5 notes (1-3-5-7-1, 3-5-7-1-3, 5-7-1-3-5, 7-1-3-5-7)
 * @param {Object} chord - Chord object from getDiatonicChords/getNonDiatonicChords
 * @param {number} inversion - 0-2 for triads, 0-3 for 7ths
 * @param {number} octave - Base octave (4 = middle C area)
 * @returns {number[]} Array of MIDI note numbers
 */
export function getChordVoicing(chord, inversion = 0, octave = 4) {
    const rootMidi = noteToMidi(chord.root, octave);
    if (rootMidi === null) return [];

    const quality = chord.quality;
    const isSeventh = is7thChord(quality);

    // Get chord intervals based on quality
    let intervals;
    if (quality === 'maj') {
        intervals = [0, 4, 7];              // Major triad
    } else if (quality === 'min') {
        intervals = [0, 3, 7];              // Minor triad
    } else if (quality === 'dim') {
        intervals = [0, 3, 6];              // Diminished triad
    } else if (quality === 'aug') {
        intervals = [0, 4, 8];              // Augmented triad
    } else if (quality === 'maj7') {
        intervals = [0, 4, 7, 11];          // Major 7th
    } else if (quality === 'min7') {
        intervals = [0, 3, 7, 10];          // Minor 7th
    } else if (quality === 'dom7') {
        intervals = [0, 4, 7, 10];          // Dominant 7th
    } else if (quality === 'dim7') {
        intervals = [0, 3, 6, 9];           // Diminished 7th
    } else if (quality === 'min7b5') {
        intervals = [0, 3, 6, 10];          // Half-diminished
    } else {
        intervals = [0, 4, 7];              // Default to major triad
    }

    const numTones = intervals.length;
    const inv = inversion % numTones;

    // Build the voicing by rotating intervals and dropping lower notes
    // Goal: keep chord in same register regardless of inversion
    let notes = [];

    for (let i = 0; i < numTones; i++) {
        const intervalIndex = (inv + i) % numTones;
        let midiNote = rootMidi + intervals[intervalIndex];

        // Drop notes that would be below the bass note's target position
        // The first note (bass) sets the reference; subsequent notes go up from there
        if (i > 0 && midiNote <= notes[0]) {
            midiNote += 12;
        }
        // For 7th chords, ensure proper voice ordering
        if (i > 0 && notes.length > 0 && midiNote <= notes[notes.length - 1]) {
            midiNote += 12;
        }

        notes.push(midiNote);
    }

    // Drop the entire chord so bass is around the target octave
    // Calculate how much to drop based on bass note position
    const bassInterval = intervals[inv];
    if (bassInterval > 0) {
        // If bass is not the root, we need to drop notes down
        const dropAmount = bassInterval <= 6 ? 12 : 12;
        notes = notes.map(n => n - dropAmount);
    }

    // Add doubled bass note an octave up
    notes.push(notes[0] + 12);

    return notes;
}

/**
 * Get common resolution patterns for a chord
 * @param {Object} chord - Chord object
 * @param {string} key - The key context
 * @returns {string[]} Array of resolution pattern strings
 */
export function getResolutions(chord, key) {
    const numeral = chord.numeral;
    const resolutions = [];

    // Common patterns based on function
    switch (numeral) {
        case 'I':
            resolutions.push('I → IV → I', 'I → V → I');
            break;
        case 'ii':
            resolutions.push('ii → V → I', 'ii → IV → I');
            break;
        case 'iii':
            resolutions.push('iii → vi → ii → V', 'iii → IV → V');
            break;
        case 'IV':
            resolutions.push('IV → V → I', 'IV → I', 'IV → ii → V');
            break;
        case 'V':
            resolutions.push('V → I', 'V → vi (deceptive)', 'V → IV (plagal)');
            break;
        case 'vi':
            resolutions.push('vi → ii → V → I', 'vi → IV → V', 'I → vi → IV → V');
            break;
        case 'vii°':
            resolutions.push('vii° → I', 'vii° → iii');
            break;
        case 'V/V':
            resolutions.push('V/V → V → I', 'II → V → I');
            break;
        case 'V/ii':
            resolutions.push('V/ii → ii → V → I');
            break;
        case 'V/vi':
            resolutions.push('V/vi → vi → ii → V');
            break;
        case 'bIII':
            resolutions.push('bIII → IV → I', 'I → bIII → IV → I');
            break;
        case 'bVI':
            resolutions.push('bVI → bVII → I', 'iv → bVI → bVII → I');
            break;
        case 'bVII':
            resolutions.push('bVII → I', 'bVII → IV → I', 'bVI → bVII → I');
            break;
        default:
            if (chord.resolution) {
                resolutions.push(chord.resolution);
            }
    }

    return resolutions;
}

/**
 * Get all chords (diatonic + non-diatonic) for a key
 * @param {string} key - The key
 * @param {boolean} use7ths - Whether to use 7th chords
 * @returns {Object} { diatonic: [], nonDiatonic: [] }
 */
export function getAllChords(key, use7ths = false) {
    return {
        diatonic: getDiatonicChords(key, use7ths),
        nonDiatonic: getNonDiatonicChords(key, use7ths)
    };
}
