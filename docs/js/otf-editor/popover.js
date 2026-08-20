// OTF Editor popovers
// UI for entering notes and placed text via click/tap
//
import { FretEntry } from './bindings.js';
import { ARTICULATION_BUTTONS } from './toolbar.js';

/**
 * The note popover's TECHNIQUE row — the toolbar's articulation group,
 * not a second opinion about it. It used to be a hand-written
 * `h · p · / · ~ · none`, which both offered the retired `~`-as-technique
 * and left dead (`x`) and choke (`b`) unreachable from the only path a
 * phone has.
 *
 * The toolbar's `∅ clear` latch is dropped (the row already ends in
 * `none`), and the tie carries `'~'` — the value `facade.insertNote`
 * reads as "tie this to its same-string predecessor", never as a tech.
 */
export const POPOVER_TECHS = ARTICULATION_BUTTONS
    .filter(cfg => !cfg.clear)
    .map(cfg => ({
        tech: cfg.tie ? '~' : cfg.tech,
        symbol: cfg.symbol,
        label: cfg.label,
        isTie: !!cfg.tie,
    }));

/** Why the tie button is off when it is. */
const NO_TIE_REASON =
    'A tie needs a note before this one on the same string';

// Three siblings live here: NoteEntryPopover (string/fret/technique),
// AnnotationPopover (the score's placed free text — "PART A", "Long
// Choke", chord names) and TrackNamePopover (renaming an instrument
// track). They share the overlay/panel/footer chrome so the later ones
// read as the same editor, not bolt-on prompts.

/**
 * Note Entry Popover Component
 * Provides a UI for selecting string, fret, and technique
 */
export class NoteEntryPopover {
    constructor(state, options = {}) {
        this.state = state;
        this.options = {
            onInsert: null,
            onCancel: null,
            ...options,
        };

        // DOM elements
        this.element = null;
        this.overlay = null;

        // Current selection
        this.selectedString = 3;
        this.selectedFret = 0;
        this.selectedTech = null;
        this.highFretOffset = 0;

        // ONE fret-entry algorithm, shared with the canvas keyboard
        // (plan §8.2: "Two fret-entry algorithms … disagree"). A dialog
        // has no hurry, so its refine window never times out.
        this.fretEntry = new FretEntry({ maxFret: 24, refineMs: Infinity });

        // Position
        this.position = { x: 0, y: 0 };

        // State
        this.isOpen = false;

        // Bind handlers
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    /**
     * Initialize popover DOM
     */
    init(container) {
        this._applyStyles();

        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'otf-popover-overlay';
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });

        // Create popover element
        this.element = document.createElement('div');
        this.element.className = 'otf-note-popover';
        this.element.innerHTML = this._renderContent();

        this.overlay.appendChild(this.element);
        container.appendChild(this.overlay);

        // Set up event listeners
        this._setupEventListeners();

