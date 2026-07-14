// @vitest-environment jsdom
// In-preview lyric editing: the lyric row is TEXT territory. Clicking a
// line swaps it for a single-line input; blur commits through
// updateLyrics (word-LCS chord re-anchoring, one undo step); Escape
// reverts; Enter splits; Backspace at 0 merges. The chord row above the
// line stays the chord surface (visual-editor-preview.test.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInteractivePreview } from '../visual-editor/preview.js';

const SRC = `{meta: title Test Song}

{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}
`;

const TWO_LINES = `{start_of_verse: Verse 1}
[G]first line here
[C]second line here
{end_of_verse}
`;

let container, textarea, undoBtn, redoBtn, onChange, preview;

beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    textarea = document.createElement('textarea');
    undoBtn = document.createElement('button');
    redoBtn = document.createElement('button');
    document.body.append(textarea, container, undoBtn, redoBtn);
    onChange = vi.fn();
    preview = createInteractivePreview({ container, textarea, onChange, undoBtn, redoBtn });
    load(SRC);
});

function load(text) {
    textarea.value = text;
    preview.reset();
}

function raw() { return textarea.value; }

function sylEl(text) {
    return [...container.querySelectorAll('.ve-syl')]
        .find(s => s.textContent.trim().startsWith(text));
}

function tapLyric(text) {
    sylEl(text).click();
    return container.querySelector('.ve-lyric-input');
}

function input() { return container.querySelector('.ve-lyric-input'); }

function key(el, k, opts = {}) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
}

describe('entering and leaving the lyric edit', () => {
    it('clicking a syllable swaps the line for an input holding the lyrics', () => {
        const inp = tapLyric('world');
        expect(inp).not.toBeNull();
        expect(inp.value).toBe('hello world friend');
        expect(document.activeElement).toBe(inp);
        // caret lands at the clicked syllable start (jsdom falls back to it)
        expect(inp.selectionStart).toBe(6);
        // the edited line's chord strip is gone while editing
        expect(container.querySelector('.ve-line-editing .ve-strip')).toBeNull();
    });

    it('clicking the row background edits the line with the caret at the end', () => {
        const row = container.querySelector('.ve-line');
        row.click();
        expect(input()).not.toBeNull();
        expect(input().selectionStart).toBe('hello world friend'.length);
    });

    it('blur commits the typed text to the textarea as one undo step', () => {
        const inp = tapLyric('world');
        inp.value = 'hello wide world friend';
        inp.dispatchEvent(new Event('blur'));
        expect(input()).toBeNull();
        expect(raw()).toContain('wide world friend');
        expect(onChange).toHaveBeenCalledWith(expect.stringContaining('wide world friend'));
        undoBtn.click();
        expect(raw()).toContain('[G]hello world friend');
        expect(undoBtn.disabled).toBe(true);  // exactly one step
    });

    it('chords re-anchor by word (edit around a chorded word keeps the chord)', () => {
        const inp = tapLyric('hel');
        inp.value = 'well hello world friend';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toContain('well [G]hello world friend');
    });

    it('blur without changes commits nothing (undo stack untouched)', () => {
        const before = raw();
        const inp = tapLyric('world');
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toBe(before);
        expect(undoBtn.disabled).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Escape reverts the line and drops the input', () => {
        const before = raw();
        const inp = tapLyric('world');
        inp.value = 'scrambled nonsense';
        key(inp, 'Escape');
        expect(input()).toBeNull();
        expect(raw()).toBe(before);
        expect(sylEl('world')).not.toBeNull();  // line re-rendered intact
    });

    it('opaque directive lines are not editable', () => {
        load('{start_of_verse: Verse 1}\nhello there\n{x_unknown: thing}\n{end_of_verse}\n');
        const opaque = container.querySelector('.ve-line-opaque');
        opaque.click();
        expect(input()).toBeNull();
    });

    it('committing a section edit drops its opaque lines (documented v1 behavior)', () => {
        load('{start_of_verse: Verse 1}\nhello there\n{x_unknown: thing}\n{end_of_verse}\n');
        const inp = tapLyric('hel');
        inp.value = 'hello there friend';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toContain('hello there friend');
        expect(raw()).not.toContain('{x_unknown: thing}');
        undoBtn.click();  // but one undo brings it back
        expect(raw()).toContain('{x_unknown: thing}');
    });
});

