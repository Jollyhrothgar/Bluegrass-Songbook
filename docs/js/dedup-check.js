// "This song already exists" — the client half of the dedup offramp.
//
// THRESHOLDS AND NORMALIZATION MIRROR `scripts/lib/dedup_scorer.py` AND MUST
// BE CHANGED TOGETHER. The two surfaces are deliberately the same scorer at
// two moments: this one runs before the submission is sent, so the choice is
// the contributor's ("enrich it / it's my own version / it's a different
// song"); the Python one runs in CI on the last line before a slug is minted,
// so it also covers the paths with no human in front of them. If they
// disagree, a user is offered one story and gets another.
//
// Ported here, byte-for-byte in behaviour:
//
//   normalizeTitle      dedup_scorer.normalize_title
//   lyricWords          dedup_scorer.lyric_words
//   extractLyrics       dedup_works.extract_lyrics_from_chordpro
//   hasChords           dedup_scorer.has_chords
//   containment         dedup_scorer.containment      <- the metric
//   scorePair           dedup_scorer.score_pair       <- the outcome table
//   ratio               difflib.SequenceMatcher.ratio <- titles only
//
// NOT ported (and not needed here):
//
// * The works/ corpus walk. The browser already holds the index; candidate
//   narrowing runs over `allSongs` instead of a title index built from disk.
// * Multi-part works. `Chart.from_work_dir` unions the lyrics of EVERY
//   chordpro part; the browser sees one lead sheet per work, so a work whose
//   alternate arrangement carries extra verses scores slightly lower here.
//   That direction is safe — it can only under-report a match, and the CI
//   backstop reads the full work.
// * `difflib`'s autojunk heuristic, which only engages on sequences of 200+
//   characters. Titles are far shorter, so the ratio is exact for every
//   input this module sees.

// --------------------------------------------------------------------------
// Thresholds — mirror scripts/lib/dedup_scorer.py
// --------------------------------------------------------------------------

/** Containment at or above this means "same song". Below it, no match. */
export const CONTAINMENT_MATCH = 0.65;
/** Containment at or above this means the word sets are all but identical. */
export const CONTAINMENT_DUPLICATE = 0.85;
/** Size ratio at or above which two charts count as comparably rich. */
export const SIMILAR_RICHNESS_RATIO = 0.80;
/** Fewer distinct lyric words than this means "no usable lyrics". */
export const MIN_LYRIC_WORDS = 12;
/** Usable but thin lyrics get a warning, not a threshold change. */
export const THIN_LYRIC_WORDS = 25;
/** Title similarity required to keep a work as a candidate worth reading. */
export const TITLE_NARROW_MIN = 0.60;
/** Cheap blocking filter before the similarity pass. */
export const TITLE_TOKEN_OVERLAP_MIN = 0.5;
/** Title similarity required when neither side has usable lyrics. */
export const TITLE_ONLY_MIN = 0.95;

/** How many title-narrowed candidates are worth a content fetch. */
export const MAX_CANDIDATES = 5;

export const Outcome = {
    ENRICH: 'enrich',
    DUPLICATE: 'duplicate',
    ARRANGEMENT_CANDIDATE: 'arrangement-candidate',
    NO_MATCH: 'no-match',
};

export const Warning = {
    NO_LYRICS: 'no-lyrics-both-sides',
    NO_LYRICS_ONE_SIDE: 'no-lyrics-one-side',
    THIN_LYRICS: 'thin-lyrics',
    TITLE_ONLY: 'matched-on-title-only',
};

// --------------------------------------------------------------------------
// Normalization
// --------------------------------------------------------------------------

/** NFKD then drop everything non-ASCII — Python's encode('ascii', 'ignore'). */
function toAscii(text) {
    return String(text).normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
}

