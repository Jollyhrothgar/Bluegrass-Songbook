// OTF Editor Actions
// Higher-level edit actions that operate on state

import { EditorMode, DURATIONS } from './state.js';

/**
 * Create an empty OTF document
 * @param {string} instrument - Instrument type
 * @param {Object} options - Additional options
 */
export function createEmptyOTF(instrument = '5-string-banjo', options = {}) {
    const instrumentConfigs = {
        '5-string-banjo': {
            id: 'banjo',
            tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
        },
        '6-string-guitar': {
            id: 'guitar',
            tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
        },
        'mandolin': {
            id: 'mandolin',
            tuning: ['E5', 'A4', 'D4', 'G3'],
        },
        'upright-bass': {
            id: 'bass',
            tuning: ['G2', 'D2', 'A1', 'E1'],
        },
        'tenor-banjo': {
            id: 'tenor_banjo',
            tuning: ['A4', 'D4', 'G3', 'C3'],
        },
        'dobro': {
            id: 'dobro',
            tuning: ['D4', 'B3', 'G3', 'D3', 'B2', 'G2'],
        },
    };

    const config = instrumentConfigs[instrument] || instrumentConfigs['5-string-banjo'];

    return {
        otf_version: '1.0',
        metadata: {
            title: options.title || 'Untitled',
            time_signature: options.timeSignature || '4/4',
            tempo: options.tempo || 120,
            composer: options.composer || '',
            key: options.key || '',
        },
        timing: {
            ticks_per_beat: 480,
        },
        tracks: [{
            id: config.id,
            instrument: instrument,
            tuning: config.tuning,
            capo: options.capo || 0,
            role: 'lead',
        }],
        notation: {
            [config.id]: [
                { measure: 1, events: [] },
                { measure: 2, events: [] },
                { measure: 3, events: [] },
                { measure: 4, events: [] },
            ],
        },
    };
}

/**
 * Add measures to OTF document
 * @param {Object} otf - OTF document
 * @param {string} trackId - Track ID
 * @param {number} count - Number of measures to add
 */
export function addMeasures(otf, trackId, count = 1) {
    const notation = otf.notation[trackId];
    if (!notation) return otf;

    const maxMeasure = notation.length > 0
        ? Math.max(...notation.map(m => m.measure))
        : 0;

    for (let i = 1; i <= count; i++) {
        notation.push({
            measure: maxMeasure + i,
            events: [],
        });
    }

    return otf;
}

/**
 * Remove empty trailing measures
 * @param {Object} otf - OTF document
 * @param {string} trackId - Track ID
 */
export function trimEmptyMeasures(otf, trackId) {
    const notation = otf.notation[trackId];
    if (!notation) return otf;

    // Keep at least 4 measures
    while (notation.length > 4) {
        const last = notation[notation.length - 1];
        if (last.events.length === 0) {
            notation.pop();
        } else {
            break;
        }
    }

    return otf;
}

/**
 * Quantize events to nearest grid position
 * @param {Object} otf - OTF document
 * @param {string} trackId - Track ID
 * @param {number} gridSize - Grid size in ticks
 */
export function quantize(otf, trackId, gridSize = DURATIONS.sixteenth) {
    const notation = otf.notation[trackId];
    if (!notation) return otf;

    for (const measure of notation) {
        for (const event of measure.events) {
            event.tick = Math.round(event.tick / gridSize) * gridSize;
        }

        // Remove duplicate events at same tick
        const tickMap = new Map();
        for (const event of measure.events) {
            if (!tickMap.has(event.tick)) {
                tickMap.set(event.tick, event);
            } else {
                // Merge notes
                const existing = tickMap.get(event.tick);
                for (const note of event.notes) {
                    const existingNote = existing.notes.find(n => n.s === note.s);
                    if (!existingNote) {
                        existing.notes.push(note);
                    }
                }
            }
        }

        measure.events = Array.from(tickMap.values()).sort((a, b) => a.tick - b.tick);
    }

    return otf;
}

/**
 * Transpose all notes by semitones
 * @param {Object} otf - OTF document
 * @param {number} semitones - Number of semitones to transpose
 */
export function transpose(otf, semitones) {
    for (const trackId in otf.notation) {
        const notation = otf.notation[trackId];
        for (const measure of notation) {
            for (const event of measure.events) {
                for (const note of event.notes) {
                    note.f = Math.max(0, note.f + semitones);
                }
            }
        }
    }
    return otf;
}

