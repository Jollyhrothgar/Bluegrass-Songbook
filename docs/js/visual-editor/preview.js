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
    parseSong, serializeSong, placeChord, changeChord, removeChord, allChords,
    setSectionType, relabelSection, moveSectionTo, deleteSection, duplicateSection,
    updateLyrics, splitLine, mergeLines, deleteLine
} from './model.js';
import { el, renderChordsLine } from './line-view.js';
import { createPalette } from './palette.js';
import {
    computeTargetIndex, indicatorY, computeDragScroll, LONG_PRESS_MS, DRAG_SLOP_PX
} from './drag-reorder.js';
import { scrollSelectionClear, findScrollContainer } from './autoscroll.js';
import { computePopoverPosition, anchorRectFor } from './popover-position.js';
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

// Section header ⋯ menu. Passthrough (raw) blocks only get Delete; drag
// reorder covers movement, so there are no Move up/down items here.
const SECTION_MENU_ACTIONS = [
    ['rename', 'Rename\u2026'],
    ['type-verse', 'Make verse'], ['type-chorus', 'Make chorus'],
    ['type-bridge', 'Make bridge'], ['type-intro', 'Make intro'],
    ['type-outro', 'Make outro'],
    ['duplicate', 'Duplicate'], ['delete', 'Delete']
];

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
    let drag = null;           // active section drag state
    let pendingLift = null;    // touch long-press waiting to lift
    let renameId = null;       // section id whose label renders as an input
    let toastTimer = null;
    // In-progress lyric line edit: { sectionId, lineIndex, virtual, value,
    // input }. virtual = a new line being typed at the end of the section
    // (lineIndex is where it will land). No re-renders happen mid-edit;
    // the doc changes only on commit (blur / Enter / Backspace-merge).
    let editing = null;

    container.classList.add('ve-preview');

    const body = el('div', 've-preview-body');
    const toast = el('div', 've-toast hidden');

    // Shared commit path for palette picks AND ghost-entry commits.
    function pick(chord) {
        if (!selection) return;
        cancelGhost();
        const { sectionId, lineIndex } = selection;
        if (selection.chordIndex !== undefined) {
            const existing = doc.sections.find(s => s.id === sectionId)
                ?.lines?.[lineIndex]?.chords?.[selection.chordIndex];
            if (!existing) {   // stale selection (e.g. a lost round-trip): never index chords[-1]
                selection = null;
                palette.hide();
                render();
                return;
            }
            commitDoc(changeChord(doc, sectionId, lineIndex, selection.chordIndex, chord));
        } else {
            const { position } = selection;
            commitDoc(placeChord(doc, sectionId, lineIndex, position, chord));
            // Select the chip we just placed so the palette stays live:
            // the next pick refines it (G → Gm7) instead of no-oping.
            const line = doc.sections.find(s => s.id === sectionId)?.lines?.[lineIndex];
            let chordIndex = -1;
            if (line) line.chords.forEach((c, i) => { if (c.position === position) chordIndex = i; });
            if (chordIndex === -1) {
                // the chord didn't survive the serialize→re-parse round trip
                // at this position (e.g. the lyrics contain an unmatched '[');
                // leaving chordIndex -1 would make the next pick corrupt the
                // line — drop the selection instead
                selection = null;
                palette.hide();
                render();
                return;
            }
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
            updatePalettePlacement();
            autoScrollToSelection();
        }
    });

    container.append(body, palette.el, toast);

    // ---------- palette placement: bottom dock vs anchored popover ----------
    //
    // Wide (side-by-side) layout: the palette floats as a position:fixed
    // popover anchored to the selected syllable/chip so it is always in
    // view (the bottom dock can sit below the fold on laptops). Narrow /
    // stacked layout keeps the bottom dock (the mobile tap flow depends on
    // it). jsdom has no matchMedia — there the palette stays docked.
    const wideQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(min-width: 800px)')
        : null;
    function popoverMode() { return !!(wideQuery && wideQuery.matches); }

    function selectedEl() {
        return body.querySelector('.ve-syl-selected, .ve-chip-selected');
    }

    // Apply or clear popover styling + position. Runs after every render,
    // when the More… picker expands/collapses, and on scroll/resize while
    // the palette is open (the popover follows its anchor).
    function updatePalettePlacement() {
        const active = popoverMode() && !palette.el.classList.contains('hidden');
        palette.el.classList.toggle('ve-palette-popover', active);
        if (!active) {
            palette.el.style.left = '';
            palette.el.style.top = '';
            palette.el.style.maxHeight = '';
            return;
        }
        const target = selectedEl();
        if (!target) return;
        const pane = container.closest('.editor-pane-preview') || container;
        // measure the NATURAL size (a previously applied maxHeight would
        // make an oversized popover look like it fits)
        palette.el.style.maxHeight = '';
        const popRect = palette.el.getBoundingClientRect();
        const line = target.closest('.ve-line');
        const pos = computePopoverPosition({
            targetRect: anchorRectFor({
                targetRect: target.getBoundingClientRect(),
                lineRect: line ? line.getBoundingClientRect() : null
            }),
            popWidth: popRect.width,
            popHeight: popRect.height,
            paneRect: pane.getBoundingClientRect(),
            viewportHeight: window.innerHeight || document.documentElement.clientHeight
        });
        palette.el.style.left = `${pos.left}px`;
        palette.el.style.top = `${pos.top}px`;
        palette.el.style.maxHeight = `${pos.maxHeight}px`;
    }

    // Capture-phase scroll hears the preview pane (or any ancestor)
    // scrolling; updatePalettePlacement is a cheap no-op while hidden.
    function onViewportChange() { updatePalettePlacement(); }
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

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
    // A no-op edit (serializes to the exact current text) commits nothing,
    // so structural edge cases never dirty the undo stack.
    function commitDoc(nextDoc) {
        const text = serializeSong(nextDoc);
        if (text === textarea.value) { doc = parseCurrent(); return; }
        pushUndoSnapshot(textarea.value);
        writeText(text);
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
        editing = null;
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
        editing = null;
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

    // ---------- in-preview lyric editing ----------
    //
    // Clicking lyric text swaps that line for a single-line input (text
    // territory). Commit path: rebuild the section's full lyrics text with
    // the edit applied -> updateLyrics (word-LCS chord re-anchoring) ->
    // one undo step. Opaque lines are excluded from the joined text and
    // dropped on commit (documented v1 behavior, same as the parked card
    // editor); they are never editable themselves.

    function sectionById(id) { return doc.sections.find(s => s.id === id); }

    function filteredIndexOf(sec, lineIndex) {
        let fi = 0;
        for (let i = 0; i < lineIndex && i < sec.lines.length; i++) {
            if (!sec.lines[i].opaque) fi++;
        }
        return fi;
    }

    function docIndexOfFiltered(sec, fi) {
        let seen = 0;
        for (let i = 0; i < sec.lines.length; i++) {
            if (sec.lines[i].opaque) continue;
            if (seen === fi) return i;
            seen++;
        }
        return sec.lines.length;
    }

    function sectionLyricLines(sec) {
        return sec.lines.filter(l => !l.opaque).map(l => l.lyrics);
    }

    function toastDropped(n) {
        if (n > 0) showToast(`${n} chord${n === 1 ? '' : 's'} dropped \u2014`);
    }

    // Replace the section's lyrics with newLines (one undo step) and toast
    // when re-anchoring had to drop chords. No-ops (and returns false) when
    // nothing actually changed, so a click-away never dirties the undo stack.
    function commitSectionLyrics(sectionId, newLines) {
        const sec = sectionById(sectionId);
        const before = sectionLyricLines(sec).join('\n');
        const text = newLines.join('\n');
        if (text.replace(/\n+$/, '') === before.replace(/\n+$/, '')) {
            render();
            return false;
        }
        const { doc: next, droppedChords } = updateLyrics(doc, sectionId, text);
        commitDoc(next);
        render();
        toastDropped(droppedChords);
        return true;
    }

    // Split/merge are STRUCTURAL: chords keep their exact anchors via the
    // pure splitLine/mergeLines ops. Only a text edit made before the
    // keystroke goes through updateLyrics (LCS re-anchoring) — and both
    // land in the textarea as a single undo step.
    function withValueEditApplied(ed, value) {
        const sec = sectionById(ed.sectionId);
        if (value === sec.lines[ed.lineIndex].lyrics) {
            return { base: doc, lineIdx: ed.lineIndex, dropped: 0 };
        }
        const lines = sectionLyricLines(sec);
        const fi = filteredIndexOf(sec, ed.lineIndex);
        lines[fi] = value;
        const res = updateLyrics(doc, ed.sectionId, lines.join('\n'));
        // updateLyrics drops opaque lines, so indices become filtered ones
        return { base: res.doc, lineIdx: fi, dropped: res.droppedChords };
    }

    function startLyricEdit(sectionId, lineIndex, caret, opts = {}) {
        const sec = sectionById(sectionId);
        if (!sec || !sec.lines) return;
        const line = sec.lines[lineIndex];
        if (!opts.virtual && (!line || line.opaque)) return;
        cancelGhost();
        clearResume();
        selection = null;
        palette.hide();
        editing = {
            sectionId, lineIndex,
            virtual: !!opts.virtual,
            value: opts.virtual ? (opts.value || '') : line.lyrics,
            input: null
        };
        render();
        const input = editing && editing.input;
        if (input) {
            input.focus();
            const c = Math.max(0, Math.min(caret ?? input.value.length, input.value.length));
            try { input.setSelectionRange(c, c); } catch { /* jsdom */ }
        }
    }

    // Commit (or on commit=false, revert) the in-progress lyric edit.
    // Committing an EMPTY (or whitespace-only) line deletes the line: the
    // user selected-all and hit delete, so the line should be gone, not
    // left behind as a blank. Deletion is structural (deleteLine) so
    // untouched chord-only and opaque lines elsewhere survive exactly;
    // chords on the deleted line are dropped and toasted. Emptying a
    // section's last line just leaves the section empty -- removing the
    // section itself stays the header menu's job.
    function finishLyricEdit(commit) {
        if (!editing) return false;
        const ed = editing;
        const value = ed.input ? ed.input.value : ed.value;
        editing = null;
        if (!commit) { render(); return false; }
        const sec = sectionById(ed.sectionId);
        if (!sec || !sec.lines) { render(); return false; }
        if (ed.virtual) {
            if (value.trim() === '') { render(); return false; }
            const lines = sectionLyricLines(sec);
            lines.push(value);
            return commitSectionLyrics(ed.sectionId, lines);
        }
        if (value.trim() === '') {
            const line = sec.lines[ed.lineIndex];
            if (!line) { render(); return false; }
            // Only delete if the user actually emptied a line that had text.
            // A line that was ALREADY blank (spacer or chord-only) must
            // survive a mere click-then-blur -- deleting chords because the
            // user glanced at a line would be a data-loss trap. Removing
            // such lines is the deliberate Backspace-at-0 merge gesture.
            if (line.lyrics.trim() === '') { render(); return false; }
            const dropped = line.chords.length;
            commitDoc(deleteLine(doc, ed.sectionId, ed.lineIndex));
            render();
            toastDropped(dropped);
            return true;
        }
        const lines = sectionLyricLines(sec);
        lines[filteredIndexOf(sec, ed.lineIndex)] = value;
        return commitSectionLyrics(ed.sectionId, lines);
    }

    // Enter: split the line at the caret (immediate commit — it
    // restructures lines), then continue editing the line below.
    function splitLyricEdit() {
        const ed = editing;
        if (!ed || !ed.input) return;
        const input = ed.input;
        const caret = input.selectionStart ?? input.value.length;
        const value = input.value;
        const tail = value.slice(caret);
        const sec = sectionById(ed.sectionId);
        if (!sec || !sec.lines) { editing = null; render(); return; }
        editing = null;

        if (ed.virtual) {
            // the line isn't in the doc yet: append the head, keep typing
            // the tail on the next fresh line
            const lines = sectionLyricLines(sec);
            lines.push(value.slice(0, caret));
            commitSectionLyrics(ed.sectionId, lines);
            const fresh = sectionById(ed.sectionId);
            startLyricEdit(ed.sectionId, fresh ? fresh.lines.length : 0, 0,
                { virtual: true, value: tail });
            return;
        }

        const { base, lineIdx, dropped } = withValueEditApplied(ed, value);
        const baseSec = base.sections.find(s => s.id === ed.sectionId);
        if (tail === '' && lineIdx === baseSec.lines.length - 1) {
            // Enter at the end of the section's last line: a trailing blank
            // would be stripped on parse anyway — just open a fresh line
            if (base !== doc) { commitDoc(base); toastDropped(dropped); }
            render();
            const fresh = sectionById(ed.sectionId);
            startLyricEdit(ed.sectionId, fresh ? fresh.lines.length : 0, 0, { virtual: true });
            return;
        }
        commitDoc(splitLine(base, ed.sectionId, lineIdx, caret));
        render();
        toastDropped(dropped);
        const fresh = sectionById(ed.sectionId);
        if (fresh && fresh.lines && lineIdx + 1 < fresh.lines.length) {
            startLyricEdit(ed.sectionId, lineIdx + 1, 0);
        } else {
            startLyricEdit(ed.sectionId, fresh ? fresh.lines.length : 0, 0,
                { virtual: true, value: tail });
        }
    }

    // Backspace at position 0: merge into the previous line (immediate
    // commit), caret at the join.
    function mergeLyricEdit() {
        const ed = editing;
        if (!ed || !ed.input) return;
        const value = ed.input.value;
        const sec = sectionById(ed.sectionId);
        if (!sec || !sec.lines) { editing = null; render(); return; }
        const lines = sectionLyricLines(sec);
        const fi = ed.virtual ? lines.length : filteredIndexOf(sec, ed.lineIndex);
        if (fi === 0) return;   // no line above within this section
        const prev = lines[fi - 1];
        editing = null;

        if (ed.virtual) {
            // the new line isn't in the doc yet: fold its text onto the
            // last real line and continue editing there
            if (value !== '') {
                lines[fi - 1] = prev + value;
                commitSectionLyrics(ed.sectionId, lines);
            } else {
                render();
            }
            const fresh = sectionById(ed.sectionId);
            if (!fresh || !fresh.lines || !fresh.lines.length) return;
            startLyricEdit(ed.sectionId, docIndexOfFiltered(fresh, fi - 1), prev.length);
            return;
        }

        if (value.trim() === '') {
            // an emptied line just goes away (same as the blur commit);
            // merging via updateLyrics would strip a trailing blank and
            // leave mergeLines indexing past the end. Chords on it drop.
            const dropped = sec.lines[ed.lineIndex]?.chords.length || 0;
            commitDoc(deleteLine(doc, ed.sectionId, ed.lineIndex));
            render();
            toastDropped(dropped);
            const fresh = sectionById(ed.sectionId);
            if (!fresh || !fresh.lines || !fresh.lines.length) return;
            startLyricEdit(ed.sectionId, docIndexOfFiltered(fresh, fi - 1), prev.length);
            return;
        }

        const { base, lineIdx, dropped } = withValueEditApplied(ed, value);
        const baseSec = base.sections.find(s => s.id === ed.sectionId);
        let prevIdx = lineIdx - 1;
        while (prevIdx >= 0 && baseSec.lines[prevIdx].opaque) prevIdx--;
        if (prevIdx < 0) { render(); return; }
        commitDoc(mergeLines(base, ed.sectionId, prevIdx, lineIdx));
        render();
        toastDropped(dropped);
        startLyricEdit(ed.sectionId, prevIdx, prev.length);
    }

    // While a lyric input is focused, pressing on another interactive
    // preview element must not lose the click to the blur re-render: keep
    // focus (preventDefault), let the click land on the still-live element,
    // and its handler commits the edit first. Presses anywhere else
    // (textarea, toolbar, section chrome) commit via the input's blur.
    function onEditingMouseDown(e) {
        if (!editing || !editing.input) return;
        const t = e.target;
        if (!t || t === editing.input) return;
        if (t.closest && t.closest('.ve-strip, .ve-chip, .ve-chip-x, .ve-syl, .ve-line, .ve-add-line, .ve-end-slot')) {
            e.preventDefault();
        }
    }
    container.addEventListener('mousedown', onEditingMouseDown, true);

    function renderLyricEditRow() {
        const row = el('div', 've-line ve-line-editing');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 've-lyric-input';
        input.setAttribute('aria-label', 'Edit lyric line');
        input.value = editing.value;
        editing.input = input;
        input.addEventListener('input', () => {
            if (editing && editing.input === input) editing.value = input.value;
        });
        input.addEventListener('keydown', (e) => {
            if (!editing || editing.input !== input) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                splitLyricEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishLyricEdit(false);
            } else if (e.key === 'Backspace' &&
                input.selectionStart === 0 && input.selectionEnd === 0) {
                e.preventDefault();
                mergeLyricEdit();
            }
            // Tab is left alone: focus moves on, the blur commits
        });
        input.addEventListener('blur', () => {
            if (editing && editing.input === input) finishLyricEdit(true);
        });
        row.appendChild(input);
        return row;
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

    // ---------- section operations (header menu + drag) ----------

    // Section ids are positional (ps-<index>), so ANY section op can shift
    // identity out from under the selection — clear it rather than guess.
    function sectionOp(nextDoc) {
        cancelGhost();
        clearResume();
        editing = null;
        selection = null;
        palette.hide();
        renameId = null;
        commitDoc(nextDoc);
        render();
    }

    // Minimal undo toast for destructive ops ("Deleted Chorus — Undo").
    function showToast(message) {
        if (toastTimer) clearTimeout(toastTimer);
        toast.textContent = '';
        toast.append(message + ' ');
        const btn = el('button', 've-toast-undo', 'Undo');
        btn.type = 'button';
        btn.addEventListener('click', () => {
            toast.classList.add('hidden');
            undo();
        });
        toast.appendChild(btn);
        toast.classList.remove('hidden');
        toastTimer = setTimeout(() => toast.classList.add('hidden'), 8000);
    }

    function menuAction(sectionId, action) {
        if (action.startsWith('type-')) {
            sectionOp(setSectionType(doc, sectionId, action.slice(5)));
        } else if (action === 'rename') {
            cancelGhost();
            renameId = sectionId;
            render();
            const input = body.querySelector('.ve-rename-input');
            if (input) { input.focus(); input.select(); }
        } else if (action === 'duplicate') {
            sectionOp(duplicateSection(doc, sectionId));
        } else if (action === 'delete') {
            const sec = doc.sections.find(s => s.id === sectionId);
            const what = (sec && sec.type === 'passthrough') ? 'raw block' : (sec?.label || 'section');
            sectionOp(deleteSection(doc, sectionId));
            showToast(`Deleted ${what} \u2014`);
        }
    }

    function commitRename(sectionId, value) {
        renameId = null;
        const sec = doc.sections.find(s => s.id === sectionId);
        const label = value.trim();
        if (!sec || !label || label === sec.label) { render(); return; }
        sectionOp(relabelSection(doc, sectionId, label));
    }

    // ---------- drag-and-drop section reorder ----------
    //
    // Pointer Events only (HTML5 DnD is unreliable on touch). The ⠿ handle
    // is the single lift zone: mouse/pen drags start on pointerdown; touch
    // lifts after a ~350ms long-press so swipes that merely start on the
    // handle still scroll. The preview does NOT re-render mid-drag — the
    // lifted section follows the pointer via a transform and a drop
    // indicator line marks the prospective gap; the model changes (one
    // undo step) only on drop. Geometry lives in drag-reorder.js (pure).

    // Snapshot section geometry in body coordinates (position:relative),
    // immune to pane scrolling; valid all drag long since layout is frozen.
    function sectionsSnapshot() {
        return [...body.querySelectorAll(':scope > .ve-psec')].map(sEl => ({
            el: sEl, top: sEl.offsetTop, bottom: sEl.offsetTop + sEl.offsetHeight
        }));
    }

    function hostY(clientY) {
        return clientY - body.getBoundingClientRect().top;
    }

    function onDragMove(e) {
        if (pendingLift) {
            // moving before the long-press fires = the user is scrolling
            if (Math.hypot(e.clientX - pendingLift.startX, e.clientY - pendingLift.startY) > DRAG_SLOP_PX) {
                abortPendingLift();
            } else {
                pendingLift.lastClientY = e.clientY;
            }
            return;
        }
        if (drag) updateDrag(e.clientY);
    }

    function onDragUp() {
        if (pendingLift) { abortPendingLift(); return; }
        endDrag(true);
    }

    function onDragCancel() {
        if (pendingLift) { abortPendingLift(); return; }
        endDrag(false);
    }

    function attachDragListeners(handle) {
        handle.addEventListener('pointermove', onDragMove);
        handle.addEventListener('pointerup', onDragUp);
        handle.addEventListener('pointercancel', onDragCancel);
    }

    function detachDragListeners(handle) {
        handle.removeEventListener('pointermove', onDragMove);
        handle.removeEventListener('pointerup', onDragUp);
        handle.removeEventListener('pointercancel', onDragCancel);
    }

    function abortPendingLift() {
        if (!pendingLift) return;
        clearTimeout(pendingLift.timer);
        detachDragListeners(pendingLift.handle);
        pendingLift = null;
    }

    function onDragHandleDown(sectionId, e) {
        if (drag || pendingLift) return;
        if (e.button !== undefined && e.button !== null && e.button !== 0) return;
        const handle = e.currentTarget;
        // no focus steal / text selection; the handle has no other role
        e.preventDefault();
        try { handle.setPointerCapture?.(e.pointerId); } catch { /* jsdom */ }
        attachDragListeners(handle);
        if (e.pointerType === 'touch') {
            // long-press lifts; early movement means a scroll, not a drag
            pendingLift = {
                sectionId, handle,
                startX: e.clientX, startY: e.clientY, lastClientY: e.clientY,
                timer: setTimeout(() => {
                    const { lastClientY } = pendingLift;
                    pendingLift = null;
                    startDrag(sectionId, handle, e.pointerId, lastClientY);
                }, LONG_PRESS_MS)
            };
        } else {
            startDrag(sectionId, handle, e.pointerId, e.clientY);
        }
    }

    function startDrag(sectionId, handle, pointerId, clientY) {
        flushGhost();
        const sections = sectionsSnapshot();
        const fromIndex = sections.findIndex(c => c.el.dataset.sectionId === sectionId);
        if (fromIndex === -1) { detachDragListeners(handle); return; }
        const indicator = el('div', 've-drop-indicator');
        drag = {
            sectionId, handle, pointerId, sections, fromIndex,
            targetIndex: fromIndex, startHostY: hostY(clientY),
            lastClientY: clientY, indicator, raf: null
        };
        body.appendChild(indicator);
        body.classList.add('ve-drag-active');
        sections[fromIndex].el.classList.add('ve-psec-dragging');
        updateDrag(clientY);
        startDragScrollLoop();
    }

    function updateDrag(clientY) {
        drag.lastClientY = clientY;
        const y = hostY(clientY);
        drag.sections[drag.fromIndex].el.style.transform =
            `translateY(${y - drag.startHostY}px) scale(1.01)`;
        drag.targetIndex = computeTargetIndex(drag.sections, drag.fromIndex, y);
        drag.indicator.style.top =
            `${indicatorY(drag.sections, drag.fromIndex, drag.targetIndex)}px`;
    }

    // Auto-scroll while the pointer hovers near the edge of the preview
    // pane's scroll container (or the viewport when the page scrolls).
    // Runs on rAF (pointermove goes quiet when the pointer holds still);
    // updateDrag() re-derives host coords after each scroll step.
    function startDragScrollLoop() {
        if (typeof requestAnimationFrame !== 'function') return;
        const scroller = findScrollContainer(body);
        const step = () => {
            if (!drag) return;
            const rect = scroller ? scroller.getBoundingClientRect() : null;
            const viewTop = rect ? rect.top : 0;
            const viewBottom = rect ? rect.bottom
                : (window.innerHeight || document.documentElement.clientHeight);
            const delta = computeDragScroll(drag.lastClientY, viewTop, viewBottom);
            if (delta !== 0) {
                if (scroller) scroller.scrollBy(0, delta);
                else window.scrollBy(0, delta);
                updateDrag(drag.lastClientY);
            }
            drag.raf = requestAnimationFrame(step);
        };
        drag.raf = requestAnimationFrame(step);
    }

    function endDrag(commit) {
        if (!drag) return;
        const { sectionId, handle, pointerId, sections, fromIndex, targetIndex, indicator, raf } = drag;
        if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        detachDragListeners(handle);
        try { handle.releasePointerCapture?.(pointerId); } catch { /* already released */ }
        sections[fromIndex].el.classList.remove('ve-psec-dragging');
        sections[fromIndex].el.style.transform = '';
        indicator.remove();
        body.classList.remove('ve-drag-active');
        drag = null;
        if (commit && targetIndex !== fromIndex) {
            sectionOp(moveSectionTo(doc, sectionId, targetIndex));
        }
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
        // Escape aborts a section drag cleanly; everything else is inert mid-drag
        if (drag || pendingLift) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (pendingLift) abortPendingLift();
                else endDrag(false);
            }
            return;
        }
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

    // Committing a pending lyric edit can restructure the section the user
    // just clicked in (an emptied line is deleted; the commit drops opaque
    // lines), which invalidates the render-time line indices the click
    // captured. Returns false when the tapped section's line count changed —
    // the caller swallows the tap rather than acting on the wrong line (the
    // commit already re-rendered; the next click lands on fresh indices).
    function commitPendingEditKeepingIndices(sectionId) {
        if (!editing) return true;
        const before = sectionById(sectionId)?.lines?.length;
        finishLyricEdit(true);
        const after = sectionById(sectionId)?.lines?.length;
        return before === after;
    }

    const callbacks = {
        // chord-row click at a syllable seam: the chord surface. Everything
        // downstream (palette, ghost typing, Space/Tab advance) is unchanged.
        onStripTap(sectionId, lineIndex, position) {
            const stable = commitPendingEditKeepingIndices(sectionId);
            flushGhost();  // commit a valid in-progress ghost before moving on
            if (!stable) return;
            const line = doc.sections.find(s => s.id === sectionId)?.lines?.[lineIndex];
            if (!line || line.opaque || position > line.lyrics.length) return;
            selection = { sectionId, lineIndex, position };
            palette.showFor({ existingChord: null });
            render();
        },
        onChipTap(sectionId, lineIndex, chordIndex) {
            const stable = commitPendingEditKeepingIndices(sectionId);
            flushGhost();
            if (!stable) return;
            const sec = doc.sections.find(s => s.id === sectionId);
            const chord = sec?.lines?.[lineIndex]?.chords?.[chordIndex];
            if (!chord) return;
            selection = { sectionId, lineIndex, chordIndex };
            palette.showFor({ existingChord: chord.chord });
            render();
        },
        onChipRemove(sectionId, lineIndex, chordIndex) {
            // hover × on a chip (desktop): same undoable remove path
            const stable = commitPendingEditKeepingIndices(sectionId);
            cancelGhost();
            if (!stable) return;
            const sec = doc.sections.find(s => s.id === sectionId);
            if (!sec?.lines?.[lineIndex]?.chords?.[chordIndex]) return;
            selection = { sectionId, lineIndex, chordIndex };
            deleteSelectedChord();
        },
        // lyric text click: swap the line for a single-line input
        onLyricTap(sectionId, lineIndex, caret) {
            const stable = commitPendingEditKeepingIndices(sectionId);
            flushGhost();
            if (!stable) return;
            startLyricEdit(sectionId, lineIndex, caret);
        }
    };

    // The preview re-renders wholesale, so element references go stale —
    // locate the selected element after render via its selection class,
    // then nudge the pane scroller so it clears the docked palette.
    function autoScrollToSelection() {
        if (!selection) return;
        // Popover mode: the palette follows the target instead of occluding
        // a fixed band, so only ensure the target itself is visible (pass no
        // paletteEl). Dock mode keeps the scroll-clear-of-palette behavior.
        scrollSelectionClear({
            selectedEl: selectedEl(),
            paletteEl: popoverMode() ? null : palette.el,
            stickyTopEl: null
        });
    }

    // Header row: ⠿ drag handle (the only lift zone) + label (or the
    // inline rename input) + ⋯ menu. An open menu never survives a render,
    // which is exactly right — every action re-renders anyway.
    function renderSectionHeader(sec) {
        const header = el('div', 've-psec-header');

        const handle = el('button', 've-drag-handle', '\u283f');
        handle.type = 'button';
        handle.setAttribute('aria-label', `Drag to reorder ${sec.label || 'section'}`);
        handle.addEventListener('pointerdown', (e) => onDragHandleDown(sec.id, e));
        header.appendChild(handle);

        if (renameId === sec.id) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 've-rename-input';
            input.value = sec.label;
            input.setAttribute('aria-label', 'Section label');
            let done = false;   // Enter commits, then the blur must not re-commit
            const finish = (commit) => {
                if (done) return;
                done = true;
                if (commit) commitRename(sec.id, input.value);
                else { renameId = null; render(); }
            };
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
            });
            input.addEventListener('blur', () => finish(true));
            header.appendChild(input);
        } else {
            header.appendChild(el('span', 've-section-label',
                sec.type === 'passthrough' ? 'Raw block' : sec.label));
        }

        const menuWrap = el('span', 've-psec-menu-wrap');
        const menuBtn = el('button', 've-psec-menu-btn', '\u22ef');
        menuBtn.type = 'button';
        menuBtn.setAttribute('aria-label', `Section menu for ${sec.label || 'raw block'}`);
        const menu = el('div', 've-psec-menu hidden');
        const actions = sec.type === 'passthrough'
            ? SECTION_MENU_ACTIONS.filter(([a]) => a === 'delete')
            : SECTION_MENU_ACTIONS;
        for (const [action, text] of actions) {
            const b = el('button', 've-menu-item', text);
            b.type = 'button';
            b.dataset.action = action;
            b.addEventListener('click', () => {
                menu.classList.add('hidden');
                menuAction(sec.id, action);
            });
            menu.appendChild(b);
        }
        menuBtn.addEventListener('click', () => menu.classList.toggle('hidden'));
        menuWrap.append(menuBtn, menu);
        header.appendChild(menuWrap);
        return header;
    }

    function renderSection(sec) {
        const wrap = el('div', 've-psec');
        wrap.dataset.sectionId = sec.id;
        if (sec.type === 'passthrough') {
            // opaque content (ABC blocks, unknown directives): read-only
            // body, but still a draggable/deletable block
            wrap.classList.add('ve-psec-passthrough');
            wrap.appendChild(renderSectionHeader(sec));
            wrap.appendChild(el('pre', 've-passthrough-raw', sec.raw));
            return wrap;
        }
        if (sec.type === 'chorus') wrap.classList.add('ve-psec-chorus');
        wrap.appendChild(renderSectionHeader(sec));
        const linesEl = el('div', 've-psec-body');
        const ghostCtx = ghost ? { text: ghost.text, invalid: !!ghost.invalid } : null;
        const editingHere = (li) => editing && editing.sectionId === sec.id &&
            !editing.virtual && editing.lineIndex === li;
        sec.lines.forEach((line, li) => {
            linesEl.appendChild(editingHere(li) && !line.opaque
                ? renderLyricEditRow()
                : renderChordsLine(sec, line, li,
                    { selection, callbacks, ghost: ghostCtx, displayChord }));
        });
        if (editing && editing.sectionId === sec.id && editing.virtual) {
            // a new line being typed at the end of the section
            linesEl.appendChild(renderLyricEditRow());
        } else {
            // quiet trailing ghost row: click to start a new line (also the
            // only lyric surface an empty section has)
            const addLine = el('button', 've-add-line', '+ Add line');
            addLine.type = 'button';
            addLine.addEventListener('click', () => {
                finishLyricEdit(true);
                flushGhost();
                startLyricEdit(sec.id, sec.lines.length, 0, { virtual: true });
            });
            linesEl.appendChild(addLine);
        }
        wrap.appendChild(linesEl);
        return wrap;
    }

    function renderEmptyState() {
        const empty = el('div', 've-preview-empty');
        empty.appendChild(el('p', 've-preview-empty-hint',
            'Your song appears here as you type — tap above a word to add a chord, tap the words to edit them.'));
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
            updatePalettePlacement();
            return;
        }
        for (const sec of doc.sections) body.appendChild(renderSection(sec));
        updatePalettePlacement();
        autoScrollToSelection();
    }

    // Does the current selection still resolve against a freshly parsed doc?
    function selectionResolves() {
        if (!selection) return true;
        const sec = doc.sections.find(s => s.id === selection.sectionId);
        const line = sec?.lines?.[selection.lineIndex];
        if (!line || line.opaque) return false;
        if (selection.chordIndex !== undefined) {
            return selection.chordIndex >= 0 && selection.chordIndex < line.chords.length;
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
        renameId = null;
        editing = null;
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
        editing = null;
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
            abortPendingLift();
            endDrag(false);
            if (toastTimer) clearTimeout(toastTimer);
            if (refreshTimer) clearTimeout(refreshTimer);
            document.removeEventListener('keydown', handleKeydown);
            container.removeEventListener('mousedown', onEditingMouseDown, true);
            window.removeEventListener('resize', onViewportChange);
            window.removeEventListener('scroll', onViewportChange, true);
            container.textContent = '';
            container.classList.remove('ve-preview');
        }
    };
}
