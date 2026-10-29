// Song editor for Bluegrass Songbook

import {
    allSongs,
    currentSong,
    editMode, setEditMode,
    editingSongId, setEditingSongId,
    editorNashvilleMode, setEditorNashvilleMode,
    currentView, setCurrentView
} from './state.js';
import { registerReturnSource } from './auth-return.js';
import { generateSlug, requireLogin } from './utils.js';
import { getSongContent, primeSongContent } from './song-content.js';
import { extractChords, toNashville, transposeChord, getSemitonesBetweenKeys, isValidChord, CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS } from './chords.js';
import { trackEditor, trackSubmission } from './analytics.js';
import { showToast } from './toast.js';
// Note: refreshPendingSongs is accessed via window.refreshPendingSongs to avoid circular import
import { mountLeadEditor } from './lead-editor/index.js';
import { pill, setBottomBand } from './shell.js';
import { currentSongKey, keyShift, withKey } from './lead-editor/doc-model.js';
import { diffChange } from './lead-editor/section-ops.js';
import { parseSong, serializeSong } from './visual-editor/model.js';
import {
    cleanChordUPaste, cleanUltimateGuitarPaste,
    editorConvertToChordPro, editorDetectAndConvert
} from './smart-paste.js';
import {
    Choice, findLikelyMatch, matchPercent, offrampChoices, planForChoice
} from './dedup-check.js';

// Re-export the shared smart-paste pipeline so existing importers/tests of
// editor.js keep working unchanged (the code moved verbatim to smart-paste.js).
export {
    cleanChordUPaste, cleanUltimateGuitarPaste,
    editorConvertToChordPro, editorDetectAndConvert
};

// Supabase configuration. Song submissions and corrections require a
// session (Phase 2a): identity comes from the verified session server-side,
// so the client sends the user's access token and no attribution field.
const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';

// Module-level state
let editorDetectedKey = null;
let autoDetectFormat = true; // Whether to auto-clean pasted content

// DOM element references (set by init)
let editorPanelEl = null;
let editorTitleEl = null;
let editorArtistEl = null;
let editorWriterEl = null;
let editorContentEl = null;
let editorCopyBtnEl = null;
let editorSaveBtnEl = null;
let editorSubmitBtnEl = null;
let editorStatusEl = null;
let editorNashvilleEl = null;
let editSongBtnEl = null;
let hintsBtnEl = null;
let hintsPanelEl = null;
let hintsBackdropEl = null;
let hintsCloseEl = null;
let autoDetectCheckboxEl = null;
let editorTransposeUpEl = null;
let editorTransposeDownEl = null;
let editorKeySelectEl = null;
let metadataSummaryEl = null;
let metadataFieldsEl = null;
let onSongRequestCb = null;

// Lead-sheet editor state: ONE CodeMirror view whose document is the ChordPro
// text (lead-editor/). `lead` is null only when it could not be mounted (no
// host element, or the vendored bundle failed): then the hidden #editor-content
// textarea is shown and stands in as a plain-text editor, so the same
// getText()/setText() adapter below serves both.
let editorLeadHostEl = null;
let editorUndoBtnEl = null;
let editorRedoBtnEl = null;
let editorTransposeGroupEl = null;
let lead = null;
// The record being edited, kept so the fork notice can ask "is this mine?"
// without going back through allSongs.
let editingSongRecord = null;
// True once enterEditMode has run, until the editor is reset to a fresh
// new-song state. Unlike editMode/editingSongId this survives exitEditMode,
// so entering Add Song later can tell "abandoned edit" from "unsaved draft".
let lastSessionWasEdit = false;

// Other DOM references
let navSearchEl = null;
let navAddSongEl = null;
let navFavoritesEl = null;
let resultsDivEl = null;
let songViewEl = null;

// ---------------------------------------------------------------------------
// The text adapter: every read/write of the song text goes through these two.
// ---------------------------------------------------------------------------

/** The lead-sheet editor's controller (lead-editor/index.js), or null if it could not mount. The feature tour's demo drives it. */
export function getLeadEditor() {
    return lead;
}

/** The ChordPro text of the song being edited. */
export function getText() {
    return lead ? lead.getText() : (editorContentEl?.value || '');
}

/**
 * Replace the whole text. `reset` is for opening a different song (it also
 * drops the undo history); without it the replacement is one undo step.
 */
/** On a desktop, put the caret in a new, empty song's sheet (called when the Add Song view is shown). */
export function focusEmptyEditor() {
    lead?.focusIfEmpty?.();
}

export function setText(text, { reset = false } = {}) {
    if (lead) lead.setText(text || '', { reset });
    else if (editorContentEl) editorContentEl.value = text || '';
}

/** Replace the text as ONE undo step (transpose, key change). */
function applyText(next, userEvent = 'input.transpose') {
    if (lead) {
        const old = lead.getText();
        if (old === next) return;
        lead.editor.change({ changes: diffChange(old, next) }, { userEvent, scroll: false });
    } else if (editorContentEl) {
        editorContentEl.value = next;
    }
}

/**
 * Derive the compact metadata line text from title/artist values.
 * Exported for unit tests.
 */
export function deriveMetadataSummary(title, artist) {
    const t = (title || '').trim();
    const a = (artist || '').trim();
    if (!t && !a) return 'Untitled song \u2014 tap to name';
    if (!t) return `Untitled song \u2014 ${a}`;
    return a ? `${t} \u2014 ${a}` : t;
}

/**
 * Refresh the compact metadata line from the current field values.
 * User content flows through textContent only.
 */
function updateMetadataSummary() {
    if (!metadataSummaryEl) return;
    metadataSummaryEl.textContent =
        deriveMetadataSummary(editorTitleEl?.value, editorArtistEl?.value);
    metadataSummaryEl.classList.toggle('metadata-summary-unnamed',
        !(editorTitleEl?.value || '').trim());
}

/**
 * Expand or collapse the full metadata fields under the compact line.
 */
function setMetadataExpanded(expanded) {
    if (metadataFieldsEl) metadataFieldsEl.classList.toggle('hidden', !expanded);
    if (metadataSummaryEl) {
        metadataSummaryEl.setAttribute('aria-expanded', String(!!expanded));
        metadataSummaryEl.classList.toggle('expanded', !!expanded);
    }
}

function metadataExpanded() {
    return !!(metadataFieldsEl && !metadataFieldsEl.classList.contains('hidden'));
}

/**
 * Missing required metadata on submit/save: expand the fields, focus the
 * offending input and surface a friendly notice via the status line.
 */
function promptForField(inputEl, message) {
    setMetadataExpanded(true);
    if (editorStatusEl) {
        editorStatusEl.textContent = message;
        editorStatusEl.className = 'save-status error';
    }
    inputEl?.focus();
}

