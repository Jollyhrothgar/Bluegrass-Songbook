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
    showVersionPicker, openSong,
    toggleFullscreen, exitFullscreen,
    navigatePrev, navigateNext,
    updateFocusHeader, updateNavBar
} from './song-view.js';
import { CHROMATIC_MAJOR_KEYS } from './chords.js';
import { escapeHtml, isPlaceholder, requireLogin, slugify, parseItemRef } from './utils.js';
import { openAddSongPicker } from './add-song-picker.js';
import { TabRenderer, TabPlayer, INSTRUMENT_ICONS } from './renderers/index.js';
import { clearListView } from './lists.js';
import { getTagCategory, formatTagName } from './tags.js';

// ============================================
// WORK STATE
// ============================================

let currentWork = null;          // The full work object
let activePart = null;           // Currently displayed part { type, format, file, ... }
let availableParts = [];         // All parts for current work
let trackRenderers = {};         // Map of trackId -> TabRenderer instance
let showRepeatsCompact = false;  // true = show repeat signs, false = unroll repeats
let inlineExpanded = false;      // true = showing a part inline (tab/doc), false = showing dashboard

// Getter for checking if we're in work view
export function getCurrentWork() { return currentWork; }

// ============================================
// NOTATION HELPERS
// ============================================

/**
 * Analyze reading list to detect repeat structures
 */
function analyzeReadingList(readingList) {
    if (!readingList || readingList.length === 0) {
        return { repeatSections: [], endings: {}, repeatStartMarkers: new Set(), repeatEndMarkers: new Set() };
    }

    const repeatStartMarkers = new Set();
    const repeatEndMarkers = new Set();
    const endings = {};

    for (let i = 0; i < readingList.length - 1; i++) {
        const curr = readingList[i];
        const next = readingList[i + 1];

        const currStart = curr.from_measure;
        const currEnd = curr.to_measure;
        const nextStart = next.from_measure;
        const nextEnd = next.to_measure;

        if (nextStart > currStart && nextStart <= currEnd &&
            nextEnd < currEnd && nextEnd >= nextStart) {
            repeatStartMarkers.add(nextStart);
            repeatEndMarkers.add(nextEnd);
            for (let m = nextEnd + 1; m <= currEnd; m++) {
                endings[m] = 1;
            }
            const afterRepeat = readingList[i + 2];
            if (afterRepeat &&
                afterRepeat.from_measure === currEnd + 1 &&
                afterRepeat.to_measure === afterRepeat.from_measure) {
                endings[afterRepeat.from_measure] = 2;
            }
        }

        if (nextStart === currStart && nextEnd < currEnd) {
            repeatStartMarkers.add(currStart);
            repeatEndMarkers.add(nextEnd);
            for (let m = nextEnd + 1; m <= currEnd; m++) {
                endings[m] = 1;
            }
            const afterRepeat = readingList[i + 2];
            if (afterRepeat &&
                afterRepeat.from_measure === currEnd + 1 &&
                afterRepeat.to_measure === afterRepeat.from_measure) {
                endings[afterRepeat.from_measure] = 2;
            }
        }

        if (nextStart === currStart && nextEnd > currEnd) {
            repeatStartMarkers.add(currStart);
            repeatEndMarkers.add(currEnd);
        }
    }

    return { repeatStartMarkers, repeatEndMarkers, endings };
}

/**
 * Build a tick mapping for compact mode visualization
 */
function buildTickMapping(readingList, ticksPerMeasure) {
    if (!readingList || readingList.length === 0) {
        return (tick) => tick;
    }

    const measureMapping = [];
    let expandedMeasure = 1;

    for (const range of readingList) {
        for (let m = range.from_measure; m <= range.to_measure; m++) {
            measureMapping.push({ expanded: expandedMeasure, original: m });
            expandedMeasure++;
        }
    }

    return (playbackTick) => {
        const expandedMeasureNum = Math.floor(playbackTick / ticksPerMeasure) + 1;
        const tickInMeasure = playbackTick % ticksPerMeasure;
        const mapping = measureMapping.find(m => m.expanded === expandedMeasureNum);
        if (!mapping) return playbackTick;
        return (mapping.original - 1) * ticksPerMeasure + tickInMeasure;
    };
}

