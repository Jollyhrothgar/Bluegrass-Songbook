// @vitest-environment jsdom
// Phase 2c: editing content you don't own doesn't overwrite it — it becomes
// your own arrangement on the same work. That has to be visible BEFORE the
// user submits, not discovered from the result, so the editor says it plainly
// while the edit is open and labels the button accordingly.
//
// The server classifies authoritatively; this is the courtesy warning, and it
// is deliberately conservative — no provenance means "not yours".
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initEditor, enterEditMode, exitEditMode, resetEditorForNewSong } from '../editor.js';

const SOMEONE_ELSES = {
    id: 'blue-moon-of-kentucky',
    title: 'Blue Moon of Kentucky',
    artist: 'Bill Monroe',
    submitted_by: 'someone-else-uuid',
    content: '{start_of_verse: Verse 1}\n[C]Blue moon of Kentucky\n{end_of_verse}\n',
};

const MINE = { ...SOMEONE_ELSES, submitted_by: 'me-uuid' };

const NO_PROVENANCE = {
    id: 'how-long-blues',
    title: 'How Long Blues',
    content: '[G]How long, baby, how long\n',
};

let refs;

function buildDom() {
    document.body.innerHTML = `
        <div id="editor-panel">
            <button id="metadata-summary" class="metadata-summary" type="button" aria-expanded="false"></button>
            <div id="metadata-fields" class="metadata-fields hidden">
                <input type="text" id="editor-title">
                <input type="text" id="editor-artist">
                <input type="text" id="editor-writer">
                <div id="edit-comment-row" class="hidden">
                    <textarea id="editor-comment"></textarea>
                </div>
            </div>
            <div class="editor-workspace">
                <div class="editor-pane editor-pane-raw">
                    <textarea id="editor-content"></textarea>
                </div>
                <div class="editor-pane editor-pane-preview">
                    <div id="editor-preview-container"></div>
                </div>
            </div>
            <div id="editor-status" class="save-status"></div>
            <button id="editor-submit-btn">Submit to Songbook</button>
        </div>
    `;
    return {
        editorTitle: document.getElementById('editor-title'),
        editorArtist: document.getElementById('editor-artist'),
        editorWriter: document.getElementById('editor-writer'),
        editorContent: document.getElementById('editor-content'),
        editorComment: document.getElementById('editor-comment'),
        editCommentRow: document.getElementById('edit-comment-row'),
        editorStatus: document.getElementById('editor-status'),
        editorSubmitBtn: document.getElementById('editor-submit-btn'),
        metadataSummary: document.getElementById('metadata-summary'),
        metadataFields: document.getElementById('metadata-fields'),
        editorPreviewContainer: document.getElementById('editor-preview-container'),
    };
}

function signInAs(id) {
    window.SupabaseAuth = { getUser: () => (id ? { id } : null) };
}

const notice = () => document.getElementById('editor-fork-notice');

beforeEach(() => {
    refs = buildDom();
    initEditor(refs);
    resetEditorForNewSong();
    signInAs('me-uuid');
});

afterEach(() => {
    delete window.SupabaseAuth;
});

describe('fork notice', () => {
    it("warns before submit when the chart is someone else's", async () => {
        await enterEditMode(SOMEONE_ELSES);

        expect(notice()).not.toBeNull();
        expect(notice().textContent).toBe(
            'This will be saved as your arrangement — the original stays untouched.');
        expect(refs.editorSubmitBtn.textContent).toBe('Save as My Arrangement');
    });

    it('stays quiet when the chart is your own', async () => {
        await enterEditMode(MINE);

        expect(notice()).toBeNull();
        expect(refs.editorSubmitBtn.textContent).toBe('Submit Correction');
    });

    it('treats missing provenance as not-owned', async () => {
        await enterEditMode(NO_PROVENANCE);

        expect(notice()).not.toBeNull();
    });

    it('warns when nobody is signed in (the login gate is at submit time)', async () => {
        signInAs(null);
        await enterEditMode(MINE);

        expect(notice()).not.toBeNull();
    });

    it('clears when the edit session ends', async () => {
        await enterEditMode(SOMEONE_ELSES);
        expect(notice()).not.toBeNull();

        exitEditMode();
        expect(notice()).toBeNull();
    });

    it('clears when the editor resets to a new song', async () => {
        await enterEditMode(SOMEONE_ELSES);
        resetEditorForNewSong();

        expect(notice()).toBeNull();
        expect(refs.editorSubmitBtn.textContent).toBe('Submit to Songbook');
    });

    it('never shows for a brand-new song', () => {
        resetEditorForNewSong();
        expect(notice()).toBeNull();
    });
});
