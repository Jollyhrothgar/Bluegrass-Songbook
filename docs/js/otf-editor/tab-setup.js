// Score ▸ Tab setup… (G20b): one panel for what a tab IS rather than what is
// written on it. Whole tab: title, composer, key, time signature, tempo.
// Current track: instrument, tuning and capo.
//
// The rules are the facade's (`applyTabSetup`: one undo step, a refusal is a
// sentence and changes nothing). This file is the form and the vocabulary it
// offers: the tuning presets per instrument, and reading a typed pitch.
//
// An in-page panel (a bottom sheet at <= PHONE_MAX_WIDTH), never a native
// dialog; sibling of SaveAsPopover in popover.js.

import { INSTRUMENT_CONFIGS } from './new-otf.js';
import { pitchToMidi } from './pitch.js';
import { PHONE_MAX_WIDTH } from './toolbar.js';
import { escapeAttr, escapeHtml } from '../utils.js';

/** What the panel calls each instrument the editor can build. */
export const INSTRUMENT_LABELS = {
    '5-string-banjo': 'Banjo (5-string)',
    'tenor-banjo': 'Tenor banjo',
    'mandolin': 'Mandolin',
    '6-string-guitar': 'Guitar',
    'dobro': 'Dobro',
    'upright-bass': 'Bass',
};

/** The time signatures the panel offers (the front door and `#new-tab` take the same). */
export const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '2/2', '6/8'];

export const TEMPO_MIN = 40;
export const TEMPO_MAX = 280;
export const CAPO_MAX = 12;
const KEYS = ['G', 'A', 'C', 'D', 'E', 'F', 'B', 'Am', 'Em', 'Dm', 'Bm', 'Gm'];

// What a .tef can hold for a string (tef-export/writer.js): MIDI 6 to 90.
const LOWEST_MIDI = 12;   // C0, the lowest name pitch.js knows
const HIGHEST_MIDI = 90;  // F#6

/**
 * The named tunings of each instrument, string 1 first. A preset's NAME is one
 * the renderer already prints (`BANJO_TUNINGS` and the other two in
 * renderers/tablature.js; a test pins that every name here is one of theirs).
 * The first entry is the instrument's standard (new-otf.js), and is what you
 * get when you pick the instrument.
 *
 * The renderer names a tuning from its note LETTERS only, and for banjo "Open
 * D", "C Tuning" and "Open A", and mandolin "DADA", its letters are not the
 * tunings players mean by those names. These are the real tunings, so the
 * stave header prints their notes rather than the name.
 */
export const TUNING_PRESETS = {
    '5-string-banjo': [
        ['Open G', INSTRUMENT_CONFIGS['5-string-banjo'].tuning],
        ['Double C', ['D4', 'C4', 'G3', 'C3', 'G4']],
        ['G Modal', ['D4', 'C4', 'G3', 'D3', 'G4']],
        ['Open D', ['D4', 'A3', 'F#3', 'D3', 'F#4']],
        ['C Tuning', ['E4', 'C4', 'G3', 'C3', 'G4']],
        ['Open A', ['E4', 'C#4', 'A3', 'E3', 'A4']],
    ],
    'tenor-banjo': [['Standard', INSTRUMENT_CONFIGS['tenor-banjo'].tuning]],
    'mandolin': [
        ['Standard', INSTRUMENT_CONFIGS.mandolin.tuning],
        ['Cross-key', ['D5', 'A4', 'D4', 'G3']],
        ['DADA', ['D5', 'A4', 'D4', 'A3']],
    ],
    '6-string-guitar': [
        ['Standard', INSTRUMENT_CONFIGS['6-string-guitar'].tuning],
        ['Drop D', ['E4', 'B3', 'G3', 'D3', 'A2', 'D2']],
        ['Open G', ['D4', 'B3', 'G3', 'D3', 'G2', 'D2']],
        ['Open D', ['D4', 'A3', 'F#3', 'D3', 'A2', 'D2']],
    ],
    'dobro': [['Open G', INSTRUMENT_CONFIGS.dobro.tuning]],
    'upright-bass': [['Standard', INSTRUMENT_CONFIGS['upright-bass'].tuning]],
};

