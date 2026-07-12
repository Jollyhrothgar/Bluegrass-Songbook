// @vitest-environment jsdom
// Add Song editor state reset: entering the Add Song view after editing an
// existing song must present a fresh new-song editor, while an unsaved
// new-song draft is preserved (returning to it is a feature, not a leak).
import { describe, it, expect, beforeEach } from 'vitest';
import {
    initEditor, enterEditMode, exitEditMode,
    prepareAddSongView, resetEditorForNewSong
} from '../editor.js';
import { editMode, editingSongId } from '../state.js';

const SONG_A = {
    id: 'your-cheating-heart',
    title: 'Your Cheatin Heart',
    artist: 'Hank Williams',
    composer: 'Hank Williams',
    content: '{start_of_verse: Verse 1}\n[G]Your cheatin heart\n{end_of_verse}\n'
};

const SONG_B = {
    id: 'blue-moon-of-kentucky',
    title: 'Blue Moon of Kentucky',
    artist: 'Bill Monroe',
    composer: 'Bill Monroe',
    content: '{start_of_verse: Verse 1}\n[C]Blue moon of Kentucky\n{end_of_verse}\n'
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
            <div class="editor-tabs">
                <button id="editor-tab-visual" class="editor-tab active" type="button">Visual</button>
                <button id="editor-tab-raw" class="editor-tab" type="button">Raw ChordPro</button>
            </div>
            <div id="visual-editor-container" class="visual-editor-container"></div>
            <div class="editor-main hidden" id="editor-raw-main">
                <textarea id="editor-content"></textarea>
                <div id="editor-preview-content"></div>
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
        editorPreviewContent: document.getElementById('editor-preview-content'),
        editorComment: document.getElementById('editor-comment'),
        editCommentRow: document.getElementById('edit-comment-row'),
        editorStatus: document.getElementById('editor-status'),
        editorSubmitBtn: document.getElementById('editor-submit-btn'),
        metadataSummary: document.getElementById('metadata-summary'),
        metadataFields: document.getElementById('metadata-fields'),
        editorTabVisual: document.getElementById('editor-tab-visual'),
        editorTabRaw: document.getElementById('editor-tab-raw'),
        visualEditorContainer: document.getElementById('visual-editor-container'),
        editorRawMain: document.getElementById('editor-raw-main')
    };
}

beforeEach(() => {
    refs = buildDom();
    initEditor(refs);
    // Editor module state is module-level; start every test from a known
    // fresh new-song state.
    resetEditorForNewSong();
});

function expectFreshNewSongEditor() {
    expect(refs.editorTitle.value).toBe('');
    expect(refs.editorArtist.value).toBe('');
    expect(refs.editorWriter.value).toBe('');
    expect(refs.editorContent.value).toBe('');
    expect(refs.editorComment.value).toBe('');
    expect(refs.editCommentRow.classList.contains('hidden')).toBe(true);
    expect(refs.metadataSummary.textContent).toBe('Untitled song — tap to name');
    expect(refs.metadataFields.classList.contains('hidden')).toBe(true);
    expect(refs.editorSubmitBtn.textContent).toBe('Submit to Songbook');
    expect(editMode).toBe(false);
    expect(editingSongId).toBe(null);
    // Visual tab active with the empty-state paste box (no stale sections)
    expect(refs.editorTabVisual.classList.contains('active')).toBe(true);
    expect(refs.visualEditorContainer.querySelector('.ve-empty-paste')).not.toBe(null);
    expect(refs.visualEditorContainer.querySelectorAll('.ve-section').length).toBe(0);
}

describe('prepareAddSongView', () => {
    it('resets to a fresh new-song editor when the previous session edited a song', () => {
        enterEditMode(SONG_A);
        expect(refs.editorTitle.value).toBe('Your Cheatin Heart');
        expect(editingSongId).toBe('your-cheating-heart');

        prepareAddSongView();
        expectFreshNewSongEditor();
    });

    it('still resets after exitEditMode already ran (home detour between edit and Add Song)', () => {
        enterEditMode(SONG_A);
        // Navigating home fires exitEditMode via the view subscriber;
        // editingSongId is already null by the time Add Song is clicked.
        exitEditMode();
        expect(editingSongId).toBe(null);
        expect(refs.editorTitle.value).toBe('Your Cheatin Heart'); // stale until reset

        prepareAddSongView();
        expectFreshNewSongEditor();
    });

    it('preserves an unsaved new-song draft (no previous edit session)', () => {
        refs.editorTitle.value = 'My Draft Song';
        refs.editorContent.value = '[G]Half-finished line';

        prepareAddSongView();

        expect(refs.editorTitle.value).toBe('My Draft Song');
        expect(refs.editorContent.value).toBe('[G]Half-finished line');
        expect(editMode).toBe(false);
        expect(editingSongId).toBe(null);
    });

    it('resets when Add Song is entered directly from an active edit session', () => {
        enterEditMode(SONG_A);
        // no exitEditMode: user goes straight edit -> Add Song
        prepareAddSongView();
        expectFreshNewSongEditor();
    });
});

describe('sequential edit sessions and reverse leak', () => {
    it('editing song B after abandoning an edit of song A shows B, not A', () => {
        enterEditMode(SONG_A);
        exitEditMode();
        enterEditMode(SONG_B);
        expect(refs.editorTitle.value).toBe('Blue Moon of Kentucky');
        expect(refs.editorContent.value).toBe(SONG_B.content);
        expect(editingSongId).toBe('blue-moon-of-kentucky');
        // visual editor shows B's lyrics, not A's
        const text = refs.visualEditorContainer.textContent;
        expect(text).toContain('Kentucky');
        expect(text).not.toContain('cheatin');
    });

    it('opening Edit after abandoning a new-song draft fully loads the song', () => {
        refs.editorTitle.value = 'My Draft Song';
        refs.editorContent.value = '[G]Half-finished line';

        enterEditMode(SONG_A);
        expect(refs.editorTitle.value).toBe('Your Cheatin Heart');
        expect(refs.editorContent.value).toBe(SONG_A.content);
        const text = refs.visualEditorContainer.textContent;
        expect(text).toContain('cheatin');
        expect(text).not.toContain('Half-finished');
    });

    it('a reset session submits as a new song, and a later edit is unaffected', () => {
        enterEditMode(SONG_A);
        prepareAddSongView();
        // submit flow reads editMode/editingSongId: both must be new-song
        expect(editMode).toBe(false);
        expect(editingSongId).toBe(null);

        enterEditMode(SONG_B);
        expect(editMode).toBe(true);
        expect(editingSongId).toBe('blue-moon-of-kentucky');
        expect(refs.editorSubmitBtn.textContent).toBe('Submit Correction');
    });
});
