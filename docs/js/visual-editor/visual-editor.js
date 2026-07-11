// Visual editor orchestrator: owns the SongDocument, selection, undo/redo,
// and re-rendering. Fires onChange(chordpro) after every model change so the
// host can mirror into the raw textarea.

import {
    parseSong, serializeSong, placeChord, changeChord, removeChord,
    transposeDoc, allChords, addSection, setSectionType, relabelSection,
    moveSection, moveSectionTo, duplicateSection, deleteSection, updateLyrics,
    splitSectionOnBlankLines, spliceSectionWithParsed
} from './model.js';
import {
    computeTargetIndex, indicatorY, computeDragScroll,
    LONG_PRESS_MS, DRAG_SLOP_PX
} from './drag-reorder.js';
import { convertPastedText } from '../smart-paste.js';
import { renderSectionCard } from './section-card.js';
import { createPalette } from './palette.js';
import { scrollSelectionClear, findScrollContainer } from './autoscroll.js';
import { tokenizeLine } from './syllables.js';
import { detectKey, isValidChord } from '../chords.js';

const UNDO_CAP = 50;
const SECTION_TYPES = ['verse', 'chorus', 'bridge', 'intro', 'outro'];
// Ghost-chip typed entry: idle time after the last keystroke before a valid
// chord auto-commits, and the grace window after an auto-commit during which
// further typing resumes editing that chord instead of starting a new one.
export const GHOST_COMMIT_MS = 800;
export const RESUME_GRACE_MS = 1500;

