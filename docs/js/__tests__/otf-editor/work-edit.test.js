// Unit tests for the work-view edit session — the glue that mounts the
// OTF editor over a rendered tab, applies edits back to the view, and
// never loses work without asking.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resolveEditTrackId, createTabEditSession } from '../../otf-editor/work-edit.js';

/** 27493-shaped multi-track doc. */
function multiTrackOtf() {
    return {
        otf_version: '1.0',
        metadata: { title: 'Multi', time_signature: '2/2' },
        timing: { ticks_per_beat: 480 },
        tracks: [
            { id: 'guitar', instrument: '6-string-guitar', tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'] },
            { id: 'bass', instrument: 'upright-bass', tuning: ['G2', 'D2', 'A1', 'E1'] },
            { id: 'mandolin', instrument: 'mandolin', tuning: ['E5', 'A4', 'D4', 'G3'] },
            { id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], role: 'lead' },
        ],
        notation: { guitar: [], bass: [], mandolin: [], banjo: [] },
    };
}

/** Minimal fake OTFEditor honoring the surface the session uses. */
function makeFakeEditor(overrides = {}) {
    const editor = {
        savedDoc: { edited: true },
        dirty: false,
        destroyed: false,
        save: vi.fn(function () { return this.savedDoc; }),
        openSaveAs: vi.fn(),
        setSource: vi.fn(),
        load: vi.fn(),
        destroy: vi.fn(function () { this.destroyed = true; }),
        state: { facade: { canUndo: () => editor.dirty } },
        ...overrides,
    };
    return editor;
}

describe('resolveEditTrackId', () => {
    const otf = multiTrackOtf();

    it('matches the part instrument to a track', () => {
        expect(resolveEditTrackId(otf, 'banjo')).toBe('banjo');
        expect(resolveEditTrackId(otf, 'mandolin')).toBe('mandolin');
        expect(resolveEditTrackId(otf, 'bass')).toBe('bass');
        expect(resolveEditTrackId(otf, 'guitar')).toBe('guitar');
    });

    it('falls back to the lead track when instrument is unknown', () => {
        expect(resolveEditTrackId(otf, 'theremin')).toBe('banjo'); // role: lead
    });

    it('falls back to the first track when nothing matches and no lead', () => {
        const noLead = multiTrackOtf();
        noLead.tracks.forEach(t => delete t.role);
        expect(resolveEditTrackId(noLead, null)).toBe('guitar');
    });

    it('handles empty documents', () => {
        expect(resolveEditTrackId({ tracks: [] }, 'banjo')).toBeUndefined();
        expect(resolveEditTrackId(null, 'banjo')).toBeUndefined();
    });
});

/** A File-menu entry by its label, as the editor's menu would run it. */
const fileEntry = (editor, label) =>
    editor.factoryOptions.fileActions.find(a => a.label === label);
const fileLabels = (editor) =>
    editor.factoryOptions.fileActions.map(a => (a.separator ? '—' : a.label));