/**
 * Enter edit mode for an existing song
 * @param {object} song - The song object to edit
 * @param {object} options - Options for edit mode
 * @param {boolean} options.fromHistory - True if called from history navigation (don't push history)
 * @param {boolean} options.fromDeepLink - True if called from deep link (don't push history)
 */
export async function enterEditMode(song, options = {}) {
    const { fromHistory = false, fromDeepLink = false } = options;

    // The ChordPro lives in data/songs/{id}.pro now (legacy rows still carry
    // it inline; getSongContent hands that back untouched). Fetch BEFORE
    // touching the editor so a slow network can't leave a half-open editor
    // with an empty textarea that a save would then publish.
    let content = '';
    try {
        content = await getSongContent(song);
    } catch (e) {
        window.alert('Could not load this song for editing. Please try again.');
        return;
    }

    setEditMode(true);
    setEditingSongId(song.id);
    editingSongRecord = song;
    lastSessionWasEdit = true;
    trackEditor('edit', song.id);

    // Reset key pin state for new edit session

    // Populate editor with song data
    if (editorTitleEl) editorTitleEl.value = song.title || '';
    if (editorArtistEl) editorArtistEl.value = song.artist || '';
    if (editorWriterEl) editorWriterEl.value = song.composer || '';
    setText(content || '', { reset: true });

    updateMetadataSummary();
    setMetadataExpanded(false);

    // Editing content that isn't yours forks instead of overwriting — unless
    // you are trusted, which updates in place. Say which, now, not after the
    // fact. Trust is an async RPC (cached after the first answer): paint with
    // what is known, then correct it when the answer lands.
    refreshOwnershipChrome();
    refreshTrustedStatus();

    // What "unsaved" is measured against, taken before anything is restored
    // over the top of it (a sign-in round trip puts the user's edits back).
    markEditorClean();
    // A sign-in round trip parked the user's edits of THIS song; put them back
    // over the published text (the baseline above stays the published text, so
    // they still count as unsaved).
    applyStagedRestore(song.id);

    // Show the editor THROUGH the view state machine, like every other view.
    // Hiding the song page by hand left app state saying "song page", so a
    // later navigation to another song was a no-op for the state (same value)
    // and the editor stayed on screen under the new URL. The currentView
    // subscriber in main.js owns showing/hiding every panel.
    setCurrentView('add-song');

    // Push history state (unless coming from history navigation or deep link)
    if (!fromHistory && !fromDeepLink) {
        // Import pushHistoryState dynamically to avoid circular dependency
        // Dispatch a custom event that main.js listens for
        window.dispatchEvent(new CustomEvent('editor-push-history', {
            detail: { view: 'edit', songId: song.id }
        }));
    }

    // Refresh key detection / toolbar and re-render the preview with a
    // clean undo history for the new editing session
    updateEditorChrome();
}

/**
 * Exit edit mode
 */
export function exitEditMode() {
    setEditMode(false);
    setEditingSongId(null);
    editingSongRecord = null;
    renderForkNotice();
    if (editorSubmitBtnEl) editorSubmitBtnEl.textContent = 'Submit to Songbook';
}

/**
 * Fully reset the editor panel to a fresh new-song state: clear metadata
 * fields and content, drop any edit-session state, and reload the visual
 * editor with empty content (which also clears its undo/redo stacks).
 */
export function resetEditorForNewSong() {
    setEditMode(false);
    setEditingSongId(null);
    editingSongRecord = null;
    renderForkNotice();
    lastSessionWasEdit = false;
    editorDetectedKey = null;

    if (editorTitleEl) editorTitleEl.value = '';
    if (editorArtistEl) editorArtistEl.value = '';
    if (editorWriterEl) editorWriterEl.value = '';
    setText('', { reset: true });
    if (editorSubmitBtnEl) editorSubmitBtnEl.textContent = 'Submit to Songbook';
    if (editorStatusEl) {
        editorStatusEl.textContent = '';
        editorStatusEl.className = 'save-status';
    }
    updateEditorKeySelect(null);

    updateMetadataSummary();
    setMetadataExpanded(false);
    markEditorClean();

    updateEditorChrome();
}

// ---------------------------------------------------------------------------
// Unsaved changes
// ---------------------------------------------------------------------------

// What the editor held when it was opened (or last saved). "Unsaved" means
// the fields differ from this.
let editorBaseline = { title: '', artist: '', writer: '', content: '' };

function readEditorFields() {
    return {
        title: (editorTitleEl?.value || '').trim(),
        artist: (editorArtistEl?.value || '').trim(),
        writer: (editorWriterEl?.value || '').trim(),
        content: getText(),
    };
}

/** Treat what is in the editor right now as saved (opened, reset, submitted). */
function markEditorClean() {
    editorBaseline = readEditorFields();
}

/** Does the editor hold edits that were neither submitted nor opened that way? */
export function editorHasUnsavedChanges() {
    const now = readEditorFields();
    return now.title !== editorBaseline.title
        || now.artist !== editorBaseline.artist
        || now.writer !== editorBaseline.writer
        || now.content !== editorBaseline.content;
}

/** Which session is open, for routing back to it: `{ isEdit, songId }`. */
export function editorSessionInfo() {
    return { isEdit: !!(editMode && editingSongId), songId: editingSongId || null };
}

// ---------------------------------------------------------------------------
// Surviving a sign-in redirect (auth-return.js)
// ---------------------------------------------------------------------------

/**
 * Sign-in is a full-page redirect and the lead-sheet editor has no draft
 * store, so the text lives in the return record for the trip. Runs
 * synchronously just before the redirect; null when the editor isn't on
 * screen (another source, or the bare route, answers instead).
 */
function editorReturnSource() {
    if (currentView !== 'add-song') return null;
    const { isEdit, songId } = editorSessionInfo();
    return {
        kind: 'lead-sheet',
        hash: isEdit ? `#edit/${songId}` : '#add',
        state: { ...readEditorFields(), editingSongId: isEdit ? songId : null },
    };
}

let stagedRestore = null;

/**
 * Hold a snapshot taken by `editorReturnSource` until the editor it belongs to
 * is open. An edit of an existing song opens asynchronously (the published
 * text is fetched first), so the snapshot waits for `enterEditMode` of that
 * song; a new-song snapshot is applied by `applyEditorRestore()` once the
 * `#add` route has been shown.
 */
export function stageEditorRestore(snapshot, { message = '' } = {}) {
    stagedRestore = snapshot ? { snapshot, message, at: Date.now() } : null;
}

/** Apply a staged snapshot for the new-song editor (no-op for an edit's). */
export function applyEditorRestore() {
    return applyStagedRestore(null);
}

