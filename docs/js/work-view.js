// WorkView — the unified song page. ONE page per song: title + artist,
// a pill row (Key / Display / Info / Arrangement), part tabs when a work
// has multiple parts, the active part's content, and the app shell's
// top/bottom bands for actions and playback controls.
//
// This replaced the old dashboard-of-cards and the separate song page:
// every route (search, lists, deep links, history) lands in openWork().

import {
    allSongs,
    songGroups,
    setCurrentSong,
    currentChordpro, setCurrentChordpro,
    loadedTablature, setLoadedTablature,
    tablaturePlayer, setTablaturePlayer,
    setCurrentDetectedKey,
    setOriginalDetectedKey,
    setOriginalDetectedMode,
    listContext, setListContext,
    currentView, setCurrentView,
    resolveWorkId,
    getBountiesForWork,
    subscribe
} from './state.js';

import {
    goBack,
    updateListContextClass, updateNavBar,
    stopAbcPlayback,
    renderLeadSheetContent,
    initKeyState
} from './song-view.js';
import {
    getSongContent, peekSongContent, songHasContent, songHasAbc,
} from './song-content.js';
import { CHROMATIC_MAJOR_KEYS } from './chords.js';
import { escapeHtml, partUsesSongActions, isPlaceholder, requireLogin, slugify } from './utils.js';
import { openAddSongPicker } from './add-song-picker.js';
import {
    TabRenderer, TabPlayer,
    TimelineTiming, identityTimeline, readingListTimeline,
    expandNotation, makePlaybackToVisualMapper,
    maxMeasureIn, measureTimingFromOtf,
    analyzeReadingList, prepareCompactNotation, densifyNotation,
    attachOtfDecorations, isPercussionTrack, pitchedTracks,
} from './renderers/index.js';
import { clearListView, openNotesSheet } from './lists.js';
import { showListPicker, updateTriggerButton } from './list-picker.js';
import { openFlagModal } from './flags.js';
import { trackSongView } from './analytics.js';
import { setTopBar, setBottomBand, pill, setChromeAutoHide } from './shell.js';
import { buildKeyPill, buildDisplayPill, buildInfoPill, buildExportPill, handleExport } from './song-controls.js';
import {
    attachTabPlaybackInteractions, playbackTickForPoint, playbackRangeForMeasures,
} from './tab-playback-interactions.js';

// ============================================
// WORK STATE
// ============================================

let currentWork = null;          // The full work object
let activePart = null;           // Currently displayed part { type, format, file, ... }
let availableParts = [];         // All parts for current work
let trackRenderers = {};         // Map of trackId -> TabRenderer instance
let showRepeatsCompact = false;  // true = show repeat signs, false = unroll repeats
let twoFeelMode = false;         // true = present 4/4 as cut time (2/2)
let tempoOverride = null;        // { workId, quarterBpm } — user-set tempo;
                                 // stored in QUARTER-note bpm so the display
                                 // can convert when the feel changes
let activeTrackView = null;      // track id, 'all', or null (= lead track)
let workViewEscHandler = null;   // Esc-to-disarm listener (single live copy)
let activeEditSession = null;    // live tab edit session (torn down on nav)

/**
 * Tear down everything the tablature view holds live handles to: the
 * edit session (document-level listeners, undo history, its player),
 * the per-track renderers (each owns a documentElement MutationObserver
 * that would otherwise keep re-rendering into detached DOM on every
 * theme toggle), and the tab player (stop() also kills an in-flight
 * soundfont load). Idempotent — safe to call on any navigation.
 */
export function teardownTablatureView() {
    if (activeEditSession) {
        activeEditSession.destroy();
        activeEditSession = null;
    }
    destroyTrackRenderers();
    if (tablaturePlayer) {
        tablaturePlayer.stop();
        setTablaturePlayer(null);
    }
    // Stop any ABC synth playback started for a fiddle/ABC part
    stopAbcPlayback();
}

function destroyTrackRenderers() {
    for (const r of Object.values(trackRenderers)) r.destroy?.();
    trackRenderers = {};
}

let currentGroupVersions = [];    // All versions in the current group (Arrangement pill)
let pendingInitialRender = false; // set by openWork; consumed by renderWorkView (key/tempo init)

/**
 * Pick the best representative version from a group for display.
 * A canonical row (editorially pinned via curation/registry.yaml) wins
 * outright; otherwise prefers: content > most chords > highest canonical_rank.
 */
function pickRepresentative(versions) {
    if (versions.length === 0) return null;
    if (versions.length === 1) return versions[0];
    const pinned = versions.find(v => v.canonical === true);
    if (pinned) return pinned;
    return [...versions].sort((a, b) => {
        // Flag-based (has_content) so the order can't depend on which
        // versions the reader happens to have opened this session
        const aHasContent = songHasContent(a) ? 1 : 0;
        const bHasContent = songHasContent(b) ? 1 : 0;
        if (aHasContent !== bHasContent) return bHasContent - aHasContent;
        const aChords = a.chord_count || 0;
        const bChords = b.chord_count || 0;
        if (aChords !== bChords) return bChords - aChords;
        return (b.canonical_rank || 0) - (a.canonical_rank || 0);
    })[0];
}

// Getter for checking if we're in work view
export function getCurrentWork() { return currentWork; }

// ============================================
// NOTATION HELPERS
// ============================================

/**
 * Timing maps for a loaded OTF, ts-change aware (measure-timing.js):
 * - visual: what the current display mode shows (original measures in
 *   compact mode, unrolled reading list otherwise)
 * - playback: always the unrolled reading list (what TabPlayer follows)
 */
function buildOtfTimings(otf, compact) {
    const measureTiming = measureTimingFromOtf(otf, { feel: twoFeelMode ? 'two' : null });
    const maxMeasure = maxMeasureIn(otf.notation);
    const playbackTimeline = readingListTimeline(otf.reading_list, maxMeasure);
    const playback = new TimelineTiming(measureTiming, playbackTimeline);
    const visual = compact
        ? new TimelineTiming(measureTiming, identityTimeline(maxMeasure))
        : playback;
    return { measureTiming, playbackTimeline, playback, visual };
}

// ============================================
// WORK LOADING
// ============================================

/**
 * Build the parts list from index data.
 * Each part gets a unique `partId` slug derived from its label,
 * used in URLs (#work/{id}/{partId}) and list references.
 */
