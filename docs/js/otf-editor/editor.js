// OTF Editor - Main Editor Class
// Coordinates all editor components

import { TabRenderer } from '../renderers/tablature.js';
import {
    TabPlayer, PITCH_TO_MIDI, INSTRUMENTS, getInstrumentKey,
} from '../renderers/tab-player.js';
import { EditorState, EditorMode, DURATIONS, TICKS_PER_BEAT } from './state.js';
import { EditorCursor, positionFromSvgPoint } from './cursor.js';
import {
    prepareCompactNotation, readingListTimeline, TimelineTiming,
    maxMeasureIn, makePlaybackToVisualMapper, densifyNotation,
    attachOtfDecorations,
} from '../renderers/measure-timing.js';
import { KeyboardHandler } from './keyboard.js';
import { EditorToolbar } from './toolbar.js';
import { NoteEntryPopover, AnnotationPopover } from './popover.js';
import { downloadOTF, cleanupOTF, validateOTF } from './actions.js';
import { ContextMenu } from './context-menu.js';
import { EditEventRecorder } from './recorder.js';

// Note-entry feedback: a short pluck of the SAME sampled voice playback
// uses. Volume matches TabPlayer's default mixer so typing a note and
// hearing it back sound like one instrument, not two.
const FEEDBACK_DURATION_SEC = 0.4;
const FEEDBACK_VOLUME = 0.7;
const DEFAULT_FEEDBACK_TUNING = ['D4', 'B3', 'G3', 'D3', 'G4'];

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
            // fillHeight: the host gives the editor a definite height, so
            // the TAB scrolls inside the editor and the chrome (toolbar,
            // transport) is pinned instead of scrolling off with the page.
            fillHeight: false,
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
            onPlayFromCursor: () => this.playFromCursor(),
            onLoopSelection: () => this.loopSelection(),
            onEditAnnotation: () => this.editAnnotationAtCursor(),
            recorder: this.recorder,
        });
        this.toolbar = new EditorToolbar(this.state, {
            onLoop: () => this.loopSelection(),
            onRest: () => this.cursor.moveByDuration(1),
            onEditAnnotation: () => this.editAnnotationAtCursor(),
            onDeleteAnnotation: () => this.deleteAnnotationAtCursor(),
        });
        // Menu actions refocus the editor afterwards — otherwise the
        // keyboard is dead after any mouse-menu action (focus stays on
        // the clicked menu button's ghost)
        const refocus = (fn) => () => {
            fn();
            this.editorRoot?.focus();
        };
        this.contextMenu = new ContextMenu({
            copy: refocus(() => this.state.copy()),
            cut: refocus(() => this._cutSelectionOrTick()),
            paste: refocus(() => this.state.paste()),
            delete: refocus(() => {
                if (this.state.selection) {
                    this.state.deleteSelection();
                    this.state.setMode(EditorMode.NORMAL);
                } else {
                    this.state.deleteNote();
                }
            }),
            loop: refocus(() => this.loopSelection()),
            play: refocus(() => this.playFromCursor()),
            repeat: refocus(() => this._repeatSelectedMeasures(true)),
            unrepeat: refocus(() => this._repeatSelectedMeasures(false)),
        });
        this.popover = new NoteEntryPopover(this.state, {
            onInsert: (note) => this._handlePopoverInsert(note),
        });
        // Placed free text ("PART A", "Long Choke", chord names) — a
        // sibling prompt of the note popover, anchored to the cursor
        this.annotationPopover = new AnnotationPopover({
            onCommit: (text) => this._commitAnnotation(text),
            onDelete: () => this.deleteAnnotationAtCursor(),
            onCancel: () => this.editorRoot?.focus(),
        });

        // Renderer (wrapping existing TabRenderer)
        this.renderer = null;

        // Audio player
        this.player = new TabPlayer();
        this.isPlaying = false;

        // Audio feedback for note entry. It shares the player's context and
        // soundfonts — see _playNoteFeedback.
        this.audioContext = null;
        this.feedbackEnabled = true;
        this._warmedVoices = new Set();

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
        if (this.options.fillHeight) {
            this.container.classList.add('otf-editor-fill');
        }

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

        // Toolbar buttons must not steal keyboard focus — after any
        // toolbar click, keys should keep driving the editor
        this.toolbarContainer.addEventListener('click', () => {
            this.editorRoot.focus();
        });

        // Create renderer wrapper
        this.rendererContainer = document.createElement('div');
        this.rendererContainer.className = 'editor-renderer';
        this.canvasContainer.appendChild(this.rendererContainer);

        // Initialize TabRenderer
        this.renderer = new TabRenderer(this.rendererContainer);

        // Cursor/grid overlay draws from the renderer's real geometry
        this.cursor.setRenderer(this.renderer);

        // Editing wants a STABLE tick→x mapping: per-measure note
        // centering makes the ruler break period at every barline
        this.renderer.options.centerNotes = false;

        // Rest glyphs are an ENTRY aid — show them here. The reading
        // view keeps TablEdit's tab-staff convention (no rests).
        this.renderer.options.showRests = true;

        // Follow EVERY renderer layout pass — including its own async
        // re-renders (resize observer, Bravura arrival), which otherwise
        // leave the grid/cursor overlays drawn from stale geometry
        this.renderer.onAfterRender = () => {
            if (!this.cursor) return; // during destroy
            this.cursor.update();
            this.cursor.renderGrid();
        };

        // Initialize cursor overlay
        this.cursor.init(this.canvasContainer);

        // Initialize popovers
        this.popover.init(this.container);
        this.annotationPopover.init(this.container);

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
                position: relative; /* anchors the help overlay */
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
                flex-wrap: wrap;
                flex-shrink: 0;
                gap: 16px;
                padding: 8px 16px;
                background: var(--bg-secondary, #f5f5f5);
                border-top: 1px solid var(--border, #ddd);
                font-size: 12px;
                color: var(--text-muted, #666);
            }

            /* ── Fill mode ─────────────────────────────────────────────
               The host hands the editor a definite height (a flex/grid
               track, not content). Chrome is pinned top and bottom and
               ONLY the tab scrolls — so the page itself never scrolls
               the toolbar or the transport out of reach.
               min-height:0 everywhere is load-bearing: a flex item's
               default min-height:auto refuses to shrink below its
               content, which is exactly how a "scrolling region" grows
               the page instead of scrolling. */
            .otf-editor-container.otf-editor-fill {
                height: 100%;
                min-height: 0;
            }

            .otf-editor-fill .otf-editor {
                height: 100%;
                min-height: 0;
                border-radius: 0;
                border-width: 1px 0 0 0;
            }

            /* Visual order: tab, then toolbar, then transport. DOM order
               is unchanged, so focus/reading order still starts with the
               toolbar. */
            .otf-editor-fill .editor-canvas-container {
                order: 1;
                min-height: 0;
                overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
            }

            .otf-editor-fill .editor-toolbar-container { order: 2; }
            .otf-editor-fill .editor-status-bar { order: 3; }

            /* The toolbar's divider now faces the tab above it */
            .otf-editor-fill .otf-editor-toolbar {
                border-bottom: 0;
                border-top: 1px solid var(--border, #ddd);
            }

            @media (max-width: 640px) {
                .otf-editor-fill .editor-canvas-container { padding: 8px; }
                .otf-editor-fill .editor-status-bar {
                    gap: 8px;
                    padding: 6px 8px;
                }
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

            /* Keyboard-shortcut help overlay (?) */
            .editor-help-overlay {
                position: absolute;
                inset: 0;
                z-index: 50;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.45);
                outline: none;
            }

            .editor-help-panel {
                background: var(--bg, #fff);
                color: var(--text, #111);
                border: 1px solid var(--border, #ccc);
                border-radius: 10px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
                padding: 16px 20px;
                max-width: 640px;
                max-height: 80%;
                overflow: auto;
            }

            .editor-help-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }

            .editor-help-close {
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: inherit;
            }

            .editor-help-cols {
                display: flex;
                gap: 24px;
                flex-wrap: wrap;
            }

            .editor-help-cols dl { margin: 0; min-width: 240px; flex: 1; }
            .editor-help-cols dt { font-weight: 600; margin-top: 10px; }
            .editor-help-cols dd { margin: 2px 0 0 0; font-size: 13px; line-height: 1.7; }
            .editor-help-panel kbd {
                border: 1px solid var(--border, #ccc);
                border-radius: 4px;
                padding: 0 5px;
                font-size: 12px;
                background: var(--bg-secondary, #f5f5f5);
            }
            .editor-help-foot {
                margin-top: 12px;
                font-size: 12px;
                opacity: 0.7;
                text-align: center;
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
            // The status bar reads from the document too (placed text at
            // the cursor), so undo/redo must refresh it as well
            this._updateStatusBar();
            // Undo/redo can move the tempo — keep the input honest
            const tempoInput = this.statusBar?.querySelector('.tempo-input');
            if (tempoInput && document.activeElement !== tempoInput) {
                const t = this.state.otf?.metadata?.tempo;
                if (t) tempoInput.value = t;
            }
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
            if (this._suppressNextClick) {
                this._suppressNextClick = false; // a drag just ended
                return;
            }
            this._handleCanvasClick(e);
        });

        this.canvasContainer.addEventListener('dblclick', (e) => {
            this._handleCanvasDblClick(e);
        });

        // Right-click: context menu at the pointer. Outside the current
        // selection the cursor moves there first (menu acts on the spot);
        // inside it, the selection is preserved (menu acts on the phrase).
        this.canvasContainer.addEventListener('contextmenu', (e) => {
            if (!this.canvasContainer.contains(e.target)) return;
            e.preventDefault();
            const pos = this._positionFromPoint(e.clientX, e.clientY);
            if (pos) {
                const sel = this._selectionAbsRange();
                const abs = this.state.facade.toAbs(pos.measure, pos.tick);
                if (!sel || abs < sel.startAbs || abs >= sel.endAbs) {
                    if (this.state.mode === EditorMode.VISUAL) {
                        this.state.setMode(EditorMode.NORMAL);
                    }
                    this.state.cursor.measure = pos.measure;
                    this.state.cursor.tick = pos.tick;
                    this.state.cursor.string = pos.string;
                    this.cursor.update();
                    this.state._emit('cursorMove', this.state.cursor);
                }
            }
            this.contextMenu.open(e.clientX, e.clientY, {
                hasSelection: !!this.state.selection,
                hasClipboard: !!(this.state.clipboard?.data?.length),
            });
        });

        // Drag-select (mouse path to phrase selection). Move/up listen on
        // the document so drags survive leaving the canvas.
        this._drag = null;
        this._suppressNextClick = false;
        this._boundDragMove = (e) => this._handleDragMove(e);
        this._boundDragEnd = (e) => this._handleDragEnd(e);
        this.canvasContainer.addEventListener('mousedown', (e) => this._handleDragStart(e));
        document.addEventListener('mousemove', this._boundDragMove);
        document.addEventListener('mouseup', this._boundDragEnd);

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
     * Map a viewport point to an edit position via TabRenderer's rowData
     * geometry (per-measure x/width/ticks — ts-aware and layout-true).
     * @returns {{measure, tick, string}|null}
     */
    _positionFromPoint(clientX, clientY) {
        const rowData = this.renderer?.rowData;
        if (!rowData || rowData.length === 0) return null;

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
            return positionFromSvgPoint(row.measures, x, y, {
                topMargin: opt.topMargin ?? 30,
                stringSpacing: opt.stringSpacing ?? 15,
                stringCount: this.state.getStringCount(),
                gridSubdivision: this.state.gridSubdivision,
            });
        }
        return null;
    }

    /**
     * Set the cursor from a viewport point.
     * @returns {boolean} true if a row was hit
     */
    _setCursorFromPoint(clientX, clientY) {
        const pos = this._positionFromPoint(clientX, clientY);
        if (!pos) return false;
        this.state.cursor.measure = pos.measure;
        this.state.cursor.tick = pos.tick;
        this.state.cursor.string = pos.string;
        this.cursor.update();
        this.state._emit('cursorMove', this.state.cursor);
        return true;
    }

    /**
     * Repeat (or un-repeat) the WHOLE MEASURES the selection touches.
     * Repeat signs derive from the reading list, so this is a facade
     * reading_list op — undoable, and playback unrolls it.
     */
    _repeatSelectedMeasures(add) {
        if (!this.state.selection) return;
        const { start, end } = this.state.selection.getNormalized(this.state.ticksPerMeasure);
        const ok = add
            ? this.state.facade.repeatSpan(start.measure, end.measure)
            : this.state.facade.removeRepeat(start.measure, end.measure);
        if (ok) {
            this.state.setMode(EditorMode.NORMAL);
        }
    }

    /**
     * Cut: the selection when there is one, else the event at the cursor.
     */
    _cutSelectionOrTick() {
        this.state.copy();
        if (this.state.selection) {
            this.state.deleteSelection();
            this.state.setMode(EditorMode.NORMAL);
        } else {
            this.state.deleteTick();
        }
    }

    /**
     * The current selection as an absolute tick range (end inclusive of
     * its slot — extended one grid step), or null.
     */
    _selectionAbsRange() {
        if (!this.state.selection) return null;
        const { start, end } = this.state.selection.getNormalized(this.state.ticksPerMeasure);
        const f = this.state.facade;
        return {
            startAbs: f.toAbs(start.measure, start.tick),
            endAbs: f.toAbs(end.measure, end.tick) + this.state.gridSubdivision,
        };
    }

    /**
     * Drag on the canvas: from empty space it selects a tick range
     * (VISUAL); from INSIDE the current selection it MOVES the phrase
     * (dashed preview, drop = one undoable facade.moveRange). A
     * sub-threshold drag stays a click.
     */
    _handleDragStart(event) {
        if (event.button !== 0) return;
        if (!this.canvasContainer.contains(event.target)) return;
        this._suppressNextClick = false; // stale flag guard
        const pos = this._positionFromPoint(event.clientX, event.clientY);
        if (!pos) return;

        const sel = this._selectionAbsRange();
        if (sel) {
            const grabAbs = this.state.facade.toAbs(pos.measure, pos.tick);
            if (grabAbs >= sel.startAbs && grabAbs < sel.endAbs) {
                this._drag = {
                    mode: 'move', grabAbs, sel,
                    x: event.clientX, y: event.clientY, active: false,
                };
                return;
            }
        }
        this._drag = {
            mode: 'select', startPos: pos,
            x: event.clientX, y: event.clientY, active: false,
        };
    }

    _handleDragMove(event) {
        if (!this._drag) return;
        if (!this._drag.active) {
            const moved = Math.abs(event.clientX - this._drag.x)
                        + Math.abs(event.clientY - this._drag.y);
            if (moved < 5) return;
            if (this._drag.mode === 'select') {
                // Anchor the selection at the mousedown position
                const s = this._drag.startPos;
                this.state.cursor.measure = s.measure;
                this.state.cursor.tick = s.tick;
                this.state.cursor.string = s.string;
                this.state.setMode(EditorMode.VISUAL); // selection anchored at cursor
            }
            this._drag.active = true;
        }

        const pos = this._positionFromPoint(event.clientX, event.clientY);
        if (!pos) return;

        if (this._drag.mode === 'move') {
            // Escape may have cleared the selection mid-drag — abort
            if (!this.state.selection) {
                this.cursor.clearMovePreview();
                this._drag = null;
                return;
            }
            const { grabAbs, sel } = this._drag;
            const posAbs = this.state.facade.toAbs(pos.measure, pos.tick);
            const destAbs = Math.max(0, posAbs - (grabAbs - sel.startAbs));
            this._drag.destAbs = destAbs;
            this.cursor.renderMovePreview(destAbs, destAbs + (sel.endAbs - sel.startAbs));
            return;
        }

        this.state.cursor.measure = pos.measure;
        this.state.cursor.tick = pos.tick;
        this.state.cursor.string = pos.string;
        // Selection extension lives in the keyboard's move methods — the
        // drag path must extend it itself
        if (this.state.selection) {
            this.state.selection.end.measure = pos.measure;
            this.state.selection.end.tick = pos.tick;
            this.state.selection.end.string = pos.string;
        }
        this.cursor.update(); // redraws crosshair + selection highlight
        this.state._emit('cursorMove', this.state.cursor);
    }

    _handleDragEnd() {
        if (!this._drag) return;
        const drag = this._drag;
        this._drag = null;
        if (!drag.active) return;

        this._suppressNextClick = true; // don't let the click reset things
        this.editorRoot.focus();

        if (drag.mode !== 'move') return;
        this.cursor.clearMovePreview();
        if (drag.destAbs == null || !this.state.selection) return;

        const { sel } = drag;
        if (!this.state.facade.moveRange(sel.startAbs, sel.endAbs, drag.destAbs)) return;

        // Selection (and cursor) follow the phrase to its new home
        const span = sel.endAbs - sel.startAbs;
        const f = this.state.facade;
        const s = f.locate(drag.destAbs);
        const e = f.locate(drag.destAbs + span - this.state.gridSubdivision);
        this.state.cursor.measure = s.measure;
        this.state.cursor.tick = s.tick;
        this.state.selection.start.measure = s.measure;
        this.state.selection.start.tick = s.tick;
        this.state.selection.end.measure = e.measure;
        this.state.selection.end.tick = e.tick;
        this.cursor.update();
        this.state._emit('cursorMove', this.state.cursor);
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

    // ------------------------------------------------------------------
    // Placed free text (the document's `annotations`)
    //
    // Anchored to the CURSOR, like note entry — there is no separate
    // text cursor to keep in step. Every write goes through the facade,
    // so undo/redo covers text exactly as it covers notes.
    // ------------------------------------------------------------------

    /**
     * Open the text prompt at the cursor. Pre-filled with the annotation
     * already there (within a beat), so `c` is one key for both add and
     * edit — the panel title says which.
     */
    editAnnotationAtCursor() {
        const found = this.state.getAnnotationAtCursor();
        const cursor = this.state.cursor;
        const ticksPerBeat = this.state.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;
        const beat = Math.floor(cursor.tick / ticksPerBeat) + 1;
        const sub = Math.round((cursor.tick % ticksPerBeat) / (ticksPerBeat / 4));

        this.annotationPopover.open({
            measure: cursor.measure,
            tick: cursor.tick,
            existing: found?.annotation.text || '',
            beatLabel: beat + (sub > 0 ? '.' + sub : ''),
        });
    }

    /** Commit the prompt's text. Empty deletes — never a blank label. */
    _commitAnnotation(text) {
        this.recorder?.record('setAnnotation', {
            measure: this.state.cursor.measure,
            tick: this.state.cursor.tick,
            text,
        });
        this.state.setAnnotationAtCursor(text);
        this.editorRoot?.focus();
    }

    /** Delete the annotation at/nearest the cursor. */
    deleteAnnotationAtCursor() {
        this.recorder?.record('deleteAnnotation', {
            measure: this.state.cursor.measure,
            tick: this.state.cursor.tick,
        });
        const ok = this.state.deleteAnnotationAtCursor();
        this.editorRoot?.focus();
        return ok;
    }

    /**
     * Handle save
     */
    _handleSave() {
        const otf = this.save();
        this.options.onSave?.(otf);
    }

    /**
     * Show keyboard shortcut help — a dismissible overlay (the status-bar
     * hint says "Press ? for help", so ? has to actually show something).
     */
    _showHelp() {
        const existing = this.editorRoot.querySelector('.editor-help-overlay');
        if (existing) {
            existing.remove();
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'editor-help-overlay';
        overlay.innerHTML = `
            <div class="editor-help-panel" role="dialog" aria-label="Keyboard shortcuts">
                <div class="editor-help-head">
                    <strong>Keyboard shortcuts</strong>
                    <button class="editor-help-close" title="Close">&times;</button>
                </div>
                <div class="editor-help-cols">
                    <dl>
                        <dt>Navigate</dt><dd><kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd> or arrows · <kbd>w</kbd>/<kbd>b</kbd> next/prev measure · <kbd>gg</kbd>/<kbd>G</kbd> start/end</dd>
                        <dt>Notes</dt><dd><kbd>0</kbd>–<kbd>9</kbd> fret at cursor · <kbd>Space</kbd> rest · <kbd>x</kbd> delete note · <kbd>dd</kbd> delete tick</dd>
                        <dt>Durations</dt><dd><kbd>q</kbd> quarter · <kbd>e</kbd> eighth · <kbd>s</kbd> sixteenth · <kbd>t</kbd> thirty-second · <kbd>3</kbd> triplet</dd>
                    </dl>
                    <dl>
                        <dt>Text</dt><dd><kbd>c</kbd> add/edit placed text at cursor (section label, chord name) · <kbd>Shift</kbd>+<kbd>C</kbd> delete it · empty text deletes</dd>
                        <dt>Modes</dt><dd><kbd>v</kbd> visual select · <kbd>A</kbd> annotation · <kbd>Esc</kbd> back to normal</dd>
                        <dt>Edit</dt><dd><kbd>u</kbd> undo · <kbd>Ctrl</kbd>+<kbd>R</kbd> redo · <kbd>y</kbd>/<kbd>p</kbd> copy/paste · <kbd>Cmd</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd></dd>
                        <dt>Play</dt><dd><kbd>Cmd</kbd>+<kbd>Space</kbd> play from cursor · <kbd>L</kbd> loop selection</dd>
                    </dl>
                </div>
                <div class="editor-help-foot">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</div>
            </div>
        `;
        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.editor-help-close')) close();
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === '?') { e.stopPropagation(); close(); this.editorRoot.focus(); }
        });
        this.editorRoot.appendChild(overlay);
        overlay.tabIndex = -1;
        overlay.focus();
    }

    /**
     * Render tablature
     */
    _render() {
        const track = this.state.getCurrentTrack();
        let notation = this.state.getNotation();

        if (!track || !notation) return;

        // OTF omits silent measures; render them as empty bars (display
        // copy only — the document stays sparse, and editing one goes
        // through getOrCreateMeasure as usual).
        notation = densifyNotation(notation, maxMeasureIn(this.state.otf.notation));

        // Free-text annotations + reading-list section labels (display
        // copy; annotations may target the silent measures, so attach
        // after densify).
        notation = attachOtfDecorations(notation, this.state.otf);

        // Repeat signs / ending brackets derive from the reading list;
        // compact presentation keeps WRITTEN numbering (identity), so
        // all editing geometry is unaffected.
        const rl = this.state.otf.reading_list;
        if (rl && rl.length > 0) {
            notation = prepareCompactNotation(notation, rl);
        }

        // Render using TabRenderer, with the facade's ts-aware timing so
        // mid-tune signature changes get correct measure lengths + glyphs
        const ticksPerBeat = this.state.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;
        const timeSignature = this.state.otf.metadata?.time_signature || '4/4';

        // Auto-expand for fine entry grids: guarantee each grid slot a
        // minimum pixel width so 1/16 and 1/32 grids stay usable
        // (measureWidthFloor beats maxMeasureWidth; rows scroll if
        // needed). RATCHET within a session: the layout grows when a
        // finer grid needs room but never yanks back when you coarsen —
        // predictable zoom instead of surprise reflows.
        const MIN_PX_PER_GRID_SLOT = 9;
        const defaultTicks = this.state.facade.measureTiming.defaultTicks;
        const slots = defaultTicks / this.state.gridSubdivision;
        const floor = Math.ceil(slots * MIN_PX_PER_GRID_SLOT + 30); // +30 margins
        this._measureWidthFloorMax = Math.max(this._measureWidthFloorMax || 0, floor);
        this.renderer.options.measureWidthFloor = this._measureWidthFloorMax;

        // Overlays refresh via renderer.onAfterRender (fires for THIS
        // call and for the renderer's own async re-renders)
        this.renderer.render(track, notation, ticksPerBeat, timeSignature,
            this.state.facade.timing);

        // Update cursor layout info after DOM is fully painted
        // Use double-RAF to ensure layout is complete
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!this.cursor) return; // destroyed while queued
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
        // Coerce: a malicious OTF could carry a string tempo crafted to
        // break out of the value="" attribute below
        const tempo = Number(this.state.otf.metadata?.tempo) || 120;

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
            <span class="status-separator">|</span>
            <span class="status-item" title="Placed text at the cursor — c to add or edit, Shift+C to delete">
                <span class="status-label">Text:</span>
                <span class="status-value" data-field="annotation">—</span>
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

        // Placed text at the cursor — the editor's only way to know which
        // annotation `c` would edit (the renderer draws them, but marks
        // none of them as "the one under the cursor")
        const annEl = this.statusBar.querySelector('[data-field="annotation"]');
        if (annEl) {
            const found = this.state.getAnnotationAtCursor();
            const text = found?.annotation.text || '';
            annEl.textContent = text.length > 24 ? text.slice(0, 23) + '…' : (text || '—');
            annEl.title = text;
        }
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
            // Handle tempo changes (facade op — undoable, emits change)
            tempoInput.addEventListener('change', (e) => {
                const tempo = parseInt(e.target.value, 10);
                if (tempo >= 40 && tempo <= 280) {
                    this.state.setTempo(tempo);
                } else {
                    // reject out-of-range input visibly
                    e.target.value = this.state.otf?.metadata?.tempo || 120;
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
        // Sync, before any await: iOS only opens/resumes the audio context
        // inside the gesture's own call stack (audio-unlock.js).
        this.player?.unlockAudio();
        if (this.isPlaying) {
            this.stop();
        } else {
            await this.play();
        }
    }

    /**
     * Playback runs in the UNROLLED (reading-list) tick domain while the
     * editor displays written measures. These helpers bridge the two.
     */
    _playbackTiming() {
        const otf = this.state.otf;
        const max = Math.max(1, maxMeasureIn(otf.notation || {}));
        return new TimelineTiming(
            this.state.facade.measureTiming,
            readingListTimeline(otf.reading_list, max));
    }

    /** Unrolled tick of a written position (its FIRST play occurrence). */
    _unrolledTick(measure, tick) {
        if (!this.state.otf.reading_list?.length) {
            return this.state.facade.toAbs(measure, tick);
        }
        const playback = this._playbackTiming();
        const slot = playback.slots.find(s => s.original === measure);
        return slot ? slot.startTick + tick
                    : this.state.facade.toAbs(measure, tick);
    }

    /**
     * Play from the cursor to the end (toggles off when playing).
     * The verify loop: type a phrase, hear it from right there.
     */
    async playFromCursor() {
        this.player?.unlockAudio();  // sync, inside the gesture/keystroke
        if (this.isPlaying) {
            this.stop();
            return;
        }
        const startTick = this._unrolledTick(
            this.state.cursor.measure, this.state.cursor.tick);
        await this.play({ startTick });
    }

    /**
     * Loop the visual-mode selection (practice mode). Falls back to
     * play-from-cursor when there is no selection. Toggles off.
     */
    async loopSelection() {
        this.player?.unlockAudio();  // sync, inside the gesture/keystroke
        if (this.isPlaying) {
            this.stop();
            return;
        }
        const sel = this._selectionAbsRange();
        if (!sel) {
            await this.playFromCursor();
            return;
        }
        // Map the written-domain selection into the unrolled playback
        // domain (first occurrence)
        const { start, end } = this.state.selection.getNormalized(this.state.ticksPerMeasure);
        const startTick = this._unrolledTick(start.measure, start.tick);
        const endTick = this._unrolledTick(end.measure, end.tick) + this.state.gridSubdivision;
        await this.play({ startTick, endTick, loop: true });
    }

    /**
     * Start playback
     * @param {Object} rangeOptions - {startTick?, endTick?, loop?}
     */
    async play(rangeOptions = {}) {
        if (this.isPlaying) return;

        const otf = this.state.export();

        // Playback ticks are UNROLLED; the editor displays written
        // measures — map ticks back for the beat cursor / highlights
        const mapper = otf.reading_list?.length
            ? makePlaybackToVisualMapper(this._playbackTiming(), this.state.facade.timing)
            : (t) => t;

        // Set up visualization callbacks
        this.player.onTick = (absTick) => {
            this.renderer.updateBeatCursor(mapper(absTick), { autoScroll: true });
        };

        this.player.onNoteStart = (absTick) => {
            this.renderer.highlightNote(mapper(absTick));
        };

        this.player.onNoteEnd = (absTick) => {
            this.renderer.clearNoteHighlight(mapper(absTick));
        };

        this.player.onPlaybackEnd = () => {
            this.isPlaying = false;
            this.renderer.resetPlaybackVisualization();
            this._updatePlayButton();
        };

        // Immediate feedback: instrument soundfonts load over the network
        // on first play (~seconds) — show that instead of a dead button
        const playBtn = this.statusBar.querySelector('.play-button');
        if (playBtn) {
            playBtn.textContent = '…';
            playBtn.title = 'Loading instruments…';
        }

        try {
            await this.player.play(otf, {
                tempo: otf.metadata?.tempo || 120,
                ...rangeOptions,
            });
            if (!this.state) return; // destroyed during the load await
            this.isPlaying = true;
        } catch (error) {
            console.error('Playback error:', error);
            if (!this.state) return;
            this.isPlaying = false;
        }
        if (playBtn) playBtn.title = 'Play/Pause';
        this._updatePlayButton();
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
     * Create/resume the note-feedback AudioContext synchronously.
     *
     * This IS the player's context: entry feedback and playback share one
     * audio stack, so a typed note plays through the same sampled voice
     * (and the same iOS unlock) as pressing Play. TabPlayer.unlockAudio()
     * is synchronous by contract — nothing may await before it.
     *
     * @returns {AudioContext|null} null when the browser has no Web Audio
     */
    _ensureAudioContext() {
        const ctx = this.player?.unlockAudio() || null;
        this.audioContext = ctx;
        return ctx;
    }

    /**
     * Play audio feedback for note entry.
     *
     * Sampled voice when the track's soundfont is already decoded, the
     * synth beep otherwise. NOTHING here awaits: a note has to sound the
     * instant it is typed, so a missing soundfont beeps now and warms in
     * the background for the next note.
     *
     * @param {number} fret - Fret number
     * @param {number} string - String number (1-indexed)
     */
    _playNoteFeedback(fret, string) {
        // Note entry IS the gesture: create and resume here, synchronously,
        // or iOS leaves the context suspended and the pluck is silent.
        const ctx = this._ensureAudioContext();
        if (!ctx) return;

        // Get string tuning to calculate pitch
        const track = this.state.getCurrentTrack();
        const tuning = track?.tuning?.length ? track.tuning : DEFAULT_FEEDBACK_TUNING;
        const stringPitch = tuning[string - 1] || 'G3';
        const instrumentKey = getInstrumentKey(track?.instrument);

        if (this._playSampledFeedback(ctx, instrumentKey, stringPitch, fret)) return;

        this._warmFeedbackVoice(instrumentKey, track);
        this._playBeepFeedback(ctx, stringPitch, fret);
    }

    /**
     * The already-decoded WebAudioFont preset for an instrument, or null.
     * Never fetches and never awaits — a preset whose zones have no buffers
     * yet would schedule silence.
     */
    _decodedPreset(instrumentKey) {
        const data = window[INSTRUMENTS[instrumentKey]?.var];
        if (!data?.zones?.length) return null;
        return data.zones.every(zone => zone.buffer) ? data : null;
    }

    /**
     * One pluck of the track's real instrument.
     * @returns {boolean} false when the sampled voice isn't usable yet
     */
    _playSampledFeedback(ctx, instrumentKey, stringPitch, fret) {
        const waf = this.player?.player;   // the WebAudioFontPlayer, post-init
        // A context that isn't running has a frozen clock: queueing into it
        // is silence with no fallback. Let the beep path handle that.
        if (!waf || ctx.state !== 'running') return false;
        const preset = this._decodedPreset(instrumentKey);
        if (!preset) return false;

        const open = PITCH_TO_MIDI[stringPitch];
        if (open == null) return false;
        try {
            waf.queueWaveTable(ctx, ctx.destination, preset, ctx.currentTime,
                open + fret, FEEDBACK_DURATION_SEC, FEEDBACK_VOLUME);
        } catch (e) {
            return false;   // fall through to the beep rather than go silent
        }
        return true;
    }

    /**
     * Fetch + decode the track's soundfont in the BACKGROUND so later notes
     * get the sampled voice. Attempted once per instrument per session: a
     * blocked CDN must not re-fire on every keystroke, it just means the
     * beep stays. Deliberately not awaited by the caller.
     */
    _warmFeedbackVoice(instrumentKey, track) {
        if (!track || this._warmedVoices.has(instrumentKey)) return;
        this._warmedVoices.add(instrumentKey);
        try {
            // init() STARTS here (its synchronous half is the iOS unlock);
            // only the network part is left to settle later.
            Promise.resolve(this.player?.init())
                .then(() => this.player?.loadInstruments([track]))
                .catch(() => { /* offline or blocked: the beep is the fallback */ });
        } catch (e) {
            /* nothing may escape into the note-entry path */
        }
    }

    /**
     * The synthesized fallback pluck — no network, always available.
     */
    _playBeepFeedback(ctx, stringPitch, fret) {
        const freq = this._pitchToFrequency(stringPitch, fret);

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.value = freq;

        // Quick attack, short decay (pluck-like envelope)
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

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
        // Stop the player UNCONDITIONALLY — isPlaying only goes true
        // after play()'s awaits resolve, so a destroy during a slow
        // soundfont load would otherwise let audio start into a dead
        // editor. player.stop() also invalidates that in-flight play.
        this.player?.stop();
        this.isPlaying = false;

        // Remove document-level drag listeners
        if (this._boundDragMove) {
            document.removeEventListener('mousemove', this._boundDragMove);
            document.removeEventListener('mouseup', this._boundDragEnd);
        }

        // Close a lingering context menu (it lives on document.body)
        this.contextMenu?.close();

        // Clean up components
        this.keyboard.detach();
        this.cursor.destroy();
        this.toolbar.destroy();
        this.popover.destroy();
        this.annotationPopover?.destroy();
        this.renderer?.destroy();

        // Clear container
        this.container.innerHTML = '';
        this.container.classList.remove('otf-editor-container', 'otf-editor-fill');

        // Clear references
        this.state = null;
        this.cursor = null;
        this.keyboard = null;
        this.toolbar = null;
        this.popover = null;
        this.annotationPopover = null;
        this.renderer = null;
        this.player = null;
    }
}
