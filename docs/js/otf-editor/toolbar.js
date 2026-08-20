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

import { DURATIONS, DOTTED_DURATIONS, EditorMode } from './state.js';
import { keyFor, prettyKeys, getPreset, onPresetChange } from './bindings.js';

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
 * note, and `tech: '~'` was never rendered or played. Tie / dead / choke
 * / clear go through the binding actions (so they are one undo step and
 * behave exactly as the keys do); h / p / slide still ARM for the next
 * note when the cursor is on empty space, which is the mouse user's only
 * way to say "the next one is hammered".
 */
const ARTICULATION_BUTTONS = [
    { tech: 'h', symbol: 'h', label: 'Hammer-on', action: 'effect.hammer' },
    { tech: 'p', symbol: 'p', label: 'Pull-off', action: 'effect.pull' },
    { tech: '/', symbol: '/', label: 'Slide', action: 'effect.slide' },
    { tech: 'x', symbol: 'x', label: 'Dead / muted note', action: 'effect.dead' },
    { tech: 'b', symbol: 'b', label: 'Choke / bend', action: 'effect.choke' },
    { tie: true, symbol: '⌒', label: 'Tie to the previous note', action: 'effect.tie' },
    { clear: true, symbol: '∅', label: 'Clear the effect', action: 'effect.clear' },
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
            <div class="toolbar-section mode-section">
                <div class="mode-indicator"></div>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section duration-section">
                <span class="toolbar-label">Duration</span>
                <div class="button-group duration-buttons"></div>
                <button class="toolbar-button auto-duration-button">
                    <span class="button-content">Auto</span>
                </button>
                <button class="toolbar-button dotted-button">
                    <span class="button-content">Dot</span>
                </button>
                <button class="toolbar-button triplet-button">
                    <span class="button-content">3</span>
                </button>
                <button class="toolbar-button auto-advance-button">
                    <span class="button-icon">⇥</span>
                </button>
                <button class="toolbar-button rest-button">
                    <span class="button-content">Rest</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section grid-section">
                <span class="toolbar-label">Grid</span>
                <div class="button-group grid-buttons"></div>
                <button class="toolbar-button grid-toggle-button">
                    <span class="button-icon">▦</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section articulation-section">
                <span class="toolbar-label">Articulation</span>
                <div class="button-group articulation-buttons"></div>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section text-section">
                <span class="toolbar-label">Text</span>
                <button class="toolbar-button annotation-button">
                    <span class="button-content">Aa</span>
                </button>
                <button class="toolbar-button annotation-delete-button">
                    <span class="button-icon">⌫</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section edit-section">
                <button class="toolbar-button copy-button">
                    <span class="button-icon">⧉</span>
                </button>
                <button class="toolbar-button cut-button">
                    <span class="button-icon">✂</span>
                </button>
                <button class="toolbar-button paste-button">
                    <span class="button-icon">📋</span>
                </button>
                <button class="toolbar-button loop-button">
                    <span class="button-icon">🔁</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section history-section">
                <button class="toolbar-button undo-button">
                    <span class="button-icon">↩</span>
                </button>
                <button class="toolbar-button redo-button">
                    <span class="button-icon">↪</span>
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
        this.copyButton = this.element.querySelector('.copy-button');
        this.cutButton = this.element.querySelector('.cut-button');
        this.pasteButton = this.element.querySelector('.paste-button');
        this.loopButton = this.element.querySelector('.loop-button');
        this.annotationButton = this.element.querySelector('.annotation-button');
        this.annotationDeleteButton = this.element.querySelector('.annotation-delete-button');

        // Tooltips + inline keys, all from the binding table
        this._title(this.autoDurationButton, 'Automatic duration — the gap decides', 'duration.auto');
        this._title(this.dottedButton, 'Dotted', 'duration.dotted');
        this._title(this.tripletButton, 'Triplet', 'duration.triplet');
        this._title(this.autoAdvanceButton, 'Auto-advance after entry', 'entry.autoAdvance');
        this._title(this.restButton, 'Rest — advance one duration without a note', 'nav.advance');
        this._title(this.gridToggleButton, 'Show/hide the grid', 'grid.toggle');
        this._title(this.annotationButton,
            'Add or edit the placed text at the cursor — section labels, playing notes, chord names',
            'text.edit');
        this._title(this.annotationDeleteButton, 'Delete the placed text at the cursor', 'text.delete');
        this._title(this.copyButton, 'Copy', 'clip.copy');
        this._title(this.cutButton, 'Cut', 'clip.cut');
        this._title(this.pasteButton, 'Paste at the cursor', 'clip.paste');
        this._title(this.loopButton, 'Loop the selection', 'play.loop');
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

        // One track still gets the row: it names what you are editing,
        // and a lone track can be misnamed too (a tab-minted work whose
        // only track says "banjo" when it is a guitar). The move buttons
        // are what has nothing to do.
        const show = tracks.length >= 1;
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
                color: #fff;
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

            .toolbar-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .duration-button .button-symbol {
                font-size: 18px;
                line-height: 1;
            }

            .duration-button .button-key {
                font-size: 9px;
                color: var(--text-muted, #888);
                margin-left: 2px;
            }

            .duration-button .button-key:empty {
                margin-left: 0;
            }

            .duration-button.active .button-key {
                color: rgba(255, 255, 255, 0.7);
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
                letter-spacing: 1px;
                text-transform: uppercase;
                min-width: 80px;
                text-align: center;
            }

            .button-icon {
                font-size: 16px;
            }

            @media (max-width: 600px) {
                .otf-editor-toolbar {
                    padding: 6px 8px;
                }

                .toolbar-label {
                    display: none;
                }

                .toolbar-button {
                    min-width: 28px;
                    height: 28px;
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
        button.innerHTML = `
            <span class="button-symbol">${config.symbol}</span>
            <span class="button-key"></span>
        `;
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
        if (config.tie) {
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

        // Edit buttons (mouse path to the phrase workflow)
        this.copyButton.addEventListener('click', () => {
            this.state.copy();
        });

        this.cutButton.addEventListener('click', () => {
            this.state.copy();
            if (this.state.selection) {
                this.state.deleteSelection();
                this.state.setMode(EditorMode.NORMAL);
            } else {
                this.state.deleteTick();
            }
        });

        this.pasteButton.addEventListener('click', () => {
            this.state.paste();
        });

        this.loopButton.addEventListener('click', () => {
            this.options.onLoop?.();
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

        for (const [key, button] of this.articulationButtons) {
            let on = false;
            if (key === 'effect.tie') on = note?.tie === true;
            else if (key === 'effect.clear') on = !!note && !note.tech && note.tie !== true;
            else on = !!note && note.tech === key;
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
    }

    /**
     * Update mode indicator
     */
    _updateModeIndicator() {
        const mode = this.state.mode;
        const style = MODE_STYLES[mode] || MODE_STYLES[EditorMode.NORMAL];

        this.modeIndicator.textContent = `-- ${style.label} --`;
        this.modeIndicator.style.backgroundColor = style.bg;
        this.modeIndicator.style.color = style.color;
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
        this._unsubPreset?.();
        this._unsubPreset = null;
        this._titled = [];

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        this.element = null;
    }
}
