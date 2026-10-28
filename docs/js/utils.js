// Utility functions for Bluegrass Songbook

import { songHasContent } from './song-content.js';
import { persistReturnRecord } from './auth-return.js';

// ============================================
// ESCAPING — two functions, two jobs.
//
//   escapeHtml  →  TEXT position:      <span>${escapeHtml(x)}</span>
//   escapeAttr  →  ATTRIBUTE position: <span title="${escapeAttr(x)}">
//   safeUrl     →  URL position:       <a href="${safeUrl(x)}">
//
// Reach for the wrong one and you get an XSS hole that looks escaped.
// ============================================

/**
 * Escape a string for a TEXT NODE. NOT for attributes — see escapeAttr.
 *
 * This is a textContent → innerHTML round trip, so it escapes exactly what
 * the HTML serializer escapes in character data: `&`, `<`, `>` (and nbsp).
 * It deliberately does NOT touch `"` or `'`, because quotes are ordinary
 * characters inside a text node.
 *
 * That makes it UNSAFE in `attr="${...}"`: a value of
 *     x" onfocus="alert(1)" autofocus="
 * survives escapeHtml unchanged, closes the attribute, and adds an event
 * handler. If the hole you are filling sits between quote marks, you want
 * escapeAttr — even when the value "can't" contain a quote today.
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Escape a string for use inside a QUOTED HTML attribute.
 *
 * escapeHtml plus both quote characters, so the value cannot terminate the
 * attribute under either quoting style. Use this for every `="${...}"` hole:
 * data-* attributes, `title`, `alt`, `value`, `id`, `class`.
 *
 * Not sufficient on its own for URL-valued attributes (`href`, `src`,
 * `action`, `<object data>`) — escaping cannot stop `javascript:` or
 * `data:text/html`. Run those through safeUrl first.
 */
export function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Scheme-check a URL, then escape it for an attribute.
 *
 * Returns '' for anything that is not http(s), a same-document fragment, or
 * a site-relative path — so `javascript:alert(1)`, `data:text/html,…` and
 * `vbscript:` never reach an href. Callers should treat '' as "no link" and
 * render plain text instead of an anchor with an empty target.
 *
 * Scheme detection deliberately works on the raw string with whitespace and
 * control characters stripped, because the HTML parser ignores those inside
 * a URL: `java\nscript:alert(1)` and `  javascript:alert(1)` both navigate.
 */
