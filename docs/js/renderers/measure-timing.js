// Time-signature-aware measure math for OTF documents.
//
// OTF carries a global metadata.time_signature plus optional per-measure
// overrides in metadata.time_signature_changes: [{measure, time_signature}]
// (1-based written-measure numbers; each override applies to that measure
// ONLY — pickups and mid-tune short measures, both common in the corpus).
//
// This module is the single source of truth for measure lengths shared by
// the tab renderer, the tab player, and work-view's compact/unrolled
// mapping. It is deliberately UI-free so the future OTF editing facade can
// reuse it for ts-aware cursor/insert math.
//
// Tick convention: ticks_per_beat (default 480) is per QUARTER note, so a
// whole note is 4 * ticksPerBeat and a measure of num/den is
// ticksPerBeat * 4 * num / den. (The old numerator-only math halved every
// 2/2 measure.)

/**
 * Parse "3/4" into {num, den}. Falls back to 4/4 on anything invalid.
 */
export function parseTimeSignature(ts) {
    if (typeof ts === 'string') {
        const m = ts.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
        if (m) {
            const num = parseInt(m[1], 10);
            const den = parseInt(m[2], 10);
            if (num > 0 && den > 0) return { num, den };
        }
    }
    return { num: 4, den: 4 };
}

/**
 * Ticks in one measure of the given signature.
 */
export function measureTicksFor(ts, ticksPerBeat = 480) {
    const { num, den } = parseTimeSignature(ts);
    return Math.round(ticksPerBeat * 4 * num / den);
}

/**
 * "Feel" presentation: bluegrass 4/4 is usually FELT in cut time. In
 * two-feel, equal-length signatures are re-presented (4/4 -> 2/2,
 * 2/4 -> 1/2) — tick math is untouched, but displayed signatures,
 * beats (metronome) and beam grouping follow the half-note pulse.
 */
const TWO_FEEL_MAP = { '4/4': '2/2', '2/4': '1/2' };

/**
 * Per-written-measure time signatures: global signature + overrides.
 */
export class MeasureTiming {
    constructor({ timeSignature = '4/4', timeSignatureChanges = [], ticksPerBeat = 480, feel = null } = {}) {
        this.ticksPerBeat = ticksPerBeat;
        this.feel = feel;
        this.defaultSignature = this._present(
            parseTimeSignature(timeSignature) ? timeSignature : '4/4');
        this.defaultTicks = measureTicksFor(timeSignature, ticksPerBeat);
        this._overrides = new Map();
        for (const c of timeSignatureChanges || []) {
            if (c && c.measure >= 1 && c.time_signature) {
                this._overrides.set(c.measure, c.time_signature);
            }
        }
    }

    /** Re-present a signature according to the feel (tick-length neutral). */
    _present(sig) {
        if (this.feel === 'two') return TWO_FEEL_MAP[sig] || sig;
        return sig;
    }

    /** Time signature string in effect for a written measure. */
    signatureFor(measure) {
        const raw = this._overrides.get(measure);
        return raw ? this._present(raw) : this.defaultSignature;
    }

    /** Ticks in a written measure. */
    ticksFor(measure) {
        const sig = this._overrides.get(measure);
        return sig ? measureTicksFor(sig, this.ticksPerBeat) : this.defaultTicks;
    }

    /** Beats in a written measure (the numerator). */
    beatsFor(measure) {
        return parseTimeSignature(this.signatureFor(measure)).num;
    }

    /** Ticks per beat in a written measure (den-aware: 960 in 2/2). */
    beatTicksFor(measure) {
        return this.ticksFor(measure) / this.beatsFor(measure);
    }
}

/**
 * Timeline: ordered slots of {display, original}. display is the 1-based
 * position on screen / in playback; original is the written measure whose
 * content (and time signature) fills that slot.
 */
export function identityTimeline(measureCount) {
    const tl = [];
    for (let m = 1; m <= measureCount; m++) tl.push({ display: m, original: m });
    return tl;
}

/**
 * Unroll a reading list ({from_measure, to_measure} ranges) into a
 * timeline. Every slot is kept — including measures a sparse track has no
 * events for — so all tracks stay time-aligned.
 */
export function readingListTimeline(readingList, measureCount) {
    if (!readingList || readingList.length === 0) {
        return identityTimeline(measureCount);
    }
    const tl = [];
    let display = 1;
    for (const range of readingList) {
        for (let m = range.from_measure; m <= range.to_measure; m++) {
            tl.push({ display, original: m });
            display++;
        }
    }
    return tl;
}

/**
 * Cumulative tick positions over a timeline.
 */
