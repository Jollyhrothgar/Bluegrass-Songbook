// @vitest-environment jsdom
// Two-pane editor wiring in editor.js: the #editor-content textarea is THE
// document; the interactive preview (right pane) renders from it and writes
// every preview-side edit back into it. Submit/copy/download and the smart
// paste pipeline keep reading the textarea unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initEditor } from '../editor.js';
import { REFRESH_DEBOUNCE_MS } from '../visual-editor/preview.js';

const SRC = `{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}
`;

let refs;

function buildDom() {
    document.body.innerHTML = `
        <div id="editor-panel">
            <div id="editor-toolbar" class="editor-toolbar">
                <button id="editor-undo" type="button" disabled>Undo</button>
                <button id="editor-redo" type="button" disabled>Redo</button>
                <span id="editor-transpose-group" class="ve-transpose-group ve-gone">
                    <button id="editor-transpose-down" type="button">−</button>
                    <select id="editor-key-select"><option value="">Key: ?</option></select>
                    <button id="editor-transpose-up" type="button">+</button>
                </span>
            </div>
            <div class="editor-workspace">
                <div class="editor-pane editor-pane-raw">
                    <textarea id="editor-content"></textarea>
                </div>
                <div class="editor-pane editor-pane-preview">
                    <div id="editor-preview-container"></div>
                </div>
            </div>
        </div>
    `;
    return {
        editorContent: document.getElementById('editor-content'),
        editorPreviewContainer: document.getElementById('editor-preview-container'),
        editorUndoBtn: document.getElementById('editor-undo'),
        editorRedoBtn: document.getElementById('editor-redo'),
        editorTransposeGroup: document.getElementById('editor-transpose-group'),
        editorTransposeUp: document.getElementById('editor-transpose-up'),
        editorTransposeDown: document.getElementById('editor-transpose-down'),
        editorKeySelect: document.getElementById('editor-key-select')
    };
}

function init(refs) {
    initEditor(refs);
}

function tapSyllable(text) {
    const syl = [...refs.editorPreviewContainer.querySelectorAll('.ve-syl')]
        .find(s => s.textContent.trim().startsWith(text));
    syl.click();
}

function pickChord(chord) {
    [...refs.editorPreviewContainer.querySelectorAll('.ve-palette .ve-chip-btn')]
        .find(b => b.textContent === chord)
        .click();
}

beforeEach(() => {
    refs = buildDom();
});

describe('two-pane defaults', () => {
    it('mounts the interactive preview next to the always-visible textarea', () => {
        init(refs);
        expect(refs.editorPreviewContainer.classList.contains('ve-preview')).toBe(true);
        // no tab UI anywhere: both panes coexist
        expect(document.getElementById('editor-tab-raw')).toBeNull();
        expect(document.getElementById('editor-tab-visual')).toBeNull();
    });

    it('renders existing textarea content into the preview on init', () => {
        refs.editorContent.value = SRC;
        init(refs);
        const syls = [...refs.editorPreviewContainer.querySelectorAll('.ve-syl')];
        expect(syls.some(s => s.textContent.includes('world'))).toBe(true);
        expect(refs.editorPreviewContainer.querySelector('.ve-section-label').textContent).toBe('Verse 1');
    });

    it('empty textarea shows the preview empty state', () => {
        init(refs);
        expect(refs.editorPreviewContainer.querySelector('.ve-preview-empty')).not.toBeNull();
    });
});

