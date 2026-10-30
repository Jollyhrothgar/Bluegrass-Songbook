// The bottom band, while you are EDITING a tab (plan §9.1).
//
// Edit mode used to replace the band with an italic notice and let the
// editor grow a second transport in its own status bar — three playback
// controls for one document, and a page whose bottom half changed shape
// the moment you pressed ✏️ Edit. The band is now the same band: the
// controls it already has (tempo, ▶/⏹, metronome) are re-bound to
// the LIVE editor document, the session's buttons sit after Stop, and the controls that cannot mean anything
// mid-edit are DISABLED with a reason rather than removed — a control
// that vanishes reads as a bug; a control that says why it is off reads
// as an answer.
//
// Deliberately DOM-only and injection-free: it takes the controls element
// `createTablatureControls` built and any object with the editor's small
// surface (`state.facade`, `state.setTempo`, `player`, `togglePlayback`, `stop`, `isPlaying`), so it can be driven
// in jsdom without an editor, a renderer or an audio context.

/** Why a given control is off while editing. One sentence, no jargon. */
export const DISABLED_REASONS = {
    key: 'Transpose is off while editing — it would rewrite every fret you just typed.',
    repeats: 'The editor always shows written measures, repeat signs and all.',
    feel: 'Feel is a reading choice; while editing, the tab plays as written.',
    tracks: 'While editing, playback follows the document — every track sounds.',
};

/** Disable a control and say why (on the control AND its group wrapper). */
function disableWithReason(el, reason) {
    if (!el) return;
    el.disabled = true;
    el.title = reason;
    el.classList.add('is-edit-disabled');
}

function disableGroup(root, selector, reason) {
    const group = root.querySelector(selector);
    if (!group) return;
    group.title = reason;
    group.classList.add('is-edit-disabled');
    group.querySelectorAll('button, input').forEach(el => disableWithReason(el, reason));
}

/**
 * Re-bind an existing tab-controls band to a live editor.
 *
 * @param {HTMLElement} controls - the element createTablatureControls built
 * @param {Object} editor - an OTFEditor (or anything with its surface)
 * @param {Object} [options]
 * @param {HTMLElement} [options.actions] - element to drop after Stop
 *   (the session's Submit and Done group)
 * @returns {{destroy: Function, refresh: Function, actionSlot: HTMLElement}}
 */
export function bindBandToEditor(controls, editor, { actions = null } = {}) {
    // ── The session's buttons join the band ───────────────────────────
    //
    // …at BAND level, even on a phone, right after Stop (which stays on the
    // phone band; `tab-controls-sheet.js` moves the rest into the ⚙ sheet
    // below 640px, and Submit / Cancel / Done buried behind a disclosure is
    // not a thing anyone would find). Edit itself is the top band's, and is
    // hidden while the editor is open.
    const slot = document.createElement('span');
    slot.className = 'tab-edit-actions-slot';
    const afterStop = controls.querySelector('.tab-stop-btn');
    if (afterStop && !afterStop.closest('.tab-settings-sheet')) afterStop.after(slot);
    else controls.appendChild(slot);
    if (actions) slot.appendChild(actions);

    // ── Size: gone while editing (G17) ────────────────────────────────
    // The editor has ONE zoom: its status bar's − 100% + (also View ▸ Zoom
    // and `{` `}`). The band's Aa size is a second, reader-side zoom with
    // no menu item and no key; two sizes for one canvas was a duplicate.
    controls.querySelector('.tab-size-group')?.remove();

    // ── Tempo: the DOCUMENT's tempo, through the facade ───────────────
    // Editing is the one place where "the tempo" is not a practice
    // override but the thing being authored, so the band writes it to the
    // document (undoable, like every other edit) instead of keeping a
    // private number the submission would never carry.
    const tempoDisplay = controls.querySelector('.tab-tempo-display');
    const tempoDown = controls.querySelector('.tab-tempo-down');
    const tempoUp = controls.querySelector('.tab-tempo-up');
    const docTempo = () => Number(editor.state?.otf?.metadata?.tempo) || 120;
    const showTempo = () => {
        if (tempoDisplay) tempoDisplay.textContent = String(docTempo());
        if (tempoDown) tempoDown.disabled = docTempo() <= 40;
        if (tempoUp) tempoUp.disabled = docTempo() >= 280;
    };
    const stepTempo = (delta) => {
        const next = Math.max(40, Math.min(280, docTempo() + delta));
        if (next === docTempo()) return;
        editor.state?.setTempo?.(next);
        showTempo();
    };
    tempoDown?.addEventListener('click', () => stepTempo(-5));
    tempoUp?.addEventListener('click', () => stepTempo(5));

    // ── Transport: the editor owns the player, so drive that one ──────
    const playBtn = controls.querySelector('.tab-play-btn');
    const stopBtn = controls.querySelector('.tab-stop-btn');
    const posEl = controls.querySelector('.tab-position');
    const syncTransport = () => {
        if (!playBtn) return;
        playBtn.textContent = editor.isPlaying ? '⏸ Pause' : '▶ Play';
        playBtn.classList.toggle('playing', !!editor.isPlaying);
        if (stopBtn) stopBtn.disabled = !editor.isPlaying;
        if (posEl && !editor.isPlaying) posEl.textContent = '';
    };
    // editor.play() reassigns player.onPlaybackEnd on every start, so the
    // band re-wraps it after a start (and only after a start — wrapping on
    // the stop half of the toggle would stack layers on one callback).
    const wrapEnd = () => {
        const player = editor.player;
        if (!player) return;
        const prev = player.onPlaybackEnd;
        player.onPlaybackEnd = (...args) => {
            prev?.(...args);
            syncTransport();
        };
    };
    playBtn?.addEventListener('click', async () => {
        await editor.togglePlayback?.();
        if (editor.isPlaying) wrapEnd();
        syncTransport();
    });
    stopBtn?.addEventListener('click', () => {
        editor.stop?.();
        syncTransport();
    });

    const metronome = controls.querySelector('.tab-metronome-checkbox');
    metronome?.addEventListener('change', () => {
        if (editor.player) editor.player.metronomeEnabled = metronome.checked;
    });

    // ── What cannot mean anything mid-edit ────────────────────────────
    disableGroup(controls, '.qc-key-group', DISABLED_REASONS.key);
    controls.querySelectorAll('.tab-key-pill .pill-btn')
        .forEach(btn => disableWithReason(btn, DISABLED_REASONS.key));
    disableGroup(controls, '.tab-repeat-group', DISABLED_REASONS.repeats);
    disableGroup(controls, '.tab-feel-group', DISABLED_REASONS.feel);
    disableGroup(controls, '.tab-track-mixer', DISABLED_REASONS.tracks);

    // ── Follow the live document ──────────────────────────────────────
    const facade = editor.state?.facade;
    const onChange = () => showTempo();
    facade?.on?.('change', onChange);

    showTempo();
    syncTransport();

    return {
        actionSlot: slot,
        refresh: showTempo,
        destroy() {
            facade?.off?.('change', onChange);
        },
    };
}
