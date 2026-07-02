// Spike: parser-vs-editor-vs-ORACLE 3-way diff.
//
// Leg 1: parser OTF (reader.py/otf.py output) — sources/banjo-hangout/parsed/*.otf.json
// Leg 2: editor hand-entry replay (state.js insertNote) — same as roundtrip_gate.mjs
// Leg 3: ORACLE — TablEdit's own MusicXML export (spike/oracle/*.xml), the external truth.
//
// When legs disagree, the oracle arbitrates: a note missing from the parser but
// present in oracle+editor = PARSER bug; missing from editor but in parser+oracle
// = EDITOR bug; oracle-only = both pipelines drop it.
//
// Core comparison key: measure:tick:string:fret  (tech compared separately —
// the parser is known to drop techniques, we want that reported, not drowning
// the positional diff).
//
// Run: node spike/oracle_compare.mjs <parsed.otf.json> <oracle.xml>
//   or: node spike/oracle_compare.mjs            (defaults to 23398)

import { EditorState } from '../docs/js/otf-editor/state.js';
import fs from 'node:fs';

// ---------------------------------------------------------------- MusicXML leg
// Minimal streaming parse — TablEdit's MusicXML is flat and regular; we walk
// <measure>, tracking cumulative position via <duration>, <backup>, <forward>.
// <chord/> notes share the previous note's start. Grace notes: no duration.
export function oracleNotes(xmlPath, ticksPerBeat) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const divisions = parseInt((xml.match(/<divisions>(\d+)<\/divisions>/) || [, '240'])[1], 10);
  const scale = ticksPerBeat / divisions; // XML divisions -> OTF ticks
  const notes = [];
  const measureRe = /<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g;
  let m;
  while ((m = measureRe.exec(xml))) {
    const measure = parseInt(m[1], 10);
    const body = m[2];
    let pos = 0;        // in divisions
    let lastStart = 0;  // start of previous note (for <chord/>)
    const tokRe = /<(note|backup|forward)>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = tokRe.exec(body))) {
      const kind = t[1];
      const inner = t[2];
      const dur = parseInt((inner.match(/<duration>(\d+)<\/duration>/) || [, '0'])[1], 10);
      if (kind === 'backup') { pos -= dur; continue; }
      if (kind === 'forward') { pos += dur; continue; }
      const isRest = /<rest\s*\/>|<rest>/.test(inner);
      const isChord = /<chord\s*\/>/.test(inner);
      const start = isChord ? lastStart : pos;
      if (!isChord) { lastStart = pos; pos += dur; }
      if (isRest) continue;
      const sM = inner.match(/<string>(\d+)<\/string>/);
      const fM = inner.match(/<fret>(\d+)<\/fret>/);
      if (!sM || !fM) continue; // pitch-only note (shouldn't happen in TAB export)
      // OTF convention: technique lives on the TARGET note (the hammered/pulled-to
      // note), which in MusicXML is the type="stop" end of the pair.
      const tech = [];
      if (/<hammer-on[^>]*type="stop"/.test(inner)) tech.push('h');
      if (/<pull-off[^>]*type="stop"/.test(inner)) tech.push('p');
      if (/<slide[^>]*type="stop"|<glissando[^>]*type="stop"/.test(inner)) tech.push('s');
      if (/<bend>/.test(inner)) tech.push('b');
      notes.push({
        measure,
        tick: Math.round(start * scale),
        string: parseInt(sM[1], 10),
        fret: parseInt(fM[1], 10),
        tech: tech.join('') || null,
      });
    }
  }
  return notes;
}

