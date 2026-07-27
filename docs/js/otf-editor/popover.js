// OTF Editor Note Entry Popover
// UI for entering notes via click/tap

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
                        <button class="tech-button${this.selectedTech === 'h' ? ' selected' : ''}" data-tech="h" title="Hammer-on">h</button>
                        <button class="tech-button${this.selectedTech === 'p' ? ' selected' : ''}" data-tech="p" title="Pull-off">p</button>
                        <button class="tech-button${this.selectedTech === '/' ? ' selected' : ''}" data-tech="/" title="Slide">/</button>
                        <button class="tech-button${this.selectedTech === '~' ? ' selected' : ''}" data-tech="~" title="Tie">~</button>
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
            });
        });

        // Fret buttons
        this.element.querySelectorAll('.fret-button').forEach(btn => {
            btn.addEventListener('click', () => {
                const fret = parseInt(btn.dataset.fret, 10);
                this.selectedFret = this.highFretOffset + fret;
                this.highFretOffset = 0;
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
            this._updateFretDisplay();
        });

        // Technique buttons
        this.element.querySelectorAll('.tech-button').forEach(btn => {
            btn.addEventListener('click', () => {
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

        // Number keys for fret
        if (/^[0-9]$/.test(key)) {
            event.preventDefault();
            const digit = parseInt(key, 10);
            if (this.selectedFret === 0) {
                this.selectedFret = digit;
            } else {
                this.selectedFret = this.selectedFret * 10 + digit;
                if (this.selectedFret > 24) {
                    this.selectedFret = digit;
                }
            }
            this._updateFretDisplay();
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
            }
            return;
        }

        // Technique shortcuts
        if (key === 'h') {
            event.preventDefault();
            this.selectedTech = this.selectedTech === 'h' ? null : 'h';
            this._updateTechSelection();
            return;
        }
        if (key === 'p') {
            event.preventDefault();
            this.selectedTech = this.selectedTech === 'p' ? null : 'p';
            this._updateTechSelection();
            return;
        }
        if (key === '/') {
            event.preventDefault();
            this.selectedTech = this.selectedTech === '/' ? null : '/';
            this._updateTechSelection();
            return;
        }

        // Backspace - clear fret
        if (key === 'Backspace') {
            event.preventDefault();
            this.selectedFret = Math.floor(this.selectedFret / 10);
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

        // Update UI
        this.element.innerHTML = this._renderContent();
        this._setupEventListeners();

        // Position popover (centered in overlay)
        this.overlay.style.display = 'flex';
        this.isOpen = true;

        // Add keyboard listener
        document.addEventListener('keydown', this._onKeyDown);

        // Focus first element
        setTimeout(() => {
            const firstBtn = this.element.querySelector('.fret-button');
            firstBtn?.focus();
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
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.element = null;
    }
}
