// BountyView - Bounty page: the wanted list of missing jam standards +
// placeholder works + part-level bounties.
// Data sources: (1) docs/data/wanted_songs.json — canonical jam repertoire
// the songbook is missing (from the cover-coverage gap analysis), (2)
// placeholder works needing everything, (3) Supabase bounties on works.

import { allSongs, bountyIndex, getBountyWorkCount } from './state.js';
import { isPlaceholder, escapeHtml, escapeAttr, requireLogin } from './utils.js';
import { formatTagName, getInstrumentTags } from './tags.js';
import { songHasContent, songHasAbc } from './song-content.js';
import { openAddSongPicker } from './add-song-picker.js';
import { buildTitleIndex, normalizeTitle } from './title-match.js';

// The wanted list (fetched once; null = not loaded yet)
let wantedSongs = null;
let wantedFetchStarted = false;

// Adjudicated verdicts from curation/bounty_decisions.yaml, lowered to JSON by
// scripts/lib/bounty_decisions.py. `{}` while loading or if the file is absent —
// the board then renders unfiltered, exactly as it did before this existed.
let decisions = { covered: {}, not_a_song: [], types: {} };
let showAllWantedVocals = false;
let showAllPartGaps = false;
let showAllChordGaps = false;

const WANTED_VOCAL_PREVIEW = 24;
const PART_GAP_PREVIEW = 24;

const INSTRUMENTAL_TYPES = new Set(['Fiddle Tune', 'Instrumental', 'Old-Time']);

function tagNames(song) {
    const t = song.tags;
    if (!t) return [];
    return Array.isArray(t) ? t : Object.keys(t);
}

/**
 * Instruments a song already covers (ABC counts as fiddle). Derived by
 * tags.js so the bounty page and the Instrument facet agree about what
 * "has a banjo part" means.
 */
const CORE_INSTRUMENTS = ['banjo', 'guitar', 'mandolin', 'fiddle', 'dobro', 'bass'];
function instrumentsCovered(song) {
    return new Set(getInstrumentTags(song).filter(t => CORE_INSTRUMENTS.includes(t)));
}

/**
 * Songs ON the book with partial instrument coverage — e.g. Black Mountain
 * Rag has fiddle notation but no banjo/mandolin/guitar tab. Computed from
 * the index: searchable instrumental repertoire missing any of the core
 * jam instruments.
 */
function computePartGaps() {
    const gaps = [];
    for (const song of allSongs) {
        if (song.indexed === false || isPlaceholder(song)) continue;
        const isInstrumental = songHasAbc(song) || song.tablature_parts?.length ||
            tagNames(song).includes('Instrumental');
        if (!isInstrumental) continue;
        const have = instrumentsCovered(song);
        const wants = ['fiddle', 'banjo', 'mandolin', 'guitar'].filter(i => !have.has(i));
        if (!wants.length) continue;
        gaps.push({ song, have: [...have], wants });
    }
    gaps.sort((a, b) => (b.song.canonical_rank || 0) - (a.song.canonical_rank || 0) ||
        String(a.song.title).localeCompare(String(b.song.title)));
    return gaps;
}

function describeHave(song, have) {
    const bits = [];
    if (songHasContent(song)) bits.push('chords');
    if (songHasAbc(song)) bits.push('fiddle notation');
    for (const i of have) {
        if (i !== 'fiddle') bits.push(`${INSTRUMENT_LABELS[i] || i} tab`);
    }
    return bits.join(', ');
}

/**
 * Songs on the book that are lyrics-only — content but zero chords
 * (mostly the BluegrassLyrics import). chord_count comes from the index,
 * so this is exact and cheap; subtler partial-chord cases live in the
 * offline chord-gaps report, not here.
 */
