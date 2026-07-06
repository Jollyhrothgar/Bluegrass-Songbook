// OTF Editor - Main Editor Class
// Coordinates all editor components

import { TabRenderer } from '../renderers/tablature.js';
import { TabPlayer } from '../renderers/tab-player.js';
import { EditorState, EditorMode, DURATIONS, TICKS_PER_BEAT } from './state.js';
import { EditorCursor, positionFromSvgPoint } from './cursor.js';
import { KeyboardHandler } from './keyboard.js';
import { EditorToolbar } from './toolbar.js';
import { NoteEntryPopover } from './popover.js';
import { downloadOTF, cleanupOTF, validateOTF } from './actions.js';
import { EditEventRecorder } from './recorder.js';

/**
 * OTF Editor - Main entry point
 *
 * Usage:
 *   const editor = new OTFEditor({
 *     container: document.getElementById('editor-container'),
 *     otf: existingOTFDocument,  // Optional - edit existing
 *     instrument: '5-string-banjo',  // For new documents
 *     onSave: (otf) => { ... },
 *     onChange: (otf) => { ... },
 *   });
 *
 *   editor.load(otfDocument);  // Load a document
 *   const otf = editor.save(); // Get current document
 *   editor.destroy();          // Clean up
 */
export class OTFEditor {
    constructor(options = {}) {
        this.options = {
            container: null,
            otf: null,
            instrument: '5-string-banjo',
            trackId: null,      // which track of a multi-track OTF to edit
            onSave: null,
            onChange: null,
            ...options,
        };

        if (!this.options.container) {
            throw new Error('OTFEditor requires a container element');
        }

        // Initialize state
        this.state = new EditorState({
            otf: this.options.otf,
            instrument: this.options.instrument,
            trackId: this.options.trackId,
        });

        // Event recorder (must be created before keyboard handler)
        this.recorder = new EditEventRecorder();

        // Components
        this.cursor = new EditorCursor(this.state);
        this.keyboard = new KeyboardHandler(this.state, this.cursor, {
            onSave: () => this._handleSave(),
            onShowHelp: () => this._showHelp(),
            recorder: this.recorder,
        });
        this.toolbar = new EditorToolbar(this.state);
        this.popover = new NoteEntryPopover(this.state, {
            onInsert: (note) => this._handlePopoverInsert(note),
        });

        // Renderer (wrapping existing TabRenderer)
        this.renderer = null;

        // Audio player
        this.player = new TabPlayer();
        this.isPlaying = false;

        // Audio feedback for note entry
        this.audioContext = null;
        this.feedbackEnabled = true;

        // DOM structure
        this.container = this.options.container;
        this.editorRoot = null;
        this.toolbarContainer = null;
        this.canvasContainer = null;
        this.statusBar = null;

        // Initialize
        this._init();
    }

    /**
     * Initialize editor
     */
    _init() {
        // Clear container
        this.container.innerHTML = '';
        this.container.classList.add('otf-editor-container');

        // Create editor structure
        this.editorRoot = document.createElement('div');
        this.editorRoot.className = 'otf-editor';
        this.editorRoot.tabIndex = 0; // Make focusable

        // Toolbar
        this.toolbarContainer = document.createElement('div');
        this.toolbarContainer.className = 'editor-toolbar-container';
        this.editorRoot.appendChild(this.toolbarContainer);

        // Canvas (tablature display)
        this.canvasContainer = document.createElement('div');
        this.canvasContainer.className = 'editor-canvas-container';
        this.editorRoot.appendChild(this.canvasContainer);

        // Status bar
        this.statusBar = document.createElement('div');
        this.statusBar.className = 'editor-status-bar';
        this.editorRoot.appendChild(this.statusBar);

        this.container.appendChild(this.editorRoot);

        // Apply styles
        this._applyStyles();

        // Initialize components
        this.toolbar.render(this.toolbarContainer);

        // Create renderer wrapper
        this.rendererContainer = document.createElement('div');
        this.rendererContainer.className = 'editor-renderer';
        this.canvasContainer.appendChild(this.rendererContainer);

        // Initialize TabRenderer
        this.renderer = new TabRenderer(this.rendererContainer);

        // Cursor/grid overlay draws from the renderer's real geometry
        this.cursor.setRenderer(this.renderer);

        // Initialize cursor overlay
        this.cursor.init(this.canvasContainer);

        // Initialize popover
        this.popover.init(this.container);

        // Attach keyboard handler
        this.keyboard.attach(this.editorRoot);

        // Set up event listeners
        this._setupEventListeners();

        // Initial render
        this._render();
        this._initStatusBar();

        // Focus editor
        this.editorRoot.focus();
    }

