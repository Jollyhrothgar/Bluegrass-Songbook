// OTF Editor Toolbar — the palettes (plan tab-editor-input-parity §8.3)
//
// Two rules hold this file together:
//
// 1. **No key is written here.** Every button names an ACTION and asks
//    the binding table what that action's key is in the active preset
//    (`keyFor` → `prettyKeys`), so a tooltip cannot advertise a chord
//    nothing is bound to. It used to claim `Ctrl+T`, `Shift+Q`, `G` and
//    `3` — none of which existed. Switching preset relabels every
//    tooltip at once (`onPresetChange`).
//
// 2. **The palettes reflect the note under the cursor**, TablEdit's
//    purple border: `.reflects-note` outlines the duration/effect the
//    CURRENT note has, while `.active` stays what the NEXT note will
//    get. Two classes, no layout change — an outline, never a border
//    width, so nothing moves when the cursor does.
//
// 3. **"Note length" and "Cursor step" say which knob is which.** They
//    were "Duration" and "Grid", side by side, and nothing on screen said
//    which one moved the cursor and which one sized the note — the single
//    most common confusion in the first session with automatic duration
//    on, where the two really are different inputs (plan §6: under auto
//    the GRID is the rhythm input). Caption sentences under each row
//    answered that for a while and read as stray documentation (owner,
//    2026-10-21); the labels now carry it and the tooltips explain it.
//    Three outline states live on the LENGTH buttons, and they never
//    mean the same thing:
//
//      .active        (filled)          what the next typed note gets
//      .reflects-note (solid outline)   what the note under the cursor IS
//      .predicts-next (dashed outline)  under Auto only: what the rule
//                                       would give a note typed right
//                                       here, live on every cursor move

import { DURATIONS, DOTTED_DURATIONS, EditorMode } from './state.js';
import {
    ACTIONS, FX_ACTIONS, keyFor, prettyKeys, getPreset, onPresetChange,
} from './bindings.js';
import { FX_ORDER } from './facade.js';

/**
 * Duration button configuration
 */
// Plain-text symbols: the previous SMuFL codepoints (𝅝 𝅗𝅥 …) rendered
// as blank boxes without a music font — users concluded whole/half/
// quarter notes didn't exist.
const DURATION_BUTTONS = [
    { duration: DURATIONS.whole, symbol: '1', label: 'Whole', action: 'duration.whole' },
    { duration: DURATIONS.half, symbol: '1/2', label: 'Half', action: 'duration.half' },
    { duration: DURATIONS.quarter, symbol: '1/4', label: 'Quarter', action: 'duration.quarter' },
    { duration: DURATIONS.eighth, symbol: '1/8', label: 'Eighth', action: 'duration.eighth' },
    { duration: DURATIONS.sixteenth, symbol: '1/16', label: 'Sixteenth', action: 'duration.sixteenth' },
    { duration: DURATIONS.thirtySecond, symbol: '1/32', label: '32nd', action: 'duration.thirtySecond' },
];

/**
 * Grid subdivision button configuration
 */
const GRID_BUTTONS = [
    { subdivision: DURATIONS.quarter, label: '1/4', action: 'grid.quarter' },
    { subdivision: DURATIONS.eighth, label: '1/8', action: 'grid.eighth' },
    { subdivision: DURATIONS.sixteenth, label: '1/16', action: 'grid.sixteenth' },
    { subdivision: DURATIONS.thirtySecond, label: '1/32', action: 'grid.thirtySecond' },
    { subdivision: DURATIONS.tripletEighth, label: 'Trip', action: 'grid.triplet' },
];

/**
 * Articulation button configuration.
 *
 * `~` as a "technique" is gone: a tie is `tie: true` on the continuation
 * note, and `tech: '~'` was never rendered or played. Tie / dead /
 * bend / the fx effects / clear go through the binding actions (so they
 * are one undo step and behave exactly as the keys do); h / p / slide
 * still ARM for the next
 * note when the cursor is on empty space, which is the mouse user's only
 * way to say "the next one is hammered".
 */
/**
 * TablEdit's note effects (`fx`, a SET on the note — docs/schema/otf.md), one button config per value in the facade's
 * FX_ORDER. The label is the action's own, so the menu, the palette and
 * the popover can never name one effect two ways.
 */
const FX_SYMBOLS = {
    brush: '⇅',
    roll: '≀',
    choke: 'ch',
    ghost: '( )',
    staccato: '·',
    'let-ring': 'LR',
    muted: 'PM',
    harmonic: '◇',
    'artificial-harmonic': 'AH',
    tap: 'T',
    vibrato: '∿',
    tremolo: '≡',
    'bend-release': 'BR',
    slap: 'S',
};

export const FX_BUTTONS = FX_ORDER.map(fx => ({
    fx,
    symbol: FX_SYMBOLS[fx] || fx,
    label: ACTIONS[FX_ACTIONS[fx]].label,
    action: FX_ACTIONS[fx],
}));

