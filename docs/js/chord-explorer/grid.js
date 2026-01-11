// Beat grid module for chord progression explorer
// Handles grid data model, rendering, drag-and-drop, and playback

import { getChordVoicing, getInversionCount, is7thChord } from './theory.js';
import { getSynth } from './synth.js';

/**
 * ChordGrid - Data model for the beat grid
 */
export class ChordGrid {
    constructor() {
        this.bars = 4;
        this.timeSignature = '2/2';
        this.tempo = 120;
        this.cells = [];
        this.initCells();
    }

    /**
     * Get beats per measure based on time signature
     */
    getBeatsPerMeasure() {
        const map = {
            '2/2': 2,
            '4/4': 4,
            '3/4': 3,
            '6/8': 6
        };
        return map[this.timeSignature] || 4;
    }

    /**
     * Get total number of cells
     */
    getTotalCells() {
        return this.bars * this.getBeatsPerMeasure();
    }

    /**
     * Initialize/resize cells array
     */
    initCells() {
        const totalCells = this.getTotalCells();
        const newCells = [];

        for (let i = 0; i < totalCells; i++) {
            // Preserve existing cells if resizing
            newCells.push(this.cells[i] || null);
        }

        this.cells = newCells;
    }

    /**
     * Resize the grid (change number of bars)
     */
    resize(bars) {
        this.bars = Math.max(1, Math.min(16, bars));
        this.initCells();
    }

    /**
     * Set time signature
     */
    setTimeSignature(sig) {
        if (['2/2', '4/4', '3/4', '6/8'].includes(sig)) {
            this.timeSignature = sig;
            this.initCells();
        }
    }

    /**
     * Set a chord in a cell
     * @param {number} index - Cell index
     * @param {Object} chord - Chord object from theory.js
     * @param {number} inversion - Inversion (0-3)
     * @param {number} octave - Octave offset (-1, 0, 1)
     */
    setCell(index, chord, inversion = 0, octave = 0) {
        if (index >= 0 && index < this.cells.length) {
            this.cells[index] = {
                chord,
                inversion,
                octave
            };
        }
    }

    /**
     * Clear a cell
     */
    clearCell(index) {
        if (index >= 0 && index < this.cells.length) {
            this.cells[index] = null;
        }
    }

    /**
     * Clear all cells
     */
    clearAll() {
        this.cells = this.cells.map(() => null);
    }

    /**
     * Get cell data
     */
    getCell(index) {
        return this.cells[index] || null;
    }

    /**
     * Check if grid has any chords
     */
    hasChords() {
        return this.cells.some(cell => cell !== null);
    }

    /**
     * Export grid state for localStorage
     */
    toJSON() {
        return {
            bars: this.bars,
            timeSignature: this.timeSignature,
            tempo: this.tempo,
            cells: this.cells.map(cell => {
                if (!cell) return null;
                return {
                    chord: {
                        root: cell.chord.root,
                        quality: cell.chord.quality,
                        numeral: cell.chord.numeral,
                        display: cell.chord.display
                    },
                    inversion: cell.inversion,
                    octave: cell.octave
                };
            })
        };
    }

    /**
     * Import grid state from localStorage
     */
    fromJSON(data) {
        if (!data) return;
        this.bars = data.bars || 4;
        this.timeSignature = data.timeSignature || '2/2';
        this.tempo = data.tempo || 120;
        this.cells = data.cells || [];
        this.initCells(); // Ensure proper length
    }
}

/**
 * GridView - UI component for the beat grid
 */
export class GridView {
    constructor(container, grid, options = {}) {
        this.container = container;
        this.grid = grid;
        this.synth = getSynth();
        this.onCellClick = options.onCellClick || (() => {});
        this.onChordSelected = options.onChordSelected || (() => {});
        this.chordControlsContainer = options.chordControlsContainer || null;
        this.selectedChord = null;
        this.selectedCellIndex = -1;  // Currently selected cell for keyboard input
        this.isPlaying = false;
        this.playbackPosition = -1;
        this.animationFrame = null;
        this.playStartTime = 0;
        this.looping = true;  // Loop by default
        this.loopTimeoutId = null;

        this.render();
        this.setupKeyboardListeners();
    }