function applyStagedRestore(songId) {
    const staged = stagedRestore;
    if (!staged) return false;
    // A snapshot whose song never opened (deleted, renamed) must not wait to
    // ambush some later edit.
    if (Date.now() - staged.at > 2 * 60 * 1000) { stagedRestore = null; return false; }
    if ((staged.snapshot.editingSongId || null) !== (songId || null)) return false;
    stagedRestore = null;

    const { title, artist, writer, content } = staged.snapshot;
    if (editorTitleEl) editorTitleEl.value = title || '';
    if (editorArtistEl) editorArtistEl.value = artist || '';
    if (editorWriterEl) editorWriterEl.value = writer || '';
    setText(content || '');
    updateMetadataSummary();
    updateEditorPreview();
    if (staged.message && editorStatusEl) {
        editorStatusEl.textContent = staged.message;
        editorStatusEl.className = 'save-status success';
    }
    return true;
}

let unsavedPromptResolve = null;

/** Is the leave-the-editor prompt on screen? */
export function unsavedPromptOpen() {
    return unsavedPromptResolve !== null;
}

/**
 * Dismiss the leave prompt without choosing (something else already decided —
 * the user came back to the editor by Back/Forward).
 */
export function closeUnsavedPrompt() {
    if (unsavedPromptResolve) unsavedPromptResolve('cancelled');
}

/**
 * Ask, in the page, whether to leave the editor with unsaved edits. Never
 * window.confirm: a native dialog cannot be styled, is not in the DOM (so no
 * test can drive it) and steals focus back from the textarea on iOS.
 *
 * The navigation has already happened by the time this runs (hash change,
 * Back, a click on a link), so "Keep editing" routes back here; the editor's
 * own state was left untouched while the prompt is up.
 *
 * Resolves `'keep' | 'discard' | 'cancelled'`. Exported for tests.
 */
export function promptUnsavedChanges() {
    closeUnsavedPrompt();
    return new Promise(resolve => {
        const { isEdit } = editorSessionInfo();
        const title = (editorTitleEl?.value || '').trim();

        document.getElementById('editor-leave-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'editor-leave-modal';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        const header = document.createElement('div');
        header.className = 'modal-header';
        const heading = document.createElement('h2');
        heading.textContent = isEdit ? 'Discard your changes?' : 'Leave without submitting?';
        header.appendChild(heading);

        const body = document.createElement('div');
        body.className = 'modal-body';
        const lead = document.createElement('p');
        lead.className = 'dedup-offramp-lead';
        const name = title ? `\u201c${title}\u201d` : 'this song';
        lead.textContent = isEdit
            ? `You have edited ${name} but not submitted it. Leaving now throws those edits away.`
            : `${name === 'this song' ? 'Your new song' : name} has not been submitted. `
                + 'It stays here while this tab is open, but it will not survive a reload.';
        body.appendChild(lead);

        // The choice buttons borrow the dedup offramp's stacked-button styling.
        const choices = document.createElement('div');
        choices.className = 'dedup-offramp-choices';
        const make = (id, label, primary) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dedup-offramp-choice'
                + (primary ? ' dedup-offramp-choice-primary' : '');
            button.dataset.choice = id;
            const text = document.createElement('span');
            text.className = 'dedup-offramp-choice-label';
            text.textContent = label;
            button.appendChild(text);
            return button;
        };
        choices.append(
            make('keep', 'Keep editing', true),
            make('discard', isEdit ? 'Discard changes' : 'Leave', false),
        );
        body.appendChild(choices);

        const content = document.createElement('div');
        content.className = 'modal-content dedup-offramp-content';
        content.append(header, body);
        modal.appendChild(content);
        document.body.appendChild(modal);

        const finish = (choice) => {
            if (!unsavedPromptResolve) return;
            unsavedPromptResolve = null;
            document.removeEventListener('keydown', onKey);
            modal.remove();
            resolve(choice);
        };
        const onKey = (e) => { if (e.key === 'Escape') finish('keep'); };
        unsavedPromptResolve = finish;

        choices.addEventListener('click', (e) => {
            const button = e.target.closest('[data-choice]');
            if (button) finish(button.dataset.choice);
        });
        modal.addEventListener('click', (e) => { if (e.target === modal) finish('keep'); });
        document.addEventListener('keydown', onKey);

        choices.querySelector('[data-choice="keep"]')?.focus();
    });
}

/**
 * Called when navigating to the Add Song view. If the previous editor
 * session was an edit of an existing song, reset to a fresh new-song editor
 * so stale content doesn't leak in. An unsaved new-song draft is preserved
 * (returning to your in-progress song is a feature, not a leak).
 */
export function prepareAddSongView() {
    if (editMode || editingSongId || lastSessionWasEdit) {
        resetEditorForNewSong();
    }
}

/**
 * Transpose all chords in the content by a number of semitones
 * Handles both inline [chord] format and standalone chords
 */
