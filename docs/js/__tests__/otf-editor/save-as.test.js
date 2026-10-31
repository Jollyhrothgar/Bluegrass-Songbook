// File ▸ Save as… (G15f): the default format, the file name, the notice shown
// before Save, the error path and what each format writes.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    defaultFormat, defaultFileName, fileNameFor, titleSlug, formatForName, createSaveAs,
} from '../../otf-editor/save-as.js';
import { parseTef } from '../../tef-import/index.js';
import * as tefExport from '../../tef-export/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = new Uint8Array(fs.readFileSync(path.resolve(here, '../../tef-export/template.tef')));

const otf = (over = {}) => ({
    otf_version: '1.1',
    metadata: { title: "Soldier's Joy", time_signature: '4/4', tempo: 120 },
    timing: { ticks_per_beat: 480 },
    tracks: [{ id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0, role: 'lead', dyn: 'f' }],
    notation: { banjo: [{ measure: 1, events: [{ tick: 0, notes: [{ s: 1, f: 2, dur: 480 }] }] }] },
    ...over,
});
// the real writer, with the template read from disk (Node has no fetch for a file URL)
const realExport = async () => ({ ...tefExport, loadDefaultTemplate: async () => template });

// jsdom's Blob has no text() / arrayBuffer()
const readBlob = (blob, how) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r[how](blob);
});

function make(over = {}) {
    const download = vi.fn();
    const track = vi.fn();
    const saveAs = createSaveAs({ otf: otf(), loadTefExport: realExport, download, track, ...over });
    return { saveAs, download, track };
}

describe('default format', () => {
    it('is the format the document was opened from', () => {
        expect(defaultFormat({ name: 'a.tef' })).toBe('tef');
        expect(defaultFormat({ name: 'A.OTF.JSON' })).toBe('otf');
    });
    it('is .tef for a new tab, or a name it does not know', () => {
        expect(defaultFormat(null)).toBe('tef');
        expect(defaultFormat({ name: 'a.txt' })).toBe('tef');
        expect(defaultFormat({ name: 'a.json' })).toBe('tef');
    });
    it('knows a name by its extension, .otf.json before .json', () => {
        expect(formatForName('x.otf.json')).toBe('otf');
        expect(formatForName('x.json')).toBe(null);
    });
});

describe('file name', () => {
    it('is the opened file name, with the new extension', () => {
        expect(defaultFileName({ source: { name: 'Foggy Mountain.tef' }, title: 'Other', format: 'tef' }))
            .toBe('Foggy Mountain.tef');
        expect(defaultFileName({ source: { name: 'Foggy Mountain.tef' }, format: 'otf' }))
            .toBe('Foggy Mountain.otf.json');
    });
    it('is the host name, else a slug of the title', () => {
        expect(defaultFileName({ filename: 'song-banjo-edited', title: 'X', format: 'tef' })).toBe('song-banjo-edited.tef');
        expect(defaultFileName({ title: "Soldier's Joy!", format: 'txt' })).toBe('soldier-s-joy.txt');
        expect(titleSlug('')).toBe('untitled');
    });
    it('swaps the extension when the format changes, and cleans path characters', () => {
        expect(fileNameFor('a.tef', 'otf')).toBe('a.otf.json');
        expect(fileNameFor('a.otf.json', 'txt')).toBe('a.txt');
        expect(fileNameFor('my.song', 'tef')).toBe('my.song.tef');
        expect(fileNameFor('a/b:c', 'tef')).toBe('a-b-c.tef');
        expect(fileNameFor('', 'tef')).toBe('untitled.tef');
    });
    it('the session starts from the document it was given', () => {
        const { saveAs } = make({ source: { name: 'x.otf.json' } });
        expect(saveAs.format).toBe('otf');
        expect(saveAs.fileName).toBe('x.otf.json');
        expect(make().saveAs.fileName).toBe('soldier-s-joy.tef');
    });
});

