// The tab page's reading dock (G19c): the player in the bottom band.
//
//   ▶ [⏹]  Tempo − 120 +  ·  View ▾  ·  Display
//
// In a set list the dock also holds the list pill (‹ 2 of 9 ›) and Tempo
// shrinks to a "♩ 120" chip that opens a stepper sheet, so it still fits at
// 360px. The same dock on every width. Everything else a tab player has (Size, Play
// in, Layout, Feel, Practice, Tracks, Auto-hide) is in the Display sheet.
// Those controls are built once with the band and MOVED into the sheet while
// it is open and back into the band's hidden store when it closes, never
// rebuilt: every listener is attached in work-view.js's setupTablaturePlayer
// to the node itself, and `controls.querySelector(...)` keeps finding them
// from either side (the same trick as tab-controls-sheet.js, which still
// serves the tab EDITOR's band).

import { dockButton, sizeControl } from './song-dock.js';
import { openSheet } from './shell.js';
import { autoHideRow } from './song-controls.js';

/** The glyphs on Play: the label changes with what is armed. */
export const PLAY = '▶';
export const PAUSE = '⏸';
export const PLAY_LOOP = '▶ Loop';

/** The words under Play in for a capo and the key the tab is in. */
export function playInNote(capo, playKey, tabKey) {
    if (!capo) return '';
    return `Capo ${capo}: playing in ${playKey}. Frets on the page stay as written (the tab is in ${tabKey}).`;
}

// Display sheet groups that hold one moved control: [selector in the store, label]
const SECTIONS = [
    { sel: '.tab-repeat-group', label: 'Layout' },
    { sel: '.tab-feel-group', label: 'Feel' },
];

function group(label, hint = '') {
    const el = document.createElement('div');
    el.className = 'dock-group-label';
    el.innerHTML = `${label}${hint ? ` <span class="dock-opt-hint">${hint}</span>` : ''}`;
    return el;
}

/** The number between − and +: the count in use, and what fits if that is fewer than chosen. */
export function barsLabel({ chosen, count, most }) {
    if (chosen === null || chosen === undefined) return String(count);
    return chosen > most ? `${chosen} · ${most} fit` : String(chosen);
}

/** The count − and + step from: the chosen one, or the one Auto picked. */
function barsBase(fit) { return fit.chosen ?? fit.count; }

/**
 * "[Auto] − 4 +": bars per row, a pill like Size. Auto is a toggle (pressed
 * while the renderer reads the music); − and + leave it for an exact count,
 * stepping from the count Auto had. `bars.fit()` says where the renderer
 * stands ({chosen, auto, count, most} or null), `bars.step(dir)` moves it and
 * `bars.auto()` goes back to Auto. The number has a fixed width so the
 * buttons never move under a finger.
 */
function barsControl(bars) {
    const el = document.createElement('span');
    el.className = 'dock-bars';
    el.id = 'tab-bars';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Bars per row');
    el.innerHTML = `<button type="button" class="dock-bars-auto" id="tab-bars-auto" aria-pressed="true" title="Fit the bars to the window and the music">Auto</button>`
        + `<button type="button" class="dock-size-btn" data-bars="-1" aria-label="Fewer bars" title="Fewer bars per row">−</button>`
        + `<span class="dock-bars-count" id="tab-bars-count" aria-live="polite"></span>`
        + `<button type="button" class="dock-size-btn" data-bars="1" aria-label="More bars" title="More bars per row">+</button>`;
    const autoBtn = el.querySelector('#tab-bars-auto');
    const count = el.querySelector('#tab-bars-count');
    const buttons = [...el.querySelectorAll('[data-bars]')];
    const sync = () => {
        const fit = bars.fit();
        const isAuto = !fit || fit.chosen === null;
        autoBtn.setAttribute('aria-pressed', String(isAuto));
        count.textContent = fit ? barsLabel(fit) : '';
        buttons.forEach(b => {
            const dir = Number(b.dataset.bars);
            b.disabled = !fit || (dir < 0 ? barsBase(fit) <= 1 : barsBase(fit) + 1 > fit.most);
        });
    };
    buttons.forEach(b => b.addEventListener('click', () => { bars.step(Number(b.dataset.bars)); sync(); }));
    autoBtn.addEventListener('click', () => { bars.auto(); sync(); });
    sync();
    return el;
}

/**
 * Fill the Display sheet from the band's controls. `moved` collects every
 * node taken out of the store, so closing the sheet can return them.
 *
 * @param {HTMLElement} content   the sheet's content element
 * @param {HTMLElement} controls  the `.tab-controls` band
 * @returns {() => void} put everything back in the store
 */
