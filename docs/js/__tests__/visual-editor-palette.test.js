// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPalette } from '../visual-editor/palette.js';

let onPick, onDelete, onClose, palette;
beforeEach(() => {
    onPick = vi.fn(); onDelete = vi.fn(); onClose = vi.fn();
    palette = createPalette({ onPick, onDelete, onClose });
    document.body.appendChild(palette.el);
});

describe('createPalette', () => {
    it('renders diatonic chips for the key, including V7', () => {
        palette.setKey('C');
        const chips = [...palette.el.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(chips).toContain('C');
        expect(chips).toContain('F');
        expect(chips).toContain('G');
        expect(chips).toContain('G7');
        expect(chips).toContain('Am');
    });

    it('fires onPick with the chord when a chip is tapped', () => {
        palette.setKey('G');
        palette.showFor({ existingChord: null });
        palette.el.querySelector('.ve-palette-diatonic .ve-chip-btn').click();
        expect(onPick).toHaveBeenCalledWith('G');
    });

    it('renders recents and picks from them', () => {
        palette.setRecents(['D7', 'Bm']);
        const chips = [...palette.el.querySelectorAll('.ve-palette-recents .ve-chip-btn')]
            .map(b => b.textContent);
        expect(chips).toEqual(['D7', 'Bm']);
        palette.el.querySelector('.ve-palette-recents .ve-chip-btn').click();
        expect(onPick).toHaveBeenCalledWith('D7');
    });

    it('shows delete button only when editing an existing chord', () => {
        palette.showFor({ existingChord: null });
        expect(palette.el.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(true);
        palette.showFor({ existingChord: 'G' });
        expect(palette.el.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(false);
        palette.el.querySelector('.ve-palette-delete').click();
        expect(onDelete).toHaveBeenCalled();
    });

    it('More… reveals the root x quality grid and picks compose', () => {
        palette.el.querySelector('.ve-palette-more').click();
        const grid = palette.el.querySelector('.ve-palette-more-grid');
        expect(grid.classList.contains('hidden')).toBe(false);
        const bm7 = [...grid.querySelectorAll('.ve-chip-btn')].find(b => b.textContent === 'Bm7');
        bm7.click();
        expect(onPick).toHaveBeenCalledWith('Bm7');
    });

    it('custom text input submits any chord on Enter', () => {
        palette.el.querySelector('.ve-palette-more').click();
        const input = palette.el.querySelector('.ve-palette-custom');
        input.value = 'F#dim';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onPick).toHaveBeenCalledWith('F#dim');
    });

    it('hide()/showFor() toggle visibility; Done fires onClose', () => {
        palette.showFor({ existingChord: null });
        expect(palette.el.classList.contains('hidden')).toBe(false);
        palette.el.querySelector('.ve-palette-close').click();
        expect(onClose).toHaveBeenCalled();
        palette.hide();
        expect(palette.el.classList.contains('hidden')).toBe(true);
    });
});

describe('beginTyping (hardware keyboard chord entry)', () => {
    it('reveals the more grid, seeds the custom input, and focuses it', () => {
        palette.showFor({ existingChord: null });
        palette.beginTyping('A');
        const grid = palette.el.querySelector('.ve-palette-more-grid');
        const input = palette.el.querySelector('.ve-palette-custom');
        expect(grid.classList.contains('hidden')).toBe(false);
        expect(input.value).toBe('A');
        expect(document.activeElement).toBe(input);
    });

    it('Escape clears the input and hides the grid without firing onPick', () => {
        palette.beginTyping('B');
        const input = palette.el.querySelector('.ve-palette-custom');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(input.value).toBe('');
        expect(palette.el.querySelector('.ve-palette-more-grid').classList.contains('hidden')).toBe(true);
        expect(onPick).not.toHaveBeenCalled();
    });

    it('Enter commits the typed chord and resets the input and grid', () => {
        palette.beginTyping('A');
        const input = palette.el.querySelector('.ve-palette-custom');
        input.value = 'Am7';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onPick).toHaveBeenCalledWith('Am7');
        expect(input.value).toBe('');
        expect(palette.el.querySelector('.ve-palette-more-grid').classList.contains('hidden')).toBe(true);
    });
});
