// @vitest-environment jsdom
// Interactive preview orchestrator (two-pane editor): the textarea is THE
// document; the preview renders parseSong(textarea.value) and every
// preview-side edit writes serialized ChordPro back into the textarea.
// Ported from the parked card-orchestrator tests — the chord-editing
// behaviors (palette picks, ghost typed entry, Space/Tab advance, chip
// delete, undo/redo) survive on the new surface. Chord selection happens
// on the chord ROW (the strip above each syllable); lyric text is text
// territory (see visual-editor-lyric-edit.test.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInteractivePreview, REFRESH_DEBOUNCE_MS } from '../visual-editor/preview.js';

const SRC = `{meta: title Test Song}

{start_of_verse: Verse 1}
[G]hello world friend
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

// Chord placement lives on the chord ROW: click the strip above the
// syllable (jsdom rects are zero-size, so the click resolves to the
// strip's own token seam).
function tapStrip(text) {
    const syl = [...container.querySelectorAll('.ve-syl')]
        .find(s => s.textContent.trim().startsWith(text));
    const strip = syl.closest('.ve-seg').querySelector('.ve-strip');
    strip.click();
    return strip;
}

function pickChord(chord) {
    const btn = [...container.querySelectorAll('.ve-palette .ve-chip-btn')]
        .find(b => b.textContent === chord);
    btn.click();
}

function docKeydown(opts) {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts });
    document.dispatchEvent(e);
    return e;
}

describe('rendering from the textarea', () => {
    it('renders section labels as headers and chords as chips', () => {
        const label = container.querySelector('.ve-section-label');
        expect(label.textContent).toBe('Verse 1');
        expect(container.querySelector('.ve-chip').textContent).toBe('G');
        // no parked card chrome on the new surface (the header's own drag
        // handle and ⋯ menu are covered in the section-op suites below)
        expect(container.querySelector('.ve-card')).toBeNull();
        expect(container.querySelector('.ve-card-menu-btn')).toBeNull();
        expect(container.querySelector('.ve-mode-toggle')).toBeNull();
        expect(container.querySelector('.ve-add-section')).toBeNull();
    });

    it('metadata directives ride through untouched (never rendered, never lost)', () => {
        tapStrip('world');
        pickChord('C');
        expect(raw()).toContain('{meta: title Test Song}');
        expect(container.textContent).not.toContain('{meta: title');
    });

    it('unknown directives render as read-only passthrough blocks', () => {
        load('{start_of_verse: Verse 1}\nhello there\n{end_of_verse}\n\n{comment: watch the ending}\n');
        const pass = container.querySelector('.ve-psec-passthrough .ve-passthrough-raw');
        expect(pass.textContent).toContain('{comment: watch the ending}');
        // passthrough content has no tap targets
        expect(pass.querySelector('.ve-syl')).toBeNull();
        tapStrip('hel');
        pickChord('G');
        expect(raw()).toContain('{comment: watch the ending}');
    });

    it('chorus sections render with the chorus class', () => {
        load('{start_of_chorus}\nglory glory\n{end_of_chorus}\n');
        expect(container.querySelector('.ve-psec-chorus')).not.toBeNull();
    });
});

describe('place / change / remove flow', () => {
    it('tap syllable then pick places a chord in the textarea and fires onChange', () => {
        tapStrip('world');
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        pickChord('C');
        expect(raw()).toContain('[G]hello [C]world friend');
        expect(onChange).toHaveBeenCalledWith(expect.stringContaining('[C]world'));
    });

    it('tap chip then Remove deletes the chord', () => {
        container.querySelector('.ve-chip').click();
        container.querySelector('.ve-palette-delete').click();
        expect(raw()).not.toContain('[G]');
    });

    it('tap chip then pick replaces the chord', () => {
        container.querySelector('.ve-chip').click();
        pickChord('Em');
        expect(raw()).toContain('[Em]hello');
    });

    it('tap chip then tap syllable deselects the chip and selects the syllable (no move)', () => {
        container.querySelector('.ve-chip').click();
        tapStrip('friend');
        expect(raw()).toContain('[G]hello world friend');
        const syl = [...container.querySelectorAll('.ve-syl')]
            .find(s => s.textContent.trim().startsWith('friend'));
        expect(syl.classList.contains('ve-syl-selected')).toBe(true);
        expect(container.querySelectorAll('.ve-chip-selected')).toHaveLength(0);
        expect(container.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(true);
    });
});

describe('consecutive picks (insert then refine)', () => {
    it('a pick inserts and selects the new chip; the palette stays open', () => {
        tapStrip('world');
        pickChord('C');
        expect(raw()).toContain('[C]world');
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        const chip = [...container.querySelectorAll('.ve-chip')].find(c => c.textContent === 'C');
        expect(chip.classList.contains('ve-chip-selected')).toBe(true);
        expect(container.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(false);
    });

    it('the next pick replaces the just-placed chord instead of no-oping or stacking', () => {
        tapStrip('world');
        pickChord('C');
        pickChord('D7');
        expect(raw()).toContain('[D7]world');
        expect(raw()).not.toContain('[C]');
        expect(container.querySelectorAll('.ve-chip')).toHaveLength(2);
    });

    it('picker stays open with its root selection intact across picks', () => {
        tapStrip('world');
        container.querySelector('.ve-palette-more').click();
        const roots = () => [...container.querySelectorAll('.ve-picker-root')];
        const qualities = () => [...container.querySelectorAll('.ve-picker-quality')];
        roots().find(b => b.textContent === 'E').click();
        qualities().find(b => b.textContent === 'Em').click();
        expect(raw()).toContain('[Em]world');
        expect(container.querySelector('.ve-picker').classList.contains('hidden')).toBe(false);
        expect(container.querySelector('.ve-picker-root.selected').textContent).toBe('E');
        qualities().find(b => b.textContent === 'Em7').click();
        expect(raw()).toContain('[Em7]world');
        expect(raw()).not.toContain('[Em]world');
    });

    it('after a pick, tapping another syllable moves the flow there (insert)', () => {
        tapStrip('world');
        pickChord('C');
        tapStrip('friend');
        pickChord('D7');
        expect(raw()).toContain('[C]world [D7]friend');
    });
});

describe('undo / redo', () => {
    it('undo button reverts the last op; redo reapplies it', () => {
        tapStrip('world');
        pickChord('C');
        undoBtn.click();
        expect(raw()).not.toContain('[C]');
        redoBtn.click();
        expect(raw()).toContain('[C]world');
    });

    it('buttons reflect stack state (disabled when empty)', () => {
        expect(undoBtn.disabled).toBe(true);
        expect(redoBtn.disabled).toBe(true);
        tapStrip('world');
        pickChord('C');
        expect(undoBtn.disabled).toBe(false);
        undoBtn.click();
        expect(undoBtn.disabled).toBe(true);
        expect(redoBtn.disabled).toBe(false);
    });

    it('host edits registered via pushUndoSnapshot are undoable', () => {
        preview.pushUndoSnapshot(textarea.value);
        textarea.value = textarea.value.replace('[G]', '[A]');
        preview.refresh();
        expect(raw()).toContain('[A]hello');
        undoBtn.click();
        expect(raw()).toContain('[G]hello');
    });

    it('undo restores the EXACT previous text, byte for byte', () => {
        const before = raw();
        tapStrip('world');
        pickChord('C');
        undoBtn.click();
        expect(raw()).toBe(before);
    });
});

describe('external textarea changes', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('scheduleRefresh re-renders after the debounce, not before', () => {
        textarea.value = '{start_of_verse: Verse 1}\n[A]new words here\n{end_of_verse}\n';
        preview.scheduleRefresh();
        expect(container.textContent).toContain('hello');
        vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
        expect(container.textContent).toContain('new');
        expect(container.querySelector('.ve-chip').textContent).toBe('A');
    });

    it('rapid schedules collapse into one refresh at the end', () => {
        textarea.value = 'first pass';
        preview.scheduleRefresh();
        vi.advanceTimersByTime(100);
        textarea.value = '{start_of_verse: V}\nfinal words\n{end_of_verse}\n';
        preview.scheduleRefresh();
        vi.advanceTimersByTime(100);
        expect(container.textContent).toContain('hello'); // still old render
        vi.advanceTimersByTime(100);
        expect(container.textContent).toContain('final');
    });

    it('a selection that no longer resolves is dropped and the palette hides', () => {
        tapStrip('world');
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        textarea.value = '{start_of_verse: Verse 1}\nhi\n{end_of_verse}\n';
        preview.refresh();
        expect(container.querySelector('.ve-syl-selected')).toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
    });

    it('a selection that still resolves survives a refresh', () => {
        tapStrip('world');
        textarea.value = textarea.value.replace('friend', 'buddy');
        preview.refresh();
        expect(container.querySelector('.ve-syl-selected')).not.toBeNull();
    });

    it('empty textarea renders the empty-state hint', () => {
        load('');
        expect(container.querySelector('.ve-preview-empty')).not.toBeNull();
    });
});

describe('empty-state escape hatches', () => {
    it('renders upload/request links only when the host provides them', () => {
        load('');
        expect(container.querySelector('.ve-empty-links')).toBeNull();

        const host = document.createElement('div');
        const ta2 = document.createElement('textarea');
        document.body.append(host, ta2);
        const onUploadRequest = vi.fn();
        const onSongRequest = vi.fn();
        const p2 = createInteractivePreview({
            container: host, textarea: ta2, onUploadRequest, onSongRequest
        });
        p2.refresh();
        const links = [...host.querySelectorAll('.ve-empty-link')].map(b => b.textContent);
        expect(links).toEqual(['Upload a photo instead', 'Request a song']);
        host.querySelector('.ve-link-upload').click();
        expect(onUploadRequest).toHaveBeenCalledTimes(1);
        host.querySelector('.ve-link-request').click();
        expect(onSongRequest).toHaveBeenCalledTimes(1);
        p2.destroy();
    });
});

describe('ghost-chip typed entry', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('typing a chord letter shows a ghost chip over the syllable — no picker, no focus', () => {
        tapStrip('world');
        const e = docKeydown({ key: 'a' });
        expect(e.defaultPrevented).toBe(true);
        const ghost = container.querySelector('.ve-ghost-chip');
        expect(ghost).not.toBeNull();
        expect(ghost.textContent).toBe('A');
        expect(ghost.closest('.ve-seg').querySelector('.ve-syl-selected')).not.toBeNull();
        expect(container.querySelector('.ve-picker').classList.contains('hidden')).toBe(true);
        expect(document.activeElement).not.toBe(container.querySelector('.ve-palette-custom'));
        expect(raw()).not.toContain('[A]');
    });

    it('keystrokes accumulate and a valid chord auto-commits after the idle delay', () => {
        tapStrip('world');
        docKeydown({ key: 'e' });
        docKeydown({ key: 'b' });
        docKeydown({ key: '7' });
        expect(container.querySelector('.ve-ghost-chip').textContent).toBe('Eb7');
        expect(raw()).not.toContain('Eb7');
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[Eb7]world');
        expect(container.querySelector('.ve-chip-selected').textContent).toBe('Eb7');
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('each keystroke restarts the idle timer', () => {
        tapStrip('world');
        docKeydown({ key: 'e' });
        vi.advanceTimersByTime(500);
        docKeydown({ key: 'b' });
        vi.advanceTimersByTime(500);
        expect(raw()).not.toContain('[Eb]');
        vi.advanceTimersByTime(300);
        expect(raw()).toContain('[Eb]world');
    });

    it('invalid text never commits — the ghost idles in the invalid style', () => {
        tapStrip('world');
        docKeydown({ key: 'a' });
        docKeydown({ key: 'x' });
        vi.advanceTimersByTime(800);
        expect(raw()).not.toContain('Ax');
        const ghost = container.querySelector('.ve-ghost-chip');
        expect(ghost.textContent).toBe('Ax');
        expect(ghost.classList.contains('ve-ghost-invalid')).toBe(true);
    });

    it('Backspace repairs an invalid ghost, which then commits', () => {
        tapStrip('world');
        docKeydown({ key: 'a' });
        docKeydown({ key: 'x' });
        vi.advanceTimersByTime(800);
        docKeydown({ key: 'Backspace' });
        docKeydown({ key: 'm' });
        expect(container.querySelector('.ve-ghost-chip').textContent).toBe('Am');
        expect(container.querySelector('.ve-ghost-invalid')).toBeNull();
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[Am]world');
    });

    it('Escape cancels the ghost and keeps the selection', () => {
        tapStrip('world');
        docKeydown({ key: 'g' });
        docKeydown({ key: 'Escape' });
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
        vi.advanceTimersByTime(2000);
        expect(raw()).not.toContain('[G]world');
        const syl = [...container.querySelectorAll('.ve-syl')]
            .find(s => s.textContent.trim().startsWith('world'));
        expect(syl.classList.contains('ve-syl-selected')).toBe(true);
    });

    it('Enter commits immediately without advancing', () => {
        tapStrip('world');
        docKeydown({ key: 'g' });
        docKeydown({ key: '7' });
        docKeydown({ key: 'Enter' });
        expect(raw()).toContain('[G7]world');
        expect(container.querySelector('.ve-chip-selected').textContent).toBe('G7');
        expect(container.querySelector('.ve-syl-selected')).toBeNull();
    });

    it('typing on a selected chip previews on the chip and commits a replacement', () => {
        container.querySelector('.ve-chip').click(); // [G]hello
        docKeydown({ key: 'd' });
        docKeydown({ key: '7' });
        const chip = container.querySelector('.ve-chip-selected');
        expect(chip.textContent).toBe('D7');
        expect(chip.classList.contains('ve-chip-editing')).toBe(true);
        expect(raw()).toContain('[G]hello');
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[D7]hello');
        expect(raw()).not.toContain('[G]');
    });

    it('resume grace: typing right after an auto-commit keeps refining that chord', () => {
        tapStrip('world');
        docKeydown({ key: 'e' });
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[E]world');
        docKeydown({ key: 'b' });
        docKeydown({ key: '7' });
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[Eb7]world');
        expect(raw()).not.toContain('[B7]');
    });

    it('after the grace window, typing starts a fresh entry on the selected chip', () => {
        tapStrip('world');
        docKeydown({ key: 'e' });
        vi.advanceTimersByTime(800);   // commit [E]
        vi.advanceTimersByTime(1500);  // grace expires
        docKeydown({ key: 'b' });      // fresh ghost 'B' replacing the chip
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[B]world');
        expect(raw()).not.toContain('[Eb]');
    });

    it('tapping another syllable mid-entry commits a valid ghost first', () => {
        tapStrip('world');
        docKeydown({ key: 'c' });
        tapStrip('friend');
        expect(raw()).toContain('[C]world');
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('tapping another syllable mid-entry drops an invalid ghost', () => {
        tapStrip('world');
        docKeydown({ key: 'c' });
        docKeydown({ key: 'x' });
        tapStrip('friend');
        expect(raw()).not.toContain('Cx');
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('backspacing an existing chord to empty deletes it on idle commit', () => {
        container.querySelector('.ve-chip').click(); // [G]hello
        docKeydown({ key: 'd' });
        docKeydown({ key: 'Backspace' });
        expect(container.querySelector('.ve-chip-selected').textContent).toBe('');
        vi.advanceTimersByTime(800);
        expect(raw()).not.toContain('[G]');
        expect(raw()).not.toContain('[D]');
        expect(container.querySelector('.ve-chip')).toBeNull();
    });

    it('Enter on an emptied existing chord deletes it immediately (undoable)', () => {
        container.querySelector('.ve-chip').click();
        docKeydown({ key: 'd' });
        docKeydown({ key: 'Backspace' });
        docKeydown({ key: 'Enter' });
        expect(raw()).not.toContain('[G]');
        docKeydown({ key: 'z', ctrlKey: true });
        expect(raw()).toContain('[G]hello');
    });

    it('does not intercept keystrokes targeted at inputs or textareas', () => {
        tapStrip('world');
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('typing without a selection does nothing', () => {
        const e = docKeydown({ key: 'a' });
        expect(e.defaultPrevented).toBe(false);
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('undo shortcut mid-entry cancels the ghost and undoes the last change', () => {
        tapStrip('world');
        pickChord('C');
        docKeydown({ key: 'd' });
        docKeydown({ key: 'z', ctrlKey: true });
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
        vi.advanceTimersByTime(2000);
        expect(raw()).not.toContain('[C]');
        expect(raw()).not.toContain('[D]');
    });
});

describe('Space/Tab selection advance', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const selectedSyl = () => container.querySelector('.ve-syl-selected');

    it('Space with a selection and no ghost advances to the next syllable', () => {
        tapStrip('hel');
        const e = docKeydown({ key: ' ' });
        expect(e.defaultPrevented).toBe(true);
        expect(selectedSyl().textContent.trim().startsWith('lo')).toBe(true);
        expect(raw()).toContain('[G]hello world friend');
    });

    it('spam Space across syllables, then type where the chord goes', () => {
        tapStrip('hel');
        docKeydown({ key: ' ' });
        docKeydown({ key: ' ' });
        docKeydown({ key: 'c' });
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[C]world');
    });

    it('Space during ghost entry commits and advances', () => {
        tapStrip('world');
        docKeydown({ key: 'c' });
        const e = docKeydown({ key: ' ' });
        expect(e.defaultPrevented).toBe(true);
        expect(raw()).toContain('[C]world');
        expect(selectedSyl().textContent.trim().startsWith('friend')).toBe(true);
    });

    it('Space during an invalid ghost neither commits nor advances', () => {
        tapStrip('world');
        docKeydown({ key: 'c' });
        docKeydown({ key: 'x' });
        docKeydown({ key: ' ' });
        expect(raw()).not.toContain('Cx');
        expect(container.querySelector('.ve-ghost-chip').textContent).toBe('Cx');
    });

    it('Tab advances, Shift+Tab goes backward', () => {
        tapStrip('world');
        docKeydown({ key: 'Tab' });
        expect(selectedSyl().textContent.trim().startsWith('friend')).toBe(true);
        docKeydown({ key: 'Tab', shiftKey: true });
        expect(selectedSyl().textContent.trim().startsWith('world')).toBe(true);
    });

    it('advance wraps to the next line within the section and stops at the end', () => {
        load('{start_of_verse: Verse 1}\nfirst line\nsecond line\n{end_of_verse}\n');
        const line0Strips = [...container.querySelectorAll('.ve-line[data-line="0"] .ve-strip:not(.ve-strip-end)')];
        line0Strips[line0Strips.length - 1].click();
        docKeydown({ key: ' ' });
        expect(selectedSyl().closest('.ve-line').dataset.line).toBe('1');
        expect(selectedSyl().dataset.start).toBe('0');
        for (let i = 0; i < 8; i++) docKeydown({ key: ' ' });
        const line1Syls = [...container.querySelectorAll('.ve-line[data-line="1"] .ve-syl')];
        expect(selectedSyl()).toBe(line1Syls[line1Syls.length - 1]);
    });

    it('backward advance wraps to the previous line', () => {
        load('{start_of_verse: Verse 1}\nfirst line\nsecond line\n{end_of_verse}\n');
        const strips = [...container.querySelectorAll('.ve-line[data-line="1"] .ve-strip:not(.ve-strip-end)')];
        strips[0].click();
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
        expect(raw()).not.toContain('[G]');
        expect(container.querySelector('.ve-chip')).toBeNull();
        undoBtn.click();
        expect(raw()).toContain('[G]hello world friend');
    });

    it('clicking × does not leave the palette open or a chip selected', () => {
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
        expect(raw()).not.toContain('[G]');
        expect(container.querySelector('.ve-chip')).toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
    });

    it('Backspace removes the chord behind a selected chip', () => {
        container.querySelector('.ve-chip').click();
        const e = docKeydown({ key: 'Backspace' });
        expect(e.defaultPrevented).toBe(true);
        expect(raw()).not.toContain('[G]');
    });

    it('Delete with a syllable selected (no chip) does nothing', () => {
        tapStrip('world');
        const e = docKeydown({ key: 'Delete' });
        expect(e.defaultPrevented).toBe(false);
        expect(raw()).toContain('[G]hello world friend');
    });

    it('Backspace with no selection does nothing', () => {
        const e = docKeydown({ key: 'Backspace' });
        expect(e.defaultPrevented).toBe(false);
        expect(raw()).toContain('[G]hello world friend');
    });

    it('Backspace in an editable target is not intercepted', () => {
        container.querySelector('.ve-chip').click();
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        expect(raw()).toContain('[G]hello');
    });

    it('Delete is inert while the container is hidden (editor panel not shown)', () => {
        container.querySelector('.ve-chip').click();
        container.classList.add('hidden');
        const e = docKeydown({ key: 'Delete' });
        expect(e.defaultPrevented).toBe(false);
        expect(raw()).toContain('[G]hello');
    });

    it('chord removal via Delete key is undoable', () => {
        container.querySelector('.ve-chip').click();
        docKeydown({ key: 'Delete' });
        docKeydown({ key: 'z', ctrlKey: true });
        expect(raw()).toContain('[G]hello');
    });
});

describe('undo/redo keyboard shortcuts', () => {
    it('Cmd+Z / Ctrl+Z undoes the last change and prevents default', () => {
        tapStrip('world');
        pickChord('C');
        expect(raw()).toContain('[C]world');
        const e = docKeydown({ key: 'z', metaKey: true });
        expect(e.defaultPrevented).toBe(true);
        expect(raw()).not.toContain('[C]');
    });

    it('Cmd+Shift+Z and Ctrl+Y redo', () => {
        tapStrip('world');
        pickChord('C');
        docKeydown({ key: 'z', ctrlKey: true });
        expect(raw()).not.toContain('[C]');
        docKeydown({ key: 'Z', metaKey: true, shiftKey: true });
        expect(raw()).toContain('[C]world');
        docKeydown({ key: 'z', ctrlKey: true });
        docKeydown({ key: 'y', ctrlKey: true });
        expect(raw()).toContain('[C]world');
    });

    it('shortcuts are inert while the container is hidden', () => {
        tapStrip('world');
        pickChord('C');
        container.classList.add('hidden');
        const e = docKeydown({ key: 'z', metaKey: true });
        expect(e.defaultPrevented).toBe(false);
        expect(raw()).toContain('[C]world');
    });

    it('shortcuts ignore events from editable targets (native textarea undo wins)', () => {
        tapStrip('world');
        pickChord('C');
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
        expect(raw()).toContain('[C]world');
    });

    it('destroy() removes the document listener', () => {
        tapStrip('world');
        pickChord('C');
        preview.destroy();
        docKeydown({ key: 'z', metaKey: true });
        expect(raw()).toContain('[C]world');
    });
});

describe('key follows the document', () => {
    it('palette diatonic chips follow the detected key of the text', () => {
        tapStrip('world');
        let labels = [...container.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('G');
        expect(labels).toContain('D7');
        // host transposes the textarea (e.g. toolbar +2): palette follows
        textarea.value = '{meta: title Test Song}\n\n{start_of_verse: Verse 1}\n[A]hello world friend\n{end_of_verse}\n';
        preview.refresh();
        tapStrip('world');
        labels = [...container.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('A');
        expect(labels).toContain('E7');
    });

    it('a {key:} directive wins over chord detection', () => {
        load('{key: D}\n\n{start_of_verse: Verse 1}\n[G]hello world friend\n{end_of_verse}\n');
        tapStrip('world');
        const labels = [...container.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('D');
        expect(labels).toContain('A7');
    });
});

describe('Nashville display mode', () => {
    it('displayChord maps chip labels without touching the underlying text', () => {
        const host = document.createElement('div');
        const ta2 = document.createElement('textarea');
        document.body.append(host, ta2);
        const p2 = createInteractivePreview({
            container: host, textarea: ta2,
            displayChord: (c) => `#${c}#`
        });
        ta2.value = '{start_of_verse: Verse 1}\n[G]hello world\n{end_of_verse}\n';
        p2.reset();
        expect(host.querySelector('.ve-chip').textContent).toBe('#G#');
        expect(ta2.value).toContain('[G]hello');
        p2.destroy();
    });
});

