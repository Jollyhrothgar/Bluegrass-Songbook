// Shared ChordPro renderer for Bluegrass Songbook
// Single source of truth for parsing ChordPro and rendering sections, used by
// the screen song view (song-view.js) and both print paths (main.js).
//
// Pure module: no DOM-global or module-scoped display state. All display
// options are threaded through `opts` explicitly:
//   {
//     key,            // original/detected key (e.g. 'G', 'Em')
//     transposeTo,    // target key; defaults to `key` (no transposition)
//     semitones,      // explicit transposition interval; overrides key math
//     nashville,      // true = show Nashville numbers (relative to transposeTo)
//     chordMode,      // 'all' | 'first' | 'none'
//     compact,        // collapse identical repeated sections
//     sectionLabels,  // show section labels (default true)
//     twoColumn,      // accepted for completeness; column layout is a
//                     // container/CSS concern applied by the caller
//   }
//
// Music theory (transposition, Nashville conversion) comes from chords.js and
// is not duplicated here. Note: chords.js transposeNote() picks flats vs
// sharps based on state.js currentDetectedKey — a pre-existing quirk that only
// matters when semitones !== 0, in which case the screen path has already set
// that state to the same target key passed here.

import { escapeHtml } from '../utils.js';
import {
    parseLineWithChords, transposeChord, toNashville, getSemitonesBetweenKeys
} from '../chords.js';

/**
 * Parse ChordPro content into structured sections
 */
export function parseChordPro(chordpro) {
    const lines = chordpro.split('\n');
    const metadata = {};
    const sections = [];
    let currentSection = null;
    let inAbcBlock = false;
    let abcLines = [];

    for (const line of lines) {
        // Handle ABC notation blocks
        if (line.match(/\{start_of_abc\}/i)) {
            inAbcBlock = true;
            abcLines = [];
            continue;
        }

        if (line.match(/\{end_of_abc\}/i)) {
            inAbcBlock = false;
            // Store ABC as a special section
            if (abcLines.length > 0) {
                sections.push({
                    type: 'abc',
                    label: 'Notation',
                    abc: abcLines.join('\n')
                });
            }
            continue;
        }

        if (inAbcBlock) {
            abcLines.push(line);
            continue;
        }

        const metaMatch = line.match(/\{meta:\s*(\w+)\s+([^}]+)\}/);
        if (metaMatch) {
            const [, key, value] = metaMatch;
            metadata[key.toLowerCase()] = value;
            continue;
        }

        const sectionMatch = line.match(/\{start_of_(verse|chorus|bridge)(?::\s*([^}]+))?\}/);
        if (sectionMatch) {
            const [, type, label] = sectionMatch;
            currentSection = {
                type: type,
                label: label || type.charAt(0).toUpperCase() + type.slice(1),
                lines: []
            };
            sections.push(currentSection);
            continue;
        }

        if (line.match(/\{end_of_(verse|chorus|bridge)\}/)) {
            currentSection = null;
            continue;
        }

        if (line.match(/^\{.*\}$/)) {
            continue;
        }

        if (currentSection && line.trim()) {
            currentSection.lines.push(line);
        }
    }

    return { metadata, sections };
}

/**
 * Normalize the opts bag into a fully-resolved options object.
 */
function resolveOpts(opts = {}) {
    const key = opts.key || null;
    const transposeTo = opts.transposeTo || key;
    const semitones = typeof opts.semitones === 'number'
        ? opts.semitones
        : getSemitonesBetweenKeys(key, transposeTo);
    return {
        key,
        transposeTo,
        semitones,
        nashville: !!opts.nashville,
        chordMode: opts.chordMode || 'all',
        compact: !!opts.compact,
        sectionLabels: opts.sectionLabels !== false,
        twoColumn: !!opts.twoColumn
    };
}

/**
 * Apply transposition and Nashville conversion to a single chord.
 */
function displayChord(chord, o) {
    const transposed = o.semitones !== 0 ? transposeChord(chord, o.semitones) : chord;
    return o.nashville && o.transposeTo
        ? toNashville(transposed, o.transposeTo)
        : transposed;
}

// ============================================
// HTML PATH (screen rendering)
// ============================================

/**
 * Render a single line with chords above lyrics using inline segments.
 * Each chord+lyrics chunk is an inline-block so chords wrap with their lyrics.
 */
