// Is a tab annotation's text a chord name? (G21d; OTF 1.3 annotations[].kind)
//
// parseTabChord(text) -> {chord, optional, shape, ext} | null
//   chord     the sounding chord, root capitalised: "em" -> "Em", "D/F#"
//   optional  true when written in parentheses: "(em)"
//   shape     capo spelling, the chord fingered: "A (G)" -> chord A, shape G
//   ext       optional extension: "A(7)" -> chord A, ext "7"
// Anything else is null and stays text. Draw chord and shape with
// chordGlyphHtml.
//
// The chord grammar is isValidChord (chords.js); this adds only what tabs
// write. A lowercase root is accepted only as a minor ("em", "bm7"); a lone
// "a", "e" or "g" is a word. A "o" (dim) quality alone is refused, so "Go"
// and "Do" stay text, and so do "A1".."B2" (part labels in the corpus). Python twin: scripts/lib/tab_chord.py; both are pinned
// by tests/fixtures/tab-chord/tab-chords.json.
import { isValidChord } from './chords.js';

/** "em" -> "Em"; a chord that does not parse as written comes back null. */
function tabChordName(s) {
    const name = /^[a-g][#b]?m(?!aj)/.test(s) ? s[0].toUpperCase() + s.slice(1) : s;
    // a bare "o" quality is the word "Go"/"Do"; "A1"/"B2" are part labels
    if (!isValidChord(name) || /^[A-G][#b]?(?:o(?:\/|$)|[1-4]$)/.test(name)) return null;
    return name;
}

export function parseTabChord(text) {
    if (typeof text !== 'string') return null;
    let s = text.trim();
    let optional = false;
    const wrapped = s.match(/^\(([^()]*)\)$/);
    if (wrapped) { optional = true; s = wrapped[1].trim(); }

    let inner = null;
    const tail = s.match(/^(.*?)\s*\(([^()]*)\)$/);
    if (tail) { s = tail[1]; inner = tail[2].trim(); }

    const chord = tabChordName(s);
    if (!chord) return null;
    let shape = null;
    let ext = null;
    if (inner !== null) {
        shape = tabChordName(inner);
        // an extension has a digit or starts minor: "7", "sus4", "m"; not a note name
        if (!shape && /^(?:m|[a-z#]*\d)/.test(inner) && isValidChord(chord + inner)) ext = inner;
        if (!shape && !ext) return null;
    }
    return { chord, optional, shape, ext };
}