describe('section header menu', () => {
    const TWO = `{start_of_verse: Verse 1}
[G]first section words
{end_of_verse}

{start_of_chorus: Chorus}
[C]second section words
{end_of_chorus}
`;

    beforeEach(() => { load(TWO); });

    function openMenu(i) {
        const wraps = container.querySelectorAll('.ve-psec');
        wraps[i].querySelector('.ve-psec-menu-btn').click();
        return wraps[i].querySelector('.ve-psec-menu');
    }

    function menuClick(i, action) {
        openMenu(i).querySelector(`[data-action="${action}"]`).click();
    }

    it('every section header has a drag handle and a ⋯ menu', () => {
        expect(container.querySelectorAll('.ve-psec-header .ve-drag-handle')).toHaveLength(2);
        expect(container.querySelectorAll('.ve-psec-menu-btn')).toHaveLength(2);
        const menu = openMenu(0);
        expect(menu.classList.contains('hidden')).toBe(false);
        const actions = [...menu.querySelectorAll('.ve-menu-item')].map(b => b.dataset.action);
        expect(actions).toEqual(['rename', 'type-verse', 'type-chorus', 'type-bridge',
            'type-intro', 'type-outro', 'duplicate', 'delete']);
    });

    it('Change type rewrites the directive and renumbers the label', () => {
        menuClick(0, 'type-chorus');
        expect(raw()).toContain('{start_of_chorus: Chorus 2}');
        expect(raw()).not.toContain('start_of_verse');
    });

    it('Duplicate copies the section below itself as one undo step', () => {
        menuClick(1, 'duplicate');
        expect(raw().match(/second section words/g)).toHaveLength(2);
        expect(raw()).toContain('Chorus (copy)');
        undoBtn.click();
        expect(raw().match(/second section words/g)).toHaveLength(1);
    });

    it('Delete removes the section and shows an undo toast', () => {
        menuClick(1, 'delete');
        expect(raw()).not.toContain('second section words');
        const toast = container.querySelector('.ve-toast');
        expect(toast.classList.contains('hidden')).toBe(false);
        expect(toast.textContent).toContain('Deleted Chorus');
        toast.querySelector('.ve-toast-undo').click();
        expect(raw()).toContain('second section words');
        expect(toast.classList.contains('hidden')).toBe(true);
    });

    it('deleting a passthrough block says "raw block" in the toast', () => {
        load(TWO + '\n{comment: watch the ending}\n');
        menuClick(2, 'delete');
        expect(raw()).not.toContain('{comment:');
        expect(container.querySelector('.ve-toast').textContent).toContain('Deleted raw block');
    });

    it('passthrough blocks only offer Delete', () => {
        load(TWO + '\n{comment: watch the ending}\n');
        const actions = [...openMenu(2).querySelectorAll('.ve-menu-item')].map(b => b.dataset.action);
        expect(actions).toEqual(['delete']);
    });

    it('Rename swaps the label for an input; Enter commits via relabelSection', () => {
        menuClick(0, 'rename');
        const input = container.querySelector('.ve-rename-input');
        expect(input).not.toBeNull();
        expect(input.value).toBe('Verse 1');
        input.value = 'Opening Verse';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(raw()).toContain('{start_of_verse: Opening Verse}');
        expect(container.querySelector('.ve-rename-input')).toBeNull();
        expect(container.querySelector('.ve-section-label').textContent).toBe('Opening Verse');
    });

    it('Escape cancels a rename without touching the text', () => {
        const before = raw();
        menuClick(0, 'rename');
        const input = container.querySelector('.ve-rename-input');
        input.value = 'Nope';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(raw()).toBe(before);
        expect(container.querySelector('.ve-rename-input')).toBeNull();
    });

    it('typing in the rename input never starts ghost entry', () => {
        menuClick(0, 'rename');
        const input = container.querySelector('.ve-rename-input');
        input.focus();
        docKeydown({ key: 'g', target: input });
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('any section op clears the chip/syllable selection (positional ids shift)', () => {
        tapStrip('words');
        expect(container.querySelector('.ve-syl-selected')).not.toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        menuClick(0, 'delete');
        expect(container.querySelector('.ve-syl-selected')).toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
    });

    it('metadata rides through section ops untouched', () => {
        load('{meta: title Keep Me}\n{meta: x_source unit}\n\n' + TWO);
        menuClick(0, 'duplicate');
        expect(raw()).toContain('{meta: title Keep Me}');
        expect(raw()).toContain('{meta: x_source unit}');
    });
});

describe('drag-and-drop section reorder on the preview', () => {
    // jsdom has no PointerEvent and no layout: sections all measure 0x0 at
    // offsetTop 0, so any pointerY > 0 targets the end and pointerY < 0
    // targets the start. That degenerate geometry still exercises the full
    // pointer state machine; real coordinate math is covered by the pure
    // drag-reorder.test.js suite.
    const TWO = `{start_of_verse: Verse 1}
[G]first section words
{end_of_verse}

{start_of_chorus: Chorus}
[C]second section words
{end_of_chorus}
`;

    function pev(type, opts = {}) {
        const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...opts });
        if (opts.pointerType) {
            Object.defineProperty(e, 'pointerType', { value: opts.pointerType });
        }
        return e;
    }

    function handleOf(i) {
        return container.querySelectorAll('.ve-psec')[i].querySelector('.ve-drag-handle');
    }

    beforeEach(() => { load(TWO); });

    it('mouse drag of section 0 past section 1 reorders the textarea as one undo step', () => {
        const handle = handleOf(0);
        handle.dispatchEvent(pev('pointerdown', { clientY: 10, button: 0 }));
        expect(container.querySelectorAll('.ve-psec')[0].classList.contains('ve-psec-dragging')).toBe(true);
        expect(container.querySelector('.ve-drop-indicator')).not.toBeNull();
        handle.dispatchEvent(pev('pointermove', { clientY: 300 }));
        handle.dispatchEvent(pev('pointerup', { clientY: 300 }));

        expect(raw().indexOf('{start_of_chorus')).toBeLessThan(raw().indexOf('{start_of_verse'));
        expect(container.querySelector('.ve-drop-indicator')).toBeNull();
        expect(container.querySelector('.ve-psec-dragging')).toBeNull();

        undoBtn.click();
        expect(raw().indexOf('{start_of_verse')).toBeLessThan(raw().indexOf('{start_of_chorus'));
    });

    it('a drop reorders the rendered sections too', () => {
        const handle = handleOf(0);
        handle.dispatchEvent(pev('pointerdown', { clientY: 10, button: 0 }));
        handle.dispatchEvent(pev('pointermove', { clientY: 300 }));
        handle.dispatchEvent(pev('pointerup', { clientY: 300 }));
        const labels = [...container.querySelectorAll('.ve-section-label')].map(l => l.textContent);
        expect(labels).toEqual(['Chorus', 'Verse 1']);
    });

    it('dropping at the original position pushes no undo step', () => {
        onChange.mockClear();
        const handle = handleOf(0);
        handle.dispatchEvent(pev('pointerdown', { clientY: -10, button: 0 }));
        handle.dispatchEvent(pev('pointermove', { clientY: -10 }));
        handle.dispatchEvent(pev('pointerup', { clientY: -10 }));
        expect(onChange).not.toHaveBeenCalled();
        expect(undoBtn.disabled).toBe(true);
        expect(raw().indexOf('{start_of_verse')).toBeLessThan(raw().indexOf('{start_of_chorus'));
    });

    it('a drop clears any live selection (positional ids shift)', () => {
        tapStrip('words');
        expect(container.querySelector('.ve-syl-selected')).not.toBeNull();
        const handle = handleOf(0);
        handle.dispatchEvent(pev('pointerdown', { clientY: 10, button: 0 }));
        handle.dispatchEvent(pev('pointermove', { clientY: 300 }));
        handle.dispatchEvent(pev('pointerup', { clientY: 300 }));
        expect(container.querySelector('.ve-syl-selected')).toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
    });

    it('Escape aborts the drag and leaves the order unchanged', () => {
        onChange.mockClear();
        const handle = handleOf(0);
        handle.dispatchEvent(pev('pointerdown', { clientY: 10, button: 0 }));
        handle.dispatchEvent(pev('pointermove', { clientY: 300 }));
        docKeydown({ key: 'Escape' });
        expect(container.querySelector('.ve-psec-dragging')).toBeNull();
        expect(container.querySelector('.ve-drop-indicator')).toBeNull();
        // the stale pointerup after the abort is inert
        handle.dispatchEvent(pev('pointerup', { clientY: 300 }));
        expect(onChange).not.toHaveBeenCalled();
        expect(raw().indexOf('{start_of_verse')).toBeLessThan(raw().indexOf('{start_of_chorus'));
    });

    it('pointercancel aborts cleanly', () => {
        onChange.mockClear();
        const handle = handleOf(0);
        handle.dispatchEvent(pev('pointerdown', { clientY: 10, button: 0 }));
        handle.dispatchEvent(pev('pointermove', { clientY: 300 }));
        handle.dispatchEvent(pev('pointercancel', {}));
        expect(container.querySelector('.ve-psec-dragging')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('touch lifts only after the long-press delay', () => {
        vi.useFakeTimers();
        const handle = handleOf(0);
        handle.dispatchEvent(pev('pointerdown', { clientY: 100, button: 0, pointerType: 'touch' }));
        // not lifted yet — a quick tap or swipe must not start a drag
        expect(container.querySelector('.ve-psec-dragging')).toBeNull();
        vi.advanceTimersByTime(400);
        expect(container.querySelector('.ve-psec-dragging')).not.toBeNull();
        handle.dispatchEvent(pev('pointermove', { clientY: 300, pointerType: 'touch' }));
        handle.dispatchEvent(pev('pointerup', { clientY: 300, pointerType: 'touch' }));
        expect(raw().indexOf('{start_of_chorus')).toBeLessThan(raw().indexOf('{start_of_verse'));
        vi.useRealTimers();
    });

    it('touch movement before the long-press cancels the lift (scroll wins)', () => {
        vi.useFakeTimers();
        onChange.mockClear();
        const handle = handleOf(0);
        handle.dispatchEvent(pev('pointerdown', { clientY: 100, button: 0, pointerType: 'touch' }));
        handle.dispatchEvent(pev('pointermove', { clientY: 130, pointerType: 'touch' }));
        vi.advanceTimersByTime(400);
        expect(container.querySelector('.ve-psec-dragging')).toBeNull();
        handle.dispatchEvent(pev('pointerup', { clientY: 130, pointerType: 'touch' }));
        expect(onChange).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