describe('createTabEditSession', () => {
    let mount, editor, onApply, onExit, session;

    function start(opts = {}) {
        session = createTabEditSession({
            mount,
            otf: multiTrackOtf(),
            trackId: 'banjo',
            editorFactory: (options) => {
                editor.factoryOptions = options;
                return editor;
            },
            onApply,
            onExit,
            confirmDiscard: opts.confirmDiscard,
            filename: opts.filename,
            source: opts.source,
        });
        return session;
    }

    beforeEach(() => {
        mount = document.createElement('div');
        document.body.appendChild(mount);
        editor = makeFakeEditor();
        onApply = vi.fn();
        onExit = vi.fn();
    });

    it('mounts an edit bar and editor host, passing trackId through', () => {
        start();
        expect(mount.querySelector('.tab-edit-bar')).not.toBeNull();
        expect(mount.querySelector('.tab-edit-host')).not.toBeNull();
        expect(editor.factoryOptions.trackId).toBe('banjo');
        expect(editor.factoryOptions.container).toBe(mount.querySelector('.tab-edit-host'));
    });

    it('Done saves BEFORE destroying, applies, and exits', () => {
        start();
        let savedAtDestroy = null;
        editor.destroy.mockImplementation(() => { savedAtDestroy = editor.save.mock.calls.length; });
        mount.querySelector('.tab-edit-done').click();
        expect(editor.save).toHaveBeenCalled();
        expect(savedAtDestroy).toBeGreaterThan(0); // save happened first
        expect(onApply).toHaveBeenCalledWith({ edited: true });
        expect(onExit).toHaveBeenCalledWith('apply');
        expect(mount.querySelector('.tab-edit-bar')).toBeNull(); // unmounted
    });

    it('Cancel (File ▸ Cancel) with no edits exits without applying', () => {
        start();
        fileEntry(editor, 'Cancel').run();
        expect(onApply).not.toHaveBeenCalled();
        expect(onExit).toHaveBeenCalledWith('cancel');
        expect(editor.destroy).toHaveBeenCalled();
    });

    it('Cancel with edits asks before discarding; declining keeps the session', () => {
        const confirmDiscard = vi.fn(() => false);
        start({ confirmDiscard });
        editor.dirty = true;
        expect(session.cancel()).toBe(false);
        expect(confirmDiscard).toHaveBeenCalled();
        expect(onExit).not.toHaveBeenCalled();
        expect(mount.querySelector('.tab-edit-bar')).not.toBeNull(); // still mounted

        confirmDiscard.mockReturnValue(true);
        expect(session.cancel()).toBe(true);
        expect(onExit).toHaveBeenCalledWith('cancel');
    });

    // The DEFAULT ask (no confirmDiscard injected) is an inline strip in
    // the bar, not window.confirm — see no-native-dialogs.test.js for why.
    it('Cancel with edits draws an inline confirm, not a native dialog', () => {
        const nativeConfirm = vi.spyOn(globalThis, 'confirm');
        start();
        editor.dirty = true;

        expect(session.cancel()).toBe(false);          // asked, did not exit
        expect(nativeConfirm).not.toHaveBeenCalled();
        expect(onExit).not.toHaveBeenCalled();

        const ask = mount.querySelector('.tab-edit-discard-confirm');
        expect(ask).not.toBeNull();
        expect(ask.textContent).toContain('Discard edits?');
        nativeConfirm.mockRestore();
    });

    it('“Keep editing” takes the question down and stays in the session', () => {
        start();
        editor.dirty = true;
        session.cancel();

        mount.querySelector('.tab-edit-discard-no').click();
        expect(mount.querySelector('.tab-edit-discard-confirm')).toBeNull();
        expect(onExit).not.toHaveBeenCalled();
        expect(mount.querySelector('.tab-edit-bar')).not.toBeNull();
    });

    it('“Discard” exits exactly as an accepted confirm did', () => {
        start();
        editor.dirty = true;
        session.cancel();

        mount.querySelector('.tab-edit-discard-yes').click();
        expect(onExit).toHaveBeenCalledWith('cancel');
        expect(mount.querySelector('.tab-edit-bar')).toBeNull();
    });

    it('a second Cancel re-uses the standing question instead of stacking', () => {
        start();
        editor.dirty = true;
        session.cancel();
        session.cancel();
        expect(mount.querySelectorAll('.tab-edit-discard-confirm').length).toBe(1);
    });

    it('a clean session cancels with no question at all', () => {
        start();
        editor.dirty = false;
        expect(session.cancel()).toBe(true);
        expect(mount.querySelector('.tab-edit-discard-confirm')).toBeNull();
        expect(onExit).toHaveBeenCalledWith('cancel');
    });

    it('File ▸ Save as… opens the editor\'s panel and stays in the session', () => {
        start({ filename: '27493-banjo' });
        expect(mount.querySelector('.tab-edit-download')).toBeNull();   // not a bar button
        fileEntry(editor, '💾 Save as…').run();
        expect(editor.openSaveAs).toHaveBeenCalled();
        expect(onExit).not.toHaveBeenCalled(); // stays in the session
    });

    it('the editor gets the file name and the source, and Ctrl+S no longer applies (G15f)', () => {
        const source = { name: 'Sally.tef', bytes: new ArrayBuffer(4) };
        start({ filename: '27493-banjo', source });
        expect(editor.factoryOptions.filename).toBe('27493-banjo');
        expect(editor.factoryOptions.source).toBe(source);
        // Ctrl+S is Save as…; the one way to apply edits to the view is ✓ Done
        expect(editor.factoryOptions.onSave).toBeUndefined();
        expect(onApply).not.toHaveBeenCalled();
    });

    it('Submit panel requires a comment and calls onSubmit with the doc', async () => {
        const onSubmit = vi.fn(async () => ({
            id: 'gold-rush', workId: 'gold-rush', live: true, synced: true,
        }));
        session = createTabEditSession({
            mount, otf: multiTrackOtf(), trackId: 'banjo',
            editorFactory: (options) => { editor.factoryOptions = options; return editor; },
            onApply, onExit, onSubmit,
        });
        mount.querySelector('.tab-edit-submit').click();
        const panel = mount.querySelector('.tab-edit-submit-panel');
        expect(panel.style.display).toBe('flex');

        panel.querySelector('.tab-edit-submit-send').click();
        await Promise.resolve();
        expect(onSubmit).not.toHaveBeenCalled(); // empty comment refused

        panel.querySelector('.tab-edit-submit-comment').value = 'fixed the B part';
        panel.querySelector('.tab-edit-submit-send').click();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(onSubmit).toHaveBeenCalledWith({ edited: true }, 'fixed the B part');
        // No review, no PR link: the correction is live the moment it
        // resolves, and the panel says exactly that.
        await vi.waitFor(() => {
            const status = panel.querySelector('.tab-edit-submit-status');
            expect(status.textContent).toMatch(/live on this tab now/);
            expect(status.querySelector('a')).toBeNull();
        });
    });

    it('a durable-write failure reads as "live, syncing" — not as a failure', async () => {
        const onSubmit = vi.fn(async () => ({
            id: 'gold-rush', live: true, synced: false,
            syncError: 'auto-commit-song returned 429',
        }));
        session = createTabEditSession({
            mount, otf: multiTrackOtf(), trackId: 'banjo',
            editorFactory: (options) => { editor.factoryOptions = options; return editor; },
            onApply, onExit, onSubmit,
        });
        mount.querySelector('.tab-edit-submit').click();
        const panel = mount.querySelector('.tab-edit-submit-panel');
        panel.querySelector('.tab-edit-submit-comment').value = 'x';
        panel.querySelector('.tab-edit-submit-send').click();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
        await vi.waitFor(() => {
            const status = panel.querySelector('.tab-edit-submit-status');
            expect(status.textContent).toMatch(/live/i);
            expect(status.textContent).toMatch(/syncing/i);
            expect(status.textContent).not.toMatch(/failed/i);
        });
    });

    it('a rejected submission still reports the failure', async () => {
        const onSubmit = vi.fn(async () => { throw new Error('Sign in to submit'); });
        session = createTabEditSession({
            mount, otf: multiTrackOtf(), trackId: 'banjo',
            editorFactory: (options) => { editor.factoryOptions = options; return editor; },
            onApply, onExit, onSubmit,
        });
        mount.querySelector('.tab-edit-submit').click();
        const panel = mount.querySelector('.tab-edit-submit-panel');
        panel.querySelector('.tab-edit-submit-comment').value = 'x';
        panel.querySelector('.tab-edit-submit-send').click();
        await vi.waitFor(() => {
            expect(panel.querySelector('.tab-edit-submit-status').textContent)
                .toMatch(/Failed: Sign in to submit/);
        });
    });

    it('a hostile track id renders as text, not markup', () => {
        const otf = multiTrackOtf();
        const evil = '<img src=x onerror="window.__pwned=1">';
        otf.tracks[0].id = evil;
        otf.notation[evil] = otf.notation.banjo;
        session = createTabEditSession({
            mount, otf, trackId: evil,
            editorFactory: (options) => { editor.factoryOptions = options; return editor; },
            onApply, onExit,
        });
        expect(mount.querySelector('.tab-edit-title img')).toBeNull();
        expect(mount.querySelector('.tab-edit-title').textContent).toContain(evil);
    });

    it('no Submit button without an onSubmit handler', () => {
        start();
        expect(mount.querySelector('.tab-edit-submit')).toBeNull();
    });

    it('destroy is idempotent', () => {
        start();
        session.destroy();
        session.destroy();
        expect(editor.destroy).toHaveBeenCalledTimes(1);
        expect(onExit).not.toHaveBeenCalled();
    });

    // jsdom computes no layout, so this guards the CLASS CONTRACT that the
    // layout depends on rather than the pixels. `.qc-btn` is the site's
    // 32x32 icon shell (a hard width, used everywhere else for −/+ only):
    // put a word in one and the label can't shrink past its min-content, so
    // it wraps and spills out of the box — which is how these four buttons
    // came to be drawn on top of each other over the toolbar. Labelled
    // buttons take `.qc-toggle-btn`, which is padded and auto-width.
    it('labelled buttons never wear the icon-only qc-btn shell', () => {
        session = createTabEditSession({
            mount, otf: multiTrackOtf(), trackId: 'banjo',
            editorFactory: (options) => { editor.factoryOptions = options; return editor; },
            onApply, onExit, onSubmit: vi.fn(),
        });
        const buttons = [...mount.querySelectorAll('button')];
        expect(buttons.length).toBeGreaterThan(3);   // Submit, Done + submit panel
        for (const btn of buttons) {
            // A label is anything past a lone glyph — every button here has one.
            expect(btn.textContent.trim().length).toBeGreaterThan(1);
            expect([...btn.classList]).not.toContain('qc-btn');
        }
    });
});