describe('Enter splits, Backspace merges', () => {
    it('Enter splits the line at the caret and continues editing the new line', () => {
        const inp = tapLyric('world');   // caret 6
        key(inp, 'Enter');
        expect(raw()).toContain('[G]hello');
        expect(raw()).toMatch(/hello\s*\nworld friend/);
        const next = input();
        expect(next).not.toBeNull();
        expect(next.value).toBe('world friend');
        expect(next.selectionStart).toBe(0);
    });

    it('Backspace at position 0 merges into the previous line, caret at the join', () => {
        load(TWO_LINES);
        const inp = tapLyric('se');
        inp.setSelectionRange(0, 0);
        key(inp, 'Backspace');
        // both chords survive the merge, keeping their exact anchors
        expect(raw()).toContain('[G]first line here[C]second line here');
        const merged = input();
        expect(merged).not.toBeNull();
        expect(merged.value).toBe('first line heresecond line here');
        expect(merged.selectionStart).toBe('first line here'.length);
    });

    it('Backspace at 0 on the first line of a section does nothing', () => {
        const before = raw();
        const inp = tapLyric('hel');
        inp.setSelectionRange(0, 0);
        key(inp, 'Backspace');
        expect(raw()).toBe(before);
        expect(input()).not.toBeNull();
        expect(input().value).toBe('hello world friend');
    });

    it('Enter at the end of the last line opens a fresh empty line (no undo noise)', () => {
        const inp = tapLyric('hel');
        inp.setSelectionRange(inp.value.length, inp.value.length);
        key(inp, 'Enter');
        expect(undoBtn.disabled).toBe(true);  // nothing committed yet
        const next = input();
        expect(next.value).toBe('');
        next.value = 'brand new line';
        next.dispatchEvent(new Event('blur'));
        expect(raw()).toMatch(/hello world friend\nbrand new line/);
    });
});

describe('add-line ghost row', () => {
    it('clicking + Add line starts a new empty line; blur commits it', () => {
        const add = container.querySelector('.ve-add-line');
        expect(add).not.toBeNull();
        add.click();
        const inp = input();
        expect(inp.value).toBe('');
        inp.value = 'one more line';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toMatch(/hello world friend\none more line\n\{end_of_verse\}/);
    });

    it('abandoning an empty new line commits nothing', () => {
        const before = raw();
        container.querySelector('.ve-add-line').click();
        input().dispatchEvent(new Event('blur'));
        expect(raw()).toBe(before);
        expect(undoBtn.disabled).toBe(true);
    });

    it('an empty section offers the add-line row as its lyric surface', () => {
        load('{start_of_verse: Verse 1}\n{end_of_verse}\n');
        container.querySelector('.ve-add-line').click();
        const inp = input();
        inp.value = 'first words';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toContain('{start_of_verse: Verse 1}\nfirst words\n{end_of_verse}');
    });

    it('Backspace at 0 on the new empty line jumps to editing the last real line', () => {
        container.querySelector('.ve-add-line').click();
        const inp = input();
        inp.setSelectionRange(0, 0);
        key(inp, 'Backspace');
        const last = input();
        expect(last.value).toBe('hello world friend');
        expect(last.selectionStart).toBe('hello world friend'.length);
    });

    it('passthrough sections offer no add-line row', () => {
        load('{comment: watch the ending}\n');
        expect(container.querySelector('.ve-add-line')).toBeNull();
    });
});

