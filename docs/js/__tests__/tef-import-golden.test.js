// Golden-diff gate for the in-browser TEF parser.
//
// For every V2 .tef in the fixture, decode the raw bytes, run the JS
// parseTef(), and assert the resulting OTF document is byte-for-byte
// (canonical-JSON) identical to the Python tef_to_otf(...).to_dict() output.
//
// The Python parser is the oracle (itself validated against TablEdit's MusicXML
// exports). Regenerate the fixture when the Python parser legitimately changes:
//   uv run python docs/js/tef-import/__fixtures__/gen_golden.py
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTef } from '../tef-import/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../tef-import/__fixtures__/golden.json');

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const files = Object.entries(fixture.files);

// Canonical (key-order-independent) stringify so field ordering never matters —
// only values and presence.
function canon(x) {
    if (Array.isArray(x)) return x.map(canon);
    if (x && typeof x === 'object') {
        return Object.keys(x).sort().reduce((a, k) => { a[k] = canon(x[k]); return a; }, {});
    }
    return x;
}
const J = (x) => JSON.stringify(canon(x));

function b64ToBytes(b64) {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
}

describe('TEF import: JS parser matches Python oracle (V2 corpus)', () => {
    it('has a non-empty fixture', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('%s → OTF identical to Python', (name, entry) => {
        const bytes = b64ToBytes(entry.bytes_b64);
        const got = parseTef(bytes, name);
        expect(J(got)).toBe(J(entry.otf));
    });
});
