// Phase 2d teardown guard: the document-upload INTAKE is gone, the shelf stays.
//
// The intake was a dead end — staged files and rows that nothing downstream
// ever read, behind a UI that said "Submitted for review!". These tests fail
// loudly if any part of it comes back, and equally loudly if the teardown took
// the read side (document parts already in works/) with it.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';

const JS_DIR = resolve(__dirname, '..');
const INDEX_HTML = resolve(__dirname, '../../index.html');

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name === '__tests__' || name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (name.endsWith('.js')) out.push(full);
    }
    return out;
}

const SOURCES = walk(JS_DIR);

describe('doc-upload teardown', () => {
    it('the feature module is gone', () => {
        expect(existsSync(join(JS_DIR, 'doc-upload.js'))).toBe(false);
    });

    it('every relative import in docs/js resolves to a file that exists', () => {
        const dangling = [];
        let checked = 0;
        const importRe = /(?:^|[\s;{(=])(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/gm;
        for (const file of SOURCES) {
            const src = readFileSync(file, 'utf-8');
            let m;
            while ((m = importRe.exec(src)) !== null) {
                const spec = m[1] || m[2];
                checked++;
                const target = resolve(dirname(file), spec);
                if (!existsSync(target)) dangling.push(`${file} -> ${spec}`);
            }
        }
        // guard the guard: a regex that matched nothing would pass vacuously
        expect(checked).toBeGreaterThan(50);
        expect(dangling).toEqual([]);
    });

    it('no source reaches the retired upload plumbing', () => {
        const banned = [
            'doc-upload.js', 'initDocUpload', 'resetDocUpload', 'prefillDocUpload',
            'doc_staging', 'doc-staging',
            'uploadPlaceholderDocument', '__pendingDocuments',
            'onUploadRequest',
        ];
        const hits = [];
        for (const file of SOURCES) {
            const src = readFileSync(file, 'utf-8');
            for (const token of banned) {
                if (src.includes(token)) hits.push(`${file}: ${token}`);
            }
        }
        expect(hits).toEqual([]);
    });

    it('index.html has no upload panel and no upload picker card', () => {
        const html = readFileSync(INDEX_HTML, 'utf-8');
        expect(html).not.toContain('id="upload-panel"');
        expect(html).not.toContain('data-type="upload"');
        expect(html).not.toContain('upload-dropzone');
    });

    it('keeps the shelf: document parts still render on the song page', () => {
        const workView = readFileSync(join(JS_DIR, 'work-view.js'), 'utf-8');
        expect(workView).toContain('renderDocumentPart');
        expect(workView).toContain('song.document_parts');
        expect(workView).toContain('document-viewer');
    });
});