        // Initially hidden
        this.overlay.style.display = 'none';
    }

    /**
     * Render popover content
     */
    _renderContent() {
        const stringCount = this.state.getStringCount();
        const stringButtons = Array.from({ length: stringCount }, (_, i) => {
            const num = i + 1;
            const isSelected = num === this.selectedString;
            return `<button class="string-button${isSelected ? ' selected' : ''}" data-string="${num}">${num}</button>`;
        }).join('');

        return `
            <div class="popover-header">
                <span class="popover-title">Enter Note</span>
                <button class="popover-close" title="Close (Escape)">&times;</button>
            </div>
            <div class="popover-body">
                <div class="popover-section">
                    <label class="section-label">String</label>
                    <div class="string-selector button-row">
                        ${stringButtons}
                    </div>
                </div>
                <div class="popover-section">
                    <label class="section-label">Fret</label>
                    <div class="fret-pad">
                        <div class="fret-row">
                            <button class="fret-button" data-fret="7">7</button>
                            <button class="fret-button" data-fret="8">8</button>
                            <button class="fret-button" data-fret="9">9</button>
                            <button class="fret-offset-button" data-offset="10">+10</button>
                        </div>
                        <div class="fret-row">
                            <button class="fret-button" data-fret="4">4</button>
                            <button class="fret-button" data-fret="5">5</button>
                            <button class="fret-button" data-fret="6">6</button>
                            <button class="fret-offset-button" data-offset="20">+20</button>
                        </div>
                        <div class="fret-row">
                            <button class="fret-button" data-fret="1">1</button>
                            <button class="fret-button" data-fret="2">2</button>
                            <button class="fret-button" data-fret="3">3</button>
                            <button class="fret-offset-button clear-offset" data-offset="0">CLR</button>
                        </div>
                        <div class="fret-row">
                            <button class="fret-button open-string" data-fret="0">0</button>
                            <button class="fret-delete">&#x232B;</button>
                        </div>
                    </div>
                    <div class="fret-display">
                        <span class="fret-value">${this.selectedFret}</span>
                        <span class="fret-offset-indicator ${this.highFretOffset > 0 ? 'active' : ''}">
                            ${this.highFretOffset > 0 ? `+${this.highFretOffset}` : ''}
                        </span>
                    </div>
                </div>
                <div class="popover-section">
                    <label class="section-label">Technique</label>
                    <div class="technique-selector button-row">
                        ${this._renderTechButtons()}
                        <button class="tech-button tech-none${!this.selectedTech ? ' selected' : ''}" data-tech="">none</button>
                    </div>
                </div>
            </div>
            <div class="popover-footer">
                <button class="popover-btn cancel-btn">Cancel</button>
                <button class="popover-btn insert-btn primary">Insert</button>
            </div>
        `;
    }

    /**
     * Apply popover styles
     */
    _applyStyles() {
        const style = document.createElement('style');
        style.setAttribute('data-otf-popover', '');
        style.textContent = `
            .otf-popover-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }

            .otf-note-popover {
                background: var(--bg, #fff);
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                min-width: 280px;
                max-width: 340px;
                overflow: hidden;
            }

            .popover-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                background: var(--bg-secondary, #f5f5f5);
                border-bottom: 1px solid var(--border, #ddd);
            }

            .popover-title {
                font-weight: 600;
                font-size: 14px;
            }

            .popover-close {
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: var(--text-muted, #666);
                padding: 0 4px;
            }

            .popover-close:hover {
                color: var(--text, #333);
            }

            .popover-body {
                padding: 16px;
            }

            .popover-section {
                margin-bottom: 16px;
            }

            .popover-section:last-child {
                margin-bottom: 0;
            }

            .section-label {
                display: block;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                color: var(--text-muted, #666);
                margin-bottom: 8px;
            }

            .button-row {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
            }

            .string-button, .tech-button {
                min-width: 36px;
                height: 36px;
                border: 2px solid var(--border, #ddd);
                border-radius: 8px;
                background: var(--bg, #fff);
                font-weight: 600;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .string-button:hover, .tech-button:hover {
                border-color: var(--accent, #007bff);
            }

            .string-button.selected, .tech-button.selected {
                background: var(--accent, #007bff);
                border-color: var(--accent, #007bff);
                color: #fff;
            }

            .tech-button.is-unavailable {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .fret-pad {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .fret-row {
                display: flex;
                gap: 4px;
            }

            .fret-button, .fret-offset-button, .fret-delete {
                flex: 1;
                height: 44px;
                border: 1px solid var(--border, #ddd);
                border-radius: 6px;
                background: var(--bg, #fff);
                font-weight: 600;
                font-size: 16px;
                cursor: pointer;
                transition: all 0.1s ease;
            }

            .fret-button:hover {
                background: var(--bg-hover, #e9e9e9);
            }

            .fret-button:active {
                background: var(--accent, #007bff);
                color: #fff;
                transform: scale(0.95);
            }

            .fret-button.open-string {
                flex: 2;
            }

            .fret-offset-button {
                background: var(--bg-secondary, #f0f0f0);
                font-size: 12px;
            }

            .fret-offset-button.active {
                background: var(--warning, #fd7e14);
                border-color: var(--warning, #fd7e14);
                color: #fff;
            }

            .fret-offset-button.clear-offset {
                font-size: 10px;
            }

            .fret-delete {
                background: var(--danger-light, #fee);
                color: var(--danger, #dc3545);
            }

            .fret-display {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                margin-top: 12px;
                padding: 8px;
                background: var(--bg-secondary, #f5f5f5);
                border-radius: 6px;
            }

            .fret-value {
                font-size: 24px;
                font-weight: 700;
            }

            .fret-offset-indicator {
                font-size: 12px;
                color: var(--text-muted, #888);
            }

            .fret-offset-indicator.active {
                color: var(--warning, #fd7e14);
                font-weight: 600;
            }

            .tech-none {
                font-size: 12px;
            }

            .popover-footer {
                display: flex;
                gap: 8px;
                padding: 12px 16px;
                background: var(--bg-secondary, #f5f5f5);
                border-top: 1px solid var(--border, #ddd);
            }

            .popover-btn {
                flex: 1;
                padding: 10px 16px;
                border: 1px solid var(--border, #ddd);
                border-radius: 6px;
                background: var(--bg, #fff);
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .popover-btn:hover {
                background: var(--bg-hover, #e9e9e9);
            }

            .popover-btn.primary {
                background: var(--accent, #007bff);
                border-color: var(--accent, #007bff);
                color: #fff;
            }

            .popover-btn.primary:hover {
                background: var(--accent-hover, #0056b3);
            }
        `;

        if (!document.querySelector('style[data-otf-popover]')) {
            document.head.appendChild(style);
        }
    }

    /**
     * Set up event listeners
     */
    _setupEventListeners() {
        // String buttons
        this.element.querySelectorAll('.string-button').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedString = parseInt(btn.dataset.string, 10);
                this._updateStringSelection();
                // A tie hangs off the previous note on THIS string, so
                // the row's availability moves with the string.
                this._refreshTechRow();
            });
        });

        // Fret buttons
        this.element.querySelectorAll('.fret-button').forEach(btn => {
            btn.addEventListener('click', () => {
                const fret = parseInt(btn.dataset.fret, 10);
                this.selectedFret = this.highFretOffset + fret;
                this.highFretOffset = 0;
                this.fretEntry.remember({ fret: this.selectedFret });
                this._updateFretDisplay();
            });
        });

        // Fret offset buttons
        this.element.querySelectorAll('.fret-offset-button').forEach(btn => {
            btn.addEventListener('click', () => {
                const offset = parseInt(btn.dataset.offset, 10);
                this.highFretOffset = offset;
                this._updateFretDisplay();
            });
        });

        // Fret delete button
        this.element.querySelector('.fret-delete').addEventListener('click', () => {
            this.selectedFret = 0;
            this.highFretOffset = 0;
            this.fretEntry.reset();
            this._updateFretDisplay();
        });

        // Technique buttons
        this.element.querySelectorAll('.tech-button').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                this.selectedTech = btn.dataset.tech || null;
                this._updateTechSelection();
            });
        });

        // Close button
        this.element.querySelector('.popover-close').addEventListener('click', () => {
            this.close();
        });

        // Cancel button
        this.element.querySelector('.cancel-btn').addEventListener('click', () => {
            this.close();
        });

        // Insert button
        this.element.querySelector('.insert-btn').addEventListener('click', () => {
            this._handleInsert();
        });
    }

    /**
     * The technique row's buttons, from the ONE articulation config
     * (`POPOVER_TECHS`). The tie is disabled — with the reason in its
     * tooltip — when there is nothing to tie from, because `setTie`
     * would refuse and the mark would vanish silently.
     */
    _renderTechButtons() {
        const tieOk = this._tieAvailable();
        return POPOVER_TECHS.map((cfg) => {
            const off = cfg.isTie && !tieOk;
            const title = off ? NO_TIE_REASON : cfg.label;
            const cls = ['tech-button'];
            if (cfg.isTie) cls.push('tech-tie');
            if (!off && this.selectedTech === cfg.tech) cls.push('selected');
            if (off) cls.push('is-unavailable');
            return `<button class="${cls.join(' ')}" data-tech="${cfg.tech}"`
                + ` title="${title}"${off ? ' disabled' : ''}>${cfg.symbol}</button>`;
        }).join('');
    }

    /**
     * Can a note entered here be tied? A tie hangs off the previous note
     * on the SAME string, so the answer moves with the string buttons.
     * Unknown (a bare state stub, no facade) counts as available — this
     * is a hint, not a gate.
     * @param {number} [string] - defaults to the selected string
     */
    _tieAvailable(string = this.selectedString) {
        const cursor = this.state?.cursor;
        const facade = this.state?.facade;
        if (!cursor || typeof facade?.tiePredecessor !== 'function') return true;
        try {
            return !!facade.tiePredecessor(
                { measure: cursor.measure, tick: cursor.tick, string },
                this.state.trackId);
        } catch {
            return false;
        }
    }

    /**
     * Update string button selection
     */
    _updateStringSelection() {
        this.element.querySelectorAll('.string-button').forEach(btn => {
            const string = parseInt(btn.dataset.string, 10);
            btn.classList.toggle('selected', string === this.selectedString);
        });
    }

    /**
     * Update fret display
     */
    _updateFretDisplay() {
        const valueEl = this.element.querySelector('.fret-value');
        const offsetEl = this.element.querySelector('.fret-offset-indicator');
        const offsetBtns = this.element.querySelectorAll('.fret-offset-button:not(.clear-offset)');

        valueEl.textContent = this.selectedFret;

        if (this.highFretOffset > 0) {
            offsetEl.textContent = `+${this.highFretOffset}`;
            offsetEl.classList.add('active');
        } else {
            offsetEl.textContent = '';
            offsetEl.classList.remove('active');
        }

        offsetBtns.forEach(btn => {
            const offset = parseInt(btn.dataset.offset, 10);
            btn.classList.toggle('active', offset === this.highFretOffset);
        });
    }

    /**
     * Update technique button selection
     */
    _updateTechSelection() {
        this.element.querySelectorAll('.tech-button').forEach(btn => {
            const tech = btn.dataset.tech || null;
            btn.classList.toggle('selected', tech === this.selectedTech);
        });
    }

    /**
     * Redraw the technique row after something the tie depends on moved.
     * A selected tie that just became impossible is dropped rather than
     * carried into an Insert that would silently ignore it.
     */
    _refreshTechRow() {
        const row = this.element?.querySelector('.technique-selector');
        if (!row) return;
        if (this.selectedTech === '~' && !this._tieAvailable()) this.selectedTech = null;
        const none = row.querySelector('.tech-none');
        row.innerHTML = this._renderTechButtons() + (none ? none.outerHTML : '');
        row.querySelectorAll('.tech-button').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                this.selectedTech = btn.dataset.tech || null;
                this._updateTechSelection();
            });
        });
        this._updateTechSelection();
    }

    /**
     * Handle insert
     */
    _handleInsert() {
        this.options.onInsert?.({
            string: this.selectedString,
            fret: this.selectedFret,
            tech: this.selectedTech,
        });
        this.close();
    }

    /**
     * Handle keyboard input
     */
    _onKeyDown(event) {
        if (!this.isOpen) return;

        const { key } = event;

        // Escape - close
        if (key === 'Escape') {
            event.preventDefault();
            this.close();
            return;
        }

        // Enter - insert
        if (key === 'Enter') {
            event.preventDefault();
            this._handleInsert();
            return;
        }

        // Number keys for fret — the SAME rule the canvas uses: a second
        // digit refines the first in place while it makes a real fret
        // (1 then 2 → 12), otherwise it starts over (1 2 3 → 3).
        if (/^[0-9]$/.test(key) && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            const result = this.fretEntry.digit(parseInt(key, 10));
            if (result.kind !== 'pending') {
                this.selectedFret = result.fret;
                this.highFretOffset = 0;
                this.fretEntry.remember({ fret: result.fret });
            }
            this._updateFretDisplay();
            return;
        }

        // f — the canvas's high-fret prefix: the next two digits are one
        // fret. Same key, same meaning, in both surfaces.
        if (key === 'f') {
            event.preventDefault();
            this.fretEntry.armHighFret();
            return;
        }

        // String selection (1-5 when holding Shift)
        if (event.shiftKey && /^[1-5]$/.test(key)) {
            event.preventDefault();
            const stringCount = this.state.getStringCount();
            const string = parseInt(key, 10);
            if (string <= stringCount) {
                this.selectedString = string;
                this._updateStringSelection();
                this._refreshTechRow();
            }
            return;
        }

        // Technique shortcuts — the same row the buttons draw, so `x`
        // (dead) and `b` (choke) type here exactly as they do on canvas.
        const tech = POPOVER_TECHS.find(cfg => cfg.tech === key && !cfg.isTie);
        if (tech) {
            event.preventDefault();
            this.selectedTech = this.selectedTech === tech.tech ? null : tech.tech;
            this._updateTechSelection();
            return;
        }

        // Backspace - drop the last digit
        if (key === 'Backspace') {
            event.preventDefault();
            this.selectedFret = Math.floor(this.selectedFret / 10);
            this.fretEntry.remember({ fret: this.selectedFret });
            this._updateFretDisplay();
            return;
        }
    }

    /**
     * Open popover at position
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {Object} defaults - Default values
     */
    open(x, y, defaults = {}) {
        this.position = { x, y };
        this.selectedString = defaults.string || this.state.cursor.string || 3;
        this.selectedFret = defaults.fret || 0;
        this.selectedTech = defaults.tech || null;
        this.highFretOffset = 0;
        this.fretEntry.reset();
        if (this.selectedFret) this.fretEntry.remember({ fret: this.selectedFret });

        // Update UI
        this.element.innerHTML = this._renderContent();
        this._setupEventListeners();

        // Position popover (centered in overlay)
        this.overlay.style.display = 'flex';
        this.isOpen = true;

        // Add keyboard listener
        document.addEventListener('keydown', this._onKeyDown);

        // Focus first element. The popover can be closed or destroyed
        // inside these 50ms, so re-check rather than throwing into a
        // timer nobody is catching.
        this._focusTimer = setTimeout(() => {
            this._focusTimer = null;
            this.element?.querySelector('.fret-button')?.focus();
        }, 50);
    }

    /**
     * Close popover
     */
    close() {
        this.overlay.style.display = 'none';
        this.isOpen = false;
        document.removeEventListener('keydown', this._onKeyDown);
        this.options.onCancel?.();
    }

    /**
     * Check if popover is open
     */
    get opened() {
        return this.isOpen;
    }

    /**
     * Destroy popover
     */
    destroy() {
        document.removeEventListener('keydown', this._onKeyDown);
        if (this._focusTimer) clearTimeout(this._focusTimer);
        this._focusTimer = null;
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.element = null;
    }
}

