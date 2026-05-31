/**
 * OTF → alphaTex converter
 *
 * Converts OpenTabFormat JSON to alphaTex markup for AlphaTab rendering.
 * This is the bridge code described in PLAN.md Phase 0.
 *
 * Key challenges:
 * - OTF uses absolute tick positions; alphaTex uses relative durations
 * - OTF techniques annotate the destination note; alphaTex annotates the origin
 * - OTF supports multi-track; alphaTex supports multi-track via \track directives
 * - Many bluegrass TEF sources use 2/4 time but intend 2/2 (cut time)
 */

// MIDI program numbers for instruments
const INSTRUMENT_MIDI = {
  '5-string-banjo': 105,  // Banjo
  '6-string-guitar': 25,  // Acoustic Guitar (steel)
  'mandolin': 25,          // Use guitar (closest GM sound)
  'upright-bass': 32,     // Acoustic Bass
  'tenor-banjo': 105,     // Banjo
  'dobro': 25,            // Use guitar
  'fiddle': 40,           // Violin
};

/**
 * Pass through time signature as-is from OTF.
 * No normalization - if the OTF says 2/4, we render 2/4.
 * Bugs in time signatures should be fixed in the TEF parser, not here.
 */
function normalizeTimeSignature(timeSignature) {
  return { displayTs: timeSignature, tickScale: 1 };
}

// Duration table: ticks → alphaTex duration value
// alphaTex durations: 1=whole, 2=half, 4=quarter, 8=eighth, 16=sixteenth, 32=thirty-second
function buildDurationTable(ticksPerBeat) {
  return [
    { ticks: ticksPerBeat * 4, value: 1, name: 'whole' },
    { ticks: ticksPerBeat * 3, value: 2, dotted: true, name: 'dotted half' },
    { ticks: ticksPerBeat * 2, value: 2, name: 'half' },
    { ticks: ticksPerBeat * 1.5, value: 4, dotted: true, name: 'dotted quarter' },
    { ticks: ticksPerBeat, value: 4, name: 'quarter' },
    { ticks: ticksPerBeat * 0.75, value: 8, dotted: true, name: 'dotted eighth' },
    { ticks: ticksPerBeat / 2, value: 8, name: 'eighth' },
    { ticks: ticksPerBeat / 3, value: 8, triplet: true, name: 'triplet eighth' },
    { ticks: ticksPerBeat / 4, value: 16, name: 'sixteenth' },
    { ticks: ticksPerBeat / 6, value: 16, triplet: true, name: 'triplet sixteenth' },
    { ticks: ticksPerBeat / 8, value: 32, name: 'thirty-second' },
  ];
}

/**
 * Find the best matching duration for a tick gap.
 */
function ticksToDuration(tickGap, ticksPerBeat) {
  if (tickGap <= 0) return { value: 16, name: 'zero-gap-fallback' };

  const table = buildDurationTable(ticksPerBeat);
  let best = null;
  let bestDiff = Infinity;

  for (const entry of table) {
    const diff = Math.abs(tickGap - entry.ticks);
    if (diff < bestDiff) {
      best = entry;
      bestDiff = diff;
    }
  }

  return best;
}

/**
 * Format a duration as alphaTex.
 */
function formatDuration(dur) {
  let s = `:${dur.value}`;
  if (dur.dotted) s += '{d}';
  return s;
}

/**
 * Convert an OTF event's notes to alphaTex notation.
 */
function formatNotes(notes, effects) {
  const effectStr = effects.length > 0 ? `{${effects.join(' ')}}` : '';

  if (notes.length === 1) {
    const n = notes[0];
    return `${n.f}.${n.s}${effectStr}`;
  }

  // Chord: multiple notes at same tick
  const noteStrs = notes.map(n => `${n.f}.${n.s}`);
  return `(${noteStrs.join(' ')})${effectStr}`;
}

/**
 * Map OTF technique to alphaTex effect on the ORIGIN note.
 */
function mapTechToOriginEffect(tech) {
  switch (tech) {
    case 'h': return 'h';
    case 'p': return 'h';
    case '/': return 'sl';
    case '~': return 't';
    default: return null;
  }
}

/**
 * Get the total ticks in a measure based on time signature and ticks_per_beat.
 * Uses the RAW OTF time signature (before normalization) since tick data is in OTF units.
 */
function getMeasureTicks(timeSignature, ticksPerBeat) {
  const [num, den] = timeSignature.split('/').map(Number);
  const ticksPerDenominator = (ticksPerBeat * 4) / den;
  return num * ticksPerDenominator;
}

/**
 * Convert a single track's measures to alphaTex beat notation.
 */
