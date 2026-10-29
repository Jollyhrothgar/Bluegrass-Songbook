// What the .tef writer could not keep exactly (G15f), counted per save and shown
// next to the reader's "Not kept from this file" line (tef-skipped.js) in the
// Save as panel. Same shape as the importers' x_source.skipped: stable keys
// with counts, one label pair each.

/** key -> [singular, plural]; the order is the order readers see. */
export const NOTICE_LABELS = {
    notes_moved: ['note moved to the nearest 64th', 'notes moved to the nearest 64th'],
    notes_dropped: ['note that has no place in a .tef', 'notes that have no place in a .tef'],
    durations_rounded: ['note length rounded to one TablEdit has', 'note lengths rounded to ones TablEdit has'],
    effects_not_written: ['effect that does not fit', 'effects that do not fit'],
    techniques_not_written: ['hammer-on, pull-off, slide or bend not written', 'hammer-ons, pull-offs, slides and bends not written'],
    annotations_not_written: ['text note not written', 'text notes not written'],
    repeat_signs_not_written: ['repeat sign not written', 'repeat signs not written'],
    chord_diagrams_not_written: ['chord diagram not written', 'chord diagrams not written'],
    reading_list_names_truncated: ['reading-list name shortened to 27 letters', 'reading-list names shortened to 27 letters'],
    reading_list_entries_dropped: ['reading-list entry not written', 'reading-list entries not written'],
    text_changed: ['text shortened or changed to Latin-1', 'texts shortened or changed to Latin-1'],
    time_signatures_changed: ['unsupported time signature written as 4/4', 'unsupported time signatures written as 4/4'],
    track_details_changed: ['track name or role TablEdit cannot keep', 'track names or roles TablEdit cannot keep'],
    values_clamped: ['value outside TablEdit\'s range (tempo, capo)', 'values outside TablEdit\'s range (tempo, capo)'],
    key_not_written: ['key name not written', 'key names not written'],
};

/** A fresh counter object: every notice key present at 0. */
export function emptyNotices() {
    return Object.fromEntries(Object.keys(NOTICE_LABELS).map(k => [k, 0]));
}

/** "3 notes moved to the nearest 64th, 1 effect that does not fit" — '' when nothing changed. */
export function noticeSummary(notices) {
    if (!notices || typeof notices !== 'object') return '';
    const parts = [];
    for (const [key, [one, many]] of Object.entries(NOTICE_LABELS)) {
        const n = Number(notices[key]);
        if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
    }
    return parts.join(', ');
}

/** The full line: "Changed when saved as .tef: 3 notes moved to the nearest 64th." */
export function noticeLine(notices) {
    const summary = noticeSummary(notices);
    return summary ? `Changed when saved as .tef: ${summary}.` : '';
}
