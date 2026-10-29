// OTF validation, hand-written (no browser dependency).
//
// The format is written down once, in docs/schema/otf.schema.json (guide:
// docs/schema/otf.md). The Python validator (scripts/lib/otf_schema.py) uses
// that schema through `jsonschema`; this module is its JS twin and enforces
// the same rules by hand. Two tests keep them honest: the conformance
// fixtures in tests/fixtures/otf/ run through BOTH
// (tests/test_otf_schema.py, __tests__/otf-editor/otf-validate.test.js), and
// each enum below is asserted equal to the schema's.
//
// Messages tagged [schema] are shape errors; the cross-field rules carry
// their id in brackets, the same ids as the Python module:
//   string_count notation_keys track_ids measure_order tick_order tick_range
//   duplicate_string
// plus the warning-only reading_list_overrun (#263).
//
// Cross-field rules run only on a document whose shape is sound.

export const OTF_TECHS = ['h', 'p', '/', '\\', 'x', 'b'];
export const OTF_FX = ['brush', 'roll', 'choke', 'ghost', 'staccato', 'let-ring', 'muted',
    'harmonic', 'artificial-harmonic', 'tap', 'vibrato', 'tremolo', 'bend-release', 'slap'];
export const OTF_GRACE_KINDS = ['hp', 'slide', 'bend', 'mordent', 'double', 'gruppetto', 'trill'];
export const OTF_FINGERS = ['T', 'I', 'M', 'R', 'P'];
export const OTF_LH = [0, 1, 2, 3, 4];
export const OTF_ROLES = ['lead', 'rhythm', 'percussion'];

const TIME_SIG = /^[1-9][0-9]*\/[1-9][0-9]*$/;
const VERSION = /^1\.[0-9]+$/;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, min = -Infinity, max = Infinity) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Report keys outside `allowed` (underscore keys are never valid in a file). */
function closed(obj, allowed, path, errors) {
    for (const k of Object.keys(obj)) {
        if (!allowed.includes(k)) errors.push(`[schema] ${path}: unexpected key '${k}'`);
    }
}

function checkNote(n, path, errors) {
    if (!isObj(n)) { errors.push(`[schema] ${path}: not an object`); return; }
    closed(n, ['s', 'f', 'dur', 'tie', 'tech', 'fx', 'grace', 'finger', 'lh'], path, errors);
    if (!isInt(n.s, 1)) errors.push(`[schema] ${path}/s: must be an integer >= 1`);
    if (!isInt(n.f, 0, 24)) errors.push(`[schema] ${path}/f: must be an integer 0-24`);
    if ('dur' in n && !isInt(n.dur, 1)) errors.push(`[schema] ${path}/dur: must be an integer >= 1`);
    if ('tie' in n && typeof n.tie !== 'boolean') errors.push(`[schema] ${path}/tie: must be a boolean`);
    if ('tech' in n && !OTF_TECHS.includes(n.tech)) errors.push(`[schema] ${path}/tech: unknown technique`);
    if ('fx' in n) {
        if (!Array.isArray(n.fx)) errors.push(`[schema] ${path}/fx: must be an array`);
        else if (n.fx.some(x => !OTF_FX.includes(x))) errors.push(`[schema] ${path}/fx: unknown effect`);
    }
    if ('grace' in n) {
        const g = n.grace;
        if (!isObj(g)) errors.push(`[schema] ${path}/grace: not an object`);
        else {
            closed(g, ['f', 'kind'], `${path}/grace`, errors);
            if (!isInt(g.f, 0, 24)) errors.push(`[schema] ${path}/grace/f: must be an integer 0-24`);
            if ('kind' in g && !OTF_GRACE_KINDS.includes(g.kind)) {
                errors.push(`[schema] ${path}/grace/kind: unknown kind`);
            }
        }
    }
    if ('finger' in n && !OTF_FINGERS.includes(n.finger)) errors.push(`[schema] ${path}/finger: unknown finger`);
    if ('lh' in n && !(typeof n.lh === 'number' && OTF_LH.includes(n.lh))) {
        errors.push(`[schema] ${path}/lh: must be 0-4`);
    }
}

function checkMeasure(m, path, errors) {
    if (!isObj(m)) { errors.push(`[schema] ${path}: not an object`); return; }
    closed(m, ['measure', 'events'], path, errors);
    if (!isInt(m.measure, 1)) errors.push(`[schema] ${path}/measure: must be an integer >= 1`);
    if (!Array.isArray(m.events)) { errors.push(`[schema] ${path}/events: must be an array`); return; }
    m.events.forEach((e, i) => {
        const ep = `${path}/events/${i}`;
        if (!isObj(e)) { errors.push(`[schema] ${ep}: not an object`); return; }
        closed(e, ['tick', 'notes'], ep, errors);
        if (!isInt(e.tick, 0)) errors.push(`[schema] ${ep}/tick: must be an integer >= 0`);
        if (!Array.isArray(e.notes)) errors.push(`[schema] ${ep}/notes: must be an array`);
        else e.notes.forEach((n, j) => checkNote(n, `${ep}/notes/${j}`, errors));
    });
}

