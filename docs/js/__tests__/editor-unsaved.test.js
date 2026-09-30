// @vitest-environment jsdom
// A7: entering the editor goes through the view state machine (currentView),
// and leaving it with unsubmitted edits asks in the page (not window.confirm).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    initEditor, enterEditMode, exitEditMode, resetEditorForNewSong,
    editorHasUnsavedChanges, editorSessionInfo, promptUnsavedChanges,
    closeUnsavedPrompt, unsavedPromptOpen,
} from '../editor.js';
import { currentView, setCurrentView } from '../state.js';

const SONG = {
    id: 'your-cheating-heart',
    title: 'Your Cheatin Heart',
    artist: 'Hank Williams',
    content: '{start_of_verse: Verse 1}\n[C]Your cheatin heart\n{end_of_verse}\n',
};

let refs;

function buildDom() {
    document.body.innerHTML = `
        <div id="editor-panel">
            <button id="metadata-summary" type="button"></button>
            <div id="metadata-fields" class="hidden">
                <input type="text" id="editor-title">
                <input type="text" id="editor-artist">
                <input type="text" id="editor-writer">
            </div>
            <textarea id="editor-content"></textarea>
            <div id="editor-preview-container"></div>
            <div id="editor-status" class="save-status"></div>
            <button id="editor-submit-btn">Submit to Songbook</button>
        </div>`;
    return {
        editorTitle: document.getElementById('editor-title'),
        editorArtist: document.getElementById('editor-artist'),
        editorWriter: document.getElementById('editor-writer'),
        editorContent: document.getElementById('editor-content'),
        editorStatus: document.getElementById('editor-status'),
        editorSubmitBtn: document.getElementById('editor-submit-btn'),
        metadataSummary: document.getElementById('metadata-summary'),
        metadataFields: document.getElementById('metadata-fields'),
        editorPreviewContainer: document.getElementById('editor-preview-container'),
    };
}

beforeEach(() => {
    refs = buildDom();
    initEditor(refs);
    resetEditorForNewSong();
    setCurrentView('song');
    window.SupabaseAuth = { getUser: () => ({ id: 'me' }) };
});

afterEach(() => {
    closeUnsavedPrompt();
    document.getElementById('editor-leave-modal')?.remove();
    delete window.SupabaseAuth;
});

describe('entering the editor', () => {
    it('goes through the view state machine (the A7 cause)', async () => {
        expect(currentView).toBe('song');
        await enterEditMode(SONG);
        expect(currentView).toBe('add-song');
    });

    it('does not hide panels by hand any more', async () => {
        const songView = document.createElement('div');
        songView.id = 'song-view';
        document.body.appendChild(songView);
        await enterEditMode(SONG);
        // main.js's currentView subscriber owns panel visibility; the editor
        // module must not be the thing that hides the song page.
        expect(songView.classList.contains('hidden')).toBe(false);
    });
});

describe('unsaved-changes tracking', () => {
    it('a freshly opened edit is clean', async () => {
        await enterEditMode(SONG);
        expect(editorHasUnsavedChanges()).toBe(false);
    });

    it('typing in the textarea or a metadata field makes it dirty', async () => {
        await enterEditMode(SONG);
        refs.editorContent.value += '\n[G]more';
        expect(editorHasUnsavedChanges()).toBe(true);
        refs.editorContent.value = SONG.content;
        expect(editorHasUnsavedChanges()).toBe(false);
        refs.editorTitle.value = 'Changed';
        expect(editorHasUnsavedChanges()).toBe(true);
    });

    it('a fresh new-song editor is clean; text in it is not', () => {
        expect(editorHasUnsavedChanges()).toBe(false);
        refs.editorContent.value = '[G]draft';
        expect(editorHasUnsavedChanges()).toBe(true);
    });

    it('resetEditorForNewSong and re-entering reset the baseline', async () => {
        refs.editorContent.value = '[G]draft';
        resetEditorForNewSong();
        expect(editorHasUnsavedChanges()).toBe(false);
        await enterEditMode(SONG);
        refs.editorContent.value = 'x';
        await enterEditMode({ ...SONG, id: 'other', title: 'Other' });
        expect(editorHasUnsavedChanges()).toBe(false);
    });

    it('editorSessionInfo names the song being edited', async () => {
        expect(editorSessionInfo()).toEqual({ isEdit: false, songId: null });
        await enterEditMode(SONG);
        expect(editorSessionInfo()).toEqual({ isEdit: true, songId: SONG.id });
        exitEditMode();
        expect(editorSessionInfo()).toEqual({ isEdit: false, songId: null });
    });
});

describe('the leave prompt', () => {
    const modal = () => document.getElementById('editor-leave-modal');

    it('is a DOM prompt with keep / discard, never window.confirm', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await enterEditMode(SONG);
        const pending = promptUnsavedChanges();

        expect(modal()).not.toBeNull();
        expect(unsavedPromptOpen()).toBe(true);
        expect(modal().textContent).toContain('Your Cheatin Heart');
        expect(modal().querySelector('[data-choice="keep"]')).not.toBeNull();
        expect(modal().querySelector('[data-choice="discard"]').textContent)
            .toBe('Discard changes');

        modal().querySelector('[data-choice="keep"]').click();
        expect(await pending).toBe('keep');
        expect(modal()).toBeNull();
        expect(unsavedPromptOpen()).toBe(false);
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('Discard resolves discard', async () => {
        await enterEditMode(SONG);
        const pending = promptUnsavedChanges();
        modal().querySelector('[data-choice="discard"]').click();
        expect(await pending).toBe('discard');
    });

    it('Escape and a backdrop click mean keep', async () => {
        const first = promptUnsavedChanges();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(await first).toBe('keep');

        const second = promptUnsavedChanges();
        modal().click();
        expect(await second).toBe('keep');
    });

    it('closeUnsavedPrompt (the user came back) resolves cancelled', async () => {
        const pending = promptUnsavedChanges();
        closeUnsavedPrompt();
        expect(await pending).toBe('cancelled');
        expect(modal()).toBeNull();
    });

    it('a new-song draft gets different wording from an edit', async () => {
        const pending = promptUnsavedChanges();
        expect(modal().textContent).toMatch(/Leave without submitting/);
        expect(modal().querySelector('[data-choice="discard"]').textContent).toBe('Leave');
        closeUnsavedPrompt();
        await pending;
    });
});