/**
 * The palette keeps the TRANSITIONS (h p / x b, the tie) and the clear.
 * The effects — all fourteen, the keyed five (B R C G /) included — are
 * one `Effects ▾` list away, by name: as palette glyphs (⇅ ≀ ch ( ) ·)
 * they were five cryptic buttons, one of them nearly invisible.
 */
export const ARTICULATION_BUTTONS = [
    { tech: 'h', symbol: 'h', label: 'Hammer-on', action: 'effect.hammer' },
    { tech: 'p', symbol: 'p', label: 'Pull-off', action: 'effect.pull' },
    { tech: '/', symbol: '/', label: 'Slide', action: 'effect.slide' },
    { tech: 'x', symbol: 'x', label: 'Dead note', action: 'effect.dead' },
    { tech: 'b', symbol: 'b', label: 'Bend target', action: 'effect.bend' },
    { tie: true, symbol: '⌒', label: 'Tie to the previous note', action: 'effect.tie' },
    { clear: true, symbol: '∅', label: 'Clear the effects', action: 'effect.clear' },
];

/**
 * Mode display configuration
 * Simplified: Only NORMAL, VISUAL, and ANNOTATION modes
 */
const MODE_STYLES = {
    [EditorMode.NORMAL]: { label: 'NORMAL', color: '#666', bg: '#e0e0e0' },
    [EditorMode.VISUAL]: { label: 'VISUAL', color: '#fff', bg: '#007bff' },
    [EditorMode.ANNOTATION]: { label: 'ANNOTATION', color: '#fff', bg: '#6f42c1' },
};

/** What each label's tooltip explains — the old caption sentences. */
const LENGTH_HINT = 'Note length: what a typed note gets';
const STEP_HINT = 'Cursor step: how far the cursor moves, and what the ruler draws';

/**
 * Does a duration button describe the note under the cursor?
 * A dotted value reflects its BASE button plus the dotted latch (dur 360
 * outlines `1/8` and `Dot`); a triplet eighth has its own button.
 */
export function durationReflects(noteDur, buttonDur) {
    if (noteDur == null) return false;
    if (noteDur === buttonDur) return true;
    return DOTTED_DURATIONS.has(noteDur) && noteDur / 1.5 === buttonDur;
}

/**
 * Which LENGTH button the automatic-duration PREDICTION lands on.
 * Same mapping as `durationReflects` — a predicted 360 points at `1/8`
 * (and the `Dot` latch), 160 at the triplet button — because the two
 * outlines have to agree about what a value "is". A prediction the
 * palette has no button for (an odd gap like 1800) simply outlines
 * nothing; the status bar still prints the number.
 */
export const durationPredicts = durationReflects;

/**
 * Editor Toolbar Component
 */
export class EditorToolbar {
    constructor(state, options = {}) {
        this.state = state;
        this.options = options;

        // DOM elements
        this.element = null;
        this.durationButtons = new Map();
        this.gridButtons = new Map();
        this.articulationButtons = new Map();
        this.modeIndicator = null;
        this.tripletButton = null;
        this.gridToggleButton = null;
        this.undoButton = null;
        this.redoButton = null;

        // Buttons whose tooltip (and inline key) comes from the table
        this._titled = [];

        // Bind event handlers
        this._onDurationChange = this._onDurationChange.bind(this);
        this._onModeChange = this._onModeChange.bind(this);
        this._onTripletModeChange = this._onTripletModeChange.bind(this);
        this._onAutoAdvanceChange = this._onAutoAdvanceChange.bind(this);
        this._onPendingArticulationChange = this._onPendingArticulationChange.bind(this);
        this._onGridSubdivisionChange = this._onGridSubdivisionChange.bind(this);
        this._onGridToggle = this._onGridToggle.bind(this);
        this._onTracksChange = this._onTracksChange.bind(this);
        this._onNoteContextChange = this._onNoteContextChange.bind(this);
        this._onPredictionChange = this._onPredictionChange.bind(this);
    }