/** "banjo" -> "Banjo Tab", "tenor-banjo" -> "Tenor Banjo Tab" */
function tabLabel(instrument) {
    if (!instrument) return 'Tab';
    const pretty = instrument.split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${pretty} Tab`;
}

/** "banjo-hangout" -> "Banjo Hangout" (source ids are slugs) */
function prettySource(source) {
    if (!source) return '';
    return String(source).split(/[-_]/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Fields that belong to ONE arrangement (not to the instrument). Selecting a
// different arrangement copies these onto the part, so every downstream
// reader (renderTablaturePart, the edit session, the attribution line)
// follows the loaded take without needing to know arrangements exist.
// `label` is deliberately NOT here: the pill's label (and therefore its
// partId, which is a URL) belongs to the instrument and must not move when
// the reader switches takes.
const ARRANGEMENT_FIELDS = [
    'file', 'source', 'source_id', 'author', 'source_page_url', 'author_url',
    'difficulty', 'tuning',
];

/**
 * Order an instrument's arrangements default-first.
 *
 * New index shape: exactly one row per instrument carries `default: true`
 * (the curation pin). Old shape: no row has the field at all — the sole
 * row is then the default by position. Tolerant of both, and of a bad
 * multi-default group (all flagged rows float up, original order kept).
 */
function sortArrangements(tabs) {
    const pinned = tabs.filter(t => t.default === true);
    if (!pinned.length) return [...tabs];
    return [...pinned, ...tabs.filter(t => t.default !== true)];
}

/** The arrangement currently loaded for a tablature part (null for others). */
function activeArrangement(part) {
    if (!part?.arrangements?.length) return null;
    return part.arrangements[part.arrangementIndex || 0] || null;
}

/**
 * Point a tablature part at one of its arrangements. Returns true when the
 * selection actually changed. `part` is rebuilt on every openWork, so the
 * choice resets to the default on work navigation for free.
 */
function applyArrangement(part, index) {
    if (!part?.arrangements?.length) return false;
    const i = Math.max(0, Math.min(index, part.arrangements.length - 1));
    if (i === (part.arrangementIndex || 0)) return false;
    part.arrangementIndex = i;
    const arr = part.arrangements[i];
    for (const f of ARRANGEMENT_FIELDS) part[f] = arr[f];
    return true;
}

/**
 * @param {object} song  index row
 * @param {string|null} content  ChordPro if we already have it; null means
 *   "fetch on render" (the part is still built — has_content says it exists)
 */
function buildPartsFromIndex(song, content = undefined) {
    const parts = [];
    const leadSheet = content === undefined ? peekSongContent(song) : content;
    const hasLeadSheet = songHasContent(song);

    if (hasLeadSheet) {
        // Label the lead sheet by what it is, not a guessed instrument —
        // ABC transcriptions aren't necessarily fiddle (flutes, pipes...).
        const label = songHasAbc(song) ? 'Notation' : 'Lyrics & Chords';
        parts.push({
            type: 'lead-sheet',
            format: 'chordpro',
            label: label,
            content: leadSheet,   // null until the .pro file lands
            default: true
        });
    }

    // Tablature: ONE part (= one pill) per instrument, carrying that
    // instrument's arrangements sorted default-first. A work with twelve
    // banjo takes is still a single "Banjo Tab" pill; which take you read
    // is page state under it, so #work/{id}/banjo-tab stays meaningful.
    if (song.tablature_parts?.length) {
        const byInstrument = new Map();
        for (const tab of song.tablature_parts) {
            const key = tab.instrument || '';
            if (!byInstrument.has(key)) byInstrument.set(key, []);
            byInstrument.get(key).push(tab);
        }

        for (const tabs of byInstrument.values()) {
            const arrangements = sortArrangements(tabs);
            const primary = arrangements[0];
            const part = {
                type: 'tablature',
                format: 'otf',
                instrument: primary.instrument,
                label: primary.label || tabLabel(primary.instrument),
                default: !hasLeadSheet,
                arrangements,
                arrangementIndex: 0,
            };
            for (const f of ARRANGEMENT_FIELDS) part[f] = primary[f];
            parts.push(part);
        }
    }

    if (song.document_parts) {
        for (const doc of song.document_parts) {
            parts.push({
                type: 'document',
                format: doc.format || 'pdf',
                label: doc.label || 'PDF',
                file: doc.file,
                default: !hasLeadSheet && !song.tablature_parts?.length,
            });
        }
    }

    const pending = window.__pendingDocuments?.[song.id];
    if (pending && !song.document_parts?.length) {
        parts.push({
            type: 'document',
            format: 'pdf',
            label: pending.label || 'PDF',
            file: pending.url,
            default: parts.length === 0,
            pending: true,
        });
    }

    // Assign unique partId slugs (deduplicate by appending -2, -3, etc.)
    const slugCounts = {};
    for (const part of parts) {
        const base = slugify(part.label || part.instrument || part.type);
        slugCounts[base] = (slugCounts[base] || 0) + 1;
        part.partId = slugCounts[base] === 1 ? base : `${base}-${slugCounts[base]}`;
    }

    // Alternate slugs a tablature part also answers to, so links minted
    // before arrangements were grouped (one part per tab, slugged from that
    // tab's own label) still land on the right instrument.
    for (const part of parts) {
        if (part.type !== 'tablature') continue;
        const aliases = new Set([slugify(tabLabel(part.instrument))]);
        if (part.instrument) aliases.add(slugify(part.instrument));
        for (const arr of part.arrangements || []) {
            if (arr.label) aliases.add(slugify(arr.label));
        }
        aliases.delete(part.partId);
        part.aliases = [...aliases].filter(Boolean);
    }

    return parts;
}

/**
 * "Looking for this song…" while a late source (archive.jsonl, pending rows)
 * is fetched. Better than a blank page and better than flashing "not found".
 */
function showWorkLoading() {
    setCurrentView('song');
    const container = document.getElementById('song-content');
    if (container) {
        container.innerHTML = '<div class="loading">Loading song…</div>';
    }
    setTopBar({ back: { onClick: goBack }, title: '' });
    setBottomBand(null);
}

/**
 * Open a work — THE entry point for viewing any song/work.
 *
 * Options:
 *   fromList     - navigating within a list (keeps context, auto-fullscreen)
 *   listId       - list id for #list/... URL building (deep links)
 *   groupId      - version group override for the Arrangement pill
 *   partId       - open a specific part (deep links / part-qualified refs)
 *   fromDeepLink - don't push history (URL already set)
 *   fromHistory  - don't push history (back/forward navigation)
 *   exact        - show THIS version; skip the canonical-representative snap
 */
export async function openWork(workId, options = {}) {
    workId = resolveWorkId(workId);

    let song = allSongs.find(s => s.id === workId);

    // A miss is not (yet) a 404: the archive (data/archive.jsonl) loads after
    // first paint, and a brand-new pending row may not be merged. Show a
    // loading state, then try each late source exactly once before giving up.
    if (!song && !window.isArchiveLoaded?.()) {
        showWorkLoading();
        await window.ensureArchiveLoaded?.();
        song = allSongs.find(s => s.id === workId);
        // A redirect may only be resolvable once the archive is in
        if (!song) {
            const resolved = resolveWorkId(workId);
            if (resolved !== workId) {
                song = allSongs.find(s => s.id === resolved);
                if (song) workId = resolved;
            }
        }
    }
    if (!song && window.refreshPendingSongs) {
        showWorkLoading();
        await window.refreshPendingSongs();
        song = allSongs.find(s => s.id === workId);
    }

    const {
        fromList = false, listId = null, groupId = null,
        partId = null, fromDeepLink = false, fromHistory = false,
        exact = false,
    } = options;

    if (!song) {
        // Real error state with a way out, not a dead-end spinner
        console.error(`Work not found: ${workId}`);
        setCurrentView('song');
        const container = document.getElementById('song-content');
        if (container) {
            container.innerHTML = `
                <div class="not-found">
                    <p>Song not found: "${escapeHtml(workId)}"</p>
                    <p>It may have been renamed or removed.</p>
                    <a href="#search" class="not-found-home-link">Browse all songs</a>
                </div>`;
        }
        setTopBar({ back: { onClick: goBack }, title: 'Not found' });
        setBottomBand(null);
        return;
    }

    // Store group context for the Arrangement pill
    if (groupId && songGroups[groupId]) {
        currentGroupVersions = songGroups[groupId];
    } else if (song.group_id && songGroups[song.group_id]) {
        currentGroupVersions = songGroups[song.group_id];
    } else {
        currentGroupVersions = [];
    }

    // Generic entries (e.g. search results without an explicit version
    // choice) snap to the canonical representative so the URL is stable.
    // exact / deep links / history keep the requested version so
    // arrangement links and list refs stay pointed where they aim.
    if (!exact && !fromDeepLink && !fromHistory && currentGroupVersions.length > 1) {
        const representative = pickRepresentative(currentGroupVersions);
        if (representative && representative.id !== workId) {
            workId = representative.id;
            song = representative;
        }
    }

    // Only clear list context when NOT navigating from a list
    if (!fromList) {
        const listHeader = document.getElementById('list-header');
        if (listHeader) {
            listHeader.classList.add('hidden');
        }
        clearListView();

        const navBar = document.getElementById('song-nav-bar');
        if (navBar) navBar.classList.add('hidden');
    }

    setCurrentChordpro(null);
    setCurrentView('song');
    setChromeAutoHide(true);

    setOriginalDetectedKey(null);
    setOriginalDetectedMode(null);
    setCurrentDetectedKey(null);

    // Reset tablature state for the new work
    activeTrackView = null;
    setLoadedTablature(null);
    teardownTablatureView();
    setBottomBand(null);

    currentWork = song;
    // Content comes from data/songs/{id}.pro on demand. Whatever we already
    // have (legacy inline row, cached fetch) renders synchronously; otherwise
    // the lead-sheet part fetches itself with a loading state.
    const knownContent = peekSongContent(song);
    availableParts = buildPartsFromIndex(song, knownContent);
    setCurrentSong(song);
    setCurrentChordpro(knownContent || null);

    // Seed the Key pill from the index's precomputed key so it reads
    // "Key of G" immediately instead of "Key" until the .pro file lands
    if (!knownContent && songHasContent(song) && song.key) {
        initKeyState(song, '', true);
    }

    // Active part: requested via deep link / part-qualified ref, else default
    activePart = null;
    if (partId) {
        activePart = availableParts.find(p => p.partId === partId) ||
            availableParts.find(p =>
                p.instrument === partId ||
                p.type === partId ||
                p.aliases?.includes(partId)
            ) || null;
    }
    if (!activePart) {
        activePart = availableParts.find(p => p.default) || availableParts[0] || null;
    }

    // Update list context index when navigating within a list;
    // drop a stale context when the song isn't in the current list
    if (fromList && listContext && listContext.songIds) {
        const idx = listContext.songIds.indexOf(workId);
        if (idx !== -1) {
            setListContext({ ...listContext, currentIndex: idx });
        }
    } else if (!fromList && listContext && listContext.songIds &&
               !listContext.songIds.includes(workId)) {
        setListContext(null);
    }

    // List context flag for CSS (band offsets above the list nav bar);
    // chrome auto-hide handles immersion — no mode to enter.
    if (fromList && listContext) {
        document.body.classList.add('has-list-context');
    }

    // Analytics
    trackSongView(workId, fromDeepLink ? 'deep_link' : 'search', song.group_id);
    if (typeof gtag === 'function') {
        gtag('event', 'page_view', {
            page_title: `${song.title} - ${song.artist || 'Unknown'}`,
            page_location: `${window.location.origin}/song/${workId}`,
            page_path: `/song/${workId}`
        });
    }

    pendingInitialRender = true;
    renderWorkView();

    updateNavBar();
    if (fromList) {
        updateListContextClass();
    }

    // History: list-context pages keep #list/... URLs; everything else gets
    // the canonical #work/... form (old #song links land here too).
    const requestedPartId = partId ? (activePart?.partId || partId) : null;
    const partSeg = requestedPartId ? `/${requestedPartId}` : '';
    const effectiveListId = listId || (fromList && listContext ? listContext.listId : null);
    const hash = effectiveListId
        ? `#list/${effectiveListId}/${workId}${partSeg}`
        : `#work/${workId}${partSeg}`;

    if (!fromDeepLink && !fromHistory && window.location.hash !== hash) {
        history.pushState(
            { view: 'song', songId: workId, partId: requestedPartId, listId: effectiveListId },
            '', hash);
    }
}

// ============================================
// RENDERING
// ============================================

/**
 * Main render function — the unified song page.
 */
export function renderWorkView() {
    const container = document.getElementById('song-content');
    if (!container || !currentWork) return;

    const isInitial = pendingInitialRender;
    pendingInitialRender = false;

    container.innerHTML = '';

    // Title row: song title + small artist line
    container.appendChild(renderTitleHeader());

    // Pill row: Key / Display / Info / Arrangement
    container.appendChild(renderPillRow());

    // Part tabs (segmented control) — only when the work has multiple parts
    const tabs = renderPartTabs();
    if (tabs) container.appendChild(tabs);

    // Arrangement bar: whose take of the active instrument you're reading
    // (filled by renderArrangementBar; empty + hidden for non-tab parts)
    const arrHost = document.createElement('div');
    arrHost.className = 'arr-host hidden';
    arrHost.id = 'arrangement-host';
    container.appendChild(arrHost);

    // Content area for the active part
    const content = document.createElement('div');
    content.className = 'work-part-content';
    content.id = 'work-part-content';
    container.appendChild(content);

    renderArrangementBar();

    if (activePart) {
        renderActivePart(content, isInitial);
        if (isPlaceholder(currentWork)) {
            container.appendChild(buildPlaceholderCta(true));
        }
    } else {
        content.appendChild(buildPlaceholderCta(false));
    }

    // Bounty section: the "help complete this song" surface. Shown for
    // placeholders / empty works and any work with open bounties.
    if (isPlaceholder(currentWork) || availableParts.length === 0 ||
        getBountiesForWork(currentWork.id).length > 0) {
        const bountySection = renderBountySection();
        if (bountySection) container.appendChild(bountySection);
    }

    updateWorkTopBar();
}

/**
 * Render the active part into the content area.
 */
function renderActivePart(content, isInitial = false) {
    if (activePart.type === 'tablature') {
        renderTablaturePart(activePart, content);
    } else if (activePart.type === 'document') {
        renderDocumentPart(activePart, content);
        setBottomBand(null);
    } else {
        // lead-sheet (chordpro, possibly with embedded ABC notation)
        const chordpro = currentChordpro ?? activePart.content;
        if (typeof chordpro === 'string') {
            renderLeadSheetContent(content, currentWork, chordpro, isInitial);
        } else {
            fetchAndRenderLeadSheet(content, isInitial);
        }
    }
}

/**
 * Lead sheet whose ChordPro isn't in memory yet: show a light loading state,
 * fetch data/songs/{id}.pro, then render. A failed fetch offers Retry rather
 * than leaving an empty page (and the failure isn't cached, so Retry works).
 */
function fetchAndRenderLeadSheet(container, isInitial = false) {
    const work = currentWork;
    const part = activePart;

    container.innerHTML = '<div class="part-loading">Loading song…</div>';
    setBottomBand(null);

    getSongContent(work).then(text => {
        // Bail if the reader has navigated on while we were fetching
        if (currentWork !== work || activePart !== part) return;
        part.content = text || '';
        setCurrentChordpro(text || null);
        renderLeadSheetContent(container, work, text || '', isInitial);
    }).catch(error => {
        if (currentWork !== work || activePart !== part) return;
        container.innerHTML = `
            <div class="part-error">
                <p>Couldn't load this song's lyrics &amp; chords.</p>
                <p class="part-error-detail">${escapeHtml(error.message || 'Network error')}</p>
                <button class="part-retry-btn" type="button">Try again</button>
            </div>`;
        container.querySelector('.part-retry-btn')?.addEventListener('click', () => {
            fetchAndRenderLeadSheet(container, isInitial);
        });
    });
}

/**
 * Switch parts in place (segmented control). Tablature teardown MUST run
 * when switching away from a tab part — it stops audio and drops renderer
 * observers.
 */
