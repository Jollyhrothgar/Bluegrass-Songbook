/**
 * validateOTF against docs/schema/otf.schema.json (G15a, issue #318).
 *
 * The Python validator (scripts/lib/otf_schema.py) is the schema plus
 * cross-field rules; this is its hand-written JS twin. tests/test_otf_schema.py
 * runs the SAME fixture files through the Python side, so "both validators
 * agree" is: every file in tests/fixtures/otf/ is judged identically here.
 *
 * Fixture names carry the rule: `schema--<what>` is a shape error,
 * `cross--<rule>[--variant]` breaks the cross-field rule `<rule>`,
 * `warn--<rule>` is valid with a warning.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateOTF as validateViaActions, createEmptyOTF } from '../../otf-editor/actions.js';
import {
    validateOTF, OTF_TECHS, OTF_FX, OTF_GRACE_KINDS, OTF_FINGERS, OTF_LH, OTF_ROLES,
} from '../../otf-editor/otf-validate.js';
import {
    FX_ORDER as FACADE_FX, GRACE_KINDS as FACADE_GRACE, PLUCK_FINGERS, LH_DIGITS, TECHS,
} from '../../otf-editor/facade.js';
import {
    FX_ORDER as IMPORT_FX, GRACE_KINDS as IMPORT_GRACE, V3_PLUCK_LETTERS,
} from '../../tef-import/otf.js';

const ROOT = path.resolve(__dirname, '../../../..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/otf');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/schema/otf.schema.json'), 'utf8'));
const NOTE = SCHEMA.$defs.note.properties;

const load = dir => fs.readdirSync(path.join(FIXTURES, dir)).filter(f => f.endsWith('.json')).sort()
    .map(f => ({ name: f.replace(/\.json$/, ''), doc: JSON.parse(fs.readFileSync(path.join(FIXTURES, dir, f), 'utf8')) }));
const ruleOf = name => {
    const [kind, ...rest] = name.split('--');
    return [kind, rest[0].replace(/-/g, '_')];
};

describe('conformance fixtures', () => {
    const valid = load('valid');
    const invalid = load('invalid');

    it('finds the fixtures', () => {
        expect(valid.length).toBeGreaterThanOrEqual(6);
        expect(invalid.length).toBeGreaterThanOrEqual(40);
    });

    for (const { name, doc } of valid) {
        it(`accepts ${name}`, () => {
            const r = validateOTF(doc);
            expect(r.errors).toEqual([]);
            expect(r.valid).toBe(true);
            expect(r.warnings.length > 0).toBe(name.startsWith('warn--'));
        });
    }

    for (const { name, doc } of invalid) {
        it(`rejects ${name}`, () => {
            const r = validateOTF(doc);
            expect(r.valid).toBe(false);
            const [kind, rule] = ruleOf(name);
            if (kind === 'schema') {
                expect(r.errors.every(e => !e.startsWith('[') || e.startsWith('[schema]'))).toBe(true);
            } else {
                expect(r.errors.some(e => e.includes(`[${rule}]`))).toBe(true);
            }
        });
    }

    it('treats a reading list overrun as a warning', () => {
        const doc = valid.find(f => f.name === 'warn--reading-list-overrun').doc;
        const r = validateOTF(doc);
        expect(r.valid).toBe(true);
        expect(r.warnings[0]).toContain('[reading_list_overrun]');
    });
});

describe('version rule', () => {
    it('accepts 1.1 and rejects 2.0', () => {
        const doc = createEmptyOTF();
        doc.otf_version = '1.1';
        expect(validateOTF(doc).valid).toBe(true);
        doc.otf_version = '2.0';
        const r = validateOTF(doc);
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('Unknown OTF version'))).toBe(true);
    });

    it('rejects a missing or non-string version', () => {
        const doc = createEmptyOTF();
        delete doc.otf_version;
        expect(validateOTF(doc).valid).toBe(false);
        doc.otf_version = 1.0;
        expect(validateOTF(doc).valid).toBe(false);
    });
});

describe('the editor', () => {
    it('is reachable through actions.js', () => {
        expect(validateViaActions).toBe(validateOTF);
    });

    it('produces documents the validator accepts', () => {
        for (const inst of ['5-string-banjo', '6-string-guitar', 'mandolin', 'upright-bass', 'tenor-banjo', 'dobro']) {
            expect(validateOTF(createEmptyOTF(inst)).errors).toEqual([]);
        }
    });
});

describe('enum fences: every copy equals the schema', () => {
    const fx = NOTE.fx.items.enum;
    const grace = NOTE.grace.properties.kind.enum;

    it('tech', () => {
        expect(NOTE.tech.enum).toEqual(OTF_TECHS);
        expect(TECHS).toEqual(NOTE.tech.enum);
    });
    it('fx', () => {
        expect(OTF_FX).toEqual(fx);
        expect(FACADE_FX).toEqual(fx);
        expect(IMPORT_FX).toEqual(fx);
    });
    it('grace kinds (the importer lists a leading null)', () => {
        expect(OTF_GRACE_KINDS).toEqual(grace);
        expect(FACADE_GRACE).toEqual(grace);
        expect(IMPORT_GRACE[0]).toBeNull();
        expect(IMPORT_GRACE.slice(1)).toEqual(grace);
    });
    it('picking-hand fingers', () => {
        expect(OTF_FINGERS).toEqual(NOTE.finger.enum);
        expect(PLUCK_FINGERS).toEqual(NOTE.finger.enum);
        expect(Object.values(V3_PLUCK_LETTERS)).toEqual(NOTE.finger.enum);
    });
    it('left-hand fingers', () => {
        const { minimum, maximum } = NOTE.lh;
        const digits = Array.from({ length: maximum - minimum + 1 }, (_, i) => minimum + i);
        expect(OTF_LH).toEqual(digits);
        expect(LH_DIGITS).toEqual(digits);
    });
    it('roles', () => {
        expect(OTF_ROLES).toEqual(SCHEMA.properties.tracks.items.properties.role.enum);
    });
    it('the player\'s technique sets are inside the schema enum', () => {
        const src = fs.readFileSync(path.join(ROOT, 'docs/js/renderers/tab-player.js'), 'utf8');
        for (const name of ['LEGATO_TECHS', 'GLIDE_TECHS']) {
            const m = src.match(new RegExp(`const ${name} = new Set\\((\\[[^\\]]*\\])\\)`));
            expect(m, name).not.toBeNull();
            const values = JSON.parse(m[1].replace(/'/g, '"'));
            for (const v of values) expect(NOTE.tech.enum).toContain(v);
        }
    });
});