    /**
     * Create and render toolbar
     * @param {HTMLElement} container - Container to append toolbar to
     */
    render(container) {
        this.element = document.createElement('div');
        this.element.className = 'otf-editor-toolbar';
        // TRACK comes LAST: renaming and reordering are once-per-document
        // edits and used to spend four slots at the head of the row, ahead
        // of the things you press every few seconds (plan §8.2).
        this.element.innerHTML = `
            <div class="toolbar-section history-section">
                <button class="toolbar-button undo-button">
                    <span class="button-icon">↩</span>
                </button>
                <button class="toolbar-button redo-button">
                    <span class="button-icon">↪</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section duration-section">
                <span class="toolbar-label" title="${LENGTH_HINT}">Note length</span>
                <button class="toolbar-button auto-duration-button">
                    <span class="button-content">Auto</span>
                </button>
                <div class="button-group duration-buttons"></div>
                <button class="toolbar-button dotted-button">
                    <span class="button-content">Dot</span>
                </button>
                <button class="toolbar-button triplet-button">
                    <span class="button-content">³</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section grid-section">
                <span class="toolbar-label" title="${STEP_HINT}">Cursor step</span>
                <div class="button-group grid-buttons"></div>
                <button class="toolbar-button rest-button">
                    <span class="button-content">Rest</span>
                </button>
                <button class="toolbar-button toolbar-toggle auto-advance-button" aria-pressed="false">
                    <span class="button-content">Advance</span>
                </button>
                <button class="toolbar-button toolbar-toggle grid-toggle-button" aria-pressed="false">
                    <span class="button-content">Ruler</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section articulation-section">
                <span class="toolbar-label">Technique</span>
                <div class="button-group articulation-buttons"></div>
                <button class="toolbar-button effects-button" aria-haspopup="menu" aria-expanded="false">
                    <span class="button-content">Effects ▾</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section text-section">
                <button class="toolbar-button annotation-button">
                    <span class="button-content">Text</span>
                </button>
                <button class="toolbar-button annotation-delete-button">
                    <span class="button-icon">⌫</span>
                </button>
            </div>
            <div class="toolbar-separator track-section-sep" style="display:none"></div>
            <div class="toolbar-section track-section" style="display:none">
                <span class="toolbar-label">Track</span>
                <div class="button-group track-buttons"></div>
                <button class="toolbar-button track-move-earlier-button" title="Move this track earlier — the first track is the lead">
                    <span class="button-icon">◀</span>
                </button>
                <button class="toolbar-button track-move-later-button" title="Move this track later">
                    <span class="button-icon">▶</span>
                </button>
                <button class="toolbar-button track-rename-button" title="Rename this track">
                    <span class="button-icon">✏️</span>
                </button>
            </div>
            <div class="toolbar-section mode-section">
                <div class="mode-indicator" role="status" hidden></div>
            </div>
        `;

        // Apply styles
        this._applyStyles();

        // Track switcher. Segmented buttons, not a dropdown — the old
        // select was so small that even the site's author thought only
        // banjo tracks existed. Rebuilt whenever the track list changes,
        // because the buttons ARE the names: renaming a track relabels
        // its button, and reordering re-lays the row.
        this.trackButtons = this.element.querySelector('.track-buttons');
        this.trackSection = this.element.querySelector('.track-section');
        this.trackSectionSep = this.element.querySelector('.track-section-sep');
        this.trackRenameButton = this.element.querySelector('.track-rename-button');
        this.trackMoveEarlierButton = this.element.querySelector('.track-move-earlier-button');
        this.trackMoveLaterButton = this.element.querySelector('.track-move-later-button');
        this._trackSignature = null;
        this._renderTrackButtons();

        // Get references
        this.modeIndicator = this.element.querySelector('.mode-indicator');
        this.tripletButton = this.element.querySelector('.triplet-button');
        this.autoDurationButton = this.element.querySelector('.auto-duration-button');
        this.dottedButton = this.element.querySelector('.dotted-button');
        this.autoAdvanceButton = this.element.querySelector('.auto-advance-button');
        this.gridToggleButton = this.element.querySelector('.grid-toggle-button');
        this.undoButton = this.element.querySelector('.undo-button');
        this.redoButton = this.element.querySelector('.redo-button');
        this.restButton = this.element.querySelector('.rest-button');
        this.effectsButton = this.element.querySelector('.effects-button');
        this.annotationButton = this.element.querySelector('.annotation-button');
        this.annotationDeleteButton = this.element.querySelector('.annotation-delete-button');

        // Tooltips + inline keys, all from the binding table
        this._title(this.autoDurationButton, 'Automatic duration — the gap decides', 'duration.auto');
        this._title(this.dottedButton, 'Dotted', 'duration.dotted');
        this._title(this.tripletButton, 'Triplet', 'duration.triplet');
        this._title(this.autoAdvanceButton, 'Auto-advance after entry', 'entry.autoAdvance');
        this._title(this.restButton, 'Rest — advance one duration without a note', 'nav.advance');
        this._title(this.gridToggleButton, 'Show/hide the ruler', 'grid.toggle');
        this._title(this.effectsButton,
            'Effects on the note at the cursor — brush, roll, choke, ghost, let ring…', null);
        this._title(this.annotationButton,
            'Add or edit the placed text at the cursor — section labels, playing notes, chord names',
            'text.edit');
        this._title(this.annotationDeleteButton, 'Delete the placed text at the cursor', 'text.delete');
        this._title(this.undoButton, 'Undo', 'edit.undo');
        this._title(this.redoButton, 'Redo', 'edit.redo');

        // Create duration buttons
        const durationContainer = this.element.querySelector('.duration-buttons');
        for (const config of DURATION_BUTTONS) {
            const button = this._createDurationButton(config);
            this.durationButtons.set(config.duration, button);
            durationContainer.appendChild(button);
        }

        // Create grid subdivision buttons
        const gridContainer = this.element.querySelector('.grid-buttons');
        for (const config of GRID_BUTTONS) {
            const button = this._createGridButton(config);
            this.gridButtons.set(config.subdivision, button);
            gridContainer.appendChild(button);
        }

        // Create articulation buttons
        const articulationContainer = this.element.querySelector('.articulation-buttons');
        for (const config of ARTICULATION_BUTTONS) {
            const button = this._createArticulationButton(config);
            this.articulationButtons.set(config.tech || config.action, button);
            articulationContainer.appendChild(button);
        }

        // Set up event listeners
        this._setupEventListeners();

        // Update initial state
        this._refreshKeyLabels();
        this._updateDurationSelection();
        this._updateGridSelection();
        this._updateGridToggle();
        this._updateModeIndicator();
        this._updateEntryLatches();
        this._updateNoteReflection();
        this._updatePrediction();

        container.appendChild(this.element);
    }

