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

// ---------- section operations ----------

export function addSection(doc, type) {
    const next = cloneDoc(doc);
    const count = next.sections.filter(s => s.type === type).length;
    const base = capitalize(type);
    const label = type === 'verse' ? `Verse ${count + 1}` : (count ? `${base} ${count + 1}` : base);
    next.sections.push({ id: genId(), type, label, implicit: false, openRaw: null, closeRaw: null, lines: [] });
    return next;
}

export function setSectionType(doc, sectionId, type) {
    const next = cloneDoc(doc);
    const sec = next.sections.find(s => s.id === sectionId);
    const count = next.sections.filter(s => s !== sec && s.type === type).length;
    const base = capitalize(type);
    sec.type = type;
    sec.label = type === 'verse' ? `Verse ${count + 1}` : (count ? `${base} ${count + 1}` : base);
    sec.implicit = false;
    sec.openRaw = null;
    sec.closeRaw = null;
    return next;
}

export function relabelSection(doc, sectionId, label) {
    const next = cloneDoc(doc);
    const sec = next.sections.find(s => s.id === sectionId);
    sec.label = label;
    sec.implicit = false;
    sec.openRaw = null;
    if (!sec.closeRaw) sec.closeRaw = null;
    return next;
}

export function moveSection(doc, sectionId, delta) {
    const next = cloneDoc(doc);
    const i = next.sections.findIndex(s => s.id === sectionId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= next.sections.length) return next;
    const [sec] = next.sections.splice(i, 1);
    next.sections.splice(j, 0, sec);
    return next;
}

// Absolute-index counterpart of moveSection, for drag-and-drop: the section
// lands at targetIndex in the resulting order (clamped to the ends).
export function moveSectionTo(doc, sectionId, targetIndex) {
    const next = cloneDoc(doc);
    const i = next.sections.findIndex(s => s.id === sectionId);
    if (i < 0) return next;
    const j = Math.max(0, Math.min(targetIndex, next.sections.length - 1));
    if (j === i) return next;
    const [sec] = next.sections.splice(i, 1);
    next.sections.splice(j, 0, sec);
    return next;
}

export function duplicateSection(doc, sectionId) {
    const next = cloneDoc(doc);
    const i = next.sections.findIndex(s => s.id === sectionId);
    const copy = structuredClone(next.sections[i]);
    copy.id = genId();
    copy.label = `${copy.label} (copy)`;
    copy.openRaw = null;
    copy.closeRaw = null;
    copy.implicit = false;
    next.sections.splice(i + 1, 0, copy);
    return next;
}

export function deleteSection(doc, sectionId) {
    const next = cloneDoc(doc);
    next.sections = next.sections.filter(s => s.id !== sectionId);
    return next;
}

export function splitSectionOnBlankLines(doc, sectionId) {
    const next = cloneDoc(doc);
    const idx = next.sections.findIndex(s => s.id === sectionId);
    if (idx === -1 || !next.sections[idx].lines) return next;
    const sec = next.sections[idx];

    const groups = [];
    let cur = [];
    for (const line of sec.lines) {
        if (line.lyrics.trim() === '' && line.chords.length === 0) {
            if (cur.length) { groups.push(cur); cur = []; }
        } else {
            cur.push(line);
        }
    }
    if (cur.length) groups.push(cur);
    if (groups.length <= 1) return next;

    let count = next.sections.filter((s, i) => i !== idx && s.type === sec.type).length;
    const parts = groups.map((lines, gi) => {
        count++;
        return {
            id: gi === 0 ? sec.id : genId(),
            type: sec.type,
            label: `${capitalize(sec.type)} ${count}`,
            implicit: false, openRaw: null, closeRaw: null, lines
        };
    });
    next.sections.splice(idx, 1, ...parts);
    return next;
}