export function editorTransposeContent(content, semitones) {
    if (semitones === 0) return content;

    // Match ANY bracketed token and let isValidChord decide what to move —
    // a fixed quality list here would skip chords the palette and typed
    // entry happily insert (sus4, 6, m7b5, ...), leaving them a semitone
    // out of step with the rest of the song.
    const bracketTokenRegex = /\[([^\]\n]+)\]/g;

    let result = content.replace(bracketTokenRegex, (match, chord) =>
        isValidChord(chord) ? `[${transposeChord(chord, semitones)}]` : match);

    // Keep {key: X} / {meta: key X} directives in step with the chords so
    // downstream consumers (e.g. the visual editor's palette) see the new key
    const keyDirectiveRegex = /\{(key:\s*|meta:\s*key\s+)([A-G][#b]?(?:m|min)?)\s*\}/gi;
    result = result.replace(keyDirectiveRegex, (match, prefix, key) =>
        `{${prefix}${transposeChord(key, semitones)}}`);

    return result;
}

/**
 * Put the song in key `to`: every chord moves by the shift between the song's key and `to` (G -> A: +2; G -> Em: 0,
 * only the name), and `{key: to}` is written. ONE undo step. With no chords yet it only declares the key.
 */
export function songInKey(text, to) {
    const from = currentSongKey(text).key;
    return withKey(editorTransposeContent(text, keyShift(from, to)), to);
}
function setSongKey(to) {
    const text = getText();
    const next = songInKey(text, to);
    if (next !== text) applyText(next, 'input.key');
    updateEditorPreview();
}

/**
 * Update the editor key select dropdown
 */
function updateEditorKeySelect(detectedKey) {
    if (!editorKeySelectEl) return;
    // every key, major and minor: G -> Em only renames the key (the same chords), so a mis-detected mode is fixed here too
    if (editorKeySelectEl.options.length !== CHROMATIC_MAJOR_KEYS.length + CHROMATIC_MINOR_KEYS.length + 1) {
        editorKeySelectEl.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Key: –';
        editorKeySelectEl.appendChild(placeholder);
        for (const k of [...CHROMATIC_MAJOR_KEYS, ...CHROMATIC_MINOR_KEYS]) {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = `Key: ${k}`;
            editorKeySelectEl.appendChild(opt);
        }
    }

    editorKeySelectEl.value = detectedKey || '';
}

/**
 * Refresh the editor chrome that derives from the textarea content:
 * detected key + key select, and the progressive toolbar (transpose/key
 * appear once the document has a chord). Does NOT touch the preview —
 * preview-originated edits call this via onChange after they have already
 * rendered themselves.
 */
function updateEditorChrome() {
    const content = getText();
    const chords = extractChords(content);
    const detected = currentSongKey(content);   // declared {key:}, else detected: the same answer everywhere

    editorDetectedKey = detected.key;
    updateEditorKeySelect(detected.key);

    // progressive toolbar: the key stays out of the way until there is a song to put in a key (space is reserved, no
    // layout jump); it is there before the first chord, so the chord sheet offers the right chords from the start
    if (editorTransposeGroupEl) {
        editorTransposeGroupEl.classList.toggle('ve-gone', !content.trim());
    }
    if (editorTransposeUpEl) editorTransposeUpEl.disabled = chords.length === 0;
    if (editorTransposeDownEl) editorTransposeDownEl.disabled = chords.length === 0;
}

/**
 * Refresh the chrome and, in ChordPro mode, the read-only preview.
 */
export function updateEditorPreview() {
    updateEditorChrome();
    if (lead && lead.mode === 'chordpro') lead.refreshPreview();
}

/**
 * Generate ChordPro output for submit/copy/download. The textarea IS the
 * document — bridges, intros, {key:}/{tempo:}, ABC blocks and unknown
 * directives all round-trip through the model untouched (the same
 * parse/serialize the interactive preview uses). The metadata form fields
 * override or fill the corresponding directives; the detected key is added
 * only when the document doesn't already declare one.
 */
export function editorGenerateChordPro() {
    const title = editorTitleEl?.value.trim() || '';
    const artist = editorArtistEl?.value.trim() || '';
    const writer = editorWriterEl?.value.trim() || '';
    const content = getText();

    const doc = parseSong(content);
    if (title) doc.metadata.fields.title = title;
    if (artist) doc.metadata.fields.artist = artist;
    if (writer) doc.metadata.fields.composer = writer;
    if (!doc.metadata.fields.key && editorDetectedKey) {
        doc.metadata.fields.key = editorDetectedKey;
    }
    return serializeSong(doc).replace(/\n+$/, '') + '\n';
}

/**
 * Generate a filename from title
 */
export function editorGenerateFilename(title) {
    if (!title) return 'untitled.pro';
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 50) + '.pro';
}

/**
 * Toggle hints panel
 */
function toggleHints() {
    if (!hintsPanelEl || !hintsBackdropEl) return;
    const isHidden = hintsPanelEl.classList.contains('hidden');
    if (isHidden) {
        hintsPanelEl.classList.remove('hidden');
        hintsBackdropEl.classList.remove('hidden');
    } else {
        closeHints();
    }
}

/**
 * Close hints panel
 */
export function closeHints() {
    if (hintsPanelEl) hintsPanelEl.classList.add('hidden');
    if (hintsBackdropEl) hintsBackdropEl.classList.add('hidden');
}

/**
 * Mount the lead-sheet editor (CodeMirror, Visual / ChordPro modes). The
 * controller reports changes through hooks; everything downstream reads the
 * text through getText().
 */
function initLeadEditor() {
    if (!editorLeadHostEl) return;
    try {
        lead = mountLeadEditor({
            host: editorLeadHostEl,
            hooks: {
                // Nashville display mode: labels show numbers, the text stays chords
                getDisplay: () => editorDisplayChord,
                autoDetect: () => autoDetectFormat,
                onSongRequest: onSongRequestCb ? () => onSongRequestCb() : null,
                onChange() { updateEditorChrome(); },
                onHistory({ undo, redo }) {
                    if (editorUndoBtnEl) editorUndoBtnEl.disabled = undo === 0;
                    if (editorRedoBtnEl) editorRedoBtnEl.disabled = redo === 0;
                },
                onMode(mode, { showPreview }) { syncModeChrome(mode, showPreview); },
                onPaste(res) {
                    if (res.title && editorTitleEl && !editorTitleEl.value.trim()) editorTitleEl.value = res.title;
                    if (res.artist && editorArtistEl && !editorArtistEl.value.trim()) editorArtistEl.value = res.artist;
                    updateMetadataSummary();
                    if (editorStatusEl) {
                        editorStatusEl.textContent = 'Converted from chord sheet format';
                        editorStatusEl.className = 'save-status success';
                        setTimeout(() => { editorStatusEl.textContent = ''; }, 3000);
                    }
                },
            },
        });
        if (editorContentEl) editorContentEl.hidden = true;
    } catch (err) {
        // The vendored bundle (or the DOM) is unusable: fall back to the textarea.
        console.error('Lead-sheet editor could not start; using the plain text box:', err);
        lead = null;
        editorLeadHostEl.hidden = true;
        if (editorContentEl) editorContentEl.hidden = false;
    }
}

function editorDisplayChord(chord) {
    return (editorNashvilleMode && editorDetectedKey) ? toNashville(chord, editorDetectedKey) : chord;
}

/** Reflect the mode on the switch buttons and the phone Source | Preview toggle. */
/**
 * The editor's controls live in ONE place on every device: the app shell's bottom band (`#editor-band`: mode, undo /
 * redo, the key, Display). main.js calls this whenever the editor view shows; leaving the view clears the band, which
 * DETACHES the element (kept here, so its listeners and state survive for the next visit). The Display pill takes
 * `#editor-display-options` (text size, Nashville, paste cleanup) into its popover on first open.
 */
let editorBandEl = null;
let editorDisplayPill = null;
export function showEditorBand() {
    editorBandEl ||= document.getElementById('editor-band');
    if (!editorBandEl) return;
    if (!editorDisplayPill) {
        const options = document.getElementById('editor-display-options');
        editorDisplayPill = pill('Aa', (container) => { if (options) container.appendChild(options); },
            { id: 'editor-display-pill', title: 'Display: text size, Nashville numbers, paste cleanup', className: 'editor-display-pill' });
        editorDisplayPill.querySelector('.pill-btn')?.setAttribute('aria-label', 'Display');
        document.getElementById('editor-display-slot')?.replaceWith(editorDisplayPill);
    }
    editorBandEl.hidden = false;
    setBottomBand(editorBandEl);
}

/** The mode buttons may be detached (the band is cleared when the editor is not on screen), so look in the band too. */
function bandQueryAll(sel) {
    const found = new Set(document.querySelectorAll(sel));
    editorBandEl?.querySelectorAll(sel).forEach((b) => found.add(b));
    return [...found];
}

function syncModeChrome(mode, showPreview) {
    bandQueryAll('[data-lead-mode]').forEach((b) => {
        const on = b.dataset.leadMode === mode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-lead-pane]').forEach((b) => {
        const on = (b.dataset.leadPane === 'preview') === !!showPreview;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
    });
    const toggle = document.getElementById('editor-pane-toggle');
    if (toggle) toggle.classList.toggle('hidden', mode !== 'chordpro');
    const hint = document.getElementById('editor-chordpro-help');
    if (hint) hint.classList.toggle('hidden', mode !== 'chordpro');
}

