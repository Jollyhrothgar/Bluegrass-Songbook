// What a .tef held that the book does not keep (G15e), in TablEdit's own
// words. The importers write `x_source.skipped: {key: count}`; the take header
// (work-view.js) and G15f's Save as panel both show it through this one
// function. The keys, in this order, are also listed in the `x_source`
// description of docs/schema/otf.schema.json (a test keeps the two in step).

/** key -> [singular, plural]; the order is the order readers see. */
export const SKIPPED_LABELS = {
    tempo_changes: ['tempo change', 'tempo changes'],
    instrument_changes: ['instrument (MIDI) change', 'instrument (MIDI) changes'],
    scale_diagrams: ['scale diagram', 'scale diagrams'],
    accents: ['accent or crescendo mark', 'accent and crescendo marks'],
    slurs: ['slur or bracket', 'slurs and brackets'],
    picking_marks: ['picking mark not on a note', 'picking marks not on a note'],
    special_characters: ['special character or musical sign', 'special characters and musical signs'],
    percussion: ['percussion mark', 'percussion marks'],
    chord_diagrams: ['chord diagram', 'chord diagrams'],
    free_text: ['line of free text', 'lines of free text'],
    tapping: ['tapping amount', 'tapping amounts'],
    vibrato: ['vibrato amount', 'vibrato amounts'],
    tremolo_bar: ['tremolo-bar amount', 'tremolo-bar amounts'],
    other: ['other TablEdit marking', 'other TablEdit markings'],
};

/** "2 tempo changes, 1 line of free text" — '' when nothing was skipped. */
export function skippedSummary(skipped) {
    if (!skipped || typeof skipped !== 'object') return '';
    // A key this build has no words for is still something that was not kept.
    const counts = { ...skipped };
    for (const k of Object.keys(counts)) {
        if (!(k in SKIPPED_LABELS)) {
            counts.other = (counts.other || 0) + (Number(counts[k]) || 0);
            delete counts[k];
        }
    }
    const parts = [];
    for (const [key, [one, many]] of Object.entries(SKIPPED_LABELS)) {
        const n = Number(counts[key]);
        if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
    }
    return parts.join(', ');
}

/** The full line: "Not kept from this file: 2 tempo changes, 1 line of free text." */
export function skippedLine(skipped) {
    const summary = skippedSummary(skipped);
    return summary ? `Not kept from this file: ${summary}.` : '';
}