/**
 * Annotation Popover
 *
 * The prompt for the score's placed free text: section banners
 * ("PART A"), playing notes ("Long Choke") and chord names ("Bb6+9")
 * all live in the same `annotations` array, so this doubles as the
 * chord-name entry.
 *
 * It is anchored to the editor CURSOR, not to a click: the caller opens
 * it with the position and the text already there (if any), and gets
 * back the trimmed text on commit. Clearing the box and saving is a
 * delete — the same thing the Delete button does — so there is never a
 * blank annotation to hunt for later.
 */
export class AnnotationPopover {
    constructor(options = {}) {
        this.options = {
            onCommit: null,   // (text) => void — '' means delete
            onDelete: null,
            onCancel: null,
            ...options,
        };

        this.element = null;
        this.overlay = null;
        this.input = null;
        this.isOpen = false;
        this.context = null;   // {measure, tick, existing}

        this._onKeyDown = this._onKeyDown.bind(this);
    }

    /** Common labels — one tap instead of typing, like the fret pad. */
    static SUGGESTIONS = ['Intro', 'PART A', 'PART B', 'Chorus', 'Solo', 'Ending'];

    init(container) {
        this._applyStyles();

        this.overlay = document.createElement('div');
        this.overlay.className = 'otf-popover-overlay otf-annotation-overlay';
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.element = document.createElement('div');
        this.element.className = 'otf-note-popover otf-annotation-popover';
        this.overlay.appendChild(this.element);
        container.appendChild(this.overlay);

        this.overlay.style.display = 'none';
    }