    /**
     * Apply editor styles
     */
    _applyStyles() {
        const style = document.createElement('style');
        style.setAttribute('data-otf-editor', '');
        style.textContent = `
            .otf-editor-container {
                width: 100%;
                min-height: 400px;
            }

            .otf-editor {
                display: flex;
                flex-direction: column;
                height: 100%;
                background: var(--bg, #fff);
                border: 1px solid var(--border, #ddd);
                border-radius: 8px;
                overflow: hidden;
                outline: none;
            }

            .otf-editor:focus {
                border-color: var(--accent, #007bff);
                box-shadow: 0 0 0 2px var(--accent-transparent, rgba(0, 123, 255, 0.25));
            }

            .editor-toolbar-container {
                flex-shrink: 0;
            }

            .editor-canvas-container {
                flex: 1;
                position: relative;
                overflow: auto;
                padding: 16px;
                background: var(--bg, #fff);
            }

            .editor-renderer {
                min-height: 200px;
            }

            .editor-status-bar {
                display: flex;
                align-items: center;
                gap: 16px;
                padding: 8px 16px;
                background: var(--bg-secondary, #f5f5f5);
                border-top: 1px solid var(--border, #ddd);
                font-size: 12px;
                color: var(--text-muted, #666);
            }

            .status-item {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .status-label {
                color: var(--text-muted, #888);
            }

            .status-value {
                font-weight: 600;
                color: var(--text, #333);
            }

            .status-separator {
                color: var(--border, #ddd);
            }

            .status-hint {
                margin-left: auto;
                color: var(--text-muted, #888);
            }

            .status-hint kbd {
                display: inline-block;
                padding: 2px 6px;
                font-size: 11px;
                font-family: inherit;
                background: var(--bg, #fff);
                border: 1px solid var(--border, #ddd);
                border-radius: 3px;
            }

            .playback-controls {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-right: auto;
            }

            .play-button, .stop-button {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border: 1px solid var(--border, #ddd);
                border-radius: 50%;
                background: var(--bg, #fff);
                cursor: pointer;
                font-size: 14px;
                transition: all 0.15s ease;
            }

            .play-button:hover, .stop-button:hover {
                background: var(--bg-hover, #e9e9e9);
                border-color: var(--border-hover, #ccc);
            }

            .play-button.playing {
                background: var(--accent, #007bff);
                border-color: var(--accent, #007bff);
                color: #fff;
            }

            .tempo-control {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
            }

            .tempo-control input {
                width: 50px;
                padding: 4px 6px;
                border: 1px solid var(--border, #ddd);
                border-radius: 4px;
                font-size: 12px;
                text-align: center;
            }

            /* Click area for note entry */
            .editor-canvas-container::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
            }
        `;

        if (!document.querySelector('style[data-otf-editor]')) {
            document.head.appendChild(style);
        }
    }

