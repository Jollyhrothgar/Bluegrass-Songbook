// Main entry point for chord progression explorer
// Wires together theory, synth, and grid modules

import { getAllChords, getChordVoicing, getResolutions } from './theory.js';
import { getSynth } from './synth.js';
import { ChordGrid, GridView } from './grid.js';

// State
let currentKey = 'G';
let selectedChord = null;
let grid = null;
let gridView = null;

// DOM Elements
const keySelect = document.getElementById('key-select');
const diatonicRow = document.getElementById('diatonic-row');
const nonDiatonicRow = document.getElementById('non-diatonic-row');
const beatGridContainer = document.getElementById('beat-grid');
const barsValue = document.getElementById('bars-value');
const barsDown = document.getElementById('bars-down');
const barsUp = document.getElementById('bars-up');
const timeSigSelect = document.getElementById('time-sig-select');
const tempoDown = document.getElementById('tempo-down');
const tempoUp = document.getElementById('tempo-up');
const tempoValue = document.getElementById('tempo-value');
const playBtn = document.getElementById('play-btn');
const clearBtn = document.getElementById('clear-btn');
const loopToggle = document.getElementById('loop-toggle');
const vibratoToggle = document.getElementById('vibrato-toggle');

// Disclosure toggle elements
const gridToggle = document.getElementById('grid-toggle');
const gridContent = document.getElementById('grid-content');
const chordContent = document.getElementById('chord-content');

// State for disclosure panels
let gridPanelOpen = true;

/**
 * Initialize the chord explorer
 */
async function init() {
    // Initialize grid
    grid = new ChordGrid();

    // Create grid view with chord controls container
    gridView = new GridView(beatGridContainer, grid, {
        onCellClick: handleCellClick,
        chordControlsContainer: chordContent,
        onChordSelected: handleChordSelected
    });

    // Load saved grid
    gridView.loadFromStorage();

    // Update UI to match loaded grid
    barsValue.textContent = grid.bars;
    timeSigSelect.value = grid.timeSignature;
    tempoValue.textContent = grid.tempo;

    // Render initial chord palette
    renderChordPalette();

    // Set up event listeners
    setupEventListeners();

    // Keyboard listeners
    setupKeyboardListeners();
}

/**
 * Render the chord palette for current key
 * Shows triads - modify to 7ths after placing using the controls bar
 */
function renderChordPalette() {
    const { diatonic, nonDiatonic } = getAllChords(currentKey, false);

    // Render diatonic chords + stop token
    let diatonicHtml = '<span class="chord-row-label">Diatonic</span>';
    diatonic.forEach(chord => {
        diatonicHtml += renderChordCard(chord);
    });
    // Add stop token
    diatonicHtml += `
        <div class="chord-card stop-token"
             data-chord='{"isStop": true}'
             draggable="true">
            <span class="chord-name">Stop</span>
            <span class="chord-numeral">∅</span>
        </div>
    `;
    diatonicRow.innerHTML = diatonicHtml;

    // Render non-diatonic chords
    let nonDiatonicHtml = '<span class="chord-row-label">Non-Diatonic</span>';
    nonDiatonic.forEach(chord => {
        nonDiatonicHtml += renderChordCard(chord);
    });
    nonDiatonicRow.innerHTML = nonDiatonicHtml;

    // Attach event listeners to chord cards
    attachChordCardListeners();
}

/**
 * Render a single chord card
 */
function renderChordCard(chord) {
    const resolutions = getResolutions(chord, currentKey);
    const resolutionText = resolutions.slice(0, 2).join('<br>');

    return `
        <div class="chord-card"
             data-chord='${JSON.stringify(chord)}'
             draggable="true">
            <span class="chord-name">${chord.display}</span>
            <span class="chord-numeral">${chord.numeral}</span>
            ${resolutionText ? `<div class="resolution-tooltip">${resolutionText}</div>` : ''}
        </div>
    `;
}

/**
 * Attach event listeners to chord cards
 */
function attachChordCardListeners() {
    document.querySelectorAll('.chord-card').forEach(card => {
        const chordData = card.dataset.chord;
        const chord = JSON.parse(chordData);

        // Click to select (for mobile)
        card.addEventListener('click', async () => {
            // Deselect previous
            document.querySelectorAll('.chord-card.selected').forEach(c => {
                c.classList.remove('selected');
            });

            // Select this one
            card.classList.add('selected');
            selectedChord = chord;
            gridView.setSelectedChord(chord);

            // Preview the chord (skip for stop token)
            if (!chord.isStop) {
                const synth = getSynth();
                const midiNotes = getChordVoicing(chord, 0, 4);
                await synth.playChord(midiNotes, 0.5);
            }
        });

        // Drag start
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/json', chordData);
            e.dataTransfer.effectAllowed = 'copy';
            card.classList.add('dragging');
        });

        // Drag end
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
        });

        // Hover preview (desktop only, skip for stop token)
        let hoverTimeout;
        card.addEventListener('mouseenter', () => {
            if (chord.isStop) return;
            hoverTimeout = setTimeout(async () => {
                const synth = getSynth();
                const midiNotes = getChordVoicing(chord, 0, 4);
                await synth.playChord(midiNotes, 0.3);
            }, 300); // Delay to avoid playing on quick mouse moves
        });

        card.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimeout);
        });
    });
}

