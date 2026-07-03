// SongDocument model for the visual editor: ChordPro <-> structured document.
// A line is { lyrics, chords: [{chord, position}] } — the same shape as
// chords.js parseLineWithChords / the Python parser's ChordPosition.
// Chords anchor to character offsets (ChordPro's native anchor); syllables
// exist only in the view layer (syllables.js).

import { parseLineWithChords, transposeChord } from '../chords.js';

let nextSectionId = 1;
export function resetIdsForTest() { nextSectionId = 1; }
function genId() { return `sec-${nextSectionId++}`; }

const META_FIELD_PATTERNS = [
    { field: 'title', re: /^\{(?:meta:\s*title\s+|title:\s*)(.+?)\s*\}$/i },
    { field: 'artist', re: /^\{(?:meta:\s*artist\s+|artist:\s*)(.+?)\s*\}$/i },
    { field: 'composer', re: /^\{(?:meta:\s*composer\s+|composer:\s*)(.+?)\s*\}$/i },
    { field: 'key', re: /^\{(?:meta:\s*key\s+|key:\s*)(.+?)\s*\}$/i },
];
const METADATA_LINE_RE = /^\{(?:meta:|title:|artist:|composer:|key:|tempo:|time:|capo:|album:|year:|lyricist:)/i;
const SECTION_START_RE = /^\{start_of_(\w+)(?::\s*(.*?))?\s*\}$/i;
const SHORT_START_RE = /^\{so([vcb])(?::\s*(.*?))?\s*\}$/i;
const SECTION_END_RE = /^\{(?:end_of_\w+|eo[vcb])\s*\}$/i;
const SHORT_TYPES = { v: 'verse', c: 'chorus', b: 'bridge' };

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export function parseSong(text) {
    const srcLines = text.split('\n');
    const metadata = { fields: { title: '', artist: '', composer: '', key: '' }, rawLines: [] };
    const sections = [];
    let current = null;   // open lyric section (explicit or implicit)
    let inAbc = false;
    let abcLines = [];

    for (const raw of srcLines) {
        const t = raw.trim();

        if (inAbc) {
            abcLines.push(raw);
            if (/^\{end_of_abc\s*\}$/i.test(t)) {
                inAbc = false;
                sections.push({ id: genId(), type: 'passthrough', raw: abcLines.join('\n') });
            }
            continue;
        }
        if (/^\{start_of_abc(?::.*)?\s*\}$/i.test(t)) {
            current = null;
            inAbc = true;
            abcLines = [raw];
            continue;
        }

        const start = t.match(SECTION_START_RE);
        const shortStart = start ? null : t.match(SHORT_START_RE);
        if ((start && start[1].toLowerCase() !== 'abc') || shortStart) {
            const type = start ? start[1].toLowerCase() : SHORT_TYPES[shortStart[1]];
            const label = (start ? start[2] : shortStart[2]) || capitalize(type);
            current = { id: genId(), type, label, implicit: false, openRaw: raw, closeRaw: null, lines: [] };
            sections.push(current);
            continue;
        }
        if (SECTION_END_RE.test(t)) {
            if (current && !current.implicit) current.closeRaw = raw;
            current = null;
            continue;
        }

        if (t.startsWith('{') && t.endsWith('}')) {
            if (current && !current.implicit) {
                // unknown directive inside a section: opaque line, round-trips verbatim
                current.lines.push({ lyrics: raw, chords: [], opaque: true });
            } else if (sections.length === 0 && !current && METADATA_LINE_RE.test(t)) {
                const entry = { raw, field: null, parsedValue: null };
                for (const { field, re } of META_FIELD_PATTERNS) {
                    const m = t.match(re);
                    if (m) {
                        entry.field = field;
                        entry.parsedValue = m[1];
                        metadata.fields[field] = m[1];
                        break;
                    }
                }
                metadata.rawLines.push(entry);
            } else {
                current = null;
                sections.push({ id: genId(), type: 'passthrough', raw });
            }
            continue;
        }

        if (t === '') {
            if (current && !current.implicit) current.lines.push({ lyrics: '', chords: [] });
            else current = null;   // blank line closes an implicit section
            continue;
        }

        if (!current) {
            const n = sections.filter(s => s.type === 'verse').length + 1;
            current = { id: genId(), type: 'verse', label: `Verse ${n}`, implicit: true, openRaw: null, closeRaw: null, lines: [] };
            sections.push(current);
        }
        current.lines.push(parseLineWithChords(raw));
    }

    // strip trailing blank lines inside each lyric section
    for (const sec of sections) {
        if (!sec.lines) continue;
        while (sec.lines.length &&
               sec.lines[sec.lines.length - 1].lyrics.trim() === '' &&
               sec.lines[sec.lines.length - 1].chords.length === 0) {
            sec.lines.pop();
        }
    }

    return { metadata, sections };
}

export function serializeLine(line) {
    let text = line.lyrics;
    const indexed = line.chords.map((c, i) => ({ ...c, i }));
    indexed.sort((a, b) => (b.position - a.position) || (b.i - a.i));
    for (const { chord, position } of indexed) {
        const p = Math.min(Math.max(position, 0), text.length);
        text = text.slice(0, p) + `[${chord}]` + text.slice(p);
    }
    return text;
}

function fieldLine(field, value, styleRaw) {
    if (styleRaw && !/^\{meta:/i.test(styleRaw.trim())) return `{${field}: ${value}}`;
    if (field === 'key' && !styleRaw) return `{key: ${value}}`;
    return `{meta: ${field} ${value}}`;
}

export function serializeSong(doc) {
    const out = [];
    for (const entry of doc.metadata.rawLines) {
        if (entry.field && doc.metadata.fields[entry.field] !== entry.parsedValue) {
            out.push(fieldLine(entry.field, doc.metadata.fields[entry.field], entry.raw));
        } else {
            out.push(entry.raw);
        }
    }
    for (const field of ['title', 'artist', 'composer', 'key']) {
        const val = doc.metadata.fields[field];
        if (val && !doc.metadata.rawLines.some(e => e.field === field)) {
            out.push(fieldLine(field, val, null));
        }
    }

    for (const sec of doc.sections) {
        if (out.length) out.push('');
        if (sec.type === 'passthrough') {
            out.push(...sec.raw.split('\n'));
            continue;
        }
        if (!sec.implicit) {
            out.push(sec.openRaw || `{start_of_${sec.type}: ${sec.label}}`);
        }
        for (const line of sec.lines) {
            out.push(line.opaque ? line.lyrics : serializeLine(line));
        }
        if (!sec.implicit) {
            out.push(sec.closeRaw || `{end_of_${sec.type}}`);
        }
    }
    return out.join('\n') + '\n';
}

// ---------- edit operations (pure: return a new doc) ----------

function cloneDoc(doc) { return structuredClone(doc); }

function getLine(doc, sectionId, lineIndex) {
    const sec = doc.sections.find(s => s.id === sectionId);
    if (!sec || !sec.lines || !sec.lines[lineIndex]) {
        throw new Error(`No line ${lineIndex} in section ${sectionId}`);
    }
    return sec.lines[lineIndex];
}

export function placeChord(doc, sectionId, lineIndex, position, chord) {
    const next = cloneDoc(doc);
    const line = getLine(next, sectionId, lineIndex);
    line.chords.push({ chord, position });
    line.chords.sort((a, b) => a.position - b.position);
    return next;
}

export function moveChord(doc, sectionId, lineIndex, chordIndex, newPosition) {
    const next = cloneDoc(doc);
    const line = getLine(next, sectionId, lineIndex);
    line.chords[chordIndex].position = newPosition;
    line.chords.sort((a, b) => a.position - b.position);
    return next;
}

export function changeChord(doc, sectionId, lineIndex, chordIndex, newChord) {
    const next = cloneDoc(doc);
    getLine(next, sectionId, lineIndex).chords[chordIndex].chord = newChord;
    return next;
}

export function removeChord(doc, sectionId, lineIndex, chordIndex) {
    const next = cloneDoc(doc);
    getLine(next, sectionId, lineIndex).chords.splice(chordIndex, 1);
    return next;
}

export function transposeDoc(doc, semitones) {
    const next = cloneDoc(doc);
    for (const sec of next.sections) {
        if (!sec.lines) continue;
        for (const line of sec.lines) {
            if (line.opaque) continue;
            for (const c of line.chords) c.chord = transposeChord(c.chord, semitones);
        }
    }
    if (next.metadata.fields.key) {
        next.metadata.fields.key = transposeChord(next.metadata.fields.key, semitones);
    }
    return next;
}

export function allChords(doc) {
    const out = [];
    for (const sec of doc.sections) {
        if (!sec.lines) continue;
        for (const line of sec.lines) {
            if (line.opaque) continue;
            for (const c of line.chords) out.push(c.chord);
        }
    }
    return out;
}
