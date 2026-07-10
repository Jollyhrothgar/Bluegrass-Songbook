// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPalette } from '../visual-editor/palette.js';

let onPick, onDelete, onClose, palette;
beforeEach(() => {
    onPick = vi.fn(); onDelete = vi.fn(); onClose = vi.fn();
    palette = createPalette({ onPick, onDelete, onClose });
    document.body.appendChild(palette.el);
});

const rootBtns = () => [...palette.el.querySelectorAll('.ve-picker-root')];
const qualityBtns = () => [...palette.el.querySelectorAll('.ve-picker-quality')];
const selectedRoot = () => palette.el.querySelector('.ve-picker-root.selected');
const openPicker = () => palette.el.querySelector('.ve-palette-more').click();
const pickerHidden = () => palette.el.querySelector('.ve-picker').classList.contains('hidden');

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

    it('hide()/showFor() toggle visibility; Done fires onClose', () => {
        palette.showFor({ existingChord: null });
        expect(palette.el.classList.contains('hidden')).toBe(false);
        palette.el.querySelector('.ve-palette-close').click();
        expect(onClose).toHaveBeenCalled();
        palette.hide();
        expect(palette.el.classList.contains('hidden')).toBe(true);
    });
});

describe('re-render stability (setKey/setRecents on every model change)', () => {
    it('setKey with an unchanged key keeps the same live chip buttons', () => {
        palette.setKey('G');
        const chip = palette.el.querySelector('.ve-palette-diatonic .ve-chip-btn');
        palette.setKey('G');
        expect(palette.el.querySelector('.ve-palette-diatonic .ve-chip-btn')).toBe(chip);
        palette.setKey('C');
        expect(palette.el.querySelector('.ve-palette-diatonic .ve-chip-btn')).not.toBe(chip);
    });

    it('setRecents with an unchanged list keeps the same live chip buttons', () => {
        palette.setRecents(['G', 'C']);
        const chip = palette.el.querySelector('.ve-palette-recents .ve-chip-btn');
        palette.setRecents(['G', 'C']);
        expect(palette.el.querySelector('.ve-palette-recents .ve-chip-btn')).toBe(chip);
        palette.setRecents(['G', 'C', 'D']);
        expect(palette.el.querySelector('.ve-palette-recents .ve-chip-btn')).not.toBe(chip);
    });

    it('re-render with the same key preserves the open picker root selection', () => {
        palette.setKey('G');
        openPicker();
        rootBtns().find(b => b.textContent === 'E').click();
        // simulate render() after a pick: same key, new recents
        palette.setKey('G');
        palette.setRecents(['Em']);
        expect(pickerHidden()).toBe(false);
        expect(selectedRoot().textContent).toBe('E');
    });
});

describe('root + quality picker (Strum Machine style)', () => {
    it('More… toggles the picker panel', () => {
        expect(pickerHidden()).toBe(true);
        openPicker();
        expect(pickerHidden()).toBe(false);
        openPicker();
        expect(pickerHidden()).toBe(true);
    });

    it('renders naturals G A B C D E F and accidentals Ab Bb Db Eb F#', () => {
        openPicker();
        const naturals = [...palette.el.querySelectorAll('.ve-picker-naturals .ve-picker-root')]
            .map(b => b.textContent);
        const accidentals = [...palette.el.querySelectorAll('.ve-picker-accidentals .ve-picker-root')]
            .map(b => b.textContent);
        expect(naturals).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F']);
        expect(accidentals).toEqual(['Ab', 'Bb', 'Db', 'Eb', 'F#']);
    });

    it('renders the quality grid rows in order', () => {
        palette.setKey('G');
        openPicker();
        expect(qualityBtns().map(b => b.textContent)).toEqual([
            'G', 'Gm', 'G7', 'Gmaj7',
            'Gm7', 'Gm6', 'Gm9', 'Gdim',
            'Gaug', 'Gsus4', 'Gsus2', 'Gadd9',
            'G9', 'G11', 'G13', 'Gm7b5'
        ]);
    });

    it('defaults the root to the current key root when opened', () => {
        palette.setKey('D');
        openPicker();
        expect(selectedRoot().textContent).toBe('D');
    });

    it('maps minor and enharmonic keys onto the root buttons', () => {
        palette.setKey('Am');
        openPicker();
        expect(selectedRoot().textContent).toBe('A');
        openPicker(); // close
        palette.setKey('C#');
        openPicker();
        expect(selectedRoot().textContent).toBe('Db');
    });

    it('selecting a root re-labels the quality grid and highlights it', () => {
        palette.setKey('C');
        openPicker();
        const bb = rootBtns().find(b => b.textContent === 'Bb');
        bb.click();
        expect(selectedRoot().textContent).toBe('Bb');
        expect(bb.getAttribute('aria-pressed')).toBe('true');
        const labels = qualityBtns().map(b => b.textContent);
        expect(labels[0]).toBe('Bb');
        expect(labels).toContain('Bbm7');
        expect(labels).toContain('Bbmaj7');
    });

    it('tapping a quality fires onPick with root+quality immediately', () => {
        palette.setKey('G');
        openPicker();
        qualityBtns().find(b => b.textContent === 'Gm7').click();
        expect(onPick).toHaveBeenCalledWith('Gm7');
    });

    it('plain major quality picks just the root', () => {
        palette.setKey('A');
        openPicker();
        qualityBtns()[0].click();
        expect(onPick).toHaveBeenCalledWith('A');
    });

    it('root selection persists across picks while open', () => {
        palette.setKey('G');
        openPicker();
        rootBtns().find(b => b.textContent === 'E').click();
        qualityBtns().find(b => b.textContent === 'Em').click();
        expect(onPick).toHaveBeenCalledWith('Em');
        expect(selectedRoot().textContent).toBe('E');
        expect(pickerHidden()).toBe(false);
    });

    it('reopening the picker resets the root to the key root', () => {
        palette.setKey('C');
        openPicker();
        rootBtns().find(b => b.textContent === 'D').click();
        openPicker(); // close
        openPicker(); // reopen
        expect(selectedRoot().textContent).toBe('C');
    });

    it('custom text input submits any chord on Enter and hides the picker', () => {
        openPicker();
        const input = palette.el.querySelector('.ve-palette-custom');
        input.value = 'F#dim';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onPick).toHaveBeenCalledWith('F#dim');
        expect(pickerHidden()).toBe(true);
    });

    it('hide() also closes the picker and clears the custom input', () => {
        openPicker();
        const input = palette.el.querySelector('.ve-palette-custom');
        input.value = 'Gsus';
        palette.hide();
        expect(pickerHidden()).toBe(true);
        expect(input.value).toBe('');
    });
});

describe('onLayoutChange (palette height changes)', () => {
    it('fires when More… expands and again when it collapses', () => {
        const onLayoutChange = vi.fn();
        const p = createPalette({ onPick, onDelete, onClose, onLayoutChange });
        document.body.appendChild(p.el);
        p.el.querySelector('.ve-palette-more').click();   // expand
        expect(onLayoutChange).toHaveBeenCalledTimes(1);
        p.el.querySelector('.ve-palette-more').click();   // collapse
        expect(onLayoutChange).toHaveBeenCalledTimes(2);
    });

    it('is optional — the palette works without it', () => {
        expect(() => palette.el.querySelector('.ve-palette-more').click()).not.toThrow();
    });
});