/**
 * Initialize editor module with DOM elements
 */
export function initEditor(options) {
    const {
        editorPanel,
        editorTitle,
        editorArtist,
        editorWriter,
        editorContent,
        editorCopyBtn,
        editorSaveBtn,
        editorSubmitBtn,
        editorStatus,
        editorNashville,
        editSongBtn,
        hintsBtn,
        hintsPanel,
        hintsBackdrop,
        hintsClose,
        autoDetectCheckbox,
        editorTransposeUp,
        editorTransposeDown,
        editorKeySelect,
        metadataSummary,
        metadataFields,
        onSongRequest,
        editorLead,
        editorUndoBtn,
        editorRedoBtn,
        editorTransposeGroup,
        navSearch,
        navAddSong,
        navFavorites,
        resultsDiv,
        songView
    } = options;

    editorPanelEl = editorPanel;
    editorTitleEl = editorTitle;
    editorArtistEl = editorArtist;
    editorWriterEl = editorWriter;
    editorContentEl = editorContent;
    editorCopyBtnEl = editorCopyBtn;
    editorSaveBtnEl = editorSaveBtn;
    editorSubmitBtnEl = editorSubmitBtn;
    editorStatusEl = editorStatus;
    editorNashvilleEl = editorNashville;
    editSongBtnEl = editSongBtn;
    hintsBtnEl = hintsBtn;
    hintsPanelEl = hintsPanel;
    hintsBackdropEl = hintsBackdrop;
    hintsCloseEl = hintsClose;
    autoDetectCheckboxEl = autoDetectCheckbox;
    editorTransposeUpEl = editorTransposeUp;
    editorTransposeDownEl = editorTransposeDown;
    editorKeySelectEl = editorKeySelect;
    metadataSummaryEl = metadataSummary;
    metadataFieldsEl = metadataFields;
    onSongRequestCb = onSongRequest;
    navSearchEl = navSearch;
    navAddSongEl = navAddSong;
    navFavoritesEl = navFavorites;
    resultsDivEl = resultsDiv;
    songViewEl = songView;
    editorLeadHostEl = editorLead || null;
    editorUndoBtnEl = editorUndoBtn;
    editorRedoBtnEl = editorRedoBtn;
    editorTransposeGroupEl = editorTransposeGroup;

    // Leave a return record for the sign-in redirect (same function every
    // call, so a repeat init registers once)
    registerReturnSource(editorReturnSource);

    // Compact metadata line: tap to expand/collapse the full fields
    if (metadataSummaryEl) {
        metadataSummaryEl.addEventListener('click', () => {
            const expand = !metadataExpanded();
            setMetadataExpanded(expand);
            if (expand) editorTitleEl?.focus();
        });
        updateMetadataSummary();
    }

    // One CodeMirror view, two modes (Visual | ChordPro)
    initLeadEditor();
    document.querySelectorAll('[data-lead-mode]').forEach((b) => {
        b.addEventListener('click', () => lead?.setMode(b.dataset.leadMode));
    });
    document.querySelectorAll('[data-lead-pane]').forEach((b) => {
        b.addEventListener('click', () => lead?.setShowPreview(b.dataset.leadPane === 'preview'));
    });
    if (editorUndoBtnEl) editorUndoBtnEl.addEventListener('click', () => lead?.undo());
    if (editorRedoBtnEl) editorRedoBtnEl.addEventListener('click', () => lead?.redo());
    if (lead) syncModeChrome(lead.mode, false);
    updateEditorChrome();

    // Edit song button
    // window.__editInterceptor is set by work-view.js for placeholders
    if (editSongBtnEl) {
        editSongBtnEl.addEventListener('click', () => {
            if (window.__editInterceptor && window.__editInterceptor()) {
                return; // intercepted (e.g. placeholder metadata editor)
            }
            if (currentSong) {
                enterEditMode(currentSong);
            }
        });
    }

    // Paste handler
    // Plain-textarea fallback only (the CodeMirror editor handles paste itself)
    if (editorContentEl && !lead) {
        editorContentEl.addEventListener('paste', () => {
            setTimeout(() => {
                let text = editorContentEl.value;
                let statusMessage = '';
                let wasImported = false;

                // Skip auto-detection if disabled
                if (!autoDetectFormat) {
                    updateEditorPreview();
                    return;
                }

                // Try ChordU first (already has [chord] notation)
                const chordUResult = cleanChordUPaste(text);
                if (chordUResult.cleaned) {
                    text = chordUResult.text;
                    statusMessage = 'Imported from ChordU';
                    wasImported = true;

                    if (chordUResult.title && editorTitleEl && !editorTitleEl.value.trim()) {
                        editorTitleEl.value = chordUResult.title;
                    }
                    if (chordUResult.artist && editorArtistEl && !editorArtistEl.value.trim()) {
                        editorArtistEl.value = chordUResult.artist;
                    }
                    updateMetadataSummary();
                }

                // Try Ultimate Guitar
                if (!wasImported) {
                    const ugResult = cleanUltimateGuitarPaste(text);
                    if (ugResult.cleaned) {
                        text = ugResult.text;
                        statusMessage = 'Imported from Ultimate Guitar';
                        wasImported = true;

                        if (ugResult.title && editorTitleEl && !editorTitleEl.value.trim()) {
                            editorTitleEl.value = ugResult.title;
                        }
                        if (ugResult.artist && editorArtistEl && !editorArtistEl.value.trim()) {
                            editorArtistEl.value = ugResult.artist;
                        }
                        updateMetadataSummary();
                    }
                }

                // Convert chord-above-lyrics format if needed
                const converted = editorDetectAndConvert(text);
                if (converted !== text || wasImported) {
                    // one undo step, like transpose/key-select/wrap-section:
                    // a wrong auto-conversion must be recoverable
                    editorContentEl.value = converted;
                    updateEditorPreview();
                    if (editorStatusEl) {
                        editorStatusEl.textContent = statusMessage || 'Converted from chord sheet format';
                        editorStatusEl.className = 'save-status success';
                        setTimeout(() => { editorStatusEl.textContent = ''; }, 3000);
                    }
                }
            }, 0);
        });

        editorContentEl.addEventListener('input', () => updateEditorPreview());
    }

    if (editorTitleEl) editorTitleEl.addEventListener('input', updateMetadataSummary);
    if (editorArtistEl) editorArtistEl.addEventListener('input', updateMetadataSummary);

    if (editorNashvilleEl) {
        editorNashvilleEl.addEventListener('change', (e) => {
            setEditorNashvilleMode(e.target.checked);
            lead?.setDisplay(editorDisplayChord);
            updateEditorPreview();
        });
    }

    // THE key: one per song, changed only here, and it moves the whole song (chords + `{key:}`) as one undo step.
    if (editorKeySelectEl) {
        editorKeySelectEl.addEventListener('change', () => {
            const to = editorKeySelectEl.value;
            if (to) setSongKey(to);
            else updateEditorChrome();          // "not set" is not a choice: show the song's key again
        });
    }

    // Auto-detect format toggle
    if (autoDetectCheckboxEl) {
        autoDetectCheckboxEl.addEventListener('change', (e) => {
            autoDetectFormat = e.target.checked;
        });
    }

    // Transpose buttons - these modify actual chords, so let key re-detect
    if (editorTransposeUpEl) {
        editorTransposeUpEl.addEventListener('click', () => {
            applyText(editorTransposeContent(getText(), 1));
            updateEditorPreview();
        });
    }

    if (editorTransposeDownEl) {
        editorTransposeDownEl.addEventListener('click', () => {
            applyText(editorTransposeContent(getText(), -1));
            updateEditorPreview();
        });
    }

    // Hints
    if (hintsBtnEl) hintsBtnEl.addEventListener('click', toggleHints);
    if (hintsCloseEl) hintsCloseEl.addEventListener('click', closeHints);
    if (hintsBackdropEl) hintsBackdropEl.addEventListener('click', closeHints);

    // Copy button
    if (editorCopyBtnEl) {
        editorCopyBtnEl.addEventListener('click', async () => {
            const chordpro = editorGenerateChordPro();
            try {
                await navigator.clipboard.writeText(chordpro);
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Copied!';
                    editorStatusEl.className = 'save-status success';
                    setTimeout(() => { editorStatusEl.textContent = ''; }, 2000);
                }
            } catch (err) {
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Copy failed';
                    editorStatusEl.className = 'save-status error';
                }
            }
        });
    }

    // Save button
    if (editorSaveBtnEl) {
        editorSaveBtnEl.addEventListener('click', () => {
            const title = editorTitleEl?.value.trim();
            if (!title) {
                promptForField(editorTitleEl, 'Almost there \u2014 give your song a title first.');
                return;
            }

            const chordpro = editorGenerateChordPro();
            const filename = editorGenerateFilename(title);

            const blob = new Blob([chordpro], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (editorStatusEl) {
                editorStatusEl.textContent = `Downloaded: ${filename}`;
                editorStatusEl.className = 'save-status success';
                setTimeout(() => { editorStatusEl.textContent = ''; }, 3000);
            }
        });
    }

    // Submit button
    if (editorSubmitBtnEl) {
        editorSubmitBtnEl.addEventListener('click', async () => {
            const title = editorTitleEl?.value.trim();
            const artist = editorArtistEl?.value.trim();
            const writer = editorWriterEl?.value.trim();

            if (!title) {
                promptForField(editorTitleEl, 'Almost there \u2014 give your song a title first.');
                return;
            }

            const chordpro = editorGenerateChordPro();
            const content = getText().trim();

            if (!content) {
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Song content required';
                    editorStatusEl.className = 'save-status error';
                }
                return;
            }

            // Duplicate detection used to live here as a title-only confirm():
            // it fired on every same-titled song in the corpus (and there are
            // a lot of those) with no evidence and no useful answer — "Submit
            // anyway?" is not an offramp. Phase 3b replaced it with the real
            // scorer, which runs inside submitSong: lyrics decide, and a match
            // opens a modal whose choices are actual mechanisms.

            // Login gate at submit time, not at open time: anyone may draft
            // a song in the editor, but a submission is content the author
            // will come back looking for, so it needs an identity.
            if (!requireLogin('submit songs')) {
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Sign in to submit — your draft stays here.';
                    editorStatusEl.className = 'save-status error';
                }
                return;
            }

            // One path for everyone (phase 2b). Trust no longer decides how
            // fast a submission lands — only whether an edit of somebody
            // else's chart may land in place instead of forking.
            try {
                await submitSong({ title, artist, writer, chordpro, content });
            } catch {
                /* reported in the status line */
            }
        });
    }
}