    _applyStyles() {
        if (document.querySelector('style[data-otf-annotation-popover]')) return;
        const style = document.createElement('style');
        style.setAttribute('data-otf-annotation-popover', '');
        style.textContent = `
            .otf-annotation-popover .annotation-input {
                width: 100%;
                box-sizing: border-box;
                padding: 10px 12px;
                font-size: 16px;
                border: 2px solid var(--border, #ddd);
                border-radius: 8px;
                background: var(--bg, #fff);
                color: var(--text, #333);
            }

            .otf-annotation-popover .annotation-input:focus {
                outline: none;
                border-color: var(--accent, #007bff);
            }

            .otf-annotation-popover .annotation-where {
                font-size: 11px;
                color: var(--text-muted, #888);
                margin-top: 8px;
            }

            .otf-annotation-popover .annotation-suggestions {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 10px;
            }

            .otf-annotation-popover .annotation-suggestion {
                padding: 5px 10px;
                font-size: 12px;
                border: 1px solid var(--border, #ddd);
                border-radius: 999px;
                background: var(--bg, #fff);
                color: var(--text, #333);
                cursor: pointer;
            }

            .otf-annotation-popover .annotation-suggestion:hover {
                background: var(--bg-hover, #e9e9e9);
            }

            .otf-annotation-popover .delete-btn {
                flex: 0 0 auto;
                color: var(--danger, #dc3545);
            }
        `;
        document.head.appendChild(style);
    }