export class TimelineTiming {
    constructor(measureTiming, timeline) {
        this.measureTiming = measureTiming;
        this.slots = [];
        this._byDisplay = new Map();
        let start = 0;
        for (const { display, original } of timeline) {
            const ticks = measureTiming.ticksFor(original);
            const slot = { display, original, startTick: start, ticks };
            this.slots.push(slot);
            this._byDisplay.set(display, slot);
            start += ticks;
        }
        this.totalTicks = start;
    }

    get length() {
        return this.slots.length;
    }

    _slot(display) {
        return this._byDisplay.get(display);
    }

    has(display) {
        return this._byDisplay.has(display);
    }

    /** Start tick of a display measure (extrapolates past the timeline). */
    startTick(display) {
        const slot = this._slot(display);
        if (slot) return slot.startTick;
        const past = display - this.slots.length - 1;
        return this.totalTicks + past * this.measureTiming.defaultTicks;
    }

    /** Length in ticks of a display measure. */
    ticksAt(display) {
        const slot = this._slot(display);
        return slot ? slot.ticks : this.measureTiming.defaultTicks;
    }

    /** Written measure behind a display measure. */
    originalAt(display) {
        const slot = this._slot(display);
        return slot ? slot.original : display;
    }

    /**
     * Find the display measure containing an absolute tick.
     * Ticks past the end extrapolate with the default measure length so
     * end-of-playback cursor updates stay sane.
     */
    locate(absTick) {
        const t = Math.max(0, absTick);
        if (t >= this.totalTicks) {
            const def = this.measureTiming.defaultTicks;
            const past = Math.floor((t - this.totalTicks) / def);
            return {
                display: this.slots.length + past + 1,
                original: this.slots.length + past + 1,
                tickInMeasure: (t - this.totalTicks) - past * def,
            };
        }
        // binary search over startTick
        let lo = 0, hi = this.slots.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.slots[mid].startTick <= t) lo = mid;
            else hi = mid - 1;
        }
        const slot = this.slots[lo];
        return {
            display: slot.display,
            original: slot.original,
            tickInMeasure: t - slot.startTick,
        };
    }
}

/**
 * Expand a track's notation onto a timeline. Slots whose original measure
 * has no entry in this track produce no output entry, but their slot (and
 * therefore their time) is preserved — display numbering never collapses.
 * (The old per-track renumbering shifted sparse tracks early: 27493's
 * mandolin, silent for measures 1-5, played 5 measures ahead.)
 */
export function expandNotation(notation, timeline) {
    const byMeasure = new Map();
    for (const entry of notation || []) byMeasure.set(entry.measure, entry);
    const out = [];
    for (const { display, original } of timeline) {
        const src = byMeasure.get(original);
        if (src) {
            out.push({ ...src, measure: display, originalMeasure: original });
        }
    }
    return out;
}

/**
 * Map playback (expanded) absolute ticks to visual (written-measure)
 * absolute ticks — used when the display shows repeat signs but playback
 * follows the unrolled reading list.
 */
export function makePlaybackToVisualMapper(playbackTiming, visualTiming) {
    return (playbackTick) => {
        const loc = playbackTiming.locate(playbackTick);
        return visualTiming.startTick(loc.original) + loc.tickInMeasure;
    };
}

/**
 * Metronome click schedule over a timeline: one click per beat of each
 * measure's own signature, downbeat flagged.
 */
export function buildMetronomeSchedule(timelineTiming) {
    const clicks = [];
    for (const slot of timelineTiming.slots) {
        const beats = timelineTiming.measureTiming.beatsFor(slot.original);
        const beatTicks = slot.ticks / beats;
        for (let b = 0; b < beats; b++) {
            clicks.push({
                tick: slot.startTick + Math.round(b * beatTicks),
                isDownbeat: b === 0,
            });
        }
    }
    return clicks;
}

/**
 * Analyze a reading list to detect repeat structures (for compact display).
 *
 * Returns:
 * - repeatStartMarkers: Set of measures where a repeat starts (|:)
 * - repeatEndMarkers: Set of measures where a repeat ends (:|)
 * - endings: {measure: endingNumber} for 1st/2nd ending brackets
 *
 * Handles patterns like:
 * - [1-9, 2-8, 10-10]: 2-8 repeats, 9 is 1st ending, 10 is 2nd ending
 * - [11-18, 11-17, 19-19]: 11-17 repeats, 18 is 1st ending, 19 is 2nd
 * - [1-8, 1-16]: simple AABB repeat of the first section
 */
