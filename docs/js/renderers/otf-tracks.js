// Shared OTF track predicates.
//
// TablEdit files often carry a percussion (drum) track alongside the melodic
// ones. It is NOT pitched: its `tuning` is empty, a note's `s` is a drum-kit
// staff line rather than a string, and `f` is a hit variant rather than a
// fret. Running the usual `tuning[s - 1] + f` on one produces nonsense pitches
// (this is what made MandoTom2's arrangements play as "bizarre instrumental
// music"), and drawing it on a pitched stave produces a meaningless staff.
//
// The flag is structural, decoded from the TEF track record — do NOT sniff
// track names for it. TablEdit lets the name lie: the drum track in
// mandolin-hangout 2613 is literally named "Guitar Standard".

/**
 * True when an OTF track is percussion (not pitched).
 * @param {{percussion?: boolean, instrument?: string}} track
 * @returns {boolean}
 */
export function isPercussionTrack(track) {
    // `instrument` is the fallback for OTF documents serialized before the
    // `percussion` flag existed, and for hand-written files.
    return track?.percussion === true || track?.instrument === 'percussion';
}

/**
 * Tracks that can be rendered on a pitched stave and played back.
 * @param {Array} tracks - OTF document track list
 * @returns {Array}
 */
export function pitchedTracks(tracks) {
    return (tracks || []).filter(t => !isPercussionTrack(t));
}