// ---------------------------------------------------------------- OTF legs
function loadOtf(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function otfNotes(notation) {
  const rows = [];
  for (const m of notation) {
    for (const ev of m.events) {
      for (const n of ev.notes) {
        rows.push({ measure: m.measure, tick: ev.tick, string: n.s, fret: n.f, tech: n.tech || null });
      }
    }
  }
  return rows;
}

// Editor replay (same recipe as roundtrip_gate.mjs).
function editorNotes(parsed, trackId) {
  const notation = parsed.notation[trackId];
  const tpb = parsed.timing?.ticks_per_beat || 480;
  const beats = parseInt((parsed.metadata?.time_signature || '4/4').split('/')[0], 10);
  const tpm = tpb * beats;
  const instrument = parsed.tracks.find(t => t.id === trackId)?.instrument || '5-string-banjo';
  const state = new EditorState({ instrument });
  state.trackId = trackId;
  if (!state.otf.notation[trackId]) state.otf.notation[trackId] = [];
  if (!state.otf.tracks.find(t => t.id === trackId)) state.otf.tracks = [{ id: trackId, instrument }];
  state.otf.metadata = { ...state.otf.metadata, time_signature: parsed.metadata?.time_signature || '4/4' };
  state.otf.timing = { ticks_per_beat: tpb };
  for (const m of notation) {
    const evs = [...m.events].sort((a, b) => a.tick - b.tick);
    for (let i = 0; i < evs.length; i++) {
      const tick = evs[i].tick;
      const next = i + 1 < evs.length ? evs[i + 1].tick : tpm;
      const dur = Math.max(1, Math.min(next - tick, tpm - tick));
      for (const n of evs[i].notes) {
        state.cursor.measure = m.measure;
        state.cursor.tick = tick;
        state.cursor.string = n.s;
        state.currentDuration = dur;
        state.insertNote(n.f, { string: n.s, duration: dur, tech: n.tech || null });
      }
    }
  }
  return otfNotes(state.otf.notation[trackId]);
}

// ---------------------------------------------------------------- diff engine
const posKey = n => `${n.measure}:${n.tick}:${n.string}:${n.fret}`;

function threeWay(P, E, O) {
  const sets = { parser: new Set(P.map(posKey)), editor: new Set(E.map(posKey)), oracle: new Set(O.map(posKey)) };
  const all = new Set([...sets.parser, ...sets.editor, ...sets.oracle]);
  const buckets = {
    agree_all: [], parser_only: [], editor_only: [], oracle_only: [],
    missing_from_parser: [],  // oracle+editor have it -> PARSER bug
    missing_from_editor: [],  // oracle+parser have it -> EDITOR bug
    missing_from_oracle: [],  // parser+editor have it -> both invented, or oracle normalized it
  };
  for (const k of all) {
    const p = sets.parser.has(k), e = sets.editor.has(k), o = sets.oracle.has(k);
    if (p && e && o) buckets.agree_all.push(k);
    else if (p && !e && !o) buckets.parser_only.push(k);
    else if (!p && e && !o) buckets.editor_only.push(k);
    else if (!p && !e && o) buckets.oracle_only.push(k);
    else if (!p && e && o) buckets.missing_from_parser.push(k);
    else if (p && !e && o) buckets.missing_from_editor.push(k);
    else if (p && e && !o) buckets.missing_from_oracle.push(k);
  }
  return buckets;
}

function techReport(P, O) {
  // Compare techniques at positions where parser & oracle agree positionally.
  const pMap = new Map(P.map(n => [posKey(n), n.tech]));
  let oracleTechs = 0, parserTechs = 0, matches = 0, parserMissing = [];
  for (const n of O) {
    const k = posKey(n);
    if (!pMap.has(k)) continue;
    const pt = pMap.get(k);
    if (n.tech) oracleTechs++;
    if (pt) parserTechs++;
    if (n.tech && pt) matches++;
    if (n.tech && !pt) parserMissing.push(`${k} oracle:${n.tech}`);
  }
  return { oracleTechs, parserTechs, matches, parserMissing };
}

// ---------------------------------------------------------------- main
const otfPath = process.argv[2] || 'sources/banjo-hangout/parsed/23398_tef.otf.json';
const xmlPath = process.argv[3] || 'spike/oracle/23398.xml';

const parsed = loadOtf(otfPath);
const trackId = Object.keys(parsed.notation)[0];
const tpb = parsed.timing?.ticks_per_beat || 480;

const P = otfNotes(parsed.notation[trackId]);
const E = editorNotes(parsed, trackId);
const O = oracleNotes(xmlPath, tpb);

console.log('=== 3-WAY ORACLE DIFF ===');
console.log('parser OTF:', otfPath, `(${P.length} notes)`);
console.log('editor replay:', `(${E.length} notes)`);
console.log('oracle XML:', xmlPath, `(${O.length} notes)`);
const b = threeWay(P, E, O);
console.log('\nagreement (all three):', b.agree_all.length);
const show = (label, arr, verdict) => {
  if (!arr.length) return;
  console.log(`\n${label}: ${arr.length}  -> ${verdict}`);
  for (const k of arr.slice(0, 12)) console.log('   ', k);
  if (arr.length > 12) console.log('    …');
};
show('missing_from_parser (oracle+editor have it)', b.missing_from_parser, 'PARSER BUG');
show('missing_from_editor (oracle+parser have it)', b.missing_from_editor, 'EDITOR BUG');
show('missing_from_oracle (parser+editor have it)', b.missing_from_oracle, 'both pipelines vs oracle — check tick/string conventions');
show('parser_only', b.parser_only, 'parser hallucination?');
show('editor_only', b.editor_only, 'editor hallucination?');
show('oracle_only', b.oracle_only, 'BOTH pipelines drop this note');

const tr = techReport(P, O);
console.log('\n--- technique coverage (at positionally-agreed notes) ---');
console.log(`oracle has tech on ${tr.oracleTechs} notes; parser has tech on ${tr.parserTechs}; both: ${tr.matches}`);
if (tr.parserMissing.length) {
  console.log('parser drops techniques at:');
  for (const s of tr.parserMissing.slice(0, 12)) console.log('   ', s);
}
