// In-browser .tef export — public API (G15f). The mirror of tef-import/index.js.
//
//   const { bytes, notices } = writeTef(otf, { source, template });
//   const note = noticeLine(notices);          // '' when nothing was changed
//
// `source` is the original .tef the document was opened from (kept in its
// draft); `template` is the default template, template.tef, which
// loadDefaultTemplate() fetches. Only the browser needs fetch, so it lives
// here and not in writer.js.
export { writeTef, TefWriteError } from './writer.js';
export { noticeLine, noticeSummary, NOTICE_LABELS } from './notices.js';

let defaultTemplate = null;

/** The default template's bytes (a blank TablEdit 3.06 file), fetched once. */
export async function loadDefaultTemplate() {
    if (!defaultTemplate) {
        const response = await fetch(new URL('./template.tef', import.meta.url));
        if (!response.ok) throw new Error('Could not load the .tef template.');
        defaultTemplate = new Uint8Array(await response.arrayBuffer());
    }
    return defaultTemplate;
}
