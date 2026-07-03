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

    it('tap chip then tap syllable moves the chord', () => {
        container.querySelector('.ve-chip').click();
        tapSyllable('friend');
        expect(editor.getChordPro()).toContain('hello world [G]friend');
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
