// What the chord menu contains for a key. Pure data, no DOM. Every chord and
// every extension appears EXACTLY ONCE in the sheet:
//
//   decorations   (only while the box holds a chord) the ONLY place extensions live. Marks
//                 that compose with the chord in the box: Am + 7 -> Am7, G + sus4 -> Gsus4.
//                 Seven are always there, with a "..." as the 8th cell that opens a second row of the rarer ones (and /bass)
//   outside row   "Outside": the same roots as the row below with the quality flipped, plus
//                 bVII: Gm A B Cm Dm E F in G, E F#m Gm A B Cm Dm in Em
//   in-key row    "In key": the key's own triads with numerals (nearest the thumb)
//   more roots    the chromatic roots that are on neither row (major and minor each, outside)
//   bass          the 12 bass notes: the key's own tones in-key, the rest outside
//
// Extensions never get their own chord cells. The grids are written in G (major) and Em
// (minor) and transposed to the song's key.

import { transposeChord, getSemitonesBetweenKeys } from '../chords.js';

// [chord, numeral]; null is an empty slot
const G = {
    diatonic: [['G', 'I'], ['Am', 'ii'], ['Bm', 'iii'], ['C', 'IV'], ['D', 'V'], ['Em', 'vi'], ['F#dim', 'vii°']],
    // the vii° column holds F (bVII), a single data entry the owner may revise
    flipped:  [['Gm', 'i'], ['A', 'II'], ['B', 'III'], ['Cm', 'iv'], ['Dm', 'v'], ['E', 'VI'], ['F', 'bVII']],
};
const EM = {
    diatonic: [['Em', 'i'], ['F#dim', 'ii°'], ['G', 'III'], ['Am', 'iv'], ['Bm', 'v'], ['C', 'VI'], ['D', 'VII']],
    flipped:  [['E', 'I'], ['F#m', 'ii'], ['Gm', 'iii'], ['A', 'IV'], ['B', 'V'], ['Cm', 'vi'], ['Dm', 'vii']],
};
const QUIET = new Set(['vii°', 'ii°']);

/**
 * The decorations, in display order. `label` is plain text (superscript
 * characters), never HTML. `rare` ones sit behind the row's "...".
 * `ext` marks an extension (it replaces the one there); `setBase` marks a quality
 * (dim / aug replace the triad's quality and keep any extension). `needsMinor`: only offered on a minor chord.
 * `/bass` is separate: it opens the bass-note row.
 */
