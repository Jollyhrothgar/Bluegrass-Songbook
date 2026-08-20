// OTF Editor Toolbar
// Duration selector, articulation buttons, mode indicator

import { DURATIONS, DURATION_NAMES, EditorMode } from './state.js';

/**
 * Duration button configuration
 */
// Plain-text symbols: the previous SMuFL codepoints (\uD834\uDD5D \uD834\uDD57\uD834\uDD65 \u2026) rendered
// as blank boxes without a music font \u2014 users concluded whole/half/
// quarter notes didn't exist.
const DURATION_BUTTONS = [
    { duration: DURATIONS.whole, symbol: '1', label: 'Whole', key: 'W' },
    { duration: DURATIONS.half, symbol: '1/2', label: 'Half', key: 'H' },
    { duration: DURATIONS.quarter, symbol: '1/4', label: 'Quarter', key: 'q' },
    { duration: DURATIONS.eighth, symbol: '1/8', label: 'Eighth', key: 'e' },
    { duration: DURATIONS.sixteenth, symbol: '1/16', label: 'Sixteenth', key: 's' },
    { duration: DURATIONS.thirtySecond, symbol: '1/32', label: '32nd', key: 't' },
];

/**
 * Grid subdivision button configuration
 */
const GRID_BUTTONS = [
    { subdivision: DURATIONS.quarter, label: '1/4', key: 'Shift+Q' },
    { subdivision: DURATIONS.eighth, label: '1/8', key: 'Shift+E' },
    { subdivision: DURATIONS.sixteenth, label: '1/16', key: 'Shift+S' },
    { subdivision: DURATIONS.thirtySecond, label: '1/32', key: 'Shift+T' },
    { subdivision: DURATIONS.tripletEighth, label: 'Trip', key: 'Shift+3' },
];

/**
 * Articulation button configuration
 */
const ARTICULATION_BUTTONS = [
    { tech: 'h', label: 'Hammer-on', key: 'Ctrl+H' },
    { tech: 'p', label: 'Pull-off', key: 'Ctrl+P' },
    { tech: '/', label: 'Slide', key: 'Ctrl+/' },
    { tech: '~', label: 'Tie', key: 'Ctrl+T' },
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

        // Bind event handlers
        this._onDurationChange = this._onDurationChange.bind(this);
        this._onModeChange = this._onModeChange.bind(this);
        this._onTripletModeChange = this._onTripletModeChange.bind(this);
        this._onPendingArticulationChange = this._onPendingArticulationChange.bind(this);
        this._onGridSubdivisionChange = this._onGridSubdivisionChange.bind(this);
        this._onGridToggle = this._onGridToggle.bind(this);
        this._onTracksChange = this._onTracksChange.bind(this);
    }

    /**
     * Create and render toolbar
     * @param {HTMLElement} container - Container to append toolbar to
     */
    render(container) {
        this.element = document.createElement('div');
        this.element.className = 'otf-editor-toolbar';
        this.element.innerHTML = `
            <div class="toolbar-section mode-section">
                <div class="mode-indicator"></div>
            </div>
            <div class="toolbar-separator"></div>
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
            <div class="toolbar-separator track-section-sep" style="display:none"></div>
            <div class="toolbar-section duration-section">
                <span class="toolbar-label">Duration</span>
                <div class="button-group duration-buttons"></div>
                <button class="toolbar-button rest-button" title="Rest — advance one duration without a note (Space)">
                    <span class="button-content">Rest</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section grid-section">
                <span class="toolbar-label">Grid</span>
                <div class="button-group grid-buttons"></div>
                <button class="toolbar-button grid-toggle-button" title="Toggle grid (G)">
                    <span class="button-icon">▦</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section triplet-section">
                <button class="toolbar-button triplet-button" title="Triplet mode (3)">
                    <span class="button-content">3</span>
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
                <button class="toolbar-button annotation-button" title="Add or edit the placed text at the cursor — section labels, playing notes, chord names (c)">
                    <span class="button-content">Aa</span>
                </button>
                <button class="toolbar-button annotation-delete-button" title="Delete the placed text at the cursor (Shift+C)">
                    <span class="button-icon">⌫</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section edit-section">
                <button class="toolbar-button copy-button" title="Copy selection (y, Cmd+C)">
                    <span class="button-icon">⧉</span>
                </button>
                <button class="toolbar-button cut-button" title="Cut selection (Cmd+X)">
                    <span class="button-icon">✂</span>
                </button>
                <button class="toolbar-button paste-button" title="Paste at cursor (p, Cmd+V)">
                    <span class="button-icon">📋</span>
                </button>
                <button class="toolbar-button loop-button" title="Loop selection / play from cursor (L)">
                    <span class="button-icon">🔁</span>
                </button>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-section history-section">
                <button class="toolbar-button undo-button" title="Undo (u)">
                    <span class="button-icon">↩</span>
                </button>
                <button class="toolbar-button redo-button" title="Redo (Ctrl+R)">
                    <span class="button-icon">↪</span>
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
            this.articulationButtons.set(config.tech, button);
            articulationContainer.appendChild(button);
        }

        // Set up event listeners
        this._setupEventListeners();

        // Update initial state
        this._updateDurationSelection();
        this._updateGridSelection();
        this._updateGridToggle();
        this._updateModeIndicator();

        container.appendChild(this.element);
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

            .triplet-button.active {
                background: var(--warning, #fd7e14);
                border-color: var(--warning, #fd7e14);
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
        button.title = `${config.label} (${config.key})`;
        button.innerHTML = `
            <span class="button-symbol">${config.symbol}</span>
            <span class="button-key">${config.key}</span>
        `;

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
        button.title = `Grid: ${config.label} (${config.key})`;
        button.textContent = config.label;

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
        button.title = `${config.label} (${config.key})`;
        button.textContent = config.tech;

        button.addEventListener('click', () => {
            if (this.state.pendingArticulation === config.tech) {
                this.state.setPendingArticulation(null);
            } else {
                this.state.setPendingArticulation(config.tech);
            }
        });

        return button;
    }

    /**
     * Set up state event listeners
     */
    _setupEventListeners() {
        this.state.on('durationChange', this._onDurationChange);
        this.state.on('modeChange', this._onModeChange);
        this.state.on('tripletModeChange', this._onTripletModeChange);
        this.state.on('pendingArticulationChange', this._onPendingArticulationChange);
        this.state.on('gridSubdivisionChange', this._onGridSubdivisionChange);
        this.state.on('gridToggle', this._onGridToggle);
        // 'change' covers rename / reorder / undo / redo / load in one
        // subscription; the signature check inside makes it a no-op for
        // the note edits that fire it constantly.
        this.state.on('change', this._onTracksChange);
        this.state.on('trackChange', this._onTracksChange);

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

        // Triplet button
        this.tripletButton.addEventListener('click', () => {
            this.state.toggleTripletMode();
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

    /**
     * Handle pending articulation change
     */
    _onPendingArticulationChange(tech) {
        for (const [artTech, button] of this.articulationButtons) {
            button.classList.toggle('pending', artTech === tech);
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

    /**
     * Update duration button selection
     */
    _updateDurationSelection() {
        const current = this.state.currentDuration;
        for (const [duration, button] of this.durationButtons) {
            button.classList.toggle('active', duration === current);
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
        this.state.off('pendingArticulationChange', this._onPendingArticulationChange);
        this.state.off('gridSubdivisionChange', this._onGridSubdivisionChange);
        this.state.off('gridToggle', this._onGridToggle);
        this.state.off('change', this._onTracksChange);
        this.state.off('trackChange', this._onTracksChange);

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        this.element = null;
    }
}
