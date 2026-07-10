// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVisualEditor } from '../visual-editor/visual-editor.js';

const SRC = `{meta: title Test Song}

{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}
`;

let container, onChange, editor;
beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    onChange = vi.fn();
    editor = createVisualEditor({ container, onChange });
    editor.loadChordPro(SRC);
});

function tapSyllable(text) {
    const syl = [...container.querySelectorAll('.ve-syl')]
        .find(s => s.textContent.trim().startsWith(text));
    syl.click();
    return syl;
}

function pickChord(chord) {
    const btn = [...container.querySelectorAll('.ve-palette .ve-chip-btn')]
        .find(b => b.textContent === chord);
    btn.click();
}

describe('place / move / remove flow', () => {
    it('tap syllable then pick places a chord and fires onChange', () => {
        tapSyllable('world');
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        pickChord('C');
        expect(editor.getChordPro()).toContain('[G]hello [C]world friend');
        expect(onChange).toHaveBeenCalledWith(expect.stringContaining('[C]world'));
    });

    it('tap chip then Remove deletes the chord', () => {
        container.querySelector('.ve-chip').click();
        container.querySelector('.ve-palette-delete').click();
        expect(editor.getChordPro()).not.toContain('[G]');
    });

    it('tap chip then pick replaces the chord', () => {
        container.querySelector('.ve-chip').click();
        pickChord('Em');
        expect(editor.getChordPro()).toContain('[Em]hello');
    });

    it('tap chip then tap syllable deselects the chip and selects the syllable (no move)', () => {
        container.querySelector('.ve-chip').click();
        tapSyllable('friend');
        // deliberate product change: tapping a syllable never moves the chord
        expect(editor.getChordPro()).toContain('[G]hello world friend');
        const syl = [...container.querySelectorAll('.ve-syl')]
            .find(s => s.textContent.trim().startsWith('friend'));
        expect(syl.classList.contains('ve-syl-selected')).toBe(true);
        expect(container.querySelectorAll('.ve-chip-selected')).toHaveLength(0);
        // palette is in place-mode (no delete button) for the new selection
        expect(container.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(true);
    });
});

describe('consecutive picks (insert then refine)', () => {
    it('a pick inserts and selects the new chip; the palette stays open', () => {
        tapSyllable('world');
        pickChord('C');
        expect(editor.getChordPro()).toContain('[C]world');
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        const chip = [...container.querySelectorAll('.ve-chip')].find(c => c.textContent === 'C');
        expect(chip.classList.contains('ve-chip-selected')).toBe(true);
        // now editing an existing chord: delete becomes available
        expect(container.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(false);
    });

    it('the next pick replaces the just-placed chord instead of no-oping or stacking', () => {
        tapSyllable('world');
        pickChord('C');
        pickChord('D7');
        expect(editor.getChordPro()).toContain('[D7]world');
        expect(editor.getChordPro()).not.toContain('[C]');
        // exactly one chip on the syllable (original [G]hello + the new one)
        expect(container.querySelectorAll('.ve-chip')).toHaveLength(2);
    });

    it('picker stays open with its root selection intact across picks', () => {
        tapSyllable('world');
        container.querySelector('.ve-palette-more').click();
        const roots = () => [...container.querySelectorAll('.ve-picker-root')];
        const qualities = () => [...container.querySelectorAll('.ve-picker-quality')];
        roots().find(b => b.textContent === 'E').click();
        qualities().find(b => b.textContent === 'Em').click();
        expect(editor.getChordPro()).toContain('[Em]world');
        expect(container.querySelector('.ve-picker').classList.contains('hidden')).toBe(false);
        expect(container.querySelector('.ve-picker-root.selected').textContent).toBe('E');
        qualities().find(b => b.textContent === 'Em7').click();
        expect(editor.getChordPro()).toContain('[Em7]world');
        expect(editor.getChordPro()).not.toContain('[Em]world');
    });

    it('after a pick, tapping another syllable moves the flow there (insert)', () => {
        tapSyllable('world');
        pickChord('C');
        tapSyllable('friend');
        pickChord('D7');
        expect(editor.getChordPro()).toContain('[C]world [D7]friend');
    });
});

describe('undo / redo', () => {
    it('undo reverts the last op; redo reapplies it', () => {
        tapSyllable('world');
        pickChord('C');
        container.querySelector('.ve-undo').click();
        expect(editor.getChordPro()).not.toContain('[C]');
        container.querySelector('.ve-redo').click();
        expect(editor.getChordPro()).toContain('[C]world');
    });
});

describe('sections', () => {
    it('add-section footer appends a card (new sections open in lyrics mode)', () => {
        container.querySelector('.ve-add-section').click();
        container.querySelector('[data-add-type="chorus"]').click();
        const cards = container.querySelectorAll('.ve-card');
        expect(cards).toHaveLength(2);
        expect(cards[1].querySelector('.ve-card-label').textContent).toBe('Chorus');
        expect(cards[1].querySelector('.ve-lyrics-input')).not.toBeNull();
    });

    it('lyric edits that drop chords show an undoable toast', () => {
        const card = container.querySelector('.ve-card');
        card.querySelector('.ve-mode-lyrics').click();
        const ta = container.querySelector('.ve-lyrics-input');
        ta.value = 'totally new words';
        ta.dispatchEvent(new Event('blur'));
        const toast = container.querySelector('.ve-toast');
        expect(toast.textContent).toContain('1 chord');
        toast.querySelector('.ve-toast-undo').click();
        expect(editor.getChordPro()).toContain('[G]hello world friend');
    });
});

describe('transpose', () => {
    it('toolbar transpose shifts all chords', () => {
        container.querySelector('.ve-transpose-up').click();
        // chords.js may spell the result sharp or flat — accept either
        expect(editor.getChordPro()).toMatch(/\[(G#|Ab)\]hello/);
    });
});

describe('paste-split', () => {
    it('committing multi-paragraph lyrics splits the card into sections', () => {
        const card = container.querySelector('.ve-card');
        card.querySelector('.ve-mode-lyrics').click();
        const ta = container.querySelector('.ve-lyrics-input');
        ta.value = 'hello world friend\n\nsecond verse text here';
        ta.dispatchEvent(new Event('blur'));
        const labels = [...container.querySelectorAll('.ve-card-label')].map(e => e.textContent);
        expect(labels).toEqual(['Verse 1', 'Verse 2']);
    });
});

function docKeydown(opts) {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts });
    document.dispatchEvent(e);
    return e;
}

describe('ghost-chip typed entry', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('typing a chord letter shows a ghost chip over the syllable — no picker, no focus', () => {
        tapSyllable('world');
        const e = docKeydown({ key: 'a' });
        expect(e.defaultPrevented).toBe(true);
        const ghost = container.querySelector('.ve-ghost-chip');
        expect(ghost).not.toBeNull();
        expect(ghost.textContent).toBe('A');
        // it sits in the selected syllable's segment, where the chip will land
        expect(ghost.closest('.ve-seg').querySelector('.ve-syl-selected')).not.toBeNull();
        // no progressive disclosure, no focused input (mobile keyboard stays down)
        expect(container.querySelector('.ve-picker').classList.contains('hidden')).toBe(true);
        expect(document.activeElement).not.toBe(container.querySelector('.ve-palette-custom'));
        expect(editor.getChordPro()).not.toContain('[A]');
    });

    it('keystrokes accumulate and a valid chord auto-commits after the idle delay', () => {
        tapSyllable('world');
        docKeydown({ key: 'e' });
        docKeydown({ key: 'b' });
        docKeydown({ key: '7' });
        expect(container.querySelector('.ve-ghost-chip').textContent).toBe('Eb7');
        expect(editor.getChordPro()).not.toContain('Eb7');
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).toContain('[Eb7]world');
        // the committed chip is selected, same as a palette pick
        expect(container.querySelector('.ve-chip-selected').textContent).toBe('Eb7');
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('each keystroke restarts the idle timer', () => {
        tapSyllable('world');
        docKeydown({ key: 'e' });
        vi.advanceTimersByTime(500);
        docKeydown({ key: 'b' });
        vi.advanceTimersByTime(500); // 1s after first key, only 0.5s after last
        expect(editor.getChordPro()).not.toContain('[Eb]');
        vi.advanceTimersByTime(300);
        expect(editor.getChordPro()).toContain('[Eb]world');
    });

    it('invalid text never commits — the ghost idles in the invalid style', () => {
        tapSyllable('world');
        docKeydown({ key: 'a' });
        docKeydown({ key: 'x' });
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).not.toContain('Ax');
        const ghost = container.querySelector('.ve-ghost-chip');
        expect(ghost.textContent).toBe('Ax');
        expect(ghost.classList.contains('ve-ghost-invalid')).toBe(true);
    });

    it('Backspace repairs an invalid ghost, which then commits', () => {
        tapSyllable('world');
        docKeydown({ key: 'a' });
        docKeydown({ key: 'x' });
        vi.advanceTimersByTime(800); // invalid — still ghosting
        docKeydown({ key: 'Backspace' });
        docKeydown({ key: 'm' });
        expect(container.querySelector('.ve-ghost-chip').textContent).toBe('Am');
        expect(container.querySelector('.ve-ghost-invalid')).toBeNull();
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).toContain('[Am]world');
    });

    it('Escape cancels the ghost and keeps the selection', () => {
        tapSyllable('world');
        docKeydown({ key: 'g' });
        docKeydown({ key: 'Escape' });
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
        vi.advanceTimersByTime(2000);
        expect(editor.getChordPro()).not.toContain('[G]world');
        const syl = [...container.querySelectorAll('.ve-syl')]
            .find(s => s.textContent.trim().startsWith('world'));
        expect(syl.classList.contains('ve-syl-selected')).toBe(true);
    });

    it('Enter commits immediately without advancing', () => {
        tapSyllable('world');
        docKeydown({ key: 'g' });
        docKeydown({ key: '7' });
        docKeydown({ key: 'Enter' });
        expect(editor.getChordPro()).toContain('[G7]world');
        expect(container.querySelector('.ve-chip-selected').textContent).toBe('G7');
        expect(container.querySelector('.ve-syl-selected')).toBeNull(); // no advance
    });

    it('typing on a selected chip previews on the chip and commits a replacement', () => {
        container.querySelector('.ve-chip').click(); // [G]hello
        docKeydown({ key: 'd' });
        docKeydown({ key: '7' });
        const chip = container.querySelector('.ve-chip-selected');
        expect(chip.textContent).toBe('D7');
        expect(chip.classList.contains('ve-chip-editing')).toBe(true);
        expect(editor.getChordPro()).toContain('[G]hello'); // not committed yet
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).toContain('[D7]hello');
        expect(editor.getChordPro()).not.toContain('[G]');
    });

    it('resume grace: typing right after an auto-commit keeps refining that chord', () => {
        tapSyllable('world');
        docKeydown({ key: 'e' });
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).toContain('[E]world');
        docKeydown({ key: 'b' });  // within the grace window: E → Eb, not a new B
        docKeydown({ key: '7' });
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).toContain('[Eb7]world');
        expect(editor.getChordPro()).not.toContain('[B7]');
    });

    it('after the grace window, typing starts a fresh entry on the selected chip', () => {
        tapSyllable('world');
        docKeydown({ key: 'e' });
        vi.advanceTimersByTime(800);   // commit [E]
        vi.advanceTimersByTime(1500);  // grace expires
        docKeydown({ key: 'b' });      // fresh ghost 'B' replacing the chip
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).toContain('[B]world');
        expect(editor.getChordPro()).not.toContain('[Eb]');
    });

    it('tapping another syllable mid-entry commits a valid ghost first', () => {
        tapSyllable('world');
        docKeydown({ key: 'c' });
        tapSyllable('friend');
        expect(editor.getChordPro()).toContain('[C]world');
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('tapping another syllable mid-entry drops an invalid ghost', () => {
        tapSyllable('world');
        docKeydown({ key: 'c' });
        docKeydown({ key: 'x' });
        tapSyllable('friend');
        expect(editor.getChordPro()).not.toContain('Cx');
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('backspacing an existing chord to empty deletes it on idle commit', () => {
        container.querySelector('.ve-chip').click(); // [G]hello
        docKeydown({ key: 'd' });
        docKeydown({ key: 'Backspace' }); // empty ghost on an existing chord
        expect(container.querySelector('.ve-chip-selected').textContent).toBe('');
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).not.toContain('[G]');
        expect(editor.getChordPro()).not.toContain('[D]');
        expect(container.querySelector('.ve-chip')).toBeNull();
    });

    it('Enter on an emptied existing chord deletes it immediately (undoable)', () => {
        container.querySelector('.ve-chip').click();
        docKeydown({ key: 'd' });
        docKeydown({ key: 'Backspace' });
        docKeydown({ key: 'Enter' });
        expect(editor.getChordPro()).not.toContain('[G]');
        docKeydown({ key: 'z', ctrlKey: true });
        expect(editor.getChordPro()).toContain('[G]hello');
    });

    it('does not intercept keystrokes targeted at inputs or textareas', () => {
        tapSyllable('world');
        const field = document.createElement('input');
        document.body.appendChild(field);
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('typing without a selection does nothing', () => {
        const e = docKeydown({ key: 'a' });
        expect(e.defaultPrevented).toBe(false);
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('undo shortcut mid-entry cancels the ghost and undoes the last change', () => {
        tapSyllable('world');
        pickChord('C');
        docKeydown({ key: 'd' });
        docKeydown({ key: 'z', ctrlKey: true });
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
        vi.advanceTimersByTime(2000);
        expect(editor.getChordPro()).not.toContain('[C]');
        expect(editor.getChordPro()).not.toContain('[D]');
    });
});

describe('Space/Tab selection advance', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const selectedSyl = () => container.querySelector('.ve-syl-selected');

    it('Space with a selection and no ghost advances to the next syllable', () => {
        tapSyllable('hel');
        const e = docKeydown({ key: ' ' });
        expect(e.defaultPrevented).toBe(true);
        expect(selectedSyl().textContent.trim().startsWith('lo')).toBe(true);
        expect(editor.getChordPro()).toContain('[G]hello world friend'); // no edits
    });

    it('spam Space across syllables, then type where the chord goes', () => {
        tapSyllable('hel');
        docKeydown({ key: ' ' }); // lo
        docKeydown({ key: ' ' }); // world
        docKeydown({ key: 'c' });
        vi.advanceTimersByTime(800);
        expect(editor.getChordPro()).toContain('[C]world');
    });

    it('Space during ghost entry commits and advances', () => {
        tapSyllable('world');
        docKeydown({ key: 'c' });
        const e = docKeydown({ key: ' ' });
        expect(e.defaultPrevented).toBe(true);
        expect(editor.getChordPro()).toContain('[C]world');
        expect(selectedSyl().textContent.trim().startsWith('friend')).toBe(true);
    });

    it('Space during an invalid ghost neither commits nor advances', () => {
        tapSyllable('world');
        docKeydown({ key: 'c' });
        docKeydown({ key: 'x' });
        docKeydown({ key: ' ' });
        expect(editor.getChordPro()).not.toContain('Cx');
        expect(container.querySelector('.ve-ghost-chip').textContent).toBe('Cx');
    });

    it('Tab advances, Shift+Tab goes backward', () => {
        tapSyllable('world');
        docKeydown({ key: 'Tab' });
        expect(selectedSyl().textContent.trim().startsWith('friend')).toBe(true);
        docKeydown({ key: 'Tab', shiftKey: true });
        expect(selectedSyl().textContent.trim().startsWith('world')).toBe(true);
    });

    it('advance wraps to the next line within the section and stops at the end', () => {
        editor.loadChordPro('{start_of_verse: Verse 1}\nfirst line\nsecond line\n{end_of_verse}\n');
        const line0Syls = [...container.querySelectorAll('.ve-line[data-line="0"] .ve-syl')];
        line0Syls[line0Syls.length - 1].click(); // last syllable of line 0
        docKeydown({ key: ' ' });
        expect(selectedSyl().closest('.ve-line').dataset.line).toBe('1');
        expect(selectedSyl().dataset.start).toBe('0');
        // spam to the end of the section: selection parks on the last syllable
        for (let i = 0; i < 8; i++) docKeydown({ key: ' ' });
        const line1Syls = [...container.querySelectorAll('.ve-line[data-line="1"] .ve-syl')];
        expect(selectedSyl()).toBe(line1Syls[line1Syls.length - 1]);
    });

    it('backward advance wraps to the previous line', () => {
        editor.loadChordPro('{start_of_verse: Verse 1}\nfirst line\nsecond line\n{end_of_verse}\n');
        const syls = [...container.querySelectorAll('.ve-line[data-line="1"] .ve-syl')];
        syls[0].click(); // first syllable of line 1
        docKeydown({ key: 'Tab', shiftKey: true });
        expect(selectedSyl().closest('.ve-line').dataset.line).toBe('0');
        const line0Syls = [...container.querySelectorAll('.ve-line[data-line="0"] .ve-syl')];
        expect(selectedSyl()).toBe(line0Syls[line0Syls.length - 1]);
    });

    it('Space advances from a selected chip too', () => {
        container.querySelector('.ve-chip').click(); // [G] over "hel"
        docKeydown({ key: ' ' });
        expect(selectedSyl().textContent.trim().startsWith('lo')).toBe(true);
    });

    it('Space with no selection is left alone (page scroll)', () => {
        const e = docKeydown({ key: ' ' });
        expect(e.defaultPrevented).toBe(false);
    });

    it('Tab with no selection is left alone (focus navigation)', () => {
        const e = docKeydown({ key: 'Tab' });
        expect(e.defaultPrevented).toBe(false);
    });
});

describe('hover × chord delete', () => {
    it('every chip carries an × affordance that removes the chord (undoable)', () => {
        const x = container.querySelector('.ve-chip-x');
        expect(x).not.toBeNull();
        x.click();
        expect(editor.getChordPro()).not.toContain('[G]');
        expect(container.querySelector('.ve-chip')).toBeNull();
        container.querySelector('.ve-undo').click();
        expect(editor.getChordPro()).toContain('[G]hello world friend');
    });

    it('clicking × does not select the chip or open the palette', () => {
        container.querySelector('.ve-chip-x').click();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
        expect(container.querySelector('.ve-chip-selected')).toBeNull();
    });
});

describe('chord deletion via Delete/Backspace', () => {
    it('Delete removes the chord behind a selected chip and prevents default', () => {
        container.querySelector('.ve-chip').click();
        const e = docKeydown({ key: 'Delete' });
        expect(e.defaultPrevented).toBe(true);
        expect(editor.getChordPro()).not.toContain('[G]');
        expect(container.querySelector('.ve-chip')).toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
    });

    it('Backspace removes the chord behind a selected chip', () => {
        container.querySelector('.ve-chip').click();
        const e = docKeydown({ key: 'Backspace' });
        expect(e.defaultPrevented).toBe(true);
        expect(editor.getChordPro()).not.toContain('[G]');
    });

    it('Delete with a syllable selected (no chip) does nothing', () => {
        tapSyllable('world');
        const e = docKeydown({ key: 'Delete' });
        expect(e.defaultPrevented).toBe(false);
        expect(editor.getChordPro()).toContain('[G]hello world friend');
    });

    it('Backspace with no selection does nothing', () => {
        const e = docKeydown({ key: 'Backspace' });
        expect(e.defaultPrevented).toBe(false);
        expect(editor.getChordPro()).toContain('[G]hello world friend');
    });

    it('Backspace in an editable target is not intercepted', () => {
        container.querySelector('.ve-chip').click();
        const field = document.createElement('input');
        document.body.appendChild(field);
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        expect(editor.getChordPro()).toContain('[G]hello');
    });

    it('Delete is inert while the container is hidden (Raw tab active)', () => {
        container.querySelector('.ve-chip').click();
        container.classList.add('hidden');
        const e = docKeydown({ key: 'Delete' });
        expect(e.defaultPrevented).toBe(false);
        expect(editor.getChordPro()).toContain('[G]hello');
    });

    it('chord removal via Delete key is undoable', () => {
        container.querySelector('.ve-chip').click();
        docKeydown({ key: 'Delete' });
        docKeydown({ key: 'z', ctrlKey: true });
        expect(editor.getChordPro()).toContain('[G]hello');
    });
});

describe('undo/redo keyboard shortcuts', () => {
    it('Cmd+Z / Ctrl+Z undoes the last change and prevents default', () => {
        tapSyllable('world');
        pickChord('C');
        expect(editor.getChordPro()).toContain('[C]world');
        const e = docKeydown({ key: 'z', metaKey: true });
        expect(e.defaultPrevented).toBe(true);
        expect(editor.getChordPro()).not.toContain('[C]');
    });

    it('Cmd+Shift+Z and Ctrl+Y redo', () => {
        tapSyllable('world');
        pickChord('C');
        docKeydown({ key: 'z', ctrlKey: true });
        expect(editor.getChordPro()).not.toContain('[C]');
        docKeydown({ key: 'Z', metaKey: true, shiftKey: true });
        expect(editor.getChordPro()).toContain('[C]world');
        docKeydown({ key: 'z', ctrlKey: true });
        docKeydown({ key: 'y', ctrlKey: true });
        expect(editor.getChordPro()).toContain('[C]world');
    });

    it('shortcuts are inert while the container is hidden (Raw tab active)', () => {
        tapSyllable('world');
        pickChord('C');
        container.classList.add('hidden');
        const e = docKeydown({ key: 'z', metaKey: true });
        expect(e.defaultPrevented).toBe(false);
        expect(editor.getChordPro()).toContain('[C]world');
    });

    it('shortcuts ignore events from editable targets', () => {
        tapSyllable('world');
        pickChord('C');
        const field = document.createElement('textarea');
        document.body.appendChild(field);
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
        expect(editor.getChordPro()).toContain('[C]world');
    });

    it('destroy() removes the document listener', () => {
        tapSyllable('world');
        pickChord('C');
        editor.destroy();
        docKeydown({ key: 'z', metaKey: true });
        expect(editor.getChordPro()).toContain('[C]world');
    });
});

describe('key follows transpose', () => {
    it('palette diatonic chips update after toolbar transpose', () => {
        tapSyllable('world');
        let labels = [...container.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('G');
        expect(labels).toContain('D7');
        container.querySelector('.ve-transpose-up').click();
        container.querySelector('.ve-transpose-up').click();
        labels = [...container.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('A');
        expect(labels).toContain('E7');
    });
});
