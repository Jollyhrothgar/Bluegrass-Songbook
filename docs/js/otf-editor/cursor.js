// OTF Editor Cursor
// Handles cursor positioning, rendering, and navigation

import { DURATIONS, TICKS_PER_BEAT } from './state.js';

/**
 * Map a point in a stave-row's SVG coordinate space to an edit position,
 * using the renderer's real per-measure geometry (TabRenderer rowData
 * measures: {display, x, width, ticks, noteX0, noteW, noteOffset}).
 *
 * Ts-aware for free: each geom carries its own tick length, so clicks in
 * a short 2/4 measure of a 2/2 tune land on that measure's grid. X is
 * clamped into the row; y snaps to the nearest string.
 *
 * @returns {{measure: number, tick: number, string: number}|null}
 */
export function positionFromSvgPoint(geoms, x, y, {
    topMargin,
    stringSpacing,
    stringCount,
    gridSubdivision,
}) {
    if (!geoms || geoms.length === 0) return null;

    let geom = geoms.find(g => x >= g.x && x < g.x + g.width);
    if (!geom) {
        geom = x < geoms[0].x ? geoms[0] : geoms[geoms.length - 1];
    }

    const noteX0 = (geom.noteX0 ?? geom.x + 15) + (geom.noteOffset ?? 0);
    const noteW = geom.noteW ?? geom.width - 30;
    const ratio = Math.max(0, Math.min(1, (x - noteX0) / noteW));
    let tick = Math.round(ratio * geom.ticks / gridSubdivision) * gridSubdivision;
    if (tick >= geom.ticks) {
        tick = Math.floor((geom.ticks - 1) / gridSubdivision) * gridSubdivision;
    }

    const stringIndex = Math.round((y - topMargin) / stringSpacing);
    const string = Math.max(1, Math.min(stringCount, stringIndex + 1));

    return { measure: geom.display, tick, string };
}

/**
 * Inverse of positionFromSvgPoint: map an edit position to a point in
 * its stave-row's SVG coordinate space, via TabRenderer rowData.
 *
 * @returns {{rowIndex: number, x: number, y: number, row: Object}|null}
 */
export function svgPointForPosition(rowData, { measure, tick, string }, {
    topMargin,
    stringSpacing,
}) {
    if (!rowData || rowData.length === 0) return null;
    const row = rowData.find(r => measure >= r.firstMeasure && measure <= r.lastMeasure);
    const geom = row?.measures?.find(g => g.display === measure);
    if (!geom) return null;

    const noteX0 = (geom.noteX0 ?? geom.x + 15) + (geom.noteOffset ?? 0);
    const noteW = geom.noteW ?? geom.width - 30;
    const x = noteX0 + (tick / geom.ticks) * noteW;
    const y = topMargin + (string - 1) * stringSpacing;

    return { rowIndex: row.rowIndex ?? rowData.indexOf(row), x, y, row };
}

/**
 * Selection highlight spans for one row: x-ranges (SVG units) covering
 * the intersection of [startAbs, endAbs) with each measure's note area.
 * Geoms carry their own startTick/ticks, so this is ts-aware and lands
 * exactly where the renderer draws those ticks' notes.
 *
 * @param {Array} geoms - rowData.measures
 * @param {number} startAbs - absolute tick, inclusive
 * @param {number} endAbs - absolute tick, exclusive
 * @returns {Array<{x0: number, x1: number, display: number}>}
 */
export function selectionRectsForRow(geoms, startAbs, endAbs) {
    if (!geoms || geoms.length === 0 || endAbs <= startAbs) return [];
    const rects = [];
    for (const geom of geoms) {
        const gStart = geom.startTick;
        const gEnd = gStart + geom.ticks;
        const from = Math.max(startAbs, gStart);
        const to = Math.min(endAbs, gEnd);
        if (to <= from) continue;
        const noteX0 = (geom.noteX0 ?? geom.x + 15) + (geom.noteOffset ?? 0);
        const noteW = geom.noteW ?? geom.width - 30;
        rects.push({
            x0: noteX0 + ((from - gStart) / geom.ticks) * noteW,
            x1: noteX0 + ((to - gStart) / geom.ticks) * noteW,
            display: geom.display,
        });
    }
    return rects;
}

/**
 * Grid ("ruler") lines for one row from its real measure geometry: one
 * line per grid subdivision over each measure's OWN tick length, so a
 * short 2/4 measure gets half the lines of its 2/2 neighbors and every
 * line sits exactly where the renderer puts that tick's notes.
 *
 * @param {Array} geoms - rowData.measures
 * @param {number} gridSubdivision - ticks between lines
 * @param {Function} beatTicksFor - (measure) => ticks per felt beat
 * @returns {Array<{x: number, tick: number, display: number, isBeat: boolean}>}
 */
