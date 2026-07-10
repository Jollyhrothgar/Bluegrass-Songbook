// Smart paste: detect and convert chord sheets (chords-over-lyrics, ChordU,
// Ultimate Guitar) into ChordPro. Extracted verbatim from editor.js so the
// Raw editor and the Visual editor share one battle-tested implementation.
// editor.js re-exports these, so its public API is unchanged.

/**
 * Check if a line is a chord line
 */
function editorIsChordLine(line) {
    if (!line.trim()) return false;
    const words = line.trim().split(/\s+/);
    if (words.length === 0) return false;
    const chordPattern = /^[A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?$/;
    const chordCount = words.filter(w => chordPattern.test(w)).length;
    return chordCount / words.length > 0.5;
}

/**
 * Check if a line is a section marker
 */
function editorIsSectionMarker(line) {
    return /^\[.+\]$/.test(line.trim());
}

/**
 * Check if a line is an instrumental line
 */
function editorIsInstrumentalLine(line) {
    return /^[—\-]?[A-G][#b]?---/.test(line.trim());
}

/**
 * Extract chords with their positions from a chord line
 */
function editorExtractChordsWithPositions(chordLine) {
    const chords = [];
    const pattern = /([A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?)/g;
    let match;
    while ((match = pattern.exec(chordLine)) !== null) {
        chords.push({ chord: match[1], position: match.index });
    }
    return chords;
}

/**
 * Align chords to lyrics based on position
 */
function editorAlignChordsToLyrics(chordLine, lyricLine, chordPositions) {
    if (!chordPositions.length) return lyricLine;
    const sorted = [...chordPositions].sort((a, b) => b.position - a.position);
    let result = lyricLine;
    for (const { chord, position } of sorted) {
        let lyricPos = Math.min(position, result.length);
        result = result.slice(0, lyricPos) + `[${chord}]` + result.slice(lyricPos);
    }
    return result;
}

/**
 * Convert chord sheet format to ChordPro
 */
export function editorConvertToChordPro(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            result.push('');
            i++;
            continue;
        }

        if (editorIsSectionMarker(trimmed)) {
            const sectionName = trimmed.slice(1, -1).trim();
            const lowerName = sectionName.toLowerCase();
            if (lowerName.includes('chorus')) {
                result.push('{soc}');
            } else if (lowerName.includes('verse')) {
                result.push(`{sov: ${sectionName}}`);
            } else if (lowerName.includes('instrumental') || lowerName.includes('break')) {
                result.push(`{comment: ${sectionName}}`);
            } else if (lowerName.includes('bridge')) {
                result.push('{sob}');
            } else {
                result.push(`{comment: ${sectionName}}`);
            }
            i++;
            continue;
        }

        if (editorIsInstrumentalLine(trimmed)) {
            result.push(`{comment: ${trimmed}}`);
            i++;
            continue;
        }

        if (editorIsChordLine(line)) {
            const chordPositions = editorExtractChordsWithPositions(line);
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (!nextLine.trim() || editorIsChordLine(nextLine) || editorIsSectionMarker(nextLine.trim())) {
                    const chords = chordPositions.map(c => c.chord).join(' ');
                    result.push(`{comment: ${chords}}`);
                    i++;
                    continue;
                }
                const chordproLine = editorAlignChordsToLyrics(line, nextLine, chordPositions);
                result.push(chordproLine);
                i += 2;
                continue;
            } else {
                const chords = chordPositions.map(c => c.chord).join(' ');
                result.push(`{comment: ${chords}}`);
                i++;
                continue;
            }
        }

        result.push(line);
        i++;
    }

    return result.join('\n');
}

/**
 * Clean ChordU paste format
 * ChordU pastes have two song sections: a short preview and a full version with _ timing markers.
 * We want the full version, which comes after the "Traditional" display mode selector.
 */
export function cleanChordUPaste(text) {
    // Detect ChordU paste
    const isChordU = text.includes('ChordU') ||
                     text.includes('Find chords for tracks u love');

    if (!isChordU) {
        return { text, title: null, artist: null, cleaned: false };
    }

    const lines = text.split('\n');
    let title = null;
    let artist = null;

    // Extract title and artist - handle both formats:
    // "Chords for Artist "Title"" (with artist and quoted title)
    // "Chords for Title" (just title, no quotes)
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
        const line = lines[i];
        // Try format with artist and quoted title first
        const matchWithArtist = line.match(/Chords for (.+?) "(.+?)"/);
        if (matchWithArtist) {
            artist = matchWithArtist[1].trim();
            title = matchWithArtist[2].trim();
            break;
        }
        // Try format with just title (no quotes)
        const matchTitleOnly = line.match(/^Chords for ([^"]+)$/);
        if (matchTitleOnly) {
            title = matchTitleOnly[1].trim();
            break;
        }
    }

    // Find full song section - starts after "Traditional" display mode line
    let fullSongStart = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === 'Traditional') {
            fullSongStart = i + 1;
            break;
        }
    }

    // If we can't find "Traditional", fall back to looking for content after display controls
    if (fullSongStart === -1) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === 'Hide lyrics' || line === 'Blocks') {
                fullSongStart = i + 1;
                break;
            }
        }
    }

    if (fullSongStart === -1) {
        return { text, title, artist, cleaned: false };
    }

    // Find full song end - before footer
    let fullSongEnd = lines.length;
    for (let i = fullSongStart; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('About ChordU') ||
            line.startsWith('You may also like')) {
            fullSongEnd = i;
            break;
        }
    }

    // Extract and clean song lines
    const songLines = lines.slice(fullSongStart, fullSongEnd);
    const cleanedLines = songLines
        .map(line => {
            // Remove _ timing placeholders, normalize whitespace
            return line.replace(/\s*_\s*/g, ' ').replace(/\s+/g, ' ').trim();
        })
        .filter(line => {
            // Remove empty lines
            if (!line.trim()) return false;
            // Remove lines that are just a single chord name (chord list remnants)
            if (line.match(/^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13)*$/)) return false;
            return true;
        });

    return {
        text: cleanedLines.join('\n'),
        title,
        artist,
        cleaned: true
    };
}

