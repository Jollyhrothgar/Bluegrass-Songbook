// Docked chord palette: diatonic chips for the detected key, recents from
// the current song, a root x quality grid, and free-text entry.

import { getDiatonicChords } from '../chord-explorer/theory.js';
import { CHROMATIC_MAJOR_KEYS } from '../chords.js';

const GRID_QUALITIES = ['', 'm', '7', 'm7'];

function chipButton(label, onTap) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 've-chip-btn';
    b.textContent = label;
    b.addEventListener('click', () => onTap(label));
    return b;
}

export function createPalette({ onPick, onDelete, onClose }) {
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

    const moreGrid = document.createElement('div');
    moreGrid.className = 've-palette-more-grid hidden';
    for (const root of CHROMATIC_MAJOR_KEYS) {
        for (const q of GRID_QUALITIES) {
            moreGrid.appendChild(chipButton(root + q, c => onPick(c)));
        }
    }
    const custom = document.createElement('input');
    custom.type = 'text';
    custom.className = 've-palette-custom';
    custom.placeholder = 'Any chord (e.g. Bbmaj7)';
    custom.addEventListener('keydown', e => {
        if (e.key === 'Enter' && custom.value.trim()) {
            const chord = custom.value.trim();
            custom.value = '';
            moreGrid.classList.add('hidden');
            custom.blur();
            onPick(chord);
        } else if (e.key === 'Escape') {
            // cancel typing: back to the plain selection state
            custom.value = '';
            moreGrid.classList.add('hidden');
            custom.blur();
            e.stopPropagation();
        }
    });
    moreGrid.appendChild(custom);

    moreBtn.addEventListener('click', () => moreGrid.classList.toggle('hidden'));

    el.append(diatonicRow, recentsRow, actionsRow, moreGrid);

    return {
        el,
        setKey(key) {
            diatonicRow.textContent = '';
            if (!key) return;
            const root = key.replace(/m$/, '');
            const chords = getDiatonicChords(root, false);
            if (!chords.length) return;
            const labels = chords.map(c => c.display);
            const v7 = chords[4] ? chords[4].root + '7' : null;
            if (v7 && !labels.includes(v7)) labels.splice(5, 0, v7);
            for (const label of labels) diatonicRow.appendChild(chipButton(label, c => onPick(c)));
        },
        setRecents(list) {
            recentsRow.textContent = '';
            for (const chord of list) recentsRow.appendChild(chipButton(chord, c => onPick(c)));
        },
        beginTyping(prefix) {
            // invoked on the first hardware-keyboard chord letter; never on
            // mere selection (focusing an input would pop a mobile keyboard)
            el.classList.remove('hidden');
            moreGrid.classList.remove('hidden');
            custom.value = prefix;
            custom.focus();
            if (custom.setSelectionRange) {
                custom.setSelectionRange(custom.value.length, custom.value.length);
            }
        },
        showFor({ existingChord }) {
            deleteBtn.classList.toggle('hidden', !existingChord);
            el.classList.remove('hidden');
        },
        hide() {
            el.classList.add('hidden');
            moreGrid.classList.add('hidden');
            custom.value = '';
        }
    };
}
