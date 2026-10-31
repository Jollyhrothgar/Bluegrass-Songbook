// OTF notes -> TablEdit 3 component records (12 bytes each): the exact inverse
// of tef-import/otf.js. Every rule below names the importer rule it undoes.
//
//   0-3  location = 8 * (pos * totalRows + row); pos in 64ths of a whole note
//   4    type: fret + 1, | 0x40 when the note has a grace
//   5    duration code (bits 0-4) | level << 5 (level 7 = tie)
//   6    effect nibble; 1/2/3 = hammer/pull/slide ON THE SOURCE NOTE; 0x0f dead
//   7    grace: fret | kind << 5
//   8    attribute: low nibble 1 ring 2 slap 4 ghost 7 staccato; high nibble = second effect
//   10   fingering: 6 * pluck + (lh + 1)

import { decodeDurationCode, TRIPLET_DURATION_CODES } from '../tef-import/reader.js';
import {
    retimeTriplet, EFFECT_FX, ATTRIBUTE_FX, SECOND_FX, SECOND_DEAD, FX_ORDER, GRACE_KINDS,
    V3_PLUCK_LETTERS,
} from '../tef-import/otf.js';
import { DYN_LEVELS } from '../otf-editor/otf-validate.js';

export const UNIT_TICKS = 30;            // one 64th of a whole note at 480 ticks per beat
const MAX_TRANSITION_GAP = 32;           // computeArticulationsV3: source and destination within 32 units
const DEFAULT_LEVEL = DYN_LEVELS.indexOf('f');
const TIE_LEVEL = 7;

const invert = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [v, Number(k)]));
const PRIMARY = invert(EFFECT_FX);       // fx name -> byte 6 low nibble
const ATTRIBUTE = invert(ATTRIBUTE_FX);  // fx name -> byte 8 low nibble
const SECOND = invert(SECOND_FX);        // fx name -> byte 8 high nibble
const PLUCK = invert(V3_PLUCK_LETTERS);  // 'T' -> 1
const TRANSITION = { h: 1, p: 2, '/': 3, '\\': 3 };
const DEAD_NOTE = 0x0f;
const SECOND_ROLL = 3;                   // a second effect of 3 hides the attribute nibble (otf.js noteFx)

// --- durations -----------------------------------------------------------------
// Several codes decode to one tick count (480: 6 and 30; 30: 18, 21, 24, 27).
// TablEdit's own files use only the lowest of each (corpus: code 6 x23,062 and
// code 18 x726; 30, 21, 24 and 27 never), so the lowest code wins.
const CODE_BY_TICKS = new Map();
for (let code = 0; code < 32; code++) {
    const ticks = decodeDurationCode(code);
    if (!CODE_BY_TICKS.has(ticks)) CODE_BY_TICKS.set(ticks, code);
}
const ALL_TICKS = [...CODE_BY_TICKS.keys()];

/** [code, exact]: the duration code for `dur` ticks; the nearest length when TablEdit has none. */
export function durationCode(dur) {
    const exact = CODE_BY_TICKS.get(dur);
    if (exact !== undefined) return [exact, true];
    let best = ALL_TICKS[0];
    for (const t of ALL_TICKS) if (Math.abs(t - dur) < Math.abs(best - dur)) best = t;
    return [CODE_BY_TICKS.get(best), false];
}

// --- time ----------------------------------------------------------------------
/** The straight 64th for an OTF tick; tripletCode is the note's triplet duration code or null.
 *  Returns [unit, exact]. A triplet's position is stored straight and the importer
 *  stretches it (retimeTriplet), so search for the unit the importer maps back to `tick`. */
export function tickToUnit(tick, tripletCode, measureTicks) {
    const plain = Math.round(tick / UNIT_TICKS);
    if (tripletCode === null) return [plain, tick === plain * UNIT_TICKS];
    const span = 2 * (1920 >> Math.floor(tripletCode / 3));
    const stretched = tick - (tick % span) + Math.round((tick % span) * 0.75);
    let best = null;
    for (const centre of [plain, Math.round(stretched / UNIT_TICKS)]) {
        for (let u = Math.max(0, centre - 2); u <= centre + 2; u++) {
            const err = Math.abs(retimeTriplet(u * UNIT_TICKS, tripletCode, measureTicks) - tick);
            if (best === null || err < best.err) best = { u, err };
        }
    }
    return [best.u, best.err === 0];
}

// --- effects -------------------------------------------------------------------
/**
 * Place a note's effects in the three slots the importer reads and return
 * { primary, attr, second, dropped } (dropped = how many did not fit).
 * `transition` (1-3) and `dead` compete for the primary slot; the importer
 * unions all three slots, so the placement must decode to exactly the set.
 * When more are wanted than fit, the earliest in FX_ORDER are kept.
 */