describe('notice', () => {
    const skippedDoc = () => otf({ x_source: { skipped: { tempo_changes: 2 } } });

    it('is empty when nothing was skipped or changed', async () => {
        const { saveAs } = make();
        expect(await saveAs.prepare('tef')).toEqual({ notice: '', error: '' });
        expect(await saveAs.prepare('otf')).toEqual({ notice: '', error: '' });
    });
    it('shows what the import did not keep, for every format', async () => {
        const { saveAs } = make({ otf: skippedDoc() });
        expect((await saveAs.prepare('otf')).notice).toBe('Not kept from this file: 2 tempo changes.');
        expect((await saveAs.prepare('txt')).notice).toBe('Not kept from this file: 2 tempo changes.');
    });
    it('adds the writer notices for .tef', async () => {
        const doc = skippedDoc();
        doc.notation.banjo[0].events[0].tick = 7;    // not on a 64th: moved
        const { notice } = await make({ otf: doc }).saveAs.prepare('tef');
        expect(notice).toMatch(/^Not kept from this file: 2 tempo changes\. Changed when saved as \.tef: 1 note moved to the nearest 64th\.$/);
    });
});

describe('errors', () => {
    it('a TefWriteError is a sentence in the panel and nothing downloads', async () => {
        const failing = async () => ({
            ...tefExport,
            loadDefaultTemplate: async () => new Uint8Array(10),   // not a TablEdit 3 file
        });
        const { saveAs, download, track } = make({ loadTefExport: failing });
        const prepared = await saveAs.prepare('tef');
        expect(prepared.error).toBe('The template is not a TablEdit 3 file.');
        expect(await saveAs.save('tef', 'a.tef')).toEqual({ error: 'The template is not a TablEdit 3 file.' });
        expect(download).not.toHaveBeenCalled();
        expect(track).not.toHaveBeenCalled();
    });
    it('a module that will not load reads as a plain sentence too', async () => {
        const { saveAs } = make({ loadTefExport: async () => { throw new Error('offline'); } });
        const { error } = await saveAs.prepare('tef');
        expect(error).toMatch(/^Could not make a \.tef file/);
    });
    it('does not fail the other formats', async () => {
        const { saveAs } = make({ loadTefExport: async () => { throw new Error('offline'); } });
        expect((await saveAs.save('otf', 'a')).filename).toBe('a.otf.json');
    });
});

describe('saving', () => {
    it('.tef: a file the importer reads back, tracked as tab_file_save', async () => {
        const { saveAs, download, track } = make();
        expect(await saveAs.save('tef', 'tune')).toEqual({ filename: 'tune.tef' });
        const [blob, name] = download.mock.calls[0];
        expect(name).toBe('tune.tef');
        const bytes = new Uint8Array(await readBlob(blob, 'readAsArrayBuffer'));
        expect(parseTef(bytes, name).notation.banjo[0].events[0].notes[0].f).toBe(2);
        expect(track).toHaveBeenCalledWith('tab_file_save', { format: 'tef' });
    });
    it('.tef from a source uses the stored bytes (a copy of the opened file)', async () => {
        const first = make();
        await first.saveAs.save('tef', 'a');
        const bytes = new Uint8Array(await readBlob(first.download.mock.calls[0][0], 'readAsArrayBuffer'));
        const writeSpy = vi.fn(tefExport.writeTef);
        const withSource = make({
            source: { name: 'a.tef', bytes: bytes.buffer },
            loadTefExport: async () => ({ ...tefExport, writeTef: writeSpy, loadDefaultTemplate: async () => template }),
        });
        await withSource.saveAs.save('tef', 'a');
        expect(writeSpy.mock.calls[0][1].source).toEqual(bytes);
    });
    it('.otf.json: the book layout', async () => {
        const { saveAs, download, track } = make();
        await saveAs.save('otf', 'tune.tef');
        const [blob, name] = download.mock.calls[0];
        expect(name).toBe('tune.otf.json');
        expect(JSON.parse(await readBlob(blob, 'readAsText')).metadata.title).toBe("Soldier's Joy");
        expect(track).toHaveBeenCalledWith('tab_file_save', { format: 'otf' });
    });
    it('.txt: one block per pitched track', async () => {
        const doc = otf();
        doc.tracks.push({ id: 'guitar', instrument: 'guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], capo: 0 });
        doc.notation.guitar = [{ measure: 1, events: [{ tick: 0, notes: [{ s: 2, f: 3, dur: 480 }] }] }];
        const { saveAs, download } = make({ otf: doc });
        await saveAs.save('txt', 'tune');
        const [blob, name] = download.mock.calls[0];
        expect(name).toBe('tune.txt');
        const text = await readBlob(blob, 'readAsText');
        expect(text).toContain('banjo (5-string-banjo)');
        expect(text).toContain('guitar (guitar)');
    });
});