export const DECORATIONS = [
    { id: '7', suffix: '7', label: '⁷', name: 'seventh' },
    { id: 'maj7', suffix: 'maj7', label: 'maj⁷', name: 'major seventh' },
    { id: '6', suffix: '6', label: '⁶', name: 'sixth' },
    { id: 'sus4', suffix: 'sus4', label: 'sus⁴', name: 'suspended fourth' },
    { id: 'sus2', suffix: 'sus2', label: 'sus²', name: 'suspended second' },
    { id: 'add9', suffix: 'add9', label: 'add⁹', name: 'add nine' },
    { id: '9', suffix: '9', label: '⁹', name: 'ninth' },
    { id: '69', suffix: '69', label: '⁶⁄₉', name: 'six nine', rare: true },
    { id: '11', suffix: '11', label: '¹¹', name: 'eleventh', rare: true },
    { id: '13', suffix: '13', label: '¹³', name: 'thirteenth', rare: true },
    { id: 'dim', setBase: 'dim', label: '°', name: 'diminished', rare: true },
    { id: 'm7b5', suffix: 'm7b5', label: 'ø⁷', name: 'half-diminished', rare: true },
    { id: 'aug', setBase: 'aug', label: '+', name: 'augmented', rare: true },
    { id: 'mmaj7', suffix: 'mmaj7', label: 'm(maj⁷)', name: 'minor major seventh', rare: true, needsMinor: true },
];
const EXTENSIONS = DECORATIONS.filter((d) => d.suffix);
export const BASS_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const SHARP_MAJOR = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'C#']);
const SHARP_MINOR = new Set(['E', 'B', 'F#', 'C#', 'G#', 'D#']);
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
// numerals for the roots the two rows leave out (semitones above the tonic)
const OUTSIDE_NUMERALS = { 1: 'bII', 2: 'II', 3: 'bIII', 4: 'III', 5: 'IV', 6: 'bV', 7: 'V', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII' };
const OUTSIDE_NUMERALS_MINOR = { 1: 'bII', 2: 'II', 3: 'III', 4: '#III', 5: 'IV', 6: 'bV', 7: 'V', 8: 'VI', 9: '#VI', 10: 'VII', 11: '#VII' };

const EXT_BY_LENGTH = [...EXTENSIONS].sort((a, b) => b.suffix.length - a.suffix.length);
const PLAIN_QUALITIES = new Set(['', 'm', 'dim', 'aug']);

/** Split a chord into its root and quality ('F#m7' -> ['F#', 'm7']); null if not a chord. */
export function splitChord(chord) {
    const m = String(chord || '').match(/^([A-G][#b]?)([^/]*)(\/.*)?$/);
    return m ? { root: m[1], quality: m[2], bass: m[3] || '' } : null;
}

/**
 * A chord as the menu composes it: { root, base ('' | 'm' | 'dim' | 'aug'),
 * ext (a DECORATIONS id or ''), bass ('/G' or '') }. A quality the menu does not
 * build (Cmaj9, 7sus4) keeps only its minor-ness as the base and no extension.
 */
export function decomposeChord(chord) {
    const p = splitChord(chord);
    if (!p) return null;
    let { quality } = p;
    let ext = '';
    for (const d of EXT_BY_LENGTH) {
        if (quality.endsWith(d.suffix) && PLAIN_QUALITIES.has(quality.slice(0, -d.suffix.length))) {
            ext = d.id;
            quality = quality.slice(0, -d.suffix.length);
            break;
        }
    }
    if (!PLAIN_QUALITIES.has(quality)) quality = /^m(?!aj)/.test(quality) ? 'm' : '';
    return { root: p.root, base: quality, ext, bass: p.bass };
}

/** Put the pieces back together. */
export function composeChord({ root, base = '', ext = '', bass = '' }) {
    const d = EXTENSIONS.find((x) => x.id === ext);
    return `${root}${base}${d ? d.suffix : ''}${bass}`;
}

/** The chord after tapping a decoration: the same one again removes it (one extension at a time). */
export function applyDecoration(chord, id) {
    const c = decomposeChord(chord);
    const d = DECORATIONS.find((x) => x.id === id);
    if (!c || !d) return null;
    if (d.setBase) return composeChord({ ...c, base: c.base === d.setBase ? '' : d.setBase });   // dim / aug: a quality, any extension stays
    // sus2 / sus4 replace the third, so they own the quality too: Dm + sus2 = Dsus2, never Dmsus2
    if (id === 'sus2' || id === 'sus4') return composeChord({ ...c, base: '', ext: c.ext === id ? '' : id });
    // m7b5 and m(maj7) carry their own minor; every other extension keeps the triad's quality
    const own = id === 'm7b5' || id === 'mmaj7';
    const off = c.ext === id;
    return composeChord({ ...c, base: own && !off ? '' : (own && off ? 'm' : c.base), ext: off ? '' : id });
}

/**
 * Remembers what a sus replaced, so tapping it off again gives that back (Dm -> Dsus2 -> Dm, not D).
 * applyDecoration is pure and cannot know. `pick(pos, current, id)` is the chord to write for decoration `id`.
 */
export function createSusMemory() {
    let memo = null;   // { pos, from, to }
    return {
        pick(pos, current, id) {
            const next = applyDecoration(current, id);
            const c = decomposeChord(current);
            const isSus = id === 'sus2' || id === 'sus4';
            const here = memo && memo.pos === pos && memo.to === current ? memo : null;
            if (!isSus || !c) { memo = null; return next; }
            if (c.ext === id) { memo = null; return here ? here.from : next; }      // toggling off
            if (c.base) memo = { pos, from: current, to: next };                    // a base quality was there
            else if (here) memo = { pos, from: here.from, to: next };               // sus2 <-> sus4 keeps it
            else memo = null;
            return next;
        },
    };
}

/** The chord after picking a bass note; the same note again removes it. */
export function applyBass(chord, note) {
    const c = decomposeChord(chord);
    if (!c) return null;
    const same = c.bass && NOTE_PC[c.bass.slice(1)] === NOTE_PC[note];   // F#/ and Gb/ are the same bass
    return composeChord({ ...c, bass: same ? '' : `/${note}` });
}

/** True when a key is spelled with sharps (G, D, Em, Bm ...), else flats. */
export function prefersSharps(key) {
    const { tonic, minor } = parseKey(key);
    return (minor ? SHARP_MINOR : SHARP_MAJOR).has(tonic);
}

export function parseKey(key) {
    const m = String(key || '').match(/^([A-G][#b]?)(m|min)?$/);
    return m ? { tonic: m[1], minor: !!m[2] } : { tonic: 'G', minor: false };
}

// ---------------------------------------------------------------------------
// In key or outside it: decided per CHORD (every chord tone in the key's scale)
// ---------------------------------------------------------------------------

const TRIAD_TONES = { '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8] };
const EXT_TONES = {
    7: (base) => (base === 'dim' ? [9] : [10]), maj7: () => [11], 6: () => [9], 69: () => [9, 2], add9: () => [2],
    9: () => [10, 2], 11: () => [10, 2, 5], 13: () => [10, 2, 9],
};

/** The pitch classes (0-11) a chord sounds, or null when it is not a chord we can read. */
export function chordTonePcs(chord) {
    const c = decomposeChord(chord);
    if (!c) return null;
    const root = NOTE_PC[c.root];
    if (root == null) return null;
    let offsets;
    if (c.ext === 'sus2') offsets = [0, 2, 7];
    else if (c.ext === 'sus4') offsets = [0, 5, 7];
    else if (c.ext === 'm7b5') offsets = [0, 3, 6, 10];
    else if (c.ext === 'mmaj7') offsets = [0, 3, 7, 11];
    else offsets = [...TRIAD_TONES[c.base], ...(c.ext ? EXT_TONES[c.ext](c.base) : [])];
    const pcs = new Set(offsets.map((o) => (root + o) % 12));
    if (c.bass && NOTE_PC[c.bass.slice(1)] != null) pcs.add(NOTE_PC[c.bass.slice(1)]);
    return pcs;
}

/**
 * The key's scale as pitch classes. A minor key also allows its raised 7th (harmonic minor), but only for
 * the chord on the dominant: B and B7 in Em are in key, Cm (which would use the same pitch as a flat 3rd) is not.
 */
function keyScale(key, rootPc) {
    const { tonic, minor } = parseKey(key);
    const t = NOTE_PC[tonic] ?? 7;
    const steps = minor && rootPc === (t + 7) % 12 ? [...MINOR_SCALE, 11] : minor ? MINOR_SCALE : MAJOR_SCALE;
    return new Set(steps.map((i) => (t + i) % 12));
}

/**
 * True when every tone of the chord (and its bass note) is in the key's scale.
 * G major: D7 and Cmaj7 are in key; G7 and A7 are not. Em: B and B7 are in key (raised 7th).
 */
export function inKey(chord, key) {
    const pcs = chordTonePcs(chord);
    if (!pcs) return false;
    const rootPc = NOTE_PC[decomposeChord(chord).root];
    const scale = keyScale(key, rootPc);
    return [...pcs].every((p) => scale.has(p));
}

// ---------------------------------------------------------------------------
// What a chord does in the key: "II7 (V7/V)"
// ---------------------------------------------------------------------------

// the key's own degrees by semitones above the tonic, with their numerals (from the grids above)
function degreeNumerals(minor) {
    const table = minor ? EM : G;
    const map = new Map();
    const degrees = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    table.diatonic.forEach(([, numeral], i) => map.set(degrees[i], numeral));
    return map;
}

/**
 * The chord's function in the key: { numeral, secondary, text }.
 *   numeral    'V7', 'II7', 'bIII', 'vi' (case follows the chord's quality)
 *   secondary  'V7/V' when it is the dominant-7th (or major chord) a fifth above a diatonic target
 *              (V/ii, V/iii, V/IV, V/V, V/vi ...), else null. The plain V is never a secondary
 *   text       'II7 (V7/V)' or just 'V7'
 * ASCII on purpose: the sheet draws it with chordGlyphHtml (flats, superscripts).
 */
export function chordFunction(chord, key) {
    const c = decomposeChord(chord);
    if (!c) return null;
    const { tonic, minor } = parseKey(key);
    const t = NOTE_PC[tonic] ?? 7;
    const semis = ((NOTE_PC[c.root] ?? 0) - t + 12) % 12;
    const degrees = degreeNumerals(minor);
    const known = degrees.get(semis);
    const raw = known ? known.replace('°', '') : (minor ? OUTSIDE_NUMERALS_MINOR : OUTSIDE_NUMERALS)[semis];
    const acc = /^[b#]/.test(raw) ? raw[0] : '';
    const roman = raw.slice(acc.length).toUpperCase();
    const sus = c.ext === 'sus2' || c.ext === 'sus4';   // no third, so no minor/major case
    const lower = !sus && (c.base === 'm' || c.base === 'dim') || c.ext === 'm7b5' || c.ext === 'mmaj7';
    const ext = c.ext === 'm7b5' ? 'ø7' : c.ext === 'mmaj7' ? 'maj7' : (EXTENSIONS.find((e) => e.id === c.ext)?.suffix || '');
    const numeral = `${acc}${lower ? roman.toLowerCase() : roman}${c.base === 'dim' ? '°' : ''}${c.base === 'aug' ? '+' : ''}${ext}`;
    // a secondary dominant: a major chord or dominant seventh whose target, a fifth below, is a diatonic non-tonic chord
    let secondary = null;
    const plainMajor = c.base === '' && (c.ext === '' || c.ext === '7');
    if (plainMajor && !inKey(chord, key)) {            // a chord that is already in the key just shows its numeral
        const targetSemis = (semis + 5) % 12;          // a fifth below = a fourth above
        const target = degrees.get(targetSemis);
        if (target && targetSemis !== 0 && !target.includes('°')) secondary = `V${c.ext === '7' ? '7' : ''}/${target}`;
    }
    return { numeral, secondary, text: secondary ? `${numeral} (${secondary})` : numeral };
}

/**
 * The menu for a key.
 *   key      '{key}' text ('G', 'Em'); anything else falls back to G
 *   used     chords the song already uses (the dots)
 *   current  the chord in the box ('' for none)
 * Returns { key, minor, rows (top to bottom, cells left to right; each cell says whether it is `outside` the key, by `inKey`),
 *           moreRoots (the roots on neither row, as a major and a minor cell),
 *           func (what the chord in the box does in the key: chordFunction),
 *           decorations ([] while the box is empty), bass ({on, note, notes:[{note, inKey}]} or null) }.
 */
export function chordMenuModel({ key = 'G', used = [], current = '' } = {}) {
    const { tonic, minor } = parseKey(key);
    const table = minor ? EM : G;
    const tonicPc = NOTE_PC[tonic] ?? 7;
    const semis = getSemitonesBetweenKeys(minor ? 'E' : 'G', tonic);
    const usedSet = new Set(used);
    const rootsOnGrid = new Set();
    const cur = decomposeChord(current);
    const curBase = cur ? `${cur.root}${cur.base}` : '';

    const rows = ['flipped', 'diatonic'].map((id) => ({
        id,
        label: id === 'flipped' ? 'Outside' : 'In key',   // for assistive tech only: nothing is captioned on screen
        cells: table[id].map(([c, numeral]) => {
            const chord = semis === 0 ? c : transposeChord(c, semis);
            rootsOnGrid.add(NOTE_PC[splitChord(chord).root]);
            // in key or outside is the CHORD's own property, not the row's
            return { chord, numeral, used: usedSet.has(chord), selected: chord === curBase, quiet: QUIET.has(numeral), outside: !inKey(chord, key) };
        }),
    }));

    // the chromatic roots on neither row, spelled for the key
    const names = prefersSharps(key) ? PC_SHARP : PC_FLAT;
    const numerals = minor ? OUTSIDE_NUMERALS_MINOR : OUTSIDE_NUMERALS;
    const moreRoots = [];
    for (let pc = 0; pc < 12; pc++) {
        if (rootsOnGrid.has(pc)) continue;
        const root = names[pc];
        const numeral = numerals[(pc - tonicPc + 12) % 12];
        const cell = (chord, num) => ({ chord, numeral: num, used: usedSet.has(chord), selected: chord === curBase, outside: !inKey(chord, key) });
        moreRoots.push({ root, major: cell(root, numeral), minor: cell(`${root}m`, numeral.toLowerCase()) });
    }

    const isMinorChord = !!cur && (cur.base === 'm' || cur.ext === 'mmaj7' || cur.ext === 'm7b5');
    const decorations = cur
        ? DECORATIONS.filter((d) => !d.needsMinor || isMinorChord).map((d) => ({
            ...d,
            chord: applyDecoration(current, d.id),   // what tapping gives: the active one toggles off
            on: d.setBase ? cur.base === d.setBase : cur.ext === d.id,
        })).map((d) => ({ ...d, inKey: inKey(d.on ? current : d.chord, key) }))   // styled by whether the RESULT is in key
        : [];
    let bass = null;
    if (cur) {
        const scale = new Set((minor ? MINOR_SCALE : MAJOR_SCALE).map((i) => (tonicPc + i) % 12));
        const curPc = cur.bass ? NOTE_PC[cur.bass.slice(1)] : null;
        bass = {
            on: !!cur.bass, note: cur.bass.slice(1),
            notes: names.map((note, pc) => ({ note, inKey: scale.has(pc), on: curPc === pc })),
        };
    }
    // what the decorations row shows with an empty box (disabled): the row never comes and goes, so the sheet keeps its height
    const idleDecorations = DECORATIONS.filter((d) => !d.rare && !d.needsMinor).map((d) => ({ id: d.id, label: d.label, name: d.name }));
    return { key: minor ? `${tonic}m` : tonic, minor, rows, moreRoots, decorations, idleDecorations, bass, func: cur ? chordFunction(current, key) : null };
}

export function isQuietNumeral(numeral) { return QUIET.has(numeral); }
