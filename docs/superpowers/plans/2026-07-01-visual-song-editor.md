# Visual Song Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first visual song editor — tap a syllable, tap a chord — with section block cards and Visual|Raw tabs, per `docs/superpowers/specs/2026-07-01-visual-song-editor-design.md`.

**Architecture:** A new `docs/js/visual-editor/` module owns an in-memory SongDocument (sections → lines of `{lyrics, chords: [{chord, position}]}` — ChordPro's native character-offset anchor). Syllables are view-layer tap targets only. The visual editor mirrors its serialized ChordPro into the existing `#editor-content` textarea on every change, so the existing preview/submit/save pipeline works unchanged.

**Tech Stack:** Vanilla JS ES modules, Vitest (+jsdom), Playwright. No new dependencies.

## Global Constraints

- Vanilla JS ES modules only; no frameworks, no new npm deps.
- Reuse `docs/js/chords.js` (`parseLineWithChords`, `transposeChord`, `detectKey`, `extractChords`, `CHROMATIC_MAJOR_KEYS`) and `docs/js/chord-explorer/theory.js` (`getDiatonicChords`) — do NOT reimplement music theory.
- Round-trip invariant: `serializeSong(parseSong(x))` equals `x` after normalization (strip trailing whitespace per line, collapse blank-line runs to one, trim leading/trailing blank lines). Chord positions within a line are byte-exact.
- Never drop content silently: unknown directives → passthrough (verbatim on save); destructive lyric edits report dropped chord counts.
- All lyric text rendered via `textContent`/`createElement` (no innerHTML interpolation of user content).
- Existing raw-editor behavior (smart paste, preview, submit flows in `editor.js`) must not change.
- Tests: `npm test` (Vitest) for units; `npm run test:e2e` (Playwright, needs `./scripts/server`). Run `npx vitest run <file>` for single files.

### Plan deviation from spec (intentional)

The spec's Implementation Notes call for extracting the save flow into `editor-submit.js`. This plan instead has the visual editor **mirror its serialized ChordPro into the existing `#editor-content` textarea on every change**. The submit/copy/download/preview code in `editor.js` reads that textarea and continues to work verbatim — same behavior sharing, no refactor risk. If the extraction is still wanted later, it's an independent cleanup.

### SongDocument shape (referenced by every task)

```js
{
  metadata: {
    fields: { title: '', artist: '', composer: '', key: '' },
    // Original metadata lines in order. field/parsedValue set when the line
    // binds to one of the four fields; emitted verbatim unless field changed.
    rawLines: [ { raw: '{meta: title Foo}', field: 'title', parsedValue: 'Foo' } ]
  },
  sections: [
    {
      id: 'sec-1',                 // session-stable, generated
      type: 'verse',               // 'verse'|'chorus'|'bridge'|'intro'|'outro'|<any word>
      label: 'Verse 1',
      implicit: false,             // true = bare lines, serialize without directives
      openRaw: '{start_of_verse: Verse 1}',  // verbatim directive; null → regenerate
      closeRaw: '{end_of_verse}',            // verbatim directive; null → regenerate
      lines: [
        { lyrics: 'You fill up my sen-ses', chords: [{ chord: 'F', position: 15 }] },
        { lyrics: '', chords: [] },              // blank line inside section
        { lyrics: '{comment: x}', chords: [], opaque: true }  // directive inside section
      ]
    },
    { id: 'sec-2', type: 'passthrough', raw: '{start_of_abc}\n...\n{end_of_abc}' }
  ]
}
```

---

### Task 1: `model.js` — parse and serialize with round-trip guarantee

**Files:**
- Create: `docs/js/visual-editor/model.js`
- Test: `docs/js/__tests__/visual-editor-model.test.js`

**Interfaces:**
- Consumes: `parseLineWithChords(line)` from `docs/js/chords.js` → `{ chords: [{chord, position}], lyrics }`.
- Produces (used by Tasks 2, 3, 6, 7):
  - `parseSong(text: string) → SongDocument`
  - `serializeSong(doc: SongDocument) → string`
  - `serializeLine(line: {lyrics, chords}) → string`
  - `resetIdsForTest() → void` (deterministic section ids in tests)

- [ ] **Step 1: Write the failing tests**

Create `docs/js/__tests__/visual-editor-model.test.js`:

```js
// @vitest-environment node
// Tests for visual editor SongDocument model: parse + serialize round-trip
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSong, serializeSong, serializeLine, resetIdsForTest } from '../visual-editor/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ANNIE = `{meta: title Annie's Song}
{meta: artist John Denver}
{meta: x_source classic-country}

{start_of_verse: Verse 1}
[C]You fill up my [F]sen-ses [G7]like [Am]a night [F]in a [C]forest
[F]Like the [G7]mountains in [Dm]spring-time  [F]like a walk in the [G7]rain
{end_of_verse}

{start_of_chorus: Chorus}
[F]Come let [G7]me l-ove [Am]you
{end_of_chorus}
`;

// Mid-word chords (real data pattern from works/believe/)
const BELIEVE_LINES = `{start_of_verse: Verse 1}
[G]Old man Wrigley lived in that white house,
D[D/F]own the street where I grew up.
H[C]e said I'll see my wife and son in just a little while
{end_of_verse}
`;

function normalize(text) {
    const lines = text.split('\n').map(l => l.replace(/\s+$/, ''));
    const out = [];
    for (const l of lines) {
        if (l === '' && out[out.length - 1] === '') continue;
        out.push(l);
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
}

beforeEach(() => resetIdsForTest());

describe('parseSong', () => {
    it('extracts bound metadata fields and keeps raw lines', () => {
        const doc = parseSong(ANNIE);
        expect(doc.metadata.fields.title).toBe("Annie's Song");
        expect(doc.metadata.fields.artist).toBe('John Denver');
        expect(doc.metadata.rawLines).toHaveLength(3);
        expect(doc.metadata.rawLines[2].raw).toBe('{meta: x_source classic-country}');
        expect(doc.metadata.rawLines[2].field).toBeNull();
    });

    it('parses sections with type, label, and verbatim directives', () => {
        const doc = parseSong(ANNIE);
        expect(doc.sections).toHaveLength(2);
        expect(doc.sections[0].type).toBe('verse');
        expect(doc.sections[0].label).toBe('Verse 1');
        expect(doc.sections[0].openRaw).toBe('{start_of_verse: Verse 1}');
        expect(doc.sections[1].type).toBe('chorus');
        expect(doc.sections[0].lines).toHaveLength(2);
    });

    it('parses chords to character offsets (same shape as parseLineWithChords)', () => {
        const doc = parseSong(ANNIE);
        const line = doc.sections[0].lines[0];
        expect(line.lyrics).toBe('You fill up my sen-ses like a night in a forest');
        expect(line.chords[0]).toEqual({ chord: 'C', position: 0 });
        expect(line.chords[1]).toEqual({ chord: 'F', position: 15 });
    });

    it('preserves mid-word chord offsets exactly', () => {
        const doc = parseSong(BELIEVE_LINES);
        const line = doc.sections[0].lines[1];
        expect(line.lyrics).toBe('Down the street where I grew up.');
        expect(line.chords[0]).toEqual({ chord: 'D/F', position: 1 });
    });

    it('groups bare lines into implicit verse sections split on blank lines', () => {
        const doc = parseSong('First verse line one\nFirst verse line two\n\nSecond verse line');
        expect(doc.sections).toHaveLength(2);
        expect(doc.sections[0].implicit).toBe(true);
        expect(doc.sections[0].label).toBe('Verse 1');
        expect(doc.sections[1].label).toBe('Verse 2');
        expect(doc.sections[0].lines).toHaveLength(2);
    });

    it('turns ABC blocks into passthrough sections verbatim', () => {
        const abc = '{start_of_abc}\nX:1\nK:A\n|: E2AB :|\n{end_of_abc}';
        const doc = parseSong(abc);
        expect(doc.sections).toHaveLength(1);
        expect(doc.sections[0].type).toBe('passthrough');
        expect(doc.sections[0].raw).toBe(abc);
    });

    it('turns unknown standalone directives into passthrough sections', () => {
        const doc = parseSong('{comment: Repeat Verse 1}');
        expect(doc.sections[0].type).toBe('passthrough');
        expect(doc.sections[0].raw).toBe('{comment: Repeat Verse 1}');
    });

    it('keeps unknown directives inside a section as opaque lines', () => {
        const doc = parseSong('{start_of_verse: V1}\nline one\n{comment: soft}\nline two\n{end_of_verse}');
        expect(doc.sections).toHaveLength(1);
        expect(doc.sections[0].lines).toHaveLength(3);
        expect(doc.sections[0].lines[1].opaque).toBe(true);
        expect(doc.sections[0].lines[1].lyrics).toBe('{comment: soft}');
    });

    it('accepts shorthand directives and preserves them verbatim', () => {
        const doc = parseSong('{sov: Verse 1}\nhello\n{eov}');
        expect(doc.sections[0].type).toBe('verse');
        expect(doc.sections[0].openRaw).toBe('{sov: Verse 1}');
        expect(serializeSong(doc)).toContain('{sov: Verse 1}');
    });
});

describe('serializeLine', () => {
    it('reinserts brackets at exact positions, right-to-left', () => {
        expect(serializeLine({
            lyrics: 'Down the street', chords: [{ chord: 'D/F', position: 1 }]
        })).toBe('D[D/F]own the street');
    });

    it('preserves multiple chords at the same position in order', () => {
        expect(serializeLine({
            lyrics: 'word', chords: [{ chord: 'G', position: 0 }, { chord: 'C', position: 0 }]
        })).toBe('[G][C]word');
    });

    it('clamps trailing chords to end of line', () => {
        expect(serializeLine({
            lyrics: 'hello', chords: [{ chord: 'G', position: 5 }]
        })).toBe('hello[G]');
    });

    it('serializes chord-only lines (empty lyrics)', () => {
        expect(serializeLine({
            lyrics: ' ', chords: [{ chord: 'G', position: 0 }, { chord: 'C', position: 1 }]
        })).toBe('[G] [C]');
    });
});

describe('round-trip', () => {
    it('round-trips the fixtures byte-identically after normalization', () => {
        for (const src of [ANNIE, BELIEVE_LINES]) {
            expect(normalize(serializeSong(parseSong(src)))).toBe(normalize(src));
        }
    });

    it('regenerates a metadata line only when its field changed', () => {
        const doc = parseSong(ANNIE);
        doc.metadata.fields.artist = 'Someone Else';
        const out = serializeSong(doc);
        expect(out).toContain('{meta: artist Someone Else}');
        expect(out).toContain("{meta: title Annie's Song}"); // untouched, verbatim
    });

    it('emits metadata for new songs in project order', () => {
        const doc = parseSong('hello world');
        doc.metadata.fields.title = 'New Song';
        doc.metadata.fields.key = 'G';
        const out = serializeSong(doc);
        expect(out.indexOf('{meta: title New Song}')).toBeLessThan(out.indexOf('{key: G}'));
    });
});

describe('corpus round-trip (property test)', () => {
    it('round-trips 300 sampled works after normalization', () => {
        const worksDir = path.resolve(__dirname, '../../../works');
        const dirs = fs.readdirSync(worksDir).sort().slice(0, 400);
        let tested = 0;
        for (const d of dirs) {
            const f = path.join(worksDir, d, 'lead-sheet.pro');
            if (!fs.existsSync(f)) continue;
            const src = fs.readFileSync(f, 'utf8');
            const out = serializeSong(parseSong(src));
            expect(normalize(out), `round-trip failed for works/${d}`).toBe(normalize(src));
            if (++tested >= 300) break;
        }
        expect(tested).toBeGreaterThan(100);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run docs/js/__tests__/visual-editor-model.test.js`
Expected: FAIL — `Cannot find module '../visual-editor/model.js'`

- [ ] **Step 3: Implement `model.js` parse + serialize**

Create `docs/js/visual-editor/model.js`:

```js
// SongDocument model for the visual editor: ChordPro <-> structured document.
// A line is { lyrics, chords: [{chord, position}] } — the same shape as
// chords.js parseLineWithChords / the Python parser's ChordPosition.
// Chords anchor to character offsets (ChordPro's native anchor); syllables
// exist only in the view layer (syllables.js).

import { parseLineWithChords } from '../chords.js';

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run docs/js/__tests__/visual-editor-model.test.js`
Expected: PASS (all tests including the 300-work corpus round-trip). If corpus files fail, the assertion message names the work — inspect it with `cat works/<name>/lead-sheet.pro` and fix `parseSong`/`serializeSong` (do NOT weaken `normalize`).

- [ ] **Step 5: Run the full unit suite to check for regressions**

Run: `npx vitest run`
Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/js/visual-editor/model.js docs/js/__tests__/visual-editor-model.test.js
git commit -m "feat(visual-editor): SongDocument model with byte-exact ChordPro round-trip"
```

---

### Task 2: `model.js` — chord edit operations and transposition

**Files:**
- Modify: `docs/js/visual-editor/model.js` (append)
- Test: `docs/js/__tests__/visual-editor-model-ops.test.js`

**Interfaces:**
- Consumes: Task 1's `parseSong`/`serializeSong`; `transposeChord(chord, semitones)` from `docs/js/chords.js`.
- Produces (used by Task 7). All ops are pure — they return a **new** doc via `structuredClone`; section ids are preserved:
  - `placeChord(doc, sectionId, lineIndex, position, chord) → doc`
  - `moveChord(doc, sectionId, lineIndex, chordIndex, newPosition) → doc`
  - `changeChord(doc, sectionId, lineIndex, chordIndex, newChord) → doc`
  - `removeChord(doc, sectionId, lineIndex, chordIndex) → doc`
  - `transposeDoc(doc, semitones) → doc`
  - `allChords(doc) → string[]` (every chord occurrence, for key detection/recents)

- [ ] **Step 1: Write the failing tests**

Create `docs/js/__tests__/visual-editor-model-ops.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseSong, serializeSong, resetIdsForTest,
    placeChord, moveChord, changeChord, removeChord, transposeDoc, allChords
} from '../visual-editor/model.js';

const SRC = `{start_of_verse: Verse 1}
[G]hello world friend
plain line here
{end_of_verse}
`;

let doc, sid;
beforeEach(() => {
    resetIdsForTest();
    doc = parseSong(SRC);
    sid = doc.sections[0].id;
});

describe('chord ops', () => {
    it('placeChord inserts at a position and keeps chords sorted', () => {
        const next = placeChord(doc, sid, 0, 6, 'C');
        expect(next.sections[0].lines[0].chords).toEqual([
            { chord: 'G', position: 0 }, { chord: 'C', position: 6 }
        ]);
        expect(doc.sections[0].lines[0].chords).toHaveLength(1); // original untouched
        expect(serializeSong(next)).toContain('[G]hello [C]world friend');
    });

    it('placeChord works on a line with no chords', () => {
        const next = placeChord(doc, sid, 1, 0, 'D7');
        expect(serializeSong(next)).toContain('[D7]plain line here');
    });

    it('moveChord changes position and re-sorts', () => {
        const next = moveChord(placeChord(doc, sid, 0, 6, 'C'), sid, 0, 1, 12);
        expect(next.sections[0].lines[0].chords[1]).toEqual({ chord: 'C', position: 12 });
    });

    it('changeChord swaps the symbol, keeps position', () => {
        const next = changeChord(doc, sid, 0, 0, 'Em');
        expect(next.sections[0].lines[0].chords[0]).toEqual({ chord: 'Em', position: 0 });
    });

    it('removeChord deletes by index', () => {
        const next = removeChord(doc, sid, 0, 0);
        expect(next.sections[0].lines[0].chords).toHaveLength(0);
        expect(serializeSong(next)).toContain('hello world friend');
    });
});

describe('transposeDoc', () => {
    it('transposes every chord and the key field', () => {
        doc.metadata.fields.key = 'G';
        const next = transposeDoc(placeChord(doc, sid, 0, 6, 'C'), 2);
        expect(next.sections[0].lines[0].chords.map(c => c.chord)).toEqual(['A', 'D']);
        expect(next.metadata.fields.key).toBe('A');
    });

    it('skips opaque lines and passthrough sections', () => {
        const d = parseSong('{start_of_verse: V1}\n[G]hi\n{comment: [G] not a chord}\n{end_of_verse}');
        const next = transposeDoc(d, 2);
        expect(next.sections[0].lines[1].lyrics).toBe('{comment: [G] not a chord}');
    });
});

describe('allChords', () => {
    it('returns every chord occurrence in document order', () => {
        const next = placeChord(doc, sid, 0, 6, 'C');
        expect(allChords(next)).toEqual(['G', 'C']);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run docs/js/__tests__/visual-editor-model-ops.test.js`
Expected: FAIL — `placeChord` is not exported.

- [ ] **Step 3: Append the ops to `model.js`**

```js
// ---------- edit operations (pure: return a new doc) ----------

import { transposeChord } from '../chords.js';
// NOTE: merge this into the existing import from '../chords.js' at the top
// of the file: import { parseLineWithChords, transposeChord } from '../chords.js';

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
```

(Move the `transposeChord` import up into the existing `import { parseLineWithChords } from '../chords.js';` statement — ES modules require imports at top level.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run docs/js/__tests__/visual-editor-model-ops.test.js`
Expected: PASS. Also run `npx vitest run docs/js/__tests__/visual-editor-model.test.js` — still PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/js/visual-editor/model.js docs/js/__tests__/visual-editor-model-ops.test.js
git commit -m "feat(visual-editor): pure chord edit operations and transposition"
```

---

### Task 3: `model.js` — section operations and lyric-edit re-anchoring

**Files:**
- Modify: `docs/js/visual-editor/model.js` (append)
- Test: `docs/js/__tests__/visual-editor-model-sections.test.js`

**Interfaces:**
- Consumes: Task 1/2 exports.
- Produces (used by Task 7):
  - `addSection(doc, type) → doc` (appended at end, auto-numbered label)
  - `setSectionType(doc, sectionId, type) → doc` (relabels, clears openRaw/closeRaw, implicit=false)
  - `relabelSection(doc, sectionId, label) → doc`
  - `moveSection(doc, sectionId, delta) → doc` (delta = -1|+1, clamps at edges)
  - `duplicateSection(doc, sectionId) → doc` (new id, inserted after original)
  - `deleteSection(doc, sectionId) → doc`
  - `updateLyrics(doc, sectionId, newText) → { doc, droppedChords }` (word-LCS re-anchoring)
  - `splitSectionOnBlankLines(doc, sectionId) → doc` (splits one section into several at blank lines; used when pasted multi-paragraph lyrics land in a single card)

- [ ] **Step 1: Write the failing tests**

Create `docs/js/__tests__/visual-editor-model-sections.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseSong, serializeSong, resetIdsForTest,
    addSection, setSectionType, relabelSection, moveSection,
    duplicateSection, deleteSection, updateLyrics, splitSectionOnBlankLines
} from '../visual-editor/model.js';

const SRC = `{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}

{start_of_chorus: Chorus}
[C]sing it loud
{end_of_chorus}
`;

let doc, verseId, chorusId;
beforeEach(() => {
    resetIdsForTest();
    doc = parseSong(SRC);
    [verseId, chorusId] = doc.sections.map(s => s.id);
});

describe('section ops', () => {
    it('addSection appends with auto-numbered label', () => {
        const next = addSection(addSection(doc, 'verse'), 'bridge');
        expect(next.sections[2].label).toBe('Verse 2');
        expect(next.sections[3].label).toBe('Bridge');
        expect(next.sections[2].implicit).toBe(false);
        expect(next.sections[2].lines).toEqual([]);
    });

    it('setSectionType regenerates directives on serialize (auto-numbered past existing)', () => {
        const next = setSectionType(doc, verseId, 'chorus');
        expect(next.sections[0].openRaw).toBeNull();
        // the fixture already has a Chorus, so this one becomes Chorus 2
        expect(serializeSong(next)).toContain('{start_of_chorus: Chorus 2}');
        expect(serializeSong(next)).toContain('{end_of_chorus}');
    });

    it('relabelSection updates the label and directive', () => {
        const next = relabelSection(doc, verseId, 'Verse 1 (quiet)');
        expect(serializeSong(next)).toContain('{start_of_verse: Verse 1 (quiet)}');
    });

    it('moveSection reorders and clamps at edges', () => {
        const next = moveSection(doc, chorusId, -1);
        expect(next.sections[0].id).toBe(chorusId);
        const clamped = moveSection(next, chorusId, -1);
        expect(clamped.sections[0].id).toBe(chorusId);
    });

    it('duplicateSection inserts a copy with a fresh id after the original', () => {
        const next = duplicateSection(doc, chorusId);
        expect(next.sections).toHaveLength(3);
        expect(next.sections[2].label).toBe('Chorus (copy)');
        expect(next.sections[2].id).not.toBe(chorusId);
        expect(next.sections[2].lines[0].chords[0].chord).toBe('C');
    });

    it('deleteSection removes it', () => {
        const next = deleteSection(doc, verseId);
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0].id).toBe(chorusId);
    });
});

describe('updateLyrics re-anchoring', () => {
    it('keeps chords on unchanged words when text is edited around them', () => {
        const { doc: next, droppedChords } =
            updateLyrics(doc, verseId, 'well hello world my friend');
        expect(droppedChords).toBe(0);
        const line = next.sections[0].lines[0];
        expect(line.lyrics).toBe('well hello world my friend');
        // 'G' was on 'hello' (offset 0 in word) → new position = start of 'hello'
        expect(line.chords[0]).toEqual({ chord: 'G', position: 5 });
    });

    it('keeps mid-word offsets within a surviving word', () => {
        const d = parseSong('{start_of_verse: V1}\nD[D/F]own the street\n{end_of_verse}');
        const { doc: next } = updateLyrics(d, d.sections[0].id, 'go D own the street'.replace('D own', 'Down'));
        const line = next.sections[0].lines[0];
        expect(line.lyrics).toBe('go Down the street');
        expect(line.chords[0]).toEqual({ chord: 'D/F', position: 4 }); // still over 'own'
    });

    it('drops chords on deleted words and reports the count', () => {
        const { doc: next, droppedChords } = updateLyrics(doc, verseId, 'completely different text');
        expect(droppedChords).toBe(1);
        expect(next.sections[0].lines[0].chords).toHaveLength(0);
    });

    it('handles added and removed lines', () => {
        const { doc: next, droppedChords } =
            updateLyrics(doc, verseId, 'new first line\nhello world friend');
        expect(droppedChords).toBe(0);
        expect(next.sections[0].lines).toHaveLength(2);
        expect(next.sections[0].lines[1].chords[0]).toEqual({ chord: 'G', position: 0 });
    });

    it('carries chord-only lines through when the blank/whitespace line survives by index', () => {
        const d = parseSong('{start_of_verse: V1}\n[G] [C]\nhello there\n{end_of_verse}');
        const { doc: next, droppedChords } = updateLyrics(d, d.sections[0].id, ' \nhello there friend');
        expect(droppedChords).toBe(0);
        expect(next.sections[0].lines[0].chords.map(c => c.chord)).toEqual(['G', 'C']);
    });
});

describe('splitSectionOnBlankLines', () => {
    it('splits a card at blank lines into auto-numbered sections of the same type', () => {
        const d = parseSong('{start_of_verse: Verse 1}\n[G]line one\n\nline two\n\nline three\n{end_of_verse}');
        const next = splitSectionOnBlankLines(d, d.sections[0].id);
        expect(next.sections).toHaveLength(3);
        expect(next.sections.map(s => s.label)).toEqual(['Verse 1', 'Verse 2', 'Verse 3']);
        expect(next.sections[0].id).toBe(d.sections[0].id);        // first keeps identity
        expect(next.sections[0].lines[0].chords[0].chord).toBe('G'); // chords travel with lines
        expect(next.sections[1].lines[0].lyrics).toBe('line two');
    });

    it('is a no-op when there are no internal blank lines', () => {
        const d = parseSong('{start_of_verse: Verse 1}\nonly line\n{end_of_verse}');
        const next = splitSectionOnBlankLines(d, d.sections[0].id);
        expect(next.sections).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run docs/js/__tests__/visual-editor-model-sections.test.js`
Expected: FAIL — `addSection` is not exported.

- [ ] **Step 3: Append section ops and `updateLyrics` to `model.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run docs/js/__tests__/visual-editor-model-sections.test.js`
Expected: PASS. Then `npx vitest run` — full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/js/visual-editor/model.js docs/js/__tests__/visual-editor-model-sections.test.js
git commit -m "feat(visual-editor): section operations and lyric-edit chord re-anchoring"
```

---

### Task 4: `syllables.js` — view-layer syllable tokenizer

**Files:**
- Create: `docs/js/visual-editor/syllables.js`
- Test: `docs/js/__tests__/visual-editor-syllables.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Task 6):
  - `syllabify(word: string) → string[]` (heuristic; concatenation always equals input)
  - `tokenizeLine(lyrics: string, chordPositions: number[]) → [{ text, start }]` — non-whitespace tap targets; seams from word boundaries, hyphens, heuristic syllables, and the given chord offsets. Every in-word chord offset is guaranteed to be some token's `start`.

- [ ] **Step 1: Write the failing tests**

Create `docs/js/__tests__/visual-editor-syllables.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { syllabify, tokenizeLine } from '../visual-editor/syllables.js';

describe('syllabify', () => {
    it('splits multi-syllable words', () => {
        expect(syllabify('senses').join('|')).toBe('sen|ses');
        expect(syllabify('forest').length).toBeGreaterThan(1);
    });
    it('keeps single-syllable words whole', () => {
        expect(syllabify('heart')).toEqual(['heart']);
    });
    it('always reconstructs the input exactly', () => {
        for (const w of ['spring-time', "cheatin'", 'a', 'XYZ', '123', 'mountains']) {
            expect(syllabify(w).join('')).toBe(w);
        }
    });
});

describe('tokenizeLine', () => {
    it('splits on hyphens like the corpus uses (sen-ses → sen + -ses)', () => {
        const tokens = tokenizeLine('my sen-ses', []);
        const senses = tokens.filter(t => t.start >= 3);
        expect(senses[0]).toEqual({ text: 'sen', start: 3 });
        expect(senses[1]).toEqual({ text: '-ses', start: 6 });
    });

    it('forces a seam at an existing mid-word chord offset', () => {
        // "D[D/F]own the street" → chord at offset 1 of "Down"
        const tokens = tokenizeLine('Down the street', [1]);
        expect(tokens[0]).toEqual({ text: 'D', start: 0 });
        expect(tokens[1].start).toBe(1);
        expect(tokens[1].text.startsWith('o')).toBe(true);
    });

    it('every in-word chord offset is a token start', () => {
        const lyrics = 'You fill up my senses like a night';
        for (const pos of [0, 4, 9, 12, 15, 18, 22]) {
            const tokens = tokenizeLine(lyrics, [pos]);
            if (lyrics[pos] !== ' ') {
                expect(tokens.some(t => t.start === pos), `pos ${pos}`).toBe(true);
            }
        }
    });

    it('token texts reconstruct the words (whitespace excluded)', () => {
        const lyrics = 'hello  big world';
        const tokens = tokenizeLine(lyrics, []);
        expect(tokens.map(t => t.text).join('')).toBe('hellobigworld');
    });

    it('returns no tokens for blank lines', () => {
        expect(tokenizeLine('   ', [])).toEqual([]);
        expect(tokenizeLine('', [])).toEqual([]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run docs/js/__tests__/visual-editor-syllables.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `syllables.js`**

```js
// View-layer syllable tokenizer for the visual editor.
// Syllables are TAP TARGETS only — they never appear in the SongDocument
// model, which anchors chords to character offsets (see model.js).

// Heuristic syllabifier: split into (consonants + vowel-group + trailing
// consonants-at-end) chunks. Imperfect by design; seams are merged with
// hyphen and chord-offset seams in tokenizeLine.
export function syllabify(word) {
    const m = word.match(/[^aeiouyAEIOUY]*[aeiouyAEIOUY]+(?:[^aeiouyAEIOUY]+$)?/g);
    if (!m || m.join('') !== word) return [word];
    return m;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run docs/js/__tests__/visual-editor-syllables.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/js/visual-editor/syllables.js docs/js/__tests__/visual-editor-syllables.test.js
git commit -m "feat(visual-editor): syllable tokenizer for tap targets"
```

---

### Task 5: `palette.js` — docked chord palette component

**Files:**
- Create: `docs/js/visual-editor/palette.js`
- Test: `docs/js/__tests__/visual-editor-palette.test.js`

**Interfaces:**
- Consumes: `getDiatonicChords(key, use7ths)` from `docs/js/chord-explorer/theory.js` (returns `[{root, quality, numeral, display, ...}]`); `CHROMATIC_MAJOR_KEYS` from `docs/js/chords.js`.
- Produces (used by Task 7):
  - `createPalette({ onPick(chord), onDelete(), onClose() }) → { el, showFor({existingChord}), hide(), setKey(key), setRecents(chords) }`
  - `el` is a detached `div.ve-palette` the orchestrator appends. `showFor({existingChord: 'G'|null})` reveals it; delete button visible only when `existingChord` is set.

- [ ] **Step 1: Write the failing tests**

Create `docs/js/__tests__/visual-editor-palette.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPalette } from '../visual-editor/palette.js';

let onPick, onDelete, onClose, palette;
beforeEach(() => {
    onPick = vi.fn(); onDelete = vi.fn(); onClose = vi.fn();
    palette = createPalette({ onPick, onDelete, onClose });
    document.body.appendChild(palette.el);
});

describe('createPalette', () => {
    it('renders diatonic chips for the key, including V7', () => {
        palette.setKey('C');
        const chips = [...palette.el.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(chips).toContain('C');
        expect(chips).toContain('F');
        expect(chips).toContain('G');
        expect(chips).toContain('G7');
        expect(chips).toContain('Am');
    });

    it('fires onPick with the chord when a chip is tapped', () => {
        palette.setKey('G');
        palette.showFor({ existingChord: null });
        palette.el.querySelector('.ve-palette-diatonic .ve-chip-btn').click();
        expect(onPick).toHaveBeenCalledWith('G');
    });

    it('renders recents and picks from them', () => {
        palette.setRecents(['D7', 'Bm']);
        const chips = [...palette.el.querySelectorAll('.ve-palette-recents .ve-chip-btn')]
            .map(b => b.textContent);
        expect(chips).toEqual(['D7', 'Bm']);
        palette.el.querySelector('.ve-palette-recents .ve-chip-btn').click();
        expect(onPick).toHaveBeenCalledWith('D7');
    });

    it('shows delete button only when editing an existing chord', () => {
        palette.showFor({ existingChord: null });
        expect(palette.el.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(true);
        palette.showFor({ existingChord: 'G' });
        expect(palette.el.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(false);
        palette.el.querySelector('.ve-palette-delete').click();
        expect(onDelete).toHaveBeenCalled();
    });

    it('More… reveals the root x quality grid and picks compose', () => {
        palette.el.querySelector('.ve-palette-more').click();
        const grid = palette.el.querySelector('.ve-palette-more-grid');
        expect(grid.classList.contains('hidden')).toBe(false);
        const bm7 = [...grid.querySelectorAll('.ve-chip-btn')].find(b => b.textContent === 'Bm7');
        bm7.click();
        expect(onPick).toHaveBeenCalledWith('Bm7');
    });

    it('custom text input submits any chord on Enter', () => {
        palette.el.querySelector('.ve-palette-more').click();
        const input = palette.el.querySelector('.ve-palette-custom');
        input.value = 'F#dim';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onPick).toHaveBeenCalledWith('F#dim');
    });

    it('hide()/showFor() toggle visibility; Done fires onClose', () => {
        palette.showFor({ existingChord: null });
        expect(palette.el.classList.contains('hidden')).toBe(false);
        palette.el.querySelector('.ve-palette-close').click();
        expect(onClose).toHaveBeenCalled();
        palette.hide();
        expect(palette.el.classList.contains('hidden')).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run docs/js/__tests__/visual-editor-palette.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `palette.js`**

```js
// Docked chord palette: diatonic chips for the detected key, recents from
// the current song, a root x quality grid, and free-text entry.

import { getDiatonicChords } from '../chord-explorer/theory.js';
import { CHROMATIC_MAJOR_KEYS } from '../chords.js';

const GRID_QUALITIES = ['', 'm', '7', 'm7'];

function chipButton(label, onTap) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 've-chip-btn';
    b.textContent = label;
    b.addEventListener('click', () => onTap(label));
    return b;
}

export function createPalette({ onPick, onDelete, onClose }) {
    const el = document.createElement('div');
    el.className = 've-palette hidden';

    const diatonicRow = document.createElement('div');
    diatonicRow.className = 've-palette-row ve-palette-diatonic';
    const recentsRow = document.createElement('div');
    recentsRow.className = 've-palette-row ve-palette-recents';

    const actionsRow = document.createElement('div');
    actionsRow.className = 've-palette-row ve-palette-actions';

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 've-palette-more';
    moreBtn.textContent = 'More…';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 've-palette-delete hidden';
    deleteBtn.textContent = '✕ Remove';
    deleteBtn.addEventListener('click', () => onDelete());

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 've-palette-close';
    closeBtn.textContent = 'Done';
    closeBtn.addEventListener('click', () => onClose());

    actionsRow.append(moreBtn, deleteBtn, closeBtn);

    const moreGrid = document.createElement('div');
    moreGrid.className = 've-palette-more-grid hidden';
    for (const root of CHROMATIC_MAJOR_KEYS) {
        for (const q of GRID_QUALITIES) {
            moreGrid.appendChild(chipButton(root + q, c => onPick(c)));
        }
    }
    const custom = document.createElement('input');
    custom.type = 'text';
    custom.className = 've-palette-custom';
    custom.placeholder = 'Any chord (e.g. Bbmaj7)';
    custom.addEventListener('keydown', e => {
        if (e.key === 'Enter' && custom.value.trim()) {
            onPick(custom.value.trim());
            custom.value = '';
        }
    });
    moreGrid.appendChild(custom);

    moreBtn.addEventListener('click', () => moreGrid.classList.toggle('hidden'));

    el.append(diatonicRow, recentsRow, actionsRow, moreGrid);

    return {
        el,
        setKey(key) {
            diatonicRow.textContent = '';
            if (!key) return;
            const root = key.replace(/m$/, '');
            const chords = getDiatonicChords(root, false);
            if (!chords.length) return;
            const labels = chords.map(c => c.display);
            const v7 = chords[4] ? chords[4].root + '7' : null;
            if (v7 && !labels.includes(v7)) labels.splice(5, 0, v7);
            for (const label of labels) diatonicRow.appendChild(chipButton(label, c => onPick(c)));
        },
        setRecents(list) {
            recentsRow.textContent = '';
            for (const chord of list) recentsRow.appendChild(chipButton(chord, c => onPick(c)));
        },
        showFor({ existingChord }) {
            deleteBtn.classList.toggle('hidden', !existingChord);
            el.classList.remove('hidden');
        },
        hide() {
            el.classList.add('hidden');
            moreGrid.classList.add('hidden');
        }
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run docs/js/__tests__/visual-editor-palette.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/js/visual-editor/palette.js docs/js/__tests__/visual-editor-palette.test.js
git commit -m "feat(visual-editor): docked chord palette component"
```

---

### Task 6: `section-card.js` — section card renderer

**Files:**
- Create: `docs/js/visual-editor/section-card.js`
- Test: `docs/js/__tests__/visual-editor-section-card.test.js`

**Interfaces:**
- Consumes: `tokenizeLine` (Task 4).
- Produces (used by Task 7):
  - `renderSectionCard(section, ctx) → HTMLElement`
  - `ctx = { mode: 'chords'|'lyrics', selection, callbacks }` where
    `selection = { sectionId, lineIndex, position, chordIndex? } | null` and
    `callbacks = { onSyllableTap(sectionId, lineIndex, position), onChipTap(sectionId, lineIndex, chordIndex), onToggleMode(sectionId, mode), onMenuAction(sectionId, action), onLyricsCommit(sectionId, text) }`.
    Menu actions: `'type-verse' | 'type-chorus' | 'type-bridge' | 'type-intro' | 'type-outro' | 'rename' | 'duplicate' | 'move-up' | 'move-down' | 'delete'`.
- DOM contract (used by Task 7's delegation and Task 9's E2E):
  - card root: `div.ve-card[data-section-id]`
  - syllable: `span.ve-syl[data-line][data-start]`; selected → `.ve-syl-selected`
  - chip: `button.ve-chip[data-line][data-chord-index]`; selected → `.ve-chip-selected`
  - end slot: `button.ve-end-slot[data-line][data-start]`
  - lyrics textarea: `textarea.ve-lyrics-input`

- [ ] **Step 1: Write the failing tests**

Create `docs/js/__tests__/visual-editor-section-card.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSectionCard } from '../visual-editor/section-card.js';

const SECTION = {
    id: 'sec-1', type: 'verse', label: 'Verse 1', implicit: false,
    openRaw: null, closeRaw: null,
    lines: [
        { lyrics: 'Down the street', chords: [{ chord: 'D/F', position: 1 }] },
        { lyrics: 'no chords here', chords: [] },
        { lyrics: ' ', chords: [{ chord: 'G', position: 0 }] }   // chord-only line
    ]
};

function makeCtx(overrides = {}) {
    return {
        mode: 'chords',
        selection: null,
        callbacks: {
            onSyllableTap: vi.fn(), onChipTap: vi.fn(), onToggleMode: vi.fn(),
            onMenuAction: vi.fn(), onLyricsCommit: vi.fn()
        },
        ...overrides
    };
}

describe('renderSectionCard — chords mode', () => {
    it('renders the label and syllable tap targets with offsets', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        expect(card.dataset.sectionId).toBe('sec-1');
        expect(card.querySelector('.ve-card-label').textContent).toBe('Verse 1');
        const syls = card.querySelectorAll('.ve-line[data-line="0"] .ve-syl');
        expect(syls[0].dataset.start).toBe('0');
        expect(syls[0].textContent.startsWith('D')).toBe(true);
    });

    it('renders chips over the token at the chord position', () => {
        const card = renderSectionCard(SECTION, makeCtx());
        const chip = card.querySelector('.ve-line[data-line="0"] .ve-chip');
        expect(chip.textContent).toBe('D/F');
        expect(chip.dataset.chordIndex).toBe('0');
    });

    it('fires onSyllableTap with section, line, and offset', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        card.querySelector('.ve-line[data-line="1"] .ve-syl').click();
        expect(ctx.callbacks.onSyllableTap).toHaveBeenCalledWith('sec-1', 1, 0);
    });

    it('fires onChipTap when a chip is tapped', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        card.querySelector('.ve-chip').click();
        expect(ctx.callbacks.onChipTap).toHaveBeenCalledWith('sec-1', 0, 0);
    });

    it('marks the selected syllable', () => {
        const ctx = makeCtx({ selection: { sectionId: 'sec-1', lineIndex: 1, position: 0 } });
        const card = renderSectionCard(SECTION, ctx);
        const sel = card.querySelector('.ve-syl-selected');
        expect(sel.dataset.line).toBe('1');
        expect(sel.dataset.start).toBe('0');
    });

    it('renders an end slot per line and chip rows for chord-only lines', () => {
        const card = renderSectionCard(SECTION, makeCtx());
        expect(card.querySelectorAll('.ve-end-slot')).toHaveLength(3);
        const chordOnly = card.querySelector('.ve-line[data-line="2"] .ve-chip');
        expect(chordOnly.textContent).toBe('G');
    });

    it('renders opaque lines as non-interactive raw text', () => {
        const sec = { ...SECTION, lines: [{ lyrics: '{comment: soft}', chords: [], opaque: true }] };
        const card = renderSectionCard(sec, makeCtx());
        expect(card.querySelector('.ve-line-opaque').textContent).toBe('{comment: soft}');
        expect(card.querySelector('.ve-line-opaque .ve-syl')).toBeNull();
    });
});

describe('renderSectionCard — lyrics mode', () => {
    it('shows a textarea with the plain lyrics and commits on blur', () => {
        const ctx = makeCtx({ mode: 'lyrics' });
        const card = renderSectionCard(SECTION, ctx);
        const ta = card.querySelector('.ve-lyrics-input');
        expect(ta.value).toBe('Down the street\nno chords here\n ');
        ta.value = 'changed text';
        ta.dispatchEvent(new Event('blur'));
        expect(ctx.callbacks.onLyricsCommit).toHaveBeenCalledWith('sec-1', 'changed text');
    });
});

describe('header controls', () => {
    it('mode toggle fires onToggleMode', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        card.querySelector('.ve-mode-lyrics').click();
        expect(ctx.callbacks.onToggleMode).toHaveBeenCalledWith('sec-1', 'lyrics');
    });

    it('menu actions fire onMenuAction', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        card.querySelector('.ve-card-menu-btn').click();
        card.querySelector('[data-action="type-chorus"]').click();
        expect(ctx.callbacks.onMenuAction).toHaveBeenCalledWith('sec-1', 'type-chorus');
        card.querySelector('[data-action="delete"]').click();
        expect(ctx.callbacks.onMenuAction).toHaveBeenCalledWith('sec-1', 'delete');
    });

    it('renders passthrough sections read-only', () => {
        const card = renderSectionCard(
            { id: 'sec-9', type: 'passthrough', raw: '{start_of_abc}\nX:1\n{end_of_abc}' },
            makeCtx());
        expect(card.classList.contains('ve-card-passthrough')).toBe(true);
        expect(card.querySelector('.ve-passthrough-raw').textContent).toContain('X:1');
        expect(card.querySelector('.ve-syl')).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run docs/js/__tests__/visual-editor-section-card.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `section-card.js`**

```js
// Renders one section as a block card. Chords mode shows syllable tap
// targets with chord chips above them; lyrics mode shows a plain textarea.
// All lyric text is set via textContent (never innerHTML).

import { tokenizeLine } from './syllables.js';

const MENU_ACTIONS = [
    ['type-verse', 'Make Verse'], ['type-chorus', 'Make Chorus'],
    ['type-bridge', 'Make Bridge'], ['type-intro', 'Make Intro'],
    ['type-outro', 'Make Outro'], ['rename', 'Rename…'],
    ['duplicate', 'Duplicate'], ['move-up', 'Move up'],
    ['move-down', 'Move down'], ['delete', 'Delete']
];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function renderChordsLine(section, line, li, ctx) {
    const row = el('div', 've-line');
    row.dataset.line = String(li);

    if (line.opaque) {
        row.classList.add('ve-line-opaque');
        row.textContent = line.lyrics;
        return row;
    }

    const { selection, callbacks } = ctx;
    const positions = line.chords.map(c => c.position);
    const tokens = tokenizeLine(line.lyrics, positions);

    // group chords by the token that displays them: first token with
    // start >= position; chords past the last token go to the end slot
    const byToken = new Map();
    const atEnd = [];
    line.chords.forEach((c, ci) => {
        const ti = tokens.findIndex(t => t.start >= c.position);
        if (ti === -1) atEnd.push(ci);
        else byToken.set(ti, [...(byToken.get(ti) || []), ci]);
    });

    const isSelected = (start) => selection &&
        selection.sectionId === section.id && selection.lineIndex === li &&
        selection.position === start && selection.chordIndex === undefined;
    const chipSelected = (ci) => selection &&
        selection.sectionId === section.id && selection.lineIndex === li &&
        selection.chordIndex === ci;

    const makeChips = (indices) => {
        const chips = el('span', 've-chips');
        for (const ci of indices) {
            const chip = el('button', 've-chip', line.chords[ci].chord);
            chip.type = 'button';
            chip.dataset.line = String(li);
            chip.dataset.chordIndex = String(ci);
            if (chipSelected(ci)) chip.classList.add('ve-chip-selected');
            chip.addEventListener('click', () => callbacks.onChipTap(section.id, li, ci));
            chips.appendChild(chip);
        }
        return chips;
    };

    tokens.forEach((token, ti) => {
        const seg = el('span', 've-seg');
        seg.appendChild(makeChips(byToken.get(ti) || []));
        const nextStart = ti + 1 < tokens.length ? tokens[ti + 1].start : line.lyrics.length;
        const syl = el('span', 've-syl',
            token.text + line.lyrics.slice(token.start + token.text.length, nextStart));
        syl.dataset.line = String(li);
        syl.dataset.start = String(token.start);
        if (isSelected(token.start)) syl.classList.add('ve-syl-selected');
        syl.addEventListener('click', () => callbacks.onSyllableTap(section.id, li, token.start));
        seg.appendChild(syl);
        row.appendChild(seg);
    });

    // end slot: place/display trailing chords
    const endSeg = el('span', 've-seg ve-seg-end');
    endSeg.appendChild(makeChips(atEnd));
    const endSlot = el('button', 've-end-slot', '+');
    endSlot.type = 'button';
    endSlot.dataset.line = String(li);
    endSlot.dataset.start = String(line.lyrics.length);
    if (isSelected(line.lyrics.length)) endSlot.classList.add('ve-syl-selected');
    endSlot.addEventListener('click', () => callbacks.onSyllableTap(section.id, li, line.lyrics.length));
    endSeg.appendChild(endSlot);
    row.appendChild(endSeg);

    return row;
}

export function renderSectionCard(section, ctx) {
    const card = el('div', 've-card');
    card.dataset.sectionId = section.id;

    if (section.type === 'passthrough') {
        card.classList.add('ve-card-passthrough');
        const header = el('div', 've-card-header');
        header.appendChild(el('span', 've-card-label', 'Raw block (edit in Raw tab)'));
        card.appendChild(header);
        card.appendChild(el('pre', 've-passthrough-raw', section.raw));
        return card;
    }

    const { mode, callbacks } = ctx;

    const header = el('div', 've-card-header');
    header.appendChild(el('span', 've-card-label', section.label));

    const toggle = el('div', 've-mode-toggle');
    const lyricsBtn = el('button', 've-mode-btn ve-mode-lyrics', '✎ Lyrics');
    lyricsBtn.type = 'button';
    const chordsBtn = el('button', 've-mode-btn ve-mode-chords', '♪ Chords');
    chordsBtn.type = 'button';
    (mode === 'lyrics' ? lyricsBtn : chordsBtn).classList.add('active');
    lyricsBtn.addEventListener('click', () => callbacks.onToggleMode(section.id, 'lyrics'));
    chordsBtn.addEventListener('click', () => callbacks.onToggleMode(section.id, 'chords'));
    toggle.append(lyricsBtn, chordsBtn);
    header.appendChild(toggle);

    const menuBtn = el('button', 've-card-menu-btn', '⋯');
    menuBtn.type = 'button';
    header.appendChild(menuBtn);
    card.appendChild(header);

    const menu = el('div', 've-card-menu hidden');
    for (const [action, label] of MENU_ACTIONS) {
        const b = el('button', 've-menu-item', label);
        b.type = 'button';
        b.dataset.action = action;
        b.addEventListener('click', () => {
            menu.classList.add('hidden');
            callbacks.onMenuAction(section.id, action);
        });
        menu.appendChild(b);
    }
    menuBtn.addEventListener('click', () => menu.classList.toggle('hidden'));
    card.appendChild(menu);

    const body = el('div', 've-card-body');
    if (mode === 'lyrics') {
        const ta = document.createElement('textarea');
        ta.className = 've-lyrics-input';
        ta.value = section.lines.filter(l => !l.opaque).map(l => l.lyrics).join('\n');
        ta.rows = Math.max(3, section.lines.length + 1);
        ta.addEventListener('blur', () => callbacks.onLyricsCommit(section.id, ta.value));
        body.appendChild(ta);
    } else {
        section.lines.forEach((line, li) => {
            body.appendChild(renderChordsLine(section, line, li, ctx));
        });
        if (section.lines.length === 0) {
            body.appendChild(el('div', 've-empty-hint', 'No lyrics yet — switch to ✎ Lyrics to type or paste.'));
        }
    }
    card.appendChild(body);
    return card;
}
```

**Note:** lyrics mode joins only non-opaque lines; `onLyricsCommit` → `updateLyrics` replaces the section's lines, so opaque lines in a section the user text-edits are dropped from that section — acceptable v1 behavior since opaque lines are rare and the toast reports dropped chords. Blank lines are preserved (they round-trip through the textarea).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run docs/js/__tests__/visual-editor-section-card.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/js/visual-editor/section-card.js docs/js/__tests__/visual-editor-section-card.test.js
git commit -m "feat(visual-editor): section card renderer with syllable tap targets"
```

---

### Task 7: `visual-editor.js` — orchestrator with undo and selection

**Files:**
- Create: `docs/js/visual-editor/visual-editor.js`
- Test: `docs/js/__tests__/visual-editor-orchestrator.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–6; `detectKey(chords)` from `docs/js/chords.js`.
- Produces (used by Task 8):
  - `createVisualEditor({ container, onChange(chordproString) }) → { loadChordPro(text), getChordPro() → string, isEmpty() → boolean, destroy() }`
  - `onChange` fires with the full serialized ChordPro after every model change (this is what mirrors into the raw textarea).
- Behavior contract:
  - Tap syllable with no chip selected → select syllable, show palette.
  - Palette pick with syllable selected → `placeChord`, clear selection, palette stays open.
  - Tap chip → select chip, palette shows with Remove.
  - Palette pick with chip selected → `changeChord`.
  - Tap syllable with chip selected → `moveChord` to that offset.
  - Remove with chip selected → `removeChord`.
  - Undo/redo buttons; every op pushes to undo stack (cap 50).
  - Lyrics commit runs `updateLyrics`, then `splitSectionOnBlankLines` (pasted multi-paragraph lyrics become separate cards); if `droppedChords > 0` show `.ve-toast` with an Undo button.
  - Toolbar: undo, redo, transpose −/+; footer: "⊕ Add section" with type picker.
  - New empty sections default to lyrics mode; sections with lines default to chords mode.

- [ ] **Step 1: Write the failing tests**

Create `docs/js/__tests__/visual-editor-orchestrator.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVisualEditor } from '../visual-editor/visual-editor.js';

const SRC = `{meta: title Test Song}

{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}
`;

let container, onChange, editor;
beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    onChange = vi.fn();
    editor = createVisualEditor({ container, onChange });
    editor.loadChordPro(SRC);
});

function tapSyllable(text) {
    const syl = [...container.querySelectorAll('.ve-syl')]
        .find(s => s.textContent.trim().startsWith(text));
    syl.click();
    return syl;
}

function pickChord(chord) {
    const btn = [...container.querySelectorAll('.ve-palette .ve-chip-btn')]
        .find(b => b.textContent === chord);
    btn.click();
}

describe('place / move / remove flow', () => {
    it('tap syllable then pick places a chord and fires onChange', () => {
        tapSyllable('world');
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        pickChord('C');
        expect(editor.getChordPro()).toContain('[G]hello [C]world friend');
        expect(onChange).toHaveBeenCalledWith(expect.stringContaining('[C]world'));
    });

    it('tap chip then Remove deletes the chord', () => {
        container.querySelector('.ve-chip').click();
        container.querySelector('.ve-palette-delete').click();
        expect(editor.getChordPro()).not.toContain('[G]');
    });

    it('tap chip then pick replaces the chord', () => {
        container.querySelector('.ve-chip').click();
        pickChord('Em');
        expect(editor.getChordPro()).toContain('[Em]hello');
    });

    it('tap chip then tap syllable moves the chord', () => {
        container.querySelector('.ve-chip').click();
        tapSyllable('friend');
        expect(editor.getChordPro()).toContain('hello world [G]friend');
    });
});

describe('undo / redo', () => {
    it('undo reverts the last op; redo reapplies it', () => {
        tapSyllable('world');
        pickChord('C');
        container.querySelector('.ve-undo').click();
        expect(editor.getChordPro()).not.toContain('[C]');
        container.querySelector('.ve-redo').click();
        expect(editor.getChordPro()).toContain('[C]world');
    });
});

describe('sections', () => {
    it('add-section footer appends a card (new sections open in lyrics mode)', () => {
        container.querySelector('.ve-add-section').click();
        container.querySelector('[data-add-type="chorus"]').click();
        const cards = container.querySelectorAll('.ve-card');
        expect(cards).toHaveLength(2);
        expect(cards[1].querySelector('.ve-card-label').textContent).toBe('Chorus');
        expect(cards[1].querySelector('.ve-lyrics-input')).not.toBeNull();
    });

    it('lyric edits that drop chords show an undoable toast', () => {
        const card = container.querySelector('.ve-card');
        card.querySelector('.ve-mode-lyrics').click();
        const ta = container.querySelector('.ve-lyrics-input');
        ta.value = 'totally new words';
        ta.dispatchEvent(new Event('blur'));
        const toast = container.querySelector('.ve-toast');
        expect(toast.textContent).toContain('1 chord');
        toast.querySelector('.ve-toast-undo').click();
        expect(editor.getChordPro()).toContain('[G]hello world friend');
    });
});

describe('transpose', () => {
    it('toolbar transpose shifts all chords', () => {
        container.querySelector('.ve-transpose-up').click();
        // chords.js may spell the result sharp or flat — accept either
        expect(editor.getChordPro()).toMatch(/\[(G#|Ab)\]hello/);
    });
});

describe('paste-split', () => {
    it('committing multi-paragraph lyrics splits the card into sections', () => {
        const card = container.querySelector('.ve-card');
        card.querySelector('.ve-mode-lyrics').click();
        const ta = container.querySelector('.ve-lyrics-input');
        ta.value = 'hello world friend\n\nsecond verse text here';
        ta.dispatchEvent(new Event('blur'));
        const labels = [...container.querySelectorAll('.ve-card-label')].map(e => e.textContent);
        expect(labels).toEqual(['Verse 1', 'Verse 2']);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run docs/js/__tests__/visual-editor-orchestrator.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `visual-editor.js`**

```js
// Visual editor orchestrator: owns the SongDocument, selection, undo/redo,
// and re-rendering. Fires onChange(chordpro) after every model change so the
// host can mirror into the raw textarea.

import {
    parseSong, serializeSong, placeChord, moveChord, changeChord, removeChord,
    transposeDoc, allChords, addSection, setSectionType, relabelSection,
    moveSection, duplicateSection, deleteSection, updateLyrics,
    splitSectionOnBlankLines
} from './model.js';
import { renderSectionCard } from './section-card.js';
import { createPalette } from './palette.js';
import { detectKey } from '../chords.js';

const UNDO_CAP = 50;
const SECTION_TYPES = ['verse', 'chorus', 'bridge', 'intro', 'outro'];

export function createVisualEditor({ container, onChange }) {
    let doc = parseSong('');
    let selection = null;            // {sectionId, lineIndex, position} or {..., chordIndex}
    let undoStack = [];
    let redoStack = [];
    const modes = new Map();         // sectionId → 'chords' | 'lyrics'

    container.classList.add('ve-root');

    const toolbar = document.createElement('div');
    toolbar.className = 've-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="ve-undo" title="Undo">↩ Undo</button>
        <button type="button" class="ve-redo" title="Redo">↪ Redo</button>
        <span class="ve-toolbar-spacer"></span>
        <button type="button" class="ve-transpose-down" title="Transpose down">−</button>
        <span class="ve-key-label"></span>
        <button type="button" class="ve-transpose-up" title="Transpose up">+</button>`;

    const cardsHost = document.createElement('div');
    cardsHost.className = 've-cards';

    const footer = document.createElement('div');
    footer.className = 've-footer';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 've-add-section';
    addBtn.textContent = '⊕ Add section';
    const addTypes = document.createElement('div');
    addTypes.className = 've-add-types hidden';
    for (const t of SECTION_TYPES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.addType = t;
        b.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        b.addEventListener('click', () => {
            addTypes.classList.add('hidden');
            apply(addSection(doc, t));
            const added = doc.sections[doc.sections.length - 1];
            modes.set(added.id, 'lyrics');
            render();
        });
        addTypes.appendChild(b);
    }
    addBtn.addEventListener('click', () => addTypes.classList.toggle('hidden'));
    footer.append(addBtn, addTypes);

    const toast = document.createElement('div');
    toast.className = 've-toast hidden';

    const palette = createPalette({
        onPick(chord) {
            if (!selection) return;
            if (selection.chordIndex !== undefined) {
                apply(changeChord(doc, selection.sectionId, selection.lineIndex, selection.chordIndex, chord));
                selection = null;
            } else {
                apply(placeChord(doc, selection.sectionId, selection.lineIndex, selection.position, chord));
                selection = null;
            }
            render();
        },
        onDelete() {
            if (selection?.chordIndex === undefined) return;
            apply(removeChord(doc, selection.sectionId, selection.lineIndex, selection.chordIndex));
            selection = null;
            palette.hide();
            render();
        },
        onClose() {
            selection = null;
            palette.hide();
            render();
        }
    });

    container.append(toolbar, cardsHost, footer, palette.el, toast);

    toolbar.querySelector('.ve-undo').addEventListener('click', undo);
    toolbar.querySelector('.ve-redo').addEventListener('click', redo);
    toolbar.querySelector('.ve-transpose-up').addEventListener('click', () => { apply(transposeDoc(doc, 1)); render(); });
    toolbar.querySelector('.ve-transpose-down').addEventListener('click', () => { apply(transposeDoc(doc, -1)); render(); });

    function apply(nextDoc) {
        undoStack.push(doc);
        if (undoStack.length > UNDO_CAP) undoStack.shift();
        redoStack = [];
        doc = nextDoc;
        emit();
    }

    function emit() {
        if (onChange) onChange(serializeSong(doc));
    }

    function undo() {
        if (!undoStack.length) return;
        redoStack.push(doc);
        doc = undoStack.pop();
        selection = null;
        emit();
        render();
    }

    function redo() {
        if (!redoStack.length) return;
        undoStack.push(doc);
        doc = redoStack.pop();
        selection = null;
        emit();
        render();
    }

    function showToast(message) {
        toast.textContent = '';
        toast.append(message + ' ');
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 've-toast-undo';
        undoBtn.textContent = 'Undo';
        undoBtn.addEventListener('click', () => { toast.classList.add('hidden'); undo(); });
        toast.appendChild(undoBtn);
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 8000);
    }

    function currentKey() {
        if (doc.metadata.fields.key) return doc.metadata.fields.key;
        // fall back to G (the bluegrass default) so a brand-new song still
        // gets a usable diatonic palette before any chords exist
        return detectKey(allChords(doc)).key || 'G';
    }

    function recents() {
        const freq = new Map();
        for (const c of allChords(doc)) freq.set(c, (freq.get(c) || 0) + 1);
        return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
    }

    const callbacks = {
        onSyllableTap(sectionId, lineIndex, position) {
            if (selection?.chordIndex !== undefined) {
                // a chip is selected → move it here (also across lines/sections? v1: same line only)
                if (selection.sectionId === sectionId && selection.lineIndex === lineIndex) {
                    apply(moveChord(doc, sectionId, lineIndex, selection.chordIndex, position));
                    selection = null;
                    render();
                    return;
                }
            }
            selection = { sectionId, lineIndex, position };
            palette.setKey(currentKey());
            palette.setRecents(recents());
            palette.showFor({ existingChord: null });
            render();
        },
        onChipTap(sectionId, lineIndex, chordIndex) {
            selection = { sectionId, lineIndex, chordIndex };
            palette.setKey(currentKey());
            palette.setRecents(recents());
            const sec = doc.sections.find(s => s.id === sectionId);
            palette.showFor({ existingChord: sec.lines[lineIndex].chords[chordIndex].chord });
            render();
        },
        onToggleMode(sectionId, mode) {
            modes.set(sectionId, mode);
            selection = null;
            palette.hide();
            render();
        },
        onMenuAction(sectionId, action) {
            if (action.startsWith('type-')) {
                apply(setSectionType(doc, sectionId, action.slice(5)));
            } else if (action === 'rename') {
                const sec = doc.sections.find(s => s.id === sectionId);
                const label = window.prompt('Section label:', sec.label);
                if (!label) return;
                apply(relabelSection(doc, sectionId, label));
            } else if (action === 'duplicate') {
                apply(duplicateSection(doc, sectionId));
            } else if (action === 'move-up') {
                apply(moveSection(doc, sectionId, -1));
            } else if (action === 'move-down') {
                apply(moveSection(doc, sectionId, 1));
            } else if (action === 'delete') {
                apply(deleteSection(doc, sectionId));
            }
            render();
        },
        onLyricsCommit(sectionId, text) {
            const sec = doc.sections.find(s => s.id === sectionId);
            const current = sec.lines.filter(l => !l.opaque).map(l => l.lyrics).join('\n');
            if (text === current) return;
            let { doc: next, droppedChords } = updateLyrics(doc, sectionId, text);
            // pasted multi-paragraph lyrics: split the card at blank lines
            next = splitSectionOnBlankLines(next, sectionId);
            apply(next);
            if (droppedChords > 0) {
                showToast(`${droppedChords} chord${droppedChords === 1 ? '' : 's'} removed with deleted lyrics.`);
            }
            render();
        }
    };

    function render() {
        toolbar.querySelector('.ve-key-label').textContent = currentKey() ? `Key: ${currentKey()}` : 'Key: ?';
        cardsHost.textContent = '';
        for (const sec of doc.sections) {
            const mode = modes.get(sec.id) || (sec.lines && sec.lines.length === 0 ? 'lyrics' : 'chords');
            cardsHost.appendChild(renderSectionCard(sec, { mode, selection, callbacks }));
        }
        if (doc.sections.length === 0) {
            const hint = document.createElement('div');
            hint.className = 've-empty-hint';
            hint.textContent = 'Add a section to get started, or paste lyrics in the Raw tab.';
            cardsHost.appendChild(hint);
        }
    }

    return {
        loadChordPro(text) {
            doc = parseSong(text || '');
            selection = null;
            undoStack = [];
            redoStack = [];
            modes.clear();
            palette.hide();
            render();
        },
        getChordPro() { return serializeSong(doc); },
        isEmpty() { return doc.sections.length === 0; },
        destroy() { container.textContent = ''; container.classList.remove('ve-root'); }
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run docs/js/__tests__/visual-editor-orchestrator.test.js`
Expected: PASS. Then full suite: `npx vitest run` — PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/js/visual-editor/visual-editor.js docs/js/__tests__/visual-editor-orchestrator.test.js
git commit -m "feat(visual-editor): orchestrator with tap-to-place, undo, and sections"
```

---

### Task 8: Tabs, wiring, styles

**Files:**
- Modify: `docs/index.html` (editor panel, ~lines 271-360)
- Modify: `docs/js/editor.js` (tab wiring inside `initEditor`)
- Modify: `docs/js/main.js` (pass new DOM refs into `initEditor`)
- Modify: `docs/css/style.css` (append `.editor-tabs` and `.ve-*` styles)

**Interfaces:**
- Consumes: `createVisualEditor` (Task 7); existing `initEditor(options)`, `updateEditorPreview`, `trackEditor` in `editor.js`.
- Produces: `#editor-tab-visual`, `#editor-tab-raw` buttons; `#visual-editor-container` div; `#editor-raw-main` id added to the existing `.editor-main` div (used by Task 9's E2E).
- Sync rules (implemented in `editor.js`):
  - Visual `onChange` → `editorContentEl.value = chordpro` + `updateEditorPreview()` (mirror; submit/copy/download read the textarea unchanged).
  - Switch to Visual → `loadChordPro(textarea.value)` only if textarea differs from last mirrored string.
  - Switch to Raw → nothing to do (textarea always mirrors).
  - `enterEditMode`/paste replace textarea content → handled by the "differs from last mirror" check on next Visual activation, plus an explicit reload when `enterEditMode` runs while Visual is active.
  - Visual tab is the default.

- [ ] **Step 1: Restructure the editor panel in `docs/index.html`**

Move the `.metadata-fields` div (lines 280-297) out of `.editor-input` to sit directly after `.editor-header` (line 277), then insert the tab bar and visual container between the metadata fields and `.editor-main`, and add `id="editor-raw-main"` to `.editor-main`:

```html
<div id="editor-panel" class="editor-panel hidden">
    <div class="editor-header">
        <button id="editor-back-btn" class="back-btn">&larr; Back</button>
        <div class="editor-notice">
            Submissions are reviewed before being added to the songbook.
        </div>
    </div>

    <div class="metadata-fields">
        <!-- unchanged: editor-title / editor-artist / editor-writer / edit-comment-row rows -->
    </div>

    <div class="editor-tabs">
        <button id="editor-tab-visual" class="editor-tab active" type="button">Visual</button>
        <button id="editor-tab-raw" class="editor-tab" type="button">Raw ChordPro</button>
    </div>

    <div id="visual-editor-container" class="visual-editor-container"></div>

    <div class="editor-main hidden" id="editor-raw-main">
        <div class="editor-input">
            <!-- unchanged: song-input-container, editor-help-row, editor-actions -->
        </div>
        <div class="editor-preview"><!-- unchanged --></div>
    </div>

    <!-- Submit actions must be reachable from BOTH tabs: move the
         .editor-actions div OUT of .editor-input to the bottom of
         #editor-panel (after #editor-raw-main), so Copy/Download/Submit
         and #editor-status are always visible. -->
    <div class="editor-actions">
        <button id="editor-copy" class="action-btn">Copy ChordPro</button>
        <button id="editor-save" class="action-btn">Download .pro</button>
        <button id="editor-submit" class="action-btn primary">Submit to Songbook</button>
        <span id="editor-status" class="save-status"></span>
    </div>
</div>
```

(Keep every existing element id — `editor.js` looks them up via the options object; only their positions change. Remove the now-duplicated `.editor-actions` from inside `.editor-input`.)

- [ ] **Step 2: Wire tabs in `docs/js/editor.js`**

Add at the top of `editor.js`:

```js
import { createVisualEditor } from './visual-editor/visual-editor.js';
```

Add module-level state next to the other DOM refs:

```js
let editorTabVisualEl = null;
let editorTabRawEl = null;
let visualEditorContainerEl = null;
let editorRawMainEl = null;
let visualEditor = null;
let lastMirrored = null;
```

Add these functions:

```js
function activateEditorTab(which) {
    const visual = which === 'visual';
    if (editorTabVisualEl) editorTabVisualEl.classList.toggle('active', visual);
    if (editorTabRawEl) editorTabRawEl.classList.toggle('active', !visual);
    if (visualEditorContainerEl) visualEditorContainerEl.classList.toggle('hidden', !visual);
    if (editorRawMainEl) editorRawMainEl.classList.toggle('hidden', visual);
    if (visual) {
        if (editorContentEl && editorContentEl.value !== lastMirrored) {
            visualEditor.loadChordPro(editorContentEl.value);
            lastMirrored = editorContentEl.value;
        }
        trackEditor('visual_open', editingSongId || 'new');
    }
}

function initVisualEditor() {
    if (!visualEditorContainerEl) return;
    visualEditor = createVisualEditor({
        container: visualEditorContainerEl,
        onChange(chordpro) {
            lastMirrored = chordpro;
            if (editorContentEl) {
                editorContentEl.value = chordpro;
                updateEditorPreview();
            }
        }
    });
    visualEditor.loadChordPro(editorContentEl?.value || '');
    lastMirrored = editorContentEl?.value || '';
}
```

In `initEditor(options)`, destructure the new options and wire them (add alongside the existing assignments):

```js
    // new options: editorTabVisual, editorTabRaw, visualEditorContainer, editorRawMain
    editorTabVisualEl = options.editorTabVisual;
    editorTabRawEl = options.editorTabRaw;
    visualEditorContainerEl = options.visualEditorContainer;
    editorRawMainEl = options.editorRawMain;

    initVisualEditor();
    if (editorTabVisualEl) editorTabVisualEl.addEventListener('click', () => activateEditorTab('visual'));
    if (editorTabRawEl) editorTabRawEl.addEventListener('click', () => activateEditorTab('raw'));
    activateEditorTab('visual');   // visual is the default
```

At the end of `enterEditMode` (after `updateEditorPreview()` at line ~117), reload the visual editor if it's active:

```js
    if (visualEditor && editorTabVisualEl?.classList.contains('active')) {
        visualEditor.loadChordPro(editorContentEl?.value || '');
        lastMirrored = editorContentEl?.value || '';
    }
```

In the paste handler (after `editorContentEl.value = converted; updateEditorPreview();` at ~line 839), no change needed — pastes happen in the raw tab; the differs-from-mirror check reloads on tab switch.

- [ ] **Step 3: Pass the new DOM refs from `docs/js/main.js`**

In main.js's DOM-element section, add:

```js
const editorTabVisual = document.getElementById('editor-tab-visual');
const editorTabRaw = document.getElementById('editor-tab-raw');
const visualEditorContainer = document.getElementById('visual-editor-container');
const editorRawMain = document.getElementById('editor-raw-main');
```

and add them to the existing `initEditor({ ... })` options object:

```js
    editorTabVisual,
    editorTabRaw,
    visualEditorContainer,
    editorRawMain,
```

- [ ] **Step 4: Append styles to `docs/css/style.css`**

```css
/* ===== Editor tabs ===== */
.editor-tabs {
    display: flex;
    gap: 0.25rem;
    margin: 0.5rem 0;
    border-bottom: 2px solid var(--border, #444);
}
.editor-tab {
    padding: 0.5rem 1rem;
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    font-size: 1rem;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
}
.editor-tab.active {
    border-bottom-color: var(--chord, #e0a458);
    font-weight: 600;
}

/* ===== Visual editor ===== */
.visual-editor-container.hidden { display: none; }
.ve-root { padding-bottom: 30vh; } /* room above the docked palette */
.ve-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 5;
}
.ve-toolbar button { min-height: 40px; min-width: 44px; }
.ve-toolbar-spacer { flex: 1; }
.ve-key-label { font-weight: 600; color: var(--chord, #e0a458); }

.ve-card {
    border: 1px solid var(--border, #444);
    border-radius: 8px;
    margin: 0.75rem 0;
    background: var(--card-bg, rgba(128,128,128,0.05));
}
.ve-card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border, #444);
}
.ve-card-label { font-weight: 700; flex: 1; }
.ve-mode-btn {
    min-height: 36px;
    background: none;
    border: 1px solid var(--border, #444);
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    padding: 0 0.5rem;
}
.ve-mode-btn.active { background: var(--chord, #e0a458); color: #000; }
.ve-card-menu-btn { min-height: 36px; min-width: 40px; background: none; border: none; color: var(--text); cursor: pointer; font-size: 1.2rem; }
.ve-card-menu { display: flex; flex-wrap: wrap; gap: 0.25rem; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border, #444); }
.ve-menu-item { min-height: 40px; padding: 0 0.6rem; cursor: pointer; }
.ve-card-body { padding: 0.5rem 0.6rem; overflow-x: auto; }

.ve-line { margin: 0.35rem 0; white-space: pre-wrap; line-height: 1.2; }
.ve-line-opaque { color: var(--text-muted, #888); font-family: monospace; }
.ve-seg { display: inline-block; vertical-align: bottom; white-space: pre-wrap; }
.ve-chips { display: block; min-height: 1.4em; }
.ve-chip {
    display: inline-block;
    background: var(--chord, #e0a458);
    color: #000;
    font-weight: 700;
    border: none;
    border-radius: 4px;
    padding: 0.05em 0.35em;
    margin-right: 2px;
    cursor: pointer;
    font-size: 0.9em;
}
.ve-chip-selected { outline: 3px solid var(--accent, #6ab0f3); }
.ve-syl {
    cursor: pointer;
    border-radius: 3px;
    padding: 0.1em 0;
}
.ve-syl:hover { background: rgba(128, 160, 255, 0.15); }
.ve-syl-selected { background: rgba(106, 176, 243, 0.35); outline: 2px solid var(--accent, #6ab0f3); }
.ve-end-slot {
    background: none;
    border: 1px dashed var(--border, #666);
    border-radius: 4px;
    color: var(--text-muted, #888);
    cursor: pointer;
    min-width: 28px;
    min-height: 28px;
    margin-left: 0.4rem;
}
.ve-lyrics-input {
    width: 100%;
    min-height: 6em;
    font-size: 1rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border, #444);
    border-radius: 6px;
    padding: 0.5rem;
}
.ve-passthrough-raw {
    margin: 0;
    padding: 0.5rem 0.6rem;
    color: var(--text-muted, #888);
    font-size: 0.85rem;
    overflow-x: auto;
}
.ve-footer { padding: 0.5rem 0; }
.ve-add-section { min-height: 44px; padding: 0 1rem; cursor: pointer; }
.ve-add-types { display: flex; gap: 0.4rem; margin-top: 0.4rem; flex-wrap: wrap; }
.ve-add-types button { min-height: 44px; padding: 0 0.8rem; cursor: pointer; }

.ve-palette {
    position: sticky;
    bottom: 0;
    background: var(--bg);
    border-top: 2px solid var(--border, #444);
    padding: 0.5rem;
    z-index: 10;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
}
.ve-palette.hidden { display: none; }
.ve-palette-row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.4rem; }
.ve-chip-btn {
    min-height: 44px;
    min-width: 44px;
    font-size: 1rem;
    font-weight: 700;
    background: var(--card-bg, rgba(128,128,128,0.1));
    color: var(--chord, #e0a458);
    border: 1px solid var(--border, #444);
    border-radius: 8px;
    cursor: pointer;
}
.ve-palette-more-grid { display: flex; flex-wrap: wrap; gap: 0.3rem; max-height: 40vh; overflow-y: auto; }
.ve-palette-custom { min-height: 44px; padding: 0 0.5rem; font-size: 1rem; }
.ve-palette-delete { min-height: 44px; color: #e05858; }
.ve-palette-close { min-height: 44px; margin-left: auto; }
.ve-palette-actions { align-items: center; }

.ve-toast {
    position: fixed;
    bottom: 5rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--card-bg, #333);
    color: var(--text);
    border: 1px solid var(--border, #555);
    border-radius: 8px;
    padding: 0.6rem 1rem;
    z-index: 20;
}
.ve-toast.hidden { display: none; }
.ve-toast-undo { margin-left: 0.5rem; font-weight: 700; cursor: pointer; }

.ve-empty-hint { color: var(--text-muted, #888); padding: 0.75rem; }

@media (max-width: 700px) {
    .ve-palette { position: fixed; left: 0; right: 0; bottom: 0; }
    .ve-card-body { font-size: 1.05rem; }
}
```

Check the actual CSS variable names used in `docs/css/style.css` (search for `--chord`, `--bg`, `--text`, `--border`) and adjust the fallbacks above to match the project's variables.

- [ ] **Step 5: Verify in the browser**

Run: `./scripts/server` then open `http://localhost:8080`, sidebar → Add Song.
Check: Visual tab active by default; Add section works; typing lyrics then switching to ♪ Chords shows tap targets; tapping a syllable opens the palette; picking a chord places a chip; the Raw tab shows the serialized ChordPro; preview updates. Then open an existing song → Edit Song → cards render with existing chords. Check the browser console for errors (there must be none).

- [ ] **Step 6: Run all unit tests and the existing editor E2E**

Run: `npx vitest run`
Expected: PASS.
Run: `npx playwright test e2e/editor.spec.js`
Expected: PASS — existing raw-editor E2E must not regress. (`#editor-content` and friends still exist; the raw tab is just hidden by default, so tests that type into it may need the Raw tab activated — if any fail for that reason, fix them by adding `await page.locator('#editor-tab-raw').click();` after the editor opens.)

- [ ] **Step 7: Commit**

```bash
git add docs/index.html docs/js/editor.js docs/js/main.js docs/css/style.css e2e/editor.spec.js
git commit -m "feat(visual-editor): Visual|Raw editor tabs with textarea mirroring"
```

---

### Task 9: E2E tests and documentation

**Files:**
- Create: `e2e/visual-editor.spec.js`
- Create: `docs/js/visual-editor/CLAUDE.md`
- Modify: `docs/js/CLAUDE.md` (file list + editor section)

**Interfaces:**
- Consumes: DOM contract from Tasks 6-8 (`#editor-tab-visual`, `.ve-card`, `.ve-syl`, `.ve-chip`, `.ve-palette`, `#editor-content`).

- [ ] **Step 1: Write the E2E tests**

Create `e2e/visual-editor.spec.js`:

```js
// E2E tests for the visual song editor (tap-to-place chords, sections, tabs)
import { test, expect } from '@playwright/test';

async function openNewSongEditor(page) {
    await page.goto('/#search');
    await page.waitForSelector('#search-input');
    await page.locator('#hamburger-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
    await page.locator('#nav-add-song').click();
    await expect(page.locator('#editor-panel')).toBeVisible();
}

test.describe('Visual editor basics', () => {
    test('visual tab is the default and raw tab toggles', async ({ page }) => {
        await openNewSongEditor(page);
        await expect(page.locator('#editor-tab-visual')).toHaveClass(/active/);
        await expect(page.locator('#visual-editor-container')).toBeVisible();
        await expect(page.locator('#editor-raw-main')).toBeHidden();

        await page.locator('#editor-tab-raw').click();
        await expect(page.locator('#editor-raw-main')).toBeVisible();
        await expect(page.locator('#visual-editor-container')).toBeHidden();
    });

    test('add section, type lyrics, place a chord, verify raw output', async ({ page }) => {
        await openNewSongEditor(page);

        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        await expect(page.locator('.ve-card')).toHaveCount(1);

        // new section opens in lyrics mode
        await page.locator('.ve-lyrics-input').fill('hello world friend');
        await page.locator('.ve-mode-chords').click();

        // tap a syllable, pick a chord from the palette
        await page.locator('.ve-syl').first().click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip').first()).toBeVisible();

        // raw tab shows the bracket
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toMatch(/\[[A-G][#b]?m?7?\]hello world friend/);
        expect(raw).toContain('{start_of_verse: Verse 1}');
    });

    test('editing an existing song shows its sections and chords', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await page.waitForTimeout(1000);
        await expect(page.locator('#song-view')).toBeVisible();
        const editBtn = page.locator('#edit-song-btn');
        if (await editBtn.isVisible()) {
            await editBtn.click();
            await expect(page.locator('#editor-panel')).toBeVisible();
            await expect(page.locator('.ve-card').first()).toBeVisible();
            await expect(page.locator('.ve-chip').first()).toBeVisible();
        }
    });

    test('round-trip: raw edits appear in visual after tab switch', async ({ page }) => {
        await openNewSongEditor(page);
        await page.locator('#editor-tab-raw').click();
        await page.locator('#editor-content').fill(
            '{start_of_verse: Verse 1}\n[G]row your boat\n{end_of_verse}\n');
        await page.locator('#editor-tab-visual').click();
        await expect(page.locator('.ve-card-label')).toHaveText('Verse 1');
        await expect(page.locator('.ve-chip')).toHaveText('G');
    });

    test('section menu changes type', async ({ page }) => {
        await openNewSongEditor(page);
        await page.locator('#editor-tab-raw').click();
        await page.locator('#editor-content').fill(
            '{start_of_verse: Verse 1}\n[G]sing along now\n{end_of_verse}\n');
        await page.locator('#editor-tab-visual').click();
        await page.locator('.ve-card-menu-btn').click();
        await page.locator('[data-action="type-chorus"]').click();
        await expect(page.locator('.ve-card-label')).toHaveText('Chorus');
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('{start_of_chorus: Chorus}');
    });
});

test.describe('Visual editor on mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('core placement flow works at phone size', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await page.locator('#hamburger-btn').click();
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        await page.locator('.ve-lyrics-input').fill('mountain morning light');
        await page.locator('.ve-mode-chords').click();
        await page.locator('.ve-syl').first().click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip').first()).toBeVisible();
    });
});
```

- [ ] **Step 2: Run the E2E tests**

Run: `npx playwright test e2e/visual-editor.spec.js`
Expected: PASS (server auto-starts via playwright config). Fix any selector drift against the actual DOM — the DOM contract is defined in Tasks 6-8.

- [ ] **Step 3: Write `docs/js/visual-editor/CLAUDE.md`**

```markdown
# Visual Editor

Mobile-first visual song editor: tap a syllable, tap a chord. Songs are
section block cards (verse/chorus/bridge/intro/outro). Lives behind the
Visual|Raw tabs on the editor panel; the raw ChordPro textarea remains the
submission channel — the visual editor mirrors serialized ChordPro into
`#editor-content` on every change, so preview/copy/download/submit in
`editor.js` work unchanged.

## Structure

```
visual-editor/
├── model.js          # SongDocument: parseSong/serializeSong + pure edit ops
├── syllables.js      # view-layer tokenizer (tap targets); NOT in the model
├── palette.js        # docked chord palette (diatonic via chord-explorer/theory.js)
├── section-card.js   # one section card (chords mode / lyrics mode)
└── visual-editor.js  # orchestrator: selection, undo/redo, rendering
```

## Data model

A line is `{ lyrics, chords: [{chord, position}] }` — the same shape as
`chords.js parseLineWithChords`. Chords anchor to CHARACTER OFFSETS
(ChordPro's native anchor). Syllables are render-time tap targets only.

Round-trip invariant (tested against 300 real works):
`serializeSong(parseSong(x))` equals `x` after normalization (trailing
whitespace, blank-line runs). Untouched chords keep their exact offsets;
unknown directives ride through as passthrough sections / opaque lines.

## Design docs

- Spec: `docs/superpowers/specs/2026-07-01-visual-song-editor-design.md`
- Plan: `docs/superpowers/plans/2026-07-01-visual-song-editor.md`

## Tests

- Unit: `docs/js/__tests__/visual-editor-*.test.js` (model, syllables,
  palette, section card, orchestrator)
- E2E: `e2e/visual-editor.spec.js`
```

- [ ] **Step 4: Update `docs/js/CLAUDE.md`**

In the file-list tree, after the `chord-explorer/` line, add:

```
│   ├── visual-editor/  # Visual song editor (tap-to-place chords, section cards)
```

In the "Editor (Add Song / Edit Song)" section, add:

```markdown
The editor has two tabs: **Visual** (default — tap-to-place chord editing,
section cards; see `visual-editor/CLAUDE.md`) and **Raw ChordPro** (textarea +
smart paste). The visual editor mirrors serialized ChordPro into
`#editor-content`, so all submit/preview flows read the textarea regardless
of tab.
```

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npx playwright test`
Expected: full unit suite + full E2E suite PASS.

- [ ] **Step 6: Commit**

```bash
git add e2e/visual-editor.spec.js docs/js/visual-editor/CLAUDE.md docs/js/CLAUDE.md
git commit -m "test(visual-editor): E2E coverage and module documentation"
```

---

## Post-plan checklist (for the final task's executor)

- [ ] `npx vitest run` — all green
- [ ] `npx playwright test` — all green (including pre-existing editor.spec.js)
- [ ] Manual smoke on phone-sized viewport (390px): place, move, delete a chord; add/reorder sections; submit flow reaches the existing confirmation
- [ ] No console errors on load, tab switch, or editing
