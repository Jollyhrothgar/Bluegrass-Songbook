// @vitest-environment jsdom
// Phase 2c: editing content you don't own doesn't overwrite it — it becomes
// your own arrangement on the same work. That has to be visible BEFORE the
// user submits, not discovered from the result, so the editor says it plainly
// while the edit is open and labels the button accordingly.
//
// The server classifies authoritatively; this is the courtesy warning, and it
// is deliberately conservative — no provenance means "not yours".
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    initEditor, enterEditMode, exitEditMode, resetEditorForNewSong,
    refreshEditorOwnership, editsInPlace, EDITOR_NOTICES,
} from '../editor.js';

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
        editorStatus: document.getElementById('editor-status'),
        editorSubmitBtn: document.getElementById('editor-submit-btn'),
        metadataSummary: document.getElementById('metadata-summary'),
        metadataFields: document.getElementById('metadata-fields'),
        editorPreviewContainer: document.getElementById('editor-preview-container'),
    };
}

function signInAs(id, { trusted = false } = {}) {
    window.SupabaseAuth = {
        getUser: () => (id ? { id } : null),
        isTrustedUser: async () => trusted,
    };
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
        expect(notice().textContent).toBe(EDITOR_NOTICES.fork);
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

    it('hedges when nobody is signed in (the login gate is at submit time)', async () => {
        signInAs(null);
        await enterEditMode(MINE);

        expect(notice()).not.toBeNull();
        expect(notice().textContent).toBe(EDITOR_NOTICES.signedOut);
        expect(notice().textContent).toMatch(/Sign in to submit/);
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

// The server updates in place for the chart's submitter AND for trusted users
// (supabase/functions/_shared/pending-dispatch.ts). The editor used to tell
// trusted users their edit would fork.
describe('trusted users edit in place', () => {
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    it("does not tell a trusted user their edit is a fork of someone else's chart", async () => {
        signInAs('trusted-uuid', { trusted: true });
        await enterEditMode(SOMEONE_ELSES);
        await flush();

        expect(notice().textContent).toBe(EDITOR_NOTICES.trusted);
        expect(notice().textContent).not.toMatch(/arrangement/);
        expect(refs.editorSubmitBtn.textContent).toBe('Submit Correction');
    });

    it('starts from the fork wording and corrects it when the trust answer lands', async () => {
        signInAs('trusted-uuid', { trusted: true });
        // enterEditMode has not awaited the RPC by the time it returns
        await enterEditMode(SOMEONE_ELSES);
        await flush();
        expect(refs.editorSubmitBtn.textContent).toBe('Submit Correction');

        // ...and an untrusted user keeps the arrangement wording throughout
        exitEditMode();
        signInAs('plain-uuid', { trusted: false });
        await refreshEditorOwnership();
        await enterEditMode(SOMEONE_ELSES);
        await flush();
        expect(notice().textContent).toBe(EDITOR_NOTICES.fork);
        expect(refs.editorSubmitBtn.textContent).toBe('Save as My Arrangement');
    });

    it('re-derives the wording when sign-in state changes mid-edit', async () => {
        signInAs(null);
        await enterEditMode(SOMEONE_ELSES);
        expect(notice().textContent).toBe(EDITOR_NOTICES.signedOut);

        signInAs('trusted-uuid', { trusted: true });
        await refreshEditorOwnership();
        expect(notice().textContent).toBe(EDITOR_NOTICES.trusted);
        expect(refs.editorSubmitBtn.textContent).toBe('Submit Correction');
    });

    it('editsInPlace: owner or trusted, never a signed-out trusted flag', () => {
        signInAs('me-uuid');
        expect(editsInPlace(MINE, false)).toBe(true);
        expect(editsInPlace(SOMEONE_ELSES, false)).toBe(false);
        expect(editsInPlace(SOMEONE_ELSES, true)).toBe(true);
        signInAs(null);
        expect(editsInPlace(SOMEONE_ELSES, true)).toBe(false);
    });
});
