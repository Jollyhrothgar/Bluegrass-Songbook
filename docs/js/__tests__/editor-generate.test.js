// @vitest-environment jsdom
// Submit/copy/download output: editorGenerateChordPro must round-trip the
// textarea through the model — bridges, intros, {key:}/{tempo:} and ABC
// blocks survive — with the metadata form fields layered on top. The legacy
// verse/chorus-only regenerator used to destroy everything else.
import { describe, it, expect, beforeEach } from 'vitest';
import { initEditor, editorGenerateChordPro } from '../editor.js';

function buildDom() {
    document.body.innerHTML = `
        <div id="editor-panel">
            <div class="editor-topbar">
                <button id="metadata-summary" class="metadata-summary" type="button" aria-expanded="false"></button>
            </div>
            <div id="metadata-fields" class="metadata-fields hidden">
                <input type="text" id="editor-title">
                <input type="text" id="editor-artist">
            </div>
            <div class="editor-workspace">
                <textarea id="editor-content"></textarea>
                <div id="editor-preview-container"></div>
            </div>
        </div>
    `;
    return {
        editorTitle: document.getElementById('editor-title'),
        editorArtist: document.getElementById('editor-artist'),
        editorContent: document.getElementById('editor-content'),
        editorPreviewContainer: document.getElementById('editor-preview-container'),
        metadataSummary: document.getElementById('metadata-summary'),
        metadataFields: document.getElementById('metadata-fields')
    };
}

let refs;
beforeEach(() => {
    refs = buildDom();
    initEditor(refs);
});

describe('editorGenerateChordPro', () => {
    it('preserves bridge sections instead of re-wrapping them as verses', () => {
        refs.editorContent.value =
            '{start_of_verse: Verse 1}\n[G]down the road\n{end_of_verse}\n\n' +
            '{start_of_bridge: Bridge}\n[C]over the [G]sea\n{end_of_bridge}\n';
        const out = editorGenerateChordPro();
        expect(out).toContain('{start_of_bridge: Bridge}');
        expect(out).toContain('{end_of_bridge}');
        expect(out).toContain('[C]over the [G]sea');
    });

    it('preserves key and tempo directives', () => {
        refs.editorContent.value = '{key: Bb}\n{tempo: 120}\n\nhello world\n';
        const out = editorGenerateChordPro();
        expect(out).toContain('{key: Bb}');
        expect(out).toContain('{tempo: 120}');
    });

    it('preserves ABC passthrough blocks', () => {
        refs.editorContent.value = '{start_of_abc}\nX:1\nK:A\n|: E2AB :|\n{end_of_abc}\n';
        const out = editorGenerateChordPro();
        expect(out).toContain('X:1');
        expect(out).toContain('|: E2AB :|');
    });

    it('layers the metadata fields over the document', () => {
        refs.editorTitle.value = 'Nine Pound Hammer';
        refs.editorArtist.value = 'Merle Travis';
        refs.editorContent.value = '[G]roll on buddy\n';
        const out = editorGenerateChordPro();
        expect(out).toContain('{meta: title Nine Pound Hammer}');
        expect(out).toContain('{meta: artist Merle Travis}');
        expect(out).toContain('[G]roll on buddy');
    });

    it('form fields override existing metadata directives in place', () => {
        refs.editorTitle.value = 'New Title';
        refs.editorContent.value = '{meta: title Old Title}\n\n[G]hello\n';
        const out = editorGenerateChordPro();
        expect(out).toContain('{meta: title New Title}');
        expect(out).not.toContain('Old Title');
    });
});