    /**
     * Remember a button's wording so the KEY half can be re-rendered when
     * the preset changes. `label` is ours; the parenthesised key never is.
     */
    _title(el, label, actionId) {
        if (!el) return;
        this._titled.push({ el, label, action: actionId });
    }

    /** Re-render every tooltip (and inline key) for the active preset. */
    _refreshKeyLabels() {
        const preset = getPreset();
        for (const { el, label, action } of this._titled) {
            const keys = action ? keyFor(action, preset) : null;
            el.title = keys ? `${label} (${prettyKeys(keys)})` : label;
            const slot = el.querySelector('.button-key');
            if (slot) slot.textContent = keys ? prettyKeys(keys) : '';
        }
    }

    /**
     * (Re)build the track row from the document.
     *
     * Cheap to call on every document change — it compares a signature
     * of "which tracks, in what order, which one is active" first and
     * returns unless something actually moved. That is what makes undo
     * of a rename or a reorder relabel the row without any op needing to
     * remember to tell the toolbar.
     */
    _renderTrackButtons() {
        if (!this.trackButtons) return;
        const tracks = this.state.otf?.tracks || [];
        const active = this.state.trackId;
        const signature = JSON.stringify([tracks.map(t => t.id), active]);
        if (signature === this._trackSignature) return;
        this._trackSignature = signature;

        this.trackButtons.innerHTML = '';
        for (const t of tracks) {
            const btn = document.createElement('button');
            btn.className = 'toolbar-button track-button';
            btn.dataset.trackId = t.id;
            const label = document.createElement('span');
            label.className = 'button-content';
            // textContent, not innerHTML: a track name is user-typed
            label.textContent = t.id;
            btn.appendChild(label);
            btn.title = `Edit the ${t.id} track`;
            if (t.id === active) btn.classList.add('active');
            btn.addEventListener('click', () => this.state.setTrack(t.id));
            this.trackButtons.appendChild(btn);
        }

        // Only a second track gives this row something to do: switching
        // and reordering need two. A lone track is renamed from Score ▸
        // Rename track… (it used to hold four slots here — a "banjo"
        // button, two greyed arrows and ✏️ — on every one-track tab).
        const show = tracks.length >= 2;
        if (this.trackSection) this.trackSection.style.display = show ? '' : 'none';
        if (this.trackSectionSep) this.trackSectionSep.style.display = show ? '' : 'none';

        const index = tracks.findIndex(t => t.id === active);
        if (this.trackMoveEarlierButton) {
            this.trackMoveEarlierButton.disabled = index <= 0;
        }
        if (this.trackMoveLaterButton) {
            this.trackMoveLaterButton.disabled = index === -1 || index >= tracks.length - 1;
        }
        if (this.trackRenameButton) {
            this.trackRenameButton.disabled = index === -1;
            this.trackRenameButton.title = index === -1
                ? 'Rename this track'
                : `Rename the ${active} track`;
        }
    }

