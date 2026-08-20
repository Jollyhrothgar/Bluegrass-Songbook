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

import { deleteAffordance } from './review-queue.js';

import {
    goBack,
    updateListContextClass, updateNavBar,
    stopAbcPlayback,
    renderLeadSheetContent,
    initKeyState
} from './song-view.js';
import {
    peekSongContent, songHasContent, songHasAbc,
    getArrangementContent, peekArrangementContent,
} from './song-content.js';
import { CHROMATIC_MAJOR_KEYS } from './chords.js';
import {
    escapeHtml, escapeAttr, safeUrl, partUsesSongActions, isPlaceholder,
    requireLogin, slugify, tabLabel, canEditWorkMetadata,
} from './utils.js';
import {
    accessToken, namespacedRowId, requestDurableWrite,
} from './otf-editor/submit-tab.js';
import { openAddSongPicker } from './add-song-picker.js';
import {
    launchTabCreator, createTabHref, editTabHref,
    presetForInstrument, sanitizeInstrument, submitNewTab,
} from './otf-editor/create-tab-entry.js';
import { buildNewTab, saveDraft, clearDraft, loadDraft } from './otf-editor/create-tab.js';
import {
    tabEntryPlan, renderExistingTabsPanel, partMatchesInstrument,
} from './otf-editor/existing-tabs.js';
import { bindBandToEditor } from './tab-edit-band.js';
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
import { attachTabControlsSheet } from './tab-controls-sheet.js';
import { buildKeyPill, buildDisplayPill, buildInfoPill, buildExportPill, handleExport } from './song-controls.js';
import {
    attachTabPlaybackInteractions, playbackTickForPoint, playbackRangeForMeasures,
} from './tab-playback-interactions.js';
import { showToast } from './toast.js';

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
let pendingTabEdit = null;       // parked "open this tab in the editor" ask
let pendingDraft = null;         // {id, otf, …} a `?draft=` route asked for
let activeEditBand = null;       // bottom band bound to the live editor
let tabAuthoring = null;         // {kind:'add'|'new', part, take, target, otf}
let takeStatusLine = null;       // "Submitted — live now…" under the take header

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
    if (activeEditBand) {
        activeEditBand.destroy();
        activeEditBand = null;
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

// Lead sheets that live on THIS work — the primary chart plus any fork
// `works_writer.fork_to_arrangement` landed on it (index row `arrangements`).
// A work with one lead sheet has an empty list and behaves exactly as before.
let currentArrangements = [];
let activeArrangementSlug = null;

/**
 * Normalize an index row's `arrangements` into the list the pill renders.
 *
 * Returns [] unless there is a real choice to make (two or more charts), so
 * every caller can treat "no arrangements" and "one arrangement" alike.
 * Exported for tests.
 */
export function leadSheetArrangements(song) {
    const raw = song?.arrangements;
    if (!Array.isArray(raw)) return [];
    const usable = raw
        .filter(a => a && (a.slug || a.file || typeof a.content === 'string'))
        .map((a, i) => ({ ...a, slug: a.slug || `p${i}` }));
    return usable.length < 2 ? [] : usable;
}

/**
 * Which arrangement a freshly opened page is showing.
 *
 * Normally the primary. But a row whose own `content` matches one of the
 * arrangements is an overlay of that arrangement — a pending fork, live in
 * the browser seconds after it was submitted and before the build has
 * published it — and the page is already rendering that text, so the pill
 * must agree. Exported for tests.
 */
export function initialArrangementSlug(song, arrangements) {
    if (!arrangements.length) return null;
    if (typeof song?.content === 'string' && song.content) {
        const match = arrangements.find(a => a.content === song.content);
        if (match) return match.slug;
    }
    return (arrangements.find(a => a.default) || arrangements[0]).slug;
}

/** The arrangement currently on screen (null when the work has only one). */
function activeLeadSheetArrangement() {
    if (!currentArrangements.length) return null;
    return currentArrangements.find(a => a.slug === activeArrangementSlug)
        || currentArrangements[0];
}

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
// `content` / `pending` / `pending_id` belong here too: a take that is still
// in the pending overlay carries its OTF inline (there is no published file
// to fetch yet), and switching AWAY from it must clear those — applyArrangement
// copies `arr[f]`, which is undefined on a published take, so the fields
// disappear on the way out for free.
const ARRANGEMENT_FIELDS = [
    'file', 'src_file', 'source', 'source_id', 'author', 'source_page_url',
    'author_url', 'difficulty', 'tuning', 'content', 'pending', 'pending_id',
    // A take that exists only in this browser session (the editor is open on
    // it and nothing has been submitted). Listed here so switching AWAY from
    // it clears the flag the same way `pending` clears.
    'provisional',
];

/**
 * What identifies the OTF currently in `loadedTablature`.
 *
 * Normally the published file path. A pending take has no file yet, so it is
 * keyed by its overlay row instead — without which a correction to a tab you
 * are already looking at would hit the cache and render the version it fixes.
 */
function otfCacheKey(part) {
    // A provisional take is being written right now — it has neither a
    // published file nor an overlay row, and it must never share a cache
    // slot with the take it will eventually sit beside.
    if (part?.provisional) return `provisional:${part.partId || part.instrument || 'new'}`;
    return part?.pending ? `pending:${part.pending_id}` : part?.file;
}

/**
 * The URL-safe names one take answers to in `#work/{slug}/edit/{ref}`.
 *
 * A take has up to three: the works/ filename a correction targets
 * (`src_file` — the stable one), the published file's basename, and its
 * own label. All three are minted from data, so all three are accepted;
 * `takeEditRef` picks which one a link we mint uses.
 */
function fileStem(path) {
    return String(path || '').split('/').pop().replace(/\.otf\.json$/, '');
}

export function takeRefs(arr) {
    const refs = new Set();
    if (arr?.src_file) refs.add(fileStem(arr.src_file));
    if (arr?.file) refs.add(fileStem(arr.file));
    if (arr?.label) refs.add(slugify(arr.label));
    refs.delete('');
    return [...refs];
}

/** The ref a link to this take should use. */
export function takeEditRef(part) {
    return takeRefs(part)[0] || part?.partId || null;
}

/**
 * Find the take a `#work/{slug}/edit/{ref}` URL names.
 * @returns {{part: Object, index: number}|null}
 */
export function findTakeByRef(parts, ref) {
    if (!ref) return null;
    for (const part of parts || []) {
        if (part.type !== 'tablature') continue;
        const takes = part.arrangements || [part];
        const index = takes.findIndex(a => takeRefs(a).includes(ref));
        if (index >= 0) return { part, index };
    }
    return null;
}

/**
 * The OTF document for a tablature take.
 *
 * Two sources, one of which is new. A published take is FETCHED, exactly as
 * it always was — `cache: 'no-cache'` means revalidate with the server (304
 * if unchanged), because Chrome's heuristic freshness otherwise serves
 * long-unchanged tab files for WEEKS after they are re-published (a January
 * parse of cherokee-shuffle-a survived multiple hard reloads and rendered
 * 2/2 left-packed measures over the corrected data).
 *
 * A PENDING take has nothing to fetch: it was submitted seconds ago and its
 * document lives in the overlay row (corpus.overlayPendingTabParts), where
 * it is still the string it was stored as. Parsing that string is the whole
 * branch — no request, and the committed path above it is untouched.
 */
export async function loadPartOtf(part, fetchImpl = fetch) {
    if (part?.pending) {
        try {
            return JSON.parse(part.content);
        } catch {
            throw new Error('This tab was just submitted and could not be read back.');
        }
    }
    const response = await fetchImpl(part.file, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Failed to load ${part.file}`);
    return response.json();
}

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
 * Build the parts list from index data. Each part gets a unique `partId`
 * slug derived from its label, used in URLs (#work/{id}/{partId}) and
 * list references.
 *
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
    // Synchronous, before the view is entered: the currentView subscriber
    // deliberately does NOT tear down on the way IN (see main.js), so every
    // path that enters the song view owns this itself.
    teardownTablatureView();
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

    // An edit intent belongs to the work it was filed for; navigating
    // anywhere else drops it rather than leaving it armed.
    if (pendingTabEdit && pendingTabEdit.workId !== workId) pendingTabEdit = null;

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
        // §9.2 — the editor is a MODE of this page, addressed by URL:
        //   editRef: open THIS take in the editor once it renders
        //   addTab:  {instrument, title, otf} — a new, unsaved take
        editRef = null, addTab = null,
        //   draft:   {id, otf} read out of the drafts bucket by `?draft=`
        draft = null,
    } = options;

    if (!song) {
        // Real error state with a way out, not a dead-end spinner
        console.error(`Work not found: ${workId}`);
        teardownTablatureView();   // entering the song view owns its teardown
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
    tabAuthoring = null;
    takeStatusLine = null;
    // Every openWork sets this — an unconsumed draft from a route the reader
    // navigated away from must not leak into the next editor mount.
    pendingDraft = draft;

    currentWork = song;
    currentArrangements = leadSheetArrangements(song);
    activeArrangementSlug = initialArrangementSlug(song, currentArrangements);
    // Content comes from data/songs/{id}.pro on demand. Whatever we already
    // have (legacy inline row, cached fetch) renders synchronously; otherwise
    // the lead-sheet part fetches itself with a loading state.
    const knownContent = currentArrangements.length
        ? peekArrangementContent(song, activeLeadSheetArrangement())
        : peekSongContent(song);
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

    // `#work/{slug}/edit/{ref}` names ONE take, which may not be the take (or
    // even the instrument) the page would open on its own. Resolve it before
    // the first render so the editor opens on the tab the URL asked for.
    if (editRef) {
        const found = findTakeByRef(availableParts, editRef);
        if (found) {
            activePart = found.part;
            found.part.arrangementIndex = 0;   // applyArrangement is a no-op at 0
            applyArrangement(found.part, found.index);
            pendingTabEdit = { workId, ref: editRef, file: found.part.file };
        }
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

    // `#work/{slug}/add-tab` — the song page, plus one new empty take with
    // the editor open on it. Everything above already drew the page it will
    // be published on; this only adds the take.
    if (addTab) startAddTabMode(addTab);

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
    // placeholders / empty works and any work with open bounties — never on
    // a provisional work, which has no id to hang a bounty off.
    if (!currentWork.provisional &&
        (isPlaceholder(currentWork) || availableParts.length === 0 ||
         getBountiesForWork(currentWork.id).length > 0)) {
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
    const arrangement = activeLeadSheetArrangement();

    container.innerHTML = '<div class="part-loading">Loading song…</div>';
    setBottomBand(null);

    getArrangementContent(work, arrangement).then(text => {
        // Bail if the reader has navigated on (or switched arrangements)
        // while we were fetching
        if (currentWork !== work || activePart !== part ||
            activeLeadSheetArrangement() !== arrangement) return;
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
 * Swap which take of this song's lead sheet is on screen.
 *
 * Same work, different chart — so nothing navigates: the URL, the group and
 * the part tabs all stay put (the same rule tablature arrangements follow —
 * which take you're reading is page state, not a URL segment). The page
 * re-renders as if freshly opened so the Key pill re-detects from the new
 * chart instead of keeping the previous one's.
 *
 * Exported for tests.
 */
export function selectLeadSheetArrangement(slug) {
    const arrangement = currentArrangements.find(a => a.slug === slug);
    if (!arrangement || slug === activeArrangementSlug) return false;

    activeArrangementSlug = slug;
    const leadPart = availableParts.find(p => p.type === 'lead-sheet');
    if (leadPart) {
        activePart = leadPart;
        // null when it still has to be fetched — renderActivePart then shows
        // the loading state and pulls the arrangement's own file.
        leadPart.content = peekArrangementContent(currentWork, arrangement);
    }
    setCurrentChordpro(
        typeof leadPart?.content === 'string' ? leadPart.content : null);

    pendingInitialRender = true;
    renderWorkView();
    return true;
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

    // A PROVISIONAL work (#new-tab) has no title yet — the two fields that
    // decide what gets minted are the title slot itself, not a form on
    // another page. They write straight onto `currentWork`, which is what
    // the submission reads.
    if (currentWork.provisional) {
        header.classList.add('song-header-provisional');
        header.innerHTML = `
            <div class="song-header-left">
                <div class="song-title-row">
                    <input id="new-tab-title" class="song-title-input" type="text"
                           maxlength="200" placeholder="Song title"
                           aria-label="Song title">
                    <span class="placeholder-badge">New tab</span>
                </div>
                <div class="song-artist-line">
                    <input id="new-tab-artist" class="song-artist-input" type="text"
                           maxlength="200" placeholder="Artist (who plays it — optional)"
                           aria-label="Artist">
                </div>
            </div>`;
        const titleInput = header.querySelector('#new-tab-title');
        const artistInput = header.querySelector('#new-tab-artist');
        titleInput.value = currentWork.title || '';
        artistInput.value = currentWork.artist || '';
        titleInput.addEventListener('input', () => {
            currentWork.title = titleInput.value.trim();
        });
        artistInput.addEventListener('input', () => {
            currentWork.artist = artistInput.value.trim();
        });
        return header;
    }

    // The details button is always in the DOM and hidden by class, because
    // trust/login resolve AFTER the first render — updateWorkTopBar is called
    // again when they land (main.js updateDeleteButtonVisibility) and just
    // flips the class, the same contract #edit-song-btn has.
    header.innerHTML = `
        <div class="song-header-left">
            <div class="song-title-row">
                <span class="song-title">${escapeHtml(title)}</span>
                ${isPlaceholder(currentWork) ? '<span class="placeholder-badge">Placeholder</span>' : ''}
                ${currentWork.pending_metadata ? '<span class="pending-meta-badge" title="Your edit is live here and syncing to the songbook">Just edited</span>' : ''}
                <button id="edit-song-btn" class="focus-btn" title="Edit this song">&#x270F;&#xFE0F; Edit</button>
                <button id="edit-meta-btn" class="focus-btn hidden" title="Edit this song's title, artist, key and notes">&#x1F3F7;&#xFE0F; Details</button>
            </div>
            ${artist
                ? `<div class="song-artist-line">${escapeHtml(artist)}</div>`
                : '<div class="song-artist-line song-artist-missing hidden">Artist unknown</div>'}
        </div>
    `;
    // #edit-song-btn is wired via main.js's songContent delegation; the
    // details button is wired here so the feature needs nothing from main.js.
    header.querySelector('#edit-meta-btn')
        ?.addEventListener('click', () => showMetadataEditor());
    return header;
}

/**
 * Pill row under the title (shell.js pill primitive).
 */
function renderPillRow() {
    const row = document.createElement('div');
    row.className = 'song-pill-row';
    row.id = 'song-pill-row';

    // A provisional work has no chart, no key, no versions and no index row
    // to describe — every pill here would be an empty popover.
    if (currentWork.provisional) return row;

    if (songHasContent(currentWork)) {
        row.appendChild(buildKeyPill(currentWork));
        row.appendChild(buildDisplayPill());
    }
    row.appendChild(buildInfoPill(currentWork, currentGroupVersions));

    if (currentGroupVersions.length > 1 || currentArrangements.length > 1 ||
        currentWork.variant_of || currentWork.variant_label) {
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
    return [
        arr.provisional ? 'unsaved' : null,
        arr.pending ? 'just submitted' : null,
        arr.difficulty, arr.tuning,
        withSource ? prettySource(arr.source) : null,
    ].filter(Boolean).join(' · ');
}

// A take still in the pending overlay has no author on the row (the identity
// is the session, resolved server-side when it commits) — and "Unattributed"
// would be wrong twice over, so it says what it actually is.
function arrangementWho(arr) {
    return arr.author || arr.label || (arr.pending ? 'New submission' : 'Unattributed');
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

    // "Submitted — live now, appears in search after the next build."
    // The take header is where a submission's status belongs: the reader is
    // looking at the take it is about, on the page it was submitted from.
    const renderStatusLine = () => {
        if (!takeStatusLine) return;
        const line = document.createElement('div');
        line.className = 'arr-status';
        line.textContent = takeStatusLine;
        host.appendChild(line);
    };

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
    renderStatusLine();

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
    // The current work contributes one entry per lead sheet it holds, not one
    // entry full stop — a fork lives on the work it forked from.
    const count = versions.length +
        (currentArrangements.length ? currentArrangements.length - 1 : 0);
    const label = count > 1 ? `${count} versions` : 'Version';
    return pill(label, (container) => {
        container.innerHTML = '<div class="arrangement-loading">Loading…</div>';
        renderArrangementList(container, versions);
    }, { id: 'arrangement-pill', title: 'Versions of this song', className: 'pill-wide' });
}

/**
 * The ballot key for one lead-sheet arrangement of the current work.
 *
 * '' is the work-level vote — the meaning every `song_votes` row carried
 * before forks existed, and the one a work with a single chart still uses.
 * Forks vote under their own (build-stable) slug. Mirrors the `arr_key`
 * generated column in 20260816000000_arrangement_votes.sql. Exported for tests.
 */
export function arrangementVoteKey(arr) {
    return arr?.default === true ? '' : (arr?.slug || '');
}

/**
 * A pending fork has not been published, so there is nothing on the site for
 * anyone else to vote on — it gets no ballot until the build lands.
 */
function isVotable(arr) {
    return !arr?.pending;
}

/**
 * Order the current work's lead sheets for the pill.
 *
 * The default comes first no matter what: that flag is editorial (curation
 * PINS), and the reader's "which chart is this song" should not shuffle under
 * them because a fork gained a vote overnight. Votes order everything else,
 * high to low, ties keeping index order. Exported for tests.
 */
export function sortArrangementRows(arrangements, voteCounts = {}) {
    return [...arrangements].sort((a, b) => {
        const aDefault = a.default === true ? 1 : 0;
        const bDefault = b.default === true ? 1 : 0;
        if (aDefault !== bDefault) return bDefault - aDefault;
        return (voteCounts[arrangementVoteKey(b)] || 0)
             - (voteCounts[arrangementVoteKey(a)] || 0);
    });
}

/**
 * The signal Phase 2c owes the curator, and nothing more.
 *
 * Votes never flip a work.yaml default — that stays editorial. But when a fork
 * out-polls the chart the work ships as primary, somebody should be told.
 * Returns the leading challenger and its margin, or null when the default is
 * still on top (a tie is not a mandate). Exported for tests.
 */
export function defaultFlipSignal(arrangements, voteCounts = {}) {
    const primary = arrangements.find(a => a.default === true);
    if (!primary) return null;
    const primaryVotes = voteCounts[arrangementVoteKey(primary)] || 0;
    let best = null;
    for (const arr of arrangements) {
        if (arr === primary || !isVotable(arr)) continue;
        const votes = voteCounts[arrangementVoteKey(arr)] || 0;
        if (votes > primaryVotes && (!best || votes > best.votes)) {
            best = { arrangement: arr, votes };
        }
    }
    if (!best) return null;
    return {
        slug: best.arrangement.slug,
        label: best.arrangement.label || 'Arrangement',
        votes: best.votes,
        defaultVotes: primaryVotes,
        margin: best.votes - primaryVotes,
    };
}

async function renderArrangementList(container, versions, voteData = null) {
    const groupId = versions[0]?.group_id;

    // Render immediately with whatever vote data we have; votes are
    // decoration and must never gate the list (a slow Supabase fetch left
    // the popover stuck on "Loading…").
    const voteCounts = voteData?.voteCounts || {};
    const userVotes = voteData?.userVotes || {};
    const arrVoteCounts = voteData?.arrVoteCounts || {};
    const arrUserVotes = voteData?.arrUserVotes || {};
    if (voteData === null && typeof SupabaseAuth !== 'undefined' && groupId) {
        (async () => {
            try {
                const { data } = await SupabaseAuth.fetchGroupVotes(groupId);
                const counts = data || {};
                const loggedIn = SupabaseAuth.isLoggedIn();
                let uv = {};
                if (loggedIn) {
                    const { data: u } = await SupabaseAuth.fetchUserVotes(versions.map(v => v.id));
                    uv = u || {};
                }
                // Per-arrangement tallies are only meaningful for the work on
                // screen — it is the only one whose forks the pill lists.
                let arrCounts = {};
                let arrUser = {};
                if (currentArrangements.length && currentWork?.id) {
                    const { data: ac } =
                        await SupabaseAuth.fetchArrangementVotes(currentWork.id);
                    arrCounts = ac || {};
                    if (loggedIn) {
                        const { data: au } =
                            await SupabaseAuth.fetchUserArrangementVotes(currentWork.id);
                        arrUser = au || {};
                    }
                }
                if (container.isConnected) {
                    renderArrangementList(container, versions, {
                        voteCounts: counts, userVotes: uv,
                        arrVoteCounts: arrCounts, arrUserVotes: arrUser,
                    });
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

    // The current work expands into one row per lead sheet it holds (a fork
    // is a version of this song that lives on this work, not a work of its
    // own), everything else stays one row per work.
    const rows = [];
    for (const v of sorted) {
        if (v.id === currentWork?.id && currentArrangements.length) {
            for (const arr of sortArrangementRows(currentArrangements, arrVoteCounts)) {
                rows.push(arrangementItemHtml(arr, arrVoteCounts, arrUserVotes));
            }
        } else {
            rows.push(versionItemHtml(v, voteCounts, userVotes));
        }
    }
    const signal = currentArrangements.length
        ? defaultFlipSignal(currentArrangements, arrVoteCounts) : null;
    if (signal) rows.push(defaultFlipNoticeHtml(signal));
    container.innerHTML = rows.join('');

    container.querySelectorAll('.arrangement-item[data-arr-slug]').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.arrangement-vote-btn')) return;
            selectLeadSheetArrangement(item.dataset.arrSlug);
        });
    });

    container.querySelectorAll('.arrangement-item[data-song-id]').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.arrangement-vote-btn')) return;
            const songId = item.dataset.songId;
            if (songId && songId !== currentWork?.id) {
                openWork(songId, { groupId, exact: true });
            }
        });
    });

    // Vote casting — same affordance the version-picker modal had, now with an
    // optional arrangement key. `data-vote-slug` is absent on sibling-work
    // rows and '' on a work's primary chart; both mean the work-level vote.
    container.querySelectorAll('.arrangement-vote-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();

            if (typeof SupabaseAuth === 'undefined' || !SupabaseAuth.isLoggedIn()) {
                alert('Please sign in to vote');
                return;
            }

            const songId = btn.dataset.songId;
            const arrSlug = btn.dataset.voteSlug || null;
            const hasVoted = btn.classList.contains('voted');
            const countEl = btn.parentElement.querySelector('.vote-count');

            if (hasVoted) {
                await SupabaseAuth.removeVote(songId, arrSlug);
                btn.classList.remove('voted');
                if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) - 1);
            } else {
                await SupabaseAuth.castVote(songId, groupId, 1, arrSlug);
                btn.classList.add('voted');
                if (countEl) countEl.textContent = parseInt(countEl.textContent, 10) + 1;
            }
        });
    });
}

/**
 * One row for a lead sheet of the CURRENT work (primary or fork).
 *
 * Every published take carries its own vote button: the primary votes under
 * the work-level (null) key, so existing votes and existing behavior are
 * untouched, and each fork votes under its own slug. A pending fork gets no
 * button — nobody else can see it yet.
 */
function arrangementItemHtml(arr, voteCounts, userVotes) {
    const isCurrent = arr.slug === activeArrangementSlug;
    const label = arr.label || (arr.default ? 'Original' : 'Arrangement');
    const meta = [];
    if (arr.arrangement_by) meta.push(`Arr. ${arr.arrangement_by}`);
    if (arr.key) meta.push(`Key: ${arr.key}`);
    if (arr.chord_count) meta.push(`${arr.chord_count} chords`);
    if (arr.pending) meta.push('not published yet');
    const id = currentWork?.id;
    const voteKey = arrangementVoteKey(arr);
    const votes = voteCounts[voteKey] || 0;
    const hasVoted = userVotes[voteKey] ? ' voted' : '';
    const badges = `${arr.default === true ? ' <span class="canonical-badge">Default</span>' : ''}${isCurrent ? ' <span class="current-badge">viewing</span>' : ''}`;
    return `
        <div class="pill-popover-item arrangement-item${isCurrent ? ' current' : ''}" data-arr-slug="${escapeAttr(arr.slug)}" role="button" tabindex="0">
            <span class="arrangement-info">
                <span class="arrangement-label">${escapeHtml(label)}${badges}</span>
                <span class="arrangement-meta">${escapeHtml(meta.join(' · '))}</span>
            </span>
            <span class="arrangement-votes">${isVotable(arr) ? `
                <button class="vote-btn arrangement-vote-btn${hasVoted}" data-song-id="${escapeAttr(id || '')}" data-vote-slug="${escapeAttr(voteKey)}" title="Vote for this arrangement">
                    <span class="vote-arrow">▲</span>
                </button>
                <span class="vote-count">${votes}</span>` : ''}
            </span>
        </div>
    `;
}

/**
 * The default-flip signal, displayed and nothing more.
 *
 * Deliberately NOT a review_requests row: that queue is the DESTRUCTIVE
 * residue (delete / suppress / merge-redirect) and its approvals only record
 * a decision anyway. Promoting an arrangement is an ordinary repo edit, so the
 * lighter honest move is to show the imbalance where the votes are, and tell a
 * trusted user which file makes it real.
 */
function defaultFlipNoticeHtml(signal) {
    const trusted = !!workPageHooks.isTrusted?.();
    const where = trusted && currentWork?.id
        ? `<span class="arrangement-flip-where">Promote it in <code>works/${escapeHtml(currentWork.id)}/work.yaml</code>.</span>`
        : '';
    return `
        <div class="pill-popover-note arrangement-flip-note">
            <strong>${escapeHtml(signal.label)}</strong> is out-polling the default
            ${signal.votes}–${signal.defaultVotes}. The default is editorial, so
            votes don't change it on their own.${where ? ` ${where}` : ''}
        </div>
    `;
}

/** One row for another WORK in this version group. */
function versionItemHtml(v, voteCounts, userVotes) {
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
        <div class="pill-popover-item arrangement-item${isCurrent ? ' current' : ''}" data-song-id="${escapeAttr(v.id)}" role="button" tabindex="0">
            <span class="arrangement-info">
                <span class="arrangement-label">${escapeHtml(label)}${v.canonical === true ? ' <span class="canonical-badge">Canonical</span>' : ''}${isCurrent ? ' <span class="current-badge">viewing</span>' : ''}</span>
                <span class="arrangement-meta">${escapeHtml(meta.join(' · '))}</span>
            </span>
            <span class="arrangement-votes">
                <button class="vote-btn arrangement-vote-btn${hasVoted}" data-song-id="${escapeAttr(v.id)}" title="Vote for this arrangement">
                    <span class="vote-arrow">▲</span>
                </button>
                <span class="vote-count">${votes}</span>
            </span>
        </div>
    `;
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
 *   onDelete()     - admin delete flow (instant)
 *   onRequestDelete() - trusted-user delete REQUEST (queued for an admin)
 *   onRequestSuppress() - trusted-user suppress REQUEST (queued for an admin)
 *   onRequestMerge() - trusted-user merge-redirect REQUEST (queued for an admin)
 *   isAdmin()      - current admin status (drives the Delete overflow item)
 *   isLoggedIn()   - signed-in status (drives Promote in the Dungeon)
 *   isTrusted()    - current trusted status (drives the three
 *                    review-queue REQUEST items; suppress/merge have no
 *                    instant admin path, so they show whenever isTrusted())
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
 *
 * Unchanged by the metadata work on purpose. Edit means "edit the chart"
 * everywhere it is offered — a work with no chart still wants that door open
 * (that is how a placeholder gains one). Editing the work's DETAILS is a
 * different ask and gets its own button; routing both through one control was
 * what made the details of a tab-minted work unreachable in the first place.
 */
export function handleEditAction() {
    if (!currentWork) return;
    if (isPlaceholder(currentWork)) {
        showMetadataEditor();
    } else {
        workPageHooks.onEdit?.(currentWork);
    }
}

/**
 * May the viewer edit THIS work's metadata?
 *
 * Own a part of it, or be trusted (Mike's rule). Exported for tests; the page
 * asks it on every top-bar update because both halves resolve late — the
 * trusted flag arrives from Supabase after first paint, and the overlay row
 * that proves you just submitted a tab arrives from refreshPendingSongs.
 */
export function canEditMetadataHere(song = currentWork) {
    return canEditWorkMetadata(song, {
        userId: globalThis.window?.SupabaseAuth?.getUser?.()?.id || null,
        trusted: !!workPageHooks.isTrusted?.(),
    });
}

export function updateWorkTopBar() {
    if (!currentWork || currentView !== 'song') return;

    // A provisional work isn't in any list, can't be exported, flagged,
    // promoted or deleted — it doesn't exist yet. Back is the whole band.
    if (currentWork.provisional) {
        setTopBar({ back: { onClick: goBack }, title: null, actions: [], overflow: [] });
        return;
    }

    const actions = [];

    // Edit lives in the title row (a content action stays with the
    // content); here we only sync its visibility to the active part —
    // tab parts carry their own Edit in the playback controls.
    const editBtn = document.getElementById('edit-song-btn');
    if (editBtn) {
        editBtn.classList.toggle('hidden',
            !(partUsesSongActions(activePart) || isPlaceholder(currentWork)));
    }

    // Details (title / artist / key / notes) is NOT part-scoped — the work has
    // one set of details whichever part you are reading, and a tab part is the
    // case that needs it most: a tab-minted work arrives with a title and
    // nothing else. Gated on the viewer instead: own a part here, or trusted.
    const metaBtn = document.getElementById('edit-meta-btn');
    const mayEditMeta = canEditMetadataHere();
    if (metaBtn) metaBtn.classList.toggle('hidden', !mayEditMeta);
    // The "Artist unknown" nudge only appears to someone who can act on it.
    document.querySelector('#song-content .song-artist-missing')
        ?.classList.toggle('hidden', !mayEditMeta);

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

    // Any signed-in user sees Promote on archived (dungeon) songs — a visible
    // band button on desktop, ⋯ overflow on phones (same diet as Export).
    // Not gated on trusted status: the people who notice a missing standard
    // are the ones playing it, and a promoted work is one the corpus already
    // holds, so the downside is a noisier index rather than injected content.
    // Undo is narrower — see the RLS policy in
    // supabase/migrations/20260817010000_open_promote_to_logged_in.sql.
    const promotedNow = workPageHooks.isPromoted?.(currentWork.id);
    const showPromote = !!workPageHooks.isLoggedIn?.() &&
        (promotedNow || currentWork.indexed === false);
    if (showPromote && !phoneBand) {
        actions.push({
            id: 'promote-song-btn',
            label: promotedNow ? 'Undo promote' : 'Promote',
            icon: promotedNow ? '↩️' : '⬆️',
            title: promotedNow ? 'Undo promotion' : 'Promote this song into the songbook',
            onClick: () => workPageHooks.onPromote?.(),
        });
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
    if (showPromote && phoneBand) {
        overflow.push({
            id: 'promote-song-btn',
            label: promotedNow ? '↩️ Undo promote' : '⬆️ Promote to songbook',
            onClick: () => workPageHooks.onPromote?.(),
        });
    }
    // One slot, two meanings: admins delete on the spot, trusted users ask.
    // Deletion is the destructive residue phase 2d keeps reviewed — the rule
    // itself lives in review-queue.js so the queue and the button agree.
    const affordance = deleteAffordance({
        isAdmin: workPageHooks.isAdmin?.(),
        isTrusted: workPageHooks.isTrusted?.(),
    });
    if (affordance === 'instant') {
        overflow.push({
            id: 'delete-song-btn',
            label: '🗑️ Delete song',
            onClick: () => workPageHooks.onDelete?.(),
        });
    } else if (affordance === 'request') {
        overflow.push({
            id: 'request-delete-song-btn',
            label: '🗑️ Request deletion',
            onClick: () => workPageHooks.onRequestDelete?.(),
        });
    }

    // Suppress and merge-redirect have no instant path even for admins —
    // approving either only prints a local command (review-queue.js) — so
    // both are offered as requests to any trusted user, admin or not.
    if (workPageHooks.isTrusted?.()) {
        overflow.push({
            id: 'request-suppress-song-btn',
            label: '🙈 Request suppression',
            onClick: () => workPageHooks.onRequestSuppress?.(),
        });
        overflow.push({
            id: 'request-merge-song-btn',
            label: '🔀 Request merge into another song…',
            onClick: () => workPageHooks.onRequestMerge?.(),
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
            <button class="work-bounty-request-btn" id="work-bounty-add-tab-btn">+ Add a tab</button>
        </div>
    `;

    // Wire contribute buttons. A tablature bounty is the one request the
    // add-song picker can't fulfil — it wants a tab, so it opens the tab
    // editor in create mode, pre-targeted at this work and instrument.
    section.querySelectorAll('.work-bounty-contribute').forEach(btn => {
        btn.addEventListener('click', () => {
            const card = btn.closest('.work-bounty-card');
            if (card?.dataset.bountyType === 'tablature') {
                startTabContribution(section, card.dataset.bountyInstrument || '');
                return;
            }
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

    // Add a tab, unprompted — no bounty needed
    section.querySelector('#work-bounty-add-tab-btn')?.addEventListener('click', () => {
        startTabContribution(section, '');
    });

    // Wire request button
    section.querySelector('#work-bounty-request-btn')?.addEventListener('click', () => {
        if (!requireLogin('request parts')) return;
        openBountyRequestInline(section, currentWork);
    });

    return section;
}

/**
 * "Add a tab" / a tablature bounty's Contribute — with the offramp FIRST.
 *
 * If this work already has tabs for the instrument, the choice is offered
 * here, on the page the contributor is already looking at: read one, add
 * theirs alongside, or improve one. Only when there's nothing to collide
 * with does the click go straight to the editor as before. This is
 * contract principle 4 — the offramp is a choice offered early, never a
 * 409 discovered after the work is done.
 */
function startTabContribution(section, instrument) {
    if (!currentWork) return;
    const plan = tabEntryPlan(currentWork, instrument, { title: currentWork.title });

    if (plan.kind !== 'existing') {
        launchTabCreator({           // gates on login itself
            workId: currentWork.id, instrument, title: currentWork.title,
        });
        return;
    }

    const body = section.querySelector('#work-bounty-body');
    if (!body) return;
    body.querySelector('.tab-existing-panel')?.remove();
    body.appendChild(renderExistingTabsPanel(plan, {
        onAdd: () => launchTabCreator({
            workId: currentWork.id, instrument, title: currentWork.title,
            existingCount: plan.count,
        }),
        onView: (tab) => openTabPart(tab.file, { edit: false }),
        onImprove: (tab) => openTabPart(tab.file, { edit: true }),
        onImport: () => importTefAsNewTake(instrument, plan.count),
        onBack: () => body.querySelector('.tab-existing-panel')?.remove(),
    }));
}

/**
 * A TablEdit file as a new take on THIS song: parse it here and drop
 * straight into add-tab mode with the parsed document loaded, so the
 * preview is the song page it will be published on.
 */
function importTefAsNewTake(instrument, existingCount = 0) {
    if (!requireLogin('add a tab')) return;
    pickTefFile((otf) => {
        if (!currentWork) return;
        startAddTabMode({
            instrument, title: currentWork.title, existingCount, otf,
        });
        const hash = createTabHref({ workId: currentWork.id, instrument });
        if (window.location.hash !== hash) {
            history.replaceState(
                { view: 'song', songId: currentWork.id }, '', hash);
        }
    });
}

/**
 * A tab the reader asked for by file: select its instrument's part, point
 * that part at this arrangement, and (for "improve") drop straight into
 * the existing tab-correction editor once it renders.
 *
 * The edit intent is parked rather than executed because the OTF has to
 * be fetched first — renderTablaturePart honors it at the end of a
 * successful render, which is also the only place the document exists.
 */
function openTabPart(file, { edit = false } = {}) {
    const part = availableParts.find(p => p.type === 'tablature' &&
        (p.arrangements || []).some(a => a.file === file));
    if (!part) return false;

    if (edit) pendingTabEdit = { workId: currentWork?.id, file };

    if (part !== activePart) {
        selectPart(part);   // renders the part (and applies the intent)
        return true;
    }
    // Already the active part: re-render it on the requested arrangement.
    const idx = part.arrangements.findIndex(a => a.file === file);
    applyArrangement(part, idx);
    const content = document.getElementById('work-part-content');
    if (content) {
        content.innerHTML = '';
        renderTablaturePart(part, content);
    }
    return true;
}

/**
 * Ask the work page to open a specific tab file in edit mode. Used by the
 * add-song picker's "Improve an existing tab" choice, which has to
 * navigate to the work page before the editor can mount over the tab.
 */
export function requestTabEdit(workId, file) {
    pendingTabEdit = workId && file ? { workId, file } : null;
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
// WORK METADATA EDITOR
// ============================================
//
// The work's OWN fields — title, artist, key, notes — as opposed to any part's
// bytes. It used to be reachable only from a `status: placeholder` work, which
// left a tab-minted work stranded: `works/welcome-to-new-york/` had a title and
// nothing else, and no surface anywhere could give it an artist.
//
// Widening the gate alone would have been wrong, which is why this is a
// rewrite rather than a flag flip. The old save wrote `status: 'placeholder'`
// and `content: existingContent || null` — on a tab-only work `getSongContent`
// returns `''`, so the row went down the CHART path server-side and stamped
// `status: placeholder` onto a legitimate work. A metadata edit now writes a
// row that is neither a chart nor a part:
//
//   part_type   'metadata'
//   content     null — this row owns no bytes and must never be read as a chart
//   replaces_id the work being edited (REQUIRED: it is the row's whole address)
//   id          `meta:<slug>:<rand>`, its own namespace, because two people
//               editing one work's details must not collide on the PK
//
// Permission is the SERVER's answer (own a part, or be trusted). The button is
// gated on the same rule client-side so the affordance isn't a lie, but a 403
// from `auto-commit-song` is surfaced verbatim, never swallowed.

/**
 * Show the inline editor for the work's details (title, artist, key, notes).
 * Replaces the page content with an edit form.
 */
function showMetadataEditor() {
    if (!requireLogin('edit song details')) return;
    if (!currentWork) return;

    const container = document.getElementById('song-content');
    if (!container) return;

    // The form replaces the whole page body, which on a tab work means
    // detaching a live tablature view. Its renderers own documentElement
    // observers and its player owns audio, so they have to be torn down here
    // rather than left re-rendering into DOM nobody can see. Cancel/Save
    // re-render the part from scratch (renderWorkView).
    teardownTablatureView();
    setBottomBand(null);

    // Replace content with edit form
    container.innerHTML = '';

    const work = currentWork;
    const form = document.createElement('div');
    form.className = 'placeholder-editor';

    const keyOptions = CHROMATIC_MAJOR_KEYS.map(k =>
        `<option value="${k}" ${k === (currentWork.key || '') ? 'selected' : ''}>${k}</option>`
    ).join('');

    // Document upload died with phase 2d: the intake staged files nothing
    // ever read. Documents already attached to a work still render on the
    // song page (renderDocumentPart) — this editor just can't add more.

    form.innerHTML = `
        <div class="placeholder-editor-header">
            <h3>Song details</h3>
            <p class="placeholder-editor-sub">These describe the song itself — every tab and chart on this page shares them.</p>
        </div>
        <div class="placeholder-editor-form">
            <div class="placeholder-editor-field">
                <label for="ph-edit-title">Title</label>
                <input type="text" id="ph-edit-title" value="${escapeAttr(currentWork.title || '')}" />
            </div>
            <div class="placeholder-editor-field">
                <label for="ph-edit-artist">Artist</label>
                <input type="text" id="ph-edit-artist" value="${escapeAttr(currentWork.artist || '')}" placeholder="As performed by…" />
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
            <div class="placeholder-editor-actions">
                <button class="placeholder-editor-save" id="ph-edit-save">Save</button>
                <button class="placeholder-editor-cancel" id="ph-edit-cancel">Cancel</button>
            </div>
            <div class="placeholder-editor-status" id="ph-edit-status"></div>
        </div>
    `;

    container.appendChild(form);

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
        statusDiv.textContent = 'Saving...';
        statusDiv.className = 'placeholder-editor-status';

        try {
            // Metadata edits take the one pipeline: write the row, then ask
            // for the durable commit. Permission is decided there.
            const out = await submitWorkMetadata({
                workId: work.id, title, artist, key, notes,
            });

            statusDiv.innerHTML = out.synced
                ? '<span style="color: var(--success)">Saved!</span>'
                : '<span style="color: var(--success)">Saved — syncing shortly.</span>';

            // Update in-memory work data and re-render after brief delay.
            // refreshPendingSongs rebuilds the corpus underneath us, so this
            // is the on-screen copy catching up, not the source of truth.
            work.title = title;
            work.artist = artist;
            work.key = key;
            work.notes = notes;
            setTimeout(() => renderWorkView(), 600);
        } catch (e) {
            statusDiv.textContent = `Error: ${e.message}`;
            statusDiv.className = 'placeholder-editor-status error';
            saveBtn.disabled = false;
        }
    });
}

/**
 * The `pending_songs.id` for a metadata edit: `meta:<slug>:<rand>`.
 *
 * Enforced in the database (`^meta:[a-z0-9-]*:[a-z0-9]{6,}$`), for the reason
 * tab rows are namespaced: the primary key cannot be the work slug when two
 * people may hold an unlanded edit of the same work — the second writer's
 * upsert would fail the owner-gated UPDATE policy and surface as a
 * *permissions* error that says nothing about the actual collision.
 *
 * Memoized per work, so a double-click, or a second save from the same page
 * session, updates ONE row rather than minting a queue of them. A metadata
 * edit is a state, not a take: the newest wins and older ones are noise.
 */
export function metaRowId(workId) {
    return namespacedRowId('meta', workId, String(workId || ''));
}

/**
 * Write a metadata edit and ask for the durable commit.
 *
 * Two steps, the same two every contribution takes — with one deliberate
 * difference in how step 2 failing is read. For a tab, step 2 is only
 * durability: the row is live and the hourly reconciler retries, so a failure
 * is "syncing shortly". For metadata, step 2 is also where PERMISSION is
 * decided, so a 401/403 means the edit was REFUSED and will never land. That
 * cannot be reported as success, and the row must not be left behind
 * advertising an edit in the overlay forever — so it is deleted and the
 * server's own message is raised. Anything else (5xx, offline) stays
 * live-but-unsynced, exactly like a tab.
 *
 * @param {Object} p
 * @param {string} p.workId - the work being edited (becomes `replaces_id`)
 * @param {string} p.title
 * @param {string} [p.artist]
 * @param {string} [p.key]
 * @param {string} [p.notes]
 * @param {Object} [deps] - injectable for tests
 * @returns {Promise<{id, workId, live: true, synced: boolean,
 *   mode: string|null, syncError: string|null}>}
 */
export async function submitWorkMetadata(p, deps = {}) {
    const { workId, title, artist = '', key = '', notes = '' } = p || {};
    const {
        fetchImpl = (...args) => globalThis.fetch(...args),
        supabase = globalThis.window?.SupabaseAuth?.supabase || null,
    } = deps;

    const token = await accessToken();
    if (!token) {
        throw new Error('Sign in to edit song details — your account is the attribution.');
    }
    if (!supabase) {
        throw new Error('Not connected to the songbook — reload and try again.');
    }
    // A metadata row with no target has nothing to say: it is not a song, so
    // there is no work for the server to mint from it.
    if (!workId) {
        throw new Error('This edit has no song to attach to.');
    }
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) throw new Error('A song needs a title.');

    const id = metaRowId(workId);
    const row = {
        id,
        replaces_id: workId,
        title: cleanTitle,
        artist: String(artist || '').trim() || null,
        key: key || null,
        notes: String(notes || '').trim() || null,
        // NOT the work's ChordPro. The old save round-tripped the chart
        // through this column so a metadata edit wouldn't blank it; on a
        // tab-only work that read `''` and wrote a chart row for a work that
        // has no chart. `null` says what is true: this row edits fields.
        content: null,
        part_type: 'metadata',
        created_by: globalThis.window?.SupabaseAuth?.getUser?.()?.id || null,
    };

    const { error } = await supabase
        .from('pending_songs')
        .upsert(row, { onConflict: 'id' });
    if (error) {
        throw new Error(error.message || 'Could not save these details.');
    }

    // Live for this browser the moment the row lands: the overlay applies it
    // (corpus.applyPendingMetadata) on the next corpus rebuild.
    if (globalThis.window?.refreshPendingSongs) {
        await globalThis.window.refreshPendingSongs();
    }

    try {
        const result = await requestDurableWrite(id, token, fetchImpl);
        return {
            id, workId, live: true, synced: true,
            mode: result?.mode || null, syncError: null,
        };
    } catch (e) {
        // Any 4xx is the server saying the row itself is wrong and always
        // will be — refused (403 no claim on this work), unaddressed (404 no
        // such work), malformed (400). The one exception is 429: a rate limit
        // is about WHEN, not what, so it stays live and the reconciler retries.
        const refused = e?.status >= 400 && e?.status < 500 && e?.status !== 429;
        if (refused) {
            // Refused. Take the row back out so the overlay stops showing an
            // edit that is never going to be real, then say what the server
            // said — the client does not get to translate a 403 into a shrug.
            try {
                await supabase.from('pending_songs').delete().eq('id', id);
                if (globalThis.window?.refreshPendingSongs) {
                    await globalThis.window.refreshPendingSongs();
                }
            } catch (cleanup) {
                console.warn('Could not withdraw the refused metadata row:', cleanup);
            }
            throw new Error(e.detail
                || 'You can only edit the details of a song you have contributed to.');
        }
        console.warn('Details are live but not yet synced to the songbook:', e);
        return {
            id, workId, live: true, synced: false, mode: null, syncError: e.message,
        };
    }
}

// ============================================
// PART RENDERERS (tablature + document; lead sheets render via
// song-view.js renderLeadSheetContent)
// ============================================

function renderDocumentPart(part, container) {
    // part.file is a path out of work.yaml, i.e. submitter-writable — so it
    // gets the same scheme check as any other URL-valued attribute. Note
    // <object data> is a URL position too, and a data: URL there renders
    // attacker HTML in this origin.
    const downloadUrl = safeUrl(part.file);
    const label = escapeHtml(part.label || 'Document');

    if (!downloadUrl) {
        container.innerHTML = `<div class="document-viewer"><p class="document-error">`
            + `${label} could not be shown — its location is not a valid link.</p></div>`;
        return;
    }

    // Documents are read-only shelf items: phase 2d removed the upload
    // intake, so every document part here came from works/ at build time
    // (there is no longer an "still processing" state to announce).
    container.innerHTML = `
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
    // A take that exists only in this session has nothing to fetch and
    // nothing to read: the editor IS its view (add-tab / new-tab modes).
    if (part.provisional) {
        mountTabEditor(tabAuthoring?.otf, part, container, {
            kind: tabAuthoring?.kind || 'add',
        });
        return;
    }

    container.innerHTML = '<div class="loading">Loading tablature...</div>';

    // A parked "improve this tab" intent (from the picker's early offramp,
    // this page's own panel, or a `#work/{slug}/edit/{ref}` URL) names one
    // arrangement — point the part at it before anything is fetched.
    if (pendingTabEdit && pendingTabEdit.workId === currentWork?.id) {
        const idx = (part.arrangements || [])
            .findIndex(a => tabEditIntentMatches(a));
        if (idx >= 0) applyArrangement(part, idx);
    }

    try {
        // Load the document (fetched, or read out of the pending overlay —
        // see loadPartOtf) unless the one in hand is already this take's.
        const cacheKey = otfCacheKey(part);
        let otf = loadedTablature;
        if (!otf || otf._partFile !== cacheKey) {
            otf = await loadPartOtf(part);
            otf._partFile = cacheKey;
            setLoadedTablature(otf);
        }

        // The page moved on while the document was in flight. `container` is
        // the check that catches every case: renderWorkView builds a FRESH
        // content div, so a superseded render is holding a detached node —
        // and finishing it would mount a read-mode band over the edit-mode
        // one (add-tab reuses this very part object, so comparing parts is
        // not enough).
        if (!document.contains(container) || activePart !== part || part.provisional) return;

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

        // Say out loud that this take is the overlay, not the songbook yet.
        // The reader is looking at real notes seconds after they were
        // submitted; silence here would read as "this is published", and the
        // first person to notice would be the submitter wondering why their
        // tab vanished from a fresh browser after the commit renamed it.
        // Reuses the attribution block's classes — no new CSS surface.
        if (part.pending) {
            const notice = document.createElement('div');
            notice.className = 'tab-attribution';
            notice.innerHTML = `
                <div class="attribution-content">
                    <span class="attribution-item">🌱 Just submitted — live here now</span>
                </div>
                <div class="attribution-disclaimer">
                    This tab is in the submission queue and is being added to the
                    songbook. It is readable and playable right away; nothing is
                    waiting on a review.
                </div>`;
            container.appendChild(notice);
        }

        // Credit the arrangement that's actually on screen — `part` carries
        // the loaded arrangement's fields (see applyArrangement), so this
        // follows an arrangement switch instead of naming the pinned default.
        if (part.author || part.source_page_url) {
            const attribution = document.createElement('div');
            attribution.className = 'tab-attribution';

            // Both URLs come out of work.yaml provenance, which a submitter
            // writes — so they are scheme-checked, not merely escaped. An
            // unsafe URL yields '' and the credit degrades to plain text
            // rather than an anchor pointing at javascript:.
            const authorHref = safeUrl(part.author_url);
            const sourceHref = safeUrl(part.source_page_url);

            let attrHtml = '<div class="attribution-content">';
            if (part.author) {
                attrHtml += '<span class="attribution-item">Tabbed by ';
                if (authorHref) {
                    attrHtml += `<a href="${authorHref}" target="_blank" rel="noopener">${escapeHtml(part.author)}</a>`;
                } else {
                    attrHtml += escapeHtml(part.author);
                }
                attrHtml += '</span>';
            }
            if (part.source_page_url) {
                const where = prettySource(part.source) || 'the source site';
                attrHtml += sourceHref
                    ? `<span class="attribution-item"><a href="${sourceHref}" target="_blank" rel="noopener">View on ${escapeHtml(where)}</a></span>`
                    : `<span class="attribution-item">Source: ${escapeHtml(where)}</span>`;
            }
            attrHtml += '</div>';
            attrHtml += '<div class="attribution-disclaimer">';
            attrHtml += 'This tab was converted from TablEdit format and may contain minor errors. ';
            attrHtml += 'Please report issues if you notice problems.';
            attrHtml += '</div>';

            attribution.innerHTML = attrHtml;
            container.appendChild(attribution);
        }

        // The parked "improve this one" intent: the document only exists
        // here, so this is the one place the editor can be handed it.
        if (pendingTabEdit && pendingTabEdit.workId === currentWork?.id &&
            tabEditIntentMatches(part)) {
            pendingTabEdit = null;
            enterTabEditMode(otf, part, container);
        }

    } catch (e) {
        console.error('Error loading tablature:', e);
        container.innerHTML = `<div class="error">Failed to load tablature: ${escapeHtml(e.message)}</div>`;
    }
}

// ============================================
// THE EDITOR AS A MODE OF THIS PAGE (plan §9)
// ============================================
//
// One surface for create, edit and read: the page you edit on is the page
// the tab is published on. There is no create page any more — `create.html`
// is a redirect shim into these three modes, which differ only in what the
// take IS and what the Submit button means:
//
//   edit  an existing take, corrected      → Submit correction (+ ✓ Done)
//   add   a new take on a song we have     → Submit tab
//   new   a new take on a song we don't    → Submit tab, and the work is
//                                            minted from the title/artist
//                                            fields in the title slot
//
// All three keep the app shell, the take header and — this is the change —
// the BOTTOM BAND, re-bound to the live editor document (tab-edit-band.js).

/** Does the parked edit intent name this take? */
function tabEditIntentMatches(take) {
    if (!pendingTabEdit || !take) return false;
    if (pendingTabEdit.file && take.file === pendingTabEdit.file) return true;
    return !!pendingTabEdit.ref && takeRefs(take).includes(pendingTabEdit.ref);
}

/** Download filename stem for a take (no extension). */
function editFilename(part) {
    return (part.file
        || [currentWork?.id, part.instrument].filter(Boolean).join('-')
        || 'tab').split('/').pop().replace(/\.otf\.json$/, '');
}

/**
 * Ask for a .tef and hand back the parsed OTF.
 *
 * The drop zone that used to live on create.html: a TablEdit file is a
 * starting point for a take, so it belongs wherever a take is started —
 * the add-tab flow and the existing-takes offramp. The parser is imported
 * lazily; readers never pay for it.
 */
export async function pickTefFile(onDocument, { file = null } = {}) {
    const load = async (chosen) => {
        if (!chosen) return;
        try {
            const { parseTef } = await import('./tef-import/index.js');
            const bytes = new Uint8Array(await chosen.arrayBuffer());
            const otf = parseTef(bytes, chosen.name);
            const hasNotes = Object.values(otf.notation || {})
                .some(measures => measures.length > 0);
            if (!hasNotes) {
                showToast("We couldn't read any notes from that tab file.",
                    { variant: 'warning', duration: 6000 });
                return;
            }
            onDocument(otf, chosen);
        } catch (err) {
            // Format-agnostic on purpose: nobody should have to know which
            // TablEdit variant they have. (The version error is caught by
            // TYPE — TefVersionError does not set a `name`.)
            const { TefVersionError } = await import('./tef-import/index.js');
            showToast(err instanceof TefVersionError
                ? "This tab file uses a variant we can't read yet — please report it."
                : `Could not read that tab file: ${err.message}`,
                { variant: 'warning', duration: 6000 });
        }
    };

    if (file) return load(file);

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tef';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
        const chosen = input.files?.[0];
        input.remove();
        await load(chosen);
    });
    input.click();
}

/**
 * Mount the editor over the part's content area, with the bottom band
 * bound to the document being edited.
 *
 * @param {Object} otf - the document
 * @param {Object} part - the part (its arrangement fields name the take)
 * @param {HTMLElement} container - the part content area
 * @param {{kind: 'edit'|'add'|'new'}} options
 */
async function mountTabEditor(otf, part, container, { kind = 'edit' } = {}) {
    if (!otf || !container) return;

    // Stop playback before handing the document to the editor
    if (tablaturePlayer?.isPlaying) tablaturePlayer.stop();

    const [
        { OTFEditor },
        { createTabEditSession, resolveEditTrackId },
        { submitTab },
        { createAutosaver, getDraftStore },
    ] = await Promise.all([
        import('./otf-editor/editor.js'),
        import('./otf-editor/work-edit.js'),
        import('./otf-editor/submit-tab.js'),
        import('./drafts.js'),
    ]);

    // The reader navigated while the editor was being fetched
    if (activePart !== part || !document.contains(container)) return;

    // A `?draft=…` route means "my unsubmitted work", so its document wins
    // over whatever this take holds — for an edit that is the PUBLISHED tab,
    // which is precisely what the draft is a correction to. Consumed here so
    // a later mount can never pick a stale one up.
    const draft = pendingDraft;
    pendingDraft = null;
    if (draft?.otf) otf = draft.otf;

    // The rendered-view renderers are about to be detached — drop their
    // observers now; renderTablaturePart rebuilds them on exit.
    destroyTrackRenderers();
    if (activeEditSession) { activeEditSession.destroy(); activeEditSession = null; }
    if (activeEditBand) { activeEditBand.destroy(); activeEditBand = null; }
    container.innerHTML = '';

    const isNewTake = kind !== 'edit';
    const target = tabAuthoring?.target || {};
    const instrument = sanitizeInstrument(part.instrument || target.instrument) || 'banjo';

    // The drafts bucket (§9.3): IndexedDB, one record per session, written
    // on a trailing edge by `onChange` below.
    const autosave = createAutosaver({
        store: getDraftStore(),
        id: draft?.id || null,
        meta: {
            // What a draft has to remember to be REOPENABLE: which work it
            // belongs to (none, for a song the songbook doesn't have), which
            // take it corrects (edit only — a new take has no ref yet), and
            // what to call it in the list. drafts.js::draftOpenHash turns
            // exactly these back into `#new-tab?draft=` /
            // `#work/{slug}/add-tab?draft=` / `#work/{slug}/edit/{ref}?draft=`.
            workId: currentWork?.provisional ? null : (currentWork?.id || null),
            takeRef: isNewTake ? null : takeEditRef(part),
            title: currentWork?.title || otf?.metadata?.title || null,
            instrument,
        },
    });

    // THE BAND SURVIVES. Same controls the reader had a second ago, built
    // from the same document, re-bound to the editor by bindBandToEditor.
    const controls = createTablatureControls(otf, part);
    setBottomBand(controls);

    // The session's buttons take the ✏️ Edit button's slot in the band; the
    // holder is detached here and inserted by bindBandToEditor below.
    const barHost = document.createElement('span');
    barHost.className = 'tab-edit-band-actions';

    const extraActions = isNewTake ? [{
        className: 'tab-edit-import',
        label: '📂 Import .tef…',
        title: 'Replace this take with a TablEdit (.tef) file',
        onClick: (session) => pickTefFile((doc, file) => {
            session.replaceDocument(doc);
            // The canvas redrawing is not, by itself, an answer — a tab you
            // have not scrolled to looks identical either way. Say which
            // file landed and how much of it there was.
            const measures = Object.values(doc.notation || {})
                .reduce((most, list) => Math.max(most, list.length), 0);
            session.setStatus(
                `Imported ${file?.name || 'that file'} — ${measures} measures.`);
        }),
    }] : [];

    activeEditSession = createTabEditSession({
        mount: container,
        otf,
        trackId: resolveEditTrackId(otf, instrument),
        filename: `${editFilename(part)}${isNewTake ? '' : '-edited'}`,
        editorFactory: (opts) => new OTFEditor(opts),
        barHost,
        submitLabel: isNewTake ? '🚀 Submit tab' : '🚀 Submit correction',
        showDone: !isNewTake,
        commentRequired: !isNewTake,
        extraActions,
        // Every edit, in every mode, lands in the drafts bucket on a ~1s
        // trailing edge (§9.3) — a reload, a crash or a sign-in round trip
        // does not cost the session, and `#drafts` can reopen it on the
        // route it was written on.
        onChange: (doc) => {
            autosave.save(doc);
            // A new take ALSO keeps the single localStorage slot create.html
            // used to own, because that is what startAddTabMode resumes from
            // synchronously (IndexedDB cannot answer during a render). The
            // target travels with it: a sign-in round trip drops the query
            // string, and the draft is where it survives.
            if (isNewTake) {
                saveDraft(doc, {
                    workId: currentWork?.provisional ? null : (currentWork?.id || null),
                    instrument,
                });
            }
        },
        onApply: (doc) => {
            doc._partFile = otfCacheKey(part); // keep the view cache keyed to this part
            setLoadedTablature(doc);
            if (tabAuthoring) tabAuthoring.otf = doc;
        },
        onExit: (reason) => {
            activeEditSession = null;
            activeEditBand?.destroy();
            activeEditBand = null;
            // Cancel means "I don't want these edits" — the draft goes with
            // them. ✓ Done keeps it: Done only applies the document to THIS
            // page, and closing the tab afterwards would otherwise lose it.
            if (reason === 'cancel') autosave.clear().catch(() => {});
            else autosave.flush().catch(() => {});
            if (isNewTake) {
                exitAuthoring(reason, part, container);
            } else {
                restoreWorkHash();
                // The take header carries the submission's status (and its
                // pending badge) — it is drawn outside the part content, so
                // it has to be re-rendered alongside it.
                renderArrangementBar();
                renderTablaturePart(part, container);
            }
        },
        onSubmit: isNewTake
            ? (doc) => submitAuthoredTake(doc, part)
            : (doc, comment) => submitTabCorrection(doc, part, comment, submitTab),
        onSubmitted: (result, doc) => {
            // Submitted: the draft has served its purpose.
            autosave.clear().catch(() => {});
            if (isNewTake) landSubmittedTake(result, part, container);
            else landSubmittedCorrection(result, doc, part);
        },
    });

    activeEditBand = bindBandToEditor(controls, activeEditSession.editor, {
        actions: barHost,
    });

    // The editor is a URL, so a reload (or a link to a reviewer) comes back
    // to the same take in the same mode.
    if (kind === 'edit' && currentWork?.id) {
        const ref = takeEditRef(part);
        // A session opened FROM a draft keeps `?draft=` in the URL: reloading
        // must come back to the correction in progress, not to the published
        // take it corrects.
        const suffix = draft?.id ? `?draft=${encodeURIComponent(draft.id)}` : '';
        const hash = `${editTabHref(currentWork.id, ref)}${suffix}`;
        if (ref && window.location.hash !== hash) {
            history.replaceState({ view: 'song', songId: currentWork.id, edit: ref }, '', hash);
        }
    }
}

/** Back-compat name: "✏️ Edit on the take you are reading". */
async function enterTabEditMode(otf, part, container) {
    return mountTabEditor(otf, part, container, { kind: 'edit' });
}

/** Put the URL back on the take being read. */
function restoreWorkHash() {
    if (!currentWork?.id || currentWork.provisional) return;
    const partSeg = activePart?.partId && !activePart.default ? `/${activePart.partId}` : '';
    const hash = `#work/${currentWork.id}${partSeg}`;
    if (window.location.hash !== hash) {
        history.replaceState({ view: 'song', songId: currentWork.id }, '', hash);
    }
}

/** Submit a correction to an existing take (unchanged payload). */
async function submitTabCorrection(doc, part, comment, submitTab) {
    if (!requireLogin('submit tab corrections')) {
        throw new Error('Sign in to submit — opening sign-in…');
    }
    const result = await submitTab({
        type: 'tab-correction',
        otf: doc,
        title: currentWork?.title || doc.metadata?.title || 'Untitled',
        instrument: part.instrument || 'banjo',
        // WHICH take is being corrected. A work can carry several
        // arrangements per instrument, so the instrument alone names the
        // wrong file for every one but the first.
        file: part.src_file || undefined,
        workId: currentWork?.id,
        comment,
    });
    // The correction is live the moment the row lands — pull the overlay
    // into allSongs so every other surface (search, this work reopened, My
    // Submissions) sees it without a reload.
    await window.refreshPendingSongs?.();
    return result;
}

/**
 * A submitted correction is LIVE on this take — so the take becomes the
 * pending one, exactly as it will be for everyone else the moment the
 * overlay reaches them. The reader who just fixed bar 12 sees their fix,
 * badged as just-submitted, on the page they fixed it on.
 */
function landSubmittedCorrection(result, doc, part) {
    const take = activeArrangement(part) || part;
    take.pending = true;
    take.pending_id = result?.id || `correction:${part.instrument || 'tab'}`;
    take.content = JSON.stringify(doc);
    for (const f of ARRANGEMENT_FIELDS) part[f] = take[f];

    takeStatusLine = result?.synced === false
        ? 'Submitted — live now, syncing to the songbook; it appears in search after the next build.'
        : 'Submitted — live now, appears in search after the next build.';
}

// ============================================
// AUTHORING A NEW TAKE (add-tab / new-tab)
// ============================================

/** The take a new tab is written on, before anything has been submitted. */
function makeProvisionalTake(instrument, title) {
    const name = tabLabel(instrument).replace(/ Tab$/, '');
    return {
        instrument,
        label: `${name} — new take (unsaved)`,
        provisional: true,
        file: null,
        src_file: null,
        source: null,
        author: null,
        title: title || null,
    };
}

/**
 * Add an unsaved take to this work and open the editor on it.
 *
 * The page around it does not change: title, artist, Info, the other takes
 * and the bounty list are all still there, because what you are adding is
 * a take on THIS song and that is what the page has to show.
 *
 * @param {Object} target - {instrument, title, existingCount, otf?}
 */
export function startAddTabMode(target = {}) {
    if (!currentWork) return false;

    const instrument = sanitizeInstrument(target.instrument) || 'banjo';
    // An unsaved draft comes back only for the take it was written for —
    // same work (or the same "no work at all"). A draft from another song
    // is somebody else's notes appearing in your tab, so it stays parked.
    const draft = target.otf ? null : loadDraft();
    const draftFits = draft &&
        (draft.target?.workId || null) === (currentWork.provisional ? null : currentWork.id);
    // Precedence: a document handed in (a .tef import, a reopened bucket
    // draft) > the localStorage draft for this target > a fresh document.
    // `target.build` lets the caller shape the fresh one (time signature,
    // tempo, measures from a #new-tab query) WITHOUT pre-empting the draft
    // — passing a built `otf` would, and did, skip the resume.
    const otf = target.otf || (draftFits ? draft.otf : null)
        || (target.build ? target.build() : buildNewTab({
            title: currentWork.title || target.title || 'Untitled',
            instruments: [presetForInstrument(instrument)],
        }));

    const take = makeProvisionalTake(instrument, currentWork.title);

    // Beside the takes that already exist for this instrument when there
    // are any; a pill of its own when there aren't.
    // Instrument FAMILIES, not string equality — a part stored as
    // `5-string-banjo` is the banjo pill everywhere else in the app, and a
    // new banjo take belongs beside it rather than in a second pill.
    let part = availableParts.find(p =>
        p.type === 'tablature' && partMatchesInstrument(p, instrument));
    if (part) {
        part.arrangements = [...(part.arrangements || []), take];
        applyArrangement(part, part.arrangements.length - 1);
    } else {
        part = {
            type: 'tablature',
            format: 'otf',
            instrument,
            label: tabLabel(instrument),
            partId: slugify(tabLabel(instrument)),
            arrangements: [take],
            arrangementIndex: 0,
            aliases: [],
        };
        for (const f of ARRANGEMENT_FIELDS) part[f] = take[f];
        availableParts.push(part);
    }

    tabAuthoring = { kind: currentWork.provisional ? 'new' : 'add', part, take, target, otf };
    activePart = part;
    // Three things the take header can be honest about, in priority order:
    // this document came out of a FILE you just opened (a `.tef` dropped on
    // the window or opened by the OS — `file=1` on the route), it came back
    // from a draft, or it is new. The file case used to say nothing at all,
    // which read as "your file didn't import".
    takeStatusLine = target.fromFile
        ? 'Imported from a file — it is not submitted yet.'
        : ((draftFits && !target.otf)
            ? 'Picked up where you left off — this is your unsaved draft.'
            : null);
    setLoadedTablature(null);

    renderWorkView();
    return true;
}

/**
 * `#new-tab` — a provisional WORK page for a song the songbook doesn't
 * have. Same chrome, same take header, same band; the title and artist
 * are inputs in the title slot, and the submission mints the work.
 */
export function openNewTabPage(options = {}) {
    const instrument = sanitizeInstrument(options.instrument) || 'banjo';
    // Built lazily: startAddTabMode must get a chance to resume the
    // localStorage draft first (a reload of #new-tab keeps your notes).
    const build = () => buildNewTab({
        title: options.title || 'Untitled',
        instruments: options.instruments || [presetForInstrument(instrument)],
        timeSignature: options.timeSignature,
        tempo: options.tempo,
        measures: options.measures,
    });

    setCurrentChordpro(null);
    setCurrentView('song');
    setChromeAutoHide(true);
    teardownTablatureView();
    setBottomBand(null);
    setLoadedTablature(null);

    currentWork = {
        id: null,
        provisional: true,
        title: options.title || '',
        artist: '',
        tablature_parts: [],
    };
    currentArrangements = [];
    activeArrangementSlug = null;
    currentGroupVersions = [];
    availableParts = [];
    activePart = null;
    tabAuthoring = null;
    takeStatusLine = null;
    pendingInitialRender = true;
    pendingDraft = options.draft || null;

    startAddTabMode({
        instrument,
        title: options.title,
        otf: options.otf || null,
        fromFile: !!options.fromFile,
        build,
    });
    return true;
}

/** Cancel out of an unsaved take: drop it and put the page back. */
function exitAuthoring(reason, part, container) {
    const authoring = tabAuthoring;
    tabAuthoring = null;

    if (reason === 'cancel') {
        // Never leave an unsaved take sitting in the versions list — and
        // Cancel means "discard this take", so its draft goes with it.
        const takes = part.arrangements || [];
        const idx = takes.findIndex(a => a.provisional);
        if (idx >= 0) takes.splice(idx, 1);
        if (!takes.length) {
            availableParts = availableParts.filter(p => p !== part);
        }
        clearDraft();
        takeStatusLine = null;
        if (currentWork?.provisional) {
            goBack();
            return;
        }
        // Point the part back at a take that still exists BEFORE choosing
        // what to show: a stale index outlives this render otherwise.
        if (takes.length) applyArrangement(part, 0);
        // Back to the take they were adding one beside, when it still exists
        activePart = availableParts.includes(part)
            ? part
            : (availableParts.find(p => p.default) || availableParts[0] || null);
        restoreWorkHash();
        pendingInitialRender = true;
        renderWorkView();
        return;
    }

    // 'apply' never happens for a new take (there is no ✓ Done), but if it
    // ever does, keep the take and re-render it.
    tabAuthoring = authoring;
    renderTablaturePart(part, container);
}

/** Submit a brand-new take (add-tab / new-tab). Payload unchanged. */
async function submitAuthoredTake(doc, part) {
    const target = tabAuthoring?.target || {};
    const minting = !!currentWork?.provisional;
    // A MINT takes its title from the header field and nowhere else: the
    // document's own metadata says "Untitled" until someone types, and
    // minting `works/untitled` is how a corpus gets junk in it.
    const title = (minting
        ? (currentWork.title || '')
        : (currentWork?.title || target.title || doc.metadata?.title || '')).trim();
    if (!title) throw new Error('Give this tab a song title first.');

    // What was submitted is what the page must show as pending afterwards —
    // `tabAuthoring.otf` otherwise still holds the document as it was when
    // the editor opened (onApply only fires on Ctrl+S / ✓ Done).
    if (tabAuthoring) tabAuthoring.otf = doc;

    return submitNewTab(doc, {
        workId: currentWork?.provisional ? null : currentWork?.id,
        instrument: part.instrument || target.instrument,
        title,
        // Only travels with a MINT — submitNewTab drops it when there is a
        // target work, which already has an artist of its own.
        artist: currentWork?.provisional ? (currentWork.artist || '') : '',
    });
}

/**
 * A submitted take stops being provisional and becomes PENDING: the same
 * state a tab submitted from anywhere else is in — live on this page now,
 * in search after the next build. Nothing navigates.
 */
function landSubmittedTake(result, part, container) {
    const take = (part.arrangements || []).find(a => a.provisional) || part;
    const doc = tabAuthoring?.otf || activeEditSession?.editor?.save?.();

    take.provisional = false;
    take.pending = true;
    take.pending_id = result?.id || 'new-take';
    take.content = JSON.stringify(doc);
    take.label = `${tabLabel(part.instrument).replace(/ Tab$/, '')} — your take`;
    for (const f of ARRANGEMENT_FIELDS) part[f] = take[f];

    takeStatusLine = result?.synced === false
        ? 'Submitted — live now, syncing to the songbook; it appears in search after the next build.'
        : 'Submitted — live now, appears in search after the next build.';

    clearDraft();
    tabAuthoring = null;
    activeEditSession?.destroy();
    activeEditSession = null;
    activeEditBand?.destroy();
    activeEditBand = null;

    // A minted work has a real id the moment the server answers — the page
    // becomes that work's page without a reload.
    if (currentWork?.provisional && result?.workId) {
        currentWork.id = result.workId;
        currentWork.provisional = false;
        history.replaceState(
            { view: 'song', songId: result.workId }, '', `#work/${result.workId}`);
    } else {
        restoreWorkHash();
    }

    setLoadedTablature(null);
    pendingInitialRender = true;
    renderWorkView();
    window.refreshPendingSongs?.();
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
                // Two different escapes on purpose. escapeHtml() round-trips
                // through textContent, which escapes & < > and leaves QUOTES
                // alone — fine for a text node, not for an attribute value,
                // where a `"` in a track id closes the attribute and the rest
                // is markup. Track ids come out of user-submitted OTF files.
                const safeId = escapeHtml(track.id);
                const attrId = escapeAttr(track.id);
                return `<label class="track-toggle" title="${attrId}">
                    <input type="checkbox" class="track-checkbox" data-track-id="${attrId}" ${isLead ? 'checked' : ''}>
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
        <div class="qc-group tab-size-group">
            <button class="tab-size-down qc-btn" title="Decrease size">−</button>
            <span class="qc-label">Aa</span>
            <button class="tab-size-up qc-btn" title="Increase size">+</button>
        </div>
        <div class="qc-group qc-key-group">
            <button class="tab-key-down qc-btn" title="Transpose down">−</button>
            <span class="tab-key-slot"></span>
            <button class="tab-key-up qc-btn" title="Transpose up">+</button>
        </div>
        <div class="qc-group tab-tempo-group">
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

    // Phone: everything but Play/Stop/tempo/loop moves into a ⚙ sheet. The
    // nodes stay descendants of `controls`, so the querySelector wiring in
    // setupTablaturePlayer (which runs after this) is unaffected.
    attachTabControlsSheet(controls);

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
        // Size is a LAYOUT input, not a lens over a fixed drawing: each
        // renderer re-engraves into (container width / scale) and the CSS
        // transform scales that back up, so biggie-sizing gives FEWER
        // measures per row instead of a row that runs off the right edge.
        // Every track's renderer gets it — the old code set --tab-scale on
        // `document.querySelector('.tablature-container')`, i.e. the first
        // staff only, so on a multi-track work the others never changed
        // size at all. (`renderer.reflow` never existed; that branch was
        // dead, which is why nothing re-laid out.)
        for (const r of Object.values(trackRenderers)) r.setScale?.(currentScale);
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
        try {
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
        } catch (err) {
            // Blocked audio context, dead soundfont CDN, decode timeout —
            // say so out loud instead of leaving a Pause button that never
            // advances.
            console.error('Tab playback failed:', err);
            player.stop();
            showToast(err?.message || 'Could not start playback.',
                { variant: 'warning', duration: 5000 });
        }
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
        // FIRST, before any await: iOS only lets us open/resume the audio
        // context inside the tap's own call stack (tab-player.unlockAudio).
        player.unlockAudio();
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
    otfCacheKey,
    prettySource,
    tabLabel
};
