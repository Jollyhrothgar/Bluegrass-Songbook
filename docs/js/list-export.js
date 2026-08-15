// Exporting a whole list as one file.
//
// A list export has to survive leaving this app — the point is to open it in
// someone else's ChordPro reader. Two things follow from that:
//
// 1. Songs are separated by {new_song}, the standard multi-song directive
//    (chordpro.org/chordpro/directives-new_song). It is implied at the start
//    of a file, so it goes BETWEEN songs, not before the first one.
//
// 2. Our corpus writes metadata as {meta: title ...}. That is semantically
//    valid, but the spec is explicit that "many external tools will only
//    recognize the {title: ...} directive". In a single-song file an
//    unrecognised title is cosmetic; in a 40-song file the titles are the only
//    way to navigate it, so we rewrite the standard names to their standalone
//    directive form on the way out.

/**
 * Metadata names that ChordPro defines a standalone directive for.
 * Anything else (our x_source, x_version_label, ...) is left as {meta: ...},
 * which is exactly what that form is for.
 */
const STANDARD_META = new Set([
    'title', 'sorttitle', 'subtitle', 'artist', 'composer', 'lyricist',
    'arranger', 'copyright', 'album', 'year', 'key', 'time', 'tempo',
    'duration', 'capo',
]);

/** Rewrite {meta: NAME VALUE} to {NAME: VALUE} for the standard names only. */
export function normalizeChordProMeta(content) {
    return (content || '').replace(
        /\{meta:\s*([A-Za-z_][A-Za-z0-9_]*)\s+([^}]*)\}/g,
        (whole, name, value) => STANDARD_META.has(name.toLowerCase())
            ? `{${name.toLowerCase()}: ${value.trim()}}`
            : whole
    );
}

/** Strip chords and directives, leaving the bare lyric text. */
export function stripToPlainText(content) {
    return (content || '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * One ChordPro document containing every song in the list.
 * `contents[i]` is the raw ChordPro for `songs[i]`; missing entries are skipped
 * rather than emitted as an empty song.
 */
export function buildListChordPro(songs, contents = []) {
    const bodies = songs
        .map((song, i) => {
            const raw = (contents[i] || song.content || '').trim();
            if (!raw) return null;
            let body = normalizeChordProMeta(raw);
            // A reader that only understands {title:} still needs one, even if
            // the source had no title metadata at all.
            if (!/^\{title:/m.test(body) && song.title) {
                body = `{title: ${song.title}}\n${body}`;
            }
            return body;
        })
        .filter(Boolean);

    // {new_song} is implied at the start of a file, so it only goes between.
    return bodies.join('\n\n{new_song}\n\n') + '\n';
}

/** Human-readable text version: a titled header per song, lyrics only. */
export function buildListText(songs, contents = []) {
    const blocks = songs
        .map((song, i) => {
            const lyrics = stripToPlainText(contents[i] || song.content || '');
            if (!lyrics) return null;
            const title = song.title || 'Untitled';
            const head = song.artist ? `${title}\n${song.artist}` : title;
            return `${head}\n${'='.repeat(Math.max(title.length, 3))}\n\n${lyrics}`;
        })
        .filter(Boolean);

    return blocks.join('\n\n\n' + '-'.repeat(40) + '\n\n\n') + '\n';
}

/** Filename stem for a list, safe across filesystems. */
export function listFileBase(listName) {
    const cleaned = (listName || '')
        .replace(/[\/\\:*?"<>|]/g, '')   // characters filesystems reject
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
        .trim();
    return cleaned || 'songbook-list';
}