/**
 * Is the content being edited the current user's own?
 *
 * Best effort, and deliberately conservative: no owner on the record means
 * "not yours". The server classifies authoritatively (it reads the work's
 * provenance out of git), so a wrong guess here only changes what the user
 * was told to expect, never what happens.
 */
export function ownsContent(song) {
    const user = window.SupabaseAuth?.getUser?.();
    if (!user?.id || !song) return false;
    // created_by: the live pending_songs row. submitted_by: the committed
    // work's lead-sheet provenance, carried through the index.
    const owner = song.created_by || song.submitted_by;
    return !!owner && owner === user.id;
}

// Last answer of is_trusted_user() for the signed-in user (false until asked).
let editorTrusted = false;

/**
 * Will this edit change the song in place (true) or land as the editor's own
 * arrangement (false)? Mirrors the server's classification in
 * supabase/functions/_shared/pending-dispatch.ts: the submitter of the chart
 * updates it, and so does a trusted user; everyone else forks.
 */
export function editsInPlace(song, trusted = editorTrusted) {
    if (ownsContent(song)) return true;
    return trusted === true && !!window.SupabaseAuth?.getUser?.()?.id;
}

/** The three things the fork notice can say. Exported for tests. */
export const EDITOR_NOTICES = {
    fork: 'This will be saved as your arrangement \u2014 the original stays untouched.',
    trusted: 'As a trusted editor, your changes update this song in place for everyone.',
    signedOut: 'Sign in to submit. Unless this chart is yours, your edit is saved as your own arrangement \u2014 the original stays untouched.',
};

/** Ask whether the signed-in user is trusted, then repaint what depends on it. */
async function refreshTrustedStatus() {
    const record = editingSongRecord;
    let trusted = false;
    try {
        trusted = (await window.SupabaseAuth?.isTrustedUser?.()) === true;
    } catch {
        // Not trusted is the safe read: it only changes the wording.
    }
    editorTrusted = trusted;
    if (editMode && editingSongRecord && editingSongRecord === record) {
        refreshOwnershipChrome();
    }
}

/**
 * Sign-in state changed while the editor is open (the sign-in round trip
 * lands back here): re-derive what the submit button and notice promise.
 */
export function refreshEditorOwnership() {
    editorTrusted = false;
    // Nothing on screen depends on it unless an edit is open — and this runs
    // on every sign-in event, which must not cost a trust lookup at boot.
    if (!editMode) return Promise.resolve();
    refreshOwnershipChrome();
    return refreshTrustedStatus();
}

/** Submit-button label and fork notice for the record being edited. */
function refreshOwnershipChrome() {
    if (editorSubmitBtnEl && editMode && editingSongRecord) {
        editorSubmitBtnEl.textContent = editsInPlace(editingSongRecord)
            ? 'Submit Correction'
            : 'Save as My Arrangement';
    }
    renderForkNotice();
}

