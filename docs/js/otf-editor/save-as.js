// File ▸ Save as… — what the panel (popover.js SaveAsPopover) decides and does.
//
// The panel is the UI; this is the logic, so it can be tested without a DOM:
// which format to offer first, what to call the file, what to tell the person
// before they press Save, and how each format is built.
//
//   const saveAs = createSaveAs({ otf, source, filename });
//   saveAs.prepare('tef')            // -> { notice, error } (writes the .tef once)
//   await saveAs.save('tef', 'x.tef') // -> { filename } or { error }
//
// The `.tef` writer (js/tef-export) is only fetched here, when the panel asks
// for a `.tef`; a person who saves as .otf.json or .txt never loads it.

import { serializeOTF } from '../otf-format.js';
import { renderAsciiTab } from '../renderers/tab-ascii.js';
import { pitchedTracks } from '../renderers/otf-tracks.js';
import { skippedLine } from '../tef-skipped.js';
import { track as trackEvent } from '../analytics.js';

export const SAVE_FORMATS = [
    { id: 'tef', ext: '.tef', label: 'TablEdit (.tef)', mime: 'application/octet-stream' },
    { id: 'otf', ext: '.otf.json', label: 'Bluegrass Book tab (.otf.json)', mime: 'application/json' },
    { id: 'txt', ext: '.txt', label: 'Plain-text tab (.txt)', mime: 'text/plain' },
];

const formatById = (id) => SAVE_FORMATS.find(f => f.id === id) || null;

/** Which format a file name says it is, or null. `.otf.json` is checked before `.json`. */
export function formatForName(name) {
    const lower = String(name || '').toLowerCase();
    return SAVE_FORMATS.find(f => lower.endsWith(f.ext))?.id || null;
}

/** The format the document came from (`.tef` or `.otf.json`), else `.tef`. */
export function defaultFormat(source) {
    const id = formatForName(source?.name);
    return id === 'txt' ? 'tef' : (id || 'tef');
}

/** "Foggy Mountain Breakdown!" -> "foggy-mountain-breakdown". */
export function titleSlug(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

const withoutExtension = (name) => {
    const f = formatById(formatForName(name));
    return f ? String(name).slice(0, -f.ext.length) : String(name);
};

/** A file name a download will keep: no path characters, no empty result. */
function cleanBase(base) {
    // eslint-disable-next-line no-control-regex
    return String(base).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().replace(/^\.+/, '') || 'untitled';
}

/** `name` with the extension `format` wants, whatever extension it had. */
export function fileNameFor(name, format) {
    return cleanBase(withoutExtension(name)) + (formatById(format)?.ext || '');
}

/** The opened file's name, else the host's name for the document, else a slug of the title. */
export function defaultFileName({ source, filename, title, format }) {
    const base = (source?.name && withoutExtension(source.name)) || filename || titleSlug(title);
    return fileNameFor(base, format);
}

/** An ASCII block per pitched track, separated by a blank line. */
export function plainTextTab(otf) {
    return pitchedTracks(otf.tracks || [])
        .map(t => renderAsciiTab(t, otf.notation?.[t.id] || [], otf.metadata || {}))
        .join('\n');
}

/** A Blob download through a[download] (on iOS this opens the share/Files sheet). */
export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * @param {Object} options
 * @param {Object} options.otf - the document as it is now (editor.save())
 * @param {{name: string, bytes?: ArrayBuffer}} [options.source] - the file it was opened from
 * @param {string} [options.filename] - the host's name for it (no extension)
 * @param {Function} [options.loadTefExport] - () => import of js/tef-export; injected for tests
 * @param {Function} [options.track] - analytics
 * @param {Function} [options.download] - (blob, name) => void
 */
export function createSaveAs({
    otf,
    source = null,
    filename = null,
    loadTefExport = () => import('../tef-export/index.js'),
    track = trackEvent,
    download = downloadBlob,
} = {}) {
    const skipped = skippedLine(otf?.x_source?.skipped);
    const format = defaultFormat(source);
    let tef = null;   // the one .tef written for this panel: { bytes, notice } | { error }

    async function writeTef() {
        let mod;
        try {
            mod = await loadTefExport();
            const template = await mod.loadDefaultTemplate();
            const original = source?.bytes ? new Uint8Array(source.bytes) : undefined;
            const { bytes, notices } = mod.writeTef(otf, { source: original, template });
            return { bytes, notice: mod.noticeLine(notices) };
        } catch (err) {
            return { error: mod && err instanceof mod.TefWriteError
                ? err.message
                : 'Could not make a .tef file. Try saving as .otf.json instead.' };
        }
    }

    return {
        formats: SAVE_FORMATS,
        format,
        fileName: defaultFileName({ source, filename, title: otf?.metadata?.title, format }),

        /** What to tell the person before Save: { notice, error }. */
        async prepare(id) {
            if (id !== 'tef') return { notice: skipped, error: '' };
            tef ||= await writeTef();
            return tef.error
                ? { notice: skipped, error: tef.error }
                : { notice: [skipped, tef.notice].filter(Boolean).join(' '), error: '' };
        },

        /** Build the file and hand it to the browser. Nothing downloads on an error. */
        async save(id, name) {
            const f = formatById(id);
            if (!f) return { error: 'Pick a file type.' };
            let part;
            if (id === 'tef') {
                await this.prepare('tef');
                if (tef.error) return { error: tef.error };
                part = tef.bytes;
            } else {
                part = id === 'otf' ? serializeOTF(otf) : plainTextTab(otf);
            }
            const file = fileNameFor(name, id);
            download(new Blob([part], { type: f.mime }), file);
            track('tab_file_save', { format: id });
            return { filename: file };
        },
    };
}