export function safeUrl(url) {
    const raw = String(url ?? '');
    // Strip characters the URL parser ignores before looking for a scheme.
    const probe = raw.replace(/[\s\u0000-\u001F\u007F]/g, '').toLowerCase();
    const scheme = probe.match(/^([a-z][a-z0-9+.-]*):/);
    if (scheme && scheme[1] !== 'http' && scheme[1] !== 'https') return '';
    // Protocol-relative and rooted/relative paths are fine; so is a bare
    // fragment. Anything else with no scheme is a relative path — also fine.
    return escapeAttr(raw.trim());
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "1 song", "2,468 songs". */
export function songCount(n) {
    return `${n.toLocaleString()} ${n === 1 ? 'song' : 'songs'}`;
}

/**
 * Highlight search term matches in text
 *
 * Marks words, not fragments: a term marks a word it starts, and a term of
 * one or two letters ("I", "a", "on") only a whole word. Search itself
 * matches substrings, so without this a query holding "I" or "ten" lit up
 * letters inside unrelated words ("Wr[i]t[ten]", "M[i]tchell").
 *
 * Finds all matches first, then builds result in a single pass to avoid
 * corrupting <mark> tags when a search term contains 'm', 'a', 'r', or 'k'.
 */
export function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);

    const terms = query.toLowerCase().split(/\s+/).filter(t => t);
    if (terms.length === 0) return escapeHtml(text);

    // Find all match positions in the original text
    const matches = [];
    terms.forEach(term => {
        const end = term.length <= 2 ? '(?![\\p{L}\\p{N}])' : '';
        const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}${end}`, 'giu');
        let match;
        while ((match = regex.exec(text)) !== null) {
            matches.push({
                start: match.index,
                end: match.index + match[0].length
            });
        }
    });

    if (matches.length === 0) return escapeHtml(text);

    // Sort by start position, then by length (longer matches first for ties)
    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    // Merge overlapping ranges
    const merged = [];
    for (const m of matches) {
        if (merged.length === 0 || m.start > merged[merged.length - 1].end) {
            merged.push({ start: m.start, end: m.end });
        } else {
            // Extend the last range if needed
            merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, m.end);
        }
    }

    // Build result with escaping and highlights in one pass
    let result = '';
    let pos = 0;
    for (const m of merged) {
        // Add escaped text before this match
        if (pos < m.start) {
            result += escapeHtml(text.slice(pos, m.start));
        }
        // Add highlighted match (escaped inside the mark tag)
        result += '<mark>' + escapeHtml(text.slice(m.start, m.end)) + '</mark>';
        pos = m.end;
    }
    // Add remaining text after last match
    if (pos < text.length) {
        result += escapeHtml(text.slice(pos));
    }

    return result;
}

/**
 * Download a file with the given content
 */
export function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Generate a local unique ID
 */
export function generateLocalId() {
    return 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Check if a song is a tablature-only work (no lead sheet content)
 * Used to determine routing between openSong() and openWork()
 */
export function isTabOnlyWork(song) {
    return song?.tablature_parts?.length > 0 && !songHasContent(song);
}

/**
 * "banjo" -> "Banjo Tab", "tenor-banjo" -> "Tenor Banjo Tab".
 *
 * Lives here (not in work-view.js, which owns the page) because the part
 * label is also the part's URL slug — `slugify(tabLabel(instrument))` is
 * the `#work/{id}/{partId}` segment — and the contribution entry points
 * need to name and link a tab without importing the whole song page.
 */
export function tabLabel(instrument) {
    if (!instrument) return 'Tab';
    const pretty = String(instrument).split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${pretty} Tab`;
}

/**
 * Whether the page-level song actions (the header ✏️ Edit button) apply
 * to the given part. They edit chordpro lead sheets; on a tablature part
 * they would open an empty song editor, so views hide them — tab parts
 * carry their own Edit in the tab controls row.
 */
export function partUsesSongActions(part) {
    return part?.type !== 'tablature';
}

/**
 * Check if a song is a placeholder (no content yet)
 */
export function isPlaceholder(song) {
    return song?.status === 'placeholder';
}

/**
 * Every uuid the index row records as having submitted something ON this work.
 *
 * The published fields, and where the build puts them
 * (`scripts/lib/build_works_index.py`):
 *
 *   song.submitted_by            the PRIMARY lead sheet's submitter
 *   arrangements[].submitted_by  each forked lead sheet's submitter
 *   document_parts[].submitted_by  a document part's submitter
 *   tablature_parts[].submitted_by a tab part's submitter — see the caveat
 *   song.created_by              the pending overlay's own author (a row the
 *                                browser is holding before any build ran)
 *
 * CAVEAT, and it is the interesting one: `build_works_index` does NOT publish
 * `submitted_by` on `tablature_parts` today. The uuid IS in
 * `works/<id>/work.yaml` (`parts[].provenance.submitted_by` — that is what
 * `process_pending.owns_content` and the edge function's `tabPartOwners` both
 * read), but the row shape drops it, keeping only `author` (a DISPLAY NAME:
 * 'schlange', 'Mike Beaumier'), which is not comparable to `auth.uid()`. So a
 * tab submitter loses this client-side signal the moment their work is
 * published — until the index publishes the field, which is why it is read
 * here rather than worked around. The server is authoritative either way: it
 * reads work.yaml and answers 403.
 */
export function workSubmitters(song) {
    const ids = new Set();
    const add = (id) => { if (typeof id === 'string' && id) ids.add(id); };
    add(song?.submitted_by);
    add(song?.created_by);
    for (const a of song?.arrangements || []) add(a.submitted_by);
    for (const p of song?.tablature_parts || []) add(p.submitted_by);
    for (const d of song?.document_parts || []) add(d.submitted_by);
    return ids;
}

/** Does `userId` own at least one part of this work, as far as the row shows? */
export function ownsPartOfWork(song, userId) {
    return !!userId && workSubmitters(song).has(userId);
}

/**
 * May this viewer edit the work's metadata (title / artist / key / notes)?
 *
 * Mike's rule: own a part of the work, or be trusted. This is the AFFORDANCE
 * gate only — a hint, computed from what the index row happens to carry. The
 * decision is the server's (`auto-commit-song` reads `work.yaml` and refuses
 * with 403), so this errs toward showing the button and surfacing a refusal
 * rather than silently hiding an edit the server would have allowed.
 */
export function canEditWorkMetadata(song, { userId = null, trusted = false } = {}) {
    if (!song || !userId) return false;
    return !!trusted || ownsPartOfWork(song, userId);
}

/**
 * Check if a work has multiple viewable parts (lead sheet + tab, etc.)
 * Used to decide whether to show the dashboard or go straight to content.
 */
export function hasMultipleParts(song) {
    let count = 0;
    if (songHasContent(song)) count++;
    count += song?.tablature_parts?.length || 0;
    count += song?.document_parts?.length || 0;
    return count > 1;
}

/**
 * Gate contribution actions behind login.
 * If not logged in, triggers Google sign-in and returns false.
 * Usage: if (!requireLogin('add songs')) return;
 *
 * Sign-in is a full-page redirect, so this leaves a return record first
 * (the route, plus whatever the open editor registered — see auth-return.js);
 * main.js uses it to put the user back where they were.
 */
export function requireLogin(actionDescription) {
    if (window.SupabaseAuth?.isLoggedIn?.()) return true;
    persistReturnRecord();
    window.SupabaseAuth?.signInWithGoogle?.();
    return false;
}

/**
 * Build the candidate rows for the admin delete modal.
 * Deleting by currentSong.id alone is a trap: the viewed song is the group's
 * *representative*, which may not be the copy the admin means to remove. So
 * the modal must list every member of the group and let the admin choose.
 */
export function buildDeleteCandidates(song, songGroups) {
    if (!song) return [];
    const members = (song.group_id && songGroups?.[song.group_id]?.length)
        ? songGroups[song.group_id]
        : [song];
    return members.map(member => ({
        id: member.id,
        title: member.title || member.id,
        source: member.source || 'unknown',
        key: member.key || null,
        chordCount: member.chord_count || 0,
        firstLine: member.first_line || '',
        isCurrent: member.id === song.id,
    }));
}

/**
 * Generate a URL-friendly slug from title and artist.
 *
 * The slug becomes a `pending_songs.id` and then a DIRECTORY NAME inside
 * `works/`, so it has to satisfy the shape every writer agrees on:
 * `^[a-z0-9]+(-[a-z0-9]+)*$` (`work_schema.slugify`,
 * `process_pending.SLUG_RE`, `pending-dispatch.WORK_SLUG_RE`).
 *
 * TRIM AFTER THE TRUNCATION, never before. It used to be the other way
 * round, so an 80-character cut that happened to land just after a dash
 * emitted `some-long-title-` — a trailing dash the trim had already run past.
 * Nothing else in the repo mints an id like that, and the server now refuses
 * one rather than creating `works/some-long-title-/`.
 */
export function generateSlug(title, artist) {
    const base = artist
        ? `${title}-${artist}`
        : title;
    return base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 80)
        .replace(/^-+|-+$/g, '');
}

/**
 * mailto: for a rights holder's copyright concern about one song (G3). Goes
 * to hello@bluegrassbook.com with the song named and both of its URLs (the
 * static page Google indexes, and the app page), so the request needs no
 * account and no form.
 */
export function copyrightMailto(song) {
    const id = encodeURIComponent(String(song.id));
    const body = [
        `Song: ${song.title || song.id}`,
        `https://bluegrassbook.com/songs/${id}/`,
        `https://bluegrassbook.com/#work/${id}`,
        '',
        'What is the concern, and what would you like done?',
    ].join('\n');
    return 'mailto:hello@bluegrassbook.com'
        + `?subject=${encodeURIComponent(`Copyright concern: ${song.title || song.id}`)}`
        + `&body=${encodeURIComponent(body)}`;
}