function selectPart(part) {
    if (!part || part === activePart) return;

    teardownTablatureView();
    setBottomBand(null);

    activePart = part;
    part.arrangementsOpen = false;   // never hand over an open catalog

    document.querySelectorAll('#part-tabs .part-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.partId === part.partId);
    });

    renderArrangementBar();

    const content = document.getElementById('work-part-content');
    if (content) {
        content.innerHTML = '';
        renderActivePart(content, false);
    }

    // Edit/Export applicability can change with the part type
    updateWorkTopBar();

    const hash = `#work/${currentWork.id}/${part.partId}`;
    if (window.location.hash !== hash) {
        history.pushState({ view: 'song', songId: currentWork.id, partId: part.partId }, '', hash);
    }
}

/**
 * Title row: song title + small artist line.
 */
function renderTitleHeader() {
    const header = document.createElement('div');
    header.className = 'song-header';
    const title = currentWork.title || 'Untitled';
    const artist = currentWork.artist || '';
    header.innerHTML = `
        <div class="song-header-left">
            <div class="song-title-row">
                <span class="song-title">${escapeHtml(title)}</span>
                ${isPlaceholder(currentWork) ? '<span class="placeholder-badge">Placeholder</span>' : ''}
                <button id="edit-song-btn" class="focus-btn" title="Edit this song">&#x270F;&#xFE0F; Edit</button>
            </div>
            ${artist ? `<div class="song-artist-line">${escapeHtml(artist)}</div>` : ''}
        </div>
    `;
    // #edit-song-btn is wired via main.js's songContent delegation
    return header;
}

/**
 * Pill row under the title (shell.js pill primitive).
 */
function renderPillRow() {
    const row = document.createElement('div');
    row.className = 'song-pill-row';
    row.id = 'song-pill-row';

    if (songHasContent(currentWork)) {
        row.appendChild(buildKeyPill(currentWork));
        row.appendChild(buildDisplayPill());
    }
    row.appendChild(buildInfoPill(currentWork, currentGroupVersions));

    if (currentGroupVersions.length > 1 || currentWork.variant_of || currentWork.variant_label) {
        row.appendChild(buildArrangementPill());
    }
    return row;
}

/**
 * Segmented control for part switching. Null when there's nothing to switch.
 */
function renderPartTabs() {
    if (availableParts.length < 2) return null;
    const bar = document.createElement('div');
    bar.className = 'part-tabs';
    bar.id = 'part-tabs';
    for (const part of availableParts) {
        const btn = document.createElement('button');
        btn.className = 'part-tab' + (part === activePart ? ' active' : '');
        btn.dataset.partId = part.partId;
        const n = part.arrangements?.length || 0;
        // Badge only when there's a choice to be made — a lone arrangement
        // is just "the tab", and "1" would be noise on every other pill.
        btn.innerHTML = escapeHtml(part.label || part.type) +
            (n > 1 ? `<span class="part-tab-count">${n}</span>` : '');
        btn.addEventListener('click', () => selectPart(part));
        bar.appendChild(btn);
    }
    return bar;
}

// ============================================
// ARRANGEMENT BAR (which take of this instrument you're reading)
// ============================================

/** Human "Intermediate · Open G · Banjo Hangout" for one arrangement. */
function arrangementMeta(arr, { withSource = true } = {}) {
    return [arr.difficulty, arr.tuning, withSource ? prettySource(arr.source) : null]
        .filter(Boolean).join(' · ');
}

function arrangementWho(arr) {
    return arr.author || arr.label || 'Unattributed';
}

/**
 * Render (or clear) the arrangement bar into its host. Shown for tablature
 * parts only: a one-line byline when there's a single take, a clickable
 * summary + expandable catalog when there's more than one.
 *
 * The chosen arrangement is page state, NOT a URL segment — shared links
 * stay instrument-shaped and survive a re-pin.
 */
function renderArrangementBar() {
    const host = document.getElementById('arrangement-host');
    if (!host) return;
    host.innerHTML = '';

    const part = activePart;
    const arrangements = part?.type === 'tablature' ? part.arrangements : null;
    if (!arrangements?.length) {
        host.classList.add('hidden');
        return;
    }
    host.classList.remove('hidden');

    const index = part.arrangementIndex || 0;
    const cur = arrangements[index];
    const single = arrangements.length === 1;
    const meta = arrangementMeta(cur);
    const isPinned = i => i === 0;   // sorted default-first at build time

    const summary = document.createElement(single ? 'div' : 'button');
    summary.className = 'arr-bar' + (single ? ' is-single' : '');
    if (!single) {
        summary.type = 'button';
        summary.setAttribute('aria-expanded', String(!!part.arrangementsOpen));
        summary.setAttribute('aria-controls', 'arr-list');
    }
    summary.innerHTML = `
        ${isPinned(index) ? '<span class="arr-pin" title="Editor\'s pick">★</span>' : ''}
        <span class="arr-who">${escapeHtml(arrangementWho(cur))}</span>
        ${meta ? `<span class="arr-meta">${escapeHtml(meta)}</span>` : ''}
        ${single ? '' : `<span class="arr-count">${arrangements.length} arrangements ${
            part.arrangementsOpen ? '▴' : '▾'}</span>`}
    `;
    host.appendChild(summary);

    if (single) return;

    summary.addEventListener('click', () => {
        part.arrangementsOpen = !part.arrangementsOpen;
        renderArrangementBar();
        if (part.arrangementsOpen) {
            document.querySelector('#arr-list .arr-item.is-selected')?.focus();
        } else {
            document.querySelector('.arr-bar')?.focus();
        }
    });

    if (!part.arrangementsOpen) return;

    const list = document.createElement('div');
    list.className = 'arr-list';
    list.id = 'arr-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', `${part.label || 'Tab'} arrangements`);

    arrangements.forEach((arr, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'arr-item' + (i === index ? ' is-selected' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(i === index));
        const rowMeta = arrangementMeta(arr, { withSource: false });
        item.innerHTML = `
            <span class="arr-pin" ${isPinned(i)
                ? 'title="Editor&#39;s pick" aria-label="Editor&#39;s pick">★' : '>'}</span>
            <span class="arr-who">${escapeHtml(arrangementWho(arr))}</span>
            ${rowMeta ? `<span class="arr-meta">${escapeHtml(rowMeta)}</span>` : ''}
            <span class="arr-src">${escapeHtml(prettySource(arr.source))}</span>
        `;
        item.addEventListener('click', () => selectArrangement(part, i));
        list.appendChild(item);
    });

    // Roving arrows inside the catalog; Esc closes it. Enter/Space are the
    // buttons' own defaults.
    list.addEventListener('keydown', (e) => {
        const items = [...list.querySelectorAll('.arr-item')];
        const at = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
            items[(next + items.length) % items.length]?.focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            part.arrangementsOpen = false;
            renderArrangementBar();
            document.querySelector('.arr-bar')?.focus();
        }
    });

    host.appendChild(list);
}

/**
 * Load a different arrangement of the active instrument: swap the rendered
 * tab (and with it the mixer, player and attribution, which all read the
 * part's arrangement fields) while leaving the URL alone.
 */
function selectArrangement(part, index) {
    const changed = applyArrangement(part, index);
    part.arrangementsOpen = false;

    if (changed) {
        teardownTablatureView();
        setBottomBand(null);
        setLoadedTablature(null);   // force a fetch of the new OTF
        const content = document.getElementById('work-part-content');
        if (content) {
            content.innerHTML = '';
            renderActivePart(content, false);
        }
    }

    renderArrangementBar();
    document.querySelector('.arr-bar')?.focus();
}

/**
 * Placeholder / empty-state CTA (reused below content for placeholders
 * that do have reference material).
 */
function buildPlaceholderCta(hasContent) {
    const cta = document.createElement('div');
    cta.className = 'placeholder-cta';
    cta.innerHTML = `
        <div class="placeholder-cta-text">${hasContent
            ? 'This song has reference material but no lyrics & chords or tablature yet.'
            : 'This song doesn\'t have lyrics & chords or tablature yet.'}</div>
        <button class="placeholder-contribute-btn">Help complete this song</button>
    `;
    cta.querySelector('.placeholder-contribute-btn').addEventListener('click', () => {
        if (!requireLogin('contribute')) return;
        openAddSongPicker({
            mode: 'contribute',
            targetSlug: currentWork.id,
            title: currentWork.title,
            artist: currentWork.artist,
            key: currentWork.key,
        });
    });
    return cta;
}

// ============================================
// ARRANGEMENT PILL (replaces the dashboard version cards)
// ============================================

/**
 * Arrangement pill: lists the group's versions with canonical badge,
 * variant labels and vote counts; clicking navigates to that version.
 */
function buildArrangementPill() {
    const versions = currentGroupVersions.length ? currentGroupVersions : [currentWork];
    const label = versions.length > 1 ? `${versions.length} arrangements` : 'Arrangement';
    return pill(label, (container) => {
        container.innerHTML = '<div class="arrangement-loading">Loading…</div>';
        renderArrangementList(container, versions);
    }, { id: 'arrangement-pill', title: 'Arrangements of this song', className: 'pill-wide' });
}

