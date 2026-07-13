// Shared line renderer: an interactive chord strip (chips + hover slots)
// above lyric text. The VERTICAL position is the mode — the strip above
// each line is chord territory (hover shows a ghost slot snapped to the
// nearest syllable seam; click selects that offset for the palette/typed
// entry), while the lyric text below is text territory (the orchestrator
// swaps it for an input on click). All lyric text flows through
// textContent.

import { tokenizeLine } from './syllables.js';

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// Which seam does a pointer at clientX over a strip spanning rect pick:
// the strip's own token start (left edge) or the next token's start
// (right edge)? Degenerate zero-size rects (jsdom) resolve to ownStart.
export function nearestSeamPosition(rect, clientX, ownStart, nextStart) {
    if (nextStart === undefined || nextStart === null) return ownStart;
    return (clientX - rect.left) > (rect.right - clientX) ? nextStart : ownStart;
}

// Character offset for a lyric click: token start refined by the caret
// position inside the syllable's text node when the browser can resolve
// it (caretPositionFromPoint / caretRangeFromPoint); jsdom and older
// engines fall back to the token start.
function caretOffsetFromEvent(e, sylEl, tokenStart) {
    const doc = sylEl.ownerDocument;
    try {
        if (typeof doc.caretPositionFromPoint === 'function') {
            const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
            if (p && sylEl.contains(p.offsetNode)) return tokenStart + p.offset;
        } else if (typeof doc.caretRangeFromPoint === 'function') {
            const r = doc.caretRangeFromPoint(e.clientX, e.clientY);
            if (r && sylEl.contains(r.startContainer)) return tokenStart + r.startOffset;
        }
    } catch { /* jsdom / detached */ }
    return tokenStart;
}

// ctx: { selection, callbacks, ghost, displayChord? }
// callbacks: onStripTap(sectionId, li, position) — chord-row click at a
// seam; onChipTap / onChipRemove — existing-chord edit/delete;
// onLyricTap(sectionId, li, caret) — lyric text click (starts text edit).
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

    // Blank lines inside a section render as just their end slot; mark the
    // row so CSS can keep that bare "+" whisper-quiet until hover/selection
    if (line.lyrics.trim() === '' && line.chords.length === 0) {
        row.classList.add('ve-line-blank');
    }
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

    // One faint ghost slot per row, absolutely positioned on the hovered
    // seam (no layout shift). Pure hover affordance — clicking commits the
    // same seam through onStripTap.
    let slot = null;
    const hideSlot = () => { if (slot) { slot.remove(); slot = null; } };
    const showSlot = (seg, atNext, pos) => {
        if (!slot) slot = el('span', 've-slot-ghost');
        slot.dataset.pos = String(pos);
        slot.style.left = atNext ? '100%' : '0';
        if (slot.parentElement !== seg) seg.appendChild(slot);
    };

    tokens.forEach((token, ti) => {
        const seg = el('span', 've-seg');
        const nextStart = ti + 1 < tokens.length ? tokens[ti + 1].start : line.lyrics.length;

        // chord strip: the explicit chord surface above this token
        const strip = makeChips(byToken.get(ti) || []);
        strip.classList.add('ve-strip');
        strip.dataset.line = String(li);
        strip.dataset.start = String(token.start);
        if (ghost && isSelected(token.start)) strip.appendChild(makeGhostChip());
        if (callbacks.onStripTap) {
            strip.addEventListener('click', (e) => {
                if (e.target.closest('.ve-chip, .ve-chip-x')) return;
                hideSlot();
                const pos = nearestSeamPosition(
                    strip.getBoundingClientRect(), e.clientX, token.start, nextStart);
                callbacks.onStripTap(section.id, li, pos);
            });
            strip.addEventListener('mousemove', (e) => {
                if (e.target.closest('.ve-chip, .ve-chip-x')) { hideSlot(); return; }
                const pos = nearestSeamPosition(
                    strip.getBoundingClientRect(), e.clientX, token.start, nextStart);
                showSlot(seg, pos !== token.start, pos);
            });
            strip.addEventListener('mouseleave', hideSlot);
        }
        seg.appendChild(strip);

        // lyric text: text territory — click starts the line's text edit
        const syl = el('span', 've-syl',
            token.text + line.lyrics.slice(token.start + token.text.length, nextStart));
        syl.dataset.line = String(li);
        syl.dataset.start = String(token.start);
        if (isSelected(token.start)) syl.classList.add('ve-syl-selected');
        if (callbacks.onLyricTap) {
            syl.addEventListener('click', (e) => {
                callbacks.onLyricTap(section.id, li,
                    caretOffsetFromEvent(e, syl, token.start));
            });
        }
        seg.appendChild(syl);
        row.appendChild(seg);
    });

    // end slot: place/display trailing chords — lives IN the chord row
    const endSeg = el('span', 've-seg ve-seg-end');
    const endStrip = makeChips(atEnd);
    endStrip.classList.add('ve-strip', 've-strip-end');
    endStrip.dataset.line = String(li);
    endStrip.dataset.start = String(line.lyrics.length);
    if (ghost && isSelected(line.lyrics.length)) endStrip.appendChild(makeGhostChip());
    const endSlot = el('button', 've-end-slot', '+');
    endSlot.type = 'button';
    endSlot.dataset.line = String(li);
    endSlot.dataset.start = String(line.lyrics.length);
    if (isSelected(line.lyrics.length)) endSlot.classList.add('ve-syl-selected');
    if (callbacks.onStripTap) {
        const tapEnd = () => callbacks.onStripTap(section.id, li, line.lyrics.length);
        endSlot.addEventListener('click', tapEnd);
        endStrip.addEventListener('click', (e) => {
            if (e.target.closest('.ve-chip, .ve-chip-x, .ve-end-slot')) return;
            tapEnd();
        });
    }
    endStrip.appendChild(endSlot);
    endSeg.appendChild(endStrip);
    row.appendChild(endSeg);

    // clicks on the row's bare background (right of the text, blank rows)
    // are text territory: edit this line with the caret at the end
    if (callbacks.onLyricTap) {
        row.addEventListener('click', (e) => {
            if (e.target !== row && !e.target.classList.contains('ve-seg')) return;
            callbacks.onLyricTap(section.id, li, line.lyrics.length);
        });
    }

    return row;
}
