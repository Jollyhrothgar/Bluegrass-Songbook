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
        download: vi.fn(),
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

    it('Cancel with no edits exits without applying', () => {
        start();
        mount.querySelector('.tab-edit-cancel').click();
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

    it('Download delegates to the editor with the session filename', () => {
        start({ filename: '27493-banjo' });
        mount.querySelector('.tab-edit-download').click();
        expect(editor.download).toHaveBeenCalledWith('27493-banjo');
        expect(onExit).not.toHaveBeenCalled(); // stays in the session
    });

    it('editor onSave (Ctrl+S path) applies without exiting', () => {
        start();
        editor.factoryOptions.onSave({ via: 'ctrl-s' });
        expect(onApply).toHaveBeenCalledWith({ via: 'ctrl-s' });
        expect(onExit).not.toHaveBeenCalled();
        expect(mount.querySelector('.tab-edit-bar')).not.toBeNull();
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
        expect(buttons.length).toBeGreaterThan(4);   // actions + submit panel
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

    it('offers extra actions (Import .tef…) alongside the rest', () => {
        const onClick = vi.fn();
        const session = start({
            extraActions: [{ className: 'tab-edit-import', label: '📂 Import .tef…', onClick }],
        });
        const btn = host.querySelector('.tab-edit-import');
        expect(btn.textContent).toBe('📂 Import .tef…');
        btn.click();
        expect(onClick).toHaveBeenCalledWith(session);
    });

    it('replaceDocument swaps what is being edited (a .tef import)', () => {
        const session = start();
        session.replaceDocument({ imported: true });
        expect(editor.load).toHaveBeenCalledWith({ imported: true });
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