function computeChordGaps() {
    const gaps = allSongs.filter(song =>
        song.indexed !== false && !isPlaceholder(song) &&
        songHasContent(song) && song.lyrics?.trim() && !(song.chord_count > 0));
    gaps.sort((a, b) => (b.canonical_rank || 0) - (a.canonical_rank || 0) ||
        String(a.title).localeCompare(String(b.title)));
    return gaps;
}

/**
 * Split the wanted list into what the board should still advertise and what it
 * shouldn't, using the adjudicated verdicts plus a live re-check against the
 * corpus.
 *
 * Two sources, in order:
 *   1. `bounty_decisions.json` — the human calls. Covers the alias cases no
 *      algorithm gets right ("Can the Circle" is "Will the Circle").
 *   2. An exact/token-set match against `allSongs` at render time. This is what
 *      keeps the page honest between builds: a contribution landing in
 *      `pending_songs` is in `allSongs` before any generator has run again.
 *
 * A covered entry whose work is lyrics-only is dropped from "missing" rather
 * than deleted outright — `computeChordGaps()` already lists that same work
 * under "Needs Chords", which is where it belongs. Advertising it in both
 * places is the double-count this whole pass exists to fix.
 */
export function partitionWanted(wanted, songs, verdicts = decisions) {
    const covered = verdicts.covered || {};
    const junk = new Set(verdicts.not_a_song || []);
    const types = verdicts.types || {};
    const byTitle = buildTitleIndex(songs);

    const missing = [];
    const stats = { adjudicated: 0, junk: 0, lyricsOnly: 0, liveMatch: 0, started: 0 };

    for (const entry of wanted) {
        const title = entry.title;

        if (junk.has(title)) { stats.junk++; continue; }

        const verdict = covered[title];
        if (verdict) {
            stats.adjudicated++;
            if (!verdict.chords) stats.lyricsOnly++;
            continue;
        }

        // Self-healing pass: only the tiers that are safe without a human.
        const hits = byTitle.get(normalizeTitle(title)) || [];
        if (hits.length) {
            // A placeholder is still a bounty, but the "Started — Needs
            // Content" section below already asks for it. Listing the same
            // song in both places is the double-count this page exists to fix.
            if (hits.every(isPlaceholder)) {
                stats.started++;
                continue;
            }
            stats.liveMatch++;
            if (!hits.some(s => s.chord_count > 0)) stats.lyricsOnly++;
            continue;
        }

        const corrected = types[title];
        missing.push(corrected && corrected !== entry.type
            ? { ...entry, type: corrected }
            : entry);
    }

    return { missing, stats };
}

function chordGapCard(song) {
    return `
        <a href="#work/${escapeHtml(song.id)}" class="bounty-card partgap-card">
            <div class="bounty-card-title">${escapeHtml(song.title)}</div>
            ${song.artist ? `<div class="bounty-card-artist">${escapeHtml(song.artist)}</div>` : ''}
            <div class="bounty-card-has">Has: lyrics</div>
            <div class="wanted-chips"><span class="wanted-chip">Chords</span></div>
        </a>
    `;
}

function partGapCard({ song, have, wants }) {
    const chips = wants.map(i =>
        `<span class="wanted-chip">${escapeHtml(INSTRUMENT_LABELS[i] || i)}</span>`).join('');
    const haveDesc = describeHave(song, have);
    return `
        <a href="#work/${escapeHtml(song.id)}" class="bounty-card partgap-card">
            <div class="bounty-card-title">${escapeHtml(song.title)}</div>
            ${haveDesc ? `<div class="bounty-card-has">Has: ${escapeHtml(haveDesc)}</div>` : ''}
            <div class="wanted-chips">${chips}</div>
        </a>
    `;
}

const PART_TYPE_LABELS = {
    'lead-sheet': 'Lyrics & Chords',
    'tablature': 'Tab',
    'abc-notation': 'ABC Notation',
    'document': 'PDF/Document',
};

const INSTRUMENT_LABELS = {
    'banjo': 'Banjo',
    'guitar': 'Guitar',
    'fiddle': 'Fiddle',
    'mandolin': 'Mandolin',
    'dobro': 'Dobro',
    'bass': 'Bass',
};

