// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSectionCard } from '../visual-editor/section-card.js';

const SECTION = {
    id: 'sec-1', type: 'verse', label: 'Verse 1', implicit: false,
    openRaw: null, closeRaw: null,
    lines: [
        { lyrics: 'Down the street', chords: [{ chord: 'D/F', position: 1 }] },
        { lyrics: 'no chords here', chords: [] },
        { lyrics: ' ', chords: [{ chord: 'G', position: 0 }] }   // chord-only line
    ]
};

function makeCtx(overrides = {}) {
    return {
        mode: 'chords',
        selection: null,
        callbacks: {
            onSyllableTap: vi.fn(), onChipTap: vi.fn(), onToggleMode: vi.fn(),
            onMenuAction: vi.fn(), onLyricsCommit: vi.fn()
        },
        ...overrides
    };
}

describe('renderSectionCard — chords mode', () => {
    it('renders the label and syllable tap targets with offsets', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        expect(card.dataset.sectionId).toBe('sec-1');
        expect(card.querySelector('.ve-card-label').textContent).toBe('Verse 1');
        const syls = card.querySelectorAll('.ve-line[data-line="0"] .ve-syl');
        expect(syls[0].dataset.start).toBe('0');
        expect(syls[0].textContent.startsWith('D')).toBe(true);
    });

    it('renders chips over the token at the chord position', () => {
        const card = renderSectionCard(SECTION, makeCtx());
        const chip = card.querySelector('.ve-line[data-line="0"] .ve-chip');
        expect(chip.textContent).toBe('D/F');
        expect(chip.dataset.chordIndex).toBe('0');
    });

    it('fires onSyllableTap with section, line, and offset', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        card.querySelector('.ve-line[data-line="1"] .ve-syl').click();
        expect(ctx.callbacks.onSyllableTap).toHaveBeenCalledWith('sec-1', 1, 0);
    });

    it('fires onChipTap when a chip is tapped', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        card.querySelector('.ve-chip').click();
        expect(ctx.callbacks.onChipTap).toHaveBeenCalledWith('sec-1', 0, 0);
    });

    it('marks the selected syllable', () => {
        const ctx = makeCtx({ selection: { sectionId: 'sec-1', lineIndex: 1, position: 0 } });
        const card = renderSectionCard(SECTION, ctx);
        const sel = card.querySelector('.ve-syl-selected');
        expect(sel.dataset.line).toBe('1');
        expect(sel.dataset.start).toBe('0');
    });

    it('renders an end slot per line and chip rows for chord-only lines', () => {
        const card = renderSectionCard(SECTION, makeCtx());
        expect(card.querySelectorAll('.ve-end-slot')).toHaveLength(3);
        const chordOnly = card.querySelector('.ve-line[data-line="2"] .ve-chip');
        expect(chordOnly.textContent).toBe('G');
    });

    it('renders opaque lines as non-interactive raw text', () => {
        const sec = { ...SECTION, lines: [{ lyrics: '{comment: soft}', chords: [], opaque: true }] };
        const card = renderSectionCard(sec, makeCtx());
        expect(card.querySelector('.ve-line-opaque').textContent).toBe('{comment: soft}');
        expect(card.querySelector('.ve-line-opaque .ve-syl')).toBeNull();
    });
});

describe('renderSectionCard — lyrics mode', () => {
    it('shows a textarea with the plain lyrics and commits on blur', () => {
        const ctx = makeCtx({ mode: 'lyrics' });
        const card = renderSectionCard(SECTION, ctx);
        const ta = card.querySelector('.ve-lyrics-input');
        expect(ta.value).toBe('Down the street\nno chords here\n ');
        ta.value = 'changed text';
        ta.dispatchEvent(new Event('blur'));
        expect(ctx.callbacks.onLyricsCommit).toHaveBeenCalledWith('sec-1', 'changed text');
    });
});

describe('header controls', () => {
    it('mode toggle fires onToggleMode', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        card.querySelector('.ve-mode-lyrics').click();
        expect(ctx.callbacks.onToggleMode).toHaveBeenCalledWith('sec-1', 'lyrics');
    });

    it('menu actions fire onMenuAction', () => {
        const ctx = makeCtx();
        const card = renderSectionCard(SECTION, ctx);
        card.querySelector('.ve-card-menu-btn').click();
        card.querySelector('[data-action="type-chorus"]').click();
        expect(ctx.callbacks.onMenuAction).toHaveBeenCalledWith('sec-1', 'type-chorus');
        card.querySelector('[data-action="delete"]').click();
        expect(ctx.callbacks.onMenuAction).toHaveBeenCalledWith('sec-1', 'delete');
    });

    it('renders passthrough sections read-only', () => {
        const card = renderSectionCard(
            { id: 'sec-9', type: 'passthrough', raw: '{start_of_abc}\nX:1\n{end_of_abc}' },
            makeCtx());
        expect(card.classList.contains('ve-card-passthrough')).toBe(true);
        expect(card.querySelector('.ve-passthrough-raw').textContent).toContain('X:1');
        expect(card.querySelector('.ve-syl')).toBeNull();
    });
});
