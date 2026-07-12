// Interactive preview orchestrator for the two-pane ChordPro editor.
//
// The #editor-content textarea IS the document. The preview is a pure
// projection of it — render(parseSong(textarea.value)) — and every
// preview-side edit runs the loop:
//
//   parse current text → pure model op → serializeSong → write textarea
//   → re-parse → re-render
//
// so metadata and unknown directives ride through untouched (model.js
// round-trip invariant) and the two panes can never disagree. No
// SongDocument survives across edits; section identity is positional
// (ids are normalized to their index after every parse).
//
// Undo/redo is a stack of textarea snapshots (preview edits and host
// edits routed through pushUndoSnapshot). Inside the textarea the native
// textarea undo applies; the document-level Cmd+Z here only fires when
// focus is outside editable targets.
//
// Ghost-chip typed entry, Space/Tab advance and the docked palette carry
// over from the parked card orchestrator (visual-editor.js) unchanged in
// behavior.

import {
    parseSong, serializeSong, placeChord, changeChord, removeChord, allChords
} from './model.js';
import { el, renderChordsLine } from './line-view.js';
import { createPalette } from './palette.js';
import { scrollSelectionClear } from './autoscroll.js';
import { tokenizeLine } from './syllables.js';
import { detectKey, isValidChord } from '../chords.js';

const UNDO_CAP = 50;
// Ghost-chip typed entry: idle time after the last keystroke before a valid
// chord auto-commits, and the grace window after an auto-commit during which
// further typing resumes editing that chord instead of starting a new one.
export const GHOST_COMMIT_MS = 800;
export const RESUME_GRACE_MS = 1500;
// Textarea typing → preview re-render debounce.
export const REFRESH_DEBOUNCE_MS = 200;