function checkTrack(t, i, errors) {
    const path = `tracks/${i}`;
    if (!isObj(t)) { errors.push(`[schema] ${path}: not an object`); return; }
    closed(t, ['id', 'instrument', 'tuning', 'capo', 'role', 'percussion', 'lines'], path, errors);
    if (typeof t.id !== 'string' || !t.id) errors.push('Track missing id');
    if (typeof t.instrument !== 'string') errors.push(`[schema] ${path}/instrument: must be a string`);
    const perc = 'percussion' in t;
    if (!Array.isArray(t.tuning)) errors.push(`Track ${t.id} missing tuning`);
    else {
        if (t.tuning.some(x => typeof x !== 'string')) errors.push(`[schema] ${path}/tuning: items must be strings`);
        if (!perc && t.tuning.length === 0) errors.push(`Track ${t.id} missing tuning`);
    }
    if ('capo' in t && !isInt(t.capo, 0)) errors.push(`[schema] ${path}/capo: must be an integer >= 0`);
    if ('role' in t && !OTF_ROLES.includes(t.role)) errors.push(`[schema] ${path}/role: unknown role`);
    if (perc && t.percussion !== true) errors.push(`[schema] ${path}/percussion: must be true`);
    if ('lines' in t && !isInt(t.lines, 1)) errors.push(`[schema] ${path}/lines: must be an integer >= 1`);
    if (perc !== ('lines' in t)) errors.push(`[schema] ${path}: percussion and lines go together`);
}

function checkSignature(sig, path, errors) {
    if (typeof sig !== 'string' || !TIME_SIG.test(sig)) {
        errors.push(`[schema] ${path}: must look like "4/4"`);
    }
}

/** The shape rules: everything the JSON Schema says. */
function shapeErrors(otf) {
    const errors = [];
    if (!isObj(otf)) return ['[schema] (document): not an object'];
    closed(otf, ['otf_version', 'metadata', 'timing', 'tracks', 'notation',
        'annotations', 'reading_list', 'x_source'], '(document)', errors);

    if (typeof otf.otf_version !== 'string' || !VERSION.test(otf.otf_version)) {
        errors.push(`Unknown OTF version: ${otf.otf_version}`);
    }

    const meta = otf.metadata;
    if (!meta) errors.push('Missing metadata section');
    else if (!isObj(meta)) errors.push('[schema] metadata: not an object');
    else {
        closed(meta, ['title', 'time_signature', 'tempo', 'key', 'composer',
            'time_signature_changes'], 'metadata', errors);
        if (typeof meta.title !== 'string') errors.push('[schema] metadata/title: must be a string');
        checkSignature(meta.time_signature, 'metadata/time_signature', errors);
        if (!isInt(meta.tempo, 1)) errors.push('[schema] metadata/tempo: must be an integer >= 1');
        for (const k of ['key', 'composer']) {
            if (k in meta && typeof meta[k] !== 'string') errors.push(`[schema] metadata/${k}: must be a string`);
        }
        if ('time_signature_changes' in meta) {
            const c = meta.time_signature_changes;
            if (!Array.isArray(c)) errors.push('[schema] metadata/time_signature_changes: must be an array');
            else c.forEach((x, i) => {
                const p = `metadata/time_signature_changes/${i}`;
                if (!isObj(x)) { errors.push(`[schema] ${p}: not an object`); return; }
                closed(x, ['measure', 'time_signature'], p, errors);
                if (!isInt(x.measure, 1)) errors.push(`[schema] ${p}/measure: must be an integer >= 1`);
                checkSignature(x.time_signature, `${p}/time_signature`, errors);
            });
        }
    }

    if (!otf.timing) errors.push('Missing timing section');
    else if (!isObj(otf.timing)) errors.push('[schema] timing: not an object');
    else {
        closed(otf.timing, ['ticks_per_beat'], 'timing', errors);
        if (!otf.timing.ticks_per_beat) errors.push('Missing ticks_per_beat in timing');
        else if (!isInt(otf.timing.ticks_per_beat, 1)) {
            errors.push('[schema] timing/ticks_per_beat: must be an integer >= 1');
        }
    }

    if (!Array.isArray(otf.tracks) || otf.tracks.length === 0) errors.push('No tracks defined');
    else otf.tracks.forEach((t, i) => checkTrack(t, i, errors));

    if (!otf.notation) errors.push('Missing notation section');
    else if (!isObj(otf.notation)) errors.push('[schema] notation: not an object');
    else {
        for (const [tid, measures] of Object.entries(otf.notation)) {
            if (!Array.isArray(measures)) errors.push(`[schema] notation/${tid}: must be an array`);
            else measures.forEach((m, i) => checkMeasure(m, `notation/${tid}/${i}`, errors));
        }
    }

    if ('annotations' in otf) {
        if (!Array.isArray(otf.annotations)) errors.push('[schema] annotations: must be an array');
        else otf.annotations.forEach((a, i) => {
            const p = `annotations/${i}`;
            if (!isObj(a)) { errors.push(`[schema] ${p}: not an object`); return; }
            closed(a, ['measure', 'tick', 'text'], p, errors);
            if (!isInt(a.measure, 1)) errors.push(`[schema] ${p}/measure: must be an integer >= 1`);
            if (!isInt(a.tick, 0)) errors.push(`[schema] ${p}/tick: must be an integer >= 0`);
            if (typeof a.text !== 'string') errors.push(`[schema] ${p}/text: must be a string`);
        });
    }

    if ('reading_list' in otf) {
        if (!Array.isArray(otf.reading_list)) errors.push('[schema] reading_list: must be an array');
        else otf.reading_list.forEach((r, i) => {
            const p = `reading_list/${i}`;
            if (!isObj(r)) { errors.push(`[schema] ${p}: not an object`); return; }
            closed(r, ['from_measure', 'to_measure', 'name'], p, errors);
            if (!isInt(r.from_measure, 1)) errors.push(`[schema] ${p}/from_measure: must be an integer >= 1`);
            if (!isInt(r.to_measure, 1)) errors.push(`[schema] ${p}/to_measure: must be an integer >= 1`);
            if ('name' in r && typeof r.name !== 'string') errors.push(`[schema] ${p}/name: must be a string`);
        });
    }

    if ('x_source' in otf && !isObj(otf.x_source)) errors.push('[schema] x_source: not an object');
    return errors;
}

