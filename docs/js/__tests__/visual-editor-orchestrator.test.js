// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

function customInput() {
    return container.querySelector('.ve-palette-custom');
}

describe('typed chord entry', () => {
    it('typing a chord letter with a syllable selected reveals and focuses the custom input', () => {
        tapSyllable('world');
        const e = docKeydown({ key: 'a' });
        expect(e.defaultPrevented).toBe(true);
        expect(customInput().value).toBe('A');
        expect(document.activeElement).toBe(customInput());
        expect(container.querySelector('.ve-picker').classList.contains('hidden')).toBe(false);
    });

    it('Enter commits the typed chord onto the selected syllable', () => {
        tapSyllable('world');
        docKeydown({ key: 'A' });
        const input = customInput();
        input.value = 'Am';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(editor.getChordPro()).toContain('[Am]world');
    });

    it('Enter changes the chord when a chip is selected', () => {
        container.querySelector('.ve-chip').click();
        docKeydown({ key: 'd' });
        const input = customInput();
        input.value = 'D7';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(editor.getChordPro()).toContain('[D7]hello');
    });

    it('Escape cancels typing and keeps the syllable selection', () => {
        tapSyllable('world');
        docKeydown({ key: 'g' });
        const input = customInput();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(input.value).toBe('');
        expect(container.querySelector('.ve-picker').classList.contains('hidden')).toBe(true);
        const syl = [...container.querySelectorAll('.ve-syl')]
            .find(s => s.textContent.trim().startsWith('world'));
        expect(syl.classList.contains('ve-syl-selected')).toBe(true);
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        expect(editor.getChordPro()).not.toContain('[G7]');
    });

    it('does not intercept keystrokes targeted at inputs or textareas', () => {
        tapSyllable('world');
        const field = document.createElement('input');
        document.body.appendChild(field);
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
        expect(customInput().value).toBe('');
    });

    it('typing without a selection does nothing', () => {
        const e = docKeydown({ key: 'a' });
        expect(e.defaultPrevented).toBe(false);
        expect(customInput().value).toBe('');
        expect(container.querySelector('.ve-picker').classList.contains('hidden')).toBe(true);
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
