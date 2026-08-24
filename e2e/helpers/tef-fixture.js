// A real `.tef`, from the golden corpus, as a file Playwright can hand to
// the app.
//
// `docs/js/tef-import/__fixtures__/golden.json` is the JS parser's oracle:
// every entry is a TablEdit file's bytes plus the OTF the Python pipeline
// produces from it, and the unit suite asserts they match byte for byte. So
// it is also the right place to take an e2e fixture from — the expected
// document is right there beside the bytes, which means an import test can
// assert what LANDED rather than merely that something did.
//
// Nothing is checked in twice for this: the bytes are decoded from the
// oracle at test time.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = resolve(here, '../../docs/js/tef-import/__fixtures__/golden.json');

/**
 * The default fixture: 1078 bytes, one tenor-banjo track, "Soldier's Joy".
 * Small enough to be instant, and unmistakable once imported — the corpus
 * has no other Soldier's Joy tenor-banjo tab to confuse it with.
 */
export const DEFAULT_FIXTURE = '12124.tef';

let cache = null;

function golden() {
    cache ||= JSON.parse(readFileSync(GOLDEN, 'utf-8'));
    return cache;
}

/**
 * A fixture, ready for `fileChooser.setFiles()` / `setInputFiles()`.
 *
 * @param {string} [name] - key in golden.json
 * @returns {{file: {name: string, mimeType: string, buffer: Buffer},
 *   otf: Object, title: string, trackIds: string[], measures: number,
 *   firstFrets: number[]}}
 */
export function tefFixture(name = DEFAULT_FIXTURE) {
    const entry = golden().files[name];
    if (!entry) throw new Error(`No golden fixture called ${name}`);

    const buffer = Buffer.from(entry.bytes_b64, 'base64');
    const otf = entry.otf;
    const notation = otf.notation || {};
    const trackIds = Object.keys(notation);
    const measures = Math.max(0, ...trackIds.map(id => notation[id].length));
    const firstEvents = notation[trackIds[0]]?.[0]?.events || [];
    const firstFrets = firstEvents.slice(0, 4)
        .flatMap(e => (e.notes || []).map(n => n.f));

    return {
        // `.tef` has no registered MIME type; the app keys off the extension
        // (pwa.js `isSupportedTabFile`), so this is only here to be honest.
        file: { name, mimeType: 'application/octet-stream', buffer },
        otf,
        title: otf.metadata?.title || '',
        trackIds,
        measures,
        firstFrets,
    };
}
