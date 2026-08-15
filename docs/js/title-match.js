// title-match.js — song-title normalization shared by the bounty board and
// (eventually) the offline catalogue builder.
//
// This is a NARROWING tool. It proposes that two titles might name the same
// song; it never decides that they do. Identity between titles like
// "Can the Circle Be Unbroken" and "Will the Circle Be Unbroken" is
// referential — which strings denote the same musical work in this tradition —
// and no string metric settles it. Those calls live in
// curation/bounty_decisions.yaml. See sources/bounty-hunt/CLEANUP-PLAN.md § 2.
//
// Two rules learned the hard way and encoded here:
//   1. Match on candidate SETS, never best-match-only. Ranking by score alone
//      put "Carpet on the Floor" (0.84) ahead of the three real
//      "Make Me a Pallet on the Floor" works.
//   2. Auto-resolve only the exact tiers. Fuzzy scores in the 0.80–0.93 band
//      interleave true and false pairs at identical values, so this module
//      deliberately exposes no ratio scorer — there is nothing safe to do with
//      the number.

// Arrangement/performer annotations the Strum Machine catalog glues onto its
// display names: "Sweet Sunny South modal", "Cotton-Eyed Joe 16 bars",
// "Sally Ann via Tommy Jarrell, mostly 1 & 4".
// Mirrors ANNOTATION_RE in scripts/lib/bounty_decisions.py.
const ANNOTATION = /\s+(via\s+.*|w\/.*|\d+\s*bars?|\d\/\d\s*time|modal|major|minor|1-4-5\s*only|with\s+\d+m|original chords|bluegrass version.*)$/i;

const STOPWORDS = new Set([
    'the', 'a', 'an', 'of', 'on', 'in', 'my', 'your', 'me', 'and',
    'by', 'to', 'for', 'is', 'it', 'that', 'this',
]);

/** Strip a trailing arrangement/performer annotation. */
export function stripAnnotation(title) {
    return String(title || '').replace(ANNOTATION, '');
}

/**
 * Normalized comparison key: accent-folded, lowercased, punctuation dropped,
 * articles normalized at BOTH ends — the data carries the trailing form
 * ("Last Song, The", "Bluest Man in Town, The") as well as the leading one.
 */
export function normalizeTitle(title) {
    let t = stripAnnotation(title)
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')   // combining marks
        .toLowerCase()
        .replace(/[‘’ʼ']/g, '')
        .replace(/&/g, ' and ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    t = t.replace(/^(the|a|an)\s+/, '');
    t = t.replace(/,?\s+(the|a|an)$/, '');
    return t.replace(/\s+/g, ' ').trim();
}

/** Stopword-free token set — catches word-order and possessive variants. */
export function tokenBag(title) {
    return new Set(normalizeTitle(title).split(' ').filter(w => w && !STOPWORDS.has(w)));
}

function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

/**
 * How two titles relate.
 *   'exact'     — identical normalized form. Safe to auto-resolve.
 *   'token-set' — same stopword-free tokens in any order. Safe to auto-resolve.
 *   null        — no safe relationship. Anything else (containment, near
 *                 spellings) needs adjudication, so it is not reported here.
 */
export function matchTier(a, b) {
    const na = normalizeTitle(a);
    const nb = normalizeTitle(b);
    if (!na || !nb) return null;
    if (na === nb) return 'exact';
    const ba = tokenBag(a);
    if (ba.size >= 2 && setsEqual(ba, tokenBag(b))) return 'token-set';
    return null;
}

/**
 * Every song whose title auto-resolves against `title`.
 *
 * Returns an ARRAY, deliberately — the caller decides what to do with several
 * candidates (prefer one with chords, prefer an indexed one). Collapsing to a
 * single best match here is the bug this module exists to prevent.
 */
export function findAutoMatches(title, songs) {
    const key = normalizeTitle(title);
    if (!key) return [];
    return songs.filter(s => s && s.title && matchTier(title, s.title));
}

/** Index songs by normalized title once, for repeated lookups. */
export function buildTitleIndex(songs) {
    const byKey = new Map();
    for (const s of songs) {
        if (!s || !s.title) continue;
        const k = normalizeTitle(s.title);
        if (!k) continue;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(s);
    }
    return byKey;
}