    /**
     * Set up keyboard listeners for cell shortcuts
     */
    setupKeyboardListeners() {
        document.addEventListener('keydown', (e) => {
            // Skip if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            // Escape to deselect
            if (e.key === 'Escape') {
                this.deselectCell();
            }

            // Delete/Backspace to remove selected chord
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedCellIndex >= 0) {
                e.preventDefault();
                this.grid.clearCell(this.selectedCellIndex);
                this.deselectCell();
                this.render();
                this.saveToStorage();
            }
        });
    }

    /**
     * Adjust octave for a cell
     */
    adjustOctave(index, direction) {
        const cell = this.grid.getCell(index);
        if (!cell) return;

        const newOctave = Math.max(-4, Math.min(4, cell.octave + direction));
        if (newOctave !== cell.octave) {
            this.grid.setCell(index, cell.chord, cell.inversion, newOctave);
            this.render();
            this.saveToStorage();
            this.previewCell(index);
        }
    }

    /**
     * Adjust inversion for a cell
     */
    adjustInversion(index, direction) {
        const cell = this.grid.getCell(index);
        if (!cell) return;

        // Get max inversions based on chord type (3 for triads, 4 for 7ths)
        const maxInv = getInversionCount(cell.chord.quality);
        let newInversion = cell.inversion + direction;
        if (newInversion < 0) newInversion = maxInv - 1;
        if (newInversion >= maxInv) newInversion = 0;

        this.grid.setCell(index, cell.chord, newInversion, cell.octave);
        this.render();
        this.saveToStorage();
        this.previewCell(index);
    }

    /**
     * Set the quality of a cell's chord
     */
    setChordQuality(index, quality) {
        const cell = this.grid.getCell(index);
        if (!cell || cell.chord?.isStop) return;

        // Update chord with new quality
        const newChord = {
            ...cell.chord,
            quality: quality,
            display: this.formatChordDisplay(cell.chord.root, quality)
        };

        // Reset inversion if it exceeds max for new quality
        const maxInv = getInversionCount(quality);
        const newInversion = cell.inversion >= maxInv ? 0 : cell.inversion;

        this.grid.setCell(index, newChord, newInversion, cell.octave);
        this.render();
        this.saveToStorage();
        this.previewCell(index);
    }

    /**
     * Format chord display name based on quality
     */
    formatChordDisplay(root, quality) {
        switch (quality) {
            case 'maj': return root;
            case 'min': return root + 'm';
            case 'dim': return root + '°';
            case 'aug': return root + '+';
            case 'maj7': return root + 'maj7';
            case 'min7': return root + 'm7';
            case 'dom7': return root + '7';
            case 'dim7': return root + '°7';
            case 'min7b5': return root + 'm7b5';
            case 'sus2': return root + 'sus2';
            case 'sus4': return root + 'sus4';
            default: return root + quality;
        }
    }

    /**
     * Select a cell for keyboard input
     */
    selectCell(index) {
        this.selectedCellIndex = index;
        this.updateSelectedCellVisual();
        // Notify that a chord is selected (for showing chord controls)
        const cell = this.grid.getCell(index);
        this.onChordSelected(cell && !cell.chord?.isStop);
    }

    /**
     * Deselect the current cell
     */
    deselectCell() {
        this.selectedCellIndex = -1;
        this.updateSelectedCellVisual();
        // Notify that no chord is selected
        this.onChordSelected(false);
    }

    /**
     * Update visual selection state
     */
    updateSelectedCellVisual() {
        this.container.querySelectorAll('.grid-cell').forEach(cell => {
            cell.classList.remove('selected');
        });

        if (this.selectedCellIndex >= 0) {
            const cell = this.container.querySelector(`[data-cell-index="${this.selectedCellIndex}"]`);
            if (cell) {
                cell.classList.add('selected');
            }
        }
    }

    /**
     * Render the grid UI
     */
    render() {
        const beatsPerMeasure = this.grid.getBeatsPerMeasure();
        let html = '<div class="grid-bars-container">';

        for (let bar = 0; bar < this.grid.bars; bar++) {
            html += `<div class="grid-bar-wrapper">`;
            html += `<div class="grid-bar">`;

            for (let beat = 0; beat < beatsPerMeasure; beat++) {
                const cellIndex = bar * beatsPerMeasure + beat;
                const cell = this.grid.getCell(cellIndex);

                const isSelected = cellIndex === this.selectedCellIndex;
                const hasChord = cell !== null;
                const isStop = cell?.chord?.isStop;
                html += `
                    <div class="grid-cell${isSelected ? ' selected' : ''}${hasChord ? ' has-chord' : ''}${isStop ? ' has-stop' : ''}"
                         data-cell-index="${cellIndex}"
                         draggable="false">
                        ${cell ? this.renderCellContent(cell, cellIndex) : '<span class="cell-empty">+</span>'}
                    </div>
                `;
            }

            html += `</div>`;
            html += `<div class="bar-label">Bar ${bar + 1}</div>`;
            html += `</div>`;
        }

        html += '</div>';

        this.container.innerHTML = html;

        // Render chord controls to separate container if provided
        if (this.chordControlsContainer) {
            this.chordControlsContainer.innerHTML = this.renderChordControlsBar();
            this.attachChordControlsListeners();
        }

        this.attachEventListeners();
    }

    /**
     * Render content for a filled cell
     */
    renderCellContent(cell, cellIndex) {
        // For stop tokens, just show the symbol
        if (cell.chord?.isStop) {
            return `
                <span class="cell-chord">Stop</span>
                <span class="cell-numeral">∅</span>
            `;
        }

        // Show chord name, numeral, and small indicators for octave/inversion if non-default
        const indicators = [];
        if (cell.octave !== 0) {
            indicators.push(`o${cell.octave > 0 ? '+' : ''}${cell.octave}`);
        }
        if (cell.inversion !== 0) {
            indicators.push(`i${cell.inversion}`);
        }

        return `
            <span class="cell-chord">${cell.chord.display}</span>
            <span class="cell-numeral">${cell.chord.numeral}</span>
            ${indicators.length ? `<span class="cell-indicators">${indicators.join(' ')}</span>` : ''}
        `;
    }

    /**
     * Render the chord controls bar (shown when a cell is selected)
     */
    renderChordControlsBar() {
        const cell = this.selectedCellIndex >= 0 ? this.grid.getCell(this.selectedCellIndex) : null;

        // Don't show for stop tokens or when no cell selected
        if (!cell || cell.chord?.isStop) {
            return '<div class="ce-no-selection" style="padding: 0.5rem; color: var(--text-secondary); font-size: 0.85rem;">Select a chord to modify it</div>';
        }

        const quality = cell.chord.quality;
        const maxInv = getInversionCount(quality);

        // Quality buttons - triads and 7ths
        const qualities = [
            { id: 'maj', label: 'maj' },
            { id: 'min', label: 'min' },
            { id: 'dom7', label: '7' },
            { id: 'maj7', label: 'M7' },
            { id: 'min7', label: 'm7' },
            { id: 'dim', label: 'dim' },
            { id: 'sus4', label: 'sus' }
        ];

        const qualityButtons = qualities.map(q =>
            `<button class="ce-btn${quality === q.id ? ' active' : ''}" data-quality="${q.id}">${q.label}</button>`
        ).join('');

        // Inversion buttons
        const inversionLabels = ['Root', '1st', '2nd', '3rd'];
        const inversionButtons = [];
        for (let i = 0; i < maxInv; i++) {
            inversionButtons.push(
                `<button class="ce-btn${cell.inversion === i ? ' active' : ''}" data-inversion="${i}">${inversionLabels[i]}</button>`
            );
        }

        // Octave display
        const octaveDisplay = cell.octave > 0 ? `+${cell.octave}` : cell.octave.toString();

        return `
            <div class="ce-controls-row">
                <span class="ce-section-label">Quality</span>
                <div class="ce-group">
                    ${qualityButtons}
                </div>
            </div>
            <div class="ce-controls-row">
                <span class="ce-section-label">Inversion</span>
                <div class="ce-group">
                    ${inversionButtons.join('')}
                </div>
                <span class="ce-section-label">Octave</span>
                <div class="ce-group">
                    <button class="ce-btn" data-octave="-1">−</button>
                    <span class="ce-label">${octaveDisplay}</span>
                    <button class="ce-btn" data-octave="1">+</button>
                </div>
                <button class="ce-danger-btn" data-action="delete" title="Delete chord">🗑️ Delete</button>
            </div>
        `;
    }

    /**
     * Attach event listeners to chord controls
     */
    attachChordControlsListeners() {
        if (!this.chordControlsContainer) return;

        // Quality buttons
        this.chordControlsContainer.querySelectorAll('[data-quality]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const quality = btn.dataset.quality;
                this.setChordQuality(this.selectedCellIndex, quality);
            });
        });

        // Inversion buttons
        this.chordControlsContainer.querySelectorAll('[data-inversion]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const inversion = parseInt(btn.dataset.inversion);
                const cell = this.grid.getCell(this.selectedCellIndex);
                if (cell) {
                    this.grid.setCell(this.selectedCellIndex, cell.chord, inversion, cell.octave);
                    this.render();
                    this.saveToStorage();
                    this.previewCell(this.selectedCellIndex);
                }
            });
        });

        // Octave buttons
        this.chordControlsContainer.querySelectorAll('[data-octave]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const direction = parseInt(btn.dataset.octave);
                this.adjustOctave(this.selectedCellIndex, direction);
            });
        });

        // Delete button
        this.chordControlsContainer.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.grid.clearCell(this.selectedCellIndex);
                this.deselectCell();
                this.render();
                this.saveToStorage();
            });
        });
    }

    /**
     * Attach event listeners to grid cells
     */
    attachEventListeners() {
        // Cell click (for placing selected chord or selecting)
        this.container.querySelectorAll('.grid-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                const index = parseInt(cell.dataset.cellIndex);
                this.handleCellClick(index, e);
            });

            // Drag and drop
            cell.addEventListener('dragover', (e) => {
                e.preventDefault();
                cell.classList.add('drop-target');
            });

            cell.addEventListener('dragleave', () => {
                cell.classList.remove('drop-target');
            });

            cell.addEventListener('drop', (e) => {
                e.preventDefault();
                cell.classList.remove('drop-target');

                const index = parseInt(cell.dataset.cellIndex);
                const chordData = e.dataTransfer.getData('application/json');

                if (chordData) {
                    try {
                        const chord = JSON.parse(chordData);
                        this.grid.setCell(index, chord);
                        this.selectCell(index);
                        this.render();
                        this.saveToStorage();
                    } catch (err) {
                        console.error('Failed to parse chord data:', err);
                    }
                }
            });
        });
    }

    /**
     * Handle cell click
     */
    handleCellClick(index, event) {
        const cell = this.grid.getCell(index);

        if (this.selectedChord && !cell) {
            // Place selected chord in empty cell
            this.grid.setCell(index, this.selectedChord);
            this.selectCell(index);
            this.render();
            this.saveToStorage();
            this.previewCell(index);
        } else if (cell) {
            // Select this cell to show controls
            this.selectCell(index);
            this.render();
            // Preview the chord (skip for stop tokens)
            if (!cell.chord?.isStop) {
                this.previewCell(index);
            }
        } else {
            // Clicked empty cell with no chord selected - deselect
            this.deselectCell();
            this.render();
        }
    }

    /**
     * Preview a cell's chord
     */
    async previewCell(index) {
        const cell = this.grid.getCell(index);
        if (!cell) return;

        const midiNotes = getChordVoicing(cell.chord, cell.inversion, 4 + cell.octave);
        await this.synth.playChord(midiNotes, 0.5);
    }

    /**
     * Set selected chord (for tap-to-place on mobile)
     */
    setSelectedChord(chord) {
        this.selectedChord = chord;
    }

    /**
     * Clear selected chord
     */
    clearSelectedChord() {
        this.selectedChord = null;
    }

    /**
     * Start playback with sustain-until-next and looping
     */
    async play() {
        if (this.isPlaying) return;
        if (!this.grid.hasChords()) return;

        await this.synth.init();
        this.isPlaying = true;

        this.scheduleLoop();
    }

    /**
     * Schedule one loop of playback
     */
    scheduleLoop() {
        if (!this.isPlaying) return;

        const ctx = this.synth.audioContext;
        const now = ctx.currentTime;
        this.playStartTime = now;

        const secondsPerBeat = 60 / this.grid.tempo;

        // Adjust duration based on time signature
        let beatDuration = secondsPerBeat;
        if (this.grid.timeSignature === '6/8') {
            beatDuration = secondsPerBeat * 0.5;
        }

        // Build list of chord events with their start times
        const events = [];
        this.grid.cells.forEach((cell, index) => {
            if (cell && !cell.isStop) {
                events.push({
                    index,
                    startTime: now + (index * beatDuration),
                    cell
                });
            } else if (cell && cell.isStop) {
                // Stop token - marks end of previous chord
                events.push({
                    index,
                    startTime: now + (index * beatDuration),
                    isStop: true
                });
            }
        });

        // Schedule chords with sustain-until-next behavior
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event.isStop) continue;

            // Find when this chord ends (next chord, stop token, or end of grid)
            let endTime;
            const nextEvent = events[i + 1];
            if (nextEvent) {
                endTime = nextEvent.startTime;
            } else {
                // Sustain until end of grid
                endTime = now + (this.grid.cells.length * beatDuration);
            }

            const duration = endTime - event.startTime;
            const midiNotes = getChordVoicing(event.cell.chord, event.cell.inversion, 4 + event.cell.octave);
            this.synth.scheduleChord(midiNotes, event.startTime, duration * 0.98); // Tiny gap
        }

        // Animate playback cursor
        this.animatePlayback(beatDuration);

        // Handle end of loop
        const totalDuration = this.grid.cells.length * beatDuration;
        this.loopTimeoutId = setTimeout(() => {
            if (this.looping && this.isPlaying) {
                this.scheduleLoop();
            } else {
                this.stop();
            }
        }, totalDuration * 1000);
    }

    /**
     * Toggle looping
     */
    setLooping(enabled) {
        this.looping = enabled;
    }

    /**
     * Animate playback cursor
     */
    animatePlayback(beatDuration) {
        const animate = () => {
            if (!this.isPlaying) return;

            const ctx = this.synth.audioContext;
            const elapsed = ctx.currentTime - this.playStartTime;
            const currentPosition = Math.floor(elapsed / beatDuration);

            if (currentPosition !== this.playbackPosition) {
                this.playbackPosition = currentPosition;
                this.updatePlaybackCursor();
            }

            this.animationFrame = requestAnimationFrame(animate);
        };

        animate();
    }

    /**
     * Update visual playback cursor
     */
    updatePlaybackCursor() {
        // Remove playing class from all cells
        this.container.querySelectorAll('.grid-cell').forEach(cell => {
            cell.classList.remove('playing');
        });

        // Add to current cell
        if (this.playbackPosition >= 0 && this.playbackPosition < this.grid.cells.length) {
            const cell = this.container.querySelector(`[data-cell-index="${this.playbackPosition}"]`);
            if (cell) {
                cell.classList.add('playing');
            }
        }
    }

    /**
     * Stop playback
     */
    stop() {
        this.isPlaying = false;
        this.playbackPosition = -1;

        if (this.loopTimeoutId) {
            clearTimeout(this.loopTimeoutId);
            this.loopTimeoutId = null;
        }

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.synth.stopAll();
        this.updatePlaybackCursor();
    }

    /**
     * Save grid state to localStorage
     */
    saveToStorage() {
        try {
            localStorage.setItem('chord-explorer-grid', JSON.stringify(this.grid.toJSON()));
        } catch (e) {
            console.warn('Failed to save grid to localStorage:', e);
        }
    }

    /**
     * Load grid state from localStorage
     */
    loadFromStorage() {
        try {
            const data = localStorage.getItem('chord-explorer-grid');
            if (data) {
                this.grid.fromJSON(JSON.parse(data));
                this.render();
                return true;
            }
        } catch (e) {
            console.warn('Failed to load grid from localStorage:', e);
        }
        return false;
    }
}