/**
 * Say plainly, before they hit submit, what the server will do with the edit:
 * nothing to say for your own chart; "updates in place" for a trusted user;
 * otherwise that it becomes their own arrangement and the original is
 * untouched.
 */
function renderForkNotice() {
    if (!editorStatusEl?.parentNode) return;

    let notice = document.getElementById('editor-fork-notice');
    const shouldShow = editMode && !!editingSongRecord && !ownsContent(editingSongRecord);

    if (!shouldShow) {
        if (notice) notice.remove();
        return;
    }

    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'editor-fork-notice';
        notice.className = 'editor-fork-notice';
        editorStatusEl.parentNode.insertBefore(notice, editorStatusEl);
    }
    const signedIn = !!window.SupabaseAuth?.getUser?.()?.id;
    notice.textContent = !signedIn
        ? EDITOR_NOTICES.signedOut
        : editsInPlace(editingSongRecord) ? EDITOR_NOTICES.trusted : EDITOR_NOTICES.fork;
}

/**
 * "This song already exists" — offered as a choice at submit time, not
 * discovered as a rejection later.
 *
 * Returns `{ submit, retargetId, intent }`. No match means no modal and no
 * added friction: the overwhelmingly common case pays only a title-narrow
 * pass over the in-memory index plus, at most, five content fetches.
 *
 * Every failure mode here submits as new. Failing to warn about a duplicate
 * costs a merge later; blocking a contribution on a flaky fetch costs the
 * contribution — and the CI backstop is the second net under this one.
 */
async function resolveDedupOfframp({ title, content }) {
    const asNew = { submit: true, retargetId: null, intent: Choice.NEW };

    let match = null;
    try {
        // Archived works are matchable too — an archived duplicate is exactly
        // the case the "promote it" choice exists for.
        await window.ensureArchiveLoaded?.();
        match = await findLikelyMatch({
            title,
            content,
            songs: allSongs,
            fetchContent: getSongContent,
        });
    } catch (error) {
        console.warn('Dedup check failed; submitting as new:', error);
        return asNew;
    }
    if (!match) return asNew;

    let trusted = false;
    try {
        trusted = (await window.SupabaseAuth?.isTrustedUser?.()) === true;
    } catch {
        // Not trusted is the safe read: it only hides the promote button.
    }

    const choiceId = await showDedupModal(match, { trusted });
    if (!choiceId) {
        // Dismissed. Deliberately NOT "submit as new" — an accidental Escape
        // must not mint the duplicate the modal just warned about.
        return { submit: false, retargetId: null, intent: null };
    }

    const plan = planForChoice(choiceId, match);

    if (plan.navigateTo) {
        window.location.hash = plan.navigateTo;
        return plan;
    }

    if (plan.promoteFirst) {
        const { error } = (await window.SupabaseAuth?.promoteSong?.(match.song.id)) || {};
        if (error) {
            showToast(`Could not promote "${match.song.title}": ${error.message}`,
                { variant: 'warning', duration: 6000 });
        } else {
            // Live for everyone who loads the site from here on; this tab
            // picks it up on its next load (main.js reads promoted_songs at
            // startup). The song page itself works immediately either way.
            showToast(`"${match.song.title}" is back in search.`, { duration: 5000 });
        }
    }

    return plan;
}

/**
 * The offramp modal. Resolves with a `Choice` id, or null if dismissed.
 *
 * Deliberately plain: one sentence of evidence (the containment percentage,
 * which is the number the scorer actually decided on) and a stack of buttons
 * that each map to a mechanism that already exists.
 *
 * Exported for tests.
 */
export function showDedupModal(match, { trusted = false } = {}) {
    return new Promise(resolve => {
        const { song, verdict } = match;
        document.getElementById('dedup-offramp-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'dedup-offramp-modal';
        modal.className = 'modal';

        const archived = song.indexed === false;
        const byline = [song.artist, archived ? 'archived' : null]
            .filter(Boolean).join(' · ');

        const header = document.createElement('div');
        header.className = 'modal-header';
        const heading = document.createElement('h2');
        heading.textContent = 'This looks like a song we already have';
        const close = document.createElement('button');
        close.className = 'modal-close';
        close.setAttribute('aria-label', 'Close');
        close.innerHTML = '&times;';
        header.append(heading, close);

        const body = document.createElement('div');
        body.className = 'modal-body';

        const lead = document.createElement('p');
        lead.className = 'dedup-offramp-lead';
        const strong = document.createElement('strong');
        strong.textContent = song.title || song.id;
        lead.append('This looks like ', strong);
        if (byline) lead.append(` (${byline})`);
        lead.append(` — ${matchPercent(verdict)}% of its lyrics match what you wrote.`);
        body.appendChild(lead);

        const list = document.createElement('div');
        list.className = 'dedup-offramp-choices';
        for (const choice of offrampChoices(match, { trusted })) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dedup-offramp-choice'
                + (choice.primary ? ' dedup-offramp-choice-primary' : '');
            button.dataset.choice = choice.id;

            const label = document.createElement('span');
            label.className = 'dedup-offramp-choice-label';
            label.textContent = choice.label;
            button.appendChild(label);

            if (choice.detail) {
                const detail = document.createElement('span');
                detail.className = 'dedup-offramp-choice-detail';
                detail.textContent = choice.detail;
                button.appendChild(detail);
            }
            list.appendChild(button);
        }
        body.appendChild(list);

        const content = document.createElement('div');
        content.className = 'modal-content dedup-offramp-content';
        content.append(header, body);
        modal.appendChild(content);
        document.body.appendChild(modal);

        let done = false;
        const finish = (choiceId) => {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey);
            modal.remove();
            resolve(choiceId);
        };
        const onKey = (e) => { if (e.key === 'Escape') finish(null); };

        list.addEventListener('click', (e) => {
            const button = e.target.closest('.dedup-offramp-choice');
            if (button) finish(button.dataset.choice);
        });
        close.addEventListener('click', () => finish(null));
        modal.addEventListener('click', (e) => { if (e.target === modal) finish(null); });
        document.addEventListener('keydown', onKey);

        list.querySelector('.dedup-offramp-choice')?.focus();
    });
}

/**
 * Save a contribution: pending_songs first (live in seconds), then ask
 * auto-commit-song to make it durable (minutes).
 */