function renderLine(line, hideChords, o) {
    const { chords, lyrics } = parseLineWithChords(line);

    // No chords mode or hideChords flag - just show lyrics
    if (chords.length === 0 || o.chordMode === 'none' || hideChords) {
        return `<div class="song-line"><div class="lyrics-line">${escapeHtml(lyrics)}</div></div>`;
    }

    // Build inline segments: each chord paired with its following lyrics
    const segments = [];

    for (let i = 0; i < chords.length; i++) {
        const { chord, position } = chords[i];
        const nextPos = i + 1 < chords.length ? chords[i + 1].position : lyrics.length;

        // Lyrics before the first chord (no chord above)
        if (i === 0 && position > 0) {
            const prefixLyrics = lyrics.slice(0, position);
            segments.push({ chord: '', lyrics: prefixLyrics });
        }

        const segmentLyrics = lyrics.slice(position, nextPos);
        segments.push({ chord: displayChord(chord, o), lyrics: segmentLyrics });
    }

    // Build HTML from segments
    let html = '';
    for (const seg of segments) {
        const chordHtml = seg.chord
            ? `<span class="cl-chord">${escapeHtml(seg.chord)}</span>`
            : `<span class="cl-chord">&nbsp;</span>`;
        const lyricsHtml = escapeHtml(seg.lyrics) || '&nbsp;';
        html += `<span class="cl-segment">${chordHtml}${lyricsHtml}</span>`;
    }

    return `<div class="song-line cl-line">${html}</div>`;
}

/**
 * Extract chord pattern from a section
 */
function getSectionChordPattern(section) {
    const chords = [];
    for (const line of section.lines) {
        const { chords: lineChords } = parseLineWithChords(line);
        for (const { chord } of lineChords) {
            chords.push(chord);
        }
    }
    return chords.join('-');
}

/**
 * Render a section (verse, chorus, etc.)
 */
function renderSection(section, isRepeatedSection, hideChords, o) {
    const lines = section.lines.map(line => renderLine(line, hideChords, o)).join('');
    const shouldIndent = section.type === 'chorus' || isRepeatedSection;
    const indentClass = shouldIndent ? 'section-indent' : '';
    const labelHtml = o.sectionLabels ? `<div class="section-label">${escapeHtml(section.label)}</div>` : '';

    return `
        <div class="song-section ${indentClass}">
            ${labelHtml}
            <div class="section-content">${lines}</div>
        </div>
    `;
}

/**
 * Render a repeat indicator (for compact mode)
 */
function renderRepeatIndicator(label, count, shouldIndent) {
    const indentClass = shouldIndent ? 'section-indent' : '';
    const repeatText = count > 1 ? `(Repeat ${label} ×${count})` : `(Repeat ${label})`;
    return `<div class="section-repeat ${indentClass}">${repeatText}</div>`;
}

/**
 * Render parsed sections to the screen HTML (song-section / cl-segment
 * structure). ABC sections are skipped — the caller renders those via ABCJS.
 */
export function renderSectionsHtml(sections, opts) {
    const o = resolveOpts(opts);
    const chordSections = sections.filter(s => s.type !== 'abc');

    const totalCounts = {};
    for (const section of chordSections) {
        totalCounts[section.label] = (totalCounts[section.label] || 0) + 1;
    }

    // Track section content to distinguish true repeats from sections with same label but different lyrics
    const seenSections = new Map(); // label → content fingerprint
    const seenChordPatterns = new Set(); // for 'first' chord mode
    let sectionsHtml = '';
    let i = 0;

    while (i < chordSections.length) {
        const section = chordSections[i];
        const sectionKey = section.label;
        const isRepeatedSection = totalCounts[sectionKey] > 1;
        const shouldIndent = section.type === 'chorus' || isRepeatedSection;
        const sectionContent = section.lines.map(l => l.trimEnd()).join('\n');

        // In 'first' mode, check if we've seen this chord pattern before
        let hideChords = false;
        if (o.chordMode === 'first') {
            const chordPattern = getSectionChordPattern(section);
            if (chordPattern) {
                if (seenChordPatterns.has(chordPattern)) {
                    hideChords = true;
                } else {
                    seenChordPatterns.add(chordPattern);
                }
            }
        }

        if (!seenSections.has(sectionKey)) {
            seenSections.set(sectionKey, sectionContent);
            sectionsHtml += renderSection(section, isRepeatedSection, hideChords, o);
            i++;
        } else if (o.compact && sectionContent === seenSections.get(sectionKey)) {
            // Only collapse if lyrics+chords are identical to the first instance
            let consecutiveCount = 0;
            while (i < chordSections.length && chordSections[i].label === sectionKey
                   && chordSections[i].lines.map(l => l.trimEnd()).join('\n') === seenSections.get(sectionKey)) {
                consecutiveCount++;
                i++;
            }
            sectionsHtml += renderRepeatIndicator(sectionKey, consecutiveCount, shouldIndent);
        } else {
            sectionsHtml += renderSection(section, isRepeatedSection, hideChords, o);
            i++;
        }
    }

    return sectionsHtml;
}

