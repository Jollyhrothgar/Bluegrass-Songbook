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

    // Seam indicator: ONE visual language for hover and selection. The
    // indicator for a seam is whatever already represents it — an existing
    // chip (highlight it), the end slot (highlight it), or a thin caret
    // (insertion bar, see .ve-slot CSS) centered on the seam above the
    // target syllable (translucent on hover, solid when selected). A caret
    // marks a POINT, so indicators at adjacent seams stay distinct even
    // over one-letter syllables. Hover state is per row, absolutely
    // positioned so there is no layout shift; clicking commits the same
    // seam through onStripTap.
    const makeSlot = (cls, pos) => {
        const s = el('span', 've-slot ' + cls);
        s.dataset.pos = String(pos);
        return s;
    };
    let hoverSlot = null;
    let hoverMarked = [];
    let hoverPos = null;
    const hideSlot = () => {
        if (hoverSlot) { hoverSlot.remove(); hoverSlot = null; }
        for (const m of hoverMarked) m.classList.remove('ve-chip-hover', 've-end-slot-hover');
        hoverMarked = [];
        hoverPos = null;
    };
    // px distance between two seams on the same visual row; null when
    // unmeasurable (jsdom zero rects, different wrapped rows)
    const seamGap = (a, b) => {
        const ea = row.querySelector(`.ve-strip[data-start="${a}"]`);
        const eb = row.querySelector(`.ve-strip[data-start="${b}"]`);
        if (!ea || !eb) return null;
        const ra = ea.getBoundingClientRect();
        const rb = eb.getBoundingClientRect();
        if (ra.width === 0 || rb.width === 0) return null;  // jsdom
        if (Math.abs(ra.top - rb.top) > 1) return null;     // wrapped apart
        return Math.abs(ra.left - rb.left);
    };
    // Dead zone (~0.5em) around the already-selected seam: seams on
    // one-letter syllables sit only a few px apart, and a hover caret
    // that close to the selected caret reads as clutter — the selected
    // caret already marks (nearly) this spot. Click behavior unchanged.
    const nearSelectedSeam = (pos) => {
        if (!selection || selection.sectionId !== section.id ||
            selection.lineIndex !== li || selection.chordIndex !== undefined) return false;
        const gap = seamGap(pos, selection.position);
        if (gap === null) return false;
        const em = parseFloat(getComputedStyle(row).fontSize) || 16;
        return gap < em * 0.5;
    };
    const showSlot = (pos) => {
        if (pos === hoverPos) return;
        hideSlot();
        hoverPos = pos;
        if (isSelected(pos)) return;  // selection already marks this seam
        // occupied seam: the chip IS the indicator — highlight it
        const atPos = line.chords
            .map((c, ci) => (c.position === pos ? ci : -1)).filter(ci => ci >= 0);
        if (atPos.length) {
            for (const ci of atPos) {
                if (chipSelected(ci)) continue;
                const chip = row.querySelector(`.ve-chip[data-chord-index="${ci}"]`);
                if (chip) { chip.classList.add('ve-chip-hover'); hoverMarked.push(chip); }
            }
            return;
        }
        // end-of-line seam: the "+" end slot is the indicator
        if (pos === line.lyrics.length) {
            const end = row.querySelector('.ve-end-slot');
            if (end) { end.classList.add('ve-end-slot-hover'); hoverMarked.push(end); }
            return;
        }
        // otherwise a ghost caret above the target syllable — appended to
        // the seg that OWNS the target token, so it sits on the seam even
        // when the line wraps — unless it would crowd the selected caret
        if (nearSelectedSeam(pos)) return;
        const strip = row.querySelector(`.ve-strip[data-start="${pos}"]`);
        if (strip) {
            hoverSlot = makeSlot('ve-slot-ghost', pos);
            strip.parentElement.appendChild(hoverSlot);
        }
    };

    tokens.forEach((token, ti) => {
        const seg = el('span', 've-seg');
        const nextStart = ti + 1 < tokens.length ? tokens[ti + 1].start : line.lyrics.length;

        // chord strip: the explicit chord surface above this token
        const strip = makeChips(byToken.get(ti) || []);
        strip.classList.add('ve-strip');
        strip.dataset.line = String(li);
        strip.dataset.start = String(token.start);
        if (isSelected(token.start)) {
            if (ghost) strip.appendChild(makeGhostChip());
            else if (!line.chords.some(c => c.position === token.start)) {
                seg.appendChild(makeSlot('ve-slot-selected', token.start));
            }
        }
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
                showSlot(pos);
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