// Smart paste: replace one section with the sections of a freshly parsed
// document (the converted clipboard). A single anonymous block populates the
// target card in place (keeping its id/label/type); multiple blocks or
// explicit section directives splice in as their own cards. Pasted metadata
// fills empty fields only — it never clobbers what the user already has.
export function spliceSectionWithParsed(doc, sectionId, parsed) {
    const next = cloneDoc(doc);
    const idx = next.sections.findIndex(s => s.id === sectionId);
    if (idx === -1) return next;
    const target = next.sections[idx];
    const incoming = structuredClone(parsed.sections);

    if (incoming.length === 1 && incoming[0].implicit && incoming[0].lines) {
        target.lines = incoming[0].lines;
        target.implicit = false;
    } else {
        // continue the doc's verse numbering for anonymous pasted blocks
        let count = next.sections.filter((s, i) => i !== idx && s.type === 'verse').length;
        for (const s of incoming) {
            if (s.implicit && s.type === 'verse') {
                count++;
                s.label = `Verse ${count}`;
                s.implicit = false;
            }
        }
        next.sections.splice(idx, 1, ...incoming);
    }

    for (const entry of parsed.metadata.rawLines) {
        if (entry.field) {
            if (!next.metadata.fields[entry.field]) {
                next.metadata.fields[entry.field] = entry.parsedValue;
                next.metadata.rawLines.push(structuredClone(entry));
            }
        } else {
            next.metadata.rawLines.push(structuredClone(entry));
        }
    }
    return next;
}

// ---------- lyric editing with chord re-anchoring ----------

function wordsOf(lines) {
    const words = [];
    lines.forEach((lyrics, li) => {
        const re = /\S+/g;
        let m;
        while ((m = re.exec(lyrics)) !== null) {
            words.push({ text: m[0], line: li, start: m.index });
        }
    });
    return words;
}

// Longest-common-subsequence pairing of two word lists (by word text).
function lcsPairs(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i].text === b[j].text
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const map = new Map();
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i].text === b[j].text) { map.set(i, j); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    return map;
}

export function updateLyrics(doc, sectionId, newText) {
    const next = cloneDoc(doc);
    const sec = next.sections.find(s => s.id === sectionId);
    const oldLines = sec.lines;
    const newTexts = newText.replace(/\n+$/, '').split('\n');

    const oldWords = wordsOf(oldLines.map(l => l.opaque ? '' : l.lyrics));
    const newWords = wordsOf(newTexts);
    const wordMap = lcsPairs(oldWords, newWords);

    let dropped = 0;
    const newLines = newTexts.map(lyrics => ({ lyrics, chords: [] }));

    oldLines.forEach((old, li) => {
        if (old.opaque || old.chords.length === 0) return;

        // chord-only / whitespace lines: carry chords to the same index if
        // the new line at that index is also blank, else drop them
        if (old.lyrics.trim() === '') {
            if (newLines[li] && newLines[li].lyrics.trim() === '') {
                newLines[li].chords = old.chords.map(c => ({ ...c }));
            } else {
                dropped += old.chords.length;
            }
            return;
        }

        for (const c of old.chords) {
            // find the old word containing this position, else the next word on the line
            let wi = oldWords.findIndex(w =>
                w.line === li && c.position >= w.start && c.position < w.start + w.text.length);
            if (wi === -1) {
                wi = oldWords.findIndex(w => w.line === li && w.start >= c.position);
            }
            if (wi === -1) {
                // trailing chord: anchor to the line's last word at its end
                for (let k = oldWords.length - 1; k >= 0; k--) {
                    if (oldWords[k].line === li) { wi = k; break; }
                }
                if (wi === -1) { dropped++; continue; }
            }
            const nj = wordMap.get(wi);
            if (nj === undefined) { dropped++; continue; }
            const oldW = oldWords[wi], newW = newWords[nj];
            const offset = Math.min(Math.max(c.position - oldW.start, 0), newW.text.length);
            newLines[newW.line].chords.push({ chord: c.chord, position: newW.start + offset });
        }
    });

    for (const line of newLines) line.chords.sort((a, b) => a.position - b.position);
    sec.lines = newLines;
    return { doc: next, droppedChords: dropped };
}
