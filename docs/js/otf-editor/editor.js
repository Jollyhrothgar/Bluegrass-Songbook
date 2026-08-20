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
import { EditorMenuBar } from './menu-bar.js';
import { NoteEntryPopover, AnnotationPopover, TrackNamePopover } from './popover.js';
import { sanitizeTrackId } from './facade.js';
import { downloadOTF, cleanupOTF, validateOTF } from './actions.js';
import { ContextMenu } from './context-menu.js';
import {
    describe as describeBindings, getPreset, setPreset,
    PRESETS, entryAdvanceTicks, stepTicks,
} from './bindings.js';
import { EditEventRecorder } from './recorder.js';

// Note-entry feedback: a short pluck of the SAME sampled voice playback
// uses. Volume matches TabPlayer's default mixer so typing a note and
// hearing it back sound like one instrument, not two.
const FEEDBACK_DURATION_SEC = 0.4;
const FEEDBACK_VOLUME = 0.7;
const DEFAULT_FEEDBACK_TUNING = ['D4', 'B3', 'G3', 'D3', 'G4'];

// Editor-only renderer weights. The site's read view keeps TabRenderer's
// defaults (1.5 / 3) — these are the "thicker stems" of plan
// tab-editor-input-parity §7, and they apply while editing only.
const EDITOR_STEM_WIDTH = 2.25;
const EDITOR_BEAM_THICKNESS = 4;