/**
 * Clean Ultimate Guitar paste format
 */
export function cleanUltimateGuitarPaste(text) {
    const isUG = text.includes('ultimate-guitar') ||
                 text.includes('Ultimate-Guitar') ||
                 (text.includes('Chords by') && text.includes('views') && text.includes('saves')) ||
                 (text.includes('Tuning:') && text.includes('Key:') && text.includes('Capo:'));

    if (!isUG) {
        return { text, title: null, artist: null, cleaned: false };
    }

    const lines = text.split('\n');
    let title = null;
    let artist = null;
    let songStartIndex = -1;
    let songEndIndex = lines.length;

    // Find title and artist
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const line = lines[i];
        const match = line.match(/^(.+?)\s+(?:Chords|Tab|Tabs)\s+by\s+(.+)$/i);
        if (match) {
            title = match[1].trim();
            artist = match[2].trim();
            break;
        }
    }

    // Find song content start
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^\[(Verse|Chorus|Intro|Bridge|Outro|Instrumental|Pre-Chorus|Hook|Interlude)/i.test(line)) {
            songStartIndex = i;
            break;
        }
        if (editorIsChordLine(line) && i + 1 < lines.length && lines[i + 1].trim() && !editorIsChordLine(lines[i + 1])) {
            songStartIndex = i;
            break;
        }
    }

    // Find song content end
    for (let i = songStartIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('Last update:') ||
            line === 'Rating' ||
            line === 'Welcome Offer' ||
            line.startsWith('© ') ||
            line === 'Chords' ||
            (line === 'X' && i > songStartIndex + 10) ||
            line.includes('Please, rate this tab') ||
            line.match(/^\d+\.\d+$/) ||
            line.match(/^\d+ rates$/) ||
            /^\*?\s*Alternates?\s*:?\s*$/i.test(line)) {
            songEndIndex = i;
            break;
        }
    }

    if (songStartIndex === -1) {
        return { text, title, artist, cleaned: false };
    }

    const songLines = lines.slice(songStartIndex, songEndIndex);
    const cleanedLines = songLines
        .filter(line => {
            const trimmed = line.trim();
            if (trimmed === 'X') return false;
            if (trimmed.match(/^\d+\.\d+$/)) return false;
            if (trimmed.match(/^\(\d+,?\d*\)$/)) return false;
            if (trimmed === 'Chords' || trimmed === 'Guitar' || trimmed === 'Ukulele' || trimmed === 'Piano') return false;
            return true;
        });

    return {
        text: cleanedLines.join('\n'),
        title,
        artist,
        cleaned: true
    };
}

/**
 * Detect and convert chord sheet format
 */
export function editorDetectAndConvert(text) {
    const lines = text.split('\n');
    let chordLineCount = 0;
    let consecutivePairs = 0;

    for (let i = 0; i < lines.length - 1; i++) {
        if (editorIsChordLine(lines[i]) && !editorIsChordLine(lines[i + 1]) && lines[i + 1].trim()) {
            consecutivePairs++;
        }
        if (editorIsChordLine(lines[i])) {
            chordLineCount++;
        }
    }

    if (consecutivePairs >= 2 || chordLineCount >= 3) {
        return editorConvertToChordPro(text);
    }

    return text;
}

/**
 * Does the text already carry ChordPro content — inline [chord] brackets on
 * lyrics or ChordPro {directives}?
 */
export function looksLikeChordPro(text) {
    const inlineChord = /\[[A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?\]/;
    const directive = /^\s*\{(?:title|t|subtitle|st|artist|composer|meta|key|capo|tempo|time|comment|c|start_of_\w+|end_of_\w+|so[vcb]|eo[vcb])(?:[:\s].*)?\}\s*$/im;
    return inlineChord.test(text) || directive.test(text);
}

/**
 * Decide how pasted text should enter an editor.
 * Runs the same pipeline as the Raw editor's paste handler (ChordU clean →
 * Ultimate Guitar clean → chords-over-lyrics conversion) and reports whether
 * the result is ChordPro or ordinary plain text.
 *
 * @returns {{kind: 'plain'} | {kind: 'chordpro', text: string, title: string|null, artist: string|null}}
 */
export function convertPastedText(raw) {
    if (!raw || !raw.trim()) return { kind: 'plain' };
    let text = raw;
    let title = null;
    let artist = null;
    let cleaned = false;

    const chordU = cleanChordUPaste(text);
    if (chordU.cleaned) {
        ({ text, title, artist } = chordU);
        cleaned = true;
    } else {
        const ug = cleanUltimateGuitarPaste(text);
        if (ug.cleaned) {
            ({ text, title, artist } = ug);
            cleaned = true;
        }
    }

    if (looksLikeChordPro(text)) return { kind: 'chordpro', text, title, artist };

    const converted = editorDetectAndConvert(text);
    if (converted !== text) return { kind: 'chordpro', text: converted, title, artist };

    // Site chrome was stripped but no chords were found: still worth
    // importing the cleaned text rather than the raw page dump.
    if (cleaned) return { kind: 'chordpro', text, title, artist };

    return { kind: 'plain' };
}