    /**
     * Apply toolbar styles
     */
    _applyStyles() {
        const style = document.createElement('style');
        style.setAttribute('data-otf-toolbar', '');
        style.textContent = `
            .otf-editor-toolbar {
                display: flex;
                align-items: center;
                padding: 8px 12px;
                background: var(--bg-secondary, #f5f5f5);
                border-bottom: 1px solid var(--border, #ddd);
                gap: 8px;
                flex-wrap: wrap;
            }

            .toolbar-section {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .toolbar-separator {
                width: 1px;
                height: 24px;
                background: var(--border, #ddd);
                margin: 0 4px;
            }

            .toolbar-label {
                font-size: 11px;
                color: var(--text-muted, #666);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                min-width: 46px;
            }

            /* The labels carry an explanation in their tooltip */
            .toolbar-label[title] {
                cursor: help;
            }

            /* The mode chip sits at the far end: it comes and goes with
               VISUAL / ANNOTATION, and nothing you reach for may move. */
            .mode-section {
                margin-left: auto;
            }

            .button-group {
                display: flex;
                gap: 2px;
            }

            .toolbar-button {
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 32px;
                height: 32px;
                padding: 4px 8px;
                border: 1px solid var(--border, #ddd);
                border-radius: 4px;
                background: var(--bg, #fff);
                color: var(--text, #333);
                cursor: pointer;
                font-size: 14px;
                transition: all 0.15s ease;
            }

            .toolbar-button:hover {
                background: var(--bg-hover, #e9e9e9);
                border-color: var(--border-hover, #ccc);
            }

            .toolbar-button.active {
                background: var(--accent, #007bff);
                border-color: var(--accent, #007bff);
                color: var(--on-accent, #fff);
            }

            /* An ON/OFF switch (Advance, Ruler) is not a CHOICE like the
               step value beside it: on reads as a tinted outline, never
               the solid fill that marks the selected value. */
            .toolbar-toggle.active {
                background: var(--accent-soft, rgba(0, 123, 255, 0.12));
                border-color: var(--accent, #007bff);
                color: var(--accent, #007bff);
            }

            .toolbar-button.pending {
                background: var(--warning, #fd7e14);
                border-color: var(--warning, #fd7e14);
                color: #fff;
            }

            /* TablEdit's purple border: what the note UNDER THE CURSOR
               already is, as opposed to .active (what the next note will
               be). An inset shadow, so nothing shifts by a pixel. */
            .toolbar-button.reflects-note {
                box-shadow: inset 0 0 0 2px var(--otf-reflect, #6f42c1);
            }

            /* Under Auto, the LENGTH row shows what the rule WOULD give
               a note typed at the cursor. Dashed, because it is a
               prediction and not a commitment — and drawn inside, so it
               can coexist with .reflects-note without moving anything. */
            .toolbar-button.predicts-next {
                outline: 2px dashed var(--otf-predict, #6f42c1);
                outline-offset: -3px;
            }

            .toolbar-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .duration-button .button-symbol {
                font-size: 18px;
                line-height: 1;
            }

            .articulation-button {
                font-weight: 600;
                min-width: 28px;
            }

            .triplet-button {
                font-weight: 700;
                font-size: 16px;
            }

            /* Orange is for a MODE you are in and will leave (triplet
               entry counts to three and turns itself off). The other
               latches are ordinary entry state, so they take the same
               blue .active fill the duration buttons do. */
            .triplet-button.active {
                background: var(--warning, #fd7e14);
                border-color: var(--warning, #fd7e14);
                color: #fff;
            }

            .mode-indicator {
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.5px;
                text-align: center;
            }

            .mode-indicator[hidden] {
                display: none;
            }

            .otf-fx-popup {
                position: fixed;
                z-index: 1000;
                min-width: 220px;
                padding: 4px;
                background: var(--bg, #fff);
                color: var(--text, #333);
                border: 1px solid var(--border, #ddd);
                border-radius: 6px;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
            }

            .otf-fx-popup[hidden] {
                display: none;
            }

            .otf-fx-item {
                display: grid;
                grid-template-columns: 16px 1fr auto;
                align-items: center;
                gap: 8px;
                width: 100%;
                padding: 5px 8px;
                border: 0;
                border-radius: 4px;
                background: none;
                color: inherit;
                font: inherit;
                font-size: 13px;
                text-align: left;
                cursor: pointer;
            }

            .otf-fx-item:hover,
            .otf-fx-item:focus-visible {
                background: var(--bg-hover, #e9e9e9);
                outline: none;
            }

            .otf-fx-key {
                font-size: 11px;
                color: var(--text-muted, #888);
                font-family: inherit;
            }

            .button-icon {
                font-size: 16px;
            }

            @media (max-width: 600px) {
                .otf-editor-toolbar {
                    padding: 6px 8px;
                }

                /* Labels that were only decoration go. Note length /
                   Cursor step STAY — they tell the two palettes apart. */
                .toolbar-section:not(.grid-section):not(.duration-section)
                    .toolbar-label {
                    display: none;
                }

                .grid-section > .toolbar-label,
                .duration-section > .toolbar-label {
                    min-width: 0;
                    font-size: 10px;
                }

                .toolbar-button {
                    min-width: 28px;
                    height: 28px;
                }

                /* Wrap INSIDE a section so a palette never runs off the
                   screen; separators would only strand at line starts. */
                .toolbar-section,
                .button-group {
                    flex-wrap: wrap;
                }

                .toolbar-separator {
                    display: none;
                }

                .toolbar-label {
                    white-space: nowrap;
                }
            }
        `;

        if (!document.querySelector('style[data-otf-toolbar]')) {
            document.head.appendChild(style);
        }
    }

    /**
     * Create duration button
     */
    _createDurationButton(config) {
        const button = document.createElement('button');
        button.className = 'toolbar-button duration-button';
        button.dataset.duration = config.duration;
        // The key is in the tooltip only: printed inline (F4, F5, q, F7…)
        // it crowded the palette and `q` read like a typo.
        button.innerHTML = `<span class="button-symbol">${config.symbol}</span>`;
        this._title(button, config.label, config.action);

        button.addEventListener('click', () => {
            this.state.setDuration(config.duration);
        });

        return button;
    }

    /**
     * Create grid subdivision button
     */
    _createGridButton(config) {
        const button = document.createElement('button');
        button.className = 'toolbar-button grid-btn';
        button.setAttribute('data-subdivision', config.subdivision);
        button.textContent = config.label;
        this._title(button, `Grid: ${config.label}`, config.action);

        button.addEventListener('click', () => {
            this.state.setGridSubdivision(config.subdivision);
        });

        return button;
    }

