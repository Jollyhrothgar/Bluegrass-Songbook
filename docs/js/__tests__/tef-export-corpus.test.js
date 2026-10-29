// G15f acceptance: every corpus .tef survives parse -> OTF A -> write -> parse -> OTF B.
//
// A deep-equals B except where docs/js/__tests__/fixtures/tef-roundtrip-exceptions.txt
// pins a file (one line each: path, first differing JSON pointer, reason). The
// list is a ratchet: a listed file must still differ at that pointer, and an
// unlisted file must be equal. Three representation-only normalizations are
// applied to both sides first:
//   - annotations, chord_diagrams and the notes of one event are sets; the file
//     order of the cells (string-major in V2, position-major in V3) is not kept;
//   - x_source (provenance) is not part of the tab;
//   - metadata.title is trimmed and its line breaks become spaces: a V3 title is
//     trimmed on read, and a multi-line title cannot be read back (the writer
//     counts it in notices.text_changed, asserted below);
//   - metadata.composer is written to TablEdit's Author field (checked on the
//     bytes below) but the V3 reader does not read it back yet: reading it would
//     change the parse of 59 of the 91 V3 corpus files (Mike's call, see PR).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';
import { isV3Layout, headerString } from '../tef-import/reader.js';
import { writeTef } from '../tef-export/writer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
// The default template (a blank file saved by TablEdit 3.06); the writer needs only its bytes.
const DEFAULT_TEMPLATE = path.join(repo, 'docs/js/tef-export/template.tef');
const template = new Uint8Array(fs.readFileSync(DEFAULT_TEMPLATE));

function corpus() {
    const dirs = [];
    for (const s of fs.readdirSync(path.join(repo, 'sources'))) {
        const d = path.join(repo, 'sources', s, 'downloads');
        if (fs.existsSync(d)) dirs.push(d);
    }
    dirs.push(path.join(repo, 'sources/mandozine/tefs'), path.join(repo, 'sources/tef-uploads/uploads'));
    return dirs.flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.tef')).sort()
        .map(f => path.relative(repo, path.join(d, f))));
}

const exceptions = new Map(fs.readFileSync(path.join(here, 'fixtures/tef-roundtrip-exceptions.txt'), 'utf8')
    .split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => { const [file, pointer, ...why] = l.trim().split(/\s+/); return [file, { pointer, why: why.join(' ') }]; }));

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function canonical(otf) {
    const c = JSON.parse(JSON.stringify(otf));
    delete c.x_source;
    delete c.metadata.composer;
    c.metadata.title = c.metadata.title.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
    if (c.annotations) c.annotations.sort((a, b) => a.measure - b.measure || a.tick - b.tick || byText(a.text, b.text));
    if (c.chord_diagrams) c.chord_diagrams.sort((a, b) => a.measure - b.measure || a.tick - b.tick || a.chord - b.chord);
    for (const ms of Object.values(c.notation)) for (const m of ms) for (const e of m.events) e.notes.sort((a, b) => a.s - b.s);
    return c;
}

// Object key order is not part of a tab (notation is keyed by track id).
const sortedJson = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));

/** JSON pointer of the first difference, or null when equal. */
export function firstDifference(a, b, at = '') {
    if (sortedJson(a) === sortedJson(b)) return null;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return at || '/';
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const d = firstDifference(a[k], b[k], `${at}/${k}`);
        if (d) return d;
    }
    return at || '/';
}

describe('.tef writer: corpus round trip', () => {
    const files = corpus();

    it('finds the corpus (about 610 files)', () => {
        expect(files.length).toBeGreaterThan(600);
    });

    it.each(files)('%s', (file) => {
        const bytes = new Uint8Array(fs.readFileSync(path.join(repo, file)));
        const a = parseTef(bytes, path.basename(file));
        const { bytes: out, notices } = writeTef(a, { source: isV3Layout(bytes) ? bytes : undefined, template });
        expect(isV3Layout(out)).toBe(true);
        const b = parseTef(out, path.basename(file));
        const diff = firstDifference(canonical(a), canonical(b));

        if (/[\x00-\x1f\x7f][^\s]/.test(a.metadata.title.trim())) expect(notices.text_changed).toBeGreaterThan(0);

        const pinned = exceptions.get(file);
        if (pinned) expect(diff, `${file}: ${pinned.why}`).toBe(pinned.pointer);
        else expect(diff, 'differs; fix the writer or pin it with a reason').toBe(null);

        // The composer goes to TablEdit's Author field even though we do not read it back.
        if (a.metadata.composer && a.metadata.composer.length < 998) {
            expect(headerString(out, 0x44)).toBe(a.metadata.composer);
        }
        // A V3 file also writes without itself as the template (the default template alone).
        if (isV3Layout(bytes) && !pinned) {
            const viaTemplate = parseTef(writeTef(a, { template }).bytes, path.basename(file));
            expect(firstDifference(canonical(a), canonical(viaTemplate))).toBe(null);
        }
        // A second trip, from the file just written, changes nothing more.
        if (!pinned) {
            const c = parseTef(writeTef(b, { source: out, template }).bytes, path.basename(file));
            expect(firstDifference(canonical(b), canonical(c))).toBe(null);
        }
    });

    it('lists no file that is not in the corpus', () => {
        for (const file of exceptions.keys()) expect(files).toContain(file);
    });
});
