// @vitest-environment jsdom
// Interactive preview orchestrator (two-pane editor): the textarea is THE
// document; the preview renders parseSong(textarea.value) and every
// preview-side edit writes serialized ChordPro back into the textarea.
// Ported from the parked card-orchestrator tests — the chord-editing
// behaviors (palette picks, ghost typed entry, Space/Tab advance, chip
// delete, undo/redo) survive on the new surface.
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
        // no card chrome on the new surface
        expect(container.querySelector('.ve-card')).toBeNull();
        expect(container.querySelector('.ve-card-menu-btn')).toBeNull();
        expect(container.querySelector('.ve-mode-toggle')).toBeNull();
        expect(container.querySelector('.ve-drag-handle')).toBeNull();
        expect(container.querySelector('.ve-add-section')).toBeNull();
    });

    it('metadata directives ride through untouched (never rendered, never lost)', () => {
        tapSyllable('world');
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
        tapSyllable('hel');
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
        tapSyllable('world');
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
        tapSyllable('friend');
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
        tapSyllable('world');
        pickChord('C');
        expect(raw()).toContain('[C]world');
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        const chip = [...container.querySelectorAll('.ve-chip')].find(c => c.textContent === 'C');
        expect(chip.classList.contains('ve-chip-selected')).toBe(true);
        expect(container.querySelector('.ve-palette-delete').classList.contains('hidden')).toBe(false);
    });

    it('the next pick replaces the just-placed chord instead of no-oping or stacking', () => {
        tapSyllable('world');
        pickChord('C');
        pickChord('D7');
        expect(raw()).toContain('[D7]world');
        expect(raw()).not.toContain('[C]');
        expect(container.querySelectorAll('.ve-chip')).toHaveLength(2);
    });

    it('picker stays open with its root selection intact across picks', () => {
        tapSyllable('world');
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
        tapSyllable('world');
        pickChord('C');
        tapSyllable('friend');
        pickChord('D7');
        expect(raw()).toContain('[C]world [D7]friend');
    });
});

