// View-layer syllable tokenizer for the visual editor.
// Syllables are TAP TARGETS only — they never appear in the SongDocument
// model, which anchors chords to character offsets (see model.js).

// Syllables are cut by Liang hyphenation patterns (US English, the TeX /
// browser method; data in docs/vendor/hyph-en-us.js, algorithm below, written
// in-house) plus a few lyric rules the patterns refuse at word edges. The
// patterns run with a minimum of 1 letter on each side so "a|way" can split;
// the vowel guard below keeps every part a real syllable.
// Invariant: syllabify(word).join('') === word, always.
import { PATTERNS, EXCEPTIONS } from '../../vendor/hyph-en-us.js';

let trie = null;   // Map(letters incl. '.') -> digit array
let exc = null;    // Map(word) -> Set(offsets)
let maxLen = 0;

function load() {
    trie = new Map();
    for (const pat of PATTERNS.split(' ')) {
        let letters = '';
        const digits = [0];
        for (const ch of pat) {
            if (ch >= '0' && ch <= '9') digits[letters.length] = +ch;
            else { letters += ch; digits.push(0); }
        }
        trie.set(letters, digits);
        if (letters.length > maxLen) maxLen = letters.length;
    }
    exc = new Map();
    for (const w of EXCEPTIONS.split(' ')) {
        const set = new Set();
        let off = 0, plain = '';
        for (const ch of w) { if (ch === '-') set.add(off); else { plain += ch; off++; } }
        exc.set(plain, set);
    }
}

// Liang's algorithm: offsets k (1..n-1) where a hyphen may go in lowercase `w`.
function patternSeams(w) {
    if (!trie) load();
    const known = exc.get(w);
    if (known) return known;
    const padded = '.' + w + '.';
    const pts = new Array(padded.length + 1).fill(0);
    for (let i = 0; i < padded.length; i++) {
        const top = Math.min(padded.length, i + maxLen);
        for (let j = i + 1; j <= top; j++) {
            const d = trie.get(padded.slice(i, j));
            if (!d) continue;
            for (let k = 0; k < d.length; k++) if (d[k] > pts[i + k]) pts[i + k] = d[k];
        }
    }
    const out = new Set();
    for (let k = 1; k < w.length; k++) if (pts[k + 1] % 2 === 1) out.add(k);
    return out;
}

const VOWEL = /[aeiouy]/;
// A leading y before a vowel is a consonant (you, your, young), not a vowel part.
const hasVowel = (s) => VOWEL.test(s.replace(/^y(?=[aeiou])/, ''));
// Words the patterns leave whole but singers split (ev-ery, eve-ning).
const LYRIC_SPLITS = { every: 2, evening: 3 };
const TO_PREFIX = /^to(night|day|morrow|gether|ward|wards)$/;

// Seam offsets for one run of letters that starts the word at `leading`.
function runSeams(run, leading) {
    const w = run.toLowerCase();
    let seams = patternSeams(w);
    if (leading && LYRIC_SPLITS[w]) seams = new Set([LYRIC_SPLITS[w]]);
    if (leading) {
        // A lone leading "a"/"o" before a consonant is its own syllable
        // (a-way, a-gain, o-ver); not when the patterns already cut at 2
        // (an-gel, on-ly, or-der). Never "e": every, evening stay ev-ery, eve-ning.
        if (/^[ao][^aeiouy]/.test(w) && w.length >= 4 && !seams.has(2) && !seams.has(1)
            && VOWEL.test(w.slice(2))) {
            seams = new Set(seams); seams.add(1);
        }
        if (TO_PREFIX.test(w)) { seams = new Set(seams); seams.add(2); }
    }
    // Silent e (home, love, time): never its own syllable.
    const sorted = [...seams].sort((a, b) => a - b);
    const last = sorted[sorted.length - 1];
    if (last && /^[^aeiouy]*e$/.test(w.slice(last)) && !/[^aeiouy]le$/.test(w) && !/^[^aeiouy]*(ee|ie)$/.test(w.slice(last))) {
        seams = new Set(sorted.slice(0, -1));
    }
    // Every part must hold a vowel.
    const kept = [];
    let from = 0;
    for (const k of [...seams].sort((a, b) => a - b)) {
        if (!(k === 1 && w[0] === 'y') && hasVowel(w.slice(from, k)) && VOWEL.test(w.slice(k))) { kept.push(k); from = k; }
    }
    return kept;
}

export function syllabify(word) {
    const cuts = [];
    const re = /[A-Za-z]{3,}/g;
    let m;
    while ((m = re.exec(word)) !== null) {
        const leading = m.index === 0;
        for (const k of runSeams(m[0], leading)) cuts.push(m.index + k);
    }
    if (!cuts.length) return [word];
    const out = [];
    let prev = 0;
    for (const c of cuts) { out.push(word.slice(prev, c)); prev = c; }
    out.push(word.slice(prev));
    return out;
}

// tokenizeLine(lyrics, chordPositions) → [{ text, start }]
// Seams within each word: hyphens, heuristic syllables, and any chord
// position that falls inside the word (so existing mid-word chords always
// land on a token start and display honestly).
export function tokenizeLine(lyrics, chordPositions = []) {
    const tokens = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(lyrics)) !== null) {
        const word = m[0];
        const base = m.index;
        const seams = new Set([0]);
        for (let i = 1; i < word.length; i++) {
            if (word[i] === '-') seams.add(i);
        }
        let off = 0;
        for (const syl of syllabify(word)) {
            if (off > 0) seams.add(off);
            off += syl.length;
        }
        for (const pos of chordPositions) {
            const rel = pos - base;
            if (rel > 0 && rel < word.length) seams.add(rel);
        }
        const cuts = [...seams].sort((a, b) => a - b);
        cuts.push(word.length);
        for (let i = 0; i < cuts.length - 1; i++) {
            tokens.push({ text: word.slice(cuts[i], cuts[i + 1]), start: base + cuts[i] });
        }
    }
    return tokens;
}
