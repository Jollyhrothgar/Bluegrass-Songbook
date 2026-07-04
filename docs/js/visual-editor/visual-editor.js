// Visual editor orchestrator: owns the SongDocument, selection, undo/redo,
// and re-rendering. Fires onChange(chordpro) after every model change so the
// host can mirror into the raw textarea.

import {
    parseSong, serializeSong, placeChord, changeChord, removeChord,
    transposeDoc, allChords, addSection, setSectionType, relabelSection,
    moveSection, duplicateSection, deleteSection, updateLyrics,
    splitSectionOnBlankLines
} from './model.js';
import { renderSectionCard } from './section-card.js';
import { createPalette } from './palette.js';
import { detectKey } from '../chords.js';

const UNDO_CAP = 50;
const SECTION_TYPES = ['verse', 'chorus', 'bridge', 'intro', 'outro'];

export function createVisualEditor({ container, onChange }) {
    let doc = parseSong('');
    let selection = null;            // {sectionId, lineIndex, position} or {..., chordIndex}
    let undoStack = [];
    let redoStack = [];
    const modes = new Map();         // sectionId → 'chords' | 'lyrics'

    container.classList.add('ve-root');

    const toolbar = document.createElement('div');
    toolbar.className = 've-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="ve-undo" title="Undo">↩ Undo</button>
        <button type="button" class="ve-redo" title="Redo">↪ Redo</button>
        <span class="ve-toolbar-spacer"></span>
        <button type="button" class="ve-transpose-down" title="Transpose down">−</button>
        <span class="ve-key-label"></span>
        <button type="button" class="ve-transpose-up" title="Transpose up">+</button>`;

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

    const palette = createPalette({
        onPick(chord) {
            if (!selection) return;
            if (selection.chordIndex !== undefined) {
                apply(changeChord(doc, selection.sectionId, selection.lineIndex, selection.chordIndex, chord));
                selection = null;
            } else {
                apply(placeChord(doc, selection.sectionId, selection.lineIndex, selection.position, chord));
                selection = null;
            }
            render();
        },
        onDelete() {
            deleteSelectedChord();
        },
        onClose() {
            selection = null;
            palette.hide();
            render();
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
        if (!undoStack.length) return;
        redoStack.push(doc);
        doc = undoStack.pop();
        selection = null;
        emit();
        render();
    }

    function redo() {
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
        apply(removeChord(doc, selection.sectionId, selection.lineIndex, selection.chordIndex));
        selection = null;
        palette.hide();
        render();
        return true;
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
        if (!isActive() || isEditableTarget(e.target)) return;
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
        // Delete/Backspace removes the chord behind a selected chip
        if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.altKey) {
            if (deleteSelectedChord()) e.preventDefault();
            return;
        }
        // typed chord entry: first hardware-keyboard letter routes into the
        // palette's custom input (Enter commits via onPick, Escape cancels)
        if (selection && !mod && !e.altKey && /^[A-Ga-g]$/.test(e.key)) {
            e.preventDefault();
            palette.beginTyping(e.key.toUpperCase());
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

    const callbacks = {
        onSyllableTap(sectionId, lineIndex, position) {
            // Tapping a syllable always selects it — even when a chip is
            // selected (moving the chord on tap surprised users; drag may
            // return as an explicit gesture later, so moveChord stays in
            // the model).
            selection = { sectionId, lineIndex, position };
            palette.showFor({ existingChord: null });
            render();
        },
        onChipTap(sectionId, lineIndex, chordIndex) {
            selection = { sectionId, lineIndex, chordIndex };
            const sec = doc.sections.find(s => s.id === sectionId);
            palette.showFor({ existingChord: sec.lines[lineIndex].chords[chordIndex].chord });
            render();
        },
        onToggleMode(sectionId, mode) {
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
        onLyricsCommit(sectionId, text) {
            const sec = doc.sections.find(s => s.id === sectionId);
            const current = sec.lines.filter(l => !l.opaque).map(l => l.lyrics).join('\n');
            if (text === current) return;
            let { doc: next, droppedChords } = updateLyrics(doc, sectionId, text);
            // pasted multi-paragraph lyrics: split the card at blank lines
            next = splitSectionOnBlankLines(next, sectionId);
            apply(next);
            if (droppedChords > 0) {
                showToast(`${droppedChords} chord${droppedChords === 1 ? '' : 's'} removed with deleted lyrics.`);
            }
            render();
        }
    };

    function render() {
        toolbar.querySelector('.ve-key-label').textContent = currentKey() ? `Key: ${currentKey()}` : 'Key: ?';
        // keep the palette key-aware: transpose, key-directive changes and
        // tab-switch reloads all funnel through render()
        palette.setKey(currentKey());
        palette.setRecents(recents());
        cardsHost.textContent = '';
        for (const sec of doc.sections) {
            const mode = modes.get(sec.id) || (sec.lines && sec.lines.length === 0 ? 'lyrics' : 'chords');
            cardsHost.appendChild(renderSectionCard(sec, { mode, selection, callbacks }));
        }
        if (doc.sections.length === 0) {
            const hint = document.createElement('div');
            hint.className = 've-empty-hint';
            hint.textContent = 'Add a section to get started, or paste lyrics in the Raw tab.';
            cardsHost.appendChild(hint);
        }
    }

    return {
        loadChordPro(text) {
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
            document.removeEventListener('keydown', handleKeydown);
            container.textContent = '';
            container.classList.remove('ve-root');
        }
    };
}
