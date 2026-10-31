// Shared by the .tef writer tests: when are two parsed tabs "the same"?
//
// Representation-only normalizations, applied to both sides:
//   - annotations, chord_diagrams and the notes of one event are sets; the file
//     order of the cells (string-major in V2, position-major in V3) is not kept;
//   - object key order is not part of a tab (notation is keyed by track id);
//   - x_source (provenance) is not part of the tab;
//   - metadata.title is trimmed and its line breaks become spaces: a V3 title is
//     trimmed on read, and a multi-line title cannot be read back (the writer
//     counts it in notices.text_changed);

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function canonical(otf) {
    const c = JSON.parse(JSON.stringify(otf));
    delete c.x_source;
    c.metadata.title = c.metadata.title.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
    if (c.annotations) c.annotations.sort((a, b) => a.measure - b.measure || a.tick - b.tick || byText(a.text, b.text));
    if (c.chord_diagrams) c.chord_diagrams.sort((a, b) => a.measure - b.measure || a.tick - b.tick || a.chord - b.chord);
    for (const ms of Object.values(c.notation)) for (const m of ms) for (const e of m.events) e.notes.sort((a, b) => a.s - b.s);
    return c;
}

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

/** The value at a JSON pointer, for failure messages. */
export function at(doc, pointer) {
    return pointer.split('/').filter(Boolean).reduce((v, k) => (v == null ? v : v[k]), doc);
}
