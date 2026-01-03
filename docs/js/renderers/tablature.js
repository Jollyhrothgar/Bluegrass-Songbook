// Tablature SVG Renderer
// Extracted from TablEdit_Reverse viewer for Bluegrass Songbook

const INSTRUMENT_ICONS = {
    '5-string-banjo': '🪕',
    'banjo': '🪕',
    'mandolin': '🎸',
    '6-string-guitar': '🎸',
    'guitar': '🎸',
    'dobro': '🎸',
    'fiddle': '🎻',
    'violin': '🎻',
    'upright-bass': '🎸',
    'bass': '🎸'
};

/**
 * SVG Tab Renderer with Stems, Flags, and Beams
 * Supports playback visualization with beat cursor and note highlighting
 * Auto-scales to fit container width
 */
export class TabRenderer {
    constructor(container, options = {}) {
        this.container = container;

        // Get theme-aware colors from CSS variables
        const computedStyle = getComputedStyle(document.documentElement);
        const bgColor = computedStyle.getPropertyValue('--bg').trim() || '#fff';
        const textColor = computedStyle.getPropertyValue('--text').trim() || '#000';
        const accentColor = computedStyle.getPropertyValue('--accent').trim() || '#007bff';

        this.options = {
            stringSpacing: 14,
            minMeasureWidth: 120,     // Minimum width per measure
            maxMeasureWidth: 250,     // Maximum width per measure
            targetMeasureWidth: 180,  // Preferred width per measure
            measuresPerRow: 'auto',   // 'auto' or number (1-8)
            leftMargin: 50,
            topMargin: 40,
            stemAreaHeight: 28,
            fretFontSize: 12,
            stringColor: '#666',
            fretColor: textColor,
            fretBgColor: bgColor,
            measureLineColor: '#333',
            stemColor: '#333',
            beamColor: '#333',
            beamThickness: 3,
            stemWidth: 1.5,
            highlightColor: accentColor,
            beatCursorColor: 'rgba(255, 100, 100, 0.6)',
            ...options
        };

        // Playback visualization state
        this.noteElements = [];      // Array of {measure, tick, absTick, elements: []}
        this.beatCursors = [];       // Beat cursor elements per row
        this.rowData = [];           // Row layout info for cursor positioning
        this.numStrings = 5;
        this.ticksPerMeasure = 960;  // 2 beats * 480 ticks

        // Store render data for re-rendering on resize
        this._track = null;
        this._notation = null;
        this._ticksPerBeat = 480;

        // Computed layout values
        this._computedMeasuresPerRow = 4;
        this._computedMeasureWidth = 180;

        // Resize observer for responsive layout
        this._resizeObserver = null;
        this._resizeTimeout = null;
    }

    /**
     * Calculate optimal measures per row based on container width
     */
    _calculateLayout() {
        const opt = this.options;
        const containerWidth = this.container.clientWidth || 800;
        const availableWidth = containerWidth - opt.leftMargin - 30; // margins

        if (opt.measuresPerRow !== 'auto') {
            // Fixed measures per row
            this._computedMeasuresPerRow = Math.max(1, Math.min(8, opt.measuresPerRow));
            this._computedMeasureWidth = Math.max(
                opt.minMeasureWidth,
                Math.min(opt.maxMeasureWidth, availableWidth / this._computedMeasuresPerRow)
            );
            return;
        }

        // Auto-calculate: find how many measures fit at target width
        let measuresPerRow = Math.floor(availableWidth / opt.targetMeasureWidth);
        measuresPerRow = Math.max(1, Math.min(8, measuresPerRow));

        // Calculate actual measure width to fill available space
        let measureWidth = availableWidth / measuresPerRow;

        // Clamp to min/max
        if (measureWidth < opt.minMeasureWidth && measuresPerRow > 1) {
            measuresPerRow--;
            measureWidth = availableWidth / measuresPerRow;
        }
        measureWidth = Math.max(opt.minMeasureWidth, Math.min(opt.maxMeasureWidth, measureWidth));

        this._computedMeasuresPerRow = measuresPerRow;
        this._computedMeasureWidth = measureWidth;
    }