/**
 * Parse a list item reference into workId and optional partId.
 * References are either "work-slug" (whole work) or "work-slug/part-slug" (specific part).
 */
export function parseItemRef(ref) {
    const slash = ref.indexOf('/');
    if (slash === -1) return { workId: ref, partId: null };
    return { workId: ref.slice(0, slash), partId: ref.slice(slash + 1) };
}

/**
 * Slugify a string for use as a part ID in URLs.
 */
export function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Song credits (F9). `artist` is whichever performer page a chart was scraped
// from, not whose version it is, so it is never shown — it stays in the data
// and in search (Mike, 2026-10-26: "too noisy of a label"). The writer is the
// credit; the MusicBrainz-backed covering artists are shown where someone
// looks for them (Info pill, a search that names them, the static footer).
// Mirrors _writer / associated_artists in scripts/lib/build_song_pages.py.

function isTraditional(name) {
    return String(name || '').trim().toLowerCase() === 'traditional';
}

/** Who wrote it: `composer`, else "Traditional" when that is all the artist
 *  field says; '' when unknown — no guessing. */
export function songWriter(song) {
    const composer = String(song?.composer || '').trim();
    if (composer) return composer;
    return isTraditional(song?.artist) ? 'Traditional' : '';
}

/** "Written by X", "Traditional", or ''. */
export function writtenByLabel(writer) {
    if (!writer) return '';
    return isTraditional(writer) ? 'Traditional' : `Written by ${writer}`;
}

