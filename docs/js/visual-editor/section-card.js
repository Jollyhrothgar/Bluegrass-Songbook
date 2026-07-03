// Renders one section as a block card. Chords mode shows syllable tap
// targets with chord chips above them; lyrics mode shows a plain textarea.
// All lyric text is set via textContent (never innerHTML).

import { tokenizeLine } from './syllables.js';

const MENU_ACTIONS = [
    ['type-verse', 'Make Verse'], ['type-chorus', 'Make Chorus'],
    ['type-bridge', 'Make Bridge'], ['type-intro', 'Make Intro'],
    ['type-outro', 'Make Outro'], ['rename', 'Rename…'],
    ['duplicate', 'Duplicate'], ['move-up', 'Move up'],
    ['move-down', 'Move down'], ['delete', 'Delete']
];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function renderChordsLine(section, line, li, ctx) {
    const row = el('div', 've-line');
    row.dataset.line = String(li);

    if (line.opaque) {
        row.classList.add('ve-line-opaque');
        row.textContent = line.lyrics;
        return row;
    }

    const { selection, callbacks } = ctx;
    const positions = line.chords.map(c => c.position);
    const tokens = tokenizeLine(line.lyrics, positions);

    // group chords by the token that displays them: first token with
    // start >= position; chords past the last token go to the end slot
    const byToken = new Map();
    const atEnd = [];
    line.chords.forEach((c, ci) => {
        const ti = tokens.findIndex(t => t.start >= c.position);
        if (ti === -1) atEnd.push(ci);
        else byToken.set(ti, [...(byToken.get(ti) || []), ci]);
    });

    const isSelected = (start) => selection &&
        selection.sectionId === section.id && selection.lineIndex === li &&
        selection.position === start && selection.chordIndex === undefined;
    const chipSelected = (ci) => selection &&
        selection.sectionId === section.id && selection.lineIndex === li &&
        selection.chordIndex === ci;

    const makeChips = (indices) => {
        const chips = el('span', 've-chips');
        for (const ci of indices) {
            const chip = el('button', 've-chip', line.chords[ci].chord);
            chip.type = 'button';
            chip.dataset.line = String(li);
            chip.dataset.chordIndex = String(ci);
            if (chipSelected(ci)) chip.classList.add('ve-chip-selected');
            chip.addEventListener('click', () => callbacks.onChipTap(section.id, li, ci));
            chips.appendChild(chip);
        }
        return chips;
    };

    tokens.forEach((token, ti) => {
        const seg = el('span', 've-seg');
        seg.appendChild(makeChips(byToken.get(ti) || []));
        const nextStart = ti + 1 < tokens.length ? tokens[ti + 1].start : line.lyrics.length;
        const syl = el('span', 've-syl',
            token.text + line.lyrics.slice(token.start + token.text.length, nextStart));
        syl.dataset.line = String(li);
        syl.dataset.start = String(token.start);
        if (isSelected(token.start)) syl.classList.add('ve-syl-selected');
        syl.addEventListener('click', () => callbacks.onSyllableTap(section.id, li, token.start));
        seg.appendChild(syl);
        row.appendChild(seg);
    });

    // end slot: place/display trailing chords
    const endSeg = el('span', 've-seg ve-seg-end');
    endSeg.appendChild(makeChips(atEnd));
    const endSlot = el('button', 've-end-slot', '+');
    endSlot.type = 'button';
    endSlot.dataset.line = String(li);
    endSlot.dataset.start = String(line.lyrics.length);
    if (isSelected(line.lyrics.length)) endSlot.classList.add('ve-syl-selected');
    endSlot.addEventListener('click', () => callbacks.onSyllableTap(section.id, li, line.lyrics.length));
    endSeg.appendChild(endSlot);
    row.appendChild(endSeg);

    return row;
}

export function renderSectionCard(section, ctx) {
    const card = el('div', 've-card');
    card.dataset.sectionId = section.id;

    if (section.type === 'passthrough') {
        card.classList.add('ve-card-passthrough');
        const header = el('div', 've-card-header');
        header.appendChild(el('span', 've-card-label', 'Raw block (edit in Raw tab)'));
        card.appendChild(header);
        card.appendChild(el('pre', 've-passthrough-raw', section.raw));
        return card;
    }

    const { mode, callbacks } = ctx;

    const header = el('div', 've-card-header');
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