async function submitSong(data) {
    const { title, artist, writer, chordpro, content } = data;

    // Generate slug for the song ID
    const slug = editMode ? editingSongId : generateSlug(title, artist);

    // Detect key from chords
    const { key, mode } = currentSongKey(content);

    // Get current user ID for created_by
    const user = window.SupabaseAuth?.getUser?.();

    // Use raw textarea content (preserves user edits exactly) but normalize
    // ChordPro shorthand directives so the .pro file is always parseable
    const normalizedContent = content
        .replace(/^\{sov([:\s}])/gim, '{start_of_verse$1')
        .replace(/^\{soc([:\s}])/gim, '{start_of_chorus$1')
        .replace(/^\{eov([:\s}])/gim, '{end_of_verse$1')
        .replace(/^\{eoc([:\s}])/gim, '{end_of_chorus$1');

    // The offramp (phase 3b). Only for new songs: an edit already names the
    // work it targets, which is the same rule the CI backstop applies. A
    // retarget writes the row against the matched work instead of a fresh
    // slug — from there the server classifies it exactly as it would any
    // other edit of that work (update if they own content there, otherwise a
    // new arrangement part).
    let retargetId = null;
    let intent = Choice.NEW;
    if (!editMode) {
        // The check can await a handful of fetches and then a human; hold the
        // button so an impatient second click cannot open a second modal.
        if (editorSubmitBtnEl) editorSubmitBtnEl.disabled = true;
        let outcome;
        try {
            outcome = await resolveDedupOfframp({ title, content: normalizedContent });
        } finally {
            if (editorSubmitBtnEl) editorSubmitBtnEl.disabled = false;
        }
        if (!outcome.submit) {
            if (editorStatusEl && outcome.intent !== Choice.VIEW) {
                editorStatusEl.textContent = 'Not submitted — your draft is still here.';
                editorStatusEl.className = 'save-status';
            }
            return;
        }
        retargetId = outcome.retargetId;
        intent = outcome.intent;
    }
    const targetId = retargetId || slug;

    const pendingEntry = {
        id: targetId,
        replaces_id: editMode ? editingSongId : retargetId,
        title,
        artist: artist || null,
        composer: writer || null,
        content: normalizedContent,
        key: key || null,
        created_by: user?.id || null,
        mode: mode || null,
        tags: {},
        // Both stated, never inherited. This is an upsert on `id`, and a
        // chart row's id IS its work slug — which is also a song REQUEST's
        // row id. So a request for this song can already be sitting at this
        // key carrying `part_type: 'lead-sheet'` and `status: 'placeholder'`,
        // and PostgREST only overwrites the columns in the payload. Leaving
        // them out would file this chart as a placeholder: the server would
        // classify it as a request and `process_pending` would mint an empty
        // work instead of writing the ChordPro below it.
        part_type: 'lead-sheet',
        status: null,
    };

    // Disable button and show saving state
    editorSubmitBtnEl.disabled = true;
    if (editorStatusEl) {
        editorStatusEl.textContent = 'Saving...';
        editorStatusEl.className = 'save-status';
    }

    try {
        const supabase = window.SupabaseAuth?.supabase;
        if (!supabase) {
            throw new Error('Not connected to database');
        }

        // Verify we have an active session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Not logged in - please sign in and try again');
        }

        // Step 1: Insert/update pending_songs (instant visibility)
        const { error } = await supabase
            .from('pending_songs')
            .upsert(pendingEntry, { onConflict: 'id' });

        if (error) {
            throw new Error(error.message);
        }

        // Step 2: ask for the durable write. Still non-blocking — the edit is
        // already live from the pending_songs row above — but a failure is no
        // longer silent: the hourly reconciler will retry it, and the user is
        // told their edit is live but not yet synced rather than being left to
        // believe everything landed.
        //
        // The response is also where the user finds out what the server
        // decided the change WAS. The client's guess (the fork notice) is a
        // courtesy; this is the answer.
        triggerAutoCommit(pendingEntry).then(result => {
            if (result?.mode === 'fork') {
                showToast(
                    // The pill is labelled "N versions", so say that — and it
                    // is already listed there: the pending overlay carries
                    // both takes (corpus.pendingForkArrangements) minutes
                    // before the build publishes the new part.
                    `Saved as your arrangement of "${title}" — it's in the versions list on that song's page. The original is untouched.`,
                    { duration: 8000 }
                );
            }
        }).catch(e => {
            console.error('Auto-commit failed; edit is live but not yet in git:', e);
            showToast(
                'Saved and live — but syncing to the songbook is still pending. It will retry automatically.',
                { variant: 'warning', duration: 6000 }
            );
        });

        trackSubmission(editMode ? 'correction' : 'new_song');

        if (editorStatusEl) {
            editorStatusEl.textContent = 'Saved!';
            editorStatusEl.className = 'save-status success';
        }

        if (retargetId) {
            showToast(
                intent === Choice.ARRANGEMENT
                    ? `Added to "${title}" as your arrangement — no second copy of the song.`
                    : `Added to "${title}" instead of making a second copy.`,
                { duration: 6000 }
            );
        }

        // The saved text IS the truth for this session — seed the content
        // cache so the song page shows the edit instead of re-fetching the
        // published (pre-edit) data/songs/{slug}.pro
        primeSongContent(targetId, pendingEntry.content || '');
        if (pendingEntry.replaces_id) {
            primeSongContent(pendingEntry.replaces_id, pendingEntry.content || '');
        }

        // Submitted: what is on screen is now what is saved, so leaving for
        // the song page below must not ask "discard your changes?"
        markEditorClean();

        // Refresh the song index to include our new pending song, then navigate
        if (window.refreshPendingSongs) {
            await window.refreshPendingSongs();
        }
        window.location.hash = `#song/${targetId}`;

    } catch (error) {
        console.error('Save error:', error);
        if (editorStatusEl) {
            editorStatusEl.textContent = `Error: ${error.message}`;
            editorStatusEl.className = 'save-status error';
        }
        throw error;
    } finally {
        if (editorSubmitBtnEl) editorSubmitBtnEl.disabled = false;
    }
}

/**
 * Trigger the auto-commit edge function.
 *
 * Rejects when the durable write was not accepted, so the caller can tell the
 * user. The old version awaited the fetch and ignored `response.ok`, which
 * meant a 500 from the function resolved happily and the `.catch` never ran —
 * the failure mode this is here to surface was the one it hid.
 *
 * Resolves with the function's body: `{ success, mode, workId, reason }`,
 * where `mode` is 'create' | 'update' | 'fork' — the server's authoritative
 * answer about what this submission actually did.
 *
 * Exported for tests.
 */
export async function triggerAutoCommit(entry) {
    const supabase = window.SupabaseAuth?.supabase;
    const { data: { session } } = await supabase?.auth.getSession() || { data: {} };
    if (!session?.access_token) {
        throw new Error('No active session — cannot sync to the songbook');
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/auto-commit-song`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(entry),
    });

    if (!response.ok) {
        let detail = '';
        try {
            detail = (await response.json())?.error || '';
        } catch {
            // non-JSON error body; the status is enough
        }
        throw new Error(`auto-commit-song returned ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    try {
        return await response.json();
    } catch {
        // A 200 with an unreadable body still means the dispatch was
        // accepted; the caller just learns nothing about the mode.
        return null;
    }
}
