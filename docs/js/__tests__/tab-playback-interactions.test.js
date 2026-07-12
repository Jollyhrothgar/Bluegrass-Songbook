// Reading-view playback interactions: display->playback tick mapping
// (unrolled AND compact "Repeats" views) + the pointer wiring.
import { describe, it, expect, vi } from 'vitest';

import {
    playbackTickForPoint,
    playbackRangeForMeasures,
    attachTabPlaybackInteractions,
} from '../tab-playback-interactions.js';
import {
    MeasureTiming, TimelineTiming, readingListTimeline,
} from '../renderers/measure-timing.js';

// 4/4 doc, 8 written measures, AB with repeats: play order
// 1-4, 1-4, 5-8 (reading list) -> 12 playback slots of 1920 ticks
const timing = new MeasureTiming({ timeSignature: '4/4' });
const rl = [
    { from_measure: 1, to_measure: 4 },
    { from_measure: 1, to_measure: 4 },
    { from_measure: 5, to_measure: 8 },
];
const playback = new TimelineTiming(timing, readingListTimeline(rl, 8));

describe('playbackTickForPoint', () => {
    it('unrolled: display measure IS the playback slot', () => {
        expect(playbackTickForPoint(playback, false, 1, 0)).toBe(0);
        expect(playbackTickForPoint(playback, false, 6, 480)).toBe(5 * 1920 + 480);
    });

    it('compact: written measure maps to its FIRST pass', () => {
        // written m2 first plays as slot 2 -> startTick 1920
        expect(playbackTickForPoint(playback, true, 2, 240)).toBe(1920 + 240);
        // written m5 first plays as slot 9 -> startTick 8*1920
        expect(playbackTickForPoint(playback, true, 5, 0)).toBe(8 * 1920);
    });

    it('compact: never-played measures yield null', () => {
        const partial = new TimelineTiming(
            timing, readingListTimeline([{ from_measure: 2, to_measure: 3 }], 8));
        expect(playbackTickForPoint(partial, true, 7, 0)).toBeNull();
    });
});

describe('playbackRangeForMeasures', () => {
    it('unrolled: whole-measure span', () => {
        expect(playbackRangeForMeasures(playback, false, 2, 3)).toEqual({
            startTick: 1920, endTick: 3 * 1920,
        });
    });

    it('swaps a backwards drag', () => {
        expect(playbackRangeForMeasures(playback, false, 3, 2)).toEqual({
            startTick: 1920, endTick: 3 * 1920,
        });
    });

    it('compact: first contiguous pass of the written range', () => {
        // written 2..4 -> first pass slots 2..4
        expect(playbackRangeForMeasures(playback, true, 2, 4)).toEqual({
            startTick: 1920, endTick: 4 * 1920,
        });
    });
});

describe('attachTabPlaybackInteractions', () => {
    function makeRenderer() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 800 120');
        Object.defineProperty(svg, 'getBoundingClientRect', {
            value: () => ({ left: 0, top: 0, width: 800, height: 120 }),
        });
        document.body.appendChild(svg);
        return {
            options: { topMargin: 40, stringSpacing: 14, highlightColor: '#00f' },
            numStrings: 5,
            rowData: [{
                svg,
                firstMeasure: 1,
                lastMeasure: 2,
                measures: [
                    { display: 1, x: 0, width: 400, ticks: 1920, startTick: 0, noteX0: 20, noteW: 360, noteOffset: 0 },
                    { display: 2, x: 400, width: 400, ticks: 1920, startTick: 1920, noteX0: 420, noteW: 360, noteOffset: 0 },
                ],
            }],
        };
    }

    const pointer = (type, x, y) => new MouseEvent(type,
        { clientX: x, clientY: y, bubbles: true, button: 0 });

    it('click quantizes to the beat and reports the display measure', () => {
        const r = makeRenderer();
        const onPlayFrom = vi.fn();
        attachTabPlaybackInteractions(r, { beatTicks: 480, onPlayFrom });
        const svg = r.rowData[0].svg;
        // x = 20 + 360*0.55 = 218 -> ratio .55 -> tick 1056 -> beat-quantized 960
        svg.dispatchEvent(pointer('pointerdown', 218, 60));
        svg.dispatchEvent(pointer('pointerup', 218, 60));
        expect(onPlayFrom).toHaveBeenCalledWith({ measure: 1, tick: 960 });
    });

    it('drag across the barline loops the measure span and highlights', () => {
        const r = makeRenderer();
        const onLoopMeasures = vi.fn();
        attachTabPlaybackInteractions(r, { beatTicks: 480, onLoopMeasures });
        const svg = r.rowData[0].svg;
        svg.dispatchEvent(pointer('pointerdown', 100, 60));
        svg.dispatchEvent(pointer('pointermove', 600, 60));
        svg.dispatchEvent(pointer('pointerup', 600, 60));
        expect(onLoopMeasures).toHaveBeenCalledWith(1, 2);
        expect(svg.querySelectorAll('.phrase-highlight').length).toBe(2);
    });

    it('hover shows a play-from caret at the quantized beat; leave clears it', () => {
        const r = makeRenderer();
        attachTabPlaybackInteractions(r, { beatTicks: 480, onPlayFrom: vi.fn() });
        const svg = r.rowData[0].svg;
        svg.dispatchEvent(pointer('pointermove', 218, 60)); // no drag active
        const caret = svg.querySelector('.play-caret');
        expect(caret).not.toBeNull();
        // tick 960 of measure 1 -> x = 20 + (960/1920)*360 = 200
        expect(+caret.getAttribute('x1')).toBe(200);
        svg.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
        expect(svg.querySelector('.play-caret')).toBeNull();
    });

    it('debounces rapid clicks into one playback start', () => {
        const r = makeRenderer();
        const onPlayFrom = vi.fn();
        attachTabPlaybackInteractions(r, { beatTicks: 480, onPlayFrom });
        const svg = r.rowData[0].svg;
        for (let i = 0; i < 3; i++) {
            svg.dispatchEvent(pointer('pointerdown', 218, 60));
            svg.dispatchEvent(pointer('pointerup', 218, 60));
        }
        expect(onPlayFrom).toHaveBeenCalledTimes(1);
    });

    it('destroy removes highlights and handlers', () => {
        const r = makeRenderer();
        const onPlayFrom = vi.fn();
        const api = attachTabPlaybackInteractions(r, { beatTicks: 480, onPlayFrom });
        api.destroy();
        const svg = r.rowData[0].svg;
        svg.dispatchEvent(pointer('pointerdown', 100, 60));
        svg.dispatchEvent(pointer('pointerup', 100, 60));
        expect(onPlayFrom).not.toHaveBeenCalled();
    });
});