    /**
     * Set up event listeners
     */
    _setupEventListeners() {
        // State change events
        this.state.on('change', () => {
            this._render();
            this.options.onChange?.(this.state.otf);
        });

        // Grid density changes measure width (auto-expand) — re-render
        this.state.on('gridSubdivisionChange', () => {
            this._render();
        });

        this.state.on('cursorMove', () => {
            this._updateStatusBar();
        });

        this.state.on('modeChange', () => {
            this._updateStatusBar();
        });

        this.state.on('durationChange', () => {
            this._updateStatusBar();
        });

        // Audio feedback on note entry
        this.state.on('noteInserted', (data) => {
            if (this.feedbackEnabled) {
                this._playNoteFeedback(data.fret, data.string);
            }
        });

        // Canvas click handling
        this.canvasContainer.addEventListener('click', (e) => {
            this._handleCanvasClick(e);
        });

        this.canvasContainer.addEventListener('dblclick', (e) => {
            this._handleCanvasDblClick(e);
        });

        // Focus management
        this.editorRoot.addEventListener('focus', () => {
            this.editorRoot.classList.add('focused');
        });

        this.editorRoot.addEventListener('blur', () => {
            this.editorRoot.classList.remove('focused');
        });
    }

    /**
     * Handle canvas single click
     */
    _handleCanvasClick(event) {
        // Only handle clicks on the canvas area
        if (!this.canvasContainer.contains(event.target)) return;

        // Hit-test the renderer's real row/measure geometry first — the
        // uniform-grid fallback drifts on variable-width measures and
        // scrolled pages.
        if (this._setCursorFromPoint(event.clientX, event.clientY)) {
            this.editorRoot.focus();
            return;
        }

        // Fallback: uniform mapping relative to the canvas
        const rect = this.canvasContainer.getBoundingClientRect();
        const x = event.clientX - rect.left + this.canvasContainer.scrollLeft;
        const y = event.clientY - rect.top + this.canvasContainer.scrollTop;
        this.cursor.setFromCoordinates(x, y);

        // Focus editor
        this.editorRoot.focus();
    }

    /**
     * Set the cursor from a viewport point via TabRenderer's rowData
     * geometry (per-measure x/width/ticks — ts-aware and layout-true).
     * @returns {boolean} true if a row was hit
     */
    _setCursorFromPoint(clientX, clientY) {
        const rowData = this.renderer?.rowData;
        if (!rowData || rowData.length === 0) return false;

        for (const row of rowData) {
            const svg = row.svg;
            if (!svg?.getBoundingClientRect) continue;
            const rect = svg.getBoundingClientRect();
            if (clientY < rect.top || clientY > rect.bottom) continue;
            if (rect.width === 0 || rect.height === 0) continue;

            // Viewport → SVG user units (CSS may scale via --tab-scale)
            const vb = svg.viewBox?.baseVal;
            const scaleX = vb?.width ? rect.width / vb.width : 1;
            const scaleY = vb?.height ? rect.height / vb.height : 1;
            const x = (clientX - rect.left) / scaleX;
            const y = (clientY - rect.top) / scaleY;

            const opt = this.renderer.options || {};
            const pos = positionFromSvgPoint(row.measures, x, y, {
                topMargin: opt.topMargin ?? 30,
                stringSpacing: opt.stringSpacing ?? 15,
                stringCount: this.state.getStringCount(),
                gridSubdivision: this.state.gridSubdivision,
            });
            if (!pos) return false;

            this.state.cursor.measure = pos.measure;
            this.state.cursor.tick = pos.tick;
            this.state.cursor.string = pos.string;
            this.cursor.update();
            this.state._emit('cursorMove', this.state.cursor);
            return true;
        }
        return false;
    }

    /**
     * Handle canvas double click
     */
    _handleCanvasDblClick(event) {
        if (!this.canvasContainer.contains(event.target)) return;

        // Get click position
        const rect = this.canvasContainer.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Open note entry popover
        this.popover.open(x, y, {
            string: this.state.cursor.string,
            fret: this.state.getNoteAtCursor()?.f || 0,
        });
    }

    /**
     * Handle popover insert
     */
    _handlePopoverInsert(note) {
        this.state.cursor.string = note.string;
        this.state.insertNote(note.fret, { tech: note.tech });

        // Advance cursor
        this.cursor.moveByDuration(1);

        // Focus editor
        this.editorRoot.focus();
    }

    /**
     * Handle save
     */
    _handleSave() {
        const otf = this.save();
        this.options.onSave?.(otf);
    }

