// @vitest-environment jsdom
// A5, editor side: the lead-sheet editor registers what a sign-in redirect
// would destroy (the textarea + metadata) and puts it back afterwards.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    initEditor, enterEditMode, resetEditorForNewSong,
    stageEditorRestore, applyEditorRestore, editorHasUnsavedChanges,
} from '../editor.js';
import { setCurrentView } from '../state.js';
import { buildReturnRecord, takeReturnRecord, persistReturnRecord } from '../auth-return.js';

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
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    refs = buildDom();
    initEditor(refs);
    resetEditorForNewSong();
    setCurrentView('add-song');
    window.SupabaseAuth = { getUser: () => null };
});

afterEach(() => {
    delete window.SupabaseAuth;
    stageEditorRestore(null);
    setCurrentView('song');
});

describe('what the editor leaves for the redirect', () => {
    it('a new song: route #add, with every field', () => {
        refs.editorTitle.value = 'My Song';
        refs.editorArtist.value = 'Me';
        refs.editorWriter.value = 'Also Me';
        refs.editorContent.value = '[G]Hello\n[C]World';

        const record = buildReturnRecord();
        expect(record.kind).toBe('lead-sheet');
        expect(record.hash).toBe('#add');
        expect(record.state).toEqual({
            title: 'My Song', artist: 'Me', writer: 'Also Me',
            content: '[G]Hello\n[C]World', editingSongId: null,
        });
    });

    it('an edit: route #edit/{id}, with the USER\'s text not the published one', async () => {
        await enterEditMode(SONG);
        refs.editorContent.value = `${SONG.content}[G]my extra line\n`;

        const record = buildReturnRecord();
        expect(record.hash).toBe('#edit/your-cheating-heart');
        expect(record.state.editingSongId).toBe('your-cheating-heart');
        expect(record.state.content).toContain('my extra line');
    });

    it('says nothing when the editor is not the view on screen', () => {
        setCurrentView('song');
        refs.editorContent.value = '[G]not on screen';
        expect(buildReturnRecord()).toBeNull();
    });
});

describe('putting it back', () => {
    it('a new-song snapshot is applied by applyEditorRestore, with the message', () => {
        stageEditorRestore(
            { title: 'Back', artist: 'A', writer: 'W', content: '[D]restored', editingSongId: null },
            { message: 'Signed in — ready to submit' });

        expect(applyEditorRestore()).toBe(true);
        expect(refs.editorTitle.value).toBe('Back');
        expect(refs.editorArtist.value).toBe('A');
        expect(refs.editorWriter.value).toBe('W');
        expect(refs.editorContent.value).toBe('[D]restored');
        expect(refs.metadataSummary.textContent).toContain('Back');
        expect(refs.editorStatus.textContent).toBe('Signed in — ready to submit');
        expect(refs.editorStatus.className).toMatch(/success/);
        // consumed: a second apply does nothing
        expect(applyEditorRestore()).toBe(false);
    });

    it("an edit's snapshot waits for that song to open, then wins over the published text", async () => {
        stageEditorRestore({
            title: 'Your Cheatin Heart', artist: 'Hank Williams', writer: '',
            content: 'USER TEXT', editingSongId: SONG.id,
        }, { message: 'Signed in — ready to submit' });

        // not a new-song restore: applying for "no song" leaves it staged
        expect(applyEditorRestore()).toBe(false);

        await enterEditMode({ ...SONG, id: 'some-other-song', title: 'Other' });
        expect(refs.editorContent.value).not.toBe('USER TEXT');

        await enterEditMode(SONG);
        expect(refs.editorContent.value).toBe('USER TEXT');
        expect(refs.editorStatus.textContent).toBe('Signed in — ready to submit');
        // the restored edits still count as unsaved (baseline = published text)
        expect(editorHasUnsavedChanges()).toBe(true);
    });

    it('a snapshot for a song that never opens does not ambush a later edit', async () => {
        stageEditorRestore({
            title: 'x', artist: '', writer: '', content: 'STALE', editingSongId: SONG.id,
        });
        const realNow = Date.now;
        Date.now = () => realNow() + 10 * 60 * 1000;
        try {
            await enterEditMode(SONG);
        } finally {
            Date.now = realNow;
        }
        expect(refs.editorContent.value).toBe(SONG.content);
    });

    it('the whole trip: persist → take → stage → apply', () => {
        refs.editorTitle.value = 'Trip';
        refs.editorContent.value = '[A]there and back';
        expect(persistReturnRecord()).toBe(true);

        // the redirect wipes the page
        resetEditorForNewSong();
        expect(refs.editorContent.value).toBe('');

        const record = takeReturnRecord();
        stageEditorRestore(record.state, { message: 'ok' });
        applyEditorRestore();
        expect(refs.editorContent.value).toBe('[A]there and back');
        expect(refs.editorTitle.value).toBe('Trip');
    });
});