    _renderContent() {
        const { existing } = this.context;
        const chips = AnnotationPopover.SUGGESTIONS.map(
            s => `<button class="annotation-suggestion" data-text="${escapeAttr(s)}">${escapeHtml(s)}</button>`
        ).join('');

        return `
            <div class="popover-header">
                <span class="popover-title">${existing ? 'Edit text' : 'Add text'}</span>
                <button class="popover-close" title="Close (Escape)">&times;</button>
            </div>
            <div class="popover-body">
                <div class="popover-section">
                    <label class="section-label">Text</label>
                    <input type="text" class="annotation-input"
                           value="${escapeAttr(existing || '')}"
                           placeholder="PART A, Long Choke, Bb6+9…"
                           autocomplete="off" spellcheck="false">
                    <div class="annotation-where">
                        Measure ${this.context.measure}, beat ${this.context.beatLabel}
                        · empty text deletes
                    </div>
                    <div class="annotation-suggestions">${chips}</div>
                </div>
            </div>
            <div class="popover-footer">
                <button class="popover-btn cancel-btn">Cancel</button>
                ${existing ? '<button class="popover-btn delete-btn">Delete</button>' : ''}
                <button class="popover-btn save-btn primary">Save</button>
            </div>
        `;
    }

    _setupEventListeners() {
        this.input = this.element.querySelector('.annotation-input');

        this.element.querySelector('.popover-close')
            .addEventListener('click', () => this.close());
        this.element.querySelector('.cancel-btn')
            .addEventListener('click', () => this.close());
        this.element.querySelector('.save-btn')
            .addEventListener('click', () => this._commit());

        const del = this.element.querySelector('.delete-btn');
        del?.addEventListener('click', () => this._delete());

        this.element.querySelectorAll('.annotation-suggestion').forEach(btn => {
            btn.addEventListener('click', () => {
                this.input.value = btn.dataset.text;
                this.input.focus();
            });
        });

        // Keys are handled on the panel so the editor's own keyboard
        // handler never sees them (it would read them as commands)
        this.element.addEventListener('keydown', this._onKeyDown);
    }