export const CUSTOM = 'custom';

/** The presets for an instrument ([] for one the editor has no names for). */
export function presetsFor(instrument) {
    return (TUNING_PRESETS[instrument] || []).map(([name, pitches]) => ({ name, pitches: [...pitches] }));
}

/** The preset a tuning is, or null (it is Custom). */
export function presetNameFor(instrument, tuning) {
    const same = (a, b) => a.length === b.length && a.every((p, i) => p === b[i]);
    return presetsFor(instrument).find(p => same(p.pitches, tuning || []))?.name ?? null;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * A typed pitch as the file spells it: "g3" is "G3", "Bb3" is "A#3". Null for
 * anything that is not a letter, an optional sharp or flat and an octave 0 to 8.
 */
export function parsePitch(text) {
    const m = /^([A-Ga-g])([#b♯♭]?)(\d)$/.exec(String(text ?? '').trim());
    if (!m) return null;
    const accidental = m[2] === '' ? 0 : '#♯'.includes(m[2]) ? 1 : -1;
    const midi = 12 + Number(m[3]) * 12 + LETTER_SEMITONE[m[1].toUpperCase()] + accidental;
    const name = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    return pitchToMidi(name) === null ? null : name;
}

/**
 * Read the pitch boxes. `{pitches}`, or `{error}` naming the first box that is
 * not a note this tab can hold.
 */
export function parseTuning(texts) {
    const pitches = [];
    for (let i = 0; i < texts.length; i++) {
        const name = parsePitch(texts[i]);
        if (!name) {
            return { error: `String ${i + 1}: "${String(texts[i]).trim()}" is not a note. `
                + 'Use a note name and octave, like G3 or F#4.' };
        }
        const midi = pitchToMidi(name);
        if (midi < LOWEST_MIDI || midi > HIGHEST_MIDI) {
            return { error: `String ${i + 1}: ${name} is out of range. Use a note from C0 to F#6.` };
        }
        pitches.push(name);
    }
    return { pitches };
}

/**
 * The form's values → a `setup` for `applyTabSetup`, or `{error}`.
 * @param {Object} v - raw strings from the form
 */
export function readSetup(v, { percussion = false } = {}) {
    const tempo = String(v.tempo ?? '').trim();
    if (!/^\d+$/.test(tempo) || Number(tempo) < TEMPO_MIN || Number(tempo) > TEMPO_MAX) {
        return { error: `The tempo is a whole number from ${TEMPO_MIN} to ${TEMPO_MAX}.` };
    }
    const setup = {
        title: v.title, composer: v.composer, key: v.key,
        timeSignature: v.timeSignature, tempo: Number(tempo),
    };
    if (percussion) return { setup };
    const capo = String(v.capo ?? '').trim();
    if (!/^\d+$/.test(capo) || Number(capo) > CAPO_MAX) {
        return { error: `The capo is a whole number from 0 to ${CAPO_MAX}.` };
    }
    const tuning = parseTuning(v.pitches);
    if (tuning.error) return { error: tuning.error };
    setup.track = { instrument: v.instrument, tuning: tuning.pitches, capo: Number(capo) };
    return { setup };
}

const CSS = `
    .otf-tab-setup-popover { min-width: 360px; max-width: 480px; max-height: 90vh; overflow-y: auto; }
    .otf-tab-setup-popover fieldset { border: 0; margin: 0 0 14px; padding: 0; }
    .otf-tab-setup-popover legend { font-weight: 600; font-size: 14px; padding: 0; margin-bottom: 8px; }
    .otf-tab-setup-popover .tab-setup-row { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
    .otf-tab-setup-popover .tab-setup-row > span { font-size: 12px; color: var(--text-muted, #666); }
    .otf-tab-setup-popover .tab-setup-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .otf-tab-setup-popover input, .otf-tab-setup-popover select {
        box-sizing: border-box; width: 100%; padding: 8px 10px; font-size: 16px;
        border: 2px solid var(--border, #ddd); border-radius: 8px;
        background: var(--bg, #fff); color: var(--text, #333);
    }
    .otf-tab-setup-popover input:focus, .otf-tab-setup-popover select:focus {
        outline: none; border-color: var(--accent, #007bff);
    }
    .otf-tab-setup-popover .tab-setup-strings { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .otf-tab-setup-popover .tab-setup-string { width: 64px; display: flex; flex-direction: column; gap: 3px; }
    .otf-tab-setup-popover .tab-setup-string span { font-size: 11px; color: var(--text-muted, #666); }
    .otf-tab-setup-popover .tab-setup-string input { text-align: center; padding: 8px 4px; }
    .otf-tab-setup-popover .tab-setup-note { font-size: 12px; color: var(--text-muted, #666); margin: 6px 0 0; }
    .otf-tab-setup-popover .tab-setup-error { font-size: 13px; color: var(--danger, #dc3545); min-height: 1em; }
    @media (max-width: ${PHONE_MAX_WIDTH}px) {
        .otf-tab-setup-overlay { align-items: flex-end; }
        .otf-tab-setup-popover {
            min-width: 0; width: 100%; max-width: none; border-radius: 14px 14px 0 0;
        }
        .otf-tab-setup-popover .popover-btn { min-height: 44px; }
    }
`;

export class TabSetupPopover {
    constructor(options = {}) {
        this.options = { onClose: null, ...options };   // after Cancel, Escape or an Apply that worked
        this.element = null;
        this.overlay = null;
        this.isOpen = false;
        this.session = null;
        this._onDocKey = (e) => {
            if (e.key === 'Escape' && this.isOpen) { e.preventDefault(); e.stopPropagation(); this.close(); }
        };
    }

    init(container) {
        if (!document.querySelector('style[data-otf-tab-setup]')) {
            const style = document.createElement('style');
            style.setAttribute('data-otf-tab-setup', '');
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        this.overlay = document.createElement('div');
        this.overlay.className = 'otf-popover-overlay otf-tab-setup-overlay';
        this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
        this.element = document.createElement('div');
        this.element.className = 'otf-note-popover otf-tab-setup-popover';
        this.element.setAttribute('role', 'dialog');
        this.element.setAttribute('aria-label', 'Tab setup');
        this.overlay.appendChild(this.element);
        container.appendChild(this.overlay);
        this.overlay.style.display = 'none';
    }

    /**
     * @param {Object} session
     * @param {{title: string, composer: string, key: string, timeSignature: string,
     *   tempo: number, changes: number[]}} session.meta - `changes`: the measures
     *   that carry a time signature of their own
     * @param {{id: string, instrument: string, tuning: string[], capo: number,
     *   percussion: boolean, noteCount: number}} session.track - the current track
     * @param {Function} session.apply - (setup) => {error?: string}
     */
    open(session) {
        this.session = session;
        const { meta, track } = session;
        const signatures = TIME_SIGNATURES.includes(meta.timeSignature)
            ? TIME_SIGNATURES : [meta.timeSignature, ...TIME_SIGNATURES];
        const instruments = Object.keys(INSTRUMENT_LABELS).includes(track.instrument)
            ? Object.keys(INSTRUMENT_LABELS) : [track.instrument, ...Object.keys(INSTRUMENT_LABELS)];
        const option = (value, label, selected) =>
            `<option value="${escapeAttr(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        const changes = meta.changes?.length
            ? `<p class="tab-setup-note tab-setup-changes">The time signature changes at ${
                meta.changes.length === 1 ? 'measure' : 'measures'} ${meta.changes.join(', ')} stay as they are.</p>`
            : '';
        const trackPart = track.percussion
            ? `<fieldset class="tab-setup-track"><legend>Track: ${escapeHtml(track.id)}</legend>
                   <p class="tab-setup-note">A drum track has no instrument, tuning or capo.</p></fieldset>`
            : `<fieldset class="tab-setup-track"><legend>Track: ${escapeHtml(track.id)}</legend>
                   <label class="tab-setup-row"><span>Instrument</span>
                       <select class="tab-setup-instrument">${instruments.map(i =>
                           option(i, INSTRUMENT_LABELS[i] || i, i === track.instrument)).join('')}</select></label>
                   <label class="tab-setup-row"><span>Tuning</span>
                       <select class="tab-setup-tuning"></select></label>
                   <div class="tab-setup-strings" role="group" aria-label="Pitch of each string"></div>
                   <label class="tab-setup-row tab-setup-capo-row"><span>Capo (fret 0 to ${CAPO_MAX})</span>
                       <input class="tab-setup-capo" type="number" inputmode="numeric" min="0" max="${CAPO_MAX}"
                              step="1" value="${escapeAttr(track.capo ?? 0)}"></label>
                   ${track.noteCount > 0
                       ? `<p class="tab-setup-note tab-setup-keeps">Every note keeps its string and fret when the
                              tuning changes, so what is written stays and the sound follows the new tuning.</p>`
                       : ''}
               </fieldset>`;
        this.element.innerHTML = `
            <div class="popover-header">
                <span class="popover-title">Tab setup</span>
                <button class="popover-close" title="Close (Escape)">&times;</button>
            </div>
            <div class="popover-body">
                <fieldset class="tab-setup-tab"><legend>Whole tab</legend>
                    <label class="tab-setup-row"><span>Title</span>
                        <input class="tab-setup-title" type="text" maxlength="200" autocomplete="off"
                               value="${escapeAttr(meta.title)}"></label>
                    <label class="tab-setup-row"><span>Composer</span>
                        <input class="tab-setup-composer" type="text" maxlength="200" autocomplete="off"
                               value="${escapeAttr(meta.composer)}"></label>
                    <div class="tab-setup-pair">
                        <label class="tab-setup-row"><span>Key</span>
                            <input class="tab-setup-key" type="text" maxlength="20" list="otf-tab-setup-keys"
                                   autocomplete="off" autocapitalize="characters" spellcheck="false"
                                   value="${escapeAttr(meta.key)}">
                            <datalist id="otf-tab-setup-keys">${KEYS.map(k => `<option value="${k}">`).join('')}</datalist></label>
                        <label class="tab-setup-row"><span>Time signature</span>
                            <select class="tab-setup-time">${signatures.map(s =>
                                option(s, s, s === meta.timeSignature)).join('')}</select></label>
                    </div>
                    <label class="tab-setup-row"><span>Tempo (quarter notes a minute, ${TEMPO_MIN} to ${TEMPO_MAX})</span>
                        <input class="tab-setup-tempo" type="number" inputmode="numeric" min="${TEMPO_MIN}"
                               max="${TEMPO_MAX}" step="1" value="${escapeAttr(meta.tempo)}"></label>
                    ${changes}
                </fieldset>
                ${trackPart}
                <div class="tab-setup-error" role="alert"></div>
            </div>
            <div class="popover-footer">
                <button class="popover-btn cancel-btn">Cancel</button>
                <button class="popover-btn apply-btn primary">Apply</button>
            </div>
        `;
        const $ = (sel) => this.element.querySelector(sel);
        this.errorEl = $('.tab-setup-error');
        $('.popover-close').addEventListener('click', () => this.close());
        $('.cancel-btn').addEventListener('click', () => this.close());
        $('.apply-btn').addEventListener('click', () => this._apply());
        this.element.addEventListener('keydown', (e) => this._onKeyDown(e));
        this.element.addEventListener('input', () => { this.errorEl.textContent = ''; });
        if (!track.percussion) this._wireTrack(track);

        this.overlay.style.display = 'flex';
        this.isOpen = true;
        // After a menu click the menu hands focus back to the editor as it closes
        const focusFirst = () => {
            // not once they have started typing somewhere in the panel
            if (this.element && !this.element.contains(document.activeElement)) {
                this.element.querySelector('.tab-setup-title')?.focus();
            }
        };
        focusFirst();
        setTimeout(focusFirst, 0);
        requestAnimationFrame(focusFirst);
        document.addEventListener('keydown', this._onDocKey, true);
    }

    _wireTrack(track) {
        const $ = (sel) => this.element.querySelector(sel);
        const instrumentEl = $('.tab-setup-instrument');
        const tuningEl = $('.tab-setup-tuning');
        const stringsEl = $('.tab-setup-strings');

        const drawStrings = (pitches) => {
            stringsEl.innerHTML = pitches.map((p, i) => `
                <label class="tab-setup-string"><span>String ${i + 1}</span>
                    <input class="tab-setup-pitch" type="text" maxlength="4" size="4" autocomplete="off"
                           autocapitalize="characters" spellcheck="false" value="${escapeAttr(p)}"
                           aria-label="String ${i + 1}"></label>`).join('');
        };
        const drawTunings = (instrument, selected) => {
            tuningEl.innerHTML = presetsFor(instrument).map(p =>
                `<option value="${escapeAttr(p.name)}">${escapeHtml(p.name)}</option>`).join('')
                + `<option value="${CUSTOM}">Custom</option>`;
            tuningEl.value = selected;
        };
        const pitchesNow = () => [...stringsEl.querySelectorAll('.tab-setup-pitch')].map(el => el.value);

        const initial = presetNameFor(track.instrument, track.tuning);
        drawTunings(track.instrument, initial ?? CUSTOM);
        drawStrings(track.tuning);

        // A preset fills the boxes; typing in a box makes it Custom.
        tuningEl.addEventListener('change', () => {
            const preset = presetsFor(instrumentEl.value).find(p => p.name === tuningEl.value);
            if (preset) drawStrings(preset.pitches);
        });
        stringsEl.addEventListener('input', () => {
            const name = presetNameFor(instrumentEl.value, pitchesNow().map(parsePitch));
            tuningEl.value = name ?? CUSTOM;
        });
        // Picking an instrument brings its standard tuning, unless it is the
        // track's own instrument again: then the tuning it has.
        instrumentEl.addEventListener('change', () => {
            const instrument = instrumentEl.value;
            if (instrument === track.instrument) {
                drawTunings(instrument, initial ?? CUSTOM);
                drawStrings(track.tuning);
                return;
            }
            const standard = presetsFor(instrument)[0];
            if (standard) {
                drawTunings(instrument, standard.name);
                drawStrings(standard.pitches);
            } else {
                drawTunings(instrument, CUSTOM);
            }
        });
    }

    _values() {
        const $ = (sel) => this.element.querySelector(sel);
        return {
            title: $('.tab-setup-title').value,
            composer: $('.tab-setup-composer').value,
            key: $('.tab-setup-key').value,
            timeSignature: $('.tab-setup-time').value,
            tempo: $('.tab-setup-tempo').value,
            instrument: $('.tab-setup-instrument')?.value,
            capo: $('.tab-setup-capo')?.value,
            pitches: [...this.element.querySelectorAll('.tab-setup-pitch')].map(el => el.value),
        };
    }

    _apply() {
        const { setup, error } = readSetup(this._values(), { percussion: this.session.track.percussion });
        const say = (text) => {
            this.errorEl.textContent = text;
            this.errorEl.scrollIntoView?.({ block: 'nearest' });   // a phone's sheet scrolls; the sentence is at its foot
        };
        if (error) { say(error); return; }
        const result = this.session.apply(setup);
        if (result?.error) { say(result.error); return; }
        this.close();
    }

    _onKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }
        if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
            event.preventDefault();
            event.stopPropagation();
            this._apply();
            return;
        }
        event.stopPropagation();
    }

    close() {
        const wasOpen = this.isOpen;
        this.isOpen = false;
        document.removeEventListener('keydown', this._onDocKey, true);
        if (this.overlay) this.overlay.style.display = 'none';
        if (wasOpen) this.options.onClose?.();
    }

    get opened() { return this.isOpen; }

    destroy() {
        document.removeEventListener('keydown', this._onDocKey, true);
        this.overlay?.parentNode?.removeChild(this.overlay);
        this.overlay = null;
        this.element = null;
    }
}
