// WorkView - Dashboard for works showing available parts, bounties, and metadata
// Part of the works architecture refactor
//
// Principle: Song-view renders songs. Tab renderers render tabs.
// Work-view is a dashboard that links to them.

import {
    allSongs,
    songGroups,
    currentSong, setCurrentSong,
    currentChordpro, setCurrentChordpro,
    loadedTablature, setLoadedTablature,
    tablaturePlayer, setTablaturePlayer,
    currentDetectedKey, setCurrentDetectedKey,
    originalDetectedKey, setOriginalDetectedKey,
    originalDetectedMode, setOriginalDetectedMode,
    fullscreenMode, setFullscreenMode,
    listContext, setListContext,
    setCurrentView,
    resolveWorkId,
    getBountiesForWork
} from './state.js';

import {
    parseChordPro, showVersionPicker,
    openSong,
    toggleFullscreen, exitFullscreen,
    navigatePrev, navigateNext,
    updateFocusHeader, updateNavBar
} from './song-view.js';
import { detectKey, transposeChord, toNashville, getSemitonesBetweenKeys, KEYS, CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS } from './chords.js';
import { escapeHtml, partUsesSongActions, isPlaceholder, requireLogin, slugify, parseItemRef } from './utils.js';
import { openAddSongPicker } from './add-song-picker.js';
import {
    TabRenderer, TabPlayer, INSTRUMENT_ICONS,
    TimelineTiming, identityTimeline, readingListTimeline,
    expandNotation, makePlaybackToVisualMapper,
    maxMeasureIn, measureTimingFromOtf,
    analyzeReadingList, prepareCompactNotation,
} from './renderers/index.js';
import { clearListView } from './lists.js';
import { getTagCategory, formatTagName } from './tags.js';
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
}

function destroyTrackRenderers() {
    for (const r of Object.values(trackRenderers)) r.destroy?.();
    trackRenderers = {};
}

let inlineExpanded = false;      // true = showing a part inline (tab/doc), false = showing dashboard
let currentGroupVersions = [];   // All versions in the current group (for version cards)

/**
 * Pick the best representative version from a group for display.
 * Prefers: version with content > most chords > highest canonical_rank.
 */