    /**
     * Create articulation button
     */
    _createArticulationButton(config) {
        const button = document.createElement('button');
        button.className = 'toolbar-button articulation-button';
        button.dataset.action = config.action;
        if (config.tech) button.dataset.tech = config.tech;
        button.textContent = config.symbol;
        this._title(button, config.label, config.action);

        button.addEventListener('click', () => this._articulate(config));

        return button;
    }

    /**
     * One click, two meanings — the same two the keys have:
     *
     *   a note under the cursor → apply the effect to it (the binding
     *                             action, so it is one undo step)
     *   empty slot             → ARM it for the next note (the mouse
     *                             user's only way to say "hammer the
     *                             next one")
     *
     * Tie always goes to the action (it needs a real predecessor), and
     * Clear disarms a pending effect before it touches the document.
     */
    _articulate(config) {
        const dispatch = () => this.options.onAction?.(config.action);
        if (config.clear) {
            if (this.state.pendingArticulation) {
                this.state.setPendingArticulation(null);
                return;
            }
            dispatch();
            return;
        }
        // Tie needs a real predecessor; an fx has no "armed for the next
        // note" state (only techs do) — both always go to the action.
        if (config.tie || config.fx) {
            dispatch();
            return;
        }
        if (this.state.getNoteAtCursor()) {
            dispatch();
            return;
        }
        this.state.setPendingArticulation(
            this.state.pendingArticulation === config.tech ? null : config.tech);
    }

    /**
     * Set up state event listeners
     */
    _setupEventListeners() {
        this.state.on('durationChange', this._onDurationChange);
        this.state.on('modeChange', this._onModeChange);
        this.state.on('tripletModeChange', this._onTripletModeChange);
        this.state.on('autoAdvanceChange', this._onAutoAdvanceChange);
        this.state.on('pendingArticulationChange', this._onPendingArticulationChange);
        this.state.on('gridSubdivisionChange', this._onGridSubdivisionChange);
        this.state.on('gridToggle', this._onGridToggle);
        // 'change' covers rename / reorder / undo / redo / load in one
        // subscription; the signature check inside makes it a no-op for
        // the note edits that fire it constantly.
        this.state.on('change', this._onTracksChange);
        this.state.on('trackChange', this._onTracksChange);
        // State reflection: which note is under the cursor, and what it is
        this.state.on('cursorMove', this._onNoteContextChange);
        this.state.on('change', this._onNoteContextChange);

        // The automatic-duration PREDICTION moves with the cursor and
        // with the document (a new onset next door changes the gap), and
        // appears/disappears with the Auto latch itself.
        this.state.on('cursorMove', this._onPredictionChange);
        this.state.on('change', this._onPredictionChange);
        this.state.on('autoDurationChange', this._onPredictionChange);
        this.state.on('durationChange', this._onPredictionChange);

        // Tooltips follow the preset
        this._unsubPreset = onPresetChange(() => this._refreshKeyLabels());

        // Track identity and order
        this.trackRenameButton.addEventListener('click', () => {
            this.options.onRenameTrack?.();
        });
        this.trackMoveEarlierButton.addEventListener('click', () => {
            this.options.onMoveTrack?.(-1);
        });
        this.trackMoveLaterButton.addEventListener('click', () => {
            this.options.onMoveTrack?.(1);
        });

        // Entry-state latches
        this.autoDurationButton.addEventListener('click', () => {
            this.state.setAutoDuration(!this.state.isAutoDuration);
        });
        this.dottedButton.addEventListener('click', () => {
            this.state.toggleDotted();
        });
        this.tripletButton.addEventListener('click', () => {
            this.state.toggleTripletMode();
        });
        this.autoAdvanceButton.addEventListener('click', () => {
            this.state.toggleAutoAdvance();
        });

        // Grid toggle button
        this.gridToggleButton.addEventListener('click', () => {
            this.state.toggleGrid();
        });

        // Undo/Redo buttons
        this.undoButton.addEventListener('click', () => {
            this.state.undo();
        });

        this.redoButton.addEventListener('click', () => {
            this.state.redo();
        });

        // Rest: advance one duration without entering a note
        this.restButton.addEventListener('click', () => {
            this.options.onRest?.();
        });

        // Copy / cut / paste / loop are Edit ▸ and Play ▸ items (and
        // their keys) — they used to be four more toolbar slots.

        this.effectsButton.addEventListener('click', () => {
            if (this._fxPopup && !this._fxPopup.hidden) this._closeEffects();
            else this._openEffects();
        });

        // Placed text: the mouse path to the same prompt `c` opens
        this.annotationButton.addEventListener('click', () => {
            this.options.onEditAnnotation?.();
        });

        this.annotationDeleteButton.addEventListener('click', () => {
            this.options.onDeleteAnnotation?.();
        });
    }

    /**
     * Handle duration change
     */
    _onDurationChange() {
        this._updateDurationSelection();
        this._updateEntryLatches();
    }