// ============================================
// ASCII / MONOSPACE PATH (print, plain text)
// ============================================

/**
 * Convert a ChordPro line to a monospace chord line + lyric line pair.
 * `transform` maps a raw chord to its display form (transpose/Nashville);
 * chords are placed at their lyric position, nudged right so they never
 * touch the previous chord.
 */
function lineToAscii(line, transform) {
    const { chords, lyrics } = parseLineWithChords(line);

    let chordLine = '';
    for (const { chord, position } of chords) {
        const display = transform ? transform(chord) : chord;
        const minPos = chordLine.length > 0 ? chordLine.length + 1 : 0;
        const targetPos = Math.max(position, minPos);
        while (chordLine.length < targetPos) {
            chordLine += ' ';
        }
        chordLine += display;
    }

    return { chordLine: chordLine.trimEnd(), lyricLine: lyrics };
}

/**
 * Match a section against previously seen sections by full content (the
 * print path's repeat rule: any earlier section with identical lines counts,
 * regardless of label).
 */
function findContentRepeat(seen, section) {
    const content = section.lines.map(l => l.trimEnd()).join('\n').trim();
    const match = seen.find(s => s.content === content) || null;
    if (!match) seen.push({ content, label: section.label });
    return match;
}

/**
 * Render parsed sections as plain monospace text (chord line above lyric
 * line). ABC sections are skipped.
 */
export function renderSectionsAscii(sections, opts) {
    const o = resolveOpts(opts);
    const out = [];
    const seen = []; // [{content, label}] for content-based repeat detection

    for (const section of sections) {
        if (section.type === 'abc') continue;

        const match = findContentRepeat(seen, section);
        const hideChords = o.chordMode === 'none' || (o.chordMode === 'first' && !!match);

        if (o.compact && match) {
            out.push(`[Repeat ${match.label}]`);
            out.push('');
            continue;
        }

        if (o.sectionLabels) out.push(section.label);
        for (const line of section.lines) {
            const { chordLine, lyricLine } = lineToAscii(
                line, hideChords ? null : c => displayChord(c, o));
            if (chordLine && !hideChords) out.push(chordLine);
            out.push(lyricLine);
        }
        out.push('');
    }

    // Single trailing newline
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.join('\n') + (out.length > 0 ? '\n' : '');
}

/**
 * Render parsed sections as toggle-ready monospace HTML for the print-list
 * page. Every display variant is emitted statically so the print window can
 * switch modes with pure CSS body classes and zero rendering logic:
 *   - each chord line is emitted twice: .chord-line.standard and
 *     .chord-line.nashville (body.nashville swaps them)
 *   - content-repeated sections get .is-repeat plus a sibling
 *     .repeat-instruction (body.compact swaps them; body.chords-first hides
 *     chords on .is-repeat; body.chords-none hides all chords)
 */
export function renderSectionsPrintHtml(sections, opts) {
    const o = resolveOpts(opts);
    const seen = [];
    let html = '';

    for (const section of sections) {
        if (section.type === 'abc') continue;

        const match = findContentRepeat(seen, section);
        if (match) {
            html += `<div class="repeat-instruction">[Repeat ${escapeHtml(match.label)}]</div>`;
        }

        html += `<div class="section${match ? ' is-repeat' : ''}">`;
        html += `<div class="section-label">${escapeHtml(section.label)}</div>`;
        for (const line of section.lines) {
            const { chordLine, lyricLine } = lineToAscii(
                line, c => displayChord(c, { ...o, nashville: false }));
            const { chordLine: nashvilleLine } = lineToAscii(
                line, c => displayChord(c, { ...o, nashville: true }));
            html += '<div class="line-group">';
            if (chordLine) {
                html += `<div class="chord-line standard">${escapeHtml(chordLine)}</div>`;
                html += `<div class="chord-line nashville">${escapeHtml(nashvilleLine)}</div>`;
            }
            html += `<div class="lyric-line">${escapeHtml(lyricLine) || '&nbsp;'}</div>`;
            html += '</div>';
        }
        html += '</div>';
    }

    return html;
}