/**
 * Expand notation according to reading list (repeat structure)
 */
function expandNotationWithReadingList(notation, readingList) {
    if (!readingList || readingList.length === 0) {
        return notation;
    }

    const measureMap = {};
    for (const entry of notation) {
        measureMap[entry.measure] = entry;
    }

    const expanded = [];
    let newMeasureNum = 1;

    for (const range of readingList) {
        for (let m = range.from_measure; m <= range.to_measure; m++) {
            const original = measureMap[m];
            if (original) {
                expanded.push({
                    ...original,
                    measure: newMeasureNum,
                    originalMeasure: m
                });
                newMeasureNum++;
            }
        }
    }

    return expanded;
}

/**
 * Prepare compact notation with repeat markers
 */
function prepareCompactNotation(notation, readingList) {
    if (!readingList || readingList.length === 0) {
        return notation;
    }

    const analysis = analyzeReadingList(readingList);

    return notation.map(measure => {
        const m = measure.measure;
        const enhanced = { ...measure };
        if (analysis.repeatStartMarkers.has(m)) enhanced.repeatStart = true;
        if (analysis.repeatEndMarkers.has(m)) enhanced.repeatEnd = true;
        if (analysis.endings[m]) enhanced.ending = analysis.endings[m];
        return enhanced;
    });
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

    const { fromList = false } = options;

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

    setLoadedTablature(null);
    if (tablaturePlayer) {
        tablaturePlayer.stop();
        setTablaturePlayer(null);
    }

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
        // Dashboard mode: show part cards
        const cards = renderPartCards();
        if (cards) {
            content.appendChild(cards);
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

    // Check for multiple versions
    const groupId = currentWork?.group_id;
    const versions = groupId ? (songGroups[groupId] || []) : [];
    const otherVersionCount = versions.length - 1;
    const versionHtml = otherVersionCount > 0
        ? `<button class="see-versions-btn" data-group-id="${groupId}">See ${otherVersionCount} other version${otherVersionCount > 1 ? 's' : ''}</button>`
        : '';

    // Build artists list
    const allArtists = new Set();
    if (artist) allArtists.add(artist);
    const coveringArtists = currentWork?.covering_artists || [];
    coveringArtists.forEach(a => allArtists.add(a));
    versions.forEach(v => { if (v.artist) allArtists.add(v.artist); });
    const artistsList = Array.from(allArtists);

    // Build info items
    let infoItems = [];
    if (composer) {
        infoItems.push(`<div class="info-item"><span class="info-label">Written by:</span> ${escapeHtml(composer)}</div>`);
    }

    const source = currentWork.source;
    const sourceDisplayNames = {
        'classic-country': 'Classic Country Song Lyrics',
        'golden-standard': 'Golden Standards Collection',
        'tunearch': 'TuneArch.org',
        'manual': 'Community Contribution',
        'trusted-user': 'Community Contribution',
        'pending': 'Community Contribution',
        'banjo-hangout': 'Banjo Hangout',
        'ultimate-guitar': 'Community Contribution',
        'bluegrass-lyrics': 'BluegrassLyrics.com'
    };
    if (source && sourceDisplayNames[source]) {
        infoItems.push(`<div class="info-item"><span class="info-label">Source:</span> ${sourceDisplayNames[source]}</div>`);
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
                    <button id="add-to-list-btn" class="add-to-list-btn" title="Add to list">+ Lists</button>
                    ${inlineExpanded ? '<button id="focus-btn" class="focus-btn" title="Focus mode (F)">&#x26F6; Focus</button>' : ''}
                    ${inlineExpanded && activePart?.type === 'tablature' ? '<button id="work-controls-toggle" class="focus-btn" title="Toggle controls">&#x2699;&#xFE0F; Controls</button>' : ''}
                </div>
            </div>
            ${headerControlsHtml}
        </div>
        ${infoContentHtml}
    `;

    // Wire up version button
    const versionBtn = header.querySelector('.see-versions-btn');
    if (versionBtn) {
        versionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showVersionPicker(versionBtn.dataset.groupId);
        });
    }

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
    backBtn.textContent = '\u2190 Back to overview';
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

    // Controls container (tab controls go here, hidden by default — toggled via Controls button)
    const controlsArea = document.createElement('div');
    controlsArea.className = 'work-inline-controls hidden';
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
        let otf = loadedTablature;
        if (!otf || otf._partFile !== part.file) {
            const response = await fetch(part.file);
            if (!response.ok) throw new Error(`Failed to load ${part.file}`);
            otf = await response.json();
            otf._partFile = part.file;
            setLoadedTablature(otf);
        }

        container.innerHTML = '';
        trackRenderers = {};

        // Inject controls into the inline controls area
        const controls = createTablatureControls(otf, part);
        const controlsContent = document.getElementById('work-controls-content');
        if (controlsContent) {
            controlsContent.innerHTML = '';
            controlsContent.appendChild(controls);
        } else {
            container.appendChild(controls);
        }

        const allTracksContainer = document.createElement('div');
        allTracksContainer.className = 'tablature-all-tracks';
        container.appendChild(allTracksContainer);

        const timeSignature = otf.metadata?.time_signature || '4/4';
        const ticksPerBeat = otf.timing?.ticks_per_beat || 480;

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
            } else {
                notation = expandNotationWithReadingList(notation, otf.reading_list);
            }
            const icon = INSTRUMENT_ICONS[track.instrument] ||
                        (track.id.includes('banjo') ? '🪕' :
                         track.id.includes('mandolin') ? '🎸' :
                         track.id.includes('guitar') ? '🎸' :
                         track.id.includes('fiddle') ? '🎻' : '🎵');

            const trackSection = document.createElement('div');
            trackSection.className = `tablature-track-section${isLead ? '' : ' backup-track'}`;
            trackSection.dataset.trackId = track.id;
            trackSection.style.display = isLead ? 'block' : 'none';

            // TabRenderer renders its own instrument/tuning header (track-info),
            // so we skip adding a separate track header here to avoid duplication.

            const tabContainer = document.createElement('div');
            tabContainer.className = 'tablature-container';
            trackSection.appendChild(tabContainer);

            allTracksContainer.appendChild(trackSection);

            const renderer = new TabRenderer(tabContainer);
            renderer.render(track, notation, ticksPerBeat, timeSignature);
            trackRenderers[track.id] = renderer;
        }

        // Wire up track visibility toggles
        const trackCheckboxes = controls.querySelectorAll('.track-checkbox');
        trackCheckboxes.forEach(checkbox => {
            const trackId = checkbox.dataset.trackId;
            const trackSection = allTracksContainer.querySelector(`[data-track-id="${trackId}"]`);
            if (trackSection) {
                checkbox.checked = trackSection.style.display !== 'none';
            }

            checkbox.addEventListener('change', () => {
                const section = allTracksContainer.querySelector(`[data-track-id="${trackId}"]`);
                if (section) {
                    section.style.display = checkbox.checked ? 'block' : 'none';
                }
            });
        });

        // Wire up repeat toggle
        const repeatCheckbox = controls.querySelector('.tab-repeat-checkbox');
        const repeatLabel = controls.querySelector('.tab-repeat-label');
        if (repeatCheckbox) {
            repeatCheckbox.addEventListener('change', () => {
                showRepeatsCompact = repeatCheckbox.checked;
                if (repeatLabel) {
                    repeatLabel.textContent = showRepeatsCompact ? 'Repeats' : 'Unrolled';
                }
                renderTablaturePart(part, container);
            });
        }

        const leadRenderer = trackRenderers[leadTrackId] || Object.values(trackRenderers)[0];
        setupTablaturePlayer(otf, controls, leadRenderer);

        // Attribution for Banjo Hangout tabs
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
        container.innerHTML = `<div class="error">Failed to load tablature: ${e.message}</div>`;
    }
}

/**
 * Create tablature controls
 */
function createTablatureControls(otf, part) {
    const defaultTempo = otf.metadata?.tempo || 100;
    const originalKey = currentWork.key || 'G';

    const filteredTracks = otf.tracks.filter(track => {
        const isMandolin = track.instrument?.includes('mandolin') || track.id?.includes('mandolin');
        const isLead = track.role === 'lead' || track.instrument?.includes('banjo') ||
                       (part.instrument && track.instrument?.includes(part.instrument));
        return !isMandolin || isLead;
    });

    const trackMixerHtml = filteredTracks.length > 1 ? `
        <div class="tab-track-mixer">
            <span class="mixer-label">Tracks:</span>
            ${filteredTracks.map(track => {
                const icon = track.instrument?.includes('banjo') ? '🪕' :
                            track.instrument?.includes('guitar') ? '🎸' :
                            track.instrument?.includes('mandolin') ? '🎸' :
                            track.instrument?.includes('bass') ? '🎸' :
                            track.instrument?.includes('fiddle') ? '🎻' : '🎵';
                const isLead = track.role === 'lead' || track.instrument?.includes('banjo');
                return `<label class="track-toggle" title="${track.id}">
                    <input type="checkbox" class="track-checkbox" data-track-id="${track.id}" ${isLead ? 'checked' : ''}>
                    <span class="track-icon">${icon}</span>
                    <span class="track-name">${track.id}</span>
                </label>`;
            }).join('')}
        </div>
    ` : '';

    const hasReadingList = otf.reading_list && otf.reading_list.length > 0;
    const repeatToggleHtml = hasReadingList ? `
        <label class="tab-repeat-toggle" title="Toggle repeat notation style">
            <input type="checkbox" class="tab-repeat-checkbox" ${showRepeatsCompact ? 'checked' : ''}>
            <span class="tab-repeat-label">${showRepeatsCompact ? 'Repeats' : 'Unrolled'}</span>
        </label>
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
        <label class="tab-metronome-toggle">
            <input type="checkbox" class="tab-metronome-checkbox">
            <span class="tab-metronome-icon">🥁</span>
        </label>
        ${repeatToggleHtml}
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

    const timeSignature = otf.metadata?.time_signature || '4/4';
    const ticksPerBeat = otf.timing?.ticks_per_beat || 480;
    const beatsPerMeasure = parseInt(timeSignature.split('/')[0], 10) || 4;
    const ticksPerMeasure = ticksPerBeat * beatsPerMeasure;
    const tickMapper = showRepeatsCompact
        ? buildTickMapping(otf.reading_list, ticksPerMeasure)
        : (tick) => tick;

    player.onTick = (absTick) => renderer.updateBeatCursor(tickMapper(absTick));
    player.onNoteStart = (absTick) => renderer.highlightNote(tickMapper(absTick));
    player.onNoteEnd = (absTick) => renderer.clearNoteHighlight(tickMapper(absTick));

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

    const updateTempoButtons = () => {
        tempoDown.disabled = currentTempo <= 40;
        tempoUp.disabled = currentTempo >= 280;
    };

    const setTempo = (val) => {
        currentTempo = Math.max(40, Math.min(280, val));
        tempoDisplay.textContent = currentTempo;
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

    player.onPositionUpdate = (elapsed, total) => {
        const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
        posEl.textContent = `${fmt(elapsed)} / ${fmt(total)}`;
    };

    player.onPlaybackEnd = () => {
        playBtn.textContent = '▶ Play';
        playBtn.classList.remove('playing');
        stopBtn.disabled = true;
        posEl.textContent = '';
        renderer.resetPlaybackVisualization();
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

    playBtn.addEventListener('click', async () => {
        if (player.isPlaying) {
            player.stop();
            playBtn.textContent = '▶ Play';
            playBtn.classList.remove('playing');
            stopBtn.disabled = true;
            renderer.resetPlaybackVisualization();
        } else {
            playBtn.textContent = '⏸ Pause';
            playBtn.classList.add('playing');
            stopBtn.disabled = false;
            const trackIds = getEnabledTrackIds();
            await player.play(otf, { tempo: currentTempo, transpose: currentCapo, trackIds });
        }
    });

    stopBtn.addEventListener('click', () => {
        player.stop();
        playBtn.textContent = '▶ Play';
        playBtn.classList.remove('playing');
        stopBtn.disabled = true;
        posEl.textContent = '';
        renderer.resetPlaybackVisualization();
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
