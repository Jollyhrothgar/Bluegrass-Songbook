// @vitest-environment jsdom
//
// The bottom band survives edit mode (plan §9.1).
//
// It used to be replaced by an italic notice — "use the editor bar below" —
// which took the reader's size, tempo, transport and metronome away at the
// exact moment they started changing the thing those controls describe, and
// grew a SECOND transport inside the editor's status bar. The band is now
// the same band, re-bound to the live document.
//
// These tests drive the binding against a fake editor: the contract is the
// small surface an OTFEditor exposes (state.facade / state.setTempo /
// renderer.setScale / player / togglePlayback / stop / isPlaying), which is
// exactly what makes the band testable without an audio context.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { bindBandToEditor, DISABLED_REASONS } from '../tab-edit-band.js';

/** The band markup createTablatureControls builds, trimmed to what binds. */
function makeControls() {
    const controls = document.createElement('div');
    controls.className = 'tab-controls';
    controls.innerHTML = `
        <div class="qc-group tab-size-group">
            <button class="tab-size-down qc-btn">−</button>
            <span class="qc-label">Aa</span>
            <button class="tab-size-up qc-btn">+</button>
        </div>
        <div class="qc-group qc-key-group">
            <button class="tab-key-down qc-btn">−</button>
            <div class="pill tab-key-pill"><button class="pill-btn">G</button></div>
            <button class="tab-key-up qc-btn">+</button>
        </div>
        <div class="qc-group tab-tempo-group">
            <button class="tab-tempo-down qc-btn">−</button>
            <span class="qc-label tab-tempo-display">100</span>
            <button class="tab-tempo-up qc-btn">+</button>
        </div>
        <button class="tab-play-btn qc-toggle-btn">▶ Play</button>
        <button class="tab-stop-btn qc-toggle-btn" disabled>⏹ Stop</button>
        <button class="tab-edit-btn qc-toggle-btn">✏️ Edit</button>
        <label class="tab-metronome-toggle">
            <input type="checkbox" class="tab-metronome-checkbox">
        </label>
        <div class="qc-group pill-mode-group tab-repeat-group">
            <button class="pill-mode-btn active" data-val="unrolled">Unrolled</button>
            <button class="pill-mode-btn" data-val="repeats">Repeats</button>
        </div>
        <div class="qc-group pill-mode-group tab-feel-group">
            <button class="pill-mode-btn active" data-val="four">Four feel</button>
            <button class="pill-mode-btn" data-val="two">Two feel</button>
        </div>
        <span class="tab-position"></span>
        <div class="tab-track-mixer">
            <label class="track-toggle">
                <input type="checkbox" class="track-checkbox" data-track-id="banjo" checked>
            </label>
        </div>`;
    document.body.appendChild(controls);
    return controls;
}

/** Minimal stand-in for OTFEditor — the surface the band actually uses. */
function makeEditor(tempo = 100) {
    const listeners = new Map();
    const editor = {
        isPlaying: false,
        otfTempo: tempo,
        scales: [],
        player: { metronomeEnabled: false, onPlaybackEnd: null },
        renderer: { setScale: vi.fn((s) => editor.scales.push(s)) },
        state: {
            get otf() { return { metadata: { tempo: editor.otfTempo } }; },
            setTempo: vi.fn((bpm) => {
                editor.otfTempo = bpm;
                (listeners.get('change') || []).forEach(cb => cb());
            }),
            facade: {
                on: (evt, cb) => {
                    if (!listeners.has(evt)) listeners.set(evt, []);
                    listeners.get(evt).push(cb);
                },
                off: (evt, cb) => {
                    const list = listeners.get(evt) || [];
                    const i = list.indexOf(cb);
                    if (i >= 0) list.splice(i, 1);
                },
                emit: (evt) => (listeners.get(evt) || []).forEach(cb => cb()),
            },
        },
        togglePlayback: vi.fn(async () => {
            editor.isPlaying = !editor.isPlaying;
            if (editor.isPlaying) editor.player.onPlaybackEnd = () => {};
        }),
        stop: vi.fn(() => { editor.isPlaying = false; }),
    };
    return editor;
}