const FILTER_OPTIONS = [
    { key: 'all', label: 'All', hint: '' },
    { key: 'lead-sheet', label: 'Lyrics & Chords', hint: 'Lyrics with chord symbols above the words' },
    { key: 'tablature', label: 'Tabs', hint: 'Tablature for any instrument (banjo, guitar, fiddle, etc.)' },
    { key: 'abc-notation', label: 'ABC Notation', hint: 'Machine-readable notation for fiddle tunes and instrumentals' },
    { key: 'document', label: 'Documents', hint: 'PDFs, scans, or other reference material' },
];

let currentFilter = 'all';

/**
 * Format a bounty's part type + instrument into a readable label.
 */
function formatBountyLabel(bounty) {
    if (bounty.part_type === 'tablature' && bounty.instrument) {
        return `${INSTRUMENT_LABELS[bounty.instrument] || bounty.instrument} Tab`;
    }
    return PART_TYPE_LABELS[bounty.part_type] || bounty.part_type;
}

/**
 * Describe what parts a work already has.
 */
function describeExistingParts(song) {
    const parts = [];
    if (songHasContent(song)) parts.push('Lyrics & chords');
    if (songHasAbc(song)) parts.push('ABC notation');
    if (song.tablature_parts?.length) {
        for (const tab of song.tablature_parts) {
            const inst = INSTRUMENT_LABELS[tab.instrument] || tab.instrument || 'tab';
            parts.push(`${inst} tab`);
        }
    }
    if (song.document_parts?.length) {
        parts.push(`${song.document_parts.length} PDF${song.document_parts.length > 1 ? 's' : ''}`);
    }
    return parts;
}

/**
 * Check if a bounty matches the current filter.
 */
function matchesFilter(bounty) {
    if (currentFilter === 'all') return true;
    return bounty.part_type === currentFilter;
}

/**
 * Infer what type of content a placeholder work needs based on its tags.
 * Returns an array of needed part types, e.g. ['tablature'] or ['lead-sheet'].
 */
function inferNeededTypes(song) {
    const tags = song.tags || {};
    const isInstrumental = 'Instrumental' in tags;
    const hasFiddleTag = 'Fiddle' in tags;

    const needs = [];
    if (isInstrumental) {
        needs.push('tablature');
        if (hasFiddleTag) needs.push('abc-notation');
    } else {
        needs.push('lead-sheet');
    }
    return needs;
}

/**
 * Get a human-readable label for what a placeholder needs.
 */
function formatNeededLabel(song) {
    const tags = song.tags || {};
    const isInstrumental = 'Instrumental' in tags;
    if (!isInstrumental) return 'Needs lyrics & chords';
    const hasFiddleTag = 'Fiddle' in tags;
    const hasBanjoTag = 'Banjo' in tags;
    if (hasFiddleTag) return 'Needs fiddle tab / ABC notation';
    if (hasBanjoTag) return 'Needs banjo tab';
    return 'Needs tablature';
}

/**
 * Get the hint text for the current filter.
 */
function getCurrentFilterHint() {
    const opt = FILTER_OPTIONS.find(o => o.key === currentFilter);
    return opt?.hint || '';
}

/**
 * One wanted-list card. Clicking opens the contribute flow prefilled.
 */
