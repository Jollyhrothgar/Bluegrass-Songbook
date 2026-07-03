// View-layer syllable tokenizer for the visual editor.
// Syllables are TAP TARGETS only — they never appear in the SongDocument
// model, which anchors chords to character offsets (see model.js).

// Heuristic syllabifier: locate vowel groups and cut between them — a lone
// consonant joins the following syllable (fo|rest); with a cluster we cut
// after the first consonant (sen|ses). Imperfect by design; seams are merged
// with hyphen and chord-offset seams in tokenizeLine.
// Invariant: syllabify(word).join('') === word, always.
export function syllabify(word) {
    const isVowel = (c) => /[aeiouyAEIOUY]/.test(c);
    const groups = [];
    for (let i = 0; i < word.length; i++) {
        if (isVowel(word[i])) {
            const start = i;
            while (i + 1 < word.length && isVowel(word[i + 1])) i++;
            groups.push({ start, end: i });
        }
    }
    if (groups.length < 2) return [word];
    const cuts = [];
    for (let g = 0; g < groups.length - 1; g++) {
        const gapStart = groups[g].end + 1;
        const gapLen = groups[g + 1].start - gapStart;
        cuts.push(gapLen === 1 ? gapStart : gapStart + 1);
    }
    const out = [];
    let prev = 0;
    for (const cut of cuts) {
        out.push(word.slice(prev, cut));
        prev = cut;
    }
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
