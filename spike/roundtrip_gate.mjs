// Spike: hand-entry feasibility gate.
//
// Question (Mike's go/no-go): can we reliably "hand enter" a tab and get OTF
// back out? If yes, the compare-loop is viable. If no, abandon the approach.
//
// Strategy: take a REAL parsed OTF, replay every note through the editor's
// state core (the same insertNote path a human/keyboard would drive), serialize
// back to OTF, and diff the musical content (measure, tick, string, fret, tech)
// against the parser's output. A high match rate proves the entry model can
// faithfully represent existing tabs; divergences are editor-side bug leads.
//
// Run: node spike/roundtrip_gate.mjs [path-to-parsed.otf.json]

import { EditorState } from '../docs/js/otf-editor/state.js';
import fs from 'node:fs';
import path from 'node:path';

function loadOtf(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Pick a single-track banjo file if none supplied (keeps the gate clean;
// multi-track track-switching is a separate concern).
function pickDefault() {
  const dir = 'sources/banjo-hangout/parsed';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.otf.json'));
  for (const f of files) {
    const o = loadOtf(path.join(dir, f));
    const tracks = Object.keys(o.notation || {});
    if (tracks.length === 1 && tracks[0] === 'banjo') {
      const n = o.notation.banjo.reduce((a, m) => a + m.events.length, 0);
      if (n >= 20 && n <= 400) return path.join(dir, f);
    }
  }
  return path.join(dir, files[0]);
}

// Canonical musical content: sorted list of "M:T:s:f:tech" over a track.
function canonicalize(notation) {
  const rows = [];
  for (const m of notation) {
    for (const ev of m.events) {
      for (const n of ev.notes) {
        rows.push(`${m.measure}:${ev.tick}:${n.s}:${n.f}:${n.tech || ''}`);
      }
    }
  }
  rows.sort();
  return rows;
}

// Build a flat, tick-sorted note stream from the parsed OTF for one track,
// inferring a duration per event from the gap to the next event.
function noteStream(notation, ticksPerMeasure) {
  const stream = [];
  for (const m of notation) {
    const evs = [...m.events].sort((a, b) => a.tick - b.tick);
    for (let i = 0; i < evs.length; i++) {
      const tick = evs[i].tick;
      const nextTick = i + 1 < evs.length ? evs[i + 1].tick : ticksPerMeasure;
      const dur = Math.max(1, Math.min(nextTick - tick, ticksPerMeasure - tick));
      for (const n of evs[i].notes) {
        stream.push({ measure: m.measure, tick, string: n.s, fret: n.f, tech: n.tech || null, dur });
      }
    }
  }
  return stream;
}

const target = process.argv[2] || pickDefault();
const parsed = loadOtf(target);
const trackId = Object.keys(parsed.notation)[0];
const parsedNotation = parsed.notation[trackId];
const tpb = parsed.timing?.ticks_per_beat || 480;
const beatsPerMeasure = parseInt((parsed.metadata?.time_signature || '4/4').split('/')[0], 10);
const ticksPerMeasure = tpb * beatsPerMeasure;

const instrument = parsed.tracks.find(t => t.id === trackId)?.instrument || '5-string-banjo';
const state = new EditorState({ instrument });
// Align the editor's active track id with the parsed track id.
state.trackId = trackId;
if (!state.otf.notation[trackId]) state.otf.notation[trackId] = [];
if (!state.otf.tracks.find(t => t.id === trackId)) {
  state.otf.tracks = [{ id: trackId, instrument }];
}
state.otf.metadata = { ...state.otf.metadata, time_signature: parsed.metadata?.time_signature || '4/4' };
state.otf.timing = { ticks_per_beat: tpb };

const stream = noteStream(parsedNotation, ticksPerMeasure);
let entered = 0;
for (const nt of stream) {
  state.cursor.measure = nt.measure;
  state.cursor.tick = nt.tick;
  state.cursor.string = nt.string;
  state.currentDuration = nt.dur;
  state.insertNote(nt.fret, { string: nt.string, duration: nt.dur, tech: nt.tech });
  entered++;
}

const A = canonicalize(parsedNotation);          // parser output
const B = canonicalize(state.otf.notation[trackId]); // editor after hand-entry
const setB = new Set(B);
const setA = new Set(A);
const missing = A.filter(r => !setB.has(r)); // in parser, editor failed to reproduce
const extra = B.filter(r => !setA.has(r));   // editor produced, parser didn't have
const matched = A.filter(r => setB.has(r)).length;

console.log('=== HAND-ENTRY FEASIBILITY GATE ===');
console.log('file:            ', target);
console.log('track:           ', trackId, '| instrument:', instrument, '| ts:', parsed.metadata?.time_signature, '| tpb:', tpb);
console.log('parser notes:    ', A.length);
console.log('notes entered:   ', entered);
console.log('matched:         ', matched, `(${(100 * matched / (A.length || 1)).toFixed(1)}%)`);
console.log('missing (parser has, entry lost): ', missing.length);
console.log('extra   (entry made up):          ', extra.length);
if (missing.length) console.log('  e.g. missing:', missing.slice(0, 8));
if (extra.length) console.log('  e.g. extra:  ', extra.slice(0, 8));
const verdict = missing.length === 0 && extra.length === 0
  ? 'PASS — editor round-trips this tab exactly. Hand-entry-as-data is viable.'
  : (matched / (A.length || 1) > 0.9
    ? 'MOSTLY — viable, with specific divergences to fix (see above).'
    : 'FAIL — entry model cannot represent this tab; investigate before proceeding.');
console.log('VERDICT:', verdict);
