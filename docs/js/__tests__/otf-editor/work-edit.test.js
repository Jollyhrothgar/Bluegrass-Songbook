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
            prNumber: 9,
            prUrl: 'https://github.com/x/y/pull/9',
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
        await vi.waitFor(() => {
            expect(panel.querySelector('.tab-edit-submit-status').textContent)
                .toContain('#9');
        });
    });

    it('a non-GitHub prUrl never lands in the link href', async () => {
        const onSubmit = vi.fn(async () => ({
            prNumber: 1,
            prUrl: 'javascript:alert(1)//github.com',
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
            expect(status.textContent).toContain('Submitted');
            expect(status.querySelector('a')).toBeNull();
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
});