describe('emptying a line deletes it', () => {
    const THREE_LINES = `{start_of_verse: Verse 1}
first line here
second line here
third line here
{end_of_verse}
`;
    const THREE_CHORDED = `{start_of_verse: Verse 1}
[G]first line here
[C]second line here
third line here
{end_of_verse}
`;

    it('committing an emptied middle line removes it (one undo step)', () => {
        load(THREE_LINES);
        const inp = tapLyric('se');
        inp.value = '';
        inp.dispatchEvent(new Event('blur'));
        expect(input()).toBeNull();
        expect(raw()).toContain('first line here\nthird line here');
        expect(raw()).not.toContain('second line here');
        // no chords were dropped, so no toast
        expect(container.querySelector('.ve-toast').classList.contains('hidden')).toBe(true);
        undoBtn.click();
        expect(raw()).toContain('second line here');
        expect(undoBtn.disabled).toBe(true);  // exactly one step
    });

    it('a whitespace-only commit deletes the line too', () => {
        load(THREE_LINES);
        const inp = tapLyric('se');
        inp.value = '   ';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toContain('first line here\nthird line here');
        expect(raw()).not.toContain('second line here');
    });

    it('emptying a chorded line drops its chords with the Undo toast', () => {
        load(THREE_CHORDED);
        const inp = tapLyric('se');
        inp.value = '';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).not.toContain('second line here');
        const toast = container.querySelector('.ve-toast');
        expect(toast.classList.contains('hidden')).toBe(false);
        expect(toast.textContent).toContain('1 chord dropped');
        toast.querySelector('.ve-toast-undo').click();
        expect(raw()).toContain('[C]second line here');
    });

    it('emptying the last line leaves an empty section (header menu deletes sections)', () => {
        const inp = tapLyric('world');   // SRC: single [G] line
        inp.value = '';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toContain('{start_of_verse: Verse 1}\n{end_of_verse}');
        expect(container.querySelector('.ve-section-label').textContent).toBe('Verse 1');
        expect(container.querySelector('.ve-add-line')).not.toBeNull();
    });

    it('an untouched chord-only line elsewhere in the section survives exactly', () => {
        load('{start_of_verse: Verse 1}\n[G] [C]\nhello world friend\n{end_of_verse}\n');
        const inp = tapLyric('world');
        inp.value = '';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toContain('[G] [C]');
        expect(raw()).not.toContain('hello world friend');
        // only the edited (empty, chordless) line went away: nothing dropped
        expect(container.querySelector('.ve-toast').classList.contains('hidden')).toBe(true);
    });

    it('Backspace at 0 of an emptied line merges it away with no stray space', () => {
        load(TWO_LINES);
        const inp = tapLyric('se');
        inp.value = '';
        inp.setSelectionRange(0, 0);
        key(inp, 'Backspace');
        expect(raw()).toContain('[G]first line here\n{end_of_verse}');
        expect(raw()).not.toContain('second');
        // editing continues on the previous line, caret at its end
        expect(input().value).toBe('first line here');
        expect(input().selectionStart).toBe('first line here'.length);
    });

    it('Escape on an emptied line still reverts it', () => {
        load(THREE_LINES);
        const before = raw();
        const inp = tapLyric('se');
        inp.value = '';
        key(inp, 'Escape');
        expect(raw()).toBe(before);
        expect(sylEl('se')).not.toBeNull();
    });

    it('an already-blank spacer line survives click-then-blur (no accidental delete)', () => {
        load('{start_of_verse: Verse 1}\nfirst line here\n\nthird line here\n{end_of_verse}\n');
        const before = raw();
        const blank = container.querySelector('.ve-line-blank');
        expect(blank).not.toBeNull();
        blank.click();
        expect(input()).not.toBeNull();
        input().dispatchEvent(new Event('blur'));
        expect(raw()).toBe(before);   // glancing at a line must not edit the song
    });

    it('does not delete a chord-only line on unchanged blur', () => {
        load('{start_of_verse: Verse 1}\n[G] [C]\nhello there\n{end_of_verse}\n');
        const before = raw();
        const blank = container.querySelector('.ve-line-blank') ||
            container.querySelector('.ve-line');
        blank.click();
        const inp = input();
        if (inp) inp.dispatchEvent(new Event('blur'));
        expect(raw()).toBe(before);
        expect(raw()).toContain('[G] [C]');
    });
});

describe('dropped chords toast', () => {
    it('a rewrite that orphans chords shows the undo toast', () => {
        const inp = tapLyric('hel');
        inp.value = 'completely different text';
        inp.dispatchEvent(new Event('blur'));
        expect(raw()).toContain('completely different text');
        expect(raw()).not.toContain('[G]');
        const toast = container.querySelector('.ve-toast');
        expect(toast.classList.contains('hidden')).toBe(false);
        expect(toast.textContent).toContain('1 chord dropped');
        toast.querySelector('.ve-toast-undo').click();
        expect(raw()).toContain('[G]hello world friend');
    });
});

