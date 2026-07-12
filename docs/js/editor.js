// Song editor for Bluegrass Songbook

import {
    allSongs,
    currentSong,
    editMode, setEditMode,
    editingSongId, setEditingSongId,
    editorNashvilleMode, setEditorNashvilleMode
} from './state.js';
import { generateSlug } from './utils.js';
import { extractChords, detectKey, toNashville, transposeChord, getSemitonesBetweenKeys, CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS } from './chords.js';
import { trackEditor, trackSubmission } from './analytics.js';
// Note: refreshPendingSongs is accessed via window.refreshPendingSongs to avoid circular import
import { openSuperUserRequestModal } from './superuser-request.js';
import { createInteractivePreview } from './visual-editor/preview.js';
import { wrapSelectionAsSection } from './visual-editor/wrap-section.js';
import {
    cleanChordUPaste, cleanUltimateGuitarPaste,
    editorConvertToChordPro, editorDetectAndConvert
} from './smart-paste.js';

// Re-export the shared smart-paste pipeline so existing importers/tests of
// editor.js keep working unchanged (the code moved verbatim to smart-paste.js).
export {
    cleanChordUPaste, cleanUltimateGuitarPaste,
    editorConvertToChordPro, editorDetectAndConvert
};

/**
 * Get the submitter attribution for issue body.
 * Requires logged-in user (anonymous path removed).
 */
function getSubmitterAttribution() {
    const user = window.SupabaseAuth?.getUser?.();
    return user?.user_metadata?.full_name || user?.email || 'Anonymous User';
}

// Supabase configuration for anonymous submissions
const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

// Module-level state
let editorDetectedKey = null;
let editorKeyPinned = false; // Whether the user manually set the key
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
let editorCommentEl = null;
let editCommentRowEl = null;
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
let onUploadRequestCb = null;
let onSongRequestCb = null;

// Two-pane interactive preview state
let editorPreviewContainerEl = null;
let editorUndoBtnEl = null;
let editorRedoBtnEl = null;
let editorTransposeGroupEl = null;
let editorSelectionToolbarEl = null;
let preview = null;
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
export function enterEditMode(song, options = {}) {
    const { fromHistory = false, fromDeepLink = false } = options;

    setEditMode(true);
    setEditingSongId(song.id);
    lastSessionWasEdit = true;
    trackEditor('edit', song.id);

    // Reset key pin state for new edit session
    editorKeyPinned = false;

    // Populate editor with song data
    if (editorTitleEl) editorTitleEl.value = song.title || '';
    if (editorArtistEl) editorArtistEl.value = song.artist || '';
    if (editorWriterEl) editorWriterEl.value = song.composer || '';
    if (editorContentEl) editorContentEl.value = song.content || '';
    if (editorCommentEl) editorCommentEl.value = '';

    // Show comment field (visible when the metadata line is expanded)
    if (editCommentRowEl) editCommentRowEl.classList.remove('hidden');
    updateMetadataSummary();
    setMetadataExpanded(false);

    // Update submit button text
    if (editorSubmitBtnEl) editorSubmitBtnEl.textContent = 'Submit Correction';

    // Switch to editor panel (update nav state)
    [navSearchEl, navAddSongEl, navFavoritesEl].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    if (navAddSongEl) navAddSongEl.classList.add('active');

    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) searchContainer.classList.add('hidden');
    if (resultsDivEl) resultsDivEl.classList.add('hidden');
    if (songViewEl) songViewEl.classList.add('hidden');
    if (editorPanelEl) editorPanelEl.classList.remove('hidden');

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
    if (preview) preview.reset();
}

/**
 * Exit edit mode
 */
