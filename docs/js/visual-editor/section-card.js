// PARKED (not rendered since the two-pane editor pivot): renders one
// section as a block card with header chrome (drag handle, mode toggle,
// per-card menu) plus a lyrics-textarea mode. The live editor surface is
// now the interactive preview (preview.js), which reuses the shared line
// renderer in line-view.js. This module is kept for the next round
// (drag-reorder / section chrome may return on the preview).
// All lyric text is set via textContent (never innerHTML).

import { el, renderChordsLine } from './line-view.js';

const MENU_ACTIONS = [
    ['type-verse', 'Make Verse'], ['type-chorus', 'Make Chorus'],
    ['type-bridge', 'Make Bridge'], ['type-intro', 'Make Intro'],
    ['type-outro', 'Make Outro'], ['rename', 'Rename…'],
    ['duplicate', 'Duplicate'], ['move-up', 'Move up'],
    ['move-down', 'Move down'], ['delete', 'Delete']
];

// ⠿ drag handle: the only lift zone for pointer/touch reordering. The ⋯
// menu's Move up/down stays as the accessible (and keyboard) fallback.
function makeDragHandle(section, callbacks) {
    const handle = el('button', 've-drag-handle', '\u283f');
    handle.type = 'button';
    handle.setAttribute('aria-label', `Drag to reorder ${section.label || 'section'}`);
    if (callbacks && callbacks.onDragHandleDown) {
        handle.addEventListener('pointerdown', (e) => callbacks.onDragHandleDown(section.id, e));
    }
    return handle;
}

export function renderSectionCard(section, ctx) {
    const card = el('div', 've-card');
    card.dataset.sectionId = section.id;

    if (section.type === 'passthrough') {
        card.classList.add('ve-card-passthrough');
        const header = el('div', 've-card-header');
        header.appendChild(makeDragHandle(section, ctx.callbacks));
        header.appendChild(el('span', 've-card-label', 'Raw block (edit in Raw tab)'));
        card.appendChild(header);
        card.appendChild(el('pre', 've-passthrough-raw', section.raw));
        return card;
    }

    const { mode, callbacks } = ctx;

    const header = el('div', 've-card-header');
    header.appendChild(makeDragHandle(section, callbacks));
    header.appendChild(el('span', 've-card-label', section.label));

    const toggle = el('div', 've-mode-toggle');
    const lyricsBtn = el('button', 've-mode-btn ve-mode-lyrics', '✎ Lyrics');
    lyricsBtn.type = 'button';
    const chordsBtn = el('button', 've-mode-btn ve-mode-chords', '♪ Chords');
    chordsBtn.type = 'button';
    (mode === 'lyrics' ? lyricsBtn : chordsBtn).classList.add('active');
    // Prevent the buttons from stealing focus: in lyrics mode the textarea's
    // blur commit re-renders the card, which would destroy the button between
    // pointerdown and pointerup and swallow the tap (double-tap bug on phones).
    lyricsBtn.addEventListener('pointerdown', e => e.preventDefault());
    chordsBtn.addEventListener('pointerdown', e => e.preventDefault());
    lyricsBtn.addEventListener('click', () => callbacks.onToggleMode(section.id, 'lyrics'));
    chordsBtn.addEventListener('click', () => {
        // Commit any lyrics typed in this card before leaving lyrics mode
        // (focus never left the textarea, so its blur commit hasn't fired).
        const ta = card.querySelector('.ve-lyrics-input');
        if (ta) callbacks.onLyricsCommit(section.id, ta.value);
        callbacks.onToggleMode(section.id, 'chords');
    });
    toggle.append(lyricsBtn, chordsBtn);
    header.appendChild(toggle);

    const menuBtn = el('button', 've-card-menu-btn', '⋯');
    menuBtn.type = 'button';
    header.appendChild(menuBtn);
    card.appendChild(header);

    const menu = el('div', 've-card-menu hidden');
    for (const [action, label] of MENU_ACTIONS) {
        const b = el('button', 've-menu-item', label);
        b.type = 'button';
        b.dataset.action = action;
        b.addEventListener('click', () => {
            menu.classList.add('hidden');
            callbacks.onMenuAction(section.id, action);
        });
        menu.appendChild(b);
    }
    menuBtn.addEventListener('click', () => menu.classList.toggle('hidden'));
    card.appendChild(menu);

    const body = el('div', 've-card-body');
    if (mode === 'lyrics') {
        const ta = document.createElement('textarea');
        ta.className = 've-lyrics-input';
        ta.value = section.lines.filter(l => !l.opaque).map(l => l.lyrics).join('\n');
        ta.rows = Math.max(3, section.lines.length + 1);
        ta.addEventListener('blur', () => callbacks.onLyricsCommit(section.id, ta.value));
        // Smart paste: let the orchestrator convert chord sheets / ChordPro.
        // Returns true when handled; plain text falls through to the default
        // textarea paste (committed later by blur, as before).
        ta.addEventListener('paste', (e) => {
            if (!callbacks.onLyricsPaste) return;
            const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
            if (text && callbacks.onLyricsPaste(section.id, text)) {
                e.preventDefault();
            }
        });
        body.appendChild(ta);
    } else {
        section.lines.forEach((line, li) => {
            body.appendChild(renderChordsLine(section, line, li, ctx));
        });
        if (section.lines.length === 0) {
            body.appendChild(el('div', 've-empty-hint', 'No lyrics yet — switch to ✎ Lyrics to type or paste.'));
        }
    }
    card.appendChild(body);
    return card;
}