    _onKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this._commit();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }
        // Everything else is ordinary text editing
        event.stopPropagation();
    }

    _commit() {
        const text = (this.input?.value || '').trim();
        this._closeQuietly();
        this.options.onCommit?.(text);
    }

    _delete() {
        this._closeQuietly();
        this.options.onDelete?.();
    }

    /**
     * Open the prompt for a cursor position.
     * @param {Object} context - {measure, tick, existing, beatLabel}
     */
    open(context = {}) {
        this.context = {
            measure: context.measure ?? 1,
            tick: context.tick ?? 0,
            existing: context.existing || '',
            beatLabel: context.beatLabel ?? '1',
        };

        this.element.innerHTML = this._renderContent();
        this._setupEventListeners();

        this.overlay.style.display = 'flex';
        this.isOpen = true;

        // Focus + select so retyping replaces, and Enter alone commits
        setTimeout(() => {
            this.input?.focus();
            this.input?.select();
        }, 0);
        this.input?.focus();
        this.input?.select();
    }

    /** Close without firing onCancel (used after commit/delete). */
    _closeQuietly() {
        if (this.overlay) this.overlay.style.display = 'none';
        this.isOpen = false;
    }

    close() {
        const wasOpen = this.isOpen;
        this._closeQuietly();
        if (wasOpen) this.options.onCancel?.();
    }

    get opened() {
        return this.isOpen;
    }

    destroy() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.element = null;
        this.input = null;
    }
}

/**
 * Track Name Popover — rename an instrument track.
 *
 * A track's `id` is its name: it is what the site prints on the stave's
 * track-info row and in the mixer, and it is the key its notation lives
 * under. So this prompt writes a real identity, and it guards the two
 * ways that can go wrong before the facade is ever asked: a blank name,
 * and a name another track already holds (which would collide in
 * `notation`). Both surface inline, with Save disabled — the facade
 * throws on a duplicate, and a thrown error is not an error message.
 *
 * Sibling of AnnotationPopover in every other way: same overlay/panel
 * chrome, Enter commits, Escape cancels, keys are swallowed so the
 * editor's vim bindings never see what you typed.
 */
export class TrackNamePopover {
    constructor(options = {}) {
        this.options = {
            onCommit: null,   // (name) => void
            onCancel: null,
            sanitize: (s) => String(s ?? '').trim(),
            ...options,
        };

        this.element = null;
        this.overlay = null;
        this.input = null;
        this.saveButton = null;
        this.errorEl = null;
        this.isOpen = false;
        this.context = null;   // {current, instrument, taken, position, total}

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onInput = this._onInput.bind(this);
    }

    init(container) {
        this._applyStyles();

        this.overlay = document.createElement('div');
        this.overlay.className = 'otf-popover-overlay otf-track-name-overlay';
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.element = document.createElement('div');
        this.element.className = 'otf-note-popover otf-track-name-popover';
        this.overlay.appendChild(this.element);
        container.appendChild(this.overlay);

        this.overlay.style.display = 'none';
    }