/** Normalize a title for comparison (lowercase words, no articles). */
export function normalizeTitle(title) {
    if (!title) return '';
    let text = toAscii(title).toLowerCase();
    text = text.replace(/\s*\([^)]*\)\s*$/, '');       // (Live), (Banjo Break)
    text = text.replace(/\s*lyrics\s+and\s+chords\s*$/, '');
    text = text.replace(/\b(the|a|an)\b/g, ' ');
    text = text.replace(/\bst\b/g, 'saint');
    text = text.replace(/\bmt\b/g, 'mount');
    text = text.replace(/[^a-z0-9\s]/g, '');
    return text.split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Normalized word set for plain lyrics (already chord/directive-free).
 * Order-independent by construction: the #208 pair orders chorus and verse
 * differently, which is exactly what defeated the old scorer.
 */
export function lyricWords(text) {
    if (!text) return new Set();
    const normalized = toAscii(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    return new Set(normalized.split(/\s+/).filter(Boolean));
}

/** Plain lyrics out of ChordPro: no directives, no chords, no ABC, no comments. */
export function extractLyrics(content) {
    const out = [];
    let inAbc = false;
    for (const line of String(content || '').split('\n')) {
        const stripped = line.trim();
        if (stripped.startsWith('#')) continue;
        if (stripped.startsWith('{start_of_abc')) { inAbc = true; continue; }
        if (stripped.startsWith('{end_of_abc')) { inAbc = false; continue; }
        if (inAbc) continue;
        if (stripped.startsWith('{')) continue;
        const clean = line.replace(/\[[^\]]+\]/g, '').trim();
        if (clean) out.push(clean);
    }
    return out.join('\n');
}

/** Normalized lyric word set straight from ChordPro source. */
export function chordproLyricWords(content) {
    return lyricWords(extractLyrics(content));
}

const CHORD_TOKEN_RE = /^[A-G][#b]?[^\s\]]*$/;

/**
 * True if the ChordPro source carries actual chord markers. Bracket contents
 * are checked so `[Verse 1]` and `[x2]` do not read as chords.
 */
export function hasChords(content) {
    for (const line of String(content || '').split('\n')) {
        if (line.trim().startsWith('{')) continue;
        for (const token of line.match(/\[[^\]]*\]/g) || []) {
            const inner = token.slice(1, -1).trim();
            if (inner && CHORD_TOKEN_RE.test(inner)) return true;
        }
    }
    return false;
}

/** Pull the title out of ChordPro metadata, if present. */
export function chordproTitle(content) {
    const text = String(content || '');
    for (const pattern of [/\{meta:\s*title\s+([^}]+)\}/i, /\{(?:title|t):\s*([^}]+)\}/i]) {
        const match = text.match(pattern);
        if (match) return match[1].trim();
    }
    return '';
}

// --------------------------------------------------------------------------
// Metrics
// --------------------------------------------------------------------------

/** |A ∩ B| / |smaller side| — the primary metric. Containment, not Jaccard. */
export function containment(a, b) {
    if (!a?.size || !b?.size) return 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let shared = 0;
    for (const word of small) if (large.has(word)) shared++;
    return shared / small.size;
}

/** |A ∩ B| / |A ∪ B| — reported for context, never used to decide. */
export function jaccard(a, b) {
    if (!a?.size || !b?.size) return 0;
    let shared = 0;
    for (const word of a) if (b.has(word)) shared++;
    return shared / (a.size + b.size - shared);
}

// -- difflib.SequenceMatcher.ratio, for titles only ------------------------

function findLongestMatch(a, b, b2j, alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
        const newj2len = new Map();
        for (const j of b2j.get(a[i]) || []) {
            if (j < blo) continue;
            if (j >= bhi) break;
            const k = (j2len.get(j - 1) || 0) + 1;
            newj2len.set(j, k);
            if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
        j2len = newj2len;
    }
    return [besti, bestj, bestsize];
}

/** difflib's similarity ratio: 2 * matched characters / total length. */
export function ratio(a, b) {
    const total = a.length + b.length;
    if (!total) return 1;

    const b2j = new Map();
    for (let j = 0; j < b.length; j++) {
        if (!b2j.has(b[j])) b2j.set(b[j], []);
        b2j.get(b[j]).push(j);
    }

    let matched = 0;
    const queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
        const [alo, ahi, blo, bhi] = queue.pop();
        const [i, j, k] = findLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
        if (!k) continue;
        matched += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
    return (2 * matched) / total;
}