/** Length of `measure` in ticks; time-signature changes apply per measure. */
export function measureLength(otf, measure) {
    let sig = otf.metadata.time_signature;
    for (const c of otf.metadata.time_signature_changes || []) {
        if (c.measure === measure) sig = c.time_signature;
    }
    const [beats, unit] = sig.split('/').map(Number);
    return Math.floor(otf.timing.ticks_per_beat * 4 * beats / unit);
}

/** The cross-field rules, for a document whose shape is sound. */
function crossField(otf) {
    const errors = [];
    const warnings = [];
    const ids = otf.tracks.map(t => t.id);
    const notation = otf.notation;

    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) {
        errors.push(`[track_ids] track ${id}: id used more than once`);
    }
    const extra = Object.keys(notation).filter(k => !ids.includes(k));
    if (extra.length) {
        errors.push(`[notation_keys] notation keys with no track: ${JSON.stringify(extra)}`);
    }

    let written = 0;
    for (const track of otf.tracks) {
        const measures = notation[track.id];
        if (!measures) continue;
        const nstrings = track.percussion ? track.lines : track.tuning.length;
        let previous = 0;
        for (const m of measures) {
            const num = m.measure;
            written = Math.max(written, num);
            if (num <= previous) {
                errors.push(`[measure_order] track ${track.id}: measure ${num} follows measure ${previous}`);
            }
            previous = Math.max(previous, num);
            const length = measureLength(otf, num);
            let lastTick = -1;
            for (const e of m.events) {
                if (e.tick <= lastTick) {
                    errors.push(`[tick_order] track ${track.id} m${num}: tick ${e.tick} follows tick ${lastTick}`);
                }
                lastTick = Math.max(lastTick, e.tick);
                if (e.tick >= length) {
                    errors.push(`[tick_range] track ${track.id} m${num}: tick ${e.tick} `
                        + `is outside the ${length}-tick measure`);
                }
                const seen = new Set();
                for (const n of e.notes) {
                    if (n.s > nstrings) {
                        errors.push(`[string_count] track ${track.id} m${num}: bad string ${n.s} (track has ${nstrings})`);
                    }
                    if (seen.has(n.s)) {
                        errors.push(`[duplicate_string] track ${track.id} m${num} tick ${e.tick}: two notes on string ${n.s}`);
                    }
                    seen.add(n.s);
                }
            }
        }
    }

    for (const r of otf.reading_list || []) {
        if (r.to_measure > written || r.from_measure > written) {
            warnings.push(`[reading_list_overrun] measures ${r.from_measure}-${r.to_measure} `
                + `run past the last written measure (${written})`);
        }
    }
    return { errors, warnings };
}

/**
 * Validate an OTF document against docs/schema/otf.schema.json and the
 * cross-field rules. Accepts any "1.x" version; rejects every other major.
 * @param {Object} otf - OTF document
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateOTF(otf) {
    if (!otf) {
        return { valid: false, errors: ['OTF document is null or undefined'], warnings: [] };
    }
    let errors = shapeErrors(otf);
    let warnings = [];
    if (errors.length === 0) ({ errors, warnings } = crossField(otf));
    return { valid: errors.length === 0, errors, warnings };
}