export function exitEditMode() {
    setEditMode(false);
    setEditingSongId(null);
    editorKeyPinned = false;
    if (editCommentRowEl) editCommentRowEl.classList.add('hidden');
    if (editorCommentEl) editorCommentEl.value = '';
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
    lastSessionWasEdit = false;
    editorKeyPinned = false;
    editorDetectedKey = null;

    if (editorTitleEl) editorTitleEl.value = '';
    if (editorArtistEl) editorArtistEl.value = '';
    if (editorWriterEl) editorWriterEl.value = '';
    if (editorContentEl) editorContentEl.value = '';
    if (editorCommentEl) editorCommentEl.value = '';
    if (editCommentRowEl) editCommentRowEl.classList.add('hidden');
    if (editorSubmitBtnEl) editorSubmitBtnEl.textContent = 'Submit to Songbook';
    if (editorStatusEl) {
        editorStatusEl.textContent = '';
        editorStatusEl.className = 'save-status';
    }
    updateEditorKeySelect(null);

    updateMetadataSummary();
    setMetadataExpanded(false);

    updateEditorChrome();
    if (preview) preview.reset();
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

    // Regex to match chords in [brackets]
    const bracketChordRegex = /\[([A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?)\]/g;

    // Transpose all bracketed chords
    let result = content.replace(bracketChordRegex, (match, chord) => {
        const transposed = transposeChord(chord, semitones);
        return `[${transposed}]`;
    });

    // Keep {key: X} / {meta: key X} directives in step with the chords so
    // downstream consumers (e.g. the visual editor's palette) see the new key
    const keyDirectiveRegex = /\{(key:\s*|meta:\s*key\s+)([A-G][#b]?(?:m|min)?)\s*\}/gi;
    result = result.replace(keyDirectiveRegex, (match, prefix, key) =>
        `{${prefix}${transposeChord(key, semitones)}}`);

    return result;
}

/**
 * Parse editor content into sections
 */
function editorParseContent(content) {
    const lines = content.split('\n');
    const sections = [];
    let currentSection = { label: 'Verse 1', lines: [] };
    let verseCount = 1;

    for (const line of lines) {
        if (line.match(/^\{(sov|start_of_verse)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            const labelMatch = line.match(/:\s*(.+?)\s*\}/);
            currentSection = { label: labelMatch ? labelMatch[1] : `Verse ${++verseCount}`, lines: [] };
            continue;
        }
        if (line.match(/^\{(soc|start_of_chorus)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            currentSection = { label: 'Chorus', type: 'chorus', lines: [] };
            continue;
        }
        if (line.match(/^\{(eov|eoc|end_of)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            currentSection = { label: `Verse ${++verseCount}`, lines: [] };
            continue;
        }
        if (line.startsWith('{')) continue;

        if (!line.trim()) {
            if (currentSection.lines.length > 0) {
                sections.push(currentSection);
                currentSection = { label: `Verse ${++verseCount}`, lines: [] };
            }
            continue;
        }

        if (line.trim()) {
            currentSection.lines.push(line);
        }
    }

    if (currentSection.lines.length > 0) sections.push(currentSection);
    return sections;
}

/**
 * Update the editor key select dropdown
 */
function updateEditorKeySelect(detectedKey, detectedMode) {
    if (!editorKeySelectEl) return;

    const keyList = detectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;

    // Rebuild options only if key list type changed
    const currentOptionCount = editorKeySelectEl.options.length;
    const needsRebuild = currentOptionCount !== keyList.length + 1; // +1 for "Key: ?" option

    if (needsRebuild) {
        editorKeySelectEl.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Key: ?';
        editorKeySelectEl.appendChild(placeholder);

        for (const k of keyList) {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = k;
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
    if (!editorContentEl) return;

    const content = editorContentEl.value;
    const chords = extractChords(content);
    const detected = detectKey(chords);

    // Only update key if user hasn't manually pinned it
    if (!editorKeyPinned) {
        editorDetectedKey = detected.key;
        updateEditorKeySelect(detected.key, detected.mode);
    }

    // progressive toolbar: transpose/key stay out of the way until the
    // document actually has a chord (space is reserved — no layout jump)
    if (editorTransposeGroupEl) {
        editorTransposeGroupEl.classList.toggle('ve-gone', chords.length === 0);
    }
}

/**
 * Update the editor chrome and re-render the interactive preview from the
 * textarea. Pass { immediate: false } for typing (debounced re-render that
 * preserves the preview scroll); everything else re-renders immediately.
 */
export function updateEditorPreview(opts = {}) {
    const { immediate = true } = opts;
    updateEditorChrome();
    if (!preview) return;
    if (immediate) preview.refresh();
    else preview.scheduleRefresh();
}

/**
 * Generate ChordPro output
 */
export function editorGenerateChordPro() {
    const title = editorTitleEl?.value.trim() || '';
    const artist = editorArtistEl?.value.trim() || '';
    const writer = editorWriterEl?.value.trim() || '';
    const content = editorContentEl?.value.trim() || '';

    let output = '';

    if (title) output += `{meta: title ${title}}\n`;
    if (artist) output += `{meta: artist ${artist}}\n`;
    if (writer) output += `{meta: composer ${writer}}\n`;
    if (editorDetectedKey) output += `{key: ${editorDetectedKey}}\n`;

    if (output) output += '\n';

    const sections = editorParseContent(content);

    for (const section of sections) {
        if (section.type === 'chorus') {
            output += '{start_of_chorus}\n';
        } else {
            output += `{start_of_verse: ${section.label}}\n`;
        }

        for (const line of section.lines) {
            output += line + '\n';
        }

        if (section.type === 'chorus') {
            output += '{end_of_chorus}\n\n';
        } else {
            output += '{end_of_verse}\n\n';
        }
    }

    return output.trim() + '\n';
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
 * Make-verse/chorus mini-bar. It sits at a FIXED spot (the ChordPro pane
 * header) rather than floating near the selection: a textarea exposes no
 * selection coordinates (measuring them needs a mirror-div hack that fights
 * scrolling and resize), and a bar that pops in above the text would shift
 * the very lines the user is mid-drag-selecting. The header row already
 * exists, so showing the buttons there costs no layout at all.
 */
function updateSelectionToolbar() {
    if (!editorSelectionToolbarEl || !editorContentEl) return;
    const show = document.activeElement === editorContentEl &&
        editorContentEl.selectionStart !== editorContentEl.selectionEnd;
    editorSelectionToolbarEl.classList.toggle('hidden', !show);
}

/**
 * Wrap the textarea's selected lines in {start_of_X}/{end_of_X} (pure text
 * transform in visual-editor/wrap-section.js). One document-level undo
 * step; the preview re-renders immediately.
 */
function applyWrapSelection(type) {
    if (!editorContentEl) return;
    const res = wrapSelectionAsSection(editorContentEl.value,
        editorContentEl.selectionStart, editorContentEl.selectionEnd, type);
    if (!res) return;
    if (preview) preview.pushUndoSnapshot(editorContentEl.value);
    editorContentEl.value = res.text;
    editorContentEl.focus();
    editorContentEl.setSelectionRange(res.selStart, res.selEnd);
    updateEditorPreview();
    updateSelectionToolbar();
}

function initSelectionToolbar() {
    editorSelectionToolbarEl = document.getElementById('editor-selection-toolbar');
    if (!editorSelectionToolbarEl || !editorContentEl) return;
    editorSelectionToolbarEl.querySelectorAll('[data-wrap]').forEach((btn) => {
        // keep focus (and the selection) in the textarea through the click
        btn.addEventListener('pointerdown', (e) => e.preventDefault());
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => applyWrapSelection(btn.dataset.wrap));
    });
    // selectionchange covers collapse-from-anywhere; the textarea events
    // are the belt-and-suspenders for browsers that don't fire it there
    document.addEventListener('selectionchange', updateSelectionToolbar);
    editorContentEl.addEventListener('select', updateSelectionToolbar);
    editorContentEl.addEventListener('keyup', updateSelectionToolbar);
    editorContentEl.addEventListener('mouseup', updateSelectionToolbar);
    editorContentEl.addEventListener('blur', () => setTimeout(updateSelectionToolbar, 0));
}

/**
 * Mount the interactive preview on the right-hand pane. The textarea is THE
 * document: the preview renders parseSong(textarea.value), and every
 * preview-side edit writes serialized ChordPro back into the textarea
 * (one step on the preview's undo stack). Submit/copy/download flows keep
 * reading the textarea unchanged.
 */
function initInteractivePreview() {
    if (!editorPreviewContainerEl || !editorContentEl) return;
    preview = createInteractivePreview({
        container: editorPreviewContainerEl,
        textarea: editorContentEl,
        undoBtn: editorUndoBtnEl,
        redoBtn: editorRedoBtnEl,
        // Nashville display mode: chips show numbers, edits stay chords
        displayChord: (chord) => (editorNashvilleMode && editorDetectedKey)
            ? toNashville(chord, editorDetectedKey)
            : chord,
        onChange() {
            // a preview edit wrote the textarea (it has already re-rendered
            // itself): refresh only the derived chrome, never the preview —
            // this one-way notification is what prevents update loops
            updateEditorChrome();
        },
        onUploadRequest() { if (onUploadRequestCb) onUploadRequestCb(); },
        onSongRequest() { if (onSongRequestCb) onSongRequestCb(); }
    });
    preview.refresh();
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
        editorComment,
        editCommentRow,
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
        onUploadRequest,
        onSongRequest,
        editorPreviewContainer,
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
    editorCommentEl = editorComment;
    editCommentRowEl = editCommentRow;
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
    onUploadRequestCb = onUploadRequest;
    onSongRequestCb = onSongRequest;
    navSearchEl = navSearch;
    navAddSongEl = navAddSong;
    navFavoritesEl = navFavorites;
    resultsDivEl = resultsDiv;
    songViewEl = songView;
    editorPreviewContainerEl = editorPreviewContainer;
    editorUndoBtnEl = editorUndoBtn;
    editorRedoBtnEl = editorRedoBtn;
    editorTransposeGroupEl = editorTransposeGroup;

    // Compact metadata line: tap to expand/collapse the full fields
    if (metadataSummaryEl) {
        metadataSummaryEl.addEventListener('click', () => {
            const expand = !metadataExpanded();
            setMetadataExpanded(expand);
            if (expand) editorTitleEl?.focus();
        });
        updateMetadataSummary();
    }

    // Two-pane editor: interactive preview over the raw textarea
    initInteractivePreview();
    initSelectionToolbar();
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
    if (editorContentEl) {
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

        // typing re-renders the preview debounced, preserving its scroll
        editorContentEl.addEventListener('input', () => updateEditorPreview({ immediate: false }));
    }

    if (editorTitleEl) editorTitleEl.addEventListener('input', updateMetadataSummary);
    if (editorArtistEl) editorArtistEl.addEventListener('input', updateMetadataSummary);

    if (editorNashvilleEl) {
        editorNashvilleEl.addEventListener('change', (e) => {
            setEditorNashvilleMode(e.target.checked);
            updateEditorPreview();
        });
    }

    // Key select - transpose content to the selected key
    if (editorKeySelectEl) {
        editorKeySelectEl.addEventListener('change', () => {
            const selected = editorKeySelectEl.value;
            if (selected && editorDetectedKey && selected !== editorDetectedKey && editorContentEl) {
                const semitones = getSemitonesBetweenKeys(editorDetectedKey, selected);
                if (semitones !== 0) {
                    if (preview) preview.pushUndoSnapshot(editorContentEl.value);
                    editorContentEl.value = editorTransposeContent(editorContentEl.value, semitones);
                }
            }
            // After transposing, let key re-detect from new chords
            editorKeyPinned = false;
            updateEditorPreview();
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
            if (editorContentEl) {
                editorKeyPinned = false;
                if (preview) preview.pushUndoSnapshot(editorContentEl.value);
                editorContentEl.value = editorTransposeContent(editorContentEl.value, 1);
                updateEditorPreview();
            }
        });
    }

    if (editorTransposeDownEl) {
        editorTransposeDownEl.addEventListener('click', () => {
            if (editorContentEl) {
                editorKeyPinned = false;
                if (preview) preview.pushUndoSnapshot(editorContentEl.value);
                editorContentEl.value = editorTransposeContent(editorContentEl.value, -1);
                updateEditorPreview();
            }
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
            const content = editorContentEl?.value.trim();

            if (!content) {
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Song content required';
                    editorStatusEl.className = 'save-status error';
                }
                return;
            }

            // Duplicate detection for new submissions (not edits)
            if (!editMode) {
                const normalizeTitle = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
                const normalizedTitle = normalizeTitle(title);
                const duplicates = allSongs.filter(s =>
                    normalizeTitle(s.title || '') === normalizedTitle
                );
                if (duplicates.length > 0) {
                    const dupNames = duplicates.map(d => `"${d.title}" by ${d.artist || 'Unknown'}`).join('\n');
                    if (!confirm(`Possible duplicate found:\n\n${dupNames}\n\nSubmit anyway?`)) return;
                }
            }

            // Check if user is a trusted user (can save instantly)
            const isTrusted = await window.SupabaseAuth?.isTrustedUser?.();

            if (isTrusted) {
                // Trusted user flow: save directly to pending_songs
                await submitAsTrustedUser({
                    title,
                    artist,
                    writer,
                    chordpro,
                    content
                });
            } else {
                // Regular flow: create GitHub issue for approval
                await submitToGitHubIssue({
                    title,
                    artist,
                    chordpro
                });
            }
        });
    }
}

/**
 * Submit as a trusted user - saves directly to pending_songs for instant visibility
 */
async function submitAsTrustedUser(data) {
    const { title, artist, writer, chordpro, content } = data;

    // Generate slug for the song ID
    const slug = editMode ? editingSongId : generateSlug(title, artist);

    // Detect key from chords
    const chords = extractChords(content);
    const { key, mode } = detectKey(chords);

    // Get current user ID for created_by
    const user = window.SupabaseAuth?.getUser?.();

    // Use raw textarea content (preserves user edits exactly) but normalize
    // ChordPro shorthand directives so the .pro file is always parseable
    const normalizedContent = content
        .replace(/^\{sov([:\s}])/gim, '{start_of_verse$1')
        .replace(/^\{soc([:\s}])/gim, '{start_of_chorus$1')
        .replace(/^\{eov([:\s}])/gim, '{end_of_verse$1')
        .replace(/^\{eoc([:\s}])/gim, '{end_of_chorus$1');

    const pendingEntry = {
        id: slug,
        replaces_id: editMode ? editingSongId : null,
        title,
        artist: artist || null,
        composer: writer || null,
        content: normalizedContent,
        key: key || null,
        created_by: user?.id || null,
        mode: mode || null,
        tags: {},
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

        // Step 2: Trigger auto-commit (fire and forget)
        triggerAutoCommit(pendingEntry).catch(e => {
            console.warn('Auto-commit failed, will retry later:', e);
        });

        trackSubmission(editMode ? 'correction' : 'new_song');

        if (editorStatusEl) {
            editorStatusEl.textContent = 'Saved!';
            editorStatusEl.className = 'save-status success';
        }

        // Refresh the song index to include our new pending song, then navigate
        if (window.refreshPendingSongs) {
            await window.refreshPendingSongs();
        }
        window.location.hash = `#song/${slug}`;

    } catch (error) {
        console.error('Save error:', error);
        if (editorStatusEl) {
            editorStatusEl.textContent = `Error: ${error.message}`;
            editorStatusEl.className = 'save-status error';
        }
    } finally {
        editorSubmitBtnEl.disabled = false;
    }
}

/**
 * Trigger auto-commit edge function (fire and forget)
 */
async function triggerAutoCommit(entry) {
    const supabase = window.SupabaseAuth?.supabase;
    const { data: { session } } = await supabase?.auth.getSession() || { data: {} };
    if (!session?.access_token) return;

    await fetch(`${SUPABASE_URL}/functions/v1/auto-commit-song`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(entry),
    });
}

/**
 * Submit to GitHub issue for approval (regular user flow)
 */
async function submitToGitHubIssue(data) {
    const { title, artist, chordpro } = data;

    let submissionData;

    if (editMode && editingSongId) {
        const comment = editorCommentEl?.value.trim();
        if (!comment) {
            promptForField(editorCommentEl, 'Please describe your changes');
            return;
        }

        submissionData = {
            type: 'correction',
            title,
            artist: artist || undefined,
            songId: editingSongId,
            chordpro,
            comment,
            submittedBy: getSubmitterAttribution()
        };
    } else {
        submissionData = {
            type: 'submission',
            title,
            artist: artist || undefined,
            chordpro,
            submittedBy: getSubmitterAttribution()
        };
    }

    // Disable button and show submitting state
    editorSubmitBtnEl.disabled = true;
    if (editorStatusEl) {
        editorStatusEl.textContent = 'Submitting...';
        editorStatusEl.className = 'save-status';
    }

    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-song-issue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify(submissionData)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to submit');
        }

        trackSubmission(editMode ? 'correction' : 'new_song');

        if (editorStatusEl) {
            // Show success message with link to issue and super-user prompt
            const user = window.SupabaseAuth?.getUser?.();
            let statusHtml = `Submitted! <a href="${result.issueUrl}" target="_blank">View issue #${result.issueNumber}</a>`;

            // Only show super-user prompt if user is logged in
            if (user) {
                statusHtml += `
                    <div class="superuser-prompt">
                        Want instant edits next time?
                        <span class="superuser-prompt-link" id="superuser-prompt-link">Request Super-User access</span>
                    </div>`;
            }

            editorStatusEl.innerHTML = statusHtml;
            editorStatusEl.className = 'save-status success';

            // Wire up super-user prompt click
            const promptLink = document.getElementById('superuser-prompt-link');
            if (promptLink) {
                promptLink.addEventListener('click', () => {
                    openSuperUserRequestModal();
                });
            }
        }

        if (editMode) {
            // Stay in edit mode so user can submit more corrections
            // Edit mode will be cleared when they navigate away
            if (editorCommentEl) editorCommentEl.value = '';
        } else {
            // Clear form for new submissions
            if (editorTitleEl) editorTitleEl.value = '';
            if (editorArtistEl) editorArtistEl.value = '';
            if (editorContentEl) editorContentEl.value = '';
            updateMetadataSummary();
            setMetadataExpanded(false);
            updateEditorPreview();
        }

    } catch (error) {
        console.error('Submission error:', error);
        if (editorStatusEl) {
            editorStatusEl.textContent = `Error: ${error.message}`;
            editorStatusEl.className = 'save-status error';
        }
    } finally {
        editorSubmitBtnEl.disabled = false;
    }
}
