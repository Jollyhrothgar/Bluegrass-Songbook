// The one file layout for OTF tab files (G15b). Python twin:
// scripts/lib/otf_format.py. Both produce identical bytes; the shared
// fixtures in tests/fixtures/otf/layout/ and a sweep of every tracked
// .otf.json prove it (docs/js/__tests__/otf-format.test.js).
//
// UTF-8, 2-space indent, `": "` after keys, one trailing "\n". Keys go in the
// order of docs/schema/otf.schema.json (copied below as KEY_ORDER because the
// browser must not fetch the schema; a test asserts the copy equals it).
// Unknown keys (only inside x_source) keep their order after the known ones;
// keys starting with `_` are runtime view caches and are dropped. One line
// each: an event, an annotation, a reading_list entry, a
// time_signature_changes entry, a measure_marks / chords / chord_diagrams entry, and any array whose items are all scalars.
//
// Not in the boot graph: it is reached only from the tab editor
// (otf-editor/actions.js downloadOTF), so it is listed in lazy-modules.js.
// The compact wire formats (serializeForSubmission, take.content, IndexedDB
// drafts) deliberately do not use it.

export const KEY_ORDER = {
    doc: ['otf_version', 'metadata', 'timing', 'tracks', 'notation', 'annotations', 'reading_list',
        'measure_marks', 'chords', 'chord_diagrams', 'x_source'],
    metadata: ['title', 'time_signature', 'tempo', 'key', 'composer', 'tab_by', 'time_signature_changes'],
    timing: ['ticks_per_beat'],
    track: ['id', 'instrument', 'tuning', 'capo', 'role', 'dyn', 'percussion', 'lines'],
    measure: ['measure', 'events'],
    event: ['tick', 'notes'],
    note: ['s', 'f', 'dur', 'tie', 'tech', 'fx', 'grace', 'finger', 'lh', 'dyn'],
    grace: ['f', 'kind'],
    annotation: ['measure', 'tick', 'text', 'track', 'kind', 'place'],
    reading: ['from_measure', 'to_measure', 'name'],
    tab_by: ['name', 'url'],
    tsc: ['measure', 'time_signature'],
    mark: ['measure', 'repeat_start', 'repeat_end', 'ending', 'jump', 'end_bar', 'raw'],
    chord: ['name', 'frets', 'fingers', 'first_fret'],
    diagram: ['measure', 'tick', 'track', 'chord', 'dx', 'dy'],
};

const CHILD = {
    'doc.metadata': 'metadata',
    'doc.timing': 'timing',
    'doc.tracks': 'track',
    'doc.notation': 'notation',
    'doc.annotations': 'annotation',
    'doc.reading_list': 'reading',
    'doc.measure_marks': 'mark',
    'doc.chords': 'chord',
    'doc.chord_diagrams': 'diagram',
    'metadata.time_signature_changes': 'tsc',
    'metadata.tab_by': 'tab_by',
    'measure.events': 'event',
    'event.notes': 'note',
    'note.grace': 'grace',
};
const INLINE = new Set(['event', 'annotation', 'reading', 'tsc', 'mark', 'chord', 'diagram']);

const childCtx = (ctx, key) => (ctx === 'notation' ? 'measure' : CHILD[`${ctx}.${key}`]);
const isScalar = (v) => v === null || typeof v !== 'object';

function scalar(v) {
    if (v === null) return 'null';
    if (typeof v === 'number') {
        if (!Number.isInteger(v)) throw new Error(`OTF numbers are integers; got ${v}`);
        return String(v);
    }
    if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    throw new TypeError(`not JSON: ${typeof v}`);
}

function entries(obj, ctx) {
    const known = KEY_ORDER[ctx] || [];
    const keys = known.filter((k) => k in obj);
    for (const k of Object.keys(obj)) if (!known.includes(k)) keys.push(k);
    return keys.filter((k) => !k.startsWith('_') && obj[k] !== undefined).map((k) => [k, obj[k]]);
}

function inline(v, ctx) {
    if (Array.isArray(v)) return `[${v.map((x) => inline(x, ctx)).join(', ')}]`;
    if (v !== null && typeof v === 'object') {
        return `{${entries(v, ctx).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x, childCtx(ctx, k))}`).join(', ')}}`;
    }
    return scalar(v);
}

function block(v, ctx, depth) {
    if (Array.isArray(v)) {
        if (v.every(isScalar)) return inline(v, ctx);
        const pad = '  '.repeat(depth + 1);
        const items = v.map((x) => pad + (INLINE.has(ctx) ? inline(x, ctx) : block(x, ctx, depth + 1)));
        return `[\n${items.join(',\n')}\n${'  '.repeat(depth)}]`;
    }
    if (v !== null && typeof v === 'object') {
        const list = ctx === 'notation' ? Object.entries(v) : entries(v, ctx);
        if (!list.length) return '{}';
        const pad = '  '.repeat(depth + 1);
        const lines = list.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${block(x, childCtx(ctx, k), depth + 1)}`);
        return `{\n${lines.join(',\n')}\n${'  '.repeat(depth)}}`;
    }
    return scalar(v);
}

/** The canonical text of an OTF document (ends with one newline). */
export function serializeOTF(doc) {
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
        throw new TypeError('an OTF document is a JSON object');
    }
    return `${block(doc, 'doc', 0)}\n`;
}