    _applyStyles() {
        if (document.querySelector('style[data-otf-track-name-popover]')) return;
        const style = document.createElement('style');
        style.setAttribute('data-otf-track-name-popover', '');
        style.textContent = `
            .otf-track-name-popover .track-name-input {
                width: 100%;
                box-sizing: border-box;
                padding: 10px 12px;
                font-size: 16px;
                border: 2px solid var(--border, #ddd);
                border-radius: 8px;
                background: var(--bg, #fff);
                color: var(--text, #333);
            }

            .otf-track-name-popover .track-name-input:focus {
                outline: none;
                border-color: var(--accent, #007bff);
            }

            .otf-track-name-popover .track-name-where {
                font-size: 11px;
                color: var(--text-muted, #888);
                margin-top: 8px;
            }

            .otf-track-name-popover .track-name-error {
                font-size: 12px;
                color: var(--danger, #dc3545);
                margin-top: 8px;
                min-height: 1em;
            }

            .otf-track-name-popover .popover-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }

    _renderContent() {
        const { current, instrument, position, total } = this.context;
        const where = total > 1
            ? `Track ${position} of ${total} — the first track is the lead`
            : 'The only track in this tab';
        const kind = instrument && instrument !== current
            ? ` · ${escapeHtml(instrument)}`
            : '';

        return `
            <div class="popover-header">
                <span class="popover-title">Rename track</span>
                <button class="popover-close" title="Close (Escape)">&times;</button>
            </div>
            <div class="popover-body">
                <div class="popover-section">
                    <label class="section-label">Track name</label>
                    <input type="text" class="track-name-input"
                           value="${escapeAttr(current)}"
                           placeholder="banjo, lead guitar, harmony…"
                           autocomplete="off" spellcheck="false">
                    <div class="track-name-where">${where}${kind}</div>
                    <div class="track-name-error" role="alert"></div>
                </div>
            </div>
            <div class="popover-footer">
                <button class="popover-btn cancel-btn">Cancel</button>
                <button class="popover-btn save-btn primary">Save</button>
            </div>
        `;
    }

    _setupEventListeners() {
        this.input = this.element.querySelector('.track-name-input');
        this.saveButton = this.element.querySelector('.save-btn');
        this.errorEl = this.element.querySelector('.track-name-error');

        this.element.querySelector('.popover-close')
            .addEventListener('click', () => this.close());
        this.element.querySelector('.cancel-btn')
            .addEventListener('click', () => this.close());
        this.saveButton.addEventListener('click', () => this._commit());

        this.input.addEventListener('input', this._onInput);
        this.element.addEventListener('keydown', this._onKeyDown);
    }

    /** The problem with what is typed, or '' when it is fine. */
    _problem(raw) {
        const clean = this.options.sanitize(raw);
        if (!clean) return 'A track needs a name.';
        if (clean === this.context.current) return '';
        if ((this.context.taken || []).includes(clean)) {
            return `Another track is already called “${clean}”.`;
        }
        return '';
    }

    _onInput() {
        const problem = this._problem(this.input.value);
        this.errorEl.textContent = problem;
        this.saveButton.disabled = !!problem;
    }

    _onKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this._commit();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }
        event.stopPropagation();
    }

    _commit() {
        const raw = this.input?.value || '';
        if (this._problem(raw)) {
            this._onInput();
            return;
        }
        this._closeQuietly();
        this.options.onCommit?.(this.options.sanitize(raw));
    }

    /**
     * Open the prompt for a track.
     * @param {Object} context - {current, instrument, taken, position, total}
     */
    open(context = {}) {
        this.context = {
            current: context.current ?? '',
            instrument: context.instrument || '',
            taken: context.taken || [],
            position: context.position ?? 1,
            total: context.total ?? 1,
        };

        this.element.innerHTML = this._renderContent();
        this._setupEventListeners();
        this._onInput();

        this.overlay.style.display = 'flex';
        this.isOpen = true;

        setTimeout(() => {
            this.input?.focus();
            this.input?.select();
        }, 0);
        this.input?.focus();
        this.input?.select();
    }

    /** Close without firing onCancel (used after commit). */
    _closeQuietly() {
        if (this.overlay) this.overlay.style.display = 'none';
        this.isOpen = false;
    }

    close() {
        const wasOpen = this.isOpen;
        this._closeQuietly();
        if (wasOpen) this.options.onCancel?.();
    }

    get opened() {
        return this.isOpen;
    }

    destroy() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.element = null;
        this.input = null;
        this.saveButton = null;
        this.errorEl = null;
    }
}

/**
 * Value Prompt Popover — "type one number, press Enter".
 *
 * The fourth sibling of the note / annotation / track-name panels, and the
 * reason `window.prompt` is gone from the editor. Two callers today —
 * Go to measure (Ctrl+G) and Play ▸ Tempo… — and both want the same
 * three things a native prompt could not give us:
 *
 * 1. **It is in the app.** A native dialog is drawn by the browser, so
 *    it is invisible to Playwright's DOM, un-themeable, and on iOS it
 *    steals the page's focus in a way the editor never gets back. The
 *    owner's rule is that everything a human can do must be reachable by
 *    a test; a `prompt()` is by construction not.
 * 2. **It validates before it commits.** `prompt` hands back a string and
 *    leaves the caller to silently discard nonsense. Here the range is
 *    stated under the input, a bad value says why, and Save is disabled
 *    until it isn't.
 * 3. **Keys stop here.** Same as its siblings: the panel swallows keydown
 *    so the editor's vim bindings never see what you typed.
 *
 * Commit is asynchronous by nature (the answer arrives on a click or an
 * Enter, not on the call), so callers get `onCommit(value)` rather than a
 * return value — see `_promptForMeasure` in editor.js for how a binding
 * that used to read a return value now dispatches on the callback.
 */
export class ValuePromptPopover {
    constructor(options = {}) {
        this.options = {
            onCommit: null,   // (value:number) => void
            onCancel: null,
            ...options,
        };

        this.element = null;
        this.overlay = null;
        this.input = null;
        this.saveButton = null;
        this.errorEl = null;
        this.isOpen = false;
        this.context = null;

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onInput = this._onInput.bind(this);
    }

    init(container) {
        this._applyStyles();

        this.overlay = document.createElement('div');
        this.overlay.className = 'otf-popover-overlay otf-value-prompt-overlay';
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.element = document.createElement('div');
        this.element.className = 'otf-note-popover otf-value-prompt-popover';
        this.overlay.appendChild(this.element);
        container.appendChild(this.overlay);

        this.overlay.style.display = 'none';
    }

    _applyStyles() {
        if (document.querySelector('style[data-otf-value-prompt]')) return;
        const style = document.createElement('style');
        style.setAttribute('data-otf-value-prompt', '');
        style.textContent = `
            .otf-value-prompt-popover .value-prompt-input {
                width: 100%;
                box-sizing: border-box;
                padding: 10px 12px;
                font-size: 16px;
                border: 2px solid var(--border, #ddd);
                border-radius: 8px;
                background: var(--bg, #fff);
                color: var(--text, #333);
            }

            .otf-value-prompt-popover .value-prompt-input:focus {
                outline: none;
                border-color: var(--accent, #007bff);
            }

            .otf-value-prompt-popover .value-prompt-hint {
                font-size: 11px;
                color: var(--text-muted, #888);
                margin-top: 8px;
            }

            .otf-value-prompt-popover .value-prompt-error {
                font-size: 12px;
                color: var(--danger, #dc3545);
                margin-top: 8px;
                min-height: 1em;
            }

            .otf-value-prompt-popover .popover-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }

    _renderContent() {
        const { title, label, hint } = this.context;
        return `
            <div class="popover-header">
                <span class="popover-title">${escapeHtml(title)}</span>
                <button class="popover-close" title="Close (Escape)">&times;</button>
            </div>
            <div class="popover-body">
                <div class="popover-section">
                    <label class="section-label">${escapeHtml(label)}</label>
                    <input type="text" class="value-prompt-input"
                           inputmode="numeric" pattern="[0-9]*"
                           value="${escapeAttr(this.context.value)}"
                           autocomplete="off" spellcheck="false">
                    <div class="value-prompt-hint">${escapeHtml(hint)}</div>
                    <div class="value-prompt-error" role="alert"></div>
                </div>
            </div>
            <div class="popover-footer">
                <button class="popover-btn cancel-btn">Cancel</button>
                <button class="popover-btn save-btn primary">${escapeHtml(this.context.commitLabel)}</button>
            </div>
        `;
    }

    _setupEventListeners() {
        this.input = this.element.querySelector('.value-prompt-input');
        this.saveButton = this.element.querySelector('.save-btn');
        this.errorEl = this.element.querySelector('.value-prompt-error');

        this.element.querySelector('.popover-close')
            .addEventListener('click', () => this.close());
        this.element.querySelector('.cancel-btn')
            .addEventListener('click', () => this.close());
        this.saveButton.addEventListener('click', () => this._commit());

        this.input.addEventListener('input', this._onInput);
        this.element.addEventListener('keydown', this._onKeyDown);
    }

    /** The problem with what is typed, or '' when it is fine. */
    _problem(raw) {
        const text = String(raw ?? '').trim();
        if (!text) return 'Type a number.';
        const n = Number(text);
        if (!Number.isFinite(n)) return 'That isn’t a number.';
        if (this.context.integer && !Number.isInteger(n)) {
            return 'Whole numbers only.';
        }
        const { min, max } = this.context;
        if (n < min || n > max) return `Pick something between ${min} and ${max}.`;
        return '';
    }

    _onInput() {
        const problem = this._problem(this.input.value);
        this.errorEl.textContent = problem;
        this.saveButton.disabled = !!problem;
    }

    _onKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this._commit();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }
        event.stopPropagation();
    }

    _commit() {
        const raw = this.input?.value || '';
        if (this._problem(raw)) {
            this._onInput();
            return;
        }
        this._closeQuietly();
        this.options.onCommit?.(Number(String(raw).trim()));
    }

    /**
     * @param {Object} context
     * @param {string} context.title - panel heading ("Go to measure")
     * @param {string} context.label - the field's label
     * @param {string} [context.hint] - the range, in words
     * @param {number|string} [context.value] - pre-filled (and selected)
     * @param {number} [context.min] @param {number} [context.max]
     * @param {boolean} [context.integer]
     * @param {string} [context.commitLabel]
     */
    open(context = {}) {
        this.context = {
            title: context.title ?? 'Enter a value',
            label: context.label ?? 'Value',
            hint: context.hint ?? '',
            value: context.value ?? '',
            min: Number.isFinite(context.min) ? context.min : -Infinity,
            max: Number.isFinite(context.max) ? context.max : Infinity,
            integer: context.integer !== false,
            commitLabel: context.commitLabel ?? 'Go',
        };

        this.element.innerHTML = this._renderContent();
        this._setupEventListeners();
        this._onInput();

        this.overlay.style.display = 'flex';
        this.isOpen = true;

        setTimeout(() => {
            this.input?.focus();
            this.input?.select();
        }, 0);
        this.input?.focus();
        this.input?.select();
    }

    /** Close without firing onCancel (used after commit). */
    _closeQuietly() {
        if (this.overlay) this.overlay.style.display = 'none';
        this.isOpen = false;
    }

    close() {
        const wasOpen = this.isOpen;
        this._closeQuietly();
        if (wasOpen) this.options.onCancel?.();
    }

    get opened() {
        return this.isOpen;
    }

    destroy() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.element = null;
        this.input = null;
        this.saveButton = null;
        this.errorEl = null;
    }
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Attribute-position escape (the module-local twin of utils.js escapeAttr —
// this file deliberately keeps its own string-only escapeHtml so it needs no
// DOM). Both quotes, not just the double one: a single-quoted attribute is
// just as breakable, and the next hole here may use one.
function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