export function createVisualEditor({ container, onChange, onImportMeta, onUploadRequest, onSongRequest }) {
    let doc = parseSong('');
    let selection = null;            // {sectionId, lineIndex, position} or {..., chordIndex}
    let undoStack = [];
    let redoStack = [];
    const modes = new Map();         // sectionId → 'chords' | 'lyrics'
    let ghost = null;                // { text } — in-progress typed chord on the selection
    let ghostTimer = null;           // idle auto-commit timer
    let resume = null;               // { sel, text } — just-committed chord, still editable
    let resumeTimer = null;
    let animateNextRender = false;   // one-shot: cards animate in after a split/build

    container.classList.add('ve-root');

    const toolbar = document.createElement('div');
    toolbar.className = 've-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="ve-undo" title="Undo">↩ Undo</button>
        <button type="button" class="ve-redo" title="Redo">↪ Redo</button>
        <span class="ve-toolbar-spacer"></span>
        <span class="ve-transpose-group ve-gone">
            <button type="button" class="ve-transpose-down" title="Transpose down">−</button>
            <span class="ve-key-label"></span>
            <button type="button" class="ve-transpose-up" title="Transpose up">+</button>
        </span>`;

    const cardsHost = document.createElement('div');
    cardsHost.className = 've-cards';

    const footer = document.createElement('div');
    footer.className = 've-footer';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 've-add-section';
    addBtn.textContent = '⊕ Add section';
    const addTypes = document.createElement('div');
    addTypes.className = 've-add-types hidden';
    for (const t of SECTION_TYPES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.addType = t;
        b.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        b.addEventListener('click', () => {
            addTypes.classList.add('hidden');
            apply(addSection(doc, t));
            const added = doc.sections[doc.sections.length - 1];
            modes.set(added.id, 'lyrics');
            render();
        });
        addTypes.appendChild(b);
    }
    addBtn.addEventListener('click', () => addTypes.classList.toggle('hidden'));
    footer.append(addBtn, addTypes);

    const toast = document.createElement('div');
    toast.className = 've-toast hidden';

    // Shared commit path for palette picks AND ghost-entry commits, so
    // selection-becomes-chip and consecutive-pick refinement stay consistent.
    function pick(chord) {
        if (!selection) return;
        cancelGhost();
        const { sectionId, lineIndex } = selection;
        if (selection.chordIndex !== undefined) {
            apply(changeChord(doc, sectionId, lineIndex, selection.chordIndex, chord));
        } else {
            const { position } = selection;
            apply(placeChord(doc, sectionId, lineIndex, position, chord));
            // Select the chip we just placed so the palette stays live:
            // the next pick refines it (G → Gm7) via changeChord instead
            // of silently no-oping. placeChord's sort is stable, so the
            // new chord is the last one at this position.
            const line = doc.sections.find(s => s.id === sectionId).lines[lineIndex];
            let chordIndex = -1;
            line.chords.forEach((c, i) => { if (c.position === position) chordIndex = i; });
            selection = { sectionId, lineIndex, chordIndex };
        }
        // keep the palette (and any open picker) up for consecutive picks;
        // Done/Escape or tapping elsewhere moves on
        palette.showFor({ existingChord: chord });
        render();
    }

    const palette = createPalette({
        onPick(chord) {
            pick(chord);
        },
        onDelete() {
            deleteSelectedChord();
        },
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

    container.append(toolbar, cardsHost, footer, palette.el, toast);

    toolbar.querySelector('.ve-undo').addEventListener('click', undo);
    toolbar.querySelector('.ve-redo').addEventListener('click', redo);
    toolbar.querySelector('.ve-transpose-up').addEventListener('click', () => { apply(transposeDoc(doc, 1)); render(); });
    toolbar.querySelector('.ve-transpose-down').addEventListener('click', () => { apply(transposeDoc(doc, -1)); render(); });

    function apply(nextDoc) {
        undoStack.push(doc);
        if (undoStack.length > UNDO_CAP) undoStack.shift();
        redoStack = [];
        doc = nextDoc;
        emit();
    }

    function emit() {
        if (onChange) onChange(serializeSong(doc));
    }

    function undo() {
        cancelGhost();
        if (!undoStack.length) return;
        redoStack.push(doc);
        doc = undoStack.pop();
        selection = null;
        emit();
        render();
    }

    function redo() {
        cancelGhost();
        if (!redoStack.length) return;
        undoStack.push(doc);
        doc = redoStack.pop();
        selection = null;
        emit();
        render();
    }

    // Remove the chord behind the current chip selection. Shared by the
    // palette's ✕ Remove button and the Delete/Backspace shortcut.
    function deleteSelectedChord() {
        if (selection?.chordIndex === undefined) return false;
        cancelGhost();
        apply(removeChord(doc, selection.sectionId, selection.lineIndex, selection.chordIndex));
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

    // ---------- drag-and-drop section reorder ----------
    //
    // Pointer Events only (HTML5 DnD is unreliable on touch). The ⠿ handle
    // is the single lift zone: mouse/pen drags start on pointerdown; touch
    // lifts after a ~350ms long-press so swipes that merely start on the
    // handle can still scroll the page. Cards do NOT re-render during a
    // drag — the lifted card follows the pointer via a transform and a drop
    // indicator line marks the prospective gap; the model changes (one undo
    // step) only on drop. Geometry lives in drag-reorder.js (pure).

    let drag = null;         // active drag state
    let pendingLift = null;  // touch long-press waiting to lift

    // Snapshot card geometry in cardsHost coordinates (position:relative),
    // immune to page scrolling; valid all drag long since layout is frozen.
    function cardsSnapshot() {
        return [...cardsHost.querySelectorAll(':scope > .ve-card')].map(c => ({
            el: c, top: c.offsetTop, bottom: c.offsetTop + c.offsetHeight
        }));
    }

    function hostY(clientY) {
        return clientY - cardsHost.getBoundingClientRect().top;
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

    function startDrag(sectionId, handle, pointerId, clientY) {
        flushGhost();
        const cards = cardsSnapshot();
        const fromIndex = cards.findIndex(c => c.el.dataset.sectionId === sectionId);
        if (fromIndex === -1) { detachDragListeners(handle); return; }
        const indicator = document.createElement('div');
        indicator.className = 've-drop-indicator';
        drag = {
            sectionId, handle, pointerId, cards, fromIndex,
            targetIndex: fromIndex, startHostY: hostY(clientY),
            lastClientY: clientY, indicator, raf: null
        };
        cardsHost.appendChild(indicator);
        cardsHost.classList.add('ve-drag-active');
        cards[fromIndex].el.classList.add('ve-card-dragging');
        updateDrag(clientY);
        startDragScrollLoop();
    }

    function updateDrag(clientY) {
        drag.lastClientY = clientY;
        const y = hostY(clientY);
        drag.cards[drag.fromIndex].el.style.transform =
            `translateY(${y - drag.startHostY}px) scale(1.01)`;
        drag.targetIndex = computeTargetIndex(drag.cards, drag.fromIndex, y);
        drag.indicator.style.top =
            `${indicatorY(drag.cards, drag.fromIndex, drag.targetIndex)}px`;
    }

    // Auto-scroll while the pointer hovers near the viewport top/bottom.
    // Runs on rAF (pointermove goes quiet when the pointer holds still);
    // updateDrag() re-derives host coords after each scroll step.
    function startDragScrollLoop() {
        if (typeof requestAnimationFrame !== 'function') return;
        const scroller = findScrollContainer(cardsHost);
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
        const { sectionId, handle, pointerId, cards, fromIndex, targetIndex, indicator, raf } = drag;
        if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        detachDragListeners(handle);
        try { handle.releasePointerCapture?.(pointerId); } catch { /* already released */ }
        cards[fromIndex].el.classList.remove('ve-card-dragging');
        cards[fromIndex].el.style.transform = '';
        indicator.remove();
        cardsHost.classList.remove('ve-drag-active');
        drag = null;
        if (commit && targetIndex !== fromIndex) {
            apply(moveSectionTo(doc, sectionId, targetIndex));
            render();
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

    function showToast(message) {
        toast.textContent = '';
        toast.append(message + ' ');
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 've-toast-undo';
        undoBtn.textContent = 'Undo';
        undoBtn.addEventListener('click', () => { toast.classList.add('hidden'); undo(); });
        toast.appendChild(undoBtn);
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 8000);
    }

    function isEditableTarget(t) {
        if (!t || !t.tagName) return false;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true;
        if (t.isContentEditable) return true;
        return !!(t.closest && t.closest('[contenteditable=""], [contenteditable="true"]'));
    }

    function isActive() {
        // mounted, and neither the container nor any ancestor is hidden
        // (editor.js hides the container when the Raw tab is active)
        return container.isConnected && !container.closest('.hidden');
    }

    function handleKeydown(e) {
        if (!isActive()) return;
        if (drag || pendingLift) {
            // Escape aborts a drag cleanly; everything else is inert mid-drag
            if (e.key === 'Escape') {
                e.preventDefault();
                abortPendingLift();
                endDrag(false);
            }
            return;
        }
        if (isEditableTarget(e.target)) return;
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
        // must not pop; section cards re-render freely underneath) ---
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

    // ---------- smart paste ----------

    // Real lyric or chord content — a paste that parses to nothing but
    // directives/passthrough must NOT hijack the default paste (guard rail:
    // never eat clipboard content we can't turn into cards).
    function docHasLyricContent(parsed) {
        return parsed.sections.some(s =>
            s.lines && s.lines.some(l =>
                !l.opaque && (l.lyrics.trim() !== '' || l.chords.length > 0)));
    }

    function reportImportMeta(res) {
        if (onImportMeta && (res.title || res.artist)) {
            onImportMeta({ title: res.title || null, artist: res.artist || null });
        }
    }

    // Paste into a section card's lyrics textarea. Returns true when the
    // paste was smart-handled (caller preventDefaults); false falls through
    // to the plain textarea paste + blur-commit path. One undo step.
    function smartPasteIntoSection(sectionId, rawText) {
        const res = convertPastedText(rawText);
        if (res.kind !== 'chordpro') return false;
        const parsed = parseSong(res.text);
        // guard rail: never eat a paste we can't turn into content
        if (!docHasLyricContent(parsed)) return false;
        const target = doc.sections.find(s => s.id === sectionId);
        const replaced = target && target.lines
            ? target.lines.reduce((n, l) => n + (l.opaque ? 0 : l.chords.length), 0)
            : 0;
        cancelGhost();
        apply(spliceSectionWithParsed(doc, sectionId, parsed));
        animateNextRender = true;
        selection = null;
        modes.delete(sectionId);   // pasted chords render as chips
        palette.hide();
        reportImportMeta(res);
        render();
        showToast(replaced > 0
            ? `Pasted chord sheet — replaced ${replaced} existing chord${replaced === 1 ? '' : 's'}.`
            : 'Pasted chord sheet — chords placed on the lyrics.');
        return true;
    }

    // Whole-song paste into the empty editor: builds the full document
    // (metadata included) in a single undoable step.
    function buildFromWholePaste(rawText) {
        if (!rawText || !rawText.trim()) return false;
        const res = convertPastedText(rawText);
        const parsed = parseSong(res.kind === 'chordpro' ? res.text : rawText);
        if (!docHasLyricContent(parsed)) return false;
        cancelGhost();
        apply(parsed);
        animateNextRender = true;
        selection = null;
        modes.clear();
        palette.hide();
        if (res.kind === 'chordpro') reportImportMeta(res);
        render();
        const nSections = parsed.sections.length;
        const nChords = allChords(parsed).length;
        if (nChords > 0) {
            showToast(`Found ${nChords} chord${nChords === 1 ? '' : 's'} in ${nSections} ${nSections === 1 ? 'section' : 'sections'}.`);
        } else if (nSections > 1) {
            showToast(`Split into ${nSections} ${sectionNoun(parsed)}.`);
        }
        return true;
    }

    // "verses" when every section is a verse, else the neutral "sections"
    function sectionNoun(d) {
        return d.sections.length && d.sections.every(sec => sec.type === 'verse')
            ? 'verses' : 'sections';
    }

    const callbacks = {
        onSyllableTap(sectionId, lineIndex, position) {
            flushGhost();  // commit a valid in-progress ghost before moving on
            // Tapping a syllable always selects it — even when a chip is
            // selected (moving the chord on tap surprised users; drag may
            // return as an explicit gesture later, so moveChord stays in
            // the model).
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
            apply(removeChord(doc, sectionId, lineIndex, chordIndex));
            selection = null;
            palette.hide();
            render();
        },
        onToggleMode(sectionId, mode) {
            cancelGhost();
            modes.set(sectionId, mode);
            selection = null;
            palette.hide();
            render();
        },
        onMenuAction(sectionId, action) {
            if (action.startsWith('type-')) {
                apply(setSectionType(doc, sectionId, action.slice(5)));
            } else if (action === 'rename') {
                const sec = doc.sections.find(s => s.id === sectionId);
                const label = window.prompt('Section label:', sec.label);
                if (!label) return;
                apply(relabelSection(doc, sectionId, label));
            } else if (action === 'duplicate') {
                apply(duplicateSection(doc, sectionId));
            } else if (action === 'move-up') {
                apply(moveSection(doc, sectionId, -1));
            } else if (action === 'move-down') {
                apply(moveSection(doc, sectionId, 1));
            } else if (action === 'delete') {
                apply(deleteSection(doc, sectionId));
            }
            render();
        },
        onDragHandleDown(sectionId, e) {
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
        },
        onLyricsPaste(sectionId, text) {
            return smartPasteIntoSection(sectionId, text);
        },
        onLyricsCommit(sectionId, text) {
            const sec = doc.sections.find(s => s.id === sectionId);
            const current = sec.lines.filter(l => !l.opaque).map(l => l.lyrics).join('\n');
            if (text === current) return;
            const before = doc.sections.length;
            let { doc: next, droppedChords } = updateLyrics(doc, sectionId, text);
            // typed/pasted multi-paragraph lyrics: split the card at blank lines
            next = splitSectionOnBlankLines(next, sectionId);
            apply(next);
            const added = next.sections.length - before;
            const notes = [];
            if (added > 0) {
                animateNextRender = true;
                notes.push(`Split into ${added + 1} ${sectionNoun(next)}`);
            }
            if (droppedChords > 0) {
                notes.push(`${droppedChords} chord${droppedChords === 1 ? '' : 's'} removed with deleted lyrics`);
            }
            if (notes.length) showToast(notes.join(' \u2014 ') + '.');
            render();
        }
    };

    // Cards re-render on every state change, so element references go
    // stale — locate the selected element after render via its selection
    // class, then nudge the scroller so it clears the docked palette.
    function autoScrollToSelection() {
        if (!selection) return;
        const selectedEl = cardsHost.querySelector('.ve-syl-selected, .ve-chip-selected');
        scrollSelectionClear({ selectedEl, paletteEl: palette.el, stickyTopEl: toolbar });
    }

    function render() {
        toolbar.querySelector('.ve-key-label').textContent = currentKey() ? `Key: ${currentKey()}` : 'Key: ?';
        // progressive toolbar: transpose/key stay out of the way until the
        // document actually has a chord (space is reserved — no layout jump)
        toolbar.querySelector('.ve-transpose-group')
            .classList.toggle('ve-gone', allChords(doc).length === 0);
        // keep the palette key-aware: transpose, key-directive changes and
        // tab-switch reloads all funnel through render()
        palette.setKey(currentKey());
        palette.setRecents(recents());
        const animate = animateNextRender;
        animateNextRender = false;
        cardsHost.textContent = '';
        let cardIndex = 0;
        for (const sec of doc.sections) {
            const mode = modes.get(sec.id) || (sec.lines && sec.lines.length === 0 ? 'lyrics' : 'chords');
            const ghostCtx = ghost ? { text: ghost.text, invalid: !!ghost.invalid } : null;
            const card = renderSectionCard(sec, { mode, selection, ghost: ghostCtx, callbacks });
            if (animate) {
                // gentle entrance after a split/build; CSS honors
                // prefers-reduced-motion by disabling the animation
                card.classList.add('ve-card-enter');
                card.style.animationDelay = `${Math.min(cardIndex, 8) * 45}ms`;
            }
            cardsHost.appendChild(card);
            cardIndex++;
        }
        if (doc.sections.length === 0) {
            renderEmptyState();
        }
        autoScrollToSelection();
    }

    // Content-first empty state: one big friendly box plus quiet escape
    // hatches (photo upload, song request) supplied by the host.
    function renderEmptyState() {
        const ta = document.createElement('textarea');
        ta.className = 've-empty-paste';
        ta.rows = 10;
        ta.placeholder = 'Paste or type your song \u2014 lyrics, chord sheets, anything.\n\nChord sheets from the web convert automatically. A blank line starts a new verse.';
        ta.addEventListener('paste', (e) => {
            const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
            if (text && buildFromWholePaste(text)) e.preventDefault();
        });
        // typed (or plain-pasted) lyrics build cards on blur too
        ta.addEventListener('blur', () => { buildFromWholePaste(ta.value); });
        cardsHost.append(ta);

        const links = document.createElement('div');
        links.className = 've-empty-links';
        const addLink = (cls, text, cb) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `ve-empty-link ${cls}`;
            btn.textContent = text;
            btn.addEventListener('click', cb);
            links.appendChild(btn);
        };
        if (onUploadRequest) addLink('ve-link-upload', 'Upload a photo instead', () => onUploadRequest());
        if (onSongRequest) addLink('ve-link-request', 'Request a song', () => onSongRequest());
        if (links.childElementCount > 0) cardsHost.append(links);
    }

    return {
        loadChordPro(text) {
            cancelGhost();
            clearResume();
            doc = parseSong(text || '');
            selection = null;
            undoStack = [];
            redoStack = [];
            modes.clear();
            palette.hide();
            render();
        },
        getChordPro() { return serializeSong(doc); },
        isEmpty() { return doc.sections.length === 0; },
        destroy() {
            cancelGhost();
            clearResume();
            abortPendingLift();
            endDrag(false);
            document.removeEventListener('keydown', handleKeydown);
            container.textContent = '';
            container.classList.remove('ve-root');
        }
    };
}