async function renderArrangementList(container, versions, voteData = null) {
    const groupId = versions[0]?.group_id;

    // Render immediately with whatever vote data we have; votes are
    // decoration and must never gate the list (a slow Supabase fetch left
    // the popover stuck on "Loading…").
    const voteCounts = voteData?.voteCounts || {};
    const userVotes = voteData?.userVotes || {};
    if (voteData === null && typeof SupabaseAuth !== 'undefined' && groupId) {
        (async () => {
            try {
                const { data } = await SupabaseAuth.fetchGroupVotes(groupId);
                const counts = data || {};
                let uv = {};
                if (SupabaseAuth.isLoggedIn()) {
                    const { data: u } = await SupabaseAuth.fetchUserVotes(versions.map(v => v.id));
                    uv = u || {};
                }
                if (container.isConnected) {
                    renderArrangementList(container, versions,
                        { voteCounts: counts, userVotes: uv });
                }
            } catch (e) {
                // votes are optional decoration
            }
        })();
    }

    // Canonical first, then by votes (same ordering as the old modal)
    const sorted = [...versions].sort((a, b) => {
        const aCanonical = a.canonical === true ? 1 : 0;
        const bCanonical = b.canonical === true ? 1 : 0;
        if (aCanonical !== bCanonical) return bCanonical - aCanonical;
        return (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0);
    });

    container.innerHTML = sorted.map(v => {
        const isCurrent = v.id === currentWork?.id;
        const tabPart = v.tablature_parts?.[0];
        let label = v.variant_label || v.version_label;
        if (!label) {
            if (v.tablature_parts?.length && !songHasContent(v) && tabPart?.author) {
                label = `Tab by ${tabPart.author}`;
            } else if (songHasAbc(v) && !songHasContent(v)) {
                label = 'Fiddle notation';
            } else if (v.key) {
                label = `Key of ${v.key}`;
            } else {
                label = 'Original';
            }
        }
        const meta = [];
        if (v.artist && v.artist !== currentWork?.artist) meta.push(v.artist);
        if (v.key) meta.push(`Key: ${v.key}`);
        if (v.chord_count) meta.push(`${v.chord_count} chords`);
        const votes = voteCounts[v.id] || 0;
        const hasVoted = userVotes[v.id] ? ' voted' : '';
        return `
            <div class="pill-popover-item arrangement-item${isCurrent ? ' current' : ''}" data-song-id="${escapeHtml(v.id)}" role="button" tabindex="0">
                <span class="arrangement-info">
                    <span class="arrangement-label">${escapeHtml(label)}${v.canonical === true ? ' <span class="canonical-badge">Canonical</span>' : ''}${isCurrent ? ' <span class="current-badge">viewing</span>' : ''}</span>
                    <span class="arrangement-meta">${escapeHtml(meta.join(' · '))}</span>
                </span>
                <span class="arrangement-votes">
                    <button class="vote-btn arrangement-vote-btn${hasVoted}" data-song-id="${escapeHtml(v.id)}" title="Vote for this arrangement">
                        <span class="vote-arrow">▲</span>
                    </button>
                    <span class="vote-count">${votes}</span>
                </span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.arrangement-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.arrangement-vote-btn')) return;
            const songId = item.dataset.songId;
            if (songId && songId !== currentWork?.id) {
                openWork(songId, { groupId, exact: true });
            }
        });
    });

    // Vote casting — same affordance the version-picker modal had
    container.querySelectorAll('.arrangement-vote-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();

            if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
                alert('Please sign in to vote');
                return;
            }

            const songId = btn.dataset.songId;
            const hasVoted = btn.classList.contains('voted');
            const countEl = btn.parentElement.querySelector('.vote-count');

            if (hasVoted) {
                await SupabaseAuth.removeVote(songId);
                btn.classList.remove('voted');
                if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) - 1);
            } else {
                await SupabaseAuth.castVote(songId, groupId);
                btn.classList.add('voted');
                if (countEl) countEl.textContent = parseInt(countEl.textContent, 10) + 1;
            }
        });
    });
}

// ============================================
// TOP BAND (app shell)
// ============================================

let workPageHooks = {};
let prefSubscriptionsRegistered = false;

/**
 * Wire main.js-owned behaviors into the unified song page and register the
 * display-preference subscriptions that re-render the lead-sheet body.
 * Called once from main.js init.
 *   onEdit(song)   - open the song editor
 *   onDelete()     - admin delete flow
 *   isAdmin()      - current admin status (drives the Delete overflow item)
 *   isTrusted()    - current trusted status (drives the Promote overflow item)
 *   onPromote()    - promote/unpromote the viewed archived song
 *   isPromoted(id) - promoted this session (flips the item to Undo)
 */
export function configureWorkPage(hooks = {}) {
    workPageHooks = hooks;
    if (prefSubscriptionsRegistered) return;
    prefSubscriptionsRegistered = true;

    // Re-render only the part content on pref changes: pills stay mounted,
    // so an open Key/Display popover survives its own updates.
    const displayPrefKeys = [
        'compactMode', 'nashvilleMode', 'twoColumnMode',
        'chordDisplayMode', 'showSectionLabels', 'fontSizeLevel',
        'currentDetectedKey',
    ];
    for (const key of displayPrefKeys) {
        subscribe(key, () => {
            if (currentView !== 'song' || !currentWork) return;
            if (activePart && activePart.type !== 'lead-sheet') return;
            const content = document.getElementById('work-part-content');
            const chordpro = currentChordpro || activePart?.content;
            if (content && chordpro) {
                renderLeadSheetContent(content, currentWork, chordpro, false);
            }
        });
    }
}

/**
 * Declare the song page's top band: back, title, Edit / Lists / Export
 * actions, and the overflow (Report issue, Song notes, admin Delete).
 * Also called by main.js when admin status resolves.
 */
/**
 * Title-row Edit action (delegated from main.js): placeholders get the
 * metadata editor, real songs the ChordPro editor.
 */
export function handleEditAction() {
    if (!currentWork) return;
    if (isPlaceholder(currentWork)) {
        showPlaceholderEditor();
    } else {
        workPageHooks.onEdit?.(currentWork);
    }
}

export function updateWorkTopBar() {
    if (!currentWork || currentView !== 'song') return;

    const actions = [];

    // Edit lives in the title row (a content action stays with the
    // content); here we only sync its visibility to the active part —
    // tab parts carry their own Edit in the playback controls.
    const editBtn = document.getElementById('edit-song-btn');
    if (editBtn) {
        editBtn.classList.toggle('hidden',
            !(partUsesSongActions(activePart) || isPlaceholder(currentWork)));
    }

    actions.push({
        id: 'list-picker-btn',
        label: 'Lists',
        icon: '♡',
        title: 'Add to list',
        onClick: (e) => {
            const itemRef = getActiveItemRef() || currentWork.id;
            const anchor = e.currentTarget;
            showListPicker(itemRef, anchor, {
                onUpdate: () => updateTriggerButton(anchor, itemRef),
            });
        },
    });

    // Phone band diet: Export moves into the ⋯ overflow (the band keeps
    // back · logo · Lists · ⋯); desktop keeps the Export pill.
    const phoneBand = window.matchMedia('(max-width: 640px)').matches;
    if (songHasContent(currentWork) && !phoneBand) {
        actions.push({ el: buildExportPill() });
    }

    const overflow = [
        { id: 'flag-btn', label: '🚩 Report issue', onClick: () => openFlagModal(currentWork) },
    ];
    if (songHasContent(currentWork) && phoneBand) {
        overflow.push(
            { label: '🖨️ Print', onClick: () => handleExport('print') },
            { label: '📋 Copy ChordPro', onClick: () => handleExport('copy-chordpro') },
            { label: '⬇️ Download .pro', onClick: () => handleExport('download-chordpro') },
        );
    }
    if (listContext && listContext.listId) {
        overflow.push({
            id: 'song-notes-btn',
            label: '📝 Song notes',
            onClick: () => openNotesSheet(listContext.listId, currentWork.id, currentWork.title),
        });
    }
    if (workPageHooks.isTrusted?.()) {
        const promotedNow = workPageHooks.isPromoted?.(currentWork.id);
        if (promotedNow) {
            overflow.push({
                id: 'promote-song-btn',
                label: '↩️ Undo promote',
                onClick: () => workPageHooks.onPromote?.(),
            });
        } else if (currentWork.indexed === false) {
            overflow.push({
                id: 'promote-song-btn',
                label: '⬆️ Promote to songbook',
                onClick: () => workPageHooks.onPromote?.(),
            });
        }
    }
    if (workPageHooks.isAdmin?.()) {
        overflow.push({
            id: 'delete-song-btn',
            label: '🗑️ Delete song',
            onClick: () => workPageHooks.onDelete?.(),
        });
    }

    setTopBar({
        back: { onClick: goBack },
        // No title here: the page h1 is directly below the band and a
        // duplicate reads as clutter (owner feedback).
        title: null,
        actions,
        overflow,
        navActive: null,
    });
}

// ============================================
// FOCUS HEADER (fullscreen / list-practice mode)
// ============================================

// ============================================
// BOUNTY SECTION
// ============================================

const BOUNTY_PART_LABELS = {
    'lead-sheet': 'Lyrics & Chords',
    'tablature': 'Tab',
    'abc-notation': 'ABC Notation',
    'document': 'PDF/Document',
};
const BOUNTY_INSTRUMENT_LABELS = {
    'banjo': 'Banjo', 'guitar': 'Guitar', 'fiddle': 'Fiddle',
    'mandolin': 'Mandolin', 'dobro': 'Dobro', 'bass': 'Bass',
};

/**
 * Render bounty section for the current work.
 * Always expanded on the dashboard - bounties are a first-class element.
 */
function renderBountySection() {
    if (!currentWork) return null;

    const bounties = getBountiesForWork(currentWork.id);

    const section = document.createElement('div');
    section.className = 'work-bounty-section';

    const bountyCards = bounties.map(b => {
        const label = b.part_type === 'tablature' && b.instrument
            ? `${BOUNTY_INSTRUMENT_LABELS[b.instrument] || b.instrument} Tab`
            : BOUNTY_PART_LABELS[b.part_type] || b.part_type;
        return `
            <div class="work-bounty-card" data-bounty-type="${b.part_type}" data-bounty-instrument="${b.instrument || ''}">
                <div class="work-bounty-label">${escapeHtml(label)}</div>
                ${b.description ? `<div class="work-bounty-desc">${escapeHtml(b.description)}</div>` : ''}
                <button class="work-bounty-contribute">Contribute</button>
            </div>
        `;
    }).join('');

    const bountyCount = bounties.length;

    section.innerHTML = `
        <div class="work-bounty-header">
            <div class="work-bounty-title">
                <span class="work-bounty-flag">&#x1F3F4;</span>
                Wanted ${bountyCount > 0 ? `(${bountyCount})` : ''}
            </div>
        </div>
        <div class="work-bounty-body" id="work-bounty-body">
            ${bountyCards || '<div class="work-bounty-empty">No specific requests yet.</div>'}
            <button class="work-bounty-request-btn" id="work-bounty-request-btn">+ Request a part</button>
        </div>
    `;

    // Wire contribute buttons
    section.querySelectorAll('.work-bounty-contribute').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!requireLogin('contribute')) return;
            openAddSongPicker({
                mode: 'contribute',
                targetSlug: currentWork.id,
                title: currentWork.title,
                artist: currentWork.artist,
                key: currentWork.key,
            });
        });
    });

    // Wire request button
    section.querySelector('#work-bounty-request-btn')?.addEventListener('click', () => {
        if (!requireLogin('request parts')) return;
        openBountyRequestInline(section, currentWork);
    });

    return section;
}

/**
 * Open inline bounty request form within the work view.
 */
function openBountyRequestInline(section, work) {
    const body = section.querySelector('#work-bounty-body');
    if (!body) return;

    if (body.querySelector('.work-bounty-inline-form')) return;

    const form = document.createElement('div');
    form.className = 'work-bounty-inline-form';
    form.innerHTML = `
        <select class="work-bounty-inline-select" id="work-bounty-inline-type">
            <option value="lead-sheet">Lyrics & Chords</option>
            <option value="tablature:banjo">Banjo Tab</option>
            <option value="tablature:guitar">Guitar Tab</option>
            <option value="tablature:fiddle">Fiddle Tab</option>
            <option value="tablature:mandolin">Mandolin Tab</option>
            <option value="abc-notation">ABC Notation</option>
            <option value="document">PDF / Document</option>
        </select>
        <input type="text" class="work-bounty-inline-desc" placeholder="Details (optional)" id="work-bounty-inline-desc" />
        <div class="work-bounty-inline-actions">
            <button class="work-bounty-inline-submit" id="work-bounty-inline-submit">Submit</button>
            <button class="work-bounty-inline-cancel" id="work-bounty-inline-cancel">Cancel</button>
        </div>
        <div class="work-bounty-inline-status" id="work-bounty-inline-status"></div>
    `;

    body.insertBefore(form, body.querySelector('#work-bounty-request-btn'));

    form.querySelector('#work-bounty-inline-cancel').addEventListener('click', () => form.remove());

    form.querySelector('#work-bounty-inline-submit').addEventListener('click', async () => {
        const supabase = window.SupabaseAuth?.supabase;
        const user = window.SupabaseAuth?.getUser?.();
        if (!supabase || !user) return;

        const typeValue = form.querySelector('#work-bounty-inline-type').value;
        const [partType, instrument] = typeValue.includes(':') ? typeValue.split(':') : [typeValue, null];
        const description = form.querySelector('#work-bounty-inline-desc').value.trim() || null;
        const statusDiv = form.querySelector('#work-bounty-inline-status');
        const submitBtn = form.querySelector('#work-bounty-inline-submit');

        submitBtn.disabled = true;
        statusDiv.textContent = 'Submitting...';

        try {
            const { error } = await supabase.from('bounties').insert({
                work_id: work.id,
                part_type: partType,
                instrument,
                description,
                created_by: user.id,
            });

            if (error) {
                statusDiv.textContent = error.code === '23505'
                    ? 'Already requested!'
                    : `Error: ${error.message}`;
                submitBtn.disabled = false;
                return;
            }

            statusDiv.innerHTML = '<span style="color: var(--success)">Request submitted!</span>';
            if (window.refreshBounties) await window.refreshBounties();
            setTimeout(() => renderWorkView(), 800);
        } catch (e) {
            statusDiv.textContent = `Error: ${e.message}`;
            submitBtn.disabled = false;
        }
    });
}

// ============================================
// PLACEHOLDER METADATA EDITOR
// ============================================

/**
 * Show inline editor for placeholder metadata (title, artist, key, notes).
 * Replaces the dashboard content area with an edit form.
 */
function showPlaceholderEditor() {
    if (!requireLogin('edit placeholder metadata')) return;
    if (!currentWork) return;

    const container = document.getElementById('song-content');
    if (!container) return;

    // Replace content with edit form
    container.innerHTML = '';

    const form = document.createElement('div');
    form.className = 'placeholder-editor';

    const keyOptions = CHROMATIC_MAJOR_KEYS.map(k =>
        `<option value="${k}" ${k === (currentWork.key || '') ? 'selected' : ''}>${k}</option>`
    ).join('');

    // Current document info
    const existingDoc = currentWork.document_parts?.[0];
    const pendingDoc = window.__pendingDocuments?.[currentWork.id];
    const hasDoc = !!(existingDoc || pendingDoc);
    const docLabel = existingDoc?.label || pendingDoc?.label || '';

    form.innerHTML = `
        <div class="placeholder-editor-header">
            <h3>Edit Placeholder</h3>
        </div>
        <div class="placeholder-editor-form">
            <div class="placeholder-editor-field">
                <label for="ph-edit-title">Title</label>
                <input type="text" id="ph-edit-title" value="${escapeHtml(currentWork.title || '')}" />
            </div>
            <div class="placeholder-editor-field">
                <label for="ph-edit-artist">Artist</label>
                <input type="text" id="ph-edit-artist" value="${escapeHtml(currentWork.artist || '')}" />
            </div>
            <div class="placeholder-editor-field">
                <label for="ph-edit-key">Key</label>
                <select id="ph-edit-key">
                    <option value="">None</option>
                    ${keyOptions}
                </select>
            </div>
            <div class="placeholder-editor-field">
                <label for="ph-edit-notes">Notes</label>
                <textarea id="ph-edit-notes" rows="3">${escapeHtml(currentWork.notes || '')}</textarea>
            </div>
            <div class="placeholder-editor-field">
                <label>Document</label>
                <div class="ph-edit-doc-section">
                    ${hasDoc
                        ? `<div class="ph-edit-doc-current">
                               <span class="ph-edit-doc-icon">📎</span>
                               <span class="ph-edit-doc-label">${escapeHtml(docLabel)}</span>
                               <span class="ph-edit-doc-badge">PDF</span>
                           </div>`
                        : '<div class="ph-edit-doc-empty">No document attached</div>'
                    }
                    <div class="ph-edit-doc-picker">
                        <input type="file" id="ph-edit-doc-file" accept=".jpg,.jpeg,.png,.heic,.webp,.pdf" class="hidden" />
                        <button type="button" id="ph-edit-doc-btn" class="ph-edit-doc-upload-btn">
                            ${hasDoc ? 'Replace document' : 'Add document'}
                        </button>
                        <div id="ph-edit-doc-info" class="ph-edit-doc-info hidden"></div>
                    </div>
                </div>
            </div>
            <div class="placeholder-editor-actions">
                <button class="placeholder-editor-save" id="ph-edit-save">Save</button>
                <button class="placeholder-editor-cancel" id="ph-edit-cancel">Cancel</button>
            </div>
            <div class="placeholder-editor-status" id="ph-edit-status"></div>
        </div>
    `;

    container.appendChild(form);

    // Document file picker state
    let newDocFile = null;

    const docFileInput = form.querySelector('#ph-edit-doc-file');
    const docBtn = form.querySelector('#ph-edit-doc-btn');
    const docInfo = form.querySelector('#ph-edit-doc-info');

    docBtn.addEventListener('click', () => docFileInput.click());

    docFileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const MAX_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            docInfo.textContent = `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`;
            docInfo.className = 'ph-edit-doc-info error';
            docInfo.classList.remove('hidden');
            return;
        }

        newDocFile = file;
        docInfo.innerHTML = `
            <span class="ph-edit-doc-filename">${escapeHtml(file.name)}</span>
            <span class="ph-edit-doc-size">(${(file.size / 1024).toFixed(0)} KB)</span>
            <button type="button" class="ph-edit-doc-remove" title="Remove">&times;</button>
        `;
        docInfo.className = 'ph-edit-doc-info';
        docInfo.classList.remove('hidden');
        docBtn.textContent = 'Change file';

        docInfo.querySelector('.ph-edit-doc-remove')?.addEventListener('click', () => {
            newDocFile = null;
            docFileInput.value = '';
            docInfo.classList.add('hidden');
            docBtn.textContent = hasDoc ? 'Replace document' : 'Add document';
        });
    });

    // Cancel: re-render dashboard
    form.querySelector('#ph-edit-cancel').addEventListener('click', () => {
        renderWorkView();
    });

    // Save
    form.querySelector('#ph-edit-save').addEventListener('click', async () => {
        const title = form.querySelector('#ph-edit-title').value.trim();
        const artist = form.querySelector('#ph-edit-artist').value.trim();
        const key = form.querySelector('#ph-edit-key').value;
        const notes = form.querySelector('#ph-edit-notes').value.trim();
        const statusDiv = form.querySelector('#ph-edit-status');
        const saveBtn = form.querySelector('#ph-edit-save');

        if (!title) {
            statusDiv.textContent = 'Title is required';
            statusDiv.className = 'placeholder-editor-status error';
            return;
        }

        saveBtn.disabled = true;
        statusDiv.textContent = newDocFile ? 'Uploading document...' : 'Saving...';
        statusDiv.className = 'placeholder-editor-status';

        try {
            const isTrusted = await window.SupabaseAuth?.isTrustedUser?.();

            if (isTrusted) {
                await savePlaceholderMetadataTrusted({ title, artist, key, notes });
                if (newDocFile) {
                    statusDiv.textContent = 'Uploading document...';
                    await uploadPlaceholderDocument(newDocFile, title);
                }
            } else {
                await savePlaceholderMetadataIssue({ title, artist, key, notes });
                if (newDocFile) {
                    statusDiv.textContent = 'Uploading document...';
                    await uploadPlaceholderDocumentRegular(newDocFile, title);
                }
            }

            statusDiv.innerHTML = '<span style="color: var(--success)">Saved!</span>';

            // Update in-memory work data and re-render after brief delay
            currentWork.title = title;
            currentWork.artist = artist;
            currentWork.key = key;
            currentWork.notes = notes;
            setTimeout(() => renderWorkView(), 600);
        } catch (e) {
            statusDiv.textContent = `Error: ${e.message}`;
            statusDiv.className = 'placeholder-editor-status error';
            saveBtn.disabled = false;
        }
    });
}

/**
 * Save placeholder metadata as trusted user via Supabase pending_songs.
 */
async function savePlaceholderMetadataTrusted({ title, artist, key, notes }) {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) throw new Error('Not connected to database');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not logged in');

    const user = window.SupabaseAuth?.getUser?.();

    // A metadata-only save must not blank out existing ChordPro, which now
    // lives in data/songs/{id}.pro — fetch it before writing the row back
    const existingContent = await getSongContent(currentWork).catch(() => null);

    const entry = {
        id: currentWork.id,
        replaces_id: currentWork.id,
        title,
        artist: artist || null,
        content: existingContent || null,
        key: key || null,
        notes: notes || null,
        status: 'placeholder',
        tags: currentWork.tags || {},
        created_by: user?.id || null,
    };

    const { error } = await supabase
        .from('pending_songs')
        .upsert(entry, { onConflict: 'id' });

    if (error) throw new Error(error.message);

    // Refresh to merge into allSongs
    if (window.refreshPendingSongs) {
        await window.refreshPendingSongs();
    }
}

/**
 * Save placeholder metadata as regular user via GitHub issue.
 */
async function savePlaceholderMetadataIssue({ title, artist, key, notes }) {
    const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

    const user = window.SupabaseAuth?.getUser?.();
    const submitter = user?.user_metadata?.full_name || user?.email || 'Anonymous User';

    const body = [
        `**Work ID:** ${currentWork.id}`,
        `**Current Title:** ${currentWork.title}`,
        `**Proposed Title:** ${title}`,
        artist !== currentWork.artist ? `**Proposed Artist:** ${artist}` : '',
        key !== currentWork.key ? `**Proposed Key:** ${key}` : '',
        notes !== currentWork.notes ? `**Proposed Notes:** ${notes}` : '',
        '',
        `Submitted by: ${submitter}`,
    ].filter(Boolean).join('\n');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-song-issue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
            type: 'correction',
            title: `Update placeholder metadata: ${title}`,
            songId: currentWork.id,
            chordpro: `{meta: title ${title}}\n{meta: artist ${artist}}\n{key: ${key}}\n`,
            comment: `Placeholder metadata update:\n${body}`,
            submittedBy: submitter,
        }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to submit');
    }
}

/**
 * Convert an image file to PDF bytes using pdf-lib (lazy-loaded).
 */
async function imageToPdfBlob(imageFile) {
    // Lazy-load pdf-lib
    if (!window.PDFLib) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load pdf-lib'));
            document.head.appendChild(script);
        });
    }
    const PDFLib = window.PDFLib;
    const pdfDoc = await PDFLib.PDFDocument.create();

    const arrayBuffer = await imageFile.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let image;
    if (imageFile.type === 'image/png') {
        image = await pdfDoc.embedPng(bytes);
    } else {
        // Convert to JPEG via canvas
        const jpegBytes = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(imageFile);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                canvas.toBlob(
                    (blob) => { URL.revokeObjectURL(url); blob ? blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))) : reject(new Error('Canvas to blob failed')); },
                    'image/jpeg', 0.92
                );
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
            img.src = url;
        });
        image = await pdfDoc.embedJpg(jpegBytes);
    }

    const maxW = 612, maxH = 792;
    let { width, height } = image.scale(1);
    if (width > maxW || height > maxH) {
        const scale = Math.min(maxW / width, maxH / height);
        width *= scale;
        height *= scale;
    }
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

/**
 * Upload a document for a placeholder (trusted user flow).
 */
async function uploadPlaceholderDocument(file, label) {
    const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) throw new Error('Not connected to database');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not logged in');

    // Convert images to PDF
    let pdfBlob = file;
    if (file.type !== 'application/pdf') {
        pdfBlob = await imageToPdfBlob(file);
    }

    const arrayBuffer = await pdfBlob.arrayBuffer();
    const base64 = btoa(new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), ''));

    const filename = file.type === 'application/pdf'
        ? file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        : currentWork.id + '.pdf';

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/auto-commit-song`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            id: currentWork.id,
            title: currentWork.title,
            artist: currentWork.artist,
            content: null,
            create_placeholder: true,
            key: currentWork.key || null,
            attachment: { filename, base64, label: label || currentWork.title },
        }),
    });

    if (!resp.ok) {
        const body = await resp.text();
        console.warn('Auto-commit response:', body);
    }

    // Stash blob URL for immediate display
    if (!window.__pendingDocuments) window.__pendingDocuments = {};
    window.__pendingDocuments[currentWork.id] = {
        url: URL.createObjectURL(pdfBlob),
        label: label || currentWork.title,
    };
}