function wantedCard(song) {
    const meta = [];
    if (song.key) meta.push(`Key of ${song.key}`);
    if (song.difficulty) meta.push(song.difficulty);
    if (song.coverage) meta.push(`${song.coverage} bluegrass recordings`);
    const chips = (song.instruments || []).map(i =>
        `<span class="wanted-chip">${escapeHtml(INSTRUMENT_LABELS[i] || i)}</span>`).join('');
    return `
        <button class="bounty-card wanted-card" data-wanted-title="${escapeAttr(song.title)}"
                data-wanted-key="${escapeAttr(song.key || '')}">
            <div class="bounty-card-title">${escapeHtml(song.title)}
                ${song.core ? '<span class="core-badge" title="Core jam repertoire">Core</span>' : ''}</div>
            <div class="bounty-card-artist">${escapeHtml(meta.join(' · '))}</div>
            ${song.artists?.length ? `<div class="bounty-card-notes">as cut by ${escapeHtml(song.artists.slice(0, 3).join(', '))}</div>` : ''}
            ${chips ? `<div class="wanted-chips">${chips}</div>` : ''}
        </button>
    `;
}

function wantedSection(title, songs, { collapsible = false } = {}) {
    if (!songs.length) return '';
    const visible = collapsible && !showAllWantedVocals
        ? songs.slice(0, WANTED_VOCAL_PREVIEW) : songs;
    const moreCount = songs.length - visible.length;
    return `
        <div class="bounty-section">
            <h3 class="bounty-section-title">${escapeHtml(title)}
                <span class="bounty-group-count">(${songs.length})</span></h3>
            <div class="bounty-grid">${visible.map(wantedCard).join('')}</div>
            ${moreCount > 0 ? `<button class="bounty-show-more" id="wanted-show-more">Show all ${songs.length}</button>` : ''}
        </div>
    `;
}

/**
 * Render the bounty view.
 */