export function createInteractivePreview({
    container, textarea, onChange, displayChord,
    undoBtn, redoBtn, onUploadRequest, onSongRequest
}) {
    let doc = normalizeIds(parseSong(''));
    let selection = null;      // {sectionId, lineIndex, position} or {..., chordIndex}
    let undoStack = [];        // textarea snapshots (text BEFORE each edit)
    let redoStack = [];
    let ghost = null;          // { text, invalid } — in-progress typed chord
    let ghostTimer = null;
    let resume = null;         // { sel, text } — just-committed chord, still editable
    let resumeTimer = null;
    let refreshTimer = null;   // debounced external-change re-render

    container.classList.add('ve-preview');

    const body = el('div', 've-preview-body');

    // Shared commit path for palette picks AND ghost-entry commits.
    function pick(chord) {
        if (!selection) return;
        cancelGhost();
        const { sectionId, lineIndex } = selection;
        if (selection.chordIndex !== undefined) {
            commitDoc(changeChord(doc, sectionId, lineIndex, selection.chordIndex, chord));
        } else {
            const { position } = selection;
            commitDoc(placeChord(doc, sectionId, lineIndex, position, chord));
            // Select the chip we just placed so the palette stays live:
            // the next pick refines it (G → Gm7) instead of no-oping.
            const line = doc.sections.find(s => s.id === sectionId)?.lines?.[lineIndex];
            let chordIndex = -1;
            if (line) line.chords.forEach((c, i) => { if (c.position === position) chordIndex = i; });
            selection = { sectionId, lineIndex, chordIndex };
        }
        palette.showFor({ existingChord: chord });
        render();
    }

    const palette = createPalette({
        onPick(chord) { pick(chord); },
        onDelete() { deleteSelectedChord(); },
        onClose() {
            cancelGhost();
            selection = null;
            palette.hide();
            render();
        },
        onLayoutChange() {
            // More… expand/collapse changes the palette height without a render
            autoScrollToSelection();
        }
    });

    container.append(body, palette.el);

    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (redoBtn) redoBtn.addEventListener('click', redo);

    // ---------- textarea as the single source of truth ----------

    function normalizeIds(d) {
        d.sections.forEach((s, i) => { s.id = `ps-${i}`; });
        return d;
    }

    function parseCurrent() {
        return normalizeIds(parseSong(textarea.value || ''));
    }

    function writeText(text) {
        textarea.value = text;
        if (onChange) onChange(text);
    }

    // One preview-side edit = one undo step (snapshot of the text before it).
    function commitDoc(nextDoc) {
        pushUndoSnapshot(textarea.value);
        writeText(serializeSong(nextDoc));
        doc = parseCurrent();
    }

    // Host edits that rewrite the textarea (transpose, key change) call this
    // with the pre-edit text so document-level undo covers them too.
    function pushUndoSnapshot(text) {
        undoStack.push(text);
        if (undoStack.length > UNDO_CAP) undoStack.shift();
        redoStack = [];
        updateUndoButtons();
    }

    function updateUndoButtons() {
        if (undoBtn) undoBtn.disabled = undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    }

    function undo() {
        cancelGhost();
        if (!undoStack.length) return;
        redoStack.push(textarea.value);
        writeText(undoStack.pop());
        doc = parseCurrent();
        selection = null;
        palette.hide();
        render();
    }

    function redo() {
        cancelGhost();
        if (!redoStack.length) return;
        undoStack.push(textarea.value);
        writeText(redoStack.pop());
        doc = parseCurrent();
        selection = null;
        palette.hide();
        render();
    }

    // Remove the chord behind the current chip selection. Shared by the
    // palette's ✕ Remove button, hover ×, and the Delete/Backspace shortcut.
    function deleteSelectedChord() {
        if (selection?.chordIndex === undefined) return false;
        cancelGhost();
        commitDoc(removeChord(doc, selection.sectionId, selection.lineIndex, selection.chordIndex));
        selection = null;
        palette.hide();
        render();
        return true;
    }

    // ---------- ghost-chip typed entry ----------

    function cancelGhost() {
        if (ghostTimer) { clearTimeout(ghostTimer); ghostTimer = null; }
        ghost = null;
    }

    function clearResume() {
        if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
        resume = null;
    }

    function armGhostTimer() {
        if (ghostTimer) clearTimeout(ghostTimer);
        ghostTimer = setTimeout(() => { commitGhost(); }, GHOST_COMMIT_MS);
    }

    function sameChipSel(a, b) {
        return !!(a && b && a.sectionId === b.sectionId &&
            a.lineIndex === b.lineIndex &&
            a.chordIndex !== undefined && a.chordIndex === b.chordIndex);
    }

    // Commit the ghost if it can be committed. Returns true on commit
    // (including empty-text delete of an existing chord); an invalid ghost
    // stays on screen in its invalid style — we never commit garbage.
    function commitGhost() {
        if (!ghost || !selection) { cancelGhost(); return false; }
        const text = ghost.text.trim();
        if (text === '' && selection.chordIndex !== undefined) {
            // backspaced an existing chord to nothing: commit = delete
            return deleteSelectedChord();
        }
        if (!isValidChord(text)) {
            // never commit garbage: flag the ghost so it idles in the
            // invalid style (typing again clears the flag and retries)
            if (ghostTimer) { clearTimeout(ghostTimer); ghostTimer = null; }
            ghost.invalid = true;
            render();
            return false;
        }
        cancelGhost();
        pick(text);  // selection becomes the committed chip
        // resume grace: typing again right away keeps refining this chord
        clearResume();
        resume = { sel: { ...selection }, text };
        resumeTimer = setTimeout(clearResume, RESUME_GRACE_MS);
        return true;
    }

    // Tapping elsewhere mid-ghost: keep the input if it commits, drop it if not.
    function flushGhost() {
        if (ghost && !commitGhost()) cancelGhost();
    }

    // ---------- selection advance (Space / Tab) ----------

    function lineTargets(line) {
        if (!line || line.opaque) return [];
        return tokenizeLine(line.lyrics, line.chords.map(c => c.position))
            .map(t => t.start);
    }

    function selectionPosition() {
        const sec = doc.sections.find(s => s.id === selection.sectionId);
        const line = sec?.lines?.[selection.lineIndex];
        if (!line) return null;
        return selection.chordIndex !== undefined
            ? line.chords[selection.chordIndex]?.position
            : selection.position;
    }

    // Move the selection to the next/previous syllable, wrapping across
    // lines within the section; stops (keeps the selection) at section ends.
    function advanceSelection(dir) {
        if (!selection) return;
        const sec = doc.sections.find(s => s.id === selection.sectionId);
        if (!sec || !sec.lines) return;
        const pos = selectionPosition();
        if (pos === null || pos === undefined) return;
        let li = selection.lineIndex;
        let starts = lineTargets(sec.lines[li]);
        // index of the token displaying the selection (first start >= pos);
        // end-slot / trailing-chord selections sit past the last token
        let idx = starts.findIndex(s => s >= pos);
        if (idx === -1) idx = starts.length;
        idx += dir;
        while (idx < 0 || idx >= starts.length) {
            li += dir;
            if (li < 0 || li >= sec.lines.length) return;  // stop at section edge
            starts = lineTargets(sec.lines[li]);           // skips opaque/empty lines
            idx = dir > 0 ? 0 : starts.length - 1;
        }
        selection = { sectionId: selection.sectionId, lineIndex: li, position: starts[idx] };
        palette.showFor({ existingChord: null });
        render();
    }

    // ---------- keyboard ----------

    function isEditableTarget(t) {
        if (!t || !t.tagName) return false;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true;
        if (t.isContentEditable) return true;
        return !!(t.closest && t.closest('[contenteditable=""], [contenteditable="true"]'));
    }

    function isActive() {
        // mounted, and neither the container nor any ancestor is hidden
        // (the whole editor panel hides when another view is shown)
        return container.isConnected && !container.closest('.hidden');
    }

    function handleKeydown(e) {
        if (!isActive()) return;
        if (isEditableTarget(e.target)) return;  // textarea typing stays native
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
            return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
            return;
        }
        if (mod || e.altKey) return;

        // --- ghost entry active: keystrokes are captured here, at the
        // document listener — no input is ever focused (mobile keyboards
        // must not pop; the preview re-renders freely underneath) ---
        if (ghost) {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelGhost();
                render();  // ghost vanishes; selection stays
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                ghost.text = ghost.text.slice(0, -1);
                ghost.invalid = false;
                if (ghost.text === '' && selection?.chordIndex === undefined) {
                    cancelGhost();  // nothing left to commit on a bare syllable
                } else {
                    armGhostTimer();  // empty on an existing chord = pending delete
                }
                render();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                commitGhost();  // commit (or empty-delete) without advancing
            } else if (e.key === ' ' || e.key === 'Tab') {
                e.preventDefault();
                if (commitGhost()) {
                    advanceSelection(e.key === 'Tab' && e.shiftKey ? -1 : 1);
                }
            } else if (e.key.length === 1) {
                e.preventDefault();
                ghost.text += e.key;
                ghost.invalid = false;
                armGhostTimer();
                render();
            }
            return;
        }

        // Delete/Backspace removes the chord behind a selected chip
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (deleteSelectedChord()) e.preventDefault();
            return;
        }

        if (!selection) return;  // page scroll / tab-focus keep working

        // Space/Tab with a selection but no ghost just advances: spam Space
        // across syllables that don't get chords, type where one does.
        if (e.key === ' ' || e.key === 'Tab') {
            e.preventDefault();
            clearResume();
            advanceSelection(e.key === 'Tab' && e.shiftKey ? -1 : 1);
            return;
        }

        if (e.key.length !== 1) return;

        // resume grace: right after an auto-commit, more typing continues
        // that chord ('E' idle-commits, then 'b7' makes it Eb7, not a B7)
        if (resume && sameChipSel(selection, resume.sel)) {
            e.preventDefault();
            ghost = { text: resume.text + e.key, invalid: false };
            clearResume();
            armGhostTimer();
            render();
            return;
        }

        // a chord-start letter begins ghost entry on the selection
        if (/^[A-Ga-g]$/.test(e.key)) {
            e.preventDefault();
            ghost = { text: e.key.toUpperCase(), invalid: false };
            armGhostTimer();
            render();
        }
    }
    document.addEventListener('keydown', handleKeydown);

    // ---------- rendering ----------

    function currentKey() {
        if (doc.metadata.fields.key) return doc.metadata.fields.key;
        // fall back to G (the bluegrass default) so a brand-new song still
        // gets a usable diatonic palette before any chords exist
        return detectKey(allChords(doc)).key || 'G';
    }

    function recents() {
        const freq = new Map();
        for (const c of allChords(doc)) freq.set(c, (freq.get(c) || 0) + 1);
        return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
    }

    const callbacks = {
        onSyllableTap(sectionId, lineIndex, position) {
            flushGhost();  // commit a valid in-progress ghost before moving on
            selection = { sectionId, lineIndex, position };
            palette.showFor({ existingChord: null });
            render();
        },
        onChipTap(sectionId, lineIndex, chordIndex) {
            flushGhost();
            selection = { sectionId, lineIndex, chordIndex };
            const sec = doc.sections.find(s => s.id === sectionId);
            palette.showFor({ existingChord: sec.lines[lineIndex].chords[chordIndex].chord });
            render();
        },
        onChipRemove(sectionId, lineIndex, chordIndex) {
            // hover × on a chip (desktop): same undoable remove path
            cancelGhost();
            selection = { sectionId, lineIndex, chordIndex };
            deleteSelectedChord();
        }
    };

    // The preview re-renders wholesale, so element references go stale —
    // locate the selected element after render via its selection class,
    // then nudge the pane scroller so it clears the docked palette.
    function autoScrollToSelection() {
        if (!selection) return;
        const selectedEl = body.querySelector('.ve-syl-selected, .ve-chip-selected');
        scrollSelectionClear({ selectedEl, paletteEl: palette.el, stickyTopEl: null });
    }

    function renderSection(sec) {
        const wrap = el('div', 've-psec');
        wrap.dataset.sectionId = sec.id;
        if (sec.type === 'passthrough') {
            // opaque content (ABC blocks, unknown directives): read-only
            wrap.classList.add('ve-psec-passthrough');
            wrap.appendChild(el('pre', 've-passthrough-raw', sec.raw));
            return wrap;
        }
        if (sec.type === 'chorus') wrap.classList.add('ve-psec-chorus');
        wrap.appendChild(el('div', 've-section-label', sec.label));
        const linesEl = el('div', 've-psec-body');
        const ghostCtx = ghost ? { text: ghost.text, invalid: !!ghost.invalid } : null;
        sec.lines.forEach((line, li) => {
            linesEl.appendChild(renderChordsLine(sec, line, li,
                { selection, callbacks, ghost: ghostCtx, displayChord }));
        });
        wrap.appendChild(linesEl);
        return wrap;
    }

    function renderEmptyState() {
        const empty = el('div', 've-preview-empty');
        empty.appendChild(el('p', 've-preview-empty-hint',
            'Your song appears here as you type — tap any word to add a chord.'));
        const links = el('div', 've-empty-links');
        const addLink = (cls, text, cb) => {
            const btn = el('button', `ve-empty-link ${cls}`, text);
            btn.type = 'button';
            btn.addEventListener('click', cb);
            links.appendChild(btn);
        };
        if (onUploadRequest) addLink('ve-link-upload', 'Upload a photo instead', () => onUploadRequest());
        if (onSongRequest) addLink('ve-link-request', 'Request a song', () => onSongRequest());
        if (links.childElementCount > 0) empty.appendChild(links);
        body.appendChild(empty);
    }

    function render() {
        palette.setKey(currentKey());
        palette.setRecents(recents());
        updateUndoButtons();
        body.textContent = '';
        if (doc.sections.length === 0) {
            renderEmptyState();
            return;
        }
        for (const sec of doc.sections) body.appendChild(renderSection(sec));
        autoScrollToSelection();
    }

    // Does the current selection still resolve against a freshly parsed doc?
    function selectionResolves() {
        if (!selection) return true;
        const sec = doc.sections.find(s => s.id === selection.sectionId);
        const line = sec?.lines?.[selection.lineIndex];
        if (!line || line.opaque) return false;
        if (selection.chordIndex !== undefined) {
            return selection.chordIndex < line.chords.length;
        }
        return selection.position <= line.lyrics.length;
    }

    // External change (typing in the textarea, host transpose, smart paste):
    // re-parse and re-render. The pane's scroll position lives on the pane
    // element, which is not rebuilt, so it is preserved naturally.
    function refresh() {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
        cancelGhost();
        clearResume();
        doc = parseCurrent();
        if (!selectionResolves()) {
            selection = null;
            palette.hide();
        }
        render();
    }

    function scheduleRefresh() {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    }

    // New editing session (load song / reset): drop history and selection.
    function reset() {
        cancelGhost();
        clearResume();
        undoStack = [];
        redoStack = [];
        selection = null;
        palette.hide();
        refresh();
    }

    return {
        refresh,
        scheduleRefresh,
        reset,
        undo,
        redo,
        pushUndoSnapshot,
        destroy() {
            cancelGhost();
            clearResume();
            if (refreshTimer) clearTimeout(refreshTimer);
            document.removeEventListener('keydown', handleKeydown);
            container.textContent = '';
            container.classList.remove('ve-preview');
        }
    };
}