/** Similarity of two *raw* titles, 0-1, after normalization. */
export function titleSimilarity(a, b) {
    const na = normalizeTitle(a);
    const nb = normalizeTitle(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    return ratio(na, nb);
}

// --------------------------------------------------------------------------
// Charts and scoring
// --------------------------------------------------------------------------

/** One side of a comparison: a title, a lyric word set, chord presence. */
export function makeChart(content, { title = '', id = null } = {}) {
    return {
        id,
        title: title || chordproTitle(content),
        words: chordproLyricWords(content),
        chords: hasChords(content),
    };
}

function hasUsableLyrics(chart) {
    return chart.words.size >= MIN_LYRIC_WORDS;
}

/**
 * Score one incoming chart against one existing work.
 *
 * Lyrics decide the match; chord presence decides the outcome. With lyrics
 * unusable on either side the verdict is explicitly low-confidence and needs
 * a near-exact title before a candidate is even named — that path is where
 * instrumentals live, and it is never auto-actionable.
 */
export function scorePair(incoming, existing) {
    const warnings = [];
    const tsim = titleSimilarity(incoming.title, existing.title);
    const details = {
        incomingWords: incoming.words.size,
        existingWords: existing.words.size,
        incomingHasChords: incoming.chords,
        existingHasChords: existing.chords,
    };

    if (!hasUsableLyrics(incoming) || !hasUsableLyrics(existing)) {
        const bothMissing = !hasUsableLyrics(incoming) && !hasUsableLyrics(existing);
        warnings.push(bothMissing ? Warning.NO_LYRICS : Warning.NO_LYRICS_ONE_SIDE);
        details.lyricsDecided = false;
        if (tsim >= TITLE_ONLY_MIN) {
            warnings.push(Warning.TITLE_ONLY);
            return {
                score: 0,
                matchedId: existing.id,
                outcome: Outcome.ARRANGEMENT_CANDIDATE,
                titleSimilarity: tsim,
                lowConfidence: true,
                autoActionable: false,
                warnings,
                details,
            };
        }
        return {
            score: 0,
            matchedId: null,
            outcome: Outcome.NO_MATCH,
            titleSimilarity: tsim,
            lowConfidence: true,
            autoActionable: false,
            warnings,
            details,
        };
    }

    const score = containment(incoming.words, existing.words);
    const sizes = [incoming.words.size, existing.words.size];
    const sizeRatio = Math.min(...sizes) / Math.max(...sizes);
    details.lyricsDecided = true;
    details.jaccard = round4(jaccard(incoming.words, existing.words));
    details.sizeRatio = round4(sizeRatio);

    if (Math.min(...sizes) < THIN_LYRIC_WORDS) warnings.push(Warning.THIN_LYRICS);

    if (score < CONTAINMENT_MATCH) {
        return {
            score: round4(score), matchedId: null, outcome: Outcome.NO_MATCH,
            titleSimilarity: tsim, lowConfidence: false, autoActionable: false,
            warnings, details,
        };
    }

    // Same song. Chord presence — not chord content — picks the offer.
    let outcome;
    if (incoming.chords && !existing.chords) {
        outcome = Outcome.ENRICH;
    } else if (existing.chords && !incoming.chords) {
        outcome = Outcome.DUPLICATE;
    } else if (score >= CONTAINMENT_DUPLICATE && sizeRatio >= SIMILAR_RICHNESS_RATIO) {
        outcome = Outcome.DUPLICATE;
    } else {
        outcome = Outcome.ARRANGEMENT_CANDIDATE;
    }

    const autoActionable = outcome === Outcome.ENRICH
        && score >= CONTAINMENT_DUPLICATE
        && !warnings.includes(Warning.THIN_LYRICS);

    return {
        score: round4(score), matchedId: existing.id, outcome, titleSimilarity: tsim,
        lowConfidence: false, autoActionable, warnings, details,
    };
}

/** Python stores `round(score, 4)` on the verdict while comparing the raw
 *  value against the thresholds. Mirror both halves, or the two sides
 *  disagree on a score sitting exactly on a threshold. */
function round4(value) {
    return Math.round(value * 1e4) / 1e4;
}

/** Sort key for picking the best of several verdicts (best last). */
function verdictRank(v) {
    return [
        v.outcome === Outcome.NO_MATCH ? 0 : 1,
        v.lowConfidence ? 0 : 1,
        v.score,
        v.titleSimilarity,
    ];
}

/** True when `a` strictly outranks `b`. Ties keep the incumbent, as the
 *  Python side's stable sort does. */
function outranks(a, b) {
    const ra = verdictRank(a);
    const rb = verdictRank(b);
    for (let i = 0; i < ra.length; i++) {
        if (ra[i] !== rb[i]) return ra[i] > rb[i];
    }
    return false;
}

// --------------------------------------------------------------------------
// Candidate narrowing: title narrows, lyrics decide
// --------------------------------------------------------------------------

/**
 * Works whose titles are close enough to be worth a content fetch.
 *
 * Mirrors `WorkCorpus.candidates`: a token-overlap blocking pass, then the
 * ratio ranks what survives. Returns `[{ song, titleSimilarity }]`, best
 * first — never more than `limit`, because each one costs a network round
 * trip and the user is waiting on a submit button.
 */
export function narrowCandidates(title, songs, { limit = MAX_CANDIDATES, exclude = null } = {}) {
    const norm = normalizeTitle(title);
    if (!norm) return [];
    const tokens = new Set(norm.split(' '));

    const scored = [];
    for (const song of songs || []) {
        if (!song?.id || exclude?.has(song.id)) continue;
        const other = normalizeTitle(song.title || '');
        if (!other) continue;

        const otherTokens = other.split(' ');
        const otherSet = new Set(otherTokens);
        let shared = 0;
        for (const token of tokens) if (otherSet.has(token)) shared++;
        if (shared / Math.min(tokens.size, otherTokens.length) < TITLE_TOKEN_OVERLAP_MIN) continue;

        const sim = other === norm ? 1 : ratio(norm, other);
        if (sim >= TITLE_NARROW_MIN) scored.push({ song, titleSimilarity: sim });
    }

    scored.sort((a, b) => (b.titleSimilarity - a.titleSimilarity)
        || String(a.song.id).localeCompare(String(b.song.id)));
    return scored.slice(0, limit);
}

/**
 * Is this verdict worth interrupting a submission for?
 *
 * Only when lyrics decided it. A low-confidence, title-only "match" is the
 * Blackberry Blossom case — two different fiddle tunes with one name — and
 * stopping someone to say "this looks like Blackberry Blossom, 0% of the
 * lyrics match" is friction that buys nothing.
 */
export function shouldOffer(verdict) {
    return !!verdict
        && verdict.outcome !== Outcome.NO_MATCH
        && !verdict.lowConfidence;
}

/**
 * The best match in the corpus for a chart about to be submitted, or null.
 *
 * `fetchContent(song)` supplies the ChordPro for a candidate — in the app
 * that is `getSongContent` from song-content.js. A candidate whose content
 * cannot be fetched is skipped, never fatal: failing to warn about a
 * duplicate is a worse outcome than a blocked submission, but only slightly,
 * and the CI backstop still catches it.
 */
export async function findLikelyMatch({ title, content, songs, fetchContent, limit = MAX_CANDIDATES, exclude = null }) {
    const incoming = makeChart(content, { title });
    const candidates = narrowCandidates(title, songs, { limit, exclude });
    if (!candidates.length) return null;

    let best = null;
    for (const { song } of candidates) {
        let text;
        try {
            text = await fetchContent(song);
        } catch {
            continue;
        }
        if (!text) continue;
        const verdict = scorePair(
            incoming, makeChart(text, { title: song.title || '', id: song.id }));
        if (verdict.outcome === Outcome.NO_MATCH) continue;
        if (!best || outranks(verdict, best.verdict)) best = { song, verdict };
    }

    return best && shouldOffer(best.verdict) ? best : null;
}

// --------------------------------------------------------------------------
// The offer: what the user is allowed to choose, and what each choice does
// --------------------------------------------------------------------------

export const Choice = {
    /** Add this chart to the matched work. Server picks update vs fork. */
    ENRICH: 'enrich',
    /** Same retarget, said differently: "this is my arrangement of it". */
    ARRANGEMENT: 'arrangement',
    /** Go look at the match before deciding. Nothing is submitted. */
    VIEW: 'view',
    /** Put the archived match back in search, then add to it. */
    PROMOTE: 'promote',
    /** The user overrides: it really is a different song. */
    NEW: 'new',
};

/**
 * The buttons to offer for one match.
 *
 * Every entry maps to a mechanism that already exists — nothing here is a
 * promise the pipeline can't keep. `Promote` appears only when the match is
 * actually archived AND the user can actually promote it; offering a button
 * that 403s is worse than not offering it.
 */
export function offrampChoices(match, { trusted = false } = {}) {
    const { song, verdict } = match || {};
    if (!song) return [];

    const title = song.title || 'that song';
    const archived = song.indexed === false;
    const choices = [];

    if (verdict?.outcome === Outcome.ENRICH) {
        choices.push({
            id: Choice.ENRICH,
            label: `Add my chords to "${title}"`,
            detail: 'That version has the words but no chords. Yours fills them in.',
            primary: true,
        });
    } else {
        choices.push({
            id: Choice.ENRICH,
            label: `Add this to "${title}"`,
            detail: 'Lands on the existing song instead of making a second copy.',
            primary: true,
        });
    }

    choices.push({
        id: Choice.ARRANGEMENT,
        label: "It's my own version",
        detail: `Saved as your arrangement of "${title}". The original is untouched.`,
    });

    if (archived && trusted) {
        choices.push({
            id: Choice.PROMOTE,
            label: 'Put it back in search, then add to it',
            detail: `"${title}" is archived. Promoting makes it searchable again for everyone.`,
        });
    }

    choices.push({ id: Choice.VIEW, label: 'Let me look at it first', detail: '' });

    // Always available. The user is allowed to be right about their own song.
    choices.push({
        id: Choice.NEW,
        label: "It's a different song",
        detail: 'Submits as a new song, as you wrote it.',
    });

    return choices;
}

/**
 * What a choice actually does to the submission.
 *
 * Pure: the caller performs the effects. `retargetId` set means the pending
 * row is written against the matched work instead of a fresh slug, which is
 * what makes the server classify it (update if they own content there, fork
 * to an arrangement otherwise) rather than mint a duplicate.
 */
export function planForChoice(choiceId, match) {
    const matchedId = match?.song?.id || null;
    switch (choiceId) {
        case Choice.ENRICH:
            return { submit: true, retargetId: matchedId, intent: Choice.ENRICH, promoteFirst: false, navigateTo: null };
        case Choice.ARRANGEMENT:
            return { submit: true, retargetId: matchedId, intent: Choice.ARRANGEMENT, promoteFirst: false, navigateTo: null };
        case Choice.PROMOTE:
            return { submit: true, retargetId: matchedId, intent: Choice.PROMOTE, promoteFirst: true, navigateTo: null };
        case Choice.VIEW:
            return { submit: false, retargetId: null, intent: Choice.VIEW, promoteFirst: false, navigateTo: `#work/${matchedId}` };
        case Choice.NEW:
        default:
            return { submit: true, retargetId: null, intent: Choice.NEW, promoteFirst: false, navigateTo: null };
    }
}

/** "87% of its lyrics match" — the one number the modal shows. */
export function matchPercent(verdict) {
    return Math.round((verdict?.score || 0) * 100);
}