/**
 * Upload a document for a placeholder (regular user flow — stages for review).
 */
async function uploadPlaceholderDocumentRegular(file, label) {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) throw new Error('Not connected to database');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not logged in');

    // Convert images to PDF
    let pdfBlob = file;
    if (file.type !== 'application/pdf') {
        pdfBlob = await imageToPdfBlob(file);
    }

    const filename = file.type === 'application/pdf'
        ? file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        : currentWork.id + '.pdf';

    // Upload to staging bucket
    const storagePath = `${session.user.id}/${currentWork.id}/${filename}`;
    const { error: uploadError } = await supabase.storage
        .from('doc-staging')
        .upload(storagePath, pdfBlob, { contentType: 'application/pdf' });

    if (uploadError) throw new Error(uploadError.message);

    // Insert staging metadata
    const { error: dbError } = await supabase
        .from('doc_staging')
        .insert({
            user_id: session.user.id,
            work_id: currentWork.id,
            storage_path: storagePath,
            label: label || currentWork.title,
            file_size: pdfBlob.size,
        });

    if (dbError) throw new Error(dbError.message);
}

// ============================================
// PART RENDERERS (tablature + document; lead sheets render via
// song-view.js renderLeadSheetContent)
// ============================================

function renderDocumentPart(part, container) {
    const downloadUrl = part.file;
    const label = escapeHtml(part.label || 'Document');

    const pendingBanner = part.pending
        ? `<div class="upload-processing-banner">
            Your upload is saved! It may take a few minutes to appear for other users.
           </div>`
        : '';

    container.innerHTML = `
        ${pendingBanner}
        <div class="document-viewer">
            <div class="document-toolbar">
                <span class="document-label">${label}</span>
                <a href="${downloadUrl}" download class="document-download-btn">Download PDF</a>
            </div>
            <object data="${downloadUrl}" type="application/pdf" class="pdf-embed">
                <p>PDF cannot be displayed inline. <a href="${downloadUrl}">Download instead</a>.</p>
            </object>
        </div>
    `;
}