export function renderBountyView(container) {
    // Lazy-load the wanted list, then re-render once it lands
    if (!wantedFetchStarted) {
        wantedFetchStarted = true;
        Promise.all([
            fetch('data/wanted_songs.json', { cache: 'no-cache' })
                .then(r => r.json()).then(d => d.songs || []),
            // A missing decisions file is not an error — the board renders
            // unfiltered rather than blank.
            fetch('data/bounty_decisions.json', { cache: 'no-cache' })
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null),
        ]).then(([songs, verdicts]) => {
            wantedSongs = songs;
            if (verdicts) decisions = verdicts;
            if (container.isConnected) renderBountyView(container);
        }).catch(() => { wantedSongs = []; });
    }

    const placeholders = allSongs.filter(isPlaceholder);

    // Collect bounties with their associated song data
    const bountyEntries = [];
    for (const [workId, bounties] of Object.entries(bountyIndex)) {
        const song = allSongs.find(s => s.id === workId);
        if (!song || isPlaceholder(song)) continue; // Skip placeholders (shown separately)
        for (const bounty of bounties) {
            bountyEntries.push({ bounty, song });
        }
    }

    // Apply filter to bounties
    const filteredBounties = currentFilter === 'all'
        ? bountyEntries
        : bountyEntries.filter(({ bounty }) => matchesFilter(bounty));

    // Filter placeholders based on inferred needed types
    const filteredPlaceholders = currentFilter === 'all'
        ? placeholders
        : placeholders.filter(song => inferNeededTypes(song).includes(currentFilter));

    // Sort placeholders alphabetically
    filteredPlaceholders.sort((a, b) => a.title.localeCompare(b.title));

    // Sort bounty entries alphabetically by song title
    filteredBounties.sort((a, b) => a.song.title.localeCompare(b.song.title));

    // Total counts
    const totalItems = filteredPlaceholders.length + filteredBounties.length;
    const filterHint = getCurrentFilterHint();

    // The wanted list: Core jam standards lead (the 82 must-haves, every
    // type mixed, coverage-sorted), then the rest by type — instrumentals
    // next (tabs wanted for fiddle/banjo/mandolin/guitar), gospel, and
    // the long tail of vocals behind a preview.
    const { missing: wanted, stats: wantedStats } = partitionWanted(wantedSongs || [], allSongs);
    const wantedCore = wanted.filter(s => s.core);
    const rest = wanted.filter(s => !s.core);
    const wantedInstrumentals = rest.filter(s => INSTRUMENTAL_TYPES.has(s.type));
    const wantedGospel = rest.filter(s => s.type === 'Gospel');
    const wantedVocals = rest.filter(s => s.type === 'Vocal');

    const wantedHtml = wanted.length ? `
        <div class="bounty-section wanted-block">
            <h2 class="bounty-section-title">Missing Jam Standards
                <span class="bounty-group-count">(${wanted.length})</span></h2>
            <p class="bounty-filter-hint">Canonical repertoire — heavily recorded across bluegrass
                generations — that the book doesn't have yet. Tap one to contribute it.
                ${wantedStats.adjudicated + wantedStats.liveMatch + wantedStats.junk > 0 ? `
                <span class="bounty-hint-aside">${wantedStats.adjudicated + wantedStats.liveMatch}
                    ${wantedStats.adjudicated + wantedStats.liveMatch === 1 ? 'entry' : 'entries'}
                    hidden — we already have ${wantedStats.adjudicated + wantedStats.liveMatch === 1 ? 'it' : 'them'}${
                        wantedStats.lyricsOnly ? `, ${wantedStats.lyricsOnly} as lyrics only (see Needs Chords below)` : ''}.</span>` : ''}</p>
            ${wantedSection('Core Jam Standards — the must-haves', wantedCore)}
            ${wantedSection('More Fiddle Tunes & Instrumentals', wantedInstrumentals)}
            ${wantedSection('More Gospel', wantedGospel)}
            ${wantedSection('More Songs', wantedVocals, { collapsible: true })}
        </div>
    ` : (wantedSongs === null ? '<div class="bounty-section"><p class="bounty-filter-hint">Loading wanted list…</p></div>' : '');

    // Songs on the book missing instrument coverage (tab/notation gaps)
    const partGaps = computePartGaps();
    const gapVisible = showAllPartGaps ? partGaps : partGaps.slice(0, PART_GAP_PREVIEW);
    const partGapsHtml = partGaps.length ? `
        <div class="bounty-section wanted-block">
            <h2 class="bounty-section-title">On the Book — Needs More Instruments
                <span class="bounty-group-count">(${partGaps.length})</span></h2>
            <p class="bounty-filter-hint">Tunes we have, but not for every instrument — e.g. fiddle
                notation with no banjo, mandolin, or guitar tab. Tap one to open it and add a part.</p>
            <div class="bounty-grid">${gapVisible.map(partGapCard).join('')}</div>
            ${partGaps.length > gapVisible.length ? `<button class="bounty-show-more" id="partgap-show-more">Show all ${partGaps.length}</button>` : ''}
        </div>
    ` : '';

    // Lyrics-only songs wanting chords
    const chordGaps = computeChordGaps();
    const chordVisible = showAllChordGaps ? chordGaps : chordGaps.slice(0, PART_GAP_PREVIEW);
    const chordGapsHtml = chordGaps.length ? `
        <div class="bounty-section wanted-block">
            <h2 class="bounty-section-title">On the Book — Needs Chords
                <span class="bounty-group-count">(${chordGaps.length})</span></h2>
            <p class="bounty-filter-hint">Songs we have the words for but not the changes.
                Know how it goes? Tap one and hit Edit.</p>
            <div class="bounty-grid">${chordVisible.map(chordGapCard).join('')}</div>
            ${chordGaps.length > chordVisible.length ? `<button class="bounty-show-more" id="chordgap-show-more">Show all ${chordGaps.length}</button>` : ''}
        </div>
    ` : '';

    container.innerHTML = `
        <div class="bounty-view">
            <div class="bounty-header">
                <h1 class="bounty-title">Bounty Board</h1>
                <p class="bounty-subtitle">Songs and parts the community is looking for. Know one? Help us out!</p>
                <p class="bounty-stats">${wanted.length} missing standards · ${filteredPlaceholders.length} started pages · ${filteredBounties.length} part requests</p>
                <!-- The bounty board is the contributor hub, so the board of
                     who has actually filled these in belongs next to it. A
                     plain hash link is enough: main.js routes #high-scores on
                     hashchange. -->
                <p class="bounty-stats"><a class="bounty-high-scores-link" href="#high-scores">🏆 High scores</a></p>
            </div>

            ${wantedHtml}

            ${partGapsHtml}

            ${chordGapsHtml}

            <div class="bounty-filters" id="bounty-filters">
                ${FILTER_OPTIONS.map(opt => `
                    <button class="bounty-filter-btn${currentFilter === opt.key ? ' active' : ''}" data-filter="${opt.key}">
                        ${opt.label}
                    </button>
                `).join('')}
            </div>
            ${filterHint ? `<p class="bounty-filter-hint">${filterHint}</p>` : ''}

            ${filteredPlaceholders.length > 0 ? `
                <div class="bounty-section">
                    <h2 class="bounty-section-title">Started — Needs Content <span class="bounty-group-count">(${filteredPlaceholders.length})</span></h2>
                    <div class="bounty-grid">
                        ${filteredPlaceholders.map(song => `
                            <a href="#work/${song.id}" class="bounty-card bounty-card-placeholder">
                                <div class="bounty-card-wanted">${escapeHtml(formatNeededLabel(song))}</div>
                                <div class="bounty-card-title">${escapeHtml(song.title)}</div>
                                ${song.artist ? `<div class="bounty-card-artist">${escapeHtml(song.artist)}</div>` : ''}
                                ${song.notes ? `<div class="bounty-card-notes">${escapeHtml(song.notes.slice(0, 80))}${song.notes.length > 80 ? '...' : ''}</div>` : ''}
                                ${song.document_parts?.length ? '<span class="doc-badge">PDF</span>' : ''}
                            </a>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${filteredBounties.length > 0 ? `
                <div class="bounty-section">
                    <h2 class="bounty-section-title">Wanted Parts <span class="bounty-group-count">(${filteredBounties.length})</span></h2>
                    <div class="bounty-grid">
                        ${filteredBounties.map(({ bounty, song }) => {
                            const existingParts = describeExistingParts(song);
                            return `
                                <a href="#work/${song.id}" class="bounty-card bounty-card-part">
                                    <div class="bounty-card-wanted">${escapeHtml(formatBountyLabel(bounty))}</div>
                                    <div class="bounty-card-title">${escapeHtml(song.title)}</div>
                                    ${song.artist ? `<div class="bounty-card-artist">${escapeHtml(song.artist)}</div>` : ''}
                                    ${existingParts.length > 0 ? `<div class="bounty-card-has">Has: ${escapeHtml(existingParts.join(', '))}</div>` : ''}
                                    ${bounty.description ? `<div class="bounty-card-notes">${escapeHtml(bounty.description.slice(0, 80))}${bounty.description.length > 80 ? '...' : ''}</div>` : ''}
                                </a>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : ''}

            ${totalItems === 0 ? `
                <div class="bounty-empty">
                    <p>No one has requested this type yet.</p>
                    <p class="bounty-empty-sub">Be the first! Click "Request a Part" below, or try "All" to see songs needing everything.</p>
                </div>
            ` : ''}

            <div class="bounty-cta">
                <p>Can't find what you're looking for?</p>
                <div class="bounty-cta-actions">
                    <button class="bounty-cta-btn" id="bounty-request-song-btn">Request a Song</button>
                    <button class="bounty-cta-btn bounty-cta-btn-secondary" id="bounty-request-part-btn">Request a Part</button>
                </div>
            </div>
        </div>
    `;

    // Wire up filter buttons
    container.querySelectorAll('.bounty-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            renderBountyView(container);
        });
    });

    // Wire up CTA buttons
    // Requesting a song needs no account (Phase 2a). Requesting a PART
    // (below) still does — bounties are Supabase rows keyed to auth.uid().
    container.querySelector('#bounty-request-song-btn')?.addEventListener('click', () => {
        openAddSongPicker({ mode: 'request' });
    });

    // Wanted-list cards open the contribute flow prefilled with the song
    container.querySelectorAll('.wanted-card').forEach(card => {
        card.addEventListener('click', () => {
            openAddSongPicker({
                mode: 'contribute',
                title: card.dataset.wantedTitle,
                key: card.dataset.wantedKey || undefined,
            });
        });
    });

    container.querySelector('#wanted-show-more')?.addEventListener('click', () => {
        showAllWantedVocals = true;
        renderBountyView(container);
    });

    container.querySelector('#partgap-show-more')?.addEventListener('click', () => {
        showAllPartGaps = true;
        renderBountyView(container);
    });

    container.querySelector('#chordgap-show-more')?.addEventListener('click', () => {
        showAllChordGaps = true;
        renderBountyView(container);
    });

    container.querySelector('#bounty-request-part-btn')?.addEventListener('click', () => {
        if (!requireLogin('request parts')) return;
        openBountyRequestModal(container);
    });
}

/**
 * Open a modal to request a specific part for an existing work.
 * Search for the work, pick a part type, optionally add description.
 */
function openBountyRequestModal(container) {
    // Remove existing modal if present
    document.getElementById('bounty-request-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'bounty-request-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content bounty-request-content">
            <div class="modal-header">
                <h2>Request a Part</h2>
                <button class="modal-close" id="bounty-request-close">&times;</button>
            </div>
            <div class="modal-body">
                <p class="bounty-req-description">Search for a song, then tell us what you need.</p>

                <div class="bounty-req-step" id="bounty-req-step-search">
                    <label for="bounty-req-search">Song name</label>
                    <input type="text" id="bounty-req-search" placeholder="Search for a song..." autocomplete="off" />
                    <div class="bounty-req-results" id="bounty-req-results"></div>
                </div>

                <div class="bounty-req-step hidden" id="bounty-req-step-details">
                    <div class="bounty-req-selected" id="bounty-req-selected"></div>

                    <label for="bounty-req-part-type">What do you need?</label>
                    <select id="bounty-req-part-type">
                        <option value="lead-sheet">Lyrics & Chords</option>
                        <option value="tablature">Tablature</option>
                        <option value="abc-notation">ABC Notation (fiddle tunes)</option>
                        <option value="document">PDF / Document</option>
                    </select>

                    <div class="bounty-req-instrument-row hidden" id="bounty-req-instrument-row">
                        <label for="bounty-req-instrument">Which instrument?</label>
                        <select id="bounty-req-instrument">
                            <option value="">Any / not sure</option>
                            <option value="banjo">Banjo</option>
                            <option value="guitar">Guitar</option>
                            <option value="fiddle">Fiddle</option>
                            <option value="mandolin">Mandolin</option>
                            <option value="dobro">Dobro</option>
                            <option value="bass">Bass</option>
                        </select>
                    </div>

                    <label for="bounty-req-description">Details (optional)</label>
                    <textarea id="bounty-req-description" rows="2" placeholder="e.g., Scruggs-style 3-finger picking"></textarea>

                    <button class="bounty-cta-btn" id="bounty-req-submit">Submit Request</button>
                    <div class="bounty-req-status" id="bounty-req-status"></div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const searchInput = document.getElementById('bounty-req-search');
    const resultsDiv = document.getElementById('bounty-req-results');
    const stepSearch = document.getElementById('bounty-req-step-search');
    const stepDetails = document.getElementById('bounty-req-step-details');
    const selectedDiv = document.getElementById('bounty-req-selected');
    const partTypeSelect = document.getElementById('bounty-req-part-type');
    const instrumentRow = document.getElementById('bounty-req-instrument-row');
    const instrumentSelect = document.getElementById('bounty-req-instrument');
    const descriptionInput = document.getElementById('bounty-req-description');
    const submitBtn = document.getElementById('bounty-req-submit');
    const statusDiv = document.getElementById('bounty-req-status');

    let selectedSong = null;

    // Show/hide instrument picker when tablature is selected
    partTypeSelect.addEventListener('change', () => {
        if (partTypeSelect.value === 'tablature') {
            instrumentRow.classList.remove('hidden');
        } else {
            instrumentRow.classList.add('hidden');
            instrumentSelect.value = '';
        }
    });

    // Close modal
    const close = () => {
        document.removeEventListener('keydown', onEscape);
        modal.remove();
    };
    const onEscape = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEscape);
    document.getElementById('bounty-request-close').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Search songs
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = searchInput.value.trim().toLowerCase();
            if (query.length < 2) {
                resultsDiv.innerHTML = '';
                return;
            }
            const matches = allSongs
                .filter(s => !isPlaceholder(s))
                .filter(s =>
                    s.title?.toLowerCase().includes(query) ||
                    s.artist?.toLowerCase().includes(query)
                )
                .slice(0, 8);

            resultsDiv.innerHTML = matches.map(s => `
                <button class="bounty-req-result" data-id="${s.id}">
                    <span class="bounty-req-result-title">${escapeHtml(s.title)}</span>
                    ${s.artist ? `<span class="bounty-req-result-artist">${escapeHtml(s.artist)}</span>` : ''}
                </button>
            `).join('') || '<div class="bounty-req-no-results">No songs found</div>';

            resultsDiv.querySelectorAll('.bounty-req-result').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedSong = allSongs.find(s => s.id === btn.dataset.id);
                    if (!selectedSong) return;

                    const existingParts = describeExistingParts(selectedSong);
                    selectedDiv.innerHTML = `
                        <strong>${escapeHtml(selectedSong.title)}</strong>
                        ${selectedSong.artist ? ` - ${escapeHtml(selectedSong.artist)}` : ''}
                        ${existingParts.length ? `<div class="bounty-req-has">Has: ${escapeHtml(existingParts.join(', '))}</div>` : ''}
                        <button class="bounty-req-change">Change</button>
                    `;

                    selectedDiv.querySelector('.bounty-req-change').addEventListener('click', () => {
                        selectedSong = null;
                        stepSearch.classList.remove('hidden');
                        stepDetails.classList.add('hidden');
                        searchInput.focus();
                    });

                    stepSearch.classList.add('hidden');
                    stepDetails.classList.remove('hidden');
                });
            });
        }, 200);
    });

    // Submit bounty
    submitBtn.addEventListener('click', async () => {
        if (!selectedSong) return;

        const supabase = window.SupabaseAuth?.supabase;
        const user = window.SupabaseAuth?.getUser?.();
        if (!supabase || !user) {
            statusDiv.textContent = 'Please sign in to submit a request.';
            return;
        }

        const partType = partTypeSelect.value;
        const instrument = partType === 'tablature' ? (instrumentSelect.value || null) : null;

        submitBtn.disabled = true;
        statusDiv.textContent = 'Submitting...';

        try {
            const { error } = await supabase
                .from('bounties')
                .insert({
                    work_id: selectedSong.id,
                    part_type: partType,
                    instrument: instrument,
                    description: descriptionInput.value.trim() || null,
                    created_by: user.id,
                });

            if (error) {
                if (error.code === '23505') { // Unique violation
                    statusDiv.textContent = 'A bounty for this part already exists!';
                } else {
                    statusDiv.textContent = `Error: ${error.message}`;
                }
                submitBtn.disabled = false;
                return;
            }

            statusDiv.innerHTML = '<span style="color: var(--success)">Bounty created! Refreshing...</span>';

            // Refresh bounties and re-render
            if (window.refreshBounties) await window.refreshBounties();
            setTimeout(() => {
                close();
                renderBountyView(container);
            }, 800);
        } catch (e) {
            statusDiv.textContent = `Error: ${e.message}`;
            submitBtn.disabled = false;
        }
    });

    searchInput.focus();
}