    render(track, notation, ticksPerBeat = 480) {
        // Store for re-rendering on resize
        this._track = track;
        this._notation = notation;
        this._ticksPerBeat = ticksPerBeat;

        this._renderInternal();

        // Set up resize observer if not already
        if (!this._resizeObserver && typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => {
                // Debounce resize events
                if (this._resizeTimeout) clearTimeout(this._resizeTimeout);
                this._resizeTimeout = setTimeout(() => {
                    if (this._track && this._notation) {
                        this._renderInternal();
                    }
                }, 150);
            });
            this._resizeObserver.observe(this.container);
        }
    }

    /**
     * Internal render method (can be called on resize)
     */
    _renderInternal() {
        const track = this._track;
        const notation = this._notation;
        const ticksPerBeat = this._ticksPerBeat;

        this.container.innerHTML = '';

        // Reset playback visualization state
        this.noteElements = [];
        this.beatCursors = [];
        this.rowData = [];
        this.ticksPerMeasure = ticksPerBeat * 2;  // 2/2 time

        if (!track || !notation || notation.length === 0) {
            this.container.innerHTML = '<p style="color:#888;text-align:center;">No notation for this track</p>';
            return;
        }

        // Calculate responsive layout
        this._calculateLayout();

        this.numStrings = track.tuning?.length || 5;
        const opt = this.options;
        const staveHeight = opt.topMargin + (this.numStrings - 1) * opt.stringSpacing + opt.stemAreaHeight + 10;

        this.renderTrackInfo(track);

        const measuresPerRow = this._computedMeasuresPerRow;
        for (let rowStart = 0; rowStart < notation.length; rowStart += measuresPerRow) {
            const rowMeasures = notation.slice(rowStart, rowStart + measuresPerRow);
            const rowIndex = Math.floor(rowStart / measuresPerRow);
            this.renderRow(rowMeasures, this.numStrings, staveHeight, track.tuning, rowIndex);
        }
    }

    /**
     * Clean up resize observer
     */
    destroy() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._resizeTimeout) {
            clearTimeout(this._resizeTimeout);
            this._resizeTimeout = null;
        }
    }

    renderTrackInfo(track) {
        const info = document.createElement('div');
        info.className = 'track-info';

        const icon = INSTRUMENT_ICONS[track.instrument] || '🎵';
        const tuningHtml = (track.tuning || []).map((t, i) => {
            const isFifth = track.instrument?.includes('banjo') && i === track.tuning.length - 1;
            return `<span class="tuning-string${isFifth ? ' fifth' : ''}">${t.replace(/\d/, '')}</span>`;
        }).join('');

        info.innerHTML = `
            <span class="instrument-icon">${icon}</span>
            <strong>${track.id}</strong>
            <span style="color:#888;font-size:13px;">${track.instrument}</span>
            <div class="tuning-display">${tuningHtml}</div>
        `;
        this.container.appendChild(info);
    }

    renderRow(measures, numStrings, height, tuning, rowIndex = 0) {
        const opt = this.options;
        const measureWidth = this._computedMeasureWidth;
        const width = opt.leftMargin + measures.length * measureWidth + 20;

        const rowDiv = document.createElement('div');
        rowDiv.className = 'stave-row';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        // Store row data for cursor positioning
        const firstMeasure = measures[0]?.measure || 1;
        const lastMeasure = measures[measures.length - 1]?.measure || firstMeasure;
        this.rowData.push({
            rowIndex,
            svg,
            firstMeasure,
            lastMeasure,
            measureCount: measures.length,
            height
        });

        // Create beat cursor (initially hidden)
        const cursorHeight = (numStrings - 1) * opt.stringSpacing + 20;
        const beatCursor = this.createRect(
            opt.leftMargin, opt.topMargin - 5,
            3, cursorHeight,
            opt.beatCursorColor
        );
        beatCursor.setAttribute('class', 'beat-cursor');
        beatCursor.style.display = 'none';
        svg.appendChild(beatCursor);
        this.beatCursors.push({ rowIndex, cursor: beatCursor, svg });

        // Draw string labels (tuning)
        if (tuning) {
            tuning.forEach((pitch, i) => {
                const y = opt.topMargin + i * opt.stringSpacing;
                const label = pitch.replace(/\d/, '');
                const text = this.createText(10, y + 4, label, {
                    fontSize: '11px',
                    fill: '#666',
                    fontWeight: '600'
                });
                svg.appendChild(text);
            });
        }

        // Draw horizontal string lines
        const stringsBottom = opt.topMargin + (numStrings - 1) * opt.stringSpacing;
        for (let s = 0; s < numStrings; s++) {
            const y = opt.topMargin + s * opt.stringSpacing;
            const line = this.createLine(
                opt.leftMargin - 10, y,
                opt.leftMargin + measures.length * measureWidth, y,
                opt.stringColor
            );
            svg.appendChild(line);
        }

        // Beam Y position
        const beamY = stringsBottom + opt.stemAreaHeight - 4;

        // Draw measures
        measures.forEach((measure, mi) => {
            const x = opt.leftMargin + mi * measureWidth;

            // Measure line
            const barLine = this.createLine(x, opt.topMargin, x, beamY + 4, opt.measureLineColor);
            svg.appendChild(barLine);

            // Measure number
            const numText = this.createText(x + 3, opt.topMargin - 8, measure.measure.toString(), {
                fontSize: '10px',
                fill: '#999'
            });
            svg.appendChild(numText);

            // Collect notes with positions
            const notePositions = [];
            if (measure.events) {
                measure.events.forEach(event => {
                    const pos16th = Math.floor(event.tick / 60);
                    const ticksPerMeasure = 960;
                    const posRatio = event.tick / ticksPerMeasure;
                    const noteX = x + 15 + posRatio * (measureWidth - 30);

                    let lowestString = 0;
                    event.notes.forEach(note => {
                        if (note.s > lowestString) lowestString = note.s;
                    });

                    notePositions.push({ x: noteX, pos16th, lowestString, event });

                    // Calculate absolute tick for this event
                    const absTick = (measure.measure - 1) * this.ticksPerMeasure + event.tick;

                    // Track elements for this event (for highlighting)
                    const eventElements = [];

                    // Draw fret numbers
                    event.notes.forEach(note => {
                        const stringIndex = note.s - 1;
                        const noteY = opt.topMargin + stringIndex * opt.stringSpacing;

                        const fretStr = note.f.toString();
                        const bgWidth = fretStr.length > 1 ? 16 : 12;
                        const bg = this.createRect(noteX - bgWidth/2, noteY - 7, bgWidth, 14, opt.fretBgColor);
                        bg.setAttribute('class', 'note-bg');
                        bg.dataset.absTick = absTick;
                        svg.appendChild(bg);

                        const fretText = this.createText(noteX, noteY + 4, fretStr, {
                            fontSize: `${opt.fretFontSize}px`,
                            fill: opt.fretColor,
                            fontWeight: '600',
                            textAnchor: 'middle'
                        });
                        fretText.setAttribute('class', 'note-text');
                        fretText.dataset.absTick = absTick;
                        svg.appendChild(fretText);

                        // Store elements for highlighting
                        eventElements.push({ bg, text: fretText });

                        if (note.tech && note.tech !== 'h' && note.tech !== 'p') {
                            const techText = this.createText(noteX, noteY - 10, note.tech, {
                                fontSize: '9px',
                                fill: '#888',
                                textAnchor: 'middle'
                            });
                            svg.appendChild(techText);
                        }
                    });

                    // Store note elements for playback highlighting
                    this.noteElements.push({
                        measure: measure.measure,
                        tick: event.tick,
                        absTick,
                        x: noteX,
                        rowIndex,
                        elements: eventElements
                    });
                });
            }

            this.renderSlurs(svg, notePositions, opt);
            this.renderStemsAndBeams(svg, notePositions, numStrings, opt, beamY);
        });

        // Final bar line
        const endX = opt.leftMargin + measures.length * measureWidth;
        const endBar = this.createLine(endX, opt.topMargin, endX, beamY + 4, opt.measureLineColor);
        svg.appendChild(endBar);

        rowDiv.appendChild(svg);
        this.container.appendChild(rowDiv);
    }

    renderSlurs(svg, notePositions, opt) {
        const sortedNotes = [...notePositions].sort((a, b) => a.x - b.x);
        const notesByString = {};

        sortedNotes.forEach(np => {
            np.event.notes.forEach(note => {
                if (note.tech === 'h' || note.tech === 'p') {
                    if (!notesByString[note.s]) notesByString[note.s] = [];
                    notesByString[note.s].push({
                        x: np.x,
                        y: opt.topMargin + (note.s - 1) * opt.stringSpacing,
                        tech: note.tech,
                        fret: note.f
                    });
                }
            });
        });

        Object.values(notesByString).forEach(notes => {
            for (let i = 0; i < notes.length - 1; i++) {
                const n1 = notes[i];
                const n2 = notes[i + 1];
                if (n2.x - n1.x > 50) continue;

                const midX = (n1.x + n2.x) / 2;
                const slurY = n1.y - 8;
                const curveDepth = 8;

                const slur = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                slur.setAttribute('d', `M ${n1.x + 6} ${slurY} Q ${midX} ${slurY - curveDepth} ${n2.x - 6} ${slurY}`);
                slur.setAttribute('fill', 'none');
                slur.setAttribute('stroke', '#555');
                slur.setAttribute('stroke-width', '1.5');
                svg.appendChild(slur);

                const label = n1.tech === 'h' ? 'H' : 'P';
                const labelText = this.createText(midX, slurY - curveDepth - 2, label, {
                    fontSize: '9px',
                    fill: '#555',
                    fontWeight: '600',
                    textAnchor: 'middle'
                });
                svg.appendChild(labelText);
            }
        });
    }

    renderStemsAndBeams(svg, notePositions, numStrings, opt, beamY) {
        if (notePositions.length === 0) return;

        const beats = [[], [], [], []];
        notePositions.forEach(np => {
            const beatIndex = Math.floor(np.pos16th / 4);
            if (beatIndex >= 0 && beatIndex < 4) beats[beatIndex].push(np);
        });

        const beamedNotes = new Set();

        const is16thNote = (note, nextNote) => {
            if (note.pos16th % 2 === 1) return true;
            if (nextNote && nextNote.pos16th - note.pos16th === 1) return true;
            return false;
        };

        beats.forEach(beatNotes => {
            if (beatNotes.length >= 2) {
                beatNotes.sort((a, b) => a.pos16th - b.pos16th);

                const halfStem = opt.stemWidth / 2;
                const firstX = beatNotes[0].x - halfStem;
                const lastX = beatNotes[beatNotes.length - 1].x + halfStem;

                // Primary beam
                const beam = this.createRect(firstX, beamY - opt.beamThickness, Math.max(lastX - firstX, 1), opt.beamThickness, opt.beamColor);
                svg.appendChild(beam);

                // Beam caps
                svg.appendChild(this.createRect(firstX, beamY - opt.beamThickness, opt.stemWidth, opt.beamThickness, opt.beamColor));
                svg.appendChild(this.createRect(lastX - opt.stemWidth, beamY - opt.beamThickness, opt.stemWidth, opt.beamThickness, opt.beamColor));

                // Secondary beams for 16th notes
                const secondBeamY = beamY - opt.beamThickness - 4;

                for (let i = 0; i < beatNotes.length - 1; i++) {
                    const curr = beatNotes[i];
                    const next = beatNotes[i + 1];
                    const afterNext = beatNotes[i + 2];
                    const gap = next.pos16th - curr.pos16th;

                    if (gap === 1) {
                        const currIs16th = is16thNote(curr, next);
                        const nextIs16th = is16thNote(next, afterNext);

                        if (currIs16th && nextIs16th) {
                            const secondBeam = this.createRect(
                                curr.x - halfStem, secondBeamY - opt.beamThickness,
                                Math.max(next.x - curr.x + opt.stemWidth, 1), opt.beamThickness,
                                opt.beamColor
                            );
                            svg.appendChild(secondBeam);

                            // Caps
                            const prevNote = beatNotes[i - 1];
                            const needsLeftCap = !prevNote || (curr.pos16th - prevNote.pos16th !== 1);
                            if (needsLeftCap) {
                                svg.appendChild(this.createRect(curr.x - halfStem, secondBeamY - opt.beamThickness, opt.stemWidth, beamY - secondBeamY + opt.beamThickness, opt.beamColor));
                            }

                            const afterAfterNext = beatNotes[i + 3];
                            const needsRightCap = !afterNext || (afterNext.pos16th - next.pos16th !== 1);
                            if (needsRightCap) {
                                svg.appendChild(this.createRect(next.x - halfStem, secondBeamY - opt.beamThickness, opt.stemWidth, beamY - secondBeamY + opt.beamThickness, opt.beamColor));
                            }
                        }
                    }
                }

                // Draw stems
                beatNotes.forEach((np, i) => {
                    beamedNotes.add(np);
                    const stemStartY = opt.topMargin + (np.lowestString - 1) * opt.stringSpacing + 7;

                    const prev = beatNotes[i - 1];
                    const next = beatNotes[i + 1];
                    const afterNext = beatNotes[i + 2];

                    let hasSecondaryBeam = false;
                    if (prev && np.pos16th - prev.pos16th === 1 && is16thNote(prev, np) && is16thNote(np, next)) {
                        hasSecondaryBeam = true;
                    }
                    if (next && !hasSecondaryBeam && next.pos16th - np.pos16th === 1 && is16thNote(np, next) && is16thNote(next, afterNext)) {
                        hasSecondaryBeam = true;
                    }

                    const stemEndY = hasSecondaryBeam ? secondBeamY : beamY;
                    const stem = this.createLine(np.x, stemStartY, np.x, stemEndY, opt.stemColor);
                    stem.setAttribute('stroke-width', opt.stemWidth);
                    svg.appendChild(stem);
                });
            }
        });

        // Single notes with flags
        const sortedByPos = [...notePositions].sort((a, b) => a.pos16th - b.pos16th);

        notePositions.forEach((np, idx) => {
            if (beamedNotes.has(np)) return;

            const sortedIdx = sortedByPos.findIndex(n => n === np);
            let gapPositions = 4;
            if (sortedIdx < sortedByPos.length - 1) {
                gapPositions = sortedByPos[sortedIdx + 1].pos16th - np.pos16th;
            }

            const stemStartY = opt.topMargin + (np.lowestString - 1) * opt.stringSpacing + 7;
            const stemEndY = beamY;
            const staffBottom = opt.topMargin + (numStrings - 1) * opt.stringSpacing;

            if (gapPositions >= 16) {
                // Whole note - no stem
            } else if (gapPositions >= 8) {
                // Half note
                const halfStemStartY = staffBottom + 4;
                const stem = this.createLine(np.x, halfStemStartY, np.x, beamY, opt.stemColor);
                stem.setAttribute('stroke-width', opt.stemWidth);
                svg.appendChild(stem);
            } else if (gapPositions >= 4) {
                // Quarter note
                const stem = this.createLine(np.x, stemStartY, np.x, stemEndY, opt.stemColor);
                stem.setAttribute('stroke-width', opt.stemWidth);
                svg.appendChild(stem);
            } else if (gapPositions >= 2) {
                // Eighth note with flag
                const stemX = np.x;
                const flagStartX = stemX + opt.stemWidth / 2;
                const flagY = stemEndY - 2;

                const stem = this.createLine(stemX, stemStartY, stemX, stemEndY, opt.stemColor);
                stem.setAttribute('stroke-width', opt.stemWidth);
                svg.appendChild(stem);

                const flag = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                flag.setAttribute('d', `M ${flagStartX} ${flagY - 8} L ${flagStartX} ${flagY} Q ${flagStartX + 8} ${flagY + 2} ${flagStartX + 10} ${flagY + 8} Q ${flagStartX + 6} ${flagY + 4} ${flagStartX} ${flagY - 2} Z`);
                flag.setAttribute('fill', opt.stemColor);
                svg.appendChild(flag);
            } else {
                // Sixteenth note with two flags
                const stemX = np.x;
                const flagStartX = stemX + opt.stemWidth / 2;
                const flag1Y = stemEndY - 2;
                const flag2Y = stemEndY - 9;

                const stem = this.createLine(stemX, stemStartY, stemX, stemEndY, opt.stemColor);
                stem.setAttribute('stroke-width', opt.stemWidth);
                svg.appendChild(stem);

                const flag1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                flag1.setAttribute('d', `M ${flagStartX} ${flag1Y - 8} L ${flagStartX} ${flag1Y} Q ${flagStartX + 8} ${flag1Y + 2} ${flagStartX + 10} ${flag1Y + 8} Q ${flagStartX + 6} ${flag1Y + 4} ${flagStartX} ${flag1Y - 2} Z`);
                flag1.setAttribute('fill', opt.stemColor);
                svg.appendChild(flag1);

                const flag2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                flag2.setAttribute('d', `M ${flagStartX} ${flag2Y - 8} L ${flagStartX} ${flag2Y} Q ${flagStartX + 8} ${flag2Y + 2} ${flagStartX + 10} ${flag2Y + 8} Q ${flagStartX + 6} ${flag2Y + 4} ${flagStartX} ${flag2Y - 2} Z`);
                flag2.setAttribute('fill', opt.stemColor);
                svg.appendChild(flag2);
            }
        });
    }

    createLine(x1, y1, x2, y2, stroke) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', '1');
        return line;
    }

    createText(x, y, content, attrs = {}) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y);
        text.textContent = content;
        Object.entries(attrs).forEach(([key, value]) => {
            const attr = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            text.setAttribute(attr, value);
        });
        return text;
    }

    createRect(x, y, width, height, fill) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        rect.setAttribute('fill', fill);
        return rect;
    }

    // ========================================
    // Playback Visualization Methods
    // ========================================

    /**
     * Highlight a note at the given absolute tick
     * @param {number} absTick - Absolute tick position
     */
    highlightNote(absTick) {
        const opt = this.options;

        // Find note element at this tick (allow small tolerance)
        const noteData = this.noteElements.find(n =>
            Math.abs(n.absTick - absTick) < 30
        );

        if (noteData) {
            noteData.elements.forEach(({ bg, text }) => {
                bg.setAttribute('fill', opt.highlightColor);
                text.setAttribute('fill', '#fff');
            });
        }
    }

    /**
     * Clear highlight from a specific note
     * @param {number} absTick - Absolute tick position
     */
    clearNoteHighlight(absTick) {
        const opt = this.options;

        const noteData = this.noteElements.find(n =>
            Math.abs(n.absTick - absTick) < 30
        );

        if (noteData) {
            noteData.elements.forEach(({ bg, text }) => {
                bg.setAttribute('fill', opt.fretBgColor);
                text.setAttribute('fill', opt.fretColor);
            });
        }
    }

    /**
     * Clear all note highlights
     */
    clearAllHighlights() {
        const opt = this.options;
        this.noteElements.forEach(noteData => {
            noteData.elements.forEach(({ bg, text }) => {
                bg.setAttribute('fill', opt.fretBgColor);
                text.setAttribute('fill', opt.fretColor);
            });
        });
    }

    /**
     * Update beat cursor position
     * @param {number} absTick - Absolute tick position
     */
    updateBeatCursor(absTick) {
        const opt = this.options;
        const measureWidth = this._computedMeasureWidth;

        // Calculate which measure and position within measure
        const measure = Math.floor(absTick / this.ticksPerMeasure) + 1;
        const tickInMeasure = absTick % this.ticksPerMeasure;

        // Find which row this measure is on
        const rowData = this.rowData.find(r =>
            measure >= r.firstMeasure && measure <= r.lastMeasure
        );

        if (!rowData) {
            this.hideBeatCursor();
            return;
        }

        // Calculate X position
        const measureIndex = measure - rowData.firstMeasure;
        const posRatio = tickInMeasure / this.ticksPerMeasure;
        const measureX = opt.leftMargin + measureIndex * measureWidth;
        const x = measureX + 15 + posRatio * (measureWidth - 30);

        // Show cursor on correct row, hide others
        this.beatCursors.forEach(({ rowIndex, cursor }) => {
            if (rowIndex === rowData.rowIndex) {
                cursor.style.display = 'block';
                cursor.setAttribute('x', x - 1.5);
            } else {
                cursor.style.display = 'none';
            }
        });
    }

    /**
     * Hide the beat cursor
     */
    hideBeatCursor() {
        this.beatCursors.forEach(({ cursor }) => {
            cursor.style.display = 'none';
        });
    }

    /**
     * Reset all playback visualization
     */
    resetPlaybackVisualization() {
        this.clearAllHighlights();
        this.hideBeatCursor();
    }
}

export { INSTRUMENT_ICONS };