    /**
     * Show keyboard shortcut help
     */
    _showHelp() {
        // Could open a modal with keyboard shortcuts
        // For now, log to console
        console.log('OTF Editor Keyboard Shortcuts:');
        console.log('  Navigation: h/j/k/l or arrow keys');
        console.log('  Modes: i (insert), v (visual), r (roll), A (annotation)');
        console.log('  Insert: 0-9 for frets, q/e/s for durations');
        console.log('  Edit: x (delete note), dd (delete tick), u (undo)');
        console.log('  Press ? for more help');
    }

    /**
     * Render tablature
     */
    _render() {
        const track = this.state.getCurrentTrack();
        const notation = this.state.getNotation();

        if (!track || !notation) return;

        // Render using TabRenderer, with the facade's ts-aware timing so
        // mid-tune signature changes get correct measure lengths + glyphs
        const ticksPerBeat = this.state.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;
        const timeSignature = this.state.otf.metadata?.time_signature || '4/4';

        // Auto-expand for fine entry grids: guarantee each grid slot a
        // minimum pixel width so 1/16 and 1/32 grids stay usable
        // (measureWidthFloor beats maxMeasureWidth; rows scroll if needed)
        const MIN_PX_PER_GRID_SLOT = 9;
        const defaultTicks = this.state.facade.measureTiming.defaultTicks;
        const slots = defaultTicks / this.state.gridSubdivision;
        this.renderer.options.measureWidthFloor =
            Math.ceil(slots * MIN_PX_PER_GRID_SLOT + 30); // +30 = note-area margins

        this.renderer.render(track, notation, ticksPerBeat, timeSignature,
            this.state.facade.timing);

        // Geometry-based overlays can refresh synchronously — reading
        // rects after the DOM mutation forces reflow, so the grid and
        // cursor never lag the tablature by a frame (rAF is throttled
        // in background tabs and always a frame or two late).
        this.cursor.update();
        this.cursor.renderGrid();

        // Update cursor layout info after DOM is fully painted
        // Use double-RAF to ensure layout is complete
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._updateCursorLayout();
            });
        });
    }

    /**
     * Update cursor with layout information from renderer
     */
    _updateCursorLayout() {
        // Get the first stave-row to measure actual DOM positions
        const firstRowEl = this.rendererContainer.querySelector('.stave-row');
        // Measure relative to canvasContainer (where cursor overlay is positioned)
        const containerRect = this.canvasContainer.getBoundingClientRect();

        // Measure actual position of first SVG relative to canvasContainer
        // (SVG is more accurate than row div which may have margins/padding)
        let firstRowTop = 0;
        let firstRowLeft = 0;
        const firstSvg = firstRowEl?.querySelector('svg');
        if (firstSvg) {
            const svgRect = firstSvg.getBoundingClientRect();
            firstRowTop = svgRect.top - containerRect.top;
            firstRowLeft = svgRect.left - containerRect.left;
        } else if (firstRowEl) {
            const rowRect = firstRowEl.getBoundingClientRect();
            firstRowTop = rowRect.top - containerRect.top;
            firstRowLeft = rowRect.left - containerRect.left;
        }

        // Get SVG scale if applied (from --tab-scale CSS variable)
        let scale = 1;
        if (firstSvg) {
            const transform = window.getComputedStyle(firstSvg).transform;
            if (transform && transform !== 'none') {
                const match = transform.match(/matrix\(([^,]+)/);
                if (match) scale = parseFloat(match[1]);
            }
        }

        // Measure actual row height from DOM (including margins)
        const staveRows = this.rendererContainer.querySelectorAll('.stave-row');
        let actualRowHeight = 0;
        if (staveRows.length >= 2) {
            const row1 = staveRows[0].getBoundingClientRect();
            const row2 = staveRows[1].getBoundingClientRect();
            actualRowHeight = row2.top - row1.top;
        } else if (firstRowEl) {
            // Single row - estimate from SVG height
            actualRowHeight = firstRowEl.offsetHeight;
        }

        // Extract layout info from renderer, with scale applied
        const opt = this.renderer.options;
        const layoutInfo = {
            leftMargin: opt.leftMargin * scale,
            topMargin: opt.topMargin * scale,
            stringSpacing: opt.stringSpacing * scale,
            measureWidth: this.renderer._computedMeasureWidth * scale,
            measuresPerRow: this.renderer._computedMeasuresPerRow,
            ticksPerMeasure: this.state.ticksPerMeasure,
            rowHeight: actualRowHeight || ((opt.topMargin +
                       (this.state.getStringCount() - 1) * opt.stringSpacing +
                       opt.stemAreaHeight + 50) * scale),
            noteAreaStart: 15 * scale,
            noteAreaWidth: (this.renderer._computedMeasureWidth - 30) * scale,
            // Use actual measured offsets to first row
            trackInfoOffset: firstRowTop,
            rowLeftOffset: firstRowLeft,
        };

        this.cursor.setLayoutInfo(layoutInfo);
    }

    /**
     * Initialize status bar (called once)
     */
    _initStatusBar() {
        const tempo = this.state.otf.metadata?.tempo || 120;

        this.statusBar.innerHTML = `
            <div class="playback-controls">
                <button class="play-button" title="Play/Pause">▶</button>
                <button class="stop-button" title="Stop">⏹</button>
                <div class="tempo-control">
                    <span>BPM:</span>
                    <input type="number" class="tempo-input" value="${tempo}" min="40" max="280" step="5">
                </div>
            </div>
            <span class="status-item">
                <span class="status-label">Mode:</span>
                <span class="status-value" data-field="mode">NORMAL</span>
            </span>
            <span class="status-separator">|</span>
            <span class="status-item">
                <span class="status-label">M:</span>
                <span class="status-value" data-field="measure">1</span>
            </span>
            <span class="status-separator">|</span>
            <span class="status-item">
                <span class="status-label">Beat:</span>
                <span class="status-value" data-field="beat">1</span>
            </span>
            <span class="status-separator">|</span>
            <span class="status-item">
                <span class="status-label">String:</span>
                <span class="status-value" data-field="string">1</span>
            </span>
            <span class="status-separator">|</span>
            <span class="status-item">
                <span class="status-label">Duration:</span>
                <span class="status-value" data-field="duration">8th</span>
            </span>
            <span class="status-hint">
                Press <kbd>?</kbd> for help
            </span>
        `;

        // Wire up playback controls (once)
        this._wirePlaybackControls();

        // Initial update
        this._updateStatusBar();
    }

    /**
     * Update status bar values (called on state changes)
     */
    _updateStatusBar() {
        const { cursor, mode, currentDuration } = this.state;
        const ticksPerBeat = this.state.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;

        // Calculate beat position
        const beat = Math.floor(cursor.tick / ticksPerBeat) + 1;
        const subBeat = Math.round((cursor.tick % ticksPerBeat) / (ticksPerBeat / 4));

        // Mode indicator colors
        const modeColors = {
            normal: '',
            visual: 'color: #007bff;',
            annotation: 'color: #6f42c1;',
        };

        // Update only the dynamic fields
        const modeEl = this.statusBar.querySelector('[data-field="mode"]');
        const measureEl = this.statusBar.querySelector('[data-field="measure"]');
        const beatEl = this.statusBar.querySelector('[data-field="beat"]');
        const stringEl = this.statusBar.querySelector('[data-field="string"]');
        const durationEl = this.statusBar.querySelector('[data-field="duration"]');

        if (modeEl) {
            modeEl.textContent = mode.toUpperCase();
            modeEl.style.cssText = modeColors[mode] || '';
        }
        if (measureEl) measureEl.textContent = cursor.measure;
        if (beatEl) beatEl.textContent = beat + (subBeat > 0 ? '.' + subBeat : '');
        if (stringEl) stringEl.textContent = cursor.string;
        if (durationEl) durationEl.textContent = this._getDurationName(currentDuration);
    }

    /**
     * Update play button state
     */
    _updatePlayButton() {
        const playBtn = this.statusBar.querySelector('.play-button');
        if (playBtn) {
            playBtn.textContent = this.isPlaying ? '⏸' : '▶';
            playBtn.classList.toggle('playing', this.isPlaying);
        }
    }

    /**
     * Get duration display name
     */
    _getDurationName(duration) {
        const names = {
            [DURATIONS.whole]: 'Whole',
            [DURATIONS.half]: 'Half',
            [DURATIONS.quarter]: 'Quarter',
            [DURATIONS.eighth]: '8th',
            [DURATIONS.sixteenth]: '16th',
            [DURATIONS.thirtySecond]: '32nd',
            [DURATIONS.tripletEighth]: 'Triplet',
        };
        return names[duration] || 'Unknown';
    }

    /**
     * Wire up playback control event listeners
     */
    _wirePlaybackControls() {
        const playBtn = this.statusBar.querySelector('.play-button');
        const stopBtn = this.statusBar.querySelector('.stop-button');
        const tempoInput = this.statusBar.querySelector('.tempo-input');

        if (playBtn) {
            playBtn.addEventListener('click', () => {
                this.togglePlayback();
                this.editorRoot.focus();
            });
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                this.stop();
                this.editorRoot.focus();
            });
        }

        if (tempoInput) {
            // Handle tempo changes
            tempoInput.addEventListener('change', (e) => {
                const tempo = parseInt(e.target.value, 10);
                if (tempo >= 40 && tempo <= 280) {
                    this.state.otf.metadata.tempo = tempo;
                }
            });

            // Return focus to editor on blur
            tempoInput.addEventListener('blur', () => {
                this.editorRoot.focus();
            });

            // Prevent keyboard events from propagating to editor while in input
            tempoInput.addEventListener('keydown', (e) => {
                e.stopPropagation();
                // Enter key blurs the input
                if (e.key === 'Enter') {
                    tempoInput.blur();
                }
            });
        }
    }

    /**
     * Toggle playback
     */
    async togglePlayback() {
        if (this.isPlaying) {
            this.stop();
        } else {
            await this.play();
        }
    }

    /**
     * Start playback
     */
    async play() {
        if (this.isPlaying) return;

        const otf = this.state.export();

        // Set up visualization callbacks
        this.player.onTick = (absTick) => {
            this.renderer.updateBeatCursor(absTick, { autoScroll: true });
        };

        this.player.onNoteStart = (absTick) => {
            this.renderer.highlightNote(absTick);
        };

        this.player.onNoteEnd = (absTick) => {
            this.renderer.clearNoteHighlight(absTick);
        };

        this.player.onPlaybackEnd = () => {
            this.isPlaying = false;
            this.renderer.resetPlaybackVisualization();
            this._updatePlayButton();
        };

        try {
            await this.player.play(otf, {
                tempo: otf.metadata?.tempo || 120,
            });
            this.isPlaying = true;
            this._updatePlayButton();
        } catch (error) {
            console.error('Playback error:', error);
            this.isPlaying = false;
            this._updatePlayButton();
        }
    }

    /**
     * Stop playback
     */
    stop() {
        if (!this.isPlaying) return;

        this.player.stop();
        this.isPlaying = false;
        this.renderer.resetPlaybackVisualization();
        this._updatePlayButton();
    }

    /**
     * Play audio feedback for note entry
     * @param {number} fret - Fret number
     * @param {number} string - String number (1-indexed)
     */
    _playNoteFeedback(fret, string) {
        // Initialize AudioContext on first use (browser autoplay policy)
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Get string tuning to calculate pitch
        const track = this.state.getCurrentTrack();
        const tuning = track?.tuning || ['D4', 'B3', 'G3', 'D3', 'G4'];
        const stringPitch = tuning[string - 1] || 'G3';

        // Parse pitch to frequency
        const freq = this._pitchToFrequency(stringPitch, fret);

        // Create oscillator for short pluck sound
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'triangle';
        osc.frequency.value = freq;

        // Quick attack, short decay (pluck-like envelope)
        const now = this.audioContext.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        osc.start(now);
        osc.stop(now + 0.15);
    }

    /**
     * Convert pitch name and fret to frequency
     * @param {string} pitch - Pitch name like "G3" or "D4"
     * @param {number} fret - Fret number
     * @returns {number} - Frequency in Hz
     */
    _pitchToFrequency(pitch, fret) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const match = pitch.match(/^([A-G]#?)(\d)$/);
        if (!match) return 440; // Default to A4

        const [, note, octaveStr] = match;
        const octave = parseInt(octaveStr, 10);
        const noteIndex = noteNames.indexOf(note);

        // Calculate semitones from A4 (440 Hz)
        const semitonesFromA4 = (octave - 4) * 12 + (noteIndex - 9) + fret;

        return 440 * Math.pow(2, semitonesFromA4 / 12);
    }

    // ========================================
    // Public API
    // ========================================

    /**
     * Load an OTF document
     * @param {Object} otf - OTF document to load
     */
    load(otf) {
        // Validate
        const validation = validateOTF(otf);
        if (!validation.valid) {
            console.warn('OTF validation warnings:', validation.errors);
        }

        this.state.load(otf);
        this._render();
        this._initStatusBar();
    }

    /**
     * Save and return the current OTF document
     * @returns {Object} - Cleaned OTF document
     */
    save() {
        return cleanupOTF(this.state.export());
    }

    /**
     * Download the current document as JSON
     * @param {string} filename - Optional filename
     */
    download(filename) {
        const otf = this.save();
        const name = filename || otf.metadata?.title?.toLowerCase().replace(/\s+/g, '-') || 'untitled';
        downloadOTF(otf, name);
    }

    /**
     * Get current selection
     * @returns {Object|null} - Selection range or null
     */
    getSelection() {
        return this.state.selection;
    }

    /**
     * Set editor mode
     * @param {string} mode - EditorMode value
     */
    setMode(mode) {
        this.state.setMode(mode);
    }

    /**
     * Undo last action
     */
    undo() {
        this.state.undo();
    }

    /**
     * Redo last undone action
     */
    redo() {
        this.state.redo();
    }

    /**
     * Focus the editor
     */
    focus() {
        this.editorRoot?.focus();
    }

    // ========================================
    // Recording API
    // ========================================

    /**
     * Start recording edit events
     * @param {Object} metadata - Optional metadata for the recording
     */
    startRecording(metadata = {}) {
        const otf = this.state.otf;
        this.recorder.start({
            title: otf.metadata?.title,
            instrument: this.state.getCurrentTrack()?.instrument,
            timeSignature: otf.metadata?.time_signature,
            ...metadata,
        });
    }

    /**
     * Stop recording
     */
    stopRecording() {
        this.recorder.stop();
    }

    /**
     * Check if currently recording
     * @returns {boolean}
     */
    get isRecording() {
        return this.recorder.recording;
    }

    /**
     * Export recording as JSON string
     * @returns {string}
     */
    exportRecording() {
        return this.recorder.export();
    }

    /**
     * Import and replay a recording
     * @param {string|Object} data - Recording JSON
     * @param {Object} options - Replay options
     * @returns {Promise<{completed: number, total: number}>}
     */
    async importAndReplay(data, options = {}) {
        const imported = EditEventRecorder.fromJSON(data);
        return imported.replay(this, options);
    }

    /**
     * Destroy the editor and clean up
     */
    destroy() {
        // Stop playback
        if (this.isPlaying) {
            this.stop();
        }

        // Clean up components
        this.keyboard.detach();
        this.cursor.destroy();
        this.toolbar.destroy();
        this.popover.destroy();
        this.renderer?.destroy();

        // Clear container
        this.container.innerHTML = '';
        this.container.classList.remove('otf-editor-container');

        // Clear references
        this.state = null;
        this.cursor = null;
        this.keyboard = null;
        this.toolbar = null;
        this.popover = null;
        this.renderer = null;
        this.player = null;
    }
}