// Rows are FIXED in the editor, not reflowed (plan §7). We pin whatever
// the read view computed for this container width; this is the fallback
// when the container has no layout box yet to ask.
const DEFAULT_MEASURES_PER_ROW = 4;

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
            // hostTransport: the WRAPPER already shows one transport for
            // this document (the song page's bottom band does — see
            // `tab-edit-band.js`), so the status bar drops its own ▶/⏹/BPM
            // instead of being the third set of playback controls for one
            // tab (plan §8.2). Default false: `editor-demo.html` and any
            // bare mount have no band, so they keep theirs.
            hostTransport: false,
            // fileActions: what the File menu offers, supplied by whoever
            // owns the session's buttons — `[{label, run, disabled?,
            // action?}]`, where `action` is a binding id used ONLY to
            // print its key. The editor alone can only download, so that
            // is the default; the song page's edit session (Submit /
            // Download / Cancel / Done) passes its own list through
            // whatever creates the editor.
            fileActions: null,
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
            onTogglePlay: () => this.togglePlayback(),
            onPlayFromCursor: () => this.playFromCursor(),
            onPlayMeasure: () => this.playMeasure(),
            onLoopSelection: () => this.loopSelection(),
            onEditAnnotation: () => this.editAnnotationAtCursor(),
            onGoToMeasure: () => this._promptForMeasure(),
            recorder: this.recorder,
        });
        this.toolbar = new EditorToolbar(this.state, {
            onLoop: () => this.loopSelection(),
            onRest: () => this.cursor.moveByDuration(1),
            onEditAnnotation: () => this.editAnnotationAtCursor(),
            onDeleteAnnotation: () => this.deleteAnnotationAtCursor(),
            onRenameTrack: () => this.renameCurrentTrack(),
            onMoveTrack: (delta) => this.moveCurrentTrack(delta),
            onAction: (id) => {
                this.keyboard.dispatchAction(id);
                this.editorRoot?.focus();
            },
        });
        // Menu actions refocus the editor afterwards — otherwise the
        // keyboard is dead after any mouse-menu action (focus stays on
        // the clicked menu button's ghost)
        const refocus = (fn) => () => {
            fn();
            this.editorRoot?.focus();
        };
        // Every entry is a binding action too, so the menu's key column
        // comes from the table (`keyFor`) instead of a hand-kept string.
        const menuAction = (id) => refocus(() => this.keyboard.dispatchAction(id));
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
            playMeasure: refocus(() => this.playMeasure()),
            tie: menuAction('effect.tie'),
            dead: menuAction('effect.dead'),
            choke: menuAction('effect.choke'),
            clearTech: menuAction('effect.clear'),
            restringUp: menuAction('note.restringUp'),
            restringDown: menuAction('note.restringDown'),
            fixDurations: menuAction('duration.fix'),
            insertMeasureBefore: menuAction('measure.insertBefore'),
            insertMeasureAfter: menuAction('measure.insertAfter'),
            deleteMeasure: menuAction('measure.delete'),
            repeatPrevious: menuAction('measure.repeatPrevious'),
            rippleRight: menuAction('measure.rippleRight'),
            rippleLeft: menuAction('measure.rippleLeft'),
            repeat: refocus(() => this._repeatSelectedMeasures(true)),
            unrepeat: refocus(() => this._repeatSelectedMeasures(false)),
        });
        // The menu bar (plan §8.3). Its items and their keys come from
        // the binding table; everything that ISN'T a binding — tempo,
        // repeats, tracks, measures-per-row, zoom — arrives here as a
        // hook, and a hook the editor doesn't pass is an item the menu
        // doesn't draw.
        this.menuBar = new EditorMenuBar({
            state: this.state,
            dispatch: (id) => this.keyboard.dispatchAction(id),
            onClose: () => this.editorRoot?.focus(),
            fileActions: this.options.fileActions || [{
                label: '⬇ Download OTF',
                action: 'edit.save',
                run: () => this.keyboard.dispatchAction('edit.save'),
            }],
            hooks: {
                repeatSpan: refocus(() => this._repeatSelectedMeasures(true)),
                removeRepeat: refocus(() => this._repeatSelectedMeasures(false)),
                tempo: () => this._promptForTempo(),
                metronome: () => this._toggleMetronome(),
                metronomeOn: () => !!this.player?.metronomeEnabled,
                tracks: () => this.state.getTracks().map(t => ({
                    label: t.id,
                    checked: t.id === this.state.trackId,
                    run: () => this.state.setTrack(t.id),
                })),
                renameTrack: () => this.renameCurrentTrack(),
                moveTrackEarlier: () => this.moveCurrentTrack(-1),
                moveTrackLater: () => this.moveCurrentTrack(1),
                measuresPerRow: () => [2, 3, 4, 5, 6].map(n => ({
                    label: String(n),
                    checked: this.renderer?.options.measuresPerRow === n,
                    run: () => this.setMeasuresPerRow(n),
                })),
                zoomIn: () => this.zoomBy(0.1),
                zoomOut: () => this.zoomBy(-0.1),
                zoomReset: () => this.zoomBy(0, 1),
            },
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
        // Renaming an instrument track — the third sibling prompt. It
        // pre-validates against the other tracks' names so the facade's
        // duplicate-id guard never has to surface as a thrown error.
        this.trackNamePopover = new TrackNamePopover({
            sanitize: sanitizeTrackId,
            onCommit: (name) => this._commitTrackName(name),
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
        // Debug/QA handle: lets a browser session reach the live instance
        // (document, facade, state) without a global. Not an API.
        this.editorRoot.__otfEditor = this;
        this.editorRoot.className = 'otf-editor';
        this.editorRoot.tabIndex = 0; // Make focusable

        // Menu bar, above the toolbar — the same component in every
        // wrapper, so a contributor meets one control surface whether
        // they are creating, correcting or just looking (plan §8.1/8.3).
        this.menuContainer = document.createElement('div');
        this.menuContainer.className = 'editor-menu-container';
        this.editorRoot.appendChild(this.menuContainer);

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
        this.menuBar.render(this.menuContainer);
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

        // RENDERER PARITY: the page you edit is the page you publish, so
        // the editor overrides nothing about how the document is drawn
        // (plan tab-editor-input-parity §8.1/§9.2). It used to force
        // `centerNotes: false, showRests: true`, which re-spaced every
        // measure the moment you pressed Edit and put it back when you
        // left. `showRests: true` was the renderer default anyway; note
        // centering is now the ONE coordinate difference we accept — the
        // grid overlay is drawn from the same per-measure geometry, so
        // it still lands on the notes. The overlay is the only thing the
        // editor adds to the drawing.

        // Thicker stems while editing ("thicker stems desires", §7):
        // entry is close work, and 1.5px stems disappear under the
        // cursor box. The read view keeps the site default.
        this.renderer.options.stemWidth = EDITOR_STEM_WIDTH;
        this.renderer.options.beamThickness = EDITOR_BEAM_THICKNESS;

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
        this.trackNamePopover.init(this.container);

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

            .editor-menu-container,
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

            .otf-editor-fill .editor-menu-container { order: 2; }
            .otf-editor-fill .editor-toolbar-container { order: 3; }
            .otf-editor-fill .editor-status-bar { order: 4; }

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
            .editor-help-presets {
                display: flex;
                gap: 12px;
                font-size: 12px;
                margin-left: auto;
                margin-right: 12px;
            }
            .editor-help-preset {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
            }
            .editor-help-notes {
                margin-top: 14px;
                padding-top: 10px;
                border-top: 1px solid var(--border, #ddd);
                font-size: 12px;
                opacity: 0.8;
            }
            .editor-help-notes ul { margin: 6px 0 0; padding-left: 18px; }
            .editor-help-notes li { margin: 2px 0; }
            .status-help-btn {
                background: none;
                border: none;
                color: inherit;
                font: inherit;
                cursor: pointer;
                padding: 0 4px;
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
                hasNote: !!this.state.getNoteAtCursor(),
                preset: getPreset(),
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

        // Advance exactly as typing a digit does: honours auto-advance,
        // steps ONE GRID SLOT under automatic duration, and appends a
        // measure when it walks off the end.
        if (this.state.autoAdvance) {
            stepTicks(this.keyboard.ctx, entryAdvanceTicks(this.state));
        } else {
            this.cursor.update();
        }

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

    // ------------------------------------------------------------------
    // Instrument tracks: name and order
    //
    // Both are toolbar-only, next to the track switcher — which is also
    // the only way to CHOOSE a track, and the only place the names are
    // written down. No key bindings: switching tracks has never had one,
    // and these are once-per-document edits, not entry-speed ones.
    // ------------------------------------------------------------------

    /** Open the rename prompt for the track being edited. */
    renameCurrentTrack() {
        const track = this.state.getCurrentTrack();
        if (!track) return false;
        const tracks = this.state.getTracks();
        this.trackNamePopover.open({
            current: track.id,
            instrument: track.instrument,
            taken: tracks.filter(t => t !== track).map(t => t.id),
            position: this.state.getTrackIndex() + 1,
            total: tracks.length,
        });
        return true;
    }

    /** Commit a new track name. The prompt has already validated it. */
    _commitTrackName(name) {
        this.recorder?.record('renameTrack', {
            trackId: this.state.trackId,
            newId: name,
        });
        let ok = false;
        try {
            ok = this.state.renameTrack(name);
        } catch (err) {
            // Only reachable if the document changed under the open
            // prompt. Say so rather than dying inside a click handler.
            console.warn('Rename failed:', err.message);
        }
        this.editorRoot?.focus();
        return ok;
    }

    /**
     * Move the current track `delta` places (-1 earlier, +1 later).
     * First place is the lead: work-view shows and sounds the first
     * pitched track by default.
     */
    moveCurrentTrack(delta) {
        this.recorder?.record('moveTrack', { trackId: this.state.trackId, delta });
        const ok = this.state.moveTrack(delta);
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
     * Show keyboard shortcut help — a dismissible overlay GENERATED FROM
     * THE BINDING TABLE (`bindings.js`), so it cannot drift from what the
     * keys actually do. It used to be a hand-written copy and was wrong in
     * four places at once (`w`/`b`, `3`, `G`, `Ctrl+T`).
     *
     * Every <kbd> here comes from `describe(preset)`. The browser/OS
     * exceptions at the foot deliberately use <code>, not <kbd>: they name
     * keys we do NOT bind.
     */
    _showHelp() {
        const existing = this.editorRoot.querySelector('.editor-help-overlay');
        if (existing) {
            existing.remove();
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'editor-help-overlay';
        overlay.innerHTML = this._helpHtml(getPreset());
        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('.editor-help-close')) close();
        });
        overlay.addEventListener('change', (e) => {
            const radio = e.target.closest('input[name="otf-preset"]');
            if (!radio) return;
            setPreset(radio.value);
            overlay.innerHTML = this._helpHtml(getPreset());
            overlay.focus();
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === '?') { e.stopPropagation(); close(); this.editorRoot.focus(); }
        });
        this.editorRoot.appendChild(overlay);
        overlay.tabIndex = -1;
        overlay.focus();
    }

    /** The overlay's markup for one preset (pure — a test renders both). */
    _helpHtml(presetId) {
        const preset = PRESETS[presetId] || PRESETS.tabledit;
        const esc = (t) => String(t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const kbd = (keys) => keys.map(k => `<kbd>${esc(k)}</kbd>`).join(' ');
        const groups = describeBindings(presetId).map(({ group, items }) => `
            <dt>${esc(group)}</dt>
            ${items.map(item => `<dd>${kbd(item.keys)} ${esc(item.label)}</dd>`).join('')}
        `);
        // Two balanced columns
        const half = Math.ceil(groups.length / 2);
        const col = (list) => `<dl>${list.join('')}</dl>`;
        const switcher = Object.values(PRESETS).map(p => `
            <label class="editor-help-preset">
                <input type="radio" name="otf-preset" value="${esc(p.id)}"
                    ${p.id === presetId ? 'checked' : ''}> ${esc(p.label)}
            </label>`).join('');

        return `
            <div class="editor-help-panel" role="dialog" aria-label="Keyboard shortcuts">
                <div class="editor-help-head">
                    <strong>Keyboard shortcuts</strong>
                    <span class="editor-help-presets">${switcher}</span>
                    <button class="editor-help-close" title="Close">&times;</button>
                </div>
                <div class="editor-help-cols">
                    ${col(groups.slice(0, half))}
                    ${col(groups.slice(half))}
                </div>
                <div class="editor-help-notes">
                    <strong>What the browser and the OS take:</strong>
                    <ul>${preset.exceptions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
                </div>
                <div class="editor-help-foot">
                    A slur marks the note it lands ON (in <code>2h4</code> the 4 is
                    hammered) — pressing it on either note of a pair does the right
                    thing. Press <kbd>?</kbd> or <kbd>Esc</kbd> to close.
                </div>
            </div>
        `;
    }

    /**
     * Play the cursor's measure once. There is no range-play API beyond
     * `play({startTick, endTick})`, which is all this needs.
     */
    async playMeasure() {
        this.player?.unlockAudio();
        if (this.isPlaying) {
            this.stop();
            return;
        }
        const m = this.state.cursor.measure;
        const startTick = this._unrolledTick(m, 0);
        const endTick = startTick + this.state.facade.ticksFor(m);
        await this.play({ startTick, endTick });
    }

    /**
     * Ask which measure to jump to. A prompt for now — the menu-bar pass
     * can swap in a popover without touching the binding table.
     * @returns {number} measure number, or 0 to cancel
     */
    _promptForMeasure() {
        const ask = globalThis.prompt;
        if (typeof ask !== 'function') return 0;
        const answer = ask(`Go to measure (1–${this.state.getMeasureCount()}):`,
            String(this.state.cursor.measure));
        const n = parseInt(answer, 10);
        this.editorRoot?.focus();
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    /**
     * Ask for a tempo (Play ▸ Tempo…). Writes through the facade, so it
     * is undoable and it is what gets submitted — same as the band's
     * −/+ and the status bar's BPM box.
     * @returns {boolean} whether the tempo changed
     */
    _promptForTempo() {
        const ask = globalThis.prompt;
        if (typeof ask !== 'function') return false;
        const now = Number(this.state.otf?.metadata?.tempo) || 120;
        const answer = ask('Tempo (BPM, 40–280):', String(now));
        const bpm = parseInt(answer, 10);
        this.editorRoot?.focus();
        if (!Number.isFinite(bpm) || bpm < 40 || bpm > 280) return false;
        this.state.setTempo(bpm);
        const tempoInput = this.statusBar?.querySelector('.tempo-input');
        if (tempoInput) tempoInput.value = bpm;
        return true;
    }

    /** Play ▸ Metronome. Session state on the player, not the document. */
    _toggleMetronome() {
        if (!this.player) return false;
        this.player.metronomeEnabled = !this.player.metronomeEnabled;
        this.editorRoot?.focus();
        return this.player.metronomeEnabled;
    }

    /**
     * View ▸ Measures per row. Rows are FIXED in the editor (plan §7);
     * this is how you change the number they are fixed AT.
     */
    setMeasuresPerRow(n) {
        if (!this.renderer || !(n > 0)) return false;
        this.renderer.options.measuresPerRow = n;
        this._render();
        this.editorRoot?.focus();
        return true;
    }

    /**
     * View ▸ Zoom. `delta` steps the current scale; pass `absolute` to
     * set it outright (Reset).
     */
    zoomBy(delta, absolute = null) {
        const next = absolute != null
            ? absolute
            : Math.round(((this._zoom || 1) + delta) * 10) / 10;
        this._zoom = Math.max(0.6, Math.min(1.6, next));
        this.renderer?.setScale?.(this._zoom);
        this.editorRoot?.focus();
        return this._zoom;
    }

    /**
     * Pin measures-per-row ONCE, to the number the read view computed
     * for this container width (`measuresPerRow` option to override,
     * DEFAULT_MEASURES_PER_ROW when the container isn't laid out yet).
     *
     * "Horizontal shifting / column mutation makes it non-deterministic
     * where measures run" (plan tab-editor-input-parity §7): with the
     * count fixed, "go to measure 12" is a place you can see, entering
     * edit mode doesn't reflow the page, and a finer entry grid widens
     * measures (horizontal scroll) instead of rearranging them.
     */
    _pinMeasuresPerRow() {
        if (this.renderer.options.measuresPerRow !== 'auto') return;
        this.renderer.options.measuresPerRow =
            this.options.measuresPerRow
            || this.renderer.autoMeasuresPerRow()
            || DEFAULT_MEASURES_PER_ROW;
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

        this._pinMeasuresPerRow();

        // Auto-expand for fine entry grids: guarantee each grid slot a
        // minimum pixel width so 1/16 and 1/32 grids stay usable
        // (measureWidthFloor beats maxMeasureWidth; rows scroll if
        // needed). RATCHET within a session: the layout grows when a
        // finer grid needs room but never yanks back when you coarsen —
        // predictable zoom instead of surprise reflows. With the row
        // count pinned below, this only ever WIDENS measures; it can no
        // longer move measure 5 onto another row.
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

        // The transport is the HOST's when the host has one (see the
        // `hostTransport` option): the song page's bottom band already
        // shows ▶/⏹ and the tempo for this very document.
        const transport = this.options.hostTransport ? '' : `
            <div class="playback-controls">
                <button class="play-button" title="Play/Pause">▶</button>
                <button class="stop-button" title="Stop">⏹</button>
                <div class="tempo-control">
                    <span>BPM:</span>
                    <input type="number" class="tempo-input" value="${tempo}" min="40" max="280" step="5">
                </div>
            </div>`;

        this.statusBar.innerHTML = `
            ${transport}
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
            <button type="button" class="status-hint status-help-btn"
                    title="Keyboard shortcuts">
                Press <kbd>?</kbd> for help
            </button>
        `;

        // Wire up playback controls (once)
        this._wirePlaybackControls();

        // The help hint is a real <button>, so touch users can open the
        // overlay at all (it used to be a <span>).
        const helpBtn = this.statusBar.querySelector('.status-help-btn');
        helpBtn?.addEventListener('click', () => {
            this._showHelp();
            this.editorRoot?.focus();
        });

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
            360: 'Dotted 8th',
            720: 'Dotted quarter',
            1440: 'Dotted half',
        };
        // `null` is AUTOMATIC: show what the column rule would give the
        // slot the cursor is on — TablEdit's palette does the same.
        if (duration == null) {
            const predicted = this.state.effectiveDuration();
            return `auto (${names[predicted] || predicted + 't'})`;
        }
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
        this.menuBar?.destroy();
        this.popover.destroy();
        this.annotationPopover?.destroy();
        this.trackNamePopover?.destroy();
        this.renderer?.destroy();

        // Clear container
        this.container.innerHTML = '';
        this.container.classList.remove('otf-editor-container', 'otf-editor-fill');

        // Clear references
        this.state = null;
        this.cursor = null;
        this.keyboard = null;
        this.toolbar = null;
        this.menuBar = null;
        this.popover = null;
        this.annotationPopover = null;
        this.trackNamePopover = null;
        this.renderer = null;
        this.player = null;
    }
}