    /**
     * Handle mode change
     */
    _onModeChange() {
        this._updateModeIndicator();
    }

    /**
     * Handle triplet mode change
     */
    _onTripletModeChange(enabled) {
        this.tripletButton.classList.toggle('active', enabled);
    }

    /** Handle auto-advance change */
    _onAutoAdvanceChange() {
        this._updateEntryLatches();
    }

    /**
     * Handle pending articulation change
     */
    _onPendingArticulationChange(tech) {
        for (const [key, button] of this.articulationButtons) {
            button.classList.toggle('pending', !!tech && key === tech);
        }
    }

    /**
     * Handle grid subdivision change
     */
    _onGridSubdivisionChange() {
        this._updateGridSelection();
    }

    /**
     * Handle grid toggle
     */
    _onGridToggle(visible) {
        this._updateGridToggle();
    }

    /**
     * Handle anything that could have changed the track list or which
     * track is active (rename, reorder, switch, undo, redo, load).
     */
    _onTracksChange() {
        this._renderTrackButtons();
    }

    /** The cursor moved, or the document did — re-outline the palettes. */
    _onNoteContextChange() {
        this._updateNoteReflection();
    }

    /** Anything that could change what the rule predicts for this slot. */
    _onPredictionChange() {
        this._updatePrediction();
    }

    /**
     * The LENGTH row's live prediction (`.predicts-next`, dashed): under
     * Auto, what `state.effectiveDuration()` says a note typed at the
     * cursor would sound for. TablEdit's palette "dynamically displays
     * the automatic duration of the note that would be inserted" — this
     * is that, and it is the only way to see the manual's rule (the last
     * note takes the PRECEDING interval) before committing to it.
     *
     * Nothing is outlined when a duration is chosen: there is no
     * prediction then, only the choice, and `.active` already shows it.
     */
    _updatePrediction() {
        const auto = this.state.isAutoDuration;
        const predicted = auto ? this.state.effectiveDuration() : null;
        for (const [duration, button] of this.durationButtons) {
            button.classList.toggle('predicts-next',
                auto && durationPredicts(predicted, duration));
        }
        this.dottedButton?.classList.toggle('predicts-next',
            auto && predicted != null && DOTTED_DURATIONS.has(predicted));
        this.tripletButton?.classList.toggle('predicts-next',
            auto && predicted === DURATIONS.tripletEighth);
    }

    /**
     * Update duration button selection
     */
    _updateDurationSelection() {
        const current = this.state.currentDuration;
        for (const [duration, button] of this.durationButtons) {
            button.classList.toggle('active', duration === current);
        }
    }

    /** Auto / dotted / triplet / auto-advance latches (ENTRY state). */
    _updateEntryLatches() {
        const current = this.state.currentDuration;
        this.autoDurationButton?.classList.toggle('active', this.state.isAutoDuration);
        this.dottedButton?.classList.toggle('active',
            current != null && DOTTED_DURATIONS.has(current));
        this.tripletButton?.classList.toggle('active', !!this.state.tripletMode);
        this.autoAdvanceButton?.classList.toggle('active', !!this.state.autoAdvance);
        this.autoAdvanceButton?.setAttribute('aria-pressed', String(!!this.state.autoAdvance));
    }

    /**
     * TablEdit's purple border: outline whatever the note under the
     * cursor already IS — its duration (dotted values outline the base
     * button plus `Dot`), its effect, its tie. Filled `.active` stays
     * the entry state; these two never fight because they are different
     * classes.
     */
    _updateNoteReflection() {
        const note = this.state.getNoteAtCursor?.() || null;
        const dur = note?.dur ?? null;

        for (const [duration, button] of this.durationButtons) {
            button.classList.toggle('reflects-note', durationReflects(dur, duration));
        }
        this.dottedButton?.classList.toggle('reflects-note',
            dur != null && DOTTED_DURATIONS.has(dur));
        this.tripletButton?.classList.toggle('reflects-note',
            dur === DURATIONS.tripletEighth);

        // Effects ▾ is outlined when the note carries any effect — the
        // only sign of it once the effects left the palette
        this.effectsButton?.classList.toggle('reflects-note', !!note?.fx?.length);
        if (this._fxPopup && !this._fxPopup.hidden) this._renderEffects();

        for (const config of ARTICULATION_BUTTONS) {
            const button = this.articulationButtons.get(config.tech || config.action);
            if (!button) continue;
            let on = false;
            if (config.tie) on = note?.tie === true;
            else if (config.clear) {
                on = !!note && !note.tech && note.tie !== true
                    && !note.fx?.length && note.grace == null;
            } else if (config.fx) on = !!note?.fx?.includes(config.fx);
            else on = !!note && note.tech === config.tech;
            button.classList.toggle('reflects-note', on);
        }
    }

    /**
     * Update grid subdivision button selection
     */
    _updateGridSelection() {
        const current = this.state.gridSubdivision;
        for (const [subdivision, button] of this.gridButtons) {
            button.classList.toggle('active', subdivision === current);
        }
    }