export function fillDisplaySheet(content, controls) {
    const store = controls.querySelector('.tab-display-store');
    const moved = [];
    const take = (sel) => {
        const node = store.querySelector(sel);
        if (node) moved.push(node);
        return node;
    };
    content.textContent = '';
    content.classList.add('tab-display');

    // Size: the staff, remembered in its own key (work-view.js owns the number)
    const size = controls._tabDisplay?.size;
    if (size) {
        content.appendChild(group('Size'));
        const row = document.createElement('div');
        row.className = 'dock-opt-row';
        row.innerHTML = '<span class="dock-opt-label">Staff size</span>';
        row.appendChild(sizeControl({ id: 'tab-size', canStep: size.canStep, step: size.step }));
        content.appendChild(row);
    }

    // Bars per row: [Auto] − 4 + (work-view.js owns the choice)
    const bars = controls._tabDisplay?.bars;
    if (bars) {
        content.appendChild(group('Bars per row'));
        const row = document.createElement('div');
        row.className = 'dock-opt-row';
        row.innerHTML = '<span class="dock-opt-label">Bars</span>';
        row.appendChild(barsControl(bars));
        content.appendChild(row);
    }

    // Play in: a capo for playback. The frets on the page do not move.
    const tabKey = controls._tabKey;
    if (tabKey) {
        content.appendChild(group('Play in', 'a capo for playback; the frets don’t move'));
        const grid = document.createElement('div');
        grid.className = 'pill-key-grid tab-play-in';
        grid.id = 'tab-play-in';
        const draw = () => {
            grid.innerHTML = tabKey.keys.map((k, i) => `
                <button type="button" class="pill-key-btn ${i === tabKey.index ? 'active' : ''}" data-idx="${i}"
                    title="${tabKey.capoFor(i) ? `Capo ${tabKey.capoFor(i)}` : 'Open'}">${k}</button>`).join('');
        };
        draw();
        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-idx]');
            if (!btn) return;
            tabKey.set(parseInt(btn.dataset.idx, 10));
            draw();
        });
        content.appendChild(grid);
        const note = take('.tab-capo-indicator');
        if (note) content.appendChild(note);
    }

    for (const { sel, label } of SECTIONS) {
        const node = take(sel);
        if (!node) continue;
        content.appendChild(group(label));
        const row = document.createElement('div');
        row.className = 'dock-opt-row dock-opt-end';
        row.appendChild(node);
        content.appendChild(row);
    }

    // Practice: loop, metronome, count-in
    const practice = ['.tab-loop-toggle', '.tab-metronome-toggle', '.tab-countin-toggle']
        .map(take).filter(Boolean);
    if (practice.length) {
        content.appendChild(group('Practice'));
        const list = document.createElement('div');
        list.className = 'pill-section pill-checks tab-practice';
        list.append(...practice);
        content.appendChild(list);
    }

    // Tracks: what you hear. Solo stays on the track card.
    const mixer = take('.tab-track-mixer');
    if (mixer) {
        content.appendChild(group('Tracks', 'what you hear; Solo is on the track card'));
        content.appendChild(mixer);
    }

    // Auto-hide controls, the same switch as on the lyric sheet
    const hide = document.createElement('div');
    hide.className = 'pill-section pill-checks dock-group-chart';
    hide.appendChild(autoHideRow());
    content.appendChild(hide);

    return () => { for (const node of moved) store.appendChild(node); };
}

/**
 * The dock's Display button. It opens the Display sheet over the band's
 * controls; `#dock-display-btn` is the id auto-hide keys on, here as on the
 * lyric sheet.
 */
export function buildDisplayControl(controls) {
    const btn = dockButton({ id: 'dock-display-btn', label: 'Display', title: 'Display options' });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        let putBack = null;
        openSheet({
            id: 'dock-display-sheet', title: 'Display', opener: btn,
            build: (el) => { putBack = fillDisplaySheet(el, controls); },
            onClose: () => putBack?.(),
        });
    });
    return btn;
}

/**
 * The tempo chip, for a tab opened from a set list: "♩ 120", opening a
 * − 120 + sheet. The stepper is the dock's own `.tab-tempo-group` (the player
 * wired its listeners and holds its nodes), so it waits in the hidden store,
 * moves into the sheet while that is open and goes back on close. The chip's
 * number follows the stepper's, whoever changes it.
 *
 * @param {HTMLElement} controls  the `.tab-controls` band, its tempo stepper built
 * @returns {HTMLButtonElement} the chip, now where the stepper was
 */
export function buildTempoChip(controls) {
    const store = controls.querySelector('.tab-display-store');
    const stepper = controls.querySelector('.tab-tempo-group');
    const display = stepper.querySelector('.tab-tempo-display');

    const chip = dockButton({ id: 'dock-tempo-chip', label: '', title: 'Tempo' });
    chip.classList.add('dock-tempo-chip');
    chip.innerHTML = '<span class="dock-note" aria-hidden="true">♩</span> <span class="dock-tempo-chip-n"></span>';
    const n = chip.querySelector('.dock-tempo-chip-n');
    const sync = () => {
        n.textContent = display.textContent;
        chip.setAttribute('aria-label', `Tempo ${display.textContent}, change`);
    };
    sync();
    stepper.replaceWith(chip);
    store.appendChild(stepper);
    new MutationObserver(sync).observe(display, { childList: true, characterData: true, subtree: true });

    chip.addEventListener('click', (e) => {
        e.stopPropagation();
        openSheet({
            id: 'dock-tempo-sheet', title: 'Tempo', opener: chip,
            build: (el) => {
                el.classList.add('tab-tempo-sheet');
                el.append(stepper);
                el.insertAdjacentHTML('beforeend', '<div class="dock-opt-hint">beats per minute</div>');
            },
            onClose: () => store.appendChild(stepper),
        });
    });
    return chip;
}
