// @vitest-environment jsdom
// Task 8: Visual | Raw editor tabs wiring in editor.js.
// The textarea (#editor-content) stays the source of truth for all existing
// flows; the visual editor mirrors serialized ChordPro into it on every change.
import { describe, it, expect, beforeEach } from 'vitest';
import { initEditor } from '../editor.js';

const SRC = `{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}
`;

let refs;

function buildDom() {
    document.body.innerHTML = `
        <div id="editor-panel">
            <div class="editor-tabs">
                <button id="editor-tab-visual" class="editor-tab active" type="button">Visual</button>
                <button id="editor-tab-raw" class="editor-tab" type="button">Raw ChordPro</button>
            </div>
            <div id="visual-editor-container" class="visual-editor-container"></div>
            <div class="editor-main hidden" id="editor-raw-main">
                <textarea id="editor-content"></textarea>
                <div id="editor-preview-content"></div>
            </div>
        </div>
    `;
    return {
        editorContent: document.getElementById('editor-content'),
        editorPreviewContent: document.getElementById('editor-preview-content'),
        editorTabVisual: document.getElementById('editor-tab-visual'),
        editorTabRaw: document.getElementById('editor-tab-raw'),
        visualEditorContainer: document.getElementById('visual-editor-container'),
        editorRawMain: document.getElementById('editor-raw-main')
    };
}

function init(refs) {
    initEditor({
        editorContent: refs.editorContent,
        editorPreviewContent: refs.editorPreviewContent,
        editorTabVisual: refs.editorTabVisual,
        editorTabRaw: refs.editorTabRaw,
        visualEditorContainer: refs.visualEditorContainer,
        editorRawMain: refs.editorRawMain
    });
}

function tapSyllable(text) {
    const syl = [...refs.visualEditorContainer.querySelectorAll('.ve-syl')]
        .find(s => s.textContent.trim().startsWith(text));
    syl.click();
}

function pickChord(chord) {
    [...refs.visualEditorContainer.querySelectorAll('.ve-palette .ve-chip-btn')]
        .find(b => b.textContent === chord)
        .click();
}

beforeEach(() => {
    refs = buildDom();
});

describe('tab defaults', () => {
    it('visual tab is active by default; raw main hidden; visual editor mounted', () => {
        init(refs);
        expect(refs.editorTabVisual.classList.contains('active')).toBe(true);
        expect(refs.editorTabRaw.classList.contains('active')).toBe(false);
        expect(refs.visualEditorContainer.classList.contains('hidden')).toBe(false);
        expect(refs.editorRawMain.classList.contains('hidden')).toBe(true);
        expect(refs.visualEditorContainer.classList.contains('ve-root')).toBe(true);
    });

    it('loads existing textarea content into the visual editor on init', () => {
        refs.editorContent.value = SRC;
        init(refs);
        const syls = [...refs.visualEditorContainer.querySelectorAll('.ve-syl')];
        expect(syls.some(s => s.textContent.includes('world'))).toBe(true);
    });
});

describe('tab switching', () => {
    it('clicking Raw shows the raw main and hides the visual container', () => {
        init(refs);
        refs.editorTabRaw.click();
        expect(refs.editorTabRaw.classList.contains('active')).toBe(true);
        expect(refs.editorTabVisual.classList.contains('active')).toBe(false);
        expect(refs.editorRawMain.classList.contains('hidden')).toBe(false);
        expect(refs.visualEditorContainer.classList.contains('hidden')).toBe(true);
    });

    it('switching back to Visual reloads textarea edits made in Raw', () => {
        init(refs);
        refs.editorTabRaw.click();
        refs.editorContent.value = SRC;
        refs.editorContent.dispatchEvent(new Event('input'));
        refs.editorTabVisual.click();
        const syls = [...refs.visualEditorContainer.querySelectorAll('.ve-syl')];
        expect(syls.some(s => s.textContent.includes('friend'))).toBe(true);
    });

    it('switching tabs without textarea changes preserves visual editor state (undo survives)', () => {
        refs.editorContent.value = SRC;
        init(refs);
        tapSyllable('world');
        pickChord('C');
        expect(refs.editorContent.value).toContain('[C]world');
        refs.editorTabRaw.click();
        refs.editorTabVisual.click();
        // no reload happened, so undo still reverts the chord placement
        refs.visualEditorContainer.querySelector('.ve-undo').click();
        expect(refs.editorContent.value).not.toContain('[C]');
    });
});

describe('mirroring', () => {
    it('visual edits mirror serialized ChordPro into the textarea and update the preview', () => {
        refs.editorContent.value = SRC;
        init(refs);
        tapSyllable('world');
        pickChord('C');
        expect(refs.editorContent.value).toContain('[G]hello [C]world friend');
        expect(refs.editorPreviewContent.innerHTML).toContain('world');
    });

    it('undo in the visual editor mirrors back into the textarea', () => {
        refs.editorContent.value = SRC;
        init(refs);
        tapSyllable('friend');
        pickChord('D');
        expect(refs.editorContent.value).toContain('[D]friend');
        refs.visualEditorContainer.querySelector('.ve-undo').click();
        expect(refs.editorContent.value).not.toContain('[D]');
        expect(refs.editorContent.value).toContain('[G]hello world friend');
    });

    it('raw textarea input still updates the preview (existing flow unchanged)', () => {
        init(refs);
        refs.editorTabRaw.click();
        refs.editorContent.value = '[G]Amazing grace';
        refs.editorContent.dispatchEvent(new Event('input'));
        expect(refs.editorPreviewContent.innerHTML).toContain('Amazing');
    });
});