    /**
     * Update grid toggle button state
     */
    _updateGridToggle() {
        this.gridToggleButton.classList.toggle('active', this.state.showGrid);
        this.gridToggleButton.setAttribute('aria-pressed', String(!!this.state.showGrid));
    }

    /**
     * Update mode indicator
     */
    _updateModeIndicator() {
        const mode = this.state.mode;
        const style = MODE_STYLES[mode] || MODE_STYLES[EditorMode.NORMAL];

        // NORMAL is where you always are, and the status bar says so; the
        // chip only speaks up for the modes you have to know you are in.
        const normal = mode === EditorMode.NORMAL || !MODE_STYLES[mode];
        this.modeIndicator.hidden = normal;
        this.modeIndicator.textContent = normal ? style.label : `${style.label} · Esc to leave`;
        this.modeIndicator.style.backgroundColor = style.bg;
        this.modeIndicator.style.color = style.color;
    }

    /**
     * The Effects ▾ list: every TablEdit effect by name, a ✓ for what the
     * note at the cursor carries, the key where there is one. Hangs off
     * <body> and is fixed-positioned for the reason the menu bar's popup
     * is: `.otf-editor` clips its overflow.
     */
    _openEffects() {
        if (!this._fxPopup) {
            const popup = document.createElement('div');
            popup.className = 'otf-fx-popup';
            popup.setAttribute('role', 'menu');
            popup.hidden = true;
            popup.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.preventDefault(); this._closeEffects(true); }
            });
            document.body.appendChild(popup);
            this._fxPopup = popup;
            this._onFxOutside = (e) => {
                if (!popup.contains(e.target) && !this.effectsButton.contains(e.target)) {
                    this._closeEffects();
                }
            };
        }
        this._renderEffects();
        const r = this.effectsButton.getBoundingClientRect();
        Object.assign(this._fxPopup.style, { left: `${r.left}px`, top: `${r.bottom + 4}px` });
        this._fxPopup.hidden = false;
        this.effectsButton.setAttribute('aria-expanded', 'true');
        document.addEventListener('mousedown', this._onFxOutside, true);
        this._fxPopup.querySelector('[role="menuitemcheckbox"]')?.focus();
    }

    _renderEffects() {
        const note = this.state.getNoteAtCursor?.() || null;
        const preset = getPreset();
        this._fxPopup.innerHTML = '';
        for (const cfg of FX_BUTTONS) {
            const on = !!note?.fx?.includes(cfg.fx);
            const item = document.createElement('button');
            item.className = 'otf-fx-item';
            item.setAttribute('role', 'menuitemcheckbox');
            item.setAttribute('aria-checked', on ? 'true' : 'false');
            item.dataset.action = cfg.action;
            // Never disabled for an empty slot: in VISUAL the action takes
            // the selection, and elsewhere it says why it refused.
            const keys = keyFor(cfg.action, preset);
            item.innerHTML = `<span class="otf-fx-check">${on ? '✓' : ''}</span>`
                + `<span class="otf-fx-label"></span><kbd class="otf-fx-key"></kbd>`;
            item.querySelector('.otf-fx-label').textContent = cfg.label;
            item.querySelector('.otf-fx-key').textContent = keys ? prettyKeys(keys) : '';
            item.addEventListener('click', () => {
                this.options.onAction?.(cfg.action);
                this._closeEffects(true);
            });
            this._fxPopup.appendChild(item);
        }
    }

    _closeEffects(refocus = false) {
        if (!this._fxPopup || this._fxPopup.hidden) return;
        this._fxPopup.hidden = true;
        this.effectsButton?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', this._onFxOutside, true);
        if (refocus) this.options.onRefocus?.();
    }

    /**
     * Update undo/redo button states
     */
    updateHistoryButtons() {
        this.undoButton.disabled = !this.state.history.canUndo();
        this.redoButton.disabled = !this.state.history.canRedo();
    }

    /**
     * Destroy toolbar
     */
    destroy() {
        this.state.off('durationChange', this._onDurationChange);
        this.state.off('modeChange', this._onModeChange);
        this.state.off('tripletModeChange', this._onTripletModeChange);
        this.state.off('autoAdvanceChange', this._onAutoAdvanceChange);
        this.state.off('pendingArticulationChange', this._onPendingArticulationChange);
        this.state.off('gridSubdivisionChange', this._onGridSubdivisionChange);
        this.state.off('gridToggle', this._onGridToggle);
        this.state.off('change', this._onTracksChange);
        this.state.off('trackChange', this._onTracksChange);
        this.state.off('cursorMove', this._onNoteContextChange);
        this.state.off('change', this._onNoteContextChange);
        this.state.off('cursorMove', this._onPredictionChange);
        this.state.off('change', this._onPredictionChange);
        this.state.off('autoDurationChange', this._onPredictionChange);
        this.state.off('durationChange', this._onPredictionChange);
        this._unsubPreset?.();
        this._unsubPreset = null;
        this._titled = [];
        this._closeEffects();
        this._fxPopup?.remove();
        this._fxPopup = null;

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        this.element = null;
    }
}
