// File ▸ Save as… (G15f): the panel, and Ctrl/Cmd+S opening it from the editor.
// The decisions behind it (default format, names, notices) are save-as.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OTFEditor } from '../../otf-editor/editor.js';
import { SaveAsPopover } from '../../otf-editor/popover.js';
import { SAVE_FORMATS } from '../../otf-editor/save-as.js';
import { resetPreset } from '../../otf-editor/bindings.js';

const keyEvent = (key, opts = {}) => new KeyboardEvent('keydown', {
    key, ctrlKey: !!opts.ctrl, metaKey: !!opts.meta, bubbles: true, cancelable: true,
});
const tick = () => new Promise(r => setTimeout(r, 0));

/** A stand-in for createSaveAs(): the panel only needs these four things. */
function fakeSession(over = {}) {
    return {
        formats: SAVE_FORMATS,
        format: 'tef',
        fileName: 'tune.tef',
        prepare: vi.fn(async () => ({ notice: '', error: '' })),
        save: vi.fn(async (_format, name) => ({ filename: name })),
        ...over,
    };
}

describe('SaveAsPopover', () => {
    let container, panel, onClose;
    const $ = (sel) => panel.element.querySelector(sel);

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        document.body.appendChild(container);
        onClose = vi.fn();
        panel = new SaveAsPopover({ onClose });
        panel.init(container);
    });
    afterEach(() => panel.destroy());

    it('offers the three formats, the document\'s own first and checked', async () => {
        panel.open(fakeSession({ format: 'otf', fileName: 'x.otf.json' }));
        await tick();
        const labels = [...panel.element.querySelectorAll('.save-as-format span')].map(e => e.textContent);
        expect(labels).toEqual(['TablEdit (.tef)', 'Bluegrass Book tab (.otf.json)', 'Plain-text tab (.txt)']);
        expect(panel.format).toBe('otf');
        expect($('.save-as-name').value).toBe('x.otf.json');
    });

    it('changing the format changes the extension, keeps the rest of the name, and asks again', async () => {
        const session = fakeSession();
        panel.open(session);
        await tick();
        $('.save-as-name').value = 'my tune.tef';
        const txt = panel.element.querySelector('input[value="txt"]');
        txt.checked = true;
        txt.dispatchEvent(new Event('change'));
        expect($('.save-as-name').value).toBe('my tune.txt');
        expect(session.prepare).toHaveBeenLastCalledWith('txt');
    });

    it('shows the notice before Save, and Save waits for it', async () => {
        let release;
        const session = fakeSession({
            prepare: vi.fn(() => new Promise(r => { release = r; })),
        });
        panel.open(session);
        expect($('.save-btn').disabled).toBe(true);
        release({ notice: 'Not kept from this file: 2 tempo changes.', error: '' });
        await tick();
        expect($('.save-as-notice').textContent).toBe('Not kept from this file: 2 tempo changes.');
        expect($('.save-btn').disabled).toBe(false);
    });

    it('an error is a sentence, Save is held back, and nothing is saved', async () => {
        const session = fakeSession({
            prepare: async () => ({ notice: '', error: 'The template is not a TablEdit 3 file.' }),
        });
        panel.open(session);
        await tick();
        expect($('.save-as-error').textContent).toBe('The template is not a TablEdit 3 file.');
        expect($('.save-btn').disabled).toBe(true);
        $('.save-btn').click();
        expect(session.save).not.toHaveBeenCalled();
        expect(panel.opened).toBe(true);
    });

    it('Save passes the format and name on, then closes', async () => {
        const session = fakeSession();
        panel.open(session);
        await tick();
        $('.save-btn').click();
        await tick();
        expect(session.save).toHaveBeenCalledWith('tef', 'tune.tef');
        expect(panel.opened).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('an error from saving stays in the panel', async () => {
        panel.open(fakeSession({ save: async () => ({ error: 'Could not make a .tef file.' }) }));
        await tick();
        $('.save-btn').click();
        await tick();
        expect($('.save-as-error').textContent).toBe('Could not make a .tef file.');
        expect(panel.opened).toBe(true);
    });

    it('Enter in the name saves, Escape closes, and the keys do not reach the editor', async () => {
        const session = fakeSession();
        panel.open(session);
        await tick();
        const outer = vi.fn();
        container.addEventListener('keydown', outer);
        $('.save-as-name').dispatchEvent(keyEvent('Enter'));
        await tick();
        expect(session.save).toHaveBeenCalled();
        panel.open(session);
        panel.element.dispatchEvent(keyEvent('Escape'));
        expect(panel.opened).toBe(false);
        $('.save-as-name')?.dispatchEvent(keyEvent('s'));
        expect(outer).not.toHaveBeenCalled();
    });

    it('an empty name cannot be saved', async () => {
        panel.open(fakeSession());
        await tick();
        $('.save-as-name').value = '  ';
        $('.save-as-name').dispatchEvent(new Event('input'));
        expect($('.save-btn').disabled).toBe(true);
    });
});

describe('the editor: Ctrl/Cmd+S and File ▸ Save as…', () => {
    let container, editor;

    beforeEach(() => {
        document.body.innerHTML = '';
        resetPreset();
        container = document.createElement('div');
        document.body.appendChild(container);
        editor = new OTFEditor({ container, source: { name: 'Sally.otf.json' } });
    });
    afterEach(() => { editor?.destroy(); container.remove(); });

    const panelOf = () => editor.saveAsPopover;

    it('Ctrl+S opens the panel, starting from the opened file\'s format and name', async () => {
        editor.keyboard.handleKeyDown(keyEvent('s', { ctrl: true }));
        expect(panelOf().opened).toBe(true);
        expect(panelOf().format).toBe('otf');
        expect(panelOf().element.querySelector('.save-as-name').value).toBe('Sally.otf.json');
        await tick();
    });

    it('Cmd+S does too', () => {
        editor.keyboard.handleKeyDown(keyEvent('s', { meta: true }));
        expect(panelOf().opened).toBe(true);
    });

    it('a new tab starts at .tef, named after the title', async () => {
        editor.setSource(null);
        editor.openSaveAs();
        expect(panelOf().format).toBe('tef');
        expect(panelOf().element.querySelector('.save-as-name').value).toMatch(/\.tef$/);
        await tick();
    });

    it('the File menu has Save as… (not Download OTF), printing Ctrl+S', () => {
        const labels = editor.menuBar.fileActions.map(a => a.label);
        expect(labels).toContain('💾 Save as…');
        expect(labels.join()).not.toContain('Download');
        expect(editor.menuBar.fileActions.find(a => a.label === '💾 Save as…').action).toBe('edit.save');
    });
});
