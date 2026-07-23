// In-browser TEF import — public API.
//
// parseTef(bytes, name) turns raw TablEdit (.tef) bytes into an OTF document
// (the exact shape TabRenderer/TabPlayer consume), entirely client-side. This
// is a JavaScript port of the Python TEF→OTF pipeline
// (sources/banjo-hangout/src/tef_parser/), verified byte-exact against it by the
// golden-diff gate (docs/js/__tests__/tef-import-golden.test.js).
//
// Currently supports TEF V2 (the bulk of the corpus). V3 throws TefVersionError.
//
// Usage:
//   const otf = parseTef(new Uint8Array(await file.arrayBuffer()), file.name);
//   const editor = await createEditor(host, { otf });   // renders + edits
//
export { TefVersionError } from './reader.js';
import { parseTefBytes } from './reader.js';
import { tefToOtf, toOtfDict } from './otf.js';

function stemFromName(name) {
    if (!name) return 'untitled';
    const base = String(name).split(/[\\/]/).pop();
    return base.replace(/\.[^.]+$/, '') || base;
}

/**
 * Parse TEF bytes into an OTF document.
 * @param {Uint8Array|ArrayBuffer} bytes - raw .tef file bytes
 * @param {string} [name] - original filename (used for the title fallback)
 * @returns {object} OTF document (canonical dict form)
 */
export function parseTef(bytes, name) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const tef = parseTefBytes(data, stemFromName(name));
    const doc = tefToOtf(tef);
    return toOtfDict(doc);
}