describe('undo / redo', () => {
    it('undo button reverts the last op; redo reapplies it', () => {
        tapSyllable('world');
        pickChord('C');
        undoBtn.click();
        expect(raw()).not.toContain('[C]');
        redoBtn.click();
        expect(raw()).toContain('[C]world');
    });

    it('buttons reflect stack state (disabled when empty)', () => {
        expect(undoBtn.disabled).toBe(true);
        expect(redoBtn.disabled).toBe(true);
        tapSyllable('world');
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
        tapSyllable('world');
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
        tapSyllable('world');
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(false);
        textarea.value = '{start_of_verse: Verse 1}\nhi\n{end_of_verse}\n';
        preview.refresh();
        expect(container.querySelector('.ve-syl-selected')).toBeNull();
        expect(container.querySelector('.ve-palette').classList.contains('hidden')).toBe(true);
    });

    it('a selection that still resolves survives a refresh', () => {
        tapSyllable('world');
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
        tapSyllable('world');
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
        tapSyllable('world');
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
        tapSyllable('world');
        docKeydown({ key: 'e' });
        vi.advanceTimersByTime(500);
        docKeydown({ key: 'b' });
        vi.advanceTimersByTime(500);
        expect(raw()).not.toContain('[Eb]');
        vi.advanceTimersByTime(300);
        expect(raw()).toContain('[Eb]world');
    });

    it('invalid text never commits — the ghost idles in the invalid style', () => {
        tapSyllable('world');
        docKeydown({ key: 'a' });
        docKeydown({ key: 'x' });
        vi.advanceTimersByTime(800);
        expect(raw()).not.toContain('Ax');
        const ghost = container.querySelector('.ve-ghost-chip');
        expect(ghost.textContent).toBe('Ax');
        expect(ghost.classList.contains('ve-ghost-invalid')).toBe(true);
    });

    it('Backspace repairs an invalid ghost, which then commits', () => {
        tapSyllable('world');
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
        tapSyllable('world');
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
        tapSyllable('world');
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
        tapSyllable('world');
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
        tapSyllable('world');
        docKeydown({ key: 'e' });
        vi.advanceTimersByTime(800);   // commit [E]
        vi.advanceTimersByTime(1500);  // grace expires
        docKeydown({ key: 'b' });      // fresh ghost 'B' replacing the chip
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[B]world');
        expect(raw()).not.toContain('[Eb]');
    });

    it('tapping another syllable mid-entry commits a valid ghost first', () => {
        tapSyllable('world');
        docKeydown({ key: 'c' });
        tapSyllable('friend');
        expect(raw()).toContain('[C]world');
        expect(container.querySelector('.ve-ghost-chip')).toBeNull();
    });

    it('tapping another syllable mid-entry drops an invalid ghost', () => {
        tapSyllable('world');
        docKeydown({ key: 'c' });
        docKeydown({ key: 'x' });
        tapSyllable('friend');
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
        tapSyllable('world');
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
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
        expect(raw()).not.toContain('[C]');
        expect(raw()).not.toContain('[D]');
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
        expect(raw()).toContain('[G]hello world friend');
    });

    it('spam Space across syllables, then type where the chord goes', () => {
        tapSyllable('hel');
        docKeydown({ key: ' ' });
        docKeydown({ key: ' ' });
        docKeydown({ key: 'c' });
        vi.advanceTimersByTime(800);
        expect(raw()).toContain('[C]world');
    });

    it('Space during ghost entry commits and advances', () => {
        tapSyllable('world');
        docKeydown({ key: 'c' });
        const e = docKeydown({ key: ' ' });
        expect(e.defaultPrevented).toBe(true);
        expect(raw()).toContain('[C]world');
        expect(selectedSyl().textContent.trim().startsWith('friend')).toBe(true);
    });

    it('Space during an invalid ghost neither commits nor advances', () => {
        tapSyllable('world');
        docKeydown({ key: 'c' });
        docKeydown({ key: 'x' });
        docKeydown({ key: ' ' });
        expect(raw()).not.toContain('Cx');
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
        load('{start_of_verse: Verse 1}\nfirst line\nsecond line\n{end_of_verse}\n');
        const line0Syls = [...container.querySelectorAll('.ve-line[data-line="0"] .ve-syl')];
        line0Syls[line0Syls.length - 1].click();
        docKeydown({ key: ' ' });
        expect(selectedSyl().closest('.ve-line').dataset.line).toBe('1');
        expect(selectedSyl().dataset.start).toBe('0');
        for (let i = 0; i < 8; i++) docKeydown({ key: ' ' });
        const line1Syls = [...container.querySelectorAll('.ve-line[data-line="1"] .ve-syl')];
        expect(selectedSyl()).toBe(line1Syls[line1Syls.length - 1]);
    });

    it('backward advance wraps to the previous line', () => {
        load('{start_of_verse: Verse 1}\nfirst line\nsecond line\n{end_of_verse}\n');
        const syls = [...container.querySelectorAll('.ve-line[data-line="1"] .ve-syl')];
        syls[0].click();
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
        tapSyllable('world');
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
        tapSyllable('world');
        pickChord('C');
        expect(raw()).toContain('[C]world');
        const e = docKeydown({ key: 'z', metaKey: true });
        expect(e.defaultPrevented).toBe(true);
        expect(raw()).not.toContain('[C]');
    });

    it('Cmd+Shift+Z and Ctrl+Y redo', () => {
        tapSyllable('world');
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
        tapSyllable('world');
        pickChord('C');
        container.classList.add('hidden');
        const e = docKeydown({ key: 'z', metaKey: true });
        expect(e.defaultPrevented).toBe(false);
        expect(raw()).toContain('[C]world');
    });

    it('shortcuts ignore events from editable targets (native textarea undo wins)', () => {
        tapSyllable('world');
        pickChord('C');
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
        expect(raw()).toContain('[C]world');
    });

    it('destroy() removes the document listener', () => {
        tapSyllable('world');
        pickChord('C');
        preview.destroy();
        docKeydown({ key: 'z', metaKey: true });
        expect(raw()).toContain('[C]world');
    });
});

describe('key follows the document', () => {
    it('palette diatonic chips follow the detected key of the text', () => {
        tapSyllable('world');
        let labels = [...container.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('G');
        expect(labels).toContain('D7');
        // host transposes the textarea (e.g. toolbar +2): palette follows
        textarea.value = '{meta: title Test Song}\n\n{start_of_verse: Verse 1}\n[A]hello world friend\n{end_of_verse}\n';
        preview.refresh();
        tapSyllable('world');
        labels = [...container.querySelectorAll('.ve-palette-diatonic .ve-chip-btn')]
            .map(b => b.textContent);
        expect(labels).toContain('A');
        expect(labels).toContain('E7');
    });

    it('a {key:} directive wins over chord detection', () => {
        load('{key: D}\n\n{start_of_verse: Verse 1}\n[G]hello world friend\n{end_of_verse}\n');
        tapSyllable('world');
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