describe('preview edits write the textarea', () => {
    it('tap syllable + palette pick appends the chord to the raw text', () => {
        refs.editorContent.value = SRC;
        init(refs);
        tapSyllable('world');
        pickChord('C');
        expect(refs.editorContent.value).toContain('[G]hello [C]world friend');
    });

    it('undo button mirrors back into the textarea', () => {
        refs.editorContent.value = SRC;
        init(refs);
        tapSyllable('friend');
        pickChord('D');
        expect(refs.editorContent.value).toContain('[D]friend');
        refs.editorUndoBtn.click();
        expect(refs.editorContent.value).not.toContain('[D]');
        expect(refs.editorContent.value).toContain('[G]hello world friend');
    });

    it('a preview edit does not steal focus from the textarea', () => {
        refs.editorContent.value = SRC;
        init(refs);
        refs.editorContent.focus();
        // (edits only originate from one side at a time; this guards the
        // programmatic write path against focus/caret theft)
        tapSyllable('world');
        pickChord('C');
        expect(refs.editorContent.value).toContain('[C]world');
        expect(document.activeElement).not.toBe(refs.editorContent.ownerDocument.body);
    });
});

describe('textarea edits update the preview (debounced)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('typing re-renders the preview after the debounce window', () => {
        init(refs);
        refs.editorContent.value = SRC;
        refs.editorContent.dispatchEvent(new Event('input'));
        // not yet — typing must not thrash the preview
        expect(refs.editorPreviewContainer.querySelector('.ve-preview-empty')).not.toBeNull();
        vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
        const syls = [...refs.editorPreviewContainer.querySelectorAll('.ve-syl')];
        expect(syls.some(s => s.textContent.includes('friend'))).toBe(true);
    });

    it('keystroke bursts collapse into a single re-render', () => {
        init(refs);
        refs.editorContent.value = '[G]partial';
        refs.editorContent.dispatchEvent(new Event('input'));
        vi.advanceTimersByTime(100);
        refs.editorContent.value = SRC;
        refs.editorContent.dispatchEvent(new Event('input'));
        vi.advanceTimersByTime(100);
        expect(refs.editorPreviewContainer.querySelector('.ve-preview-empty')).not.toBeNull();
        vi.advanceTimersByTime(100);
        expect(refs.editorPreviewContainer.textContent).toContain('world');
    });
});

describe('progressive toolbar', () => {
    it('transpose/key group stays gone until the document has a chord', () => {
        init(refs);
        expect(refs.editorTransposeGroup.classList.contains('ve-gone')).toBe(true);

        refs.editorContent.value = 'just some words';
        refs.editorContent.dispatchEvent(new Event('input'));
        expect(refs.editorTransposeGroup.classList.contains('ve-gone')).toBe(true);

        refs.editorContent.value = SRC;
        refs.editorContent.dispatchEvent(new Event('input'));
        expect(refs.editorTransposeGroup.classList.contains('ve-gone')).toBe(false);
    });

    it('appears immediately after the first preview-placed chord', () => {
        refs.editorContent.value = '{start_of_verse: Verse 1}\nhello world friend\n{end_of_verse}\n';
        init(refs);
        expect(refs.editorTransposeGroup.classList.contains('ve-gone')).toBe(true);
        tapSyllable('world');
        pickChord('C');
        expect(refs.editorTransposeGroup.classList.contains('ve-gone')).toBe(false);
    });
});

describe('host transpose is undoable and preview follows', () => {
    it('transpose up rewrites the textarea, re-renders, and undo restores it', () => {
        refs.editorContent.value = SRC;
        init(refs);
        refs.editorTransposeUp.click();
        expect(refs.editorContent.value).toMatch(/\[(G#|Ab)\]hello/);
        const chip = refs.editorPreviewContainer.querySelector('.ve-chip');
        expect(chip.textContent).toMatch(/^(G#|Ab)$/);
        refs.editorUndoBtn.click();
        expect(refs.editorContent.value).toContain('[G]hello');
    });

    it('palette diatonic chips follow a host transpose', () => {
        refs.editorContent.value = SRC;
        init(refs);
        tapSyllable('world');
        let labels = [...refs.editorPreviewContainer.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('G');
        refs.editorTransposeUp.click();
        refs.editorTransposeUp.click();
        labels = [...refs.editorPreviewContainer.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('A');
        expect(labels).toContain('E7');
    });
});
