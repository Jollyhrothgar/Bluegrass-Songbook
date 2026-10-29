// Constructors for blank OTF documents (one track, or several).
//
// Pure data: no editor state, no DOM. Split out of actions.js so the song page
// can build a new take (create-tab.js → buildNewTab) without loading the editor
// state machine and its facade (~170 KB). actions.js re-exports both, so the
// editor and its tests keep importing them from there.

// The version to stamp. Not imported from otf-validate.js (OTF_VERSION): this
// module is reached from the song page's boot graph and that one is lazy.
// otf-validate.test.js asserts the two are equal.
const OTF_VERSION = '1.2';

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
        otf_version: OTF_VERSION,
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
 * One new track for an instrument preset: its tuning, `capo: 0`, and an id
 * that is not in `usedIds` (a second banjo is `banjo-2`). No notation: the
 * caller decides whether the track starts with empty bars or none.
 *
 * @param {string} instrument - a preset, e.g. '5-string-banjo'
 * @param {Iterable<string>} usedIds - ids already taken in the document
 * @param {string} role - 'lead' | 'rhythm' | ...
 */
export function makeTrack(instrument, usedIds = [], role = 'rhythm', name = null) {
    const used = new Set(usedIds);
    // `name`: an instrument that borrows another's stave (fiddle on the
    // mandolin's GDAE) keeps its own id and instrument, so the switcher, the
    // file and the player's voice all say what it is.
    const preset = createEmptyOTF(instrument).tracks[0];
    const track = name ? { ...preset, id: name, instrument: name } : preset;
    let id = track.id;
    let n = 2;
    while (used.has(id)) id = `${track.id}-${n++}`;
    return { ...track, id, role };
}

/**
 * Create an empty MULTI-track OTF (the "new tab" flow). Instruments are
 * data: any list of the known presets; duplicate instruments get
 * numbered ids (banjo, banjo-2).
 *
 * @param {Object} options
 * @param {string[]} options.instruments - e.g. ['5-string-banjo', '6-string-guitar']
 * @param {string} [options.title]
 * @param {string} [options.timeSignature]
 * @param {number} [options.tempo]
 * @param {number} [options.measures] - initial empty measures per track
 */
export function createMultiTrackOTF({
    instruments = ['5-string-banjo'],
    title = 'Untitled',
    timeSignature = '4/4',
    tempo = 120,
    measures = 16,
    key = '',
} = {}) {
    const base = createEmptyOTF(instruments[0] || '5-string-banjo',
        { title, timeSignature, tempo, key });
    base.tracks = [];
    base.notation = {};

    const used = new Set();
    for (const instrument of instruments) {
        const role = base.tracks.length === 0 ? 'lead' : 'rhythm';
        const track = makeTrack(instrument, used, role);
        used.add(track.id);
        base.tracks.push(track);
        const id = track.id;
        base.notation[id] = Array.from({ length: measures },
            (_, i) => ({ measure: i + 1, events: [] }));
    }
    return base;
}