/**
 * Shift all notes in a range by tick offset
 * @param {Object} otf - OTF document
 * @param {string} trackId - Track ID
 * @param {number} startTick - Start tick (absolute)
 * @param {number} endTick - End tick (absolute)
 * @param {number} offset - Tick offset
 * @param {number} ticksPerMeasure - Ticks per measure
 */
export function shiftNotes(otf, trackId, startTick, endTick, offset, ticksPerMeasure) {
    const notation = otf.notation[trackId];
    if (!notation) return otf;

    // Collect events to move
    const eventsToMove = [];

    for (const measure of notation) {
        const newEvents = [];
        for (const event of measure.events) {
            const absTick = (measure.measure - 1) * ticksPerMeasure + event.tick;
            if (absTick >= startTick && absTick <= endTick) {
                eventsToMove.push({
                    event: JSON.parse(JSON.stringify(event)),
                    newAbsTick: absTick + offset,
                });
            } else {
                newEvents.push(event);
            }
        }
        measure.events = newEvents;
    }

    // Reinsert moved events at new positions
    for (const item of eventsToMove) {
        const newMeasure = Math.floor(item.newAbsTick / ticksPerMeasure) + 1;
        const newTick = item.newAbsTick % ticksPerMeasure;

        if (newMeasure < 1 || newTick < 0) continue;

        // Find or create measure
        let measure = notation.find(m => m.measure === newMeasure);
        if (!measure) {
            measure = { measure: newMeasure, events: [] };
            notation.push(measure);
            notation.sort((a, b) => a.measure - b.measure);
        }

        // Find or create event at tick
        let targetEvent = measure.events.find(e => e.tick === newTick);
        if (!targetEvent) {
            targetEvent = { tick: newTick, notes: [] };
            measure.events.push(targetEvent);
            measure.events.sort((a, b) => a.tick - b.tick);
        }

        // Merge notes
        for (const note of item.event.notes) {
            const existing = targetEvent.notes.find(n => n.s === note.s);
            if (existing) {
                Object.assign(existing, note);
            } else {
                targetEvent.notes.push(note);
            }
        }
    }

    return otf;
}

/**
 * Copy a range of notes
 * @param {Object} otf - OTF document
 * @param {string} trackId - Track ID
 * @param {number} startTick - Start tick (absolute)
 * @param {number} endTick - End tick (absolute)
 * @param {number} ticksPerMeasure - Ticks per measure
 */
export function copyRange(otf, trackId, startTick, endTick, ticksPerMeasure) {
    const notation = otf.notation[trackId];
    if (!notation) return [];

    const copied = [];

    for (const measure of notation) {
        for (const event of measure.events) {
            const absTick = (measure.measure - 1) * ticksPerMeasure + event.tick;
            if (absTick >= startTick && absTick <= endTick) {
                copied.push({
                    relativeTick: absTick - startTick,
                    notes: JSON.parse(JSON.stringify(event.notes)),
                });
            }
        }
    }

    return copied;
}

/**
 * Paste copied notes at position
 * @param {Object} otf - OTF document
 * @param {string} trackId - Track ID
 * @param {Array} copied - Copied notes from copyRange
 * @param {number} destTick - Destination tick (absolute)
 * @param {number} ticksPerMeasure - Ticks per measure
 */
export function pasteRange(otf, trackId, copied, destTick, ticksPerMeasure) {
    const notation = otf.notation[trackId];
    if (!notation || !copied || copied.length === 0) return otf;

    for (const item of copied) {
        const absTick = destTick + item.relativeTick;
        const measureNum = Math.floor(absTick / ticksPerMeasure) + 1;
        const tick = absTick % ticksPerMeasure;

        // Find or create measure
        let measure = notation.find(m => m.measure === measureNum);
        if (!measure) {
            measure = { measure: measureNum, events: [] };
            notation.push(measure);
            notation.sort((a, b) => a.measure - b.measure);
        }

        // Find or create event at tick
        let event = measure.events.find(e => e.tick === tick);
        if (!event) {
            event = { tick, notes: [] };
            measure.events.push(event);
            measure.events.sort((a, b) => a.tick - b.tick);
        }

        // Add notes
        for (const note of item.notes) {
            const existing = event.notes.find(n => n.s === note.s);
            if (existing) {
                Object.assign(existing, note);
            } else {
                event.notes.push(JSON.parse(JSON.stringify(note)));
            }
        }
    }

    return otf;
}

/**
 * Delete a range of notes
 * @param {Object} otf - OTF document
 * @param {string} trackId - Track ID
 * @param {number} startTick - Start tick (absolute)
 * @param {number} endTick - End tick (absolute)
 * @param {number} ticksPerMeasure - Ticks per measure
 */