// ── The session's buttons live in the BOTTOM BAND (plan §9.1) ────────────
//
// Edit mode used to draw its own header above the canvas — a second title
// row on a page that already had one — and replace the band underneath with
// a notice. With `barHost` the same buttons are handed to the band instead,
// so the page keeps exactly one set of chrome whether you are reading or
// writing.
describe('createTabEditSession in the bottom band', () => {
    let mount, host, editor, onApply, onExit;

    function start(opts = {}) {
        return createTabEditSession({
            mount,
            otf: multiTrackOtf(),
            trackId: 'banjo',
            editorFactory: (options) => { editor.factoryOptions = options; return editor; },
            onApply,
            onExit,
            barHost: host,
            ...opts,
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        mount = document.createElement('div');
        host = document.createElement('div');
        document.body.append(mount, host);
        editor = makeFakeEditor();
        onApply = vi.fn();
        onExit = vi.fn();
    });

    it('puts the action bar in the host, and only the canvas in the page', () => {
        start();
        expect(host.querySelector('.tab-edit-bar')).not.toBeNull();
        expect(mount.querySelector('.tab-edit-bar')).toBeNull();
        expect(mount.querySelector('.tab-edit-host')).not.toBeNull();
        // No second title: the page's own take header already says what
        // this is, so the compact bar doesn't repeat it.
        expect(host.querySelector('.tab-edit-title')).toBeNull();
    });

    it('takes the bar (and its panel) with it when the session ends', () => {
        const session = start({ onSubmit: vi.fn() });
        expect(host.querySelector('.tab-edit-bar')).not.toBeNull();
        session.destroy();
        expect(host.querySelector('.tab-edit-bar')).toBeNull();
        expect(host.querySelector('.tab-edit-submit-panel')).toBeNull();
        expect(mount.querySelector('.tab-edit-host')).toBeNull();
    });

    it('a NEW take submits on the click — there is nothing to describe', async () => {
        const onSubmit = vi.fn(async () => ({ workId: 'gold-rush', synced: true }));
        const onSubmitted = vi.fn();
        start({
            onSubmit, onSubmitted,
            submitLabel: '🚀 Submit tab',
            showDone: false,
            commentRequired: false,
        });

        const submit = host.querySelector('.tab-edit-submit');
        expect(submit.textContent).toBe('🚀 Submit tab');
        // No comment panel at all, and no ✓ Done: a take that does not
        // exist yet has nothing to apply back to the page.
        expect(host.querySelector('.tab-edit-submit-panel')).toBeNull();
        expect(host.querySelector('.tab-edit-done')).toBeNull();

        submit.click();
        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ edited: true }, ''));
        await vi.waitFor(() => {
            expect(host.querySelector('.tab-edit-status').textContent)
                .toMatch(/live on this song now/);
        });
        // the caller gets the result AND the document that was submitted,
        // so it can show that document as the take's pending state
        expect(onSubmitted).toHaveBeenCalledWith(
            { workId: 'gold-rush', synced: true }, { edited: true });
    });

    it('a durable-write failure on a new take still reads as live', async () => {
        const onSubmit = vi.fn(async () => ({ synced: false }));
        start({ onSubmit, commentRequired: false, showDone: false });
        host.querySelector('.tab-edit-submit').click();
        await vi.waitFor(() => {
            const text = host.querySelector('.tab-edit-status').textContent;
            expect(text).toMatch(/live/i);
            expect(text).not.toMatch(/failed/i);
        });
    });

    it('a refused submission says so and lets you try again', async () => {
        const onSubmit = vi.fn(async () => { throw new Error('Sign in to submit'); });
        start({ onSubmit, commentRequired: false, showDone: false });
        const submit = host.querySelector('.tab-edit-submit');
        submit.click();
        await vi.waitFor(() => {
            expect(host.querySelector('.tab-edit-status').textContent)
                .toMatch(/Failed: Sign in to submit/);
        });
        expect(submit.disabled).toBe(false);
    });

    it('reports a correction back to the caller too', async () => {
        const onSubmit = vi.fn(async () => ({ synced: true }));
        const onSubmitted = vi.fn();
        start({ onSubmit, onSubmitted });
        host.querySelector('.tab-edit-submit').click();
        const panel = host.querySelector('.tab-edit-submit-panel');
        panel.querySelector('.tab-edit-submit-comment').value = 'fixed bar 12';
        panel.querySelector('.tab-edit-submit-send').click();
        await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    });

    it('offers extra actions (Import .tef…) in the File menu, not on the bar', () => {
        const onClick = vi.fn();
        const session = start({
            extraActions: [{ label: '📂 Import .tef…', onClick }],
        });
        expect(host.querySelector('.tab-edit-import')).toBeNull();
        expect([...host.querySelectorAll('button')].map(b => b.textContent))
            .not.toContain('📂 Import .tef…');
        fileEntry(editor, '📂 Import .tef…').run();
        expect(onClick).toHaveBeenCalledWith(session);
    });

    it('File order with Import .tef…: Open…, Import, Save as…, rule, Submit, Cancel', () => {
        start({
            onSubmit: async () => ({}), showDone: false, submitLabel: '🚀 Submit tab',
            extraActions: [{ label: '📂 Import .tef…', onClick: () => {} }],
        });
        expect(fileLabels(editor)).toEqual([
            '📂 Open…', '📂 Import .tef…', '💾 Save as…', '—', '🚀 Submit tab', 'Cancel']);
    });

    it('the bar holds Submit and Done only (G17); the rest is File menu', () => {
        start({ onSubmit: vi.fn(), showDone: true });
        const bar = host.querySelector('.tab-edit-bar');
        const labels = [...bar.querySelectorAll('button')].map(b => b.className.split(' ')[0]);
        expect(labels).toEqual(['tab-edit-submit', 'tab-edit-done']);
    });

    it('a new take (no Done) has Submit alone on the bar', () => {
        start({ onSubmit: vi.fn(), showDone: false });
        expect([...host.querySelectorAll('.tab-edit-bar button')]
            .map(b => b.className.split(' ')[0])).toEqual(['tab-edit-submit']);
    });

    it('Cancel from the File menu asks inline, in the bar (never window.confirm)', () => {
        const confirm = vi.spyOn(window, 'confirm');
        const session = start({ onSubmit: vi.fn() });
        editor.dirty = true;
        fileEntry(editor, 'Cancel').run();
        expect(confirm).not.toHaveBeenCalled();
        const ask = host.querySelector('.tab-edit-bar .tab-edit-discard-confirm');
        expect(ask).not.toBeNull();
        expect(ask.textContent).toContain('Discard edits?');
        expect(onExit).not.toHaveBeenCalled();
        ask.querySelector('.tab-edit-discard-yes').click();
        expect(onExit).toHaveBeenCalledWith('cancel');
        confirm.mockRestore();
        expect(session).toBeTruthy();
    });

    it('File ▸ Save as… prints Ctrl+S, which opens the same panel', () => {
        start();
        expect(fileEntry(editor, '💾 Save as…').action).toBe('edit.save');
    });

    it('replaceDocument swaps what is being edited (a .tef import)', () => {
        const session = start();
        const source = { name: 'Sally.tef', bytes: new ArrayBuffer(1) };
        session.replaceDocument({ imported: true }, source);
        expect(editor.setSource).toHaveBeenCalledWith(source);
        expect(editor.load).toHaveBeenCalledWith({ imported: true });
    });

    it('File ▸ Open… is first in the menu, and hands the session to onOpenFile', () => {
        const onOpenFile = vi.fn();
        const session = start({ onOpenFile });
        const labels = editor.factoryOptions.fileActions.map(a => a.label);
        expect(labels[0]).toBe('📂 Open…');
        expect(fileLabels(editor)).toEqual(['📂 Open…', '💾 Save as…', '—', 'Cancel', '✓ Done']);
        editor.factoryOptions.fileActions[0].run();
        expect(onOpenFile).toHaveBeenCalledWith(session);
    });

    it('File ▸ Open… is there in a new take (with Submit) and a correction alike', () => {
        start({ onSubmit: async () => ({}), showDone: false });
        const labels = editor.factoryOptions.fileActions.map(a => a.label);
        expect(fileLabels(editor))
            .toEqual(['📂 Open…', '💾 Save as…', '—', '🚀 Submit correction', 'Cancel']);
    });

    it('passes onChange through to the editor (drafts survive a reload)', () => {
        const onChange = vi.fn();
        start({ onChange });
        editor.factoryOptions.onChange({ doc: 1 });
        expect(onChange).toHaveBeenCalledWith({ doc: 1 });
    });

    it('does not pass an onChange the caller did not ask for', () => {
        start();
        expect('onChange' in editor.factoryOptions).toBe(false);
    });
});