function pickRepresentative(versions) {
    if (versions.length === 0) return null;
    if (versions.length === 1) return versions[0];
    return [...versions].sort((a, b) => {
        const aHasContent = a.content ? 1 : 0;
        const bHasContent = b.content ? 1 : 0;
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
function buildPartsFromIndex(song) {
    const parts = [];

    if (song.content) {
        const label = song.abc_content ? 'Fiddle' : 'Lyrics & Chords';
        parts.push({
            type: 'lead-sheet',
            format: 'chordpro',
            label: label,
            content: song.content,
            default: true
        });
    }

    if (song.tablature_parts) {
        for (const tab of song.tablature_parts) {
            parts.push({
                type: 'tablature',
                format: 'otf',
                instrument: tab.instrument,
                label: tab.label || `${tab.instrument} Tab`,
                file: tab.file,
                default: !song.content,
                source: tab.source,
                source_id: tab.source_id,
                author: tab.author,
                source_page_url: tab.source_page_url,
                author_url: tab.author_url,
            });
        }
    }

    if (song.document_parts) {
        for (const doc of song.document_parts) {
            parts.push({
                type: 'document',
                format: doc.format || 'pdf',
                label: doc.label || 'PDF',
                file: doc.file,
                default: !song.content && !song.tablature_parts?.length,
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

    return parts;
}

/**
 * Open a work by ID
 */
export async function openWork(workId, options = {}) {
    workId = resolveWorkId(workId);

    let song = allSongs.find(s => s.id === workId);
    if (!song) {
        if (window.refreshPendingSongs) {
            await window.refreshPendingSongs();
            song = allSongs.find(s => s.id === workId);
        }
    }
    if (!song) {
        console.error(`Work not found: ${workId}`);
        return;
    }

    const { fromList = false, groupId = null } = options;

    // Store group context for version cards
    if (groupId && songGroups[groupId]) {
        currentGroupVersions = songGroups[groupId];
    } else if (song.group_id && songGroups[song.group_id]) {
        currentGroupVersions = songGroups[song.group_id];
    } else {
        currentGroupVersions = [];
    }

    // For multi-version groups, always use the canonical representative
    // so the URL is stable regardless of which version you came from
    if (currentGroupVersions.length > 1) {
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

        // Exit fullscreen when opening dashboard directly (not from list nav)
        if (fullscreenMode) {
            document.body.classList.remove('fullscreen-mode');
            setFullscreenMode(false);
        }
        const navBar = document.getElementById('song-nav-bar');
        if (navBar) navBar.classList.add('hidden');
    }

    setCurrentChordpro(null);
    setCurrentView('song');

    setOriginalDetectedKey(null);
    setOriginalDetectedMode(null);
    setCurrentDetectedKey(null);

    // Reset tablature state for new work
    activeTrackView = null;
    setLoadedTablature(null);
    teardownTablatureView();

    currentWork = song;
    availableParts = buildPartsFromIndex(song);
    setCurrentSong(song);
    inlineExpanded = false;

    // Hide Work button on the dashboard — it only makes sense as
    // "go back to all parts" when viewing a specific part in song-view
    const workViewBtn = document.getElementById('work-view-btn');
    if (workViewBtn) workViewBtn.classList.add('hidden');

    // Hide song-view header actions that don't apply to the work dashboard
    const editBtn = document.getElementById('edit-song-btn');
    const exportBtn = document.getElementById('export-btn');
    const exportWrapper = exportBtn?.closest('.export-wrapper');
    if (isPlaceholder(song)) {
        // Placeholders: show Edit (intercepted to show placeholder editor), hide Export
        if (editBtn) editBtn.classList.remove('hidden');
        if (exportWrapper) exportWrapper.classList.add('hidden');
        window.__editInterceptor = () => {
            showPlaceholderEditor();
            return true;
        };
    } else {
        if (editBtn) editBtn.classList.remove('hidden');
        if (exportWrapper) exportWrapper.classList.remove('hidden');
        window.__editInterceptor = null;
    }

    // If a specific part was requested via deep link, expand it inline
    if (options.partId) {
        activePart = availableParts.find(p =>
            p.partId === options.partId ||
            p.instrument === options.partId ||
            p.type === options.partId
        );
        if (activePart && (activePart.type === 'tablature' || activePart.type === 'lead-sheet' || activePart.type === 'document')) {
            inlineExpanded = true;
        }
    } else if (fromList && availableParts.length > 0) {
        // From list navigation: auto-expand the default part for focus mode
        activePart = availableParts.find(p => p.default) || availableParts[0];
        inlineExpanded = true;
    } else {
        activePart = null;
    }

    // Update list context index when navigating within a list
    if (fromList && listContext && listContext.songIds) {
        const idx = listContext.songIds.indexOf(workId);
        if (idx !== -1) {
            setListContext({ ...listContext, currentIndex: idx });
        }
    }

    // Auto-enter fullscreen when opening from a list
    if (fromList && listContext) {
        setFullscreenMode(true);
        document.body.classList.add('fullscreen-mode');
        document.body.classList.add('has-list-context');
    }

    renderWorkView();

    // Update focus header and nav bar for list context
    if (fromList) {
        updateFocusHeader();
        updateNavBar();
    }

    const resolvedPartId = activePart?.partId || options.partId;
    const hash = resolvedPartId
        ? `#work/${workId}/${resolvedPartId}`
        : `#work/${workId}`;

    if (window.location.hash !== hash && !options.fromDeepLink) {
        history.pushState({ workId, partId: resolvedPartId }, '', hash);
    }
}

// ============================================
// RENDERING
// ============================================

/**
 * Main render function for work view - dashboard layout
 */
export function renderWorkView() {
    const container = document.getElementById('song-content');
    if (!container || !currentWork) return;

    container.innerHTML = '';

    // The header ✏️ Edit edits chordpro lead sheets; on a tablature part
    // it would open an empty song editor. Hide it — the tab controls row
    // has its own Edit. (song-view restores it when a song renders.)
    const editSongBtn = document.getElementById('edit-song-btn');
    if (editSongBtn) {
        editSongBtn.style.display = partUsesSongActions(activePart) ? '' : 'none';
    }

    // Focus header (shown only in fullscreen mode via CSS)
    if (inlineExpanded) {
        const focusHeader = renderWorkFocusHeader();
        container.appendChild(focusHeader);
    }

    // Work header
    const header = renderWorkHeader();
    container.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.className = 'work-part-content';
    container.appendChild(content);

    if (inlineExpanded && activePart) {
        // Inline expansion mode: show back button + content
        renderInlineExpansion(activePart, content);
    } else {
        // Version cards (multi-version works) — replaces part cards when present
        const versionCards = renderVersionCards();
        if (versionCards) {
            content.appendChild(versionCards);
        } else {
            // Single-version: show part cards as before
            const cards = renderPartCards();
            if (cards) {
                content.appendChild(cards);
            }
        }

        // Placeholder CTA
        if (isPlaceholder(currentWork)) {
            const cta = document.createElement('div');
            cta.className = 'placeholder-cta';
            const hasContent = availableParts.length > 0;
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
            content.appendChild(cta);
        }
    }

    // Bounty section - only on dashboard, not in part views
    if (!inlineExpanded) {
        const bountySection = renderBountySection();
        if (bountySection) {
            container.appendChild(bountySection);
        }
    }
}

/**
 * Render simplified work header - metadata only, no content controls
 */
function renderWorkHeader() {
    const header = document.createElement('div');
    header.className = 'work-header-container';

    const title = currentWork.title || 'Untitled';
    const artist = currentWork.artist || '';
    const composer = currentWork.composer || '';

    // Version count display (informational — version cards shown below)
    const versionCount = currentGroupVersions.length;
    const versionHtml = versionCount > 1
        ? `<span class="version-count-display">${versionCount} versions</span>`
        : '';

    // Build artists list
    const allArtists = new Set();
    if (artist) allArtists.add(artist);
    const coveringArtists = currentWork?.covering_artists || [];
    coveringArtists.forEach(a => allArtists.add(a));
    currentGroupVersions.forEach(v => { if (v.artist) allArtists.add(v.artist); });
    const artistsList = Array.from(allArtists);

    // Build info items
    let infoItems = [];
    if (composer) {
        infoItems.push(`<div class="info-item"><span class="info-label">Written by:</span> ${escapeHtml(composer)}</div>`);
    }

    const source = currentWork.source;
    if (source && SOURCE_DISPLAY_NAMES[source]) {
        infoItems.push(`<div class="info-item"><span class="info-label">Source:</span> ${SOURCE_DISPLAY_NAMES[source]}</div>`);
    }
    if (artistsList.length > 0) {
        const maxVisible = 3;
        const hasMore = artistsList.length > maxVisible;
        const visibleArtists = hasMore ? artistsList.slice(0, maxVisible) : artistsList;
        const hiddenArtists = hasMore ? artistsList.slice(maxVisible) : [];

        const artistsHtml = hasMore
            ? `<span class="artists-visible">${visibleArtists.map(a => escapeHtml(a)).join(', ')}</span><button class="artists-toggle" id="artists-expand" type="button">… <span class="artists-more">(+${hiddenArtists.length})</span></button><span class="artists-hidden hidden" id="artists-full">, ${hiddenArtists.map(a => escapeHtml(a)).join(', ')}</span><button class="artists-toggle hidden" id="artists-collapse" type="button">(collapse)</button>`
            : visibleArtists.map(a => escapeHtml(a)).join(', ');

        infoItems.push(`<div class="info-item"><span class="info-label">Artists:</span> <span class="artists-list">${artistsHtml}</span></div>`);
    }

    if (currentWork.notes) {
        infoItems.push(`<div class="info-item"><span class="info-label">Notes:</span> ${escapeHtml(currentWork.notes)}</div>`);
    }

    // Tags with voting controls
    const songTags = currentWork?.tags || {};
    const tagNames = Object.keys(songTags);
    const isLoggedIn = window.SupabaseAuth?.isLoggedIn?.() || false;

    const tagsHtml = tagNames.length > 0
        ? tagNames.map(tag => {
            const category = getTagCategory(tag);
            const displayName = formatTagName(tag);
            return `
                <span class="votable-tag tag-${category}" data-tag="${escapeHtml(tag)}">
                    <span class="tag-name">${escapeHtml(displayName)}</span>
                    ${isLoggedIn ? `
                        <span class="vote-chip">
                            <button class="vote-btn vote-up" data-vote="1" title="Agree">
                                <svg width="14" height="16" viewBox="0 0 10 12"><path d="M5 0L10 6H7V9H3V6H0L5 0Z" fill="currentColor"/></svg>
                            </button>
                            <span class="vote-divider"></span>
                            <button class="vote-btn vote-down" data-vote="-1" title="Disagree">
                                <svg width="14" height="16" viewBox="0 0 10 12"><path d="M5 12L0 6H3V3H7V6H10L5 12Z" fill="currentColor"/></svg>
                            </button>
                        </span>
                    ` : ''}
                </span>
            `;
        }).join('')
        : '<em class="no-tags">None</em>';

    const infoBarCollapsed = localStorage.getItem('infoBarCollapsed') !== 'false'; // Default collapsed

    const headerControlsHtml = `
        <div class="header-controls">
            <button id="flag-btn" class="flag-btn" title="Report an issue">🚩 Report</button>
            <button id="info-toggle" class="disclosure-btn" title="Toggle info">🎵 Info <span class="disclosure-arrow">${infoBarCollapsed ? '▼' : '▲'}</span></button>
        </div>
    `;

    // Info disclosure content
    const infoContentHtml = `
        <div id="info-content" class="info-content ${infoBarCollapsed ? 'hidden' : ''}">
            <div class="info-details">
                ${infoItems.join('')}
            </div>
            <div class="info-tags">
                <div class="info-tags-label">Tags:</div>
                <div class="song-tags-row">
                    <span id="song-tags-container" class="song-tags" data-song-id="${currentWork.id}">${tagsHtml}</span>
                    ${isLoggedIn ? `<button class="add-tags-btn" data-song-id="${currentWork.id}">+ Add your own</button>` : ''}
                </div>
            </div>
        </div>
    `;

    header.innerHTML = `
        <div class="song-header">
            <div class="song-header-left">
                <div class="song-title-row">
                    <span class="song-title">${escapeHtml(title)}</span>
                    ${isPlaceholder(currentWork) ? '<span class="placeholder-badge">Placeholder</span>' : ''}
                    ${versionHtml}
                    ${inlineExpanded ? '<button id="add-to-list-btn" class="add-to-list-btn" title="Add to list">+ Lists</button>' : ''}
                    ${inlineExpanded ? '<button id="focus-btn" class="focus-btn" title="Focus mode (F)">&#x26F6; Focus</button>' : ''}
                    ${inlineExpanded && activePart?.type === 'tablature' ? '<button id="work-controls-toggle" class="focus-btn" title="Toggle controls">&#x2699;&#xFE0F; Controls</button>' : ''}
                </div>
            </div>
            ${headerControlsHtml}
        </div>
        ${infoContentHtml}
    `;

    // Wire up info toggle
    const infoToggle = header.querySelector('#info-toggle');
    const infoContent = header.querySelector('#info-content');
    if (infoToggle && infoContent) {
        infoToggle.addEventListener('click', () => {
            const isCollapsed = infoContent.classList.toggle('hidden');
            localStorage.setItem('infoBarCollapsed', isCollapsed);
            const arrow = infoToggle.querySelector('.disclosure-arrow');
            if (arrow) arrow.textContent = isCollapsed ? '▼' : '▲';
        });
    }

    // Wire up artists expand/collapse
    const artistsExpand = header.querySelector('#artists-expand');
    const artistsCollapse = header.querySelector('#artists-collapse');
    if (artistsExpand) {
        artistsExpand.addEventListener('click', () => {
            header.querySelector('#artists-full')?.classList.remove('hidden');
            header.querySelector('#artists-collapse')?.classList.remove('hidden');
            artistsExpand.classList.add('hidden');
        });
    }
    if (artistsCollapse) {
        artistsCollapse.addEventListener('click', () => {
            header.querySelector('#artists-full')?.classList.add('hidden');
            artistsCollapse.classList.add('hidden');
            header.querySelector('#artists-expand')?.classList.remove('hidden');
        });
    }

    // Wire up controls toggle (non-fullscreen)
    const controlsToggle = header.querySelector('#work-controls-toggle');
    if (controlsToggle) {
        controlsToggle.addEventListener('click', () => {
            const controls = document.getElementById('work-controls-content');
            if (controls) {
                controls.classList.toggle('hidden');
            }
        });
    }

    return header;
}

// ============================================
// FOCUS HEADER (for fullscreen mode in work-view)
// ============================================

/**
 * Render focus header for work-view inline expansion.
 * Same structure as song-view focus header for consistent UX.
 */
function renderWorkFocusHeader() {
    const title = currentWork?.title || 'Untitled';
    const partLabel = activePart?.label ? ` - ${activePart.label}` : '';

    const header = document.createElement('div');
    header.className = 'focus-header';
    header.innerHTML = `
        <button id="focus-prev-btn" class="focus-list-nav" title="Previous song (\u2190)">\u2190</button>
        <div class="focus-title-area">
            <span class="focus-title">${escapeHtml(title)}${escapeHtml(partLabel)}</span>
            <span id="focus-position" class="focus-position"></span>
        </div>
        <button id="focus-exit-btn" class="focus-nav-btn" title="Exit focus mode">
            <span>\u2715</span>
            <span class="focus-btn-label">Exit</span>
        </button>
        <button id="focus-goto-song-btn" class="focus-nav-btn" title="View work dashboard">
            <span>\uD83C\uDFB5</span>
            <span class="focus-btn-label">Go to Song</span>
        </button>
        <button id="focus-controls-toggle" class="focus-nav-btn" title="Toggle controls">
            <span>\u2699\uFE0F</span>
            <span class="focus-btn-label">Controls</span>
        </button>
        <button id="focus-next-btn" class="focus-list-nav" title="Next song (\u2192)">\u2192</button>
    `;

    // Wire up event handlers
    header.querySelector('#focus-exit-btn')?.addEventListener('click', () => {
        exitFullscreen();
    });

    header.querySelector('#focus-goto-song-btn')?.addEventListener('click', () => {
        // Exit focus mode and navigate to work dashboard
        setFullscreenMode(false);
        document.body.classList.remove('fullscreen-mode');
        document.body.classList.remove('has-list-context');
        clearListView();
        // Re-open as dashboard (not inline)
        inlineExpanded = false;
        activePart = null;
        renderWorkView();
        const hash = `#work/${currentWork.id}`;
        history.pushState({ workId: currentWork.id }, '', hash);
    });

    header.querySelector('#focus-prev-btn')?.addEventListener('click', () => {
        navigatePrev();
    });

    header.querySelector('#focus-next-btn')?.addEventListener('click', () => {
        navigateNext();
    });

    header.querySelector('#focus-controls-toggle')?.addEventListener('click', () => {
        const controls = document.getElementById('work-controls-content');
        if (controls) {
            controls.classList.toggle('hidden');
        }
    });

    return header;
}

// ============================================
// VERSION CARDS (Dashboard - multi-version works)
// ============================================

/**
 * Source display names for version attribution
 */
const SOURCE_DISPLAY_NAMES = {
    'classic-country': 'Classic Country Song Lyrics',
    'golden-standard': 'Golden Standards Collection',
    'tunearch': 'TuneArch.org',
    'manual': 'Community Contribution',
    'trusted-user': 'Community Contribution',
    'pending': 'Community Contribution',
    'banjo-hangout': 'Banjo Hangout',
    'ultimate-guitar': 'Community Contribution',
    'bluegrass-lyrics': 'BluegrassLyrics.com',
};

/**
 * Render version cards section for multi-version works.
 * Shows all versions in the group as cards with metadata.
 */
function renderVersionCards() {
    if (currentGroupVersions.length <= 1) return null;

    const section = document.createElement('div');
    section.className = 'work-versions-section';

    const heading = document.createElement('div');
    heading.className = 'work-versions-heading';
    heading.textContent = `${currentGroupVersions.length} Versions`;
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'work-versions-grid';

    for (const version of currentGroupVersions) {
        const card = createVersionCard(version);
        grid.appendChild(card);
    }

    section.appendChild(grid);
    return section;
}

/**
 * Create a single version card
 */
function createVersionCard(version) {
    const card = document.createElement('div');
    card.className = 'version-card';

    const isCurrent = version.id === currentWork?.id;
    if (isCurrent) card.classList.add('version-card-current');

    // Determine label: "Lyrics & Chords" or "Lyrics"
    const hasChords = (version.chord_count || 0) > 0;
    const hasContent = !!version.content;
    let typeLabel;
    if (hasContent) {
        typeLabel = hasChords ? 'Lyrics & Chords' : 'Lyrics';
    } else if (version.tablature_parts?.length > 0) {
        typeLabel = 'Tablature';
    } else {
        typeLabel = 'Song';
    }

    // Source attribution
    const sourceName = SOURCE_DISPLAY_NAMES[version.source] || '';
    const sourceHtml = sourceName
        ? `<div class="version-card-source">From ${escapeHtml(sourceName)}</div>`
        : '';

    // Key + chord count
    const metaParts = [];
    if (version.key) metaParts.push(`Key: ${version.key}`);
    if (hasChords) metaParts.push(`${version.chord_count} chords`);
    const metaHtml = metaParts.length
        ? `<div class="version-card-meta">${escapeHtml(metaParts.join(' · '))}</div>`
        : '';

    // First line preview
    const firstLine = version.first_line || '';
    const previewHtml = firstLine
        ? `<div class="version-card-preview">"${escapeHtml(firstLine.substring(0, 80))}"</div>`
        : '';

    // Artist (if different from current work)
    const artistHtml = version.artist && version.artist !== currentWork?.artist
        ? `<div class="version-card-artist">${escapeHtml(version.artist)}</div>`
        : '';

    card.innerHTML = `
        <div class="version-card-body">
            <div class="version-card-label">${escapeHtml(typeLabel)}</div>
            ${artistHtml}
            ${sourceHtml}
            ${metaHtml}
            ${previewHtml}
        </div>
    `;

    // Click to open this version directly in song view
    card.addEventListener('click', () => {
        const isTabOnly = version.tablature_parts?.length > 0 && !version.content;
        if (isTabOnly || version.status === 'placeholder') {
            openWork(version.id, { groupId: version.group_id });
        } else {
            openSong(version.id);
        }
    });

    return card;
}

// ============================================
// PART CARDS (Dashboard)
// ============================================

/**
 * Render part cards grid showing available content
 */
function renderPartCards() {
    if (availableParts.length === 0) return null;

    const grid = document.createElement('div');
    grid.className = 'work-dashboard-cards';

    for (const part of availableParts) {
        const card = createPartCard(part);
        grid.appendChild(card);
    }

    return grid;
}

/**
 * Create a single part card
 */
function createPartCard(part) {
    const card = document.createElement('div');
    card.className = 'work-part-card';

    if (part.type === 'lead-sheet') {
        const icon = '📄';
        const key = currentWork.key ? `Key: ${currentWork.key}` : '';
        const chordCount = currentWork.chord_count ? `${currentWork.chord_count} chords` : '';
        const meta = [key, chordCount].filter(Boolean).join(' · ');
        const firstLine = currentWork.first_line ? escapeHtml(currentWork.first_line) : '';

        card.innerHTML = `
            <div class="work-card-icon">${icon}</div>
            <div class="work-card-body">
                <div class="work-card-label">${escapeHtml(part.label)}</div>
                ${meta ? `<div class="work-card-meta">${meta}</div>` : ''}
                ${firstLine ? `<div class="work-card-preview">${firstLine}</div>` : ''}
            </div>
            <button class="work-card-action">View</button>
        `;

        const viewAction = () => {
            activePart = part;
            inlineExpanded = true;
            renderWorkView();
            const hash = `#work/${currentWork.id}/${part.partId}`;
            history.pushState({ workId: currentWork.id, partId: part.partId }, '', hash);
        };

        card.querySelector('.work-card-action').addEventListener('click', viewAction);
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.work-card-action')) viewAction();
        });

    } else if (part.type === 'tablature') {
        const icon = INSTRUMENT_ICONS[part.instrument] || '🎵';
        const meta = [];
        if (part.author) meta.push(`by ${part.author}`);
        if (part.source === 'banjo-hangout') meta.push('Banjo Hangout');

        card.innerHTML = `
            <div class="work-card-icon">${icon}</div>
            <div class="work-card-body">
                <div class="work-card-label">${escapeHtml(part.label)}</div>
                ${meta.length ? `<div class="work-card-meta">${escapeHtml(meta.join(' · '))}</div>` : ''}
            </div>
            <button class="work-card-action">View</button>
        `;

        const viewAction = () => {
            activePart = part;
            inlineExpanded = true;
            renderWorkView();
            const hash = `#work/${currentWork.id}/${part.partId}`;
            history.pushState({ workId: currentWork.id, partId: part.partId }, '', hash);
        };

        card.querySelector('.work-card-action').addEventListener('click', viewAction);
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.work-card-action')) viewAction();
        });

    } else if (part.type === 'document') {
        const icon = '📎';

        card.innerHTML = `
            <div class="work-card-icon">${icon}</div>
            <div class="work-card-body">
                <div class="work-card-label">${escapeHtml(part.label)}</div>
                <div class="work-card-meta">${part.format?.toUpperCase() || 'PDF'}</div>
            </div>
            <button class="work-card-action">View</button>
        `;

        const viewAction = () => {
            activePart = part;
            inlineExpanded = true;
            renderWorkView();
            const hash = `#work/${currentWork.id}/${part.partId}`;
            history.pushState({ workId: currentWork.id, partId: part.partId }, '', hash);
        };

        card.querySelector('.work-card-action').addEventListener('click', viewAction);
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.work-card-action')) viewAction();
        });
    }

    return card;
}

// ============================================
// INLINE EXPANSION (Tab/Doc within dashboard)
// ============================================

/**
 * Render a part inline with a back button to return to dashboard
 */
function renderInlineExpansion(part, container) {
    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'work-inline-back';
    backBtn.textContent = '\uD83D\uDCCB Work';
    backBtn.addEventListener('click', () => {
        inlineExpanded = false;
        activePart = null;
        // Stop any playing tablature
        if (tablaturePlayer) {
            tablaturePlayer.stop();
            setTablaturePlayer(null);
        }
        renderWorkView();
        // Update URL back to work
        const hash = `#work/${currentWork.id}`;
        history.pushState({ workId: currentWork.id }, '', hash);
    });
    container.appendChild(backBtn);

    // Controls container (tab controls go here, toggled via Controls button).
    // Tablature parts default the controls OPEN — Play/tempo/Edit hidden
    // behind a collapsed ⚙️ was the #1 "where's the play button?" complaint.
    // An explicit user toggle (stored value) is respected either way.
    const storedControls = localStorage.getItem('workControlsCollapsed');
    const isTabPart = part?.type === 'tablature';
    const controlsCollapsed = storedControls === null
        ? !isTabPart                       // default: open for tabs, closed for lyrics
        : storedControls !== 'false';
    const controlsArea = document.createElement('div');
    controlsArea.className = `work-inline-controls${controlsCollapsed ? ' hidden' : ''}`;
    controlsArea.id = 'work-controls-content';
    container.appendChild(controlsArea);

    // Content
    const contentArea = document.createElement('div');
    contentArea.className = 'work-inline-content';
    container.appendChild(contentArea);

    if (part.type === 'tablature') {
        renderTablaturePart(part, contentArea);
    } else if (part.type === 'lead-sheet') {
        renderLeadSheetPart(part, contentArea);
    } else if (part.type === 'document') {
        renderDocumentPart(part, contentArea);
    }
}

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

    const entry = {
        id: currentWork.id,
        replaces_id: currentWork.id,
        title,
        artist: artist || null,
        content: currentWork.content || null,
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
// PART RENDERERS (Tab + Doc for inline expansion)
// ============================================

/**
 * Render lead-sheet part inline.
 * ABC notation is rendered via ABCJS. ChordPro falls back to openSong().
 */
function renderLeadSheetPart(part, container) {
    const abcContent = currentWork.abc_content;

    if (abcContent) {
        // Render ABC notation inline
        const abcId = 'work-abc-notation';
        container.innerHTML = `<div id="${abcId}" class="abc-notation-container"></div>`;

        // Use ABCJS if available
        if (typeof ABCJS !== 'undefined') {
            try {
                const containerWidth = container.clientWidth || window.innerWidth - 32;
                const isMobile = window.innerWidth <= 600;
                const minWidth = isMobile ? 280 : 400;
                const staffwidth = Math.max(minWidth, containerWidth - 32);

                ABCJS.renderAbc(abcId, abcContent, {
                    staffwidth,
                    scale: 1.0,
                    add_classes: true,
                    wrap: {
                        minSpacing: 1.5,
                        maxSpacing: 2.5,
                        preferredMeasuresPerLine: 4
                    },
                    paddingleft: 0,
                    paddingright: 0,
                    paddingbottom: 30
                });
            } catch (e) {
                console.error('ABC rendering error:', e);
                container.innerHTML = `<pre class="abc-fallback">${escapeHtml(abcContent)}</pre>`;
            }
        } else {
            container.innerHTML = `<pre class="abc-fallback">${escapeHtml(abcContent)}</pre>`;
        }

        // Source attribution
        if (currentWork.source) {
            const sourceEl = document.createElement('div');
            sourceEl.className = 'work-inline-source';
            sourceEl.textContent = `Source: ${currentWork.source}`;
            container.appendChild(sourceEl);
        }
    } else {
        // ChordPro lead sheet - open in song view (full rendering pipeline)
        openSong(currentWork.id);
    }
}

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

        // Inject controls into the inline controls area
        const controls = createTablatureControls(otf, part);
        const controlsContent = document.getElementById('work-controls-content');
        if (controlsContent) {
            controlsContent.innerHTML = '';
            controlsContent.appendChild(controls);
        } else {
            container.appendChild(controls);
        }

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

        // Determine which track is the "lead" (matches part instrument, or first track)
        let leadTrackId = otf.tracks[0]?.id;
        if (part.instrument && otf.tracks.length > 1) {
            const matchingTrack = otf.tracks.find(t =>
                t.instrument?.includes(part.instrument) ||
                t.id?.includes(part.instrument)
            );
            if (matchingTrack) {
                leadTrackId = matchingTrack.id;
            }
        }

        for (const track of otf.tracks) {
            let notation = otf.notation[track.id];
            if (!notation || notation.length === 0) continue;

            const isLead = track.id === leadTrackId || track.role === 'lead';
            const isMandolin = track.instrument?.includes('mandolin') || track.id?.includes('mandolin');

            if (isMandolin && !isLead) continue;

            if (showRepeatsCompact && otf.reading_list && otf.reading_list.length > 0) {
                notation = prepareCompactNotation(notation, otf.reading_list);
            } else if (otf.reading_list && otf.reading_list.length > 0) {
                notation = expandNotation(notation, timings.playbackTimeline);
            }
            const icon = INSTRUMENT_ICONS[track.instrument] ||
                        (track.id.includes('banjo') ? '🪕' :
                         track.id.includes('mandolin') ? '🎸' :
                         track.id.includes('guitar') ? '🎸' :
                         track.id.includes('fiddle') ? '🎻' : '🎵');

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
        }

        // Populate the view tabs from the tracks that actually rendered
        const renderedIds = Object.keys(trackRenderers);
        if (renderedIds.length > 1) {
            const current = activeTrackView ?? leadTrackId;
            trackTabsBar.innerHTML = [
                ...renderedIds.map(id => `
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

        // Wire up repeat notation select (re-renders with repeat signs
        // or unrolled)
        const repeatSelect = controls.querySelector('.tab-repeat-select');
        if (repeatSelect) {
            repeatSelect.addEventListener('change', () => {
                showRepeatsCompact = repeatSelect.value === 'repeats';
                renderTablaturePart(part, container);
            });
        }

        // Wire up two-feel toggle (cut-time presentation, re-render)
        const feelSelect = controls.querySelector('.tab-feel-select');
        if (feelSelect) {
            feelSelect.addEventListener('change', () => {
                twoFeelMode = feelSelect.value === 'two';
                renderTablaturePart(part, container);
            });
        }

        const leadRenderer = trackRenderers[leadTrackId] || Object.values(trackRenderers)[0];
        setupTablaturePlayer(otf, controls, leadRenderer);

        // Wire up the Edit button — swap the rendered tab for an edit session
        const editBtn = controls.querySelector('.tab-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => enterTabEditMode(otf, part, container));
        }

        // Add attribution section for Banjo Hangout tabs
        if (part.source === 'banjo-hangout') {
            const attribution = document.createElement('div');
            attribution.className = 'tab-attribution';

            let attrHtml = '<div class="attribution-content">';
            if (part.author) {
                attrHtml += '<span class="attribution-item">Tabbed by ';
                if (part.author_url) {
                    attrHtml += `<a href="${part.author_url}" target="_blank" rel="noopener">${escapeHtml(part.author)}</a>`;
                } else {
                    attrHtml += escapeHtml(part.author);
                }
                attrHtml += '</span>';
            }
            if (part.source_page_url) {
                attrHtml += `<span class="attribution-item"><a href="${part.source_page_url}" target="_blank" rel="noopener">View on Banjo Hangout</a></span>`;
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

    // Park the header controls while editing (they drive dead renderers)
    const controlsContent = document.getElementById('work-controls-content');
    if (controlsContent) {
        controlsContent.innerHTML = '<div class="tab-controls"><em>Editing — use the editor bar below. ✓ Done applies your changes, Cancel discards them.</em></div>';
    }

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

    const filteredTracks = otf.tracks.filter(track => {
        const isMandolin = track.instrument?.includes('mandolin') || track.id?.includes('mandolin');
        const isLead = track.role === 'lead' || track.instrument?.includes('banjo') ||
                       (part.instrument && track.instrument?.includes(part.instrument));
        return !isMandolin || isLead;
    });

    const trackMixerHtml = filteredTracks.length > 1 ? `
        <div class="tab-track-mixer">
            <span class="mixer-label">Sound:</span>
            ${filteredTracks.map(track => {
                const icon = track.instrument?.includes('banjo') ? '🪕' :
                            track.instrument?.includes('guitar') ? '🎸' :
                            track.instrument?.includes('mandolin') ? '🎸' :
                            track.instrument?.includes('bass') ? '🎸' :
                            track.instrument?.includes('fiddle') ? '🎻' : '🎵';
                const isLead = track.role === 'lead' || track.instrument?.includes('banjo');
                const safeId = escapeHtml(track.id);
                return `<label class="track-toggle" title="${safeId}">
                    <input type="checkbox" class="track-checkbox" data-track-id="${safeId}" ${isLead ? 'checked' : ''}>
                    <span class="track-icon">${icon}</span>
                    <span class="track-name">${safeId}</span>
                </label>`;
            }).join('')}
        </div>
    ` : '';

    const hasReadingList = otf.reading_list && otf.reading_list.length > 0;
    const repeatToggleHtml = hasReadingList ? `
        <div class="qc-group">
            <select class="tab-repeat-select qc-key-btn" title="Repeat notation: unrolled or repeat signs">
                <option value="unrolled" ${showRepeatsCompact ? '' : 'selected'}>Unrolled</option>
                <option value="repeats" ${showRepeatsCompact ? 'selected' : ''}>Repeats</option>
            </select>
        </div>
    ` : '';

    // Feel selector (4/4 tunes only): explicit dropdown, no ambiguous
    // toggle state
    const feelToggleHtml = (otf.metadata?.time_signature || '4/4') === '4/4' ? `
        <div class="qc-group">
            <select class="tab-feel-select qc-key-btn" title="Rhythmic feel: quarter-note pulse or cut time (BPM counts the feel's beat)">
                <option value="four" ${twoFeelMode ? '' : 'selected'}>Four feel</option>
                <option value="two" ${twoFeelMode ? 'selected' : ''}>Two feel</option>
            </select>
        </div>
    ` : '';

    const keyOptions = CHROMATIC_MAJOR_KEYS.map(k => {
        const capo = (CHROMATIC_MAJOR_KEYS.indexOf(k) - CHROMATIC_MAJOR_KEYS.indexOf(originalKey) + 12) % 12;
        const capoLabel = capo === 0 ? '' : ` (Capo ${capo})`;
        return `<option value="${k}" data-capo="${capo}" ${k === originalKey ? 'selected' : ''}>${k}${capoLabel}</option>`;
    }).join('');

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
            <select class="tab-key-select qc-key-btn" title="Select key">
                ${keyOptions}
            </select>
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
        ${repeatToggleHtml}
        ${feelToggleHtml}
        <span class="tab-position"></span>
        <span class="tab-capo-indicator"></span>
        ${trackMixerHtml}
    `;

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
    const posEl = controls.querySelector('.tab-position');
    const tempoDisplay = controls.querySelector('.tab-tempo-display');
    const tempoDown = controls.querySelector('.tab-tempo-down');
    const tempoUp = controls.querySelector('.tab-tempo-up');
    const keySelect = controls.querySelector('.tab-key-select');
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

    const selectKeyByIndex = (index) => {
        const options = keySelect.options;
        const newIndex = Math.max(0, Math.min(options.length - 1, index));
        keySelect.selectedIndex = newIndex;
        currentCapo = parseInt(options[newIndex].dataset.capo, 10) || 0;
        updateCapoIndicator();
    };

    keySelect?.addEventListener('change', () => {
        currentCapo = parseInt(keySelect.options[keySelect.selectedIndex].dataset.capo, 10) || 0;
        updateCapoIndicator();
    });

    keyDown?.addEventListener('click', () => selectKeyByIndex(keySelect.selectedIndex - 1));
    keyUp?.addEventListener('click', () => selectKeyByIndex(keySelect.selectedIndex + 1));

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
            return otf.tracks
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
    if (inlineExpanded && activePart?.partId) {
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
    buildPartsFromIndex
};