/**
 * Render tablature part
 */
async function renderTablaturePart(part, container) {
    container.innerHTML = '<div class="loading">Loading tablature...</div>';

    try {
        // Load OTF data. cache: 'no-cache' = revalidate with the server
        // (304 if unchanged) — Chrome's heuristic freshness otherwise
        // serves long-unchanged tab files for WEEKS after they are
        // re-published (a January parse of cherokee-shuffle-a survived
        // multiple hard reloads and rendered 2/2 left-packed measures
        // over the corrected data).
        let otf = loadedTablature;
        if (!otf || otf._partFile !== part.file) {
            const response = await fetch(part.file, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`Failed to load ${part.file}`);
            otf = await response.json();
            otf._partFile = part.file;
            setLoadedTablature(otf);
        }

        container.innerHTML = '';
        destroyTrackRenderers(); // disconnect old theme/resize observers

        // Playback controls + track mixer live in the app's bottom band
        const controls = createTablatureControls(otf, part);
        setBottomBand(controls);

        // Track VIEW tabs (which staff you see; audio = mixer/Solo).
        // One visible track at a time kills the nested-scroll fights and
        // the 'cursors in different places' confusion — plus [All] for
        // the stacked view. (True score view — every instrument's same
        // measures aligned in one system — needs cross-track measure
        // widths and is queued in the handoff.)
        const trackTabsBar = document.createElement('div');
        trackTabsBar.className = 'track-view-tabs';
        container.appendChild(trackTabsBar);

        // Create container for all tracks
        const allTracksContainer = document.createElement('div');
        allTracksContainer.className = 'tablature-all-tracks';
        container.appendChild(allTracksContainer);

        const timeSignature = otf.metadata?.time_signature || '4/4';
        const ticksPerBeat = otf.timing?.ticks_per_beat || 480;

        // Ts-change-aware timing for the current display mode
        const timings = buildOtfTimings(otf, showRepeatsCompact && otf.reading_list?.length > 0);

        // Determine which track is the "lead" (matches part instrument, or
        // first track). Percussion can never be the lead.
        const pitched = pitchedTracks(otf.tracks);
        let leadTrackId = pitched[0]?.id;
        if (part.instrument && pitched.length > 1) {
            const matchingTrack = pitched.find(t =>
                t.instrument?.includes(part.instrument) ||
                t.id?.includes(part.instrument)
            );
            if (matchingTrack) {
                leadTrackId = matchingTrack.id;
            }
        }

        // Track ids that own a section, in document order — rendered staves
        // AND percussion placeholders (which have no renderer).
        const viewIds = [];

        for (const track of otf.tracks) {
            let notation = otf.notation[track.id];
            if (!notation || notation.length === 0) continue;

            // Percussion is SHOWN but not drawn: we can detect a drum track
            // reliably, but not yet which drum each staff line means, so a
            // pitched stave would be fiction. Say so instead of hiding it.
            // See otf-tracks.js and sources/banjo-hangout/CLAUDE.md.
            if (isPercussionTrack(track)) {
                const section = document.createElement('div');
                section.className = 'tablature-track-section percussion-track';
                section.dataset.trackId = track.id;
                section.style.display =
                    (activeTrackView === 'all' || (activeTrackView ?? leadTrackId) === track.id)
                        ? 'block' : 'none';
                section.innerHTML = `
                    <div class="percussion-placeholder">
                        <div class="percussion-placeholder-head">
                            <span class="percussion-icon">🥁</span>
                            <span class="percussion-name">${escapeHtml(track.id)}</span>
                        </div>
                        <p class="percussion-note">
                            Drum notation is in progress — this arrangement has a
                            percussion track, but it isn't displayed or played yet.
                        </p>
                    </div>`;
                allTracksContainer.appendChild(section);
                viewIds.push(track.id);
                continue;
            }

            const isLead = track.id === leadTrackId || track.role === 'lead';
            const isMandolin = track.instrument?.includes('mandolin') || track.id?.includes('mandolin');

            if (isMandolin && !isLead) continue;

            // OTF omits silent measures; fill them so empty bars render
            // (through the ALL-track max, keeping tracks time-aligned).
            notation = densifyNotation(notation, maxMeasureIn(otf.notation));

            // Free-text annotations + reading-list section labels
            // (display copy; attach after densify — annotations may
            // target silent measures).
            notation = attachOtfDecorations(notation, otf);
            if (showRepeatsCompact && otf.reading_list && otf.reading_list.length > 0) {
                notation = prepareCompactNotation(notation, otf.reading_list);
            } else if (otf.reading_list && otf.reading_list.length > 0) {
                notation = expandNotation(notation, timings.playbackTimeline);
            }
            const trackSection = document.createElement('div');
            trackSection.className = `tablature-track-section${isLead ? '' : ' backup-track'}`;
            trackSection.dataset.trackId = track.id;
            trackSection.style.display =
                (activeTrackView === 'all' || (activeTrackView ?? leadTrackId) === track.id)
                    ? 'block' : 'none';

            // (No separate section header — the renderer's own track-info
            // row carries icon/name/tuning, and Solo is injected onto it
            // by setupTablaturePlayer. One label layer per track.)

            const tabContainer = document.createElement('div');
            tabContainer.className = 'tablature-container';
            trackSection.appendChild(tabContainer);

            allTracksContainer.appendChild(trackSection);

            const renderer = new TabRenderer(tabContainer);
            renderer.render(track, notation, ticksPerBeat, timeSignature, timings.visual);
            trackRenderers[track.id] = renderer;
            viewIds.push(track.id);
        }

        // Populate the view tabs from every track that owns a section
        if (viewIds.length > 1) {
            const current = activeTrackView ?? leadTrackId;
            // Labelled so it reads as "which staff am I looking at", not as
            // an unexplained row of instrument names next to the Sound row.
            trackTabsBar.innerHTML = [
                '<span class="track-view-label">View track</span>',
                ...viewIds.map(id => `
                    <button class="track-view-tab${id === current ? ' active' : ''}"
                            data-view="${id}">${escapeHtml(id)}</button>`),
                `<button class="track-view-tab${current === 'all' ? ' active' : ''}"
                         data-view="all">All</button>`,
            ].join('');
            trackTabsBar.addEventListener('click', (e) => {
                const btn = e.target.closest('.track-view-tab');
                if (!btn) return;
                activeTrackView = btn.dataset.view;
                trackTabsBar.querySelectorAll('.track-view-tab').forEach(b =>
                    b.classList.toggle('active', b === btn));
                for (const section of allTracksContainer.querySelectorAll('.tablature-track-section')) {
                    section.style.display =
                        (activeTrackView === 'all' || section.dataset.trackId === activeTrackView)
                            ? 'block' : 'none';
                }
            });
        } else {
            trackTabsBar.remove();
        }

        // Track checkboxes control AUDIO only — the view tabs decide
        // what you SEE. Default: the lead track sounds. Toggles apply
        // LIVE during playback (per-track gain buses in TabPlayer).
        const trackCheckboxes = controls.querySelectorAll('.track-checkbox');
        trackCheckboxes.forEach(checkbox => {
            checkbox.checked = checkbox.dataset.trackId === leadTrackId;
            checkbox.addEventListener('change', () => {
                tablaturePlayer?.setTrackEnabled?.(
                    checkbox.dataset.trackId, checkbox.checked);
            });
        });

        // Wire up repeat notation buttons (re-renders with repeat signs
        // or unrolled)
        controls.querySelectorAll('.tab-repeat-group .pill-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                showRepeatsCompact = btn.dataset.val === 'repeats';
                renderTablaturePart(part, container);
            });
        });

        // Wire up two-feel buttons (cut-time presentation, re-render)
        controls.querySelectorAll('.tab-feel-group .pill-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                twoFeelMode = btn.dataset.val === 'two';
                renderTablaturePart(part, container);
            });
        });

        const leadRenderer = trackRenderers[leadTrackId] || Object.values(trackRenderers)[0];
        setupTablaturePlayer(otf, controls, leadRenderer);

        // Wire up the Edit button — swap the rendered tab for an edit session
        const editBtn = controls.querySelector('.tab-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => enterTabEditMode(otf, part, container));
        }

        // Credit the arrangement that's actually on screen — `part` carries
        // the loaded arrangement's fields (see applyArrangement), so this
        // follows an arrangement switch instead of naming the pinned default.
        if (part.author || part.source_page_url) {
            const attribution = document.createElement('div');
            attribution.className = 'tab-attribution';

            let attrHtml = '<div class="attribution-content">';
            if (part.author) {
                attrHtml += '<span class="attribution-item">Tabbed by ';
                if (part.author_url) {
                    attrHtml += `<a href="${escapeHtml(part.author_url)}" target="_blank" rel="noopener">${escapeHtml(part.author)}</a>`;
                } else {
                    attrHtml += escapeHtml(part.author);
                }
                attrHtml += '</span>';
            }
            if (part.source_page_url) {
                const where = prettySource(part.source) || 'the source site';
                attrHtml += `<span class="attribution-item"><a href="${escapeHtml(part.source_page_url)}" target="_blank" rel="noopener">View on ${escapeHtml(where)}</a></span>`;
            }
            attrHtml += '</div>';
            attrHtml += '<div class="attribution-disclaimer">';
            attrHtml += 'This tab was converted from TablEdit format and may contain minor errors. ';
            attrHtml += 'Please report issues if you notice problems.';
            attrHtml += '</div>';

            attribution.innerHTML = attrHtml;
            container.appendChild(attribution);
        }

    } catch (e) {
        console.error('Error loading tablature:', e);
        container.innerHTML = `<div class="error">Failed to load tablature: ${escapeHtml(e.message)}</div>`;
    }
}