describe('keyboard coherence', () => {
    it('typing chord letters in the lyric input never places chords', () => {
        const inp = tapLyric('world');
        key(inp, 'g');
        key(inp, 'a');
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
        expect(raw()).not.toContain('[A]');
    });

    it('Cmd+Z inside the lyric input is left to the native input undo', () => {
        // place a chord first so there IS something on the undo stack
        const strip = sylEl('world').closest('.ve-seg').querySelector('.ve-strip');
        strip.click();
        [...container.querySelectorAll('.ve-palette .ve-chip-btn')]
            .find(b => b.textContent === 'C').click();
        expect(raw()).toContain('[C]world');
        const inp = tapLyric('friend');
        key(inp, 'z', { metaKey: true });
        expect(raw()).toContain('[C]world');  // orchestrator undo did not fire
    });

    it('starting a lyric edit clears any chord selection and hides the palette', () => {
        sylEl('world').closest('.ve-seg').querySelector('.ve-strip').click();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        tapLyric('friend');
        expect(container.querySelector('.ve-syl-selected')).toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
    });

    it('a chord-row tap while editing commits the lyric edit first', () => {
        load(TWO_LINES);
        const inp = tapLyric('first');
        inp.value = 'first line here now';
        // tap the chord strip on the SECOND line without blurring first
        const strip = sylEl('se').closest('.ve-seg').querySelector('.ve-strip');
        strip.click();
        expect(raw()).toContain('first line here now');
        expect(container.querySelector('.ve-syl-selected')).not.toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
    });

    it('clicking another line\'s lyrics moves the edit there, committing the first', () => {
        load(TWO_LINES);
        const inp = tapLyric('first');
        inp.value = 'first line here now';
        sylEl('se').click();
        expect(raw()).toContain('first line here now');
        expect(input().value).toBe('second line here');
    });

    it('external refresh (textarea typing) abandons an in-progress edit', () => {
        const inp = tapLyric('world');
        inp.value = 'should not land';
        textarea.value = '{start_of_verse: Verse 1}\nnew text entirely\n{end_of_verse}\n';
        preview.refresh();
        expect(input()).toBeNull();
        expect(raw()).not.toContain('should not land');
    });
});

describe('chord-row seam behavior', () => {
    it('strip click selects the seam and opens the palette (no lyric input)', () => {
        const strip = sylEl('world').closest('.ve-seg').querySelector('.ve-strip');
        strip.click();
        expect(input()).toBeNull();
        expect(sylEl('world').classList.contains('ve-syl-selected')).toBe(true);
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
    });

    it('the end slot lives in the chord row and selects the line end', () => {
        const endSlot = container.querySelector('.ve-end-slot');
        expect(endSlot.closest('.ve-strip')).not.toBeNull();
        endSlot.click();
        expect(endSlot.dataset.start).toBe(String('hello world friend'.length));
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
    });

    it('hovering a strip shows a ghost slot at its seam; leaving hides it', () => {
        const strip = sylEl('world').closest('.ve-seg').querySelector('.ve-strip');
        strip.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        const slot = container.querySelector('.ve-slot-ghost');
        expect(slot).not.toBeNull();
        expect(slot.dataset.pos).toBe('6');
        strip.dispatchEvent(new MouseEvent('mouseleave'));
        expect(container.querySelector('.ve-slot-ghost')).toBeNull();
    });
});


describe('tap after a structural edit commit (stale render-time indices)', () => {
    // single-vowel-group words so each renders as ONE .ve-syl tap target
    const THREE = `{start_of_verse: Verse 1}
first sky
brown fox
third moon
{end_of_verse}
`;

    function stripOf(text) {
        return sylEl(text).closest('.ve-seg').querySelector('.ve-strip');
    }
    function pickChord(chord) {
        const btn = [...container.querySelectorAll('.ve-palette .ve-chip-btn')]
            .find(b => b.textContent === chord);
        btn.click();
    }

    it('emptying a line then clicking another strip never targets the wrong line', () => {
        load(THREE);
        const inp = tapLyric('first');
        inp.value = '';
        // clicking the strip above 'brown' commits the pending edit first;
        // that DELETES 'first sky' and shifts every line index up, so the
        // render-time index the click captured no longer points at 'brown'
        stripOf('brown').click();
        expect(raw()).not.toContain('first sky');
        // the tap is swallowed rather than acting on the shifted index:
        // nothing selected, no palette
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
        // a fresh click lands on correct indices: the chord goes on 'brown'
        stripOf('brown').click();
        pickChord('G');
        expect(raw()).toContain('[G]brown fox');
        expect(raw()).not.toContain('[G]third');
    });

    it('a text-only edit (no structure change) still lets the tap through', () => {
        load(THREE);
        const inp = tapLyric('first');
        inp.value = 'first sea';
        stripOf('brown').click();
        expect(raw()).toContain('first sea');
        // same line count, indices still valid: the tap selects normally
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        pickChord('G');
        expect(raw()).toContain('[G]brown fox');
    });
});