export function gridLinesForRow(geoms, gridSubdivision, beatTicksFor) {
    if (!geoms || geoms.length === 0) return [];
    const lines = [];
    for (const geom of geoms) {
        const noteX0 = (geom.noteX0 ?? geom.x + 15) + (geom.noteOffset ?? 0);
        const noteW = geom.noteW ?? geom.width - 30;
        const beatTicks = beatTicksFor(geom.display);
        for (let tick = 0; tick < geom.ticks; tick += gridSubdivision) {
            lines.push({
                x: noteX0 + (tick / geom.ticks) * noteW,
                tick,
                display: geom.display,
                isBeat: tick % beatTicks === 0,
            });
        }
    }
    return lines;
}

/**
 * Cursor renderer and navigation controller
 * Works alongside TabRenderer to show edit position
 */
export class EditorCursor {
    constructor(state, options = {}) {
        this.state = state;
        this.options = {
            cursorColor: 'var(--accent, #007bff)',
            cursorWidth: 2,
            insertBoxPadding: 2,
            ghostOpacity: 0.4,
            ...options,
        };

        // DOM elements
        this.overlay = null;
        this.cursorElement = null;
        this.ghostNote = null;
        this.gridOverlay = null;

        // Layout info from TabRenderer (uniform fallback)
        this.layoutInfo = null;

        // TabRenderer reference: when set, cursor/grid use its real
        // rowData geometry (ts-aware, variable widths) instead of the
        // uniform layoutInfo model.
        this.renderer = null;
    }

    /**
     * Attach the TabRenderer whose rowData drives geometry-true
     * cursor/grid placement.
     */
    setRenderer(renderer) {
        this.renderer = renderer;
    }

    /**
     * Overlay-space point for an edit position via renderer geometry,
     * or null when geometry isn't available (fall back to layoutInfo).
     */
    _geometryPoint(position) {
        const rowData = this.renderer?.rowData;
        if (!rowData?.length || !this.container) return null;
        const opt = this.renderer.options || {};
        const p = svgPointForPosition(rowData, position, {
            topMargin: opt.topMargin ?? 30,
            stringSpacing: opt.stringSpacing ?? 15,
        });
        if (!p) return null;
        return this._svgToOverlay(p.row, p.x, p.y);
    }

    /**
     * Convert a point in a row's SVG coordinate space to overlay
     * coordinates (absolute within the canvas container).
     */
    _svgToOverlay(row, xSvg, ySvg) {
        const svg = row.svg;
        if (!svg?.getBoundingClientRect) return null;
        const svgRect = svg.getBoundingClientRect();
        const contRect = this.container.getBoundingClientRect();
        if (svgRect.width === 0) return null;
        const vb = svg.viewBox?.baseVal;
        const sx = vb?.width ? svgRect.width / vb.width : 1;
        const sy = vb?.height ? svgRect.height / vb.height : 1;
        return {
            x: svgRect.left - contRect.left + this.container.scrollLeft + xSvg * sx,
            y: svgRect.top - contRect.top + this.container.scrollTop + ySvg * sy,
            scaleX: sx,
            scaleY: sy,
        };
    }