/**
 * Enter edit mode for a tablature part: mount the OTF editor over the
 * rendered tab. Done/Ctrl+S applies the edited document back to the
 * view (in memory) and re-renders; Cancel restores the original.
 * Editor + session code are lazy-imported so readers never pay for it.
 */
async function enterTabEditMode(otf, part, container) {
    // Stop playback before handing the document to the editor
    if (tablaturePlayer?.isPlaying) {
        tablaturePlayer.stop();
    }

    const [{ OTFEditor }, { createTabEditSession, resolveEditTrackId }, { submitTab }] = await Promise.all([
        import('./otf-editor/editor.js'),
        import('./otf-editor/work-edit.js'),
        import('./otf-editor/submit-tab.js'),
    ]);

    // Park the bottom-band controls while editing (they drive dead renderers)
    const editNotice = document.createElement('div');
    editNotice.className = 'tab-controls';
    editNotice.innerHTML = '<em>Editing — use the editor bar below. ✓ Done applies your changes, Cancel discards them.</em>';
    setBottomBand(editNotice);

    // The rendered-view renderers are about to be detached — drop their
    // observers now; renderTablaturePart rebuilds them on exit.
    destroyTrackRenderers();
    container.innerHTML = '';
    const baseName = (part.file || 'tab').split('/').pop().replace(/\.otf\.json$/, '');

    activeEditSession = createTabEditSession({
        mount: container,
        otf,
        trackId: resolveEditTrackId(otf, part.instrument),
        filename: `${baseName}-edited`,
        editorFactory: (opts) => new OTFEditor(opts),
        onApply: (doc) => {
            doc._partFile = part.file; // keep the view cache keyed to this part
            setLoadedTablature(doc);
        },
        onExit: () => {
            activeEditSession = null;
            renderTablaturePart(part, container);
        },
        // Save-back: same human-approved GitHub-issue pipeline as song
        // corrections — the editor's payoff beyond Download
        onSubmit: (doc, comment) => submitTab({
            type: 'tab-correction',
            otf: doc,
            title: currentWork?.title || doc.metadata?.title || 'Untitled',
            instrument: part.instrument || 'banjo',
            workId: currentWork?.id,
            comment,
        }),
    });
}

/**
 * Create tablature controls
 */
function createTablatureControls(otf, part) {
    const quarterBpm = (tempoOverride && tempoOverride.workId === currentWork?.id)
        ? tempoOverride.quarterBpm
        : (otf.metadata?.tempo || 100);
    // Displayed BPM is per BEAT of the current feel: in two feel (cut
    // time) the beat is a half note, so the same absolute speed shows
    // as half the number (240 quarters == 120 in cut time).
    const defaultTempo = Math.round(quarterBpm / (twoFeelMode ? 2 : 1));
    const originalKey = currentWork.key || 'G';

    // Percussion is dropped up front: it has no tuning to sound (otf-tracks.js)
    const filteredTracks = pitchedTracks(otf.tracks).filter(track => {
        const isMandolin = track.instrument?.includes('mandolin') || track.id?.includes('mandolin');
        const isLead = track.role === 'lead' || track.instrument?.includes('banjo') ||
                       (part.instrument && track.instrument?.includes(part.instrument));
        return !isMandolin || isLead;
    });

    // No instrument emoji here — Unicode has 🪕/🎸/🎻 and nothing for
    // mandolin, upright bass or dobro, so they all collapsed to 🎸. Worse,
    // the icon was picked from track.instrument while the label comes from
    // track.id, so a mislabeled track (id "guitar", instrument
    // "5-string-banjo") showed a banjo next to the word "guitar". A speaker
    // labels the row; the options are plain text.
    const trackMixerHtml = filteredTracks.length > 1 ? `
        <div class="tab-track-mixer">
            <span class="mixer-label" title="Sound" aria-label="Sound">🔊</span>
            ${filteredTracks.map(track => {
                const isLead = track.role === 'lead' || track.instrument?.includes('banjo');
                const safeId = escapeHtml(track.id);
                return `<label class="track-toggle" title="${safeId}">
                    <input type="checkbox" class="track-checkbox" data-track-id="${safeId}" ${isLead ? 'checked' : ''}>
                    <span class="track-name">${safeId}</span>
                </label>`;
            }).join('')}
        </div>
    ` : '';

    const hasReadingList = otf.reading_list && otf.reading_list.length > 0;
    // Segmented buttons, not native selects — mobile browsers float select
    // menus over the band at odd sizes; buttons match the pill design.
    const repeatToggleHtml = hasReadingList ? `
        <div class="qc-group pill-mode-group tab-repeat-group" title="Repeat notation: unrolled or repeat signs">
            <button class="pill-mode-btn ${showRepeatsCompact ? '' : 'active'}" data-val="unrolled">Unrolled</button>
            <button class="pill-mode-btn ${showRepeatsCompact ? 'active' : ''}" data-val="repeats">Repeats</button>
        </div>
    ` : '';

    // Feel selector (4/4 tunes only): explicit buttons, no ambiguous
    // toggle state
    const feelToggleHtml = (otf.metadata?.time_signature || '4/4') === '4/4' ? `
        <div class="qc-group pill-mode-group tab-feel-group" title="Rhythmic feel: quarter-note pulse or cut time (BPM counts the feel's beat)">
            <button class="pill-mode-btn ${twoFeelMode ? '' : 'active'}" data-val="four">Four feel</button>
            <button class="pill-mode-btn ${twoFeelMode ? 'active' : ''}" data-val="two">Two feel</button>
        </div>
    ` : '';

    const controls = document.createElement('div');
    controls.className = 'tab-controls';
    controls.innerHTML = `
        <div class="qc-group">
            <button class="tab-size-down qc-btn" title="Decrease size">−</button>
            <span class="qc-label">Aa</span>
            <button class="tab-size-up qc-btn" title="Increase size">+</button>
        </div>
        <div class="qc-group qc-key-group">
            <button class="tab-key-down qc-btn" title="Transpose down">−</button>
            <span class="tab-key-slot"></span>
            <button class="tab-key-up qc-btn" title="Transpose up">+</button>
        </div>
        <div class="qc-group">
            <button class="tab-tempo-down qc-btn" title="Decrease tempo">−</button>
            <span class="qc-label tab-tempo-display">${defaultTempo}</span>
            <button class="tab-tempo-up qc-btn" title="Increase tempo">+</button>
        </div>
        <button class="tab-play-btn qc-toggle-btn">▶ Play</button>
        <button class="tab-stop-btn qc-toggle-btn" disabled>⏹ Stop</button>
        <button class="tab-edit-btn qc-toggle-btn" title="Edit this tab">✏️ Edit</button>
        <label class="tab-metronome-toggle">
            <input type="checkbox" class="tab-metronome-checkbox">
            <span class="tab-metronome-icon">🥁</span>
        </label>
        <label class="tab-countin-toggle" title="Count-in before looped phrases">
            <input type="checkbox" class="tab-countin-checkbox" checked>
            <span class="tab-countin-label">1·2·3·4</span>
        </label>
        <label class="tab-loop-toggle" title="Loop the whole song">
            <input type="checkbox" class="tab-loop-checkbox">
            <span class="tab-loop-label">🔁</span>
        </label>
        ${repeatToggleHtml}
        ${feelToggleHtml}
        <span class="tab-position"></span>
        <span class="tab-capo-indicator"></span>
        ${trackMixerHtml}
    `;

    // Key picker: a pill with a drop-up key grid (replaces the native
    // select). Exposes a tiny API on the controls element so
    // setupTablaturePlayer can read the capo and step keys.
    const keys = CHROMATIC_MAJOR_KEYS;
    const origIdx = Math.max(0, keys.indexOf(originalKey));
    let keyIdx = origIdx;
    const capoOf = (i) => (i - origIdx + 12) % 12;
    const changeListeners = [];

    const keyPill = pill(keys[keyIdx], (pop, api) => {
        pop.innerHTML = `<div class="pill-key-grid">${keys.map((k, i) => `
            <button class="pill-key-btn ${i === keyIdx ? 'active' : ''}" data-idx="${i}"
                title="${capoOf(i) ? `Capo ${capoOf(i)}` : 'Open'}">${k}</button>`).join('')}</div>`;
        pop.querySelectorAll('.pill-key-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setKeyIdx(parseInt(btn.dataset.idx, 10));
                api.close();
            });
        });
    }, { className: 'tab-key-pill', title: 'Select key' });

    const setKeyIdx = (i) => {
        keyIdx = Math.max(0, Math.min(keys.length - 1, i));
        keyPill.pillApi.setLabel(keys[keyIdx]);
        keyPill.pillApi.refresh();
        changeListeners.forEach(cb => cb());
    };

    controls.querySelector('.tab-key-slot').replaceWith(keyPill);
    controls._tabKey = {
        get capo() { return capoOf(keyIdx); },
        step: (delta) => setKeyIdx(keyIdx + delta),
        onChange: (cb) => changeListeners.push(cb),
    };

    return controls;
}

/**
 * Set up tablature player with controls
 */