export function deleteRange(otf, trackId, startTick, endTick, ticksPerMeasure) {
    const notation = otf.notation[trackId];
    if (!notation) return otf;

    for (const measure of notation) {
        measure.events = measure.events.filter(event => {
            const absTick = (measure.measure - 1) * ticksPerMeasure + event.tick;
            return absTick < startTick || absTick > endTick;
        });
    }

    return otf;
}

/**
 * Insert a standard roll pattern
 * @param {Object} state - Editor state
 * @param {string} rollType - Type of roll
 */
export function insertRoll(state, rollType) {
    const rollPatterns = {
        'forward': [
            { string: 5, fret: 0 },
            { string: 3, fret: 0 },
            { string: 2, fret: 0 },
            { string: 5, fret: 0 },
            { string: 3, fret: 0 },
            { string: 2, fret: 0 },
            { string: 5, fret: 0 },
            { string: 3, fret: 0 },
        ],
        'backward': [
            { string: 2, fret: 0 },
            { string: 3, fret: 0 },
            { string: 5, fret: 0 },
            { string: 2, fret: 0 },
            { string: 3, fret: 0 },
            { string: 5, fret: 0 },
            { string: 2, fret: 0 },
            { string: 3, fret: 0 },
        ],
        'alternating': [
            { string: 5, fret: 0 },
            { string: 3, fret: 0 },
            { string: 5, fret: 0 },
            { string: 2, fret: 0 },
            { string: 5, fret: 0 },
            { string: 3, fret: 0 },
            { string: 5, fret: 0 },
            { string: 1, fret: 0 },
        ],
        'foggy-mountain': [
            { string: 2, fret: 0 },
            { string: 3, fret: 0 },
            { string: 5, fret: 0 },
            { string: 3, fret: 0 },
            { string: 1, fret: 0 },
            { string: 5, fret: 0 },
            { string: 3, fret: 0 },
            { string: 1, fret: 0 },
        ],
    };

    const pattern = rollPatterns[rollType];
    if (!pattern) return;

    const duration = DURATIONS.eighth;

    for (const note of pattern) {
        state.insertNote(note.fret, { string: note.string });
        const cursor = state.cursor;
        const absTick = cursor.getAbsoluteTick(state.ticksPerMeasure) + duration;
        cursor.setFromAbsoluteTick(absTick, state.ticksPerMeasure);
    }
}

/**
 * Validate OTF document structure
 * @param {Object} otf - OTF document
 * @returns {Object} - Validation result with errors array
 */
export function validateOTF(otf) {
    const errors = [];

    if (!otf) {
        errors.push('OTF document is null or undefined');
        return { valid: false, errors };
    }

    if (otf.otf_version !== '1.0') {
        errors.push(`Unknown OTF version: ${otf.otf_version}`);
    }

    if (!otf.metadata) {
        errors.push('Missing metadata section');
    }

    if (!otf.timing) {
        errors.push('Missing timing section');
    } else if (!otf.timing.ticks_per_beat) {
        errors.push('Missing ticks_per_beat in timing');
    }

    if (!otf.tracks || otf.tracks.length === 0) {
        errors.push('No tracks defined');
    } else {
        for (const track of otf.tracks) {
            if (!track.id) {
                errors.push('Track missing id');
            }
            if (!track.tuning || track.tuning.length === 0) {
                errors.push(`Track ${track.id} missing tuning`);
            }
        }
    }

    if (!otf.notation) {
        errors.push('Missing notation section');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Clean up OTF document (remove empty events, sort, etc.)
 * @param {Object} otf - OTF document
 */
export function cleanupOTF(otf) {
    for (const trackId in otf.notation) {
        const notation = otf.notation[trackId];

        for (const measure of notation) {
            // Remove events with no notes
            measure.events = measure.events.filter(e => e.notes && e.notes.length > 0);

            // Sort events by tick
            measure.events.sort((a, b) => a.tick - b.tick);

            // Sort notes by string
            for (const event of measure.events) {
                event.notes.sort((a, b) => a.s - b.s);
            }
        }

        // Sort measures
        notation.sort((a, b) => a.measure - b.measure);
    }

    return otf;
}

/**
 * Download OTF as JSON file
 * @param {Object} otf - OTF document
 * @param {string} filename - Filename (without extension)
 */
export function downloadOTF(otf, filename = 'untitled') {
    const cleaned = cleanupOTF(JSON.parse(JSON.stringify(otf)));
    const json = JSON.stringify(cleaned, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.otf.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