export function analyzeReadingList(readingList) {
    if (!readingList || readingList.length === 0) {
        return { endings: {}, repeatStartMarkers: new Set(), repeatEndMarkers: new Set() };
    }

    const repeatStartMarkers = new Set();
    const repeatEndMarkers = new Set();
    const endings = {}; // measure -> ending number (1, 2, ...)

    for (let i = 0; i < readingList.length - 1; i++) {
        const curr = readingList[i];
        const next = readingList[i + 1];

        const currStart = curr.from_measure;
        const currEnd = curr.to_measure;
        const nextStart = next.from_measure;
        const nextEnd = next.to_measure;

        // Case 1: next starts inside current and ends at/before current's
        // end. e.g. [1-9] then [2-8] -> repeat 2..8, 9 is 1st ending;
        // [6-51] then [39-51] -> plain repeat 39..51 (equal ends = no
        // ending measures; 27493's second repeat was missed by a
        // strict '<').
        // The end-repeat sign sits at the end of the FIRST ENDING (currEnd),
        // not the end of the common section (nextEnd): notation is
        // |: common |1. ending :| |2. ...  — the :| closes the first ending.
        // When there is no ending (plain repeat) currEnd === nextEnd, so this
        // is a no-op there.
        if (nextStart > currStart && nextStart <= currEnd &&
            nextEnd <= currEnd && nextEnd >= nextStart) {
            repeatStartMarkers.add(nextStart);
            repeatEndMarkers.add(currEnd);
            for (let m = nextEnd + 1; m <= currEnd; m++) endings[m] = 1;
            const afterRepeat = readingList[i + 2];
            if (afterRepeat &&
                afterRepeat.from_measure === currEnd + 1 &&
                afterRepeat.to_measure === afterRepeat.from_measure) {
                endings[afterRepeat.from_measure] = 2;
            }
        }

        // Case 2: same start, next ends before current (subset repeat)
        // e.g. [11-18] then [11-17] -> repeat 11..17, 18 is 1st ending.
        // As in Case 1, the :| closes the FIRST ENDING (currEnd), not the
        // common section (nextEnd).
        if (nextStart === currStart && nextEnd < currEnd) {
            repeatStartMarkers.add(currStart);
            repeatEndMarkers.add(currEnd);
            for (let m = nextEnd + 1; m <= currEnd; m++) endings[m] = 1;
            const afterRepeat = readingList[i + 2];
            if (afterRepeat &&
                afterRepeat.from_measure === currEnd + 1 &&
                afterRepeat.to_measure === afterRepeat.from_measure) {
                endings[afterRepeat.from_measure] = 2;
            }
        }

        // Case 3: same start, next extends past OR exactly repeats current.
        // [1-8] then [1-16] -> |: 1..8 :| B (AABB first-section repeat).
        // [1-8] then [1-8]  -> |: 1..8 :|   (literal duplicate span — the
        // parser emits pure-AABB repeats this way; a strict '>' dropped the
        // repeat signs entirely, e.g. salt-creek [1-8][1-8][9-16][9-16]).
        // '>=' is safe: Case 2 owns nextEnd < currEnd, so the branches stay
        // mutually exclusive.
        if (nextStart === currStart && nextEnd >= currEnd) {
            repeatStartMarkers.add(currStart);
            repeatEndMarkers.add(currEnd);
        }

        // Case 4: next starts inside current and CONTINUES PAST it —
        // the overlap [nextStart..currEnd] is the repeated span and the
        // music then carries on. 27493: [1-13] then [6-51] -> |: 6 :| 13.
        if (nextStart > currStart && nextStart <= currEnd && nextEnd > currEnd) {
            repeatStartMarkers.add(nextStart);
            repeatEndMarkers.add(currEnd);
        }
    }

    return { repeatStartMarkers, repeatEndMarkers, endings };
}

/**
 * Annotate original (written-measure) notation with repeatStart/repeatEnd/
 * ending flags for compact display with repeat signs.
 */
export function prepareCompactNotation(notation, readingList) {
    if (!readingList || readingList.length === 0) {
        return notation;
    }
    const analysis = analyzeReadingList(readingList);
    return notation.map(measure => {
        const m = measure.measure;
        const enhanced = { ...measure };
        if (analysis.repeatStartMarkers.has(m)) enhanced.repeatStart = true;
        if (analysis.repeatEndMarkers.has(m)) enhanced.repeatEnd = true;
        if (analysis.endings[m]) enhanced.ending = analysis.endings[m];
        return enhanced;
    });
}

/**
 * Max written measure number across every track of an OTF notation map.
 */
export function maxMeasureIn(notationByTrack) {
    let max = 0;
    for (const trackId in notationByTrack || {}) {
        for (const m of notationByTrack[trackId] || []) {
            if (m.measure > max) max = m.measure;
        }
    }
    return max || 1;
}

/**
 * Convenience: build MeasureTiming straight from an OTF document.
 * @param {Object} [opts] - { feel: 'two' } for cut-time presentation
 */
export function measureTimingFromOtf(otf, opts = {}) {
    return new MeasureTiming({
        timeSignature: otf?.metadata?.time_signature || '4/4',
        timeSignatureChanges: otf?.metadata?.time_signature_changes || [],
        ticksPerBeat: otf?.timing?.ticks_per_beat || 480,
        feel: opts.feel || null,
    });
}