function setupTablaturePlayer(otf, controls, renderer) {
    if (!tablaturePlayer) {
        setTablaturePlayer(new TabPlayer());
    }

    const player = tablaturePlayer;
    const playBtn = controls.querySelector('.tab-play-btn');
    const stopBtn = controls.querySelector('.tab-stop-btn');
    const loopCheckbox = controls.querySelector('.tab-loop-checkbox');
    const posEl = controls.querySelector('.tab-position');
    const tempoDisplay = controls.querySelector('.tab-tempo-display');
    const tempoDown = controls.querySelector('.tab-tempo-down');
    const tempoUp = controls.querySelector('.tab-tempo-up');
    const tabKey = controls._tabKey;
    const keyDown = controls.querySelector('.tab-key-down');
    const keyUp = controls.querySelector('.tab-key-up');
    const capoIndicator = controls.querySelector('.tab-capo-indicator');
    const metronomeCheckbox = controls.querySelector('.tab-metronome-checkbox');
    const sizeDown = controls.querySelector('.tab-size-down');
    const sizeUp = controls.querySelector('.tab-size-up');

    let currentTempo = parseInt(tempoDisplay.textContent, 10);
    let currentCapo = 0;
    let currentScale = 1.0;

    // Map playback ticks to visual ticks for compact mode: playback follows
    // the unrolled reading list while the display shows written measures.
    // Ts-change aware on both sides (measure-timing.js).
    const compact = showRepeatsCompact && otf.reading_list?.length > 0;
    const timings = buildOtfTimings(otf, compact);
    const tickMapper = compact
        ? makePlaybackToVisualMapper(timings.playback, timings.visual)
        : (tick) => tick;

    // Playback visualization callbacks (with tick mapping for compact mode).
    // Fan out to EVERY track's renderer so the cursor runs on all visible
    // parts; only the lead renderer drives auto-scroll.
    const eachRenderer = (fn) => {
        for (const r of Object.values(trackRenderers)) fn(r, r === renderer);
    };
    player.onTick = (absTick) => eachRenderer((r, isLead) =>
        r.updateBeatCursor(tickMapper(absTick), { autoScroll: isLead }));
    player.onNoteStart = (absTick) => eachRenderer(r => r.highlightNote(tickMapper(absTick)));
    player.onNoteEnd = (absTick) => eachRenderer(r => r.clearNoteHighlight(tickMapper(absTick)));

    const updateSize = (delta) => {
        currentScale = Math.max(0.6, Math.min(1.6, currentScale + delta));
        const container = document.querySelector('.tablature-container');
        if (container) {
            container.style.setProperty('--tab-scale', currentScale);
            if (typeof renderer.reflow === 'function') {
                renderer.reflow();
            }
        }
        sizeDown.disabled = currentScale <= 0.6;
        sizeUp.disabled = currentScale >= 1.6;
    };

    sizeDown?.addEventListener('click', () => updateSize(-0.1));
    sizeUp?.addEventListener('click', () => updateSize(0.1));

    metronomeCheckbox?.addEventListener('change', () => {
        player.metronomeEnabled = metronomeCheckbox.checked;
    });

    // Tempo controls
    // No ceiling — bluegrass runs past 240 in cut time. Floor keeps the
    // scheduler sane.
    const updateTempoButtons = () => {
        tempoDown.disabled = currentTempo <= 20;
    };

    const setTempo = (val) => {
        currentTempo = Math.max(20, Math.round(val));
        tempoDisplay.textContent = currentTempo;
        // Persist as quarter-note bpm so the feel toggle's re-render can
        // convert the display while keeping the actual speed.
        tempoOverride = {
            workId: currentWork?.id,
            quarterBpm: currentTempo * (twoFeelMode ? 2 : 1),
        };
        updateTempoButtons();
    };

    tempoDown?.addEventListener('click', () => setTempo(currentTempo - 5));
    tempoUp?.addEventListener('click', () => setTempo(currentTempo + 5));

    const updateCapoIndicator = () => {
        capoIndicator.textContent = currentCapo > 0 ? `Capo ${currentCapo}` : '';
    };

    // Key state lives with the key pill (created in createTablatureControls)
    tabKey?.onChange(() => {
        currentCapo = tabKey.capo;
        updateCapoIndicator();
    });

    keyDown?.addEventListener('click', () => tabKey?.step(-1));
    keyUp?.addEventListener('click', () => tabKey?.step(1));

    // Position updates — also SELF-HEAL the play button from player
    // truth: optimistic UI plus loop restarts and view switches can
    // desync the label from reality (Mike: 'the play button state is
    // lost'). While ticks arrive, the player IS playing.
    player.onPositionUpdate = (elapsed, total) => {
        const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
        posEl.textContent = `${fmt(elapsed)} / ${fmt(total)}`;
        if (!playBtn.classList.contains('playing')) {
            playBtn.textContent = '⏸ Pause';
            playBtn.classList.add('playing');
            stopBtn.disabled = false;
        }
    };

    player.onPlaybackEnd = () => {
        playBtn.textContent = armed?.kind === 'loop' ? '▶ Loop' : '▶ Play';
        playBtn.classList.remove('playing');
        stopBtn.disabled = true;
        posEl.textContent = '';
        eachRenderer(r => r.resetPlaybackVisualization());
    };

    const getEnabledTrackIds = () => {
        const checkboxes = controls.querySelectorAll('.track-checkbox:checked');
        if (checkboxes.length === 0) {
            return pitchedTracks(otf.tracks)
                .filter(t => {
                    const isMandolin = t.instrument?.includes('mandolin') || t.id?.includes('mandolin');
                    const isLead = t.role === 'lead' || t.instrument?.includes('banjo');
                    return !isMandolin || isLead;
                })
                .map(t => t.id);
        }
        return Array.from(checkboxes).map(cb => cb.dataset.trackId);
    };

    // Shared playback entry: the Play button executes whatever is
    // ARMED (cursor / phrase); nothing plays on click alone.
    const startPlayback = async (extra = {}) => {
        if (player.isPlaying) player.stop();
        playBtn.textContent = '⏸ Pause';
        playBtn.classList.add('playing');
        stopBtn.disabled = false;
        await player.play(otf, {
            // Player tempo is quarter-note bpm; the displayed number is
            // per-beat of the feel, so two feel plays twice as fast.
            tempo: currentTempo * (twoFeelMode ? 2 : 1),
            transpose: currentCapo,
            trackIds: getEnabledTrackIds(),
            feel: twoFeelMode ? 'two' : null,
            // Whole-song loop checkbox. A phrase-loop (drag) passes its own
            // loop:true + range via `extra`, which overrides this.
            loop: !!loopCheckbox?.checked,
            ...extra,
        });
        // play() can bail (superseded by a newer call, audio context
        // blocked) — reconcile the optimistic button with reality
        if (!player.isPlaying) {
            playBtn.classList.remove('playing');
            stopBtn.disabled = true;
            updatePlayLabel();
        }
    };

    // ARM-THEN-PLAY (Mike: clicking/highlighting must not auto-start):
    // click arms a play cursor at that BEAT; drag arms a whole-measure
    // phrase for looping (one-measure count-in optional). The Play
    // button label reflects what's armed; Esc disarms.
    let armed = null; // {kind:'cursor', tick} | {kind:'loop', ...range}
    let armedVisual = null; // {trackId, measure, tick} | {trackId, m0, m1}
    const updatePlayLabel = () => {
        if (player.isPlaying) return;
        playBtn.textContent = armed?.kind === 'loop' ? '▶ Loop' : '▶ Play';
    };
    const disarm = () => {
        armed = null;
        armedVisual = null;
        eachRenderer(r => r._playbackInteractions?.clearArmed());
        updatePlayLabel();
    };

    const countInCheckbox = controls.querySelector('.tab-countin-checkbox');
    const beatTicks = timings.measureTiming.beatTicksFor
        ? timings.measureTiming.beatTicksFor(1) : 480;
    const countInBeatsFor = () => {
        if (!countInCheckbox?.checked) return 0;
        return Math.max(1, Math.round(timings.measureTiming.ticksFor(1) / beatTicks));
    };

    // Solo button rides the renderer's track-info row (the only label
    // row per track now); re-injected after every renderer re-render.
    const injectSolo = (r, trackId) => {
        if (otf.tracks.length < 2) return;
        const info = r.container?.querySelector('.track-info');
        if (!info || info.querySelector('.track-solo')) return;
        const solo = document.createElement('button');
        solo.className = 'track-solo';
        solo.textContent = 'Solo';
        solo.title = 'Hear only this track (click again for all)';
        solo.addEventListener('click', () => {
            const boxes = [...controls.querySelectorAll('.track-checkbox')];
            const soloed = boxes.every(cb =>
                cb.checked === (cb.dataset.trackId === trackId));
            for (const cb of boxes) {
                const want = soloed ? true : cb.dataset.trackId === trackId;
                if (cb.checked !== want) {
                    cb.checked = want;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
        info.appendChild(solo);
    };

    const attachInteractions = (r, trackId) => {
        injectSolo(r, trackId);
        r._playbackInteractions?.destroy();
        r._playbackInteractions = attachTabPlaybackInteractions(r, {
            beatTicks,
            onPlayFrom: ({ measure, tick }) => {
                const t = playbackTickForPoint(
                    timings.playback, compact, measure, tick);
                if (t == null) return;
                armed = { kind: 'cursor', tick: t };
                armedVisual = { trackId, measure, tick };
                eachRenderer((other) => {
                    if (other !== r) other._playbackInteractions?.clearArmed();
                });
                updatePlayLabel();
            },
            onLoopMeasures: (m0, m1) => {
                const range = playbackRangeForMeasures(
                    timings.playback, compact, m0, m1);
                if (!range) return;
                armed = { kind: 'loop', ...range };
                armedVisual = { trackId, m0, m1 };
                eachRenderer((other) => {
                    if (other !== r) other._playbackInteractions?.clearArmed();
                });
                updatePlayLabel();
            },
        });
        // restore armed visuals after a renderer re-render
        if (armedVisual?.trackId === trackId) {
            if (armedVisual.m0 != null) {
                r._playbackInteractions.highlightMeasures(armedVisual.m0, armedVisual.m1);
            } else {
                r._playbackInteractions.armCaretAt(armedVisual.measure, armedVisual.tick);
            }
        }
    };
    for (const [trackId, r] of Object.entries(trackRenderers)) {
        attachInteractions(r, trackId);
        // renderer re-renders (resize, Bravura) rebuild the row SVGs —
        // reattach so the handlers survive
        r.onAfterRender = () => attachInteractions(r, trackId);
    }

    // Esc disarms (one live listener; replaced on re-render)
    if (workViewEscHandler) document.removeEventListener('keydown', workViewEscHandler);
    workViewEscHandler = (e) => {
        if (e.key === 'Escape' && document.contains(controls)) disarm();
    };
    document.addEventListener('keydown', workViewEscHandler);

    // Play/stop
    playBtn.addEventListener('click', async () => {
        if (player.isPlaying) {
            player.stop();
            updatePlayLabel();
            playBtn.classList.remove('playing');
            stopBtn.disabled = true;
            eachRenderer(r => r.resetPlaybackVisualization());
        } else if (armed?.kind === 'loop') {
            await startPlayback({
                startTick: armed.startTick, endTick: armed.endTick,
                loop: true, countInBeats: countInBeatsFor(),
            });
        } else if (armed?.kind === 'cursor') {
            await startPlayback({ startTick: armed.tick });
        } else {
            await startPlayback();
        }
    });

    stopBtn.addEventListener('click', () => {
        player.stop();
        playBtn.textContent = '▶ Play';
        playBtn.classList.remove('playing');
        stopBtn.disabled = true;
        posEl.textContent = '';
        eachRenderer(r => r.resetPlaybackVisualization());
    });
}

/**
 * Get the current item reference for list operations.
 * Returns "workId/partId" if viewing a specific part, or just "workId" for the dashboard.
 */
export function getActiveItemRef() {
    if (!currentWork) return null;
    // Part-qualified ref only when the user is on a non-default part of a
    // multi-part work; the plain work id is the common case.
    if (availableParts.length > 1 && activePart?.partId && !activePart.default) {
        return `${currentWork.id}/${activePart.partId}`;
    }
    return currentWork.id;
}

// ============================================
// EXPORTS
// ============================================

export {
    currentWork,
    activePart,
    availableParts,
    buildPartsFromIndex,
    sortArrangements,
    applyArrangement,
    activeArrangement,
    prettySource,
    tabLabel
};