export function placeEffects(fx, transition, dead) {
    const want = [...new Set(fx)].filter(f => FX_ORDER.includes(f));
    const primaryFixed = transition || (dead ? DEAD_NOTE : 0);
    const deadSecond = Boolean(transition && dead);
    // Options are tried primary first, then attribute, then second, so a tie
    // goes to the slot TablEdit itself uses for that effect.
    const primaryOpts = primaryFixed ? [null] : [...want.filter(f => f in PRIMARY), null];
    const attrOpts = [...want.filter(f => f in ATTRIBUTE), null];
    const secondOpts = deadSecond ? [null] : [...want.filter(f => f in SECOND), null];
    let best = null;
    for (const p of primaryOpts) for (const a of attrOpts) for (const s of secondOpts) {
        const used = [p, a, s].filter(Boolean);
        if (new Set(used).size !== used.length) continue;
        if (a && s && SECOND[s] === SECOND_ROLL) continue;   // roll as second effect hides the attribute
        const lost = want.filter(f => !used.includes(f));
        const cost = lost.length * 1000 + lost.reduce((n, f) => n + (FX_ORDER.length - FX_ORDER.indexOf(f)), 0);
        if (best === null || cost < best.cost) best = { p, a, s, cost, lost: lost.length };
    }
    return {
        primary: primaryFixed || (best.p ? PRIMARY[best.p] : 0),
        attr: best.a ? ATTRIBUTE[best.a] : 0,
        second: deadSecond ? SECOND_DEAD : (best.s ? SECOND[best.s] : 0),
        dropped: best.lost,
    };
}

// --- notes ---------------------------------------------------------------------
/**
 * Build the component cells for every note.
 * @param {object} otf
 * @param {{id, rowBase, strings, dyn}[]} tracks file tracks in order
 * @param {number[]} starts first 64th of each measure (index = measure - 1)
 * @param {number[]} slots length of each measure in 64ths
 * @param {number} totalRows strings over all tracks
 * @param {object} notices counters, mutated
 * @returns {{cells: Map<number, Uint8Array>, occupied: Set<number>}} cell key = pos * totalRows + row
 */
export function buildNoteCells(otf, tracks, starts, slots, totalRows, notices) {
    const cells = new Map();
    const occupied = new Set();
    const known = new Set(tracks.map(t => t.id));
    for (const [id, measures] of Object.entries(otf.notation || {})) {
        if (known.has(id)) continue;
        for (const m of measures) for (const e of m.events) notices.notes_dropped += e.notes.length;
    }

    for (const track of tracks) {
        const placed = [];
        for (const m of otf.notation?.[track.id] || []) {
            const mi = m.measure - 1;
            for (const e of m.events) {
                for (const note of e.notes) {
                    if (mi < 0 || mi >= starts.length || note.s < 1 || note.s > track.strings
                        || !(note.f >= 0 && note.f <= 24)) {
                        notices.notes_dropped += 1;
                        continue;
                    }
                    const [code, exact] = durationCode(note.dur ?? 480);
                    if (!exact) notices.durations_rounded += 1;
                    const tripletCode = TRIPLET_DURATION_CODES.has(code) ? code : null;
                    let [unit, onGrid] = tickToUnit(e.tick, tripletCode, slots[mi] * UNIT_TICKS);
                    if (unit >= slots[mi]) { unit = slots[mi] - 1; onGrid = false; }
                    if (!onGrid) notices.notes_moved += 1;
                    placed.push({ note, code, pos: starts[mi] + unit, row: track.rowBase + note.s - 1, string: note.s });
                }
            }
        }

        // Transitions: h/p/slide are stored on the SOURCE note (the one just before
        // on the same string, within 32 units); a bend target needs a bend source.
        const byString = new Map();
        for (const p of placed) {
            if (!byString.has(p.string)) byString.set(p.string, []);
            byString.get(p.string).push(p);
        }
        for (const list of byString.values()) {
            list.sort((a, b) => a.pos - b.pos);
            for (let i = 0; i < list.length; i++) {
                const dest = list[i];
                const tech = dest.note.tech;
                const source = i > 0 ? list[i - 1] : null;
                if (tech in TRANSITION) {
                    if (source && dest.pos - source.pos <= MAX_TRANSITION_GAP) {
                        source.transition = TRANSITION[tech];
                        if (tech === '\\') notices.techniques_not_written += 1;   // written as a plain slide
                    } else notices.techniques_not_written += 1;
                } else if (tech === 'b') {
                    const bends = source && source.pos !== dest.pos && source.note.f !== dest.note.f
                        && (source.note.fx || []).some(f => f === 'bend' || f === 'bend-release');
                    if (!bends) notices.techniques_not_written += 1;
                }
            }
        }

        for (const p of placed) {
            const { note } = p;
            const key = p.pos * totalRows + p.row;
            if (occupied.has(key)) { notices.notes_dropped += 1; continue; }
            occupied.add(key);

            const rec = new Uint8Array(12);
            new DataView(rec.buffer).setUint32(0, 8 * key, true);
            rec[4] = (note.f + 1) | (note.grace ? 0x40 : 0);
            const level = note.tie ? TIE_LEVEL
                : DYN_LEVELS.indexOf(note.dyn ?? track.dyn ?? 'f') >= 0
                    ? DYN_LEVELS.indexOf(note.dyn ?? track.dyn ?? 'f') : DEFAULT_LEVEL;
            rec[5] = p.code | (level << 5);

            const fx = placeEffects(note.fx || [], p.transition || 0, note.tech === 'x');
            notices.effects_not_written += fx.dropped;
            rec[6] = fx.primary;
            rec[8] = fx.attr | (fx.second << 4);
            if (note.grace) {
                const kind = Math.max(0, GRACE_KINDS.indexOf(note.grace.kind ?? null));
                rec[7] = (note.grace.f & 0x1f) | (kind << 5);
            }
            const pluck = PLUCK[note.finger] || 0;
            const lh = typeof note.lh === 'number' ? note.lh + 1 : 0;
            rec[10] = 6 * pluck + lh;
            cells.set(key, rec);
        }
    }
    return { cells, occupied };
}
