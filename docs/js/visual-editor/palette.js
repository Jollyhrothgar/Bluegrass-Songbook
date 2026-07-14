// Docked chord palette: diatonic chips for the detected key, recents from
// the current song, a Strum Machine-style root + quality picker, and
// free-text entry as the pointer-user escape hatch (slash chords,
// oddities). Hardware-keyboard chord typing bypasses the palette entirely —
// see ghost-chip entry in visual-editor.js.

import { getDiatonicChords } from '../chord-explorer/theory.js';
import { transposeChord } from '../chords.js';

const NATURAL_ROOTS = ['G', 'A', 'B', 'C', 'D', 'E', 'F'];
const ACCIDENTAL_ROOTS = ['Ab', 'Bb', 'Db', 'Eb', 'F#'];
// Map key roots onto the picker's canonical spellings.
const ENHARMONIC = { 'C#': 'Db', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb' };
// Quality grid, row by row ('' = plain major).
const QUALITY_ROWS = [
    ['', 'm', '7', 'maj7'],
    ['m7', 'm6', 'm9', 'dim'],
    ['aug', 'sus4', 'sus2', 'add9'],
    ['9', '11', '13', 'm7b5']
];

function chipButton(label, onTap) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 've-chip-btn';
    b.textContent = label;
    b.addEventListener('click', () => onTap(label));
    return b;
}

export function createPalette({ onPick, onDelete, onClose, onLayoutChange }) {
    const el = document.createElement('div');
    el.className = 've-palette hidden';

    const diatonicRow = document.createElement('div');
    diatonicRow.className = 've-palette-row ve-palette-diatonic';
    const recentsRow = document.createElement('div');
    recentsRow.className = 've-palette-row ve-palette-recents';

    const actionsRow = document.createElement('div');
    actionsRow.className = 've-palette-row ve-palette-actions';

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 've-palette-more';
    moreBtn.textContent = 'More…';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 've-palette-delete hidden';
    deleteBtn.textContent = '✕ Remove';
    deleteBtn.addEventListener('click', () => onDelete());

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 've-palette-close';
    closeBtn.textContent = 'Done';
    closeBtn.addEventListener('click', () => onClose());

    actionsRow.append(moreBtn, deleteBtn, closeBtn);

    // --- Root + quality picker (two panels, Strum Machine style) ---
    let keyRoot = 'G';       // updated by setKey(); picker default on open
    let selectedRoot = keyRoot;

    const picker = document.createElement('div');
    picker.className = 've-picker hidden';

    const panels = document.createElement('div');
    panels.className = 've-picker-panels';

    const rootsWrap = document.createElement('div');
    rootsWrap.className = 've-picker-roots';
    const naturalsCol = document.createElement('div');
    naturalsCol.className = 've-picker-naturals';
    const accidentalsCol = document.createElement('div');
    accidentalsCol.className = 've-picker-accidentals';
    rootsWrap.append(naturalsCol, accidentalsCol);

    const qualityGrid = document.createElement('div');
    qualityGrid.className = 've-picker-qualities';

    const rootButtons = [];
    function rootButton(root) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 've-picker-root';
        b.textContent = root;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => selectRoot(root));
        rootButtons.push(b);
        return b;
    }
    for (const r of NATURAL_ROOTS) naturalsCol.appendChild(rootButton(r));
    for (const r of ACCIDENTAL_ROOTS) accidentalsCol.appendChild(rootButton(r));

    const qualityButtons = [];
    for (const row of QUALITY_ROWS) {
        for (const q of row) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 've-picker-quality';
            b.dataset.quality = q;
            b.addEventListener('click', () => onPick(selectedRoot + q));
            qualityButtons.push(b);
            qualityGrid.appendChild(b);
        }
    }

    function selectRoot(root) {
        selectedRoot = root;
        for (const b of rootButtons) {
            const on = b.textContent === root;
            b.classList.toggle('selected', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        for (const b of qualityButtons) b.textContent = root + b.dataset.quality;
    }
    selectRoot(selectedRoot);

    panels.append(rootsWrap, qualityGrid);

    const custom = document.createElement('input');
    custom.type = 'text';
    custom.className = 've-palette-custom';
    custom.placeholder = 'Any chord (e.g. Bbmaj7, D/F#)';
    custom.addEventListener('keydown', e => {
        if (e.key === 'Enter' && custom.value.trim()) {
            const chord = custom.value.trim();
            custom.value = '';
            picker.classList.add('hidden');
            custom.blur();
            onPick(chord);
        } else if (e.key === 'Escape') {
            // cancel typing: back to the plain selection state
            custom.value = '';
            picker.classList.add('hidden');
            custom.blur();
            e.stopPropagation();
        }
    });
    picker.append(panels, custom);

    moreBtn.addEventListener('click', () => {
        const opening = picker.classList.contains('hidden');
        picker.classList.toggle('hidden');
        if (opening) selectRoot(keyRoot); // default root follows the song key
        // the expanded/collapsed picker changes the palette height without a
        // re-render; let the host re-check what the palette now occludes
        if (onLayoutChange) onLayoutChange();
    });

    el.append(diatonicRow, recentsRow, actionsRow, picker);

    // render() calls setKey/setRecents after every model change; skip the DOM
    // rebuild when nothing changed so buttons stay live across re-renders
    // (a rebuild mid-press would swallow the click) and the open picker keeps
    // its root selection.
    let lastKey;
    let lastRecents;

    return {
        el,
        setKey(key) {
            if (key === lastKey) return;
            lastKey = key;
            diatonicRow.textContent = '';
            if (!key) return;
            const minor = /^[A-G][#b]?m$/.test(key);
            const root = minor ? key.slice(0, -1) : key;
            keyRoot = ENHARMONIC[root] || root;
            if (picker.classList.contains('hidden')) selectRoot(keyRoot);
            let labels;
            let v7;
            if (minor) {
                // getDiatonicChords builds a MAJOR scale; a minor key shares
                // its pitch collection with the relative major (+3 semitones),
                // so take that set rotated to lead with the tonic minor chord.
                // The V7 is the minor key's own dominant (harmonic minor —
                // B7 in Em), the bluegrass staple.
                const chords = getDiatonicChords(transposeChord(root, 3), false);
                if (!chords.length) return;
                labels = [...chords.slice(5), ...chords.slice(0, 5)].map(c => c.display);
                v7 = transposeChord(root, 7) + '7';
            } else {
                const chords = getDiatonicChords(root, false);
                if (!chords.length) return;
                labels = chords.map(c => c.display);
                v7 = chords[4] ? chords[4].root + '7' : null;
            }
            if (v7 && !labels.includes(v7)) labels.splice(5, 0, v7);
            for (const label of labels) diatonicRow.appendChild(chipButton(label, c => onPick(c)));
        },
        setRecents(list) {
            const sig = list.join('\u0000');
            if (sig === lastRecents) return;
            lastRecents = sig;
            recentsRow.textContent = '';
            for (const chord of list) recentsRow.appendChild(chipButton(chord, c => onPick(c)));
        },
        showFor({ existingChord }) {
            deleteBtn.classList.toggle('hidden', !existingChord);
            el.classList.remove('hidden');
        },
        hide() {
            el.classList.add('hidden');
            picker.classList.add('hidden');
            custom.value = '';
        }
    };
}