/**
 * Handle cell click callback (no longer needed for inversion cycling)
 * Cell selection and adjustment now handled directly in GridView
 */
function handleCellClick(cellIndex, cell, event) {
    // Octave/inversion controls now in the cell UI
    // This callback kept for potential future use
}

/**
 * Handle chord selection - show/hide chord panel automatically
 */
function handleChordSelected(hasSelection) {
    if (hasSelection) {
        chordContent.classList.remove('hidden');
    } else {
        chordContent.classList.add('hidden');
    }
}

/**
 * Update disclosure button arrow
 */
function updateDisclosureButton(button, isOpen) {
    const arrow = button.querySelector('.ce-disclosure-arrow');
    if (arrow) {
        arrow.textContent = isOpen ? '▲' : '▼';
    }
}

/**
 * Set up event listeners for controls
 */
function setupEventListeners() {
    // Settings disclosure toggle
    gridToggle.addEventListener('click', () => {
        gridPanelOpen = !gridPanelOpen;
        updateDisclosureButton(gridToggle, gridPanelOpen);
        gridContent.classList.toggle('hidden', !gridPanelOpen);
    });

    // Key selector
    keySelect.addEventListener('change', () => {
        currentKey = keySelect.value;
        renderChordPalette();
    });

    // Bars controls
    barsDown.addEventListener('click', () => {
        if (grid.bars > 1) {
            grid.resize(grid.bars - 1);
            barsValue.textContent = grid.bars;
            gridView.render();
            gridView.saveToStorage();
        }
    });

    barsUp.addEventListener('click', () => {
        if (grid.bars < 16) {
            grid.resize(grid.bars + 1);
            barsValue.textContent = grid.bars;
            gridView.render();
            gridView.saveToStorage();
        }
    });

    // Time signature
    timeSigSelect.addEventListener('change', () => {
        grid.setTimeSignature(timeSigSelect.value);
        gridView.render();
        gridView.saveToStorage();
    });

    // Tempo buttons
    tempoDown.addEventListener('click', () => {
        if (grid.tempo > 40) {
            grid.tempo = Math.max(40, grid.tempo - 5);
            tempoValue.textContent = grid.tempo;
            gridView.saveToStorage();
        }
    });

    tempoUp.addEventListener('click', () => {
        if (grid.tempo < 240) {
            grid.tempo = Math.min(240, grid.tempo + 5);
            tempoValue.textContent = grid.tempo;
            gridView.saveToStorage();
        }
    });

    // Play/Stop button
    playBtn.addEventListener('click', async () => {
        if (gridView.isPlaying) {
            gridView.stop();
            updatePlayButton(false);
        } else {
            await gridView.play();
            updatePlayButton(true);

            // Reset button when playback ends
            const checkPlaying = setInterval(() => {
                if (!gridView.isPlaying) {
                    updatePlayButton(false);
                    clearInterval(checkPlaying);
                }
            }, 100);
        }
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
        if (grid.hasChords()) {
            if (confirm('Clear all chords from the grid?')) {
                grid.clearAll();
                gridView.render();
                gridView.saveToStorage();
            }
        }
    });

    // Loop toggle
    loopToggle.addEventListener('change', () => {
        gridView.setLooping(loopToggle.checked);
    });

    // Vibrato toggle
    vibratoToggle.addEventListener('change', () => {
        const synth = getSynth();
        synth.setVibrato(vibratoToggle.checked);
    });
}

/**
 * Update play button appearance
 */
function updatePlayButton(isPlaying) {
    const icon = playBtn.querySelector('.play-icon');
    const text = playBtn.querySelector('.play-text');

    if (isPlaying) {
        playBtn.classList.add('playing');
        icon.textContent = '⏹';
        text.textContent = 'Stop';
    } else {
        playBtn.classList.remove('playing');
        icon.textContent = '▶';
        text.textContent = 'Play';
    }
}

/**
 * Set up keyboard listeners
 */
function setupKeyboardListeners() {
    document.addEventListener('keydown', (e) => {
        // Spacebar to play/stop
        if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
            e.preventDefault();
            playBtn.click();
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