describe('bindBandToEditor', () => {
    let controls, editor, band;

    beforeEach(() => {
        document.body.innerHTML = '';
        controls = makeControls();
        editor = makeEditor();
    });

    it('puts the session buttons where ✏️ Edit was — the band keeps its shape', () => {
        const actions = document.createElement('span');
        actions.className = 'tab-edit-bar';
        actions.textContent = 'Submit correction';
        band = bindBandToEditor(controls, editor, { actions });

        expect(controls.querySelector('.tab-edit-btn')).toBeNull();
        const slot = controls.querySelector('.tab-edit-actions-slot');
        expect(slot).not.toBeNull();
        expect(slot.contains(actions)).toBe(true);
        // …and the other controls are still there, in the same band
        expect(controls.querySelector('.tab-play-btn')).not.toBeNull();
        expect(controls.querySelector('.tab-tempo-display')).not.toBeNull();
    });

    it('sizes the EDITOR\'s renderer, not the read view\'s', () => {
        band = bindBandToEditor(controls, editor);
        controls.querySelector('.tab-size-up').click();
        controls.querySelector('.tab-size-up').click();
        expect(editor.scales).toEqual([1.1, 1.2]);
        controls.querySelector('.tab-size-down').click();
        expect(editor.scales.at(-1)).toBe(1.1);
    });

    it('clamps size the way the read view does', () => {
        band = bindBandToEditor(controls, editor);
        for (let i = 0; i < 12; i++) controls.querySelector('.tab-size-up').click();
        expect(editor.scales.at(-1)).toBe(1.6);
        expect(controls.querySelector('.tab-size-up').disabled).toBe(true);
    });

    it('shows the live document tempo, and writes changes through the facade', () => {
        editor.otfTempo = 132;
        band = bindBandToEditor(controls, editor);
        expect(controls.querySelector('.tab-tempo-display').textContent).toBe('132');

        controls.querySelector('.tab-tempo-up').click();
        expect(editor.state.setTempo).toHaveBeenCalledWith(137);
        expect(controls.querySelector('.tab-tempo-display').textContent).toBe('137');

        controls.querySelector('.tab-tempo-down').click();
        expect(controls.querySelector('.tab-tempo-display').textContent).toBe('132');
    });

    it('follows the document when the tempo changes anywhere else (undo, status bar)', () => {
        band = bindBandToEditor(controls, editor);
        editor.otfTempo = 88;
        editor.state.facade.emit('change');
        expect(controls.querySelector('.tab-tempo-display').textContent).toBe('88');
    });

    it('keeps the tempo inside the range the editor accepts', () => {
        editor.otfTempo = 42;
        band = bindBandToEditor(controls, editor);
        controls.querySelector('.tab-tempo-down').click();
        expect(editor.state.setTempo).toHaveBeenCalledWith(40);
        controls.querySelector('.tab-tempo-down').click();   // already at the floor
        expect(editor.state.setTempo).toHaveBeenCalledTimes(1);
    });

    it('plays the EDITED document — one transport, the editor\'s', async () => {
        band = bindBandToEditor(controls, editor);
        const play = controls.querySelector('.tab-play-btn');
        const stop = controls.querySelector('.tab-stop-btn');

        play.click();
        await vi.waitFor(() => expect(editor.togglePlayback).toHaveBeenCalled());
        await vi.waitFor(() => expect(play.textContent).toBe('⏸ Pause'));
        expect(stop.disabled).toBe(false);

        stop.click();
        expect(editor.stop).toHaveBeenCalled();
        expect(play.textContent).toBe('▶ Play');
        expect(stop.disabled).toBe(true);
    });

    it('resets the button when playback ends on its own', async () => {
        band = bindBandToEditor(controls, editor);
        const play = controls.querySelector('.tab-play-btn');
        play.click();
        await vi.waitFor(() => expect(play.textContent).toBe('⏸ Pause'));

        editor.isPlaying = false;
        editor.player.onPlaybackEnd();      // the band wrapped it
        expect(play.textContent).toBe('▶ Play');
    });

    it('hands the metronome to the editor\'s player', () => {
        band = bindBandToEditor(controls, editor);
        const box = controls.querySelector('.tab-metronome-checkbox');
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        expect(editor.player.metronomeEnabled).toBe(true);
    });

    // A control that VANISHES mid-edit reads as a bug; one that says why it
    // is off reads as an answer. Transpose is the honest example: it would
    // rewrite every fret you just typed.
    it('disables what cannot mean anything mid-edit, with a reason', () => {
        band = bindBandToEditor(controls, editor);

        const keyDown = controls.querySelector('.tab-key-down');
        expect(keyDown.disabled).toBe(true);
        expect(keyDown.title).toBe(DISABLED_REASONS.key);
        expect(controls.querySelector('.tab-key-pill .pill-btn').disabled).toBe(true);

        expect(controls.querySelector('.tab-repeat-group .pill-mode-btn').disabled).toBe(true);
        expect(controls.querySelector('.tab-repeat-group').title)
            .toBe(DISABLED_REASONS.repeats);
        expect(controls.querySelector('.tab-feel-group .pill-mode-btn').disabled).toBe(true);
        expect(controls.querySelector('.track-checkbox').disabled).toBe(true);

        // …but none of them are gone
        expect(controls.querySelector('.qc-key-group')).not.toBeNull();
        expect(controls.querySelector('.tab-track-mixer')).not.toBeNull();
    });

    it('stops following the document once the session is over', () => {
        band = bindBandToEditor(controls, editor);
        band.destroy();
        editor.otfTempo = 200;
        editor.state.facade.emit('change');
        expect(controls.querySelector('.tab-tempo-display').textContent).not.toBe('200');
    });

    it('survives a band with pieces missing (phone sheet, no mixer)', () => {
        const bare = document.createElement('div');
        bare.innerHTML = '<button class="tab-play-btn"></button>';
        document.body.appendChild(bare);
        expect(() => bindBandToEditor(bare, editor)).not.toThrow();
    });
});

// Phones move ✏️ Edit into the ⚙ settings sheet (tab-controls-sheet.js).
// The session's buttons must NOT follow it in there: Submit and Cancel
// behind a disclosure is a button nobody finds.
describe('bindBandToEditor on a phone band', () => {
    it('keeps the action group on the band, not inside the ⚙ sheet', () => {
        const controls = makeControls();
        const sheet = document.createElement('div');
        sheet.className = 'tab-settings-sheet';
        const more = document.createElement('button');
        more.className = 'tab-more-btn';
        controls.append(more, sheet);
        sheet.appendChild(controls.querySelector('.tab-edit-btn'));

        const actions = document.createElement('span');
        actions.className = 'tab-edit-bar';
        bindBandToEditor(controls, makeEditor(), { actions });

        const slot = controls.querySelector('.tab-edit-actions-slot');
        expect(slot.closest('.tab-settings-sheet')).toBeNull();
        expect(slot.parentElement).toBe(controls);
        expect(slot.contains(actions)).toBe(true);
        expect(controls.querySelector('.tab-edit-btn')).toBeNull();
    });
});
