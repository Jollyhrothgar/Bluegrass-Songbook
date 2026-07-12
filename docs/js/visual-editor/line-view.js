// Shared line renderer: one lyric line as chord chips above syllable tap
// targets. Used by the interactive preview (preview.js) and by the parked
// section-card renderer. All lyric text flows through textContent.

import { tokenizeLine } from './syllables.js';

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// ctx: { selection, callbacks, ghost, displayChord? }
// callbacks: onSyllableTap(sectionId, li, position), onChipTap(sectionId,
// li, chordIndex), onChipRemove(sectionId, li, chordIndex).
// displayChord (optional) maps a chord to its display label (e.g. Nashville
// numbers) — edits always operate on the underlying chord.
export function renderChordsLine(section, line, li, ctx) {
    const row = el('div', 've-line');
    row.dataset.line = String(li);

    if (line.opaque) {
        row.classList.add('ve-line-opaque');
        row.textContent = line.lyrics;
        return row;
    }

    const { selection, callbacks, ghost } = ctx;
    const display = ctx.displayChord || ((c) => c);
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

    // In-progress typed chord: rendered where the real chip will sit.
    // Ghost state lives in the orchestrator; this is a pure projection.
    const makeGhostChip = () => {
        const g = el('span', 've-ghost-chip', ghost.text);
        if (ghost.invalid) g.classList.add('ve-ghost-invalid');
        return g;
    };

    const makeChips = (indices) => {
        const chips = el('span', 've-chips');
        for (const ci of indices) {
            const wrap = el('span', 've-chip-wrap');
            const chip = el('button', 've-chip', display(line.chords[ci].chord));
            chip.type = 'button';
            chip.dataset.line = String(li);
            chip.dataset.chordIndex = String(ci);
            if (chipSelected(ci)) {
                chip.classList.add('ve-chip-selected');
                if (ghost) {
                    // ghost entry on an existing chord: the chip itself
                    // previews the typed text (empty = pending delete)
                    chip.textContent = ghost.text;
                    chip.classList.add('ve-chip-editing');
                    if (ghost.invalid) chip.classList.add('ve-ghost-invalid');
                }
            }
            chip.addEventListener('click', () => callbacks.onChipTap(section.id, li, ci));
            wrap.appendChild(chip);
            // hover × (revealed on fine-pointer devices via CSS): quick
            // desktop delete; mobile keeps tap-chip → palette ✕ Remove
            const x = el('button', 've-chip-x', '×');
            x.type = 'button';
            x.setAttribute('aria-label', `Remove ${line.chords[ci].chord} chord`);
            x.addEventListener('click', (e) => {
                e.stopPropagation();
                callbacks.onChipRemove(section.id, li, ci);
            });
            wrap.appendChild(x);
            chips.appendChild(wrap);
        }
        return chips;
    };

    tokens.forEach((token, ti) => {
        const seg = el('span', 've-seg');
        const chips = makeChips(byToken.get(ti) || []);
        if (ghost && isSelected(token.start)) chips.appendChild(makeGhostChip());
        seg.appendChild(chips);
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
    const endChips = makeChips(atEnd);
    if (ghost && isSelected(line.lyrics.length)) endChips.appendChild(makeGhostChip());
    endSeg.appendChild(endChips);
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