/** The song's "Recorded by" list: [{ name, year }] from covering_artists and
 *  its parallel covering_years (year null when unknown), in index order —
 *  first recording year first — once each, never "Traditional". Never the
 *  scraped `artist` unless the build confirmed it against MusicBrainz. A
 *  credit for recording the SONG, not a label on any chart. */
export function recordedBy(song) {
    const years = song?.covering_years || [];
    const out = [];
    const seen = new Set();
    (song?.covering_artists || []).forEach((raw, i) => {
        const name = String(raw || '').trim();
        const key = name.toLowerCase();
        if (!name || isTraditional(name) || seen.has(key)) return;
        seen.add(key);
        out.push({ name, year: years[i] || null });
    });
    return out;
}

/** Just the names of recordedBy(). */
export function associatedArtists(song) {
    return recordedBy(song).map(r => r.name);
}

/** "Bill Monroe (1947)", or just the name when the year is unknown. */
export function recorderLabel({ name, year }) {
    return year ? `${name} (${year})` : name;
}

/** YouTube search for one recording: "Song Title Bill Monroe 1947". */
export function recordingSearchUrl(title, { name, year }) {
    const q = [title, name, year].filter(Boolean).join(' ');
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(q).replace(/%20/g, '+')}`;
}

/** The associated artists a parsed search asked for: an `artist:` filter, or
 *  free text whose every term is in that one name. */
export function matchedArtists(song, { textTerms = [], artistFilter = null } = {}) {
    const terms = textTerms.map(t => String(t).toLowerCase()).filter(Boolean);
    const filter = String(artistFilter || '').toLowerCase();
    if (!filter && terms.length === 0) return [];
    return associatedArtists(song).filter(name => {
        const n = name.toLowerCase();
        return (filter && n.includes(filter))
            || (terms.length > 0 && terms.every(t => n.includes(t)));
    });
}