    /**
     * Initialize cursor overlay
     * @param {HTMLElement} container - Container to append overlay to
     */
    init(container) {
        this.container = container;

        // Grid overlay (below cursor) - expands to content size
        this.gridOverlay = document.createElement('div');
        this.gridOverlay.className = 'editor-grid-overlay';
        this.gridOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            min-width: 100%;
            min-height: 100%;
            pointer-events: none;
            z-index: 5;
        `;
        container.appendChild(this.gridOverlay);

        // Selection overlay (between grid and cursor)
        this.selectionOverlay = document.createElement('div');
        this.selectionOverlay.className = 'editor-selection-overlay';
        this.selectionOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            min-width: 100%;
            min-height: 100%;
            pointer-events: none;
            z-index: 7;
        `;
        container.appendChild(this.selectionOverlay);

        // Cursor overlay (above grid) - expands to content size
        this.overlay = document.createElement('div');
        this.overlay.className = 'editor-cursor-overlay';
        this.overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            min-width: 100%;
            min-height: 100%;
            pointer-events: none;
            z-index: 10;
        `;

        // Cursor element (crosshair design)
        this.cursorElement = document.createElement('div');
        this.cursorElement.className = 'editor-cursor';

        // Crosshair sub-elements
        this.cursorVertical = document.createElement('div');
        this.cursorVertical.className = 'cursor-vertical';
        this.cursorElement.appendChild(this.cursorVertical);

        this.cursorHorizontal = document.createElement('div');
        this.cursorHorizontal.className = 'cursor-horizontal';
        this.cursorElement.appendChild(this.cursorHorizontal);

        this.cursorCenter = document.createElement('div');
        this.cursorCenter.className = 'cursor-center';
        this.cursorElement.appendChild(this.cursorCenter);

        this.overlay.appendChild(this.cursorElement);

        // Ghost note preview
        this.ghostNote = document.createElement('div');
        this.ghostNote.className = 'editor-ghost-note';
        this.ghostNote.style.display = 'none';
        this.overlay.appendChild(this.ghostNote);

        container.appendChild(this.overlay);
        this._updateCursorStyle();

        // Listen for grid changes
        this.state.on('gridSubdivisionChange', () => this.renderGrid());
        this.state.on('gridToggle', () => this.renderGrid());

        // Selection highlight follows mode changes (cleared on exit)
        this.state.on('modeChange', () => this.renderSelection());
    }

    /**
     * Update cursor style based on mode
     */
    _updateCursorStyle() {
        const mode = this.state.mode;
        const { cursorColor } = this.options;

        // Crosshair container - positioned at cursor location
        this.cursorElement.style.cssText = `
            position: absolute;
            pointer-events: none;
        `;

        // Whisker dimensions
        const whiskerLength = 20;
        const whiskerWidth = 2;
        const centerSize = mode === 'insert' ? 10 : 6;

        // Vertical whisker (extends above and below)
        this.cursorVertical.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            width: ${whiskerWidth}px;
            height: ${whiskerLength * 2}px;
            background: ${cursorColor};
            transform: translate(-50%, -50%);
            opacity: ${mode === 'insert' ? 1 : 0.8};
            ${mode === 'normal' ? 'animation: cursor-blink 1s infinite;' : ''}
        `;

        // Horizontal whisker (extends left and right on string)
        this.cursorHorizontal.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            width: ${whiskerLength * 2}px;
            height: ${whiskerWidth}px;
            background: ${cursorColor};
            transform: translate(-50%, -50%);
            opacity: ${mode === 'insert' ? 1 : 0.8};
            ${mode === 'normal' ? 'animation: cursor-blink 1s infinite;' : ''}
        `;

        // Center point/box
        if (mode === 'insert') {
            this.cursorCenter.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                width: ${centerSize}px;
                height: ${centerSize}px;
                border: 2px solid ${cursorColor};
                background: ${cursorColor}33;
                border-radius: 2px;
                transform: translate(-50%, -50%);
            `;
        } else if (mode === 'visual') {
            this.cursorCenter.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                width: ${centerSize}px;
                height: ${centerSize}px;
                background: ${cursorColor}66;
                border-radius: 50%;
                transform: translate(-50%, -50%);
            `;
        } else {
            this.cursorCenter.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                width: ${centerSize}px;
                height: ${centerSize}px;
                background: ${cursorColor};
                border-radius: 50%;
                transform: translate(-50%, -50%);
                animation: cursor-blink 1s infinite;
            `;
        }
    }

    /**
     * Update layout info from TabRenderer
     * @param {Object} layoutInfo - Layout information from renderer
     */
    setLayoutInfo(layoutInfo) {
        this.layoutInfo = layoutInfo;
        this._updateOverlaySize();
        this.update();
        this.renderGrid();
    }

    /**
     * Update overlay size to cover full content area
     */
    _updateOverlaySize() {
        if (!this.container) return;

        // Geometry path: size overlays to the rendered content
        if (this.renderer?.rowData?.length) {
            const w = this.container.scrollWidth;
            const h = this.container.scrollHeight;
            if (this.gridOverlay) {
                this.gridOverlay.style.width = `${w}px`;
                this.gridOverlay.style.height = `${h}px`;
            }
            if (this.overlay) {
                this.overlay.style.width = `${w}px`;
                this.overlay.style.height = `${h}px`;
            }
            return;
        }

        if (!this.layoutInfo) return;

        // Calculate total content dimensions
        const {
            rowHeight,
            measureWidth,
            measuresPerRow,
            leftMargin,
            rowLeftOffset = 0,
            trackInfoOffset = 0,
        } = this.layoutInfo;

        const measureCount = this.state.getMeasureCount();
        const rowCount = Math.ceil(measureCount / measuresPerRow);

        // Calculate content dimensions
        const contentWidth = rowLeftOffset + leftMargin + measuresPerRow * measureWidth + 50;
        const contentHeight = trackInfoOffset + rowCount * rowHeight + 50;

        // Ensure overlays are large enough
        if (this.gridOverlay) {
            this.gridOverlay.style.width = `${contentWidth}px`;
            this.gridOverlay.style.height = `${contentHeight}px`;
        }
        if (this.overlay) {
            this.overlay.style.width = `${contentWidth}px`;
            this.overlay.style.height = `${contentHeight}px`;
        }
    }

    /**
     * Render grid overlay with vertical lines at subdivision positions
     */
    renderGrid() {
        if (!this.gridOverlay) return;

        // Clear existing grid
        this.gridOverlay.innerHTML = '';

        // Check if grid should be visible
        if (!this.state.showGrid) return;

        // Keep overlay extents in sync with the (possibly re-laid-out) content
        this._updateOverlaySize();

        // Geometry-true grid from renderer rowData when available
        if (this._renderGridFromGeometry()) return;

        if (!this.layoutInfo) return;

        const {
            leftMargin,
            topMargin,
            stringSpacing,
            measureWidth,
            measuresPerRow,
            ticksPerMeasure,
            rowHeight,
            noteAreaStart,
            noteAreaWidth,
            trackInfoOffset = 0,
            rowLeftOffset = 0,
        } = this.layoutInfo;

        const stringCount = this.state.getStringCount();
        const measureCount = this.state.getMeasureCount();
        const subdivision = this.state.gridSubdivision;
        const ticksPerBeat = this.state.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;

        // Calculate how many rows we need
        const rowCount = Math.ceil(measureCount / measuresPerRow);

        // Create SVG for grid
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;

        // Draw grid lines for each row
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            const rowTop = trackInfoOffset + rowIndex * rowHeight;
            const stringTop = rowTop + topMargin;
            const stringBottom = stringTop + (stringCount - 1) * stringSpacing;

            // Draw lines for each measure in this row
            for (let measureInRow = 0; measureInRow < measuresPerRow; measureInRow++) {
                const measureNum = rowIndex * measuresPerRow + measureInRow + 1;
                if (measureNum > measureCount) break;

                const measureX = rowLeftOffset + leftMargin + measureInRow * measureWidth;

                // Draw vertical lines at each subdivision
                for (let tick = 0; tick < ticksPerMeasure; tick += subdivision) {
                    const x = measureX + noteAreaStart + (tick / ticksPerMeasure) * noteAreaWidth;
                    const isBeat = tick % ticksPerBeat === 0;

                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', x);
                    line.setAttribute('y1', stringTop - 4);
                    line.setAttribute('x2', x);
                    line.setAttribute('y2', stringBottom + 4);

                    if (isBeat) {
                        // Bold line for beats
                        line.setAttribute('stroke', 'var(--text-muted, rgba(0,0,0,0.3))');
                        line.setAttribute('stroke-width', '1.5');
                    } else {
                        // Lighter line for off-beats
                        line.setAttribute('stroke', 'var(--text-muted, rgba(0,0,0,0.15))');
                        line.setAttribute('stroke-width', '0.75');
                    }

                    svg.appendChild(line);
                }
            }
        }

        this.gridOverlay.appendChild(svg);
    }

    /**
     * Draw the grid from TabRenderer rowData: per-measure geometry, so
     * lines land exactly on the renderer's tick positions (ts-aware,
     * variable widths). Returns false when geometry is unavailable.
     */
    _renderGridFromGeometry() {
        const rowData = this.renderer?.rowData;
        if (!rowData?.length || !this.container) return false;

        const opt = this.renderer.options || {};
        const topMargin = opt.topMargin ?? 30;
        const stringSpacing = opt.stringSpacing ?? 15;
        const stringCount = this.state.getStringCount();
        const subdivision = this.state.gridSubdivision;
        const measureTiming = this.state.facade?.measureTiming;
        const ticksPerBeat = this.state.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;
        const beatTicksFor = measureTiming
            ? (m) => measureTiming.beatTicksFor(m)
            : () => ticksPerBeat;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: visible;
        `;

        let drew = false;
        for (const row of rowData) {
            const origin = this._svgToOverlay(row, 0, 0);
            if (!origin) continue;
            const lines = gridLinesForRow(row.measures, subdivision, beatTicksFor);
            const yTop = origin.y + (topMargin - 4) * origin.scaleY;
            const yBottom = origin.y +
                (topMargin + (stringCount - 1) * stringSpacing + 4) * origin.scaleY;

            for (const l of lines) {
                const x = origin.x + l.x * origin.scaleX;
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x);
                line.setAttribute('y1', yTop);
                line.setAttribute('x2', x);
                line.setAttribute('y2', yBottom);
                if (l.isBeat) {
                    line.setAttribute('stroke', 'var(--text-muted, rgba(0,0,0,0.3))');
                    line.setAttribute('stroke-width', '1.5');
                } else {
                    line.setAttribute('stroke', 'var(--text-muted, rgba(0,0,0,0.15))');
                    line.setAttribute('stroke-width', '0.75');
                }
                svg.appendChild(line);
                drew = true;
            }
        }

        if (!drew) return false;
        this.gridOverlay.appendChild(svg);
        return true;
    }

    /**
     * Calculate cursor position from layout info and cursor state
     */
    _calculatePosition() {
        if (!this.layoutInfo) return null;

        const { cursor } = this.state;
        const {
            leftMargin,
            topMargin,
            stringSpacing,
            measureWidth,
            measuresPerRow,
            ticksPerMeasure,
            rowHeight,
            noteAreaStart,
            noteAreaWidth,
            trackInfoOffset = 0,
            rowLeftOffset = 0,
        } = this.layoutInfo;

        // Find which row this measure is on
        const rowIndex = Math.floor((cursor.measure - 1) / measuresPerRow);
        const measureInRow = (cursor.measure - 1) % measuresPerRow;

        // Calculate X position (including row left offset)
        const measureX = rowLeftOffset + leftMargin + measureInRow * measureWidth;
        const tickRatio = cursor.tick / ticksPerMeasure;
        const x = measureX + noteAreaStart + tickRatio * noteAreaWidth;

        // Calculate Y position (accounting for track-info header offset)
        const stringIndex = cursor.string - 1;
        const rowTop = trackInfoOffset + rowIndex * rowHeight;
        const y = rowTop + topMargin + stringIndex * stringSpacing;

        return { x, y, rowIndex, measureX, rowTop };
    }

    /**
     * Update cursor position and appearance
     */
    update() {
        if (!this.overlay) return;

        // Selection highlight tracks every cursor/selection change
        this.renderSelection();

        // Geometry-true placement first; uniform layoutInfo as fallback
        const pos = this._geometryPoint(this.state.cursor)
            || (this.layoutInfo ? this._calculatePosition() : null);
        if (!pos) return;

        this._updateCursorStyle();

        // Position crosshair at intersection point
        // The cursor container is a box centered at the cursor position
        const containerSize = 50; // Large enough to contain whiskers
        this.cursorElement.style.left = `${pos.x - containerSize / 2}px`;
        this.cursorElement.style.top = `${pos.y - containerSize / 2}px`;
        this.cursorElement.style.width = `${containerSize}px`;
        this.cursorElement.style.height = `${containerSize}px`;
    }

    /**
     * Draw the selection highlight from renderer geometry: one span per
     * (row, measure) intersection, full staff height. Cleared when not
     * in visual mode or when geometry is unavailable.
     */
    renderSelection() {
        if (!this.selectionOverlay) return;
        this.selectionOverlay.innerHTML = '';

        const sel = this.state.selection;
        const rowData = this.renderer?.rowData;
        const facade = this.state.facade;
        if (!sel || !rowData?.length || !facade) return;

        const { start, end } = sel.getNormalized(this.state.ticksPerMeasure);
        const startAbs = facade.toAbs(start.measure, start.tick);
        // Inclusive of the end slot: extend by one grid step
        const endAbs = facade.toAbs(end.measure, end.tick) + this.state.gridSubdivision;

        const opt = this.renderer.options || {};
        const topMargin = opt.topMargin ?? 30;
        const stringSpacing = opt.stringSpacing ?? 15;
        const staffH = (this.state.getStringCount() - 1) * stringSpacing + 12;

        for (const row of rowData) {
            const origin = this._svgToOverlay(row, 0, 0);
            if (!origin) continue;
            for (const rect of selectionRectsForRow(row.measures, startAbs, endAbs)) {
                const div = document.createElement('div');
                div.className = 'editor-selection-rect';
                div.style.cssText = `
                    position: absolute;
                    left: ${origin.x + rect.x0 * origin.scaleX - 6}px;
                    top: ${origin.y + (topMargin - 6) * origin.scaleY}px;
                    width: ${(rect.x1 - rect.x0) * origin.scaleX + 12}px;
                    height: ${staffH * origin.scaleY}px;
                    background: var(--accent, #007bff);
                    opacity: 0.14;
                    border-radius: 3px;
                    pointer-events: none;
                `;
                this.selectionOverlay.appendChild(div);
            }
        }
    }

    /**
     * Dashed outline preview of a phrase-move drop range. Lives in its
     * own elements so selection redraws don't wipe it (and vice versa).
     */
    renderMovePreview(startAbs, endAbs) {
        this.clearMovePreview();
        const rowData = this.renderer?.rowData;
        if (!rowData?.length || !this.overlay) return;

        const opt = this.renderer.options || {};
        const topMargin = opt.topMargin ?? 30;
        const stringSpacing = opt.stringSpacing ?? 15;
        const staffH = (this.state.getStringCount() - 1) * stringSpacing + 12;

        this._movePreviewEls = [];
        for (const row of rowData) {
            const origin = this._svgToOverlay(row, 0, 0);
            if (!origin) continue;
            for (const rect of selectionRectsForRow(row.measures, startAbs, endAbs)) {
                const div = document.createElement('div');
                div.className = 'editor-move-preview';
                div.style.cssText = `
                    position: absolute;
                    left: ${origin.x + rect.x0 * origin.scaleX - 6}px;
                    top: ${origin.y + (topMargin - 6) * origin.scaleY}px;
                    width: ${(rect.x1 - rect.x0) * origin.scaleX + 12}px;
                    height: ${staffH * origin.scaleY}px;
                    border: 2px dashed var(--accent, #007bff);
                    border-radius: 3px;
                    box-sizing: border-box;
                    pointer-events: none;
                `;
                this.overlay.appendChild(div);
                this._movePreviewEls.push(div);
            }
        }
    }

    clearMovePreview() {
        for (const el of this._movePreviewEls || []) el.remove();
        this._movePreviewEls = [];
    }

    /**
     * Update selection highlight for visual mode
     */
    _updateSelectionHighlight(cursorPos) {
        if (!this.state.selection) return;

        const { ticksPerMeasure } = this.layoutInfo;
        const { start, end } = this.state.selection.getNormalized(ticksPerMeasure);

        // For now, just show cursor at end of selection
        // Full selection highlighting would need multiple elements
        const cursorHeight = this.layoutInfo.stringSpacing * (this.state.getStringCount() - 1) + 20;
        this.cursorElement.style.left = `${cursorPos.x}px`;
        this.cursorElement.style.top = `${cursorPos.rowTop + this.layoutInfo.topMargin - 5}px`;
        this.cursorElement.style.height = `${cursorHeight}px`;
        this.cursorElement.style.width = '20px';
    }

    /**
     * Show ghost note preview
     * @param {number} fret - Fret number to preview
     */
    showGhostNote(fret) {
        const pos = this._geometryPoint(this.state.cursor)
            || (this.layoutInfo ? this._calculatePosition() : null);
        if (!pos) return;

        this.ghostNote.style.cssText = `
            display: block;
            position: absolute;
            left: ${pos.x}px;
            top: ${pos.y}px;
            font-size: 12px;
            font-weight: 600;
            color: var(--text, #000);
            opacity: ${this.options.ghostOpacity};
            transform: translate(-50%, -50%);
            text-align: center;
        `;
        this.ghostNote.textContent = fret.toString();
    }

    /**
     * Hide ghost note preview
     */
    hideGhostNote() {
        if (this.ghostNote) {
            this.ghostNote.style.display = 'none';
        }
    }

    /**
     * Move cursor by tick delta
     * @param {number} deltaTicks - Ticks to move (positive = forward)
     */
    moveByTicks(deltaTicks) {
        const cursor = this.state.cursor;
        const facade = this.state.facade;

        if (facade) {
            // Ts-aware: absolute ticks accumulate each measure's OWN
            // length, so the cursor can never park in the phantom back
            // half of a short 2/4 measure (which stored out-of-range
            // notes that rendered past the barline).
            let absTick = facade.toAbs(cursor.measure, cursor.tick) + deltaTicks;
            const measureCount = this.state.getMeasureCount();
            const maxTick = facade.toAbs(measureCount, 0)
                + facade.ticksFor(measureCount);
            absTick = Math.max(0, Math.min(absTick, maxTick - 1));
            const loc = facade.locate(absTick);
            cursor.measure = loc.measure;
            cursor.tick = loc.tick;
        } else {
            // Uniform fallback (no facade in some unit-test setups)
            const ticksPerMeasure = this.state.ticksPerMeasure;
            const measureCount = this.state.getMeasureCount();
            let absTick = cursor.getAbsoluteTick(ticksPerMeasure) + deltaTicks;
            const maxTick = measureCount * ticksPerMeasure;
            absTick = Math.max(0, Math.min(absTick, maxTick - 1));
            cursor.setFromAbsoluteTick(absTick, ticksPerMeasure);
        }

        // Update selection in visual mode
        if (this.state.mode === 'visual' && this.state.selection) {
            this.state.selection.end = cursor.clone();
        }

        this.update();
        this.state._emit('cursorMove', cursor);
    }

    /**
     * Move cursor by grid subdivision (for navigation)
     * @param {number} direction - 1 for forward, -1 for backward
     */
    moveByDuration(direction) {
        // The selected note duration IS the working increment: arrows,
        // Space, and post-insert auto-advance all step by it. (The grid
        // is a visual ruler that follows the duration by default.)
        this.moveByTicks(direction * this.state.currentDuration);
    }

    /**
     * Move cursor by beat
     * @param {number} direction - 1 for forward, -1 for backward
     */
    moveByBeat(direction) {
        const cursor = this.state.cursor;
        const ticksPerBeat = this.state.otf.timing?.ticks_per_beat || TICKS_PER_BEAT;

        if (direction > 0) {
            // Move to next beat boundary
            const currentBeat = Math.floor(cursor.tick / ticksPerBeat);
            const nextBeatTick = (currentBeat + 1) * ticksPerBeat;
            this.moveByTicks(nextBeatTick - cursor.tick);
        } else {
            // Move to previous beat boundary
            const currentBeat = Math.floor(cursor.tick / ticksPerBeat);
            if (cursor.tick % ticksPerBeat === 0 && currentBeat > 0) {
                // At beat boundary, move to previous
                this.moveByTicks(-ticksPerBeat);
            } else {
                // Move to current beat start
                const currentBeatTick = currentBeat * ticksPerBeat;
                this.moveByTicks(currentBeatTick - cursor.tick);
            }
        }
    }

    /**
     * Move cursor to string
     * @param {number} direction - 1 for down (higher string number), -1 for up
     */
    moveString(direction) {
        const cursor = this.state.cursor;
        const stringCount = this.state.getStringCount();

        const newString = cursor.string + direction;
        if (newString >= 1 && newString <= stringCount) {
            cursor.string = newString;
            this.update();
            this.state._emit('cursorMove', cursor);
        }
    }

    /**
     * Move to start of measure
     */
    moveToMeasureStart() {
        this.state.cursor.tick = 0;
        this.update();
        this.state._emit('cursorMove', this.state.cursor);
    }

    /**
     * Move to end of measure
     */
    moveToMeasureEnd() {
        // Find last event in measure
        const measure = this.state.getMeasure(this.state.cursor.measure);
        if (measure && measure.events.length > 0) {
            const lastEvent = measure.events[measure.events.length - 1];
            this.state.cursor.tick = lastEvent.tick;
        } else {
            // Last increment before the next measure — this measure's
            // OWN length (ts-aware), not the uniform default
            const measureTicks = this.state.facade
                ? this.state.facade.ticksFor(this.state.cursor.measure)
                : this.state.ticksPerMeasure;
            this.state.cursor.tick = Math.max(0, measureTicks - this.state.currentDuration);
        }
        this.update();
        this.state._emit('cursorMove', this.state.cursor);
    }

    /**
     * Move to specific measure
     * @param {number} measureNum - Measure number (1-indexed)
     */
    moveToMeasure(measureNum) {
        const cursor = this.state.cursor;
        const measureCount = this.state.getMeasureCount();

        cursor.measure = Math.max(1, Math.min(measureNum, measureCount));
        cursor.tick = 0;

        this.update();
        this.state._emit('cursorMove', cursor);
    }

    /**
     * Move to start of document
     */
    moveToStart() {
        this.state.cursor.measure = 1;
        this.state.cursor.tick = 0;
        this.update();
        this.state._emit('cursorMove', this.state.cursor);
    }

    /**
     * Move to end of document
     */
    moveToEnd() {
        const measureCount = this.state.getMeasureCount();
        this.state.cursor.measure = measureCount;
        this.moveToMeasureEnd();
    }

    /**
     * Move to next event (note)
     */
    moveToNextEvent() {
        const cursor = this.state.cursor;
        const notation = this.state.getNotation();
        const ticksPerMeasure = this.state.ticksPerMeasure;
        const currentAbsTick = cursor.getAbsoluteTick(ticksPerMeasure);

        // Find next event after current position
        for (const measure of notation) {
            for (const event of measure.events) {
                const eventAbsTick = (measure.measure - 1) * ticksPerMeasure + event.tick;
                if (eventAbsTick > currentAbsTick) {
                    cursor.measure = measure.measure;
                    cursor.tick = event.tick;
                    this.update();
                    this.state._emit('cursorMove', cursor);
                    return;
                }
            }
        }
    }

    /**
     * Move to previous event (note)
     */
    moveToPrevEvent() {
        const cursor = this.state.cursor;
        const notation = this.state.getNotation();
        const ticksPerMeasure = this.state.ticksPerMeasure;
        const currentAbsTick = cursor.getAbsoluteTick(ticksPerMeasure);

        // Find previous event before current position
        let prevMeasure = null;
        let prevEvent = null;

        for (const measure of notation) {
            for (const event of measure.events) {
                const eventAbsTick = (measure.measure - 1) * ticksPerMeasure + event.tick;
                if (eventAbsTick < currentAbsTick) {
                    prevMeasure = measure;
                    prevEvent = event;
                } else {
                    break;
                }
            }
        }

        if (prevMeasure && prevEvent) {
            cursor.measure = prevMeasure.measure;
            cursor.tick = prevEvent.tick;
            this.update();
            this.state._emit('cursorMove', cursor);
        }
    }

    /**
     * Set cursor position from click coordinates
     * @param {number} x - X coordinate relative to canvas
     * @param {number} y - Y coordinate relative to canvas
     * @returns {boolean} - Whether position was valid
     */
    setFromCoordinates(x, y) {
        if (!this.layoutInfo) return false;

        const {
            leftMargin,
            topMargin,
            stringSpacing,
            measureWidth,
            measuresPerRow,
            ticksPerMeasure,
            rowHeight,
            noteAreaStart,
            noteAreaWidth,
            trackInfoOffset = 0,
            rowLeftOffset = 0,
        } = this.layoutInfo;

        // Adjust y for track-info header offset
        const adjustedY = y - trackInfoOffset;

        // Determine row
        const rowIndex = Math.floor(adjustedY / rowHeight);

        // Determine measure in row (accounting for row left offset)
        const xInRow = x - rowLeftOffset - leftMargin;
        const measureInRow = Math.floor(xInRow / measureWidth);

        if (measureInRow < 0 || measureInRow >= measuresPerRow) {
            return false;
        }

        // Calculate measure number
        const measureNum = rowIndex * measuresPerRow + measureInRow + 1;
        const measureCount = this.state.getMeasureCount();
        if (measureNum < 1 || measureNum > measureCount + 1) {
            return false;
        }

        // Calculate tick within measure (snap to grid subdivision)
        const measureX = rowLeftOffset + leftMargin + measureInRow * measureWidth;
        const xInMeasure = x - measureX - noteAreaStart;
        const tickRatio = Math.max(0, Math.min(1, xInMeasure / noteAreaWidth));
        const tick = Math.round(tickRatio * ticksPerMeasure / this.state.gridSubdivision) * this.state.gridSubdivision;

        // Calculate string
        const yInRow = adjustedY - rowIndex * rowHeight;
        const stringIndex = Math.round((yInRow - topMargin) / stringSpacing);
        const stringCount = this.state.getStringCount();
        const string = Math.max(1, Math.min(stringCount, stringIndex + 1));

        // Update cursor
        this.state.cursor.measure = Math.min(measureNum, measureCount);
        this.state.cursor.tick = Math.min(tick, ticksPerMeasure - 1);
        this.state.cursor.string = string;

        this.update();
        this.state._emit('cursorMove', this.state.cursor);
        return true;
    }

    /**
     * Destroy cursor overlay
     */
    destroy() {
        if (this.gridOverlay && this.gridOverlay.parentNode) {
            this.gridOverlay.parentNode.removeChild(this.gridOverlay);
        }
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        if (this.selectionOverlay && this.selectionOverlay.parentNode) {
            this.selectionOverlay.parentNode.removeChild(this.selectionOverlay);
        }
        this.selectionOverlay = null;
        this.gridOverlay = null;
        this.overlay = null;
        this.cursorElement = null;
        this.cursorVertical = null;
        this.cursorHorizontal = null;
        this.cursorCenter = null;
        this.ghostNote = null;
    }
}

// CSS animation for blinking cursor
const style = document.createElement('style');
style.textContent = `
@keyframes cursor-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}
`;
if (!document.querySelector('style[data-otf-cursor]')) {
    style.setAttribute('data-otf-cursor', '');
    document.head.appendChild(style);
}