function convertTrackMeasures(measures, track, otf, options) {
  const rawTicksPerBeat = otf.timing.ticks_per_beat;
  const rawTimeSignature = otf.metadata.time_signature || '4/4';
  const totalMeasureTicks = getMeasureTicks(rawTimeSignature, rawTicksPerBeat);

  // Apply time signature normalization
  const { tickScale } = normalizeTimeSignature(rawTimeSignature);
  // When we normalize 2/4→2/2, we double the ticksPerBeat for duration calculation
  // This makes a 120-tick gap (was 16th in 2/4) become an 8th (in 2/2)
  const effectiveTicksPerBeat = rawTicksPerBeat * tickScale;

  // Find the max measure number across ALL tracks to keep them aligned
  const maxMeasure = options.maxMeasure ||
    measures.reduce((max, m) => Math.max(max, m.measure), 0);

  const barTexts = [];

  for (let mNum = 1; mNum <= maxMeasure; mNum++) {
    const measure = measures.find(m => m.measure === mNum);
    const beatParts = [];

    if (!measure || !measure.events || measure.events.length === 0) {
      // Empty measure: full rest
      const dur = ticksToDuration(totalMeasureTicks, effectiveTicksPerBeat);
      beatParts.push(`${formatDuration(dur)} r`);
    } else {
      const events = [...measure.events].sort((a, b) => a.tick - b.tick);

      // Pre-process: build technique lookback map
      const originEffects = new Map();
      for (let i = 1; i < events.length; i++) {
        const event = events[i];
        for (const note of event.notes) {
          if (note.tech) {
            const effect = mapTechToOriginEffect(note.tech);
            if (effect) {
              for (let j = i - 1; j >= 0; j--) {
                const prevNote = events[j].notes.find(n => n.s === note.s);
                if (prevNote) {
                  if (!originEffects.has(j)) originEffects.set(j, []);
                  originEffects.get(j).push(effect);
                  break;
                }
              }
            }
          }
        }
      }

      // Handle leading rest
      if (events[0].tick > 0) {
        const restDur = ticksToDuration(events[0].tick, effectiveTicksPerBeat);
        if (restDur) {
          beatParts.push(`${formatDuration(restDur)} r`);
        }
      }

      // Convert each event
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const nextTick = i + 1 < events.length
          ? events[i + 1].tick
          : totalMeasureTicks;
        const tickGap = nextTick - event.tick;
        const dur = ticksToDuration(tickGap, effectiveTicksPerBeat);

        if (!dur) continue;

        const effects = originEffects.get(i) || [];
        const parts = formatDuration(dur) + ' ' + formatNotes(event.notes, effects);
        beatParts.push(parts);
      }
    }

    barTexts.push(beatParts.join(' '));
  }

  return barTexts.join(' | ');
}

/**
 * Find the global max measure number across all tracks.
 */
function getMaxMeasure(otf) {
  let max = 0;
  for (const track of otf.tracks) {
    const measures = otf.notation[track.id];
    if (measures) {
      for (const m of measures) {
        if (m.measure > max) max = m.measure;
      }
    }
  }
  return max;
}

/**
 * Convert an OTF document to alphaTex markup.
 *
 * @param {object} otf - Parsed OTF JSON document
 * @param {object} [options] - Conversion options
 * @param {string} [options.staveProfile] - 'tabs', 'score', or 'score tabs' (default: 'score tabs')
 * @returns {string} alphaTex markup string
 */
export function otfToAlphaTex(otf, options = {}) {
  const parts = [];
  const staveProfile = options.staveProfile || 'score tabs';

  // Metadata
  const title = otf.metadata?.title?.trim();
  if (title) {
    parts.push(`\\title "${title}"`);
  }
  if (otf.metadata?.composer) {
    parts.push(`\\artist "${otf.metadata.composer}"`);
  }
  if (otf.metadata?.tempo) {
    parts.push(`\\tempo ${otf.metadata.tempo}`);
  }

  // Time signature normalization
  const rawTs = otf.metadata?.time_signature || '4/4';
  const { displayTs } = normalizeTimeSignature(rawTs);
  const [tsNum, tsDen] = displayTs.split('/');

  // For multi-track: find global max measure to keep all tracks aligned
  const maxMeasure = getMaxMeasure(otf);

  // Tracks
  for (const track of otf.tracks) {
    const trackName = track.id.charAt(0).toUpperCase() + track.id.slice(1);
    const instrument = INSTRUMENT_MIDI[track.instrument] ?? 25;

    parts.push(`\\track "${trackName}"`);
    parts.push(`\\instrument ${instrument}`);

    if (track.tuning && track.tuning.length > 0) {
      parts.push(`\\tuning ${track.tuning.join(' ')}`);
    }

    if (track.capo > 0) {
      parts.push(`\\capo ${track.capo}`);
    }

    // Staff profile: tabs only, score only, or both
    parts.push(`\\staff{${staveProfile}}`);

    // Time signature
    parts.push(`\\ts ${tsNum} ${tsDen}`);

    // Convert notation
    const measures = otf.notation[track.id];
    if (measures && measures.length > 0) {
      const notation = convertTrackMeasures(measures, track, otf, { maxMeasure });
      parts.push(notation);
    } else {
      // Empty track - fill with rests matching measure count
      const restBars = [];
      for (let i = 0; i < maxMeasure; i++) {
        restBars.push(':1 r');
      }
      parts.push(restBars.join(' | '));
    }
  }

  return parts.join('\n');
}

/**
 * Debug helper: log the alphaTex output.
 */
export function debugAlphaTex(otf) {
  const tex = otfToAlphaTex(otf);
  console.log('=== alphaTex output ===');
  console.log(tex);
  console.log('=== end ===');
  return tex;
}
