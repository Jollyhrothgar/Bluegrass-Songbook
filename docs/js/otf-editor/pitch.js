// Pitch math for the OTF editor: string + fret → MIDI, and back.
//
// A port (not an import) of the two lines `renderers/tab-player.js` uses
// to sound a note — `tuning.map(p => PITCH_TO_MIDI[p])` and
// `tuning[note.s - 1] + note.f`. The player is a DOM/WebAudio module and
// the facade must stay UI-free, so the arithmetic lives here as a pure
// module both this editor and its tests can call.
//
// Two deliberate differences from the player:
//
// 1. An unrecognised tuning name resolves to `null`, not to the player's
//    `|| 60` fallback. Playback would rather make a wrong sound than no
//    sound; an EDIT would rather refuse than move a note to a fret it
//    computed from a guess.
// 2. `capo` is ignored. It shifts every string equally, so it cancels out
//    of every operation here (re-stringing, transposing), and the corpus
//    stores frets relative to the nut either way.

/** Scientific pitch name → MIDI note number (C4 = 60), as tab-player builds it. */
export const PITCH_TO_MIDI = {};
['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    .forEach((note, i) => {
        for (let oct = 0; oct <= 8; oct++) {
            PITCH_TO_MIDI[`${note}${oct}`] = 12 + oct * 12 + i;
        }
    });

/** Fallback tunings, keyed by `track.instrument` (same table as tab-player). */
export const DEFAULT_TUNINGS = {
    'banjo': [62, 59, 55, 50, 67],        // D4 B3 G3 D3 G4 (open G)
    '5-string-banjo': [62, 59, 55, 50, 67],
    'mandolin': [76, 69, 62, 55],         // E5 A4 D4 G3
    'guitar': [64, 59, 55, 50, 45, 40],   // E4 B3 G3 D3 A2 E2
    '6-string-guitar': [64, 59, 55, 50, 45, 40],
    'upright-bass': [43, 38, 33, 28],     // G2 D2 A1 E1
};

/**
 * MIDI number for a pitch name ('G3', 'A#2'). Case- and shape-strict:
 * anything not in the table is `null`.
 * @param {*} name
 * @returns {number|null}
 */
export function pitchToMidi(name) {
    const midi = PITCH_TO_MIDI[String(name ?? '').trim()];
    return midi === undefined ? null : midi;
}

/**
 * A track's open-string MIDI numbers, string 1 first (the `s` index the
 * document uses, minus one). Entries the table can't resolve are `null`.
 *
 * @param {Object} track - an OTF track ({tuning, instrument})
 * @returns {number[]|null} null when the track has no usable tuning at all
 *   (percussion: no tuning array, and `s` is a kit line, not a string)
 */
export function tuningMidi(track) {
    if (!track) return null;
    const names = track.tuning;
    if (Array.isArray(names) && names.length > 0) {
        return names.map(pitchToMidi);
    }
    const fallback = DEFAULT_TUNINGS[track.instrument];
    return fallback ? fallback.slice() : null;
}

/**
 * Open (fret 0) pitch of one string.
 * @param {Object} track
 * @param {number} string - 1-indexed, as `note.s`
 * @returns {number|null} null when out of range or untuned
 */
export function openMidi(track, string) {
    const tuning = tuningMidi(track);
    if (!tuning) return null;
    if (!Number.isInteger(string) || string < 1 || string > tuning.length) return null;
    const midi = tuning[string - 1];
    return Number.isFinite(midi) ? midi : null;
}

/**
 * Sounding pitch of a note on a track.
 * @param {Object} track
 * @param {Object} note - {s, f}
 * @returns {number|null}
 */
export function notePitch(track, note) {
    const open = openMidi(track, note?.s);
    if (open == null) return null;
    const fret = Number(note?.f);
    if (!Number.isFinite(fret)) return null;
    return open + fret;
}

/**
 * Which fret on `string` sounds `midi`. May be negative or absurd — the
 * caller decides what range is playable (the editor clamps to 0..24).
 * @returns {number|null}
 */
export function fretForPitch(track, string, midi) {
    const open = openMidi(track, string);
    if (open == null || !Number.isFinite(midi)) return null;
    return midi - open;
}
