// Pill builders + handlers for the unified song page (work-view.js).
// This module owns the transpose/display/info/export controls that used to
// live in the quick-controls bar, the Info bar, and the export dropdown.
// State lives in state.js (same pref keys as before), so preferences keep
// persisting via loadViewPrefs/saveViewPrefs.

import {
    currentSong, currentChordpro,
    compactMode, setCompactMode,
    nashvilleMode, setNashvilleMode,
    twoColumnMode, setTwoColumnMode,
    chordDisplayMode, setChordDisplayMode,
    showSectionLabels, setShowSectionLabels,
    chartCells, setChartCells, chartBars, setChartBars, chartOrder, setChartOrder,
    autoHideControls, setAutoHideControls,
    currentDetectedKey, setCurrentDetectedKey,
    originalDetectedKey, originalDetectedMode,
    subscribe
} from './state.js';
import { CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS } from './chords.js';
import { escapeHtml, escapeAttr, safeUrl, downloadFile, songWriter, recordedBy, recorderLabel, recordingSearchUrl } from './utils.js';
import { getSongContent } from './song-content.js';
import { openSheet } from './shell.js';
import { dockButton } from './song-dock.js';
import { trackTranspose, trackExport } from './analytics.js';
import { getTagCategory, formatTagName } from './tags.js';

// Map enharmonic key names to their chromatic array equivalents
const ENHARMONIC_TO_CHROMATIC = {
    // Major keys - map flats to sharps where chromatic array uses sharps
    'Db': 'C#', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb',
    // Minor keys - map alternatives to chromatic array spellings
    'A#m': 'Bbm', 'D#m': 'Ebm', 'G#m': 'G#m' // G#m is in the array
};

function normalizeKeyForChromatic(key) {
    return ENHARMONIC_TO_CHROMATIC[key] || key;
}

/**
 * Chromatic half-step transpose. Pure state change — re-rendering happens
 * via the currentDetectedKey subscription in work-view.js.
 * Returns the new key (or null if transposition wasn't possible).
 */
export function transposeBySemitone(direction) {
    if (!currentDetectedKey || !originalDetectedKey) return null;
    const keys = originalDetectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;
    const normalizedKey = normalizeKeyForChromatic(currentDetectedKey);
    const currentIndex = keys.indexOf(normalizedKey);
    if (currentIndex === -1) return null;
    const newIndex = (currentIndex + direction + keys.length) % keys.length;
    const newKey = keys[newIndex];
    if (currentSong) trackTranspose(currentSong.id, currentDetectedKey, newKey);
    setCurrentDetectedKey(newKey);
    return newKey;
}

/**
 * Subscribe to a state key for the lifetime of a DOM element: the callback
 * self-unsubscribes once the element leaves the document (pills are rebuilt
 * on every page open, so listeners must not accumulate).
 */
function autoSub(stateKey, rootEl, fn) {
    const unsub = subscribe(stateKey, (value) => {
        if (!document.contains(rootEl)) { unsub(); return; }
        fn(value);
    });
}

// ============================================
// PRACTICE LINKS (under the title; see work-view.js)
// ============================================

/**
 * Outbound practice links for a song: Strum Machine (when matched, carrying
 * the current key) and a YouTube search by title.
 */
export function practiceLinks(song, key) {
    const links = [];
    if (song?.strum_machine_url) {
        links.push({
            id: 'strum',
            label: 'Strum Machine',
            href: key
                ? `${song.strum_machine_url}?key=${encodeURIComponent(key)}`
                : song.strum_machine_url,
        });
    }
    const title = (song?.title || '').trim();
    if (title) {
        links.push({
            id: 'youtube',
            label: 'YouTube',
            href: 'https://www.youtube.com/results?search_query=' +
                encodeURIComponent(title + ' bluegrass'),
        });
    }
    return links;
}

// ============================================
// KEY (the dock's Key button and its sheet)
// ============================================

/** "Key: A" for the dock's Key button. */
export function keyButtonLabel(key) {
    return key ? `Key: ${key}` : 'Key';
}

/**
 * The Key sheet's content: chromatic transpose, the key list, Nashville.
 * Same content the Key pill had; only where it opens has changed.
 */
export function renderKeyContent(container, song) {
    const keys = originalDetectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;
    container.innerHTML = `
        <div class="pill-section pill-transpose-row">
            <button class="qc-btn" data-transpose="-1" title="Transpose down">−</button>
            <span class="pill-current-key">${escapeHtml(currentDetectedKey || '—')}</span>
            <button class="qc-btn" data-transpose="1" title="Transpose up">+</button>
        </div>
        ${originalDetectedKey ? `<div class="pill-original-key">original key: ${escapeHtml(originalDetectedKey)}</div>` : ''}
        <div class="pill-section pill-key-grid">
            ${keys.map(k => {
                const cls = [
                    k === currentDetectedKey ? 'active' : '',
                    k === originalDetectedKey ? 'original' : ''
                ].filter(Boolean).join(' ');
                return `<button class="pill-key-btn ${cls}" data-key="${k}" title="${k === originalDetectedKey ? `${k} (detected)` : k}">${k}</button>`;
            }).join('')}
        </div>
        <div class="pill-section">
            <button class="qc-toggle-btn pill-nashville-btn ${nashvilleMode ? 'active' : ''}" aria-pressed="${nashvilleMode}" title="Nashville numbers">Nashville numbers</button>
            <span class="pill-hint">1 4 5 instead of A D E</span>
        </div>
    `;

    const refreshKeyMarkers = () => {
        container.querySelector('.pill-current-key').textContent = currentDetectedKey || '—';
        container.querySelectorAll('.pill-key-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.key === currentDetectedKey);
        });
    };

    container.querySelectorAll('[data-transpose]').forEach(btn => {
        btn.addEventListener('click', () => {
            transposeBySemitone(parseInt(btn.dataset.transpose, 10));
            refreshKeyMarkers();
        });
    });

    container.querySelectorAll('.pill-key-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            if (song && currentDetectedKey !== key) {
                trackTranspose(song.id, currentDetectedKey, key);
            }
            setCurrentDetectedKey(key);
            refreshKeyMarkers();
        });
    });

    const nashBtn = container.querySelector('.pill-nashville-btn');
    nashBtn?.addEventListener('click', () => {
        setNashvilleMode(!nashvilleMode);
        nashBtn.classList.toggle('active', nashvilleMode);
        nashBtn.setAttribute('aria-pressed', String(nashvilleMode));
    });
}

/**
 * The dock's Key button ("Key: A"). It opens the Key sheet; the label follows
 * the current key even when it is transposed elsewhere.
 */
export function buildKeyButton(song) {
    const btn = dockButton({ id: 'dock-key-btn', label: keyButtonLabel(currentDetectedKey), title: 'Key & transposition' });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSheet({ id: 'dock-key-sheet', title: 'Key', opener: btn, build: (el) => renderKeyContent(el, song) });
    });
    autoSub('currentDetectedKey', btn, (key) => { btn.textContent = keyButtonLabel(key); });
    return btn;
}

// ============================================
// DISPLAY (the dock's Display button and its sheet)
// ============================================

const CHART_CELLS_CHOICES = [2, 4, 6, 8];

/** A labelled segmented group; `choices` is [[value, label]], `on` the current value. */
function segmentedRow(label, id, choices, on) {
    return `
        <div class="dock-opt-row">
            <span class="dock-opt-label">${label}</span>
            <div class="pill-mode-group" id="${id}" role="group" aria-label="${label}">
                ${choices.map(([v, l]) => `<button type="button" class="pill-mode-btn ${String(v) === String(on) ? 'active' : ''}" data-value="${v}">${l}</button>`).join('')}
            </div>
        </div>`;
}

/**
 * "Auto-hide controls", the Display sheet's last row on every page that has a
 * Display (the lyric sheet, the chart and, since G19c, a tab).
 */
export function autoHideRow() {
    const label = document.createElement('label');
    label.className = 'qc-checkbox';
    const hintText = () => `(${autoHideControls ? 'on' : 'off'}: docks ${autoHideControls ? 'hide' : 'stay'} while you scroll)`;
    label.innerHTML = `<input type="checkbox" id="pill-autohide" ${autoHideControls ? 'checked' : ''}> Auto-hide controls <span class="dock-opt-hint">${hintText()}</span>`;
    label.querySelector('input').addEventListener('change', (e) => {
        setAutoHideControls(e.target.checked);
        label.querySelector('.dock-opt-hint').textContent = hintText();
    });
    return label;
}

/**
 * The Display sheet's content: layout options, the chord mode, Auto-hide
 * controls, and (only for a song with a chart) the Chart group. Size is not
 * here: it is in the dock. `wide` says whether two columns can show.
 */
export function renderDisplayContent(container, { hasChart = false, wide = false } = {}) {
    container.innerHTML = `
        <div class="dock-group-label">Layout</div>
        <div class="pill-section pill-checks">
            <label class="qc-checkbox ${wide ? '' : 'is-off'}"><input type="checkbox" id="pill-twocol" ${twoColumnMode ? 'checked' : ''} ${wide ? '' : 'disabled'}> Two columns${wide ? '' : ' <span class="dock-opt-hint">(wide screens only)</span>'}</label>
            <label class="qc-checkbox"><input type="checkbox" id="pill-sections" ${showSectionLabels ? 'checked' : ''}> Section labels</label>
            <label class="qc-checkbox"><input type="checkbox" id="pill-compact" ${compactMode ? 'checked' : ''}> Compact</label>
            <span data-slot="autohide"></span>
        </div>
        <div class="dock-opt-row">
            <span class="dock-opt-label">Chords</span>
            <div class="pill-mode-group" id="pill-chord-mode" role="group" aria-label="Chord display">
                <button class="pill-mode-btn ${chordDisplayMode === 'all' ? 'active' : ''}" data-mode="all">All</button>
                <button class="pill-mode-btn ${chordDisplayMode === 'first' ? 'active' : ''}" data-mode="first">First only</button>
                <button class="pill-mode-btn ${chordDisplayMode === 'none' ? 'active' : ''}" data-mode="none">None</button>
            </div>
        </div>
        ${hasChart ? `
        <div class="dock-group-label dock-group-chart">Chart <span class="dock-opt-hint">shown because this song has one</span></div>
        ${segmentedRow('Cells per row', 'pill-chart-cells', CHART_CELLS_CHOICES.map(n => [n, n]), chartCells)}
        ${segmentedRow('Bars', 'pill-chart-bars', [[1, 'One cell'], [2, 'Two cells']], chartBars)}
        ${segmentedRow('Order', 'pill-chart-order', [['once', 'Each section once'], ['sung', 'As sung']], chartOrder)}
        ` : ''}
    `;

    container.querySelector('#pill-twocol').addEventListener('change', (e) => setTwoColumnMode(e.target.checked));
    container.querySelector('#pill-sections').addEventListener('change', (e) => setShowSectionLabels(e.target.checked));
    container.querySelector('#pill-compact').addEventListener('change', (e) => setCompactMode(e.target.checked));
    container.querySelector('[data-slot="autohide"]').replaceWith(autoHideRow());

    // A segmented group's buttons light one at a time and say what they chose
    const group = (selector, attr, onChoose) => {
        container.querySelectorAll(`${selector} .pill-mode-btn`).forEach(btn => {
            btn.addEventListener('click', () => {
                onChoose(btn.dataset[attr]);
                container.querySelectorAll(`${selector} .pill-mode-btn`).forEach(b => b.classList.toggle('active', b === btn));
            });
        });
    };
    // Segmented buttons instead of a native <select>: consistent styling
    // everywhere (mobile browsers render select menus at odd sizes)
    group('#pill-chord-mode', 'mode', setChordDisplayMode);
    group('#pill-chart-cells', 'value', (v) => setChartCells(Number(v)));
    group('#pill-chart-bars', 'value', (v) => setChartBars(Number(v)));
    group('#pill-chart-order', 'value', setChartOrder);
}

/** The dock's Display button. `options()` is read when it opens (the chart, the width). */
export function buildDisplayButton(options) {
    const btn = dockButton({ id: 'dock-display-btn', label: 'Display', title: 'Display options' });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSheet({ id: 'dock-display-sheet', title: 'Display', opener: btn,
            build: (el) => renderDisplayContent(el, options()) });
    });
    return btn;
}

// ============================================
// INFO PILL
// ============================================

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
 * The song's facts, for the Details sheet (work-view.js opens it from the
 * writer line): writer, recordings, book, key, tags with their votes and
 * "+ Add your own", source, notes. Since F9 this is the only place on the
 * song page that names performers: "Recorded by", the MusicBrainz-backed
 * covering artists with years. `artist` is whichever page a chart was scraped
 * from; it is never shown as such.
 */
export function renderDetails(container, song) {
    const writer = songWriter(song);

    // "Recorded by", first recording first: MusicBrainz-backed covering
    // artists (incl. a confirmed scraped artist). Never an unconfirmed
    // scraped `artist`, this song's or its versions' (F9).
    const artistsList = recordedBy(song);

    const row = (label, valueHtml, cls = '') =>
        `<div class="info-item ${cls}"><span class="info-label">${label}</span> <span class="info-value">${valueHtml}</span></div>`;

    const isLoggedIn = window.SupabaseAuth?.isLoggedIn?.() || false;
    const infoItems = [];
    if (writer) infoItems.push(row('Written by', escapeHtml(writer)));
    if (artistsList.length > 0) {
        // Each recorder links to a YouTube search for that recording
        // ("Song Title Bill Monroe 1947").
        const link = (r) => `<a class="recorded-by-link" href="${escapeAttr(recordingSearchUrl(song?.title || '', r))}" target="_blank" rel="noopener">${escapeHtml(recorderLabel(r))}</a>`;
        const maxVisible = 3;
        const hasMore = artistsList.length > maxVisible;
        const visibleArtists = hasMore ? artistsList.slice(0, maxVisible) : artistsList;
        const hiddenArtists = hasMore ? artistsList.slice(maxVisible) : [];
        const artistsHtml = hasMore
            ? `<span class="artists-visible">${visibleArtists.map(link).join(', ')}</span><button class="artists-toggle" data-artists="expand" type="button">… <span class="artists-more">(+${hiddenArtists.length})</span></button><span class="artists-hidden hidden" data-artists="full">, ${hiddenArtists.map(link).join(', ')}</span> <button class="artists-toggle hidden" data-artists="collapse" type="button">(collapse)</button>`
            : visibleArtists.map(link).join(', ');
        infoItems.push(row('Recorded by', `<span class="artists-list">${artistsHtml}</span>`));
    }
    const bookDisplay = song?.book || null;
    const bookUrl = song?.book_url || null;
    if (bookDisplay) {
        // book_url rides in on the work/index row, so it is submitter
        // data: scheme-check it, and show plain text when it isn't a
        // real link (escaping alone would not stop `javascript:`).
        const bookHref = safeUrl(bookUrl);
        infoItems.push(row('From', bookHref
            ? `<a href="${bookHref}" target="_blank" rel="noopener">${escapeHtml(bookDisplay)}</a>`
            : escapeHtml(bookDisplay)));
    }
    const key = originalDetectedKey || song?.key;
    if (key) infoItems.push(row('Key', escapeHtml(key), 'info-key'));

    // Tags with voting controls
    const songTags = song?.tags || {};
    const tagNames = Object.keys(songTags);
    const tagsHtml = tagNames.length > 0
        ? tagNames.map(tag => {
            const category = getTagCategory(tag);
            const displayName = formatTagName(tag);
            return `
                <span class="votable-tag tag-${category}" data-tag="${escapeAttr(tag)}">
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
    infoItems.push(`
        <div class="info-item info-tags">
            <span class="info-label info-tags-label">Tags</span>
            <div class="song-tags-row">
                <span id="song-tags-container" class="song-tags" data-song-id="${song?.id || ''}">${tagsHtml}</span>
                ${isLoggedIn ? `<button class="add-tags-btn" data-song-id="${song?.id || ''}">+ Add your own</button>` : ''}
            </div>
        </div>`);

    if (song?.source && SOURCE_DISPLAY_NAMES[song.source]) {
        infoItems.push(row('Source', SOURCE_DISPLAY_NAMES[song.source]));
    }
    if (song?.notes) infoItems.push(row('Notes', escapeHtml(song.notes)));

    container.innerHTML = `
        <div class="info-content details-content">
            <div class="info-details">${infoItems.join('')}</div>
            <div id="add-tags-form" class="add-tags-form hidden">
                <div class="add-tags-header">Add your own tags (comma-separated)</div>
                <div class="add-tags-input-row">
                    <input type="text" id="genre-suggestion-input"
                           placeholder="e.g., driving, lonesome, parking lot jam"
                           maxlength="200">
                    <button id="submit-tags-btn">Submit</button>
                </div>
                <div id="tag-preview" class="tag-preview hidden"></div>
                <div id="tag-error" class="tag-error hidden"></div>
                <div class="add-tags-note">
                    We're learning how bluegrass players describe their music.
                    Your suggestions help shape future categories.
                </div>
            </div>
        </div>
    `;

    wireArtistsToggle(container);
    wireTagControls(container, song);
}

function wireArtistsToggle(container) {
    const expand = container.querySelector('[data-artists="expand"]');
    const collapse = container.querySelector('[data-artists="collapse"]');
    const full = container.querySelector('[data-artists="full"]');
    expand?.addEventListener('click', () => {
        full?.classList.remove('hidden');
        collapse?.classList.remove('hidden');
        expand.classList.add('hidden');
    });
    collapse?.addEventListener('click', () => {
        full?.classList.add('hidden');
        collapse.classList.add('hidden');
        expand?.classList.remove('hidden');
    });
}

/** Parse and clean tag input - forgiving, shows what we understood. */
function parseTagInput(raw) {
    const parts = raw.split(/[,;]+|\s{2,}/)
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0);

    const cleanedTags = [];
    const warnings = [];

    for (const part of parts) {
        // Strip anything that's not letters, numbers, spaces, or hyphens
        let cleaned = part.replace(/[^a-z0-9\s\-]/g, '').trim();
        cleaned = cleaned.replace(/\s+/g, ' ');
        if (cleaned.length === 0) continue;
        if (cleaned.length > 30) cleaned = cleaned.slice(0, 30).trim();
        if (!cleanedTags.includes(cleaned)) cleanedTags.push(cleaned);
    }

    if (cleanedTags.length > 5) {
        warnings.push(`Showing first 5 of ${cleanedTags.length} tags`);
    }

    return { tags: cleanedTags.slice(0, 5), warnings };
}

/** Load and display tag vote counts (scoped to the Details sheet's container). */
async function loadTagVotes(container, songId) {
    const tagsContainer = container.querySelector('#song-tags-container');
    if (!tagsContainer || !window.SupabaseAuth) return;

    const [votesResult, userVotesResult] = await Promise.all([
        window.SupabaseAuth.fetchTagVotes(songId),
        window.SupabaseAuth.fetchUserTagVotes(songId)
    ]);

    const votes = votesResult.data || {};
    const userVotes = userVotesResult.data || {};

    tagsContainer.querySelectorAll('.votable-tag').forEach(tagEl => {
        const tagName = tagEl.dataset.tag?.toLowerCase();
        if (!tagName) return;

        const voteData = votes[tagName] || { net: 0, up: 0, down: 0 };
        const userVote = userVotes[tagName] || 0;

        const scoreEl = tagEl.querySelector('.vote-score');
        if (scoreEl) {
            const net = voteData.net || 0;
            scoreEl.textContent = net === 0 ? '·' : (net > 0 ? `+${net}` : String(net));
            scoreEl.title = `${voteData.up || 0} up, ${voteData.down || 0} down`;
        }

        tagEl.dataset.userVote = String(userVote);
        tagEl.querySelector('.vote-up')?.classList.toggle('voted', userVote === 1);
        tagEl.querySelector('.vote-down')?.classList.toggle('voted', userVote === -1);
    });
}

function wireTagControls(container, song) {
    const songId = song?.id;

    // Suggest-a-tag form
    const addTagsBtn = container.querySelector('.add-tags-btn');
    addTagsBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const form = container.querySelector('#add-tags-form');
        const input = container.querySelector('#genre-suggestion-input');
        if (form) {
            form.classList.remove('hidden');
            input?.focus();
        }
    });

    const suggestionInput = container.querySelector('#genre-suggestion-input');
    suggestionInput?.addEventListener('input', () => {
        const preview = container.querySelector('#tag-preview');
        const errorDiv = container.querySelector('#tag-error');
        const raw = suggestionInput.value.trim();

        if (!raw) {
            preview?.classList.add('hidden');
            errorDiv?.classList.add('hidden');
            return;
        }

        const { tags, warnings } = parseTagInput(raw);
        if (tags.length > 0 && preview) {
            preview.innerHTML = '<span class="preview-label">We\'ll add:</span> ' +
                tags.map(t => `<span class="tag-badge tag-other">${escapeHtml(t)}</span>`).join(' ');
            preview.classList.remove('hidden');
        } else {
            preview?.classList.add('hidden');
        }

        if (warnings.length > 0 && errorDiv) {
            errorDiv.textContent = warnings[0];
            errorDiv.classList.remove('hidden');
        } else {
            errorDiv?.classList.add('hidden');
        }
    });

    const submitTagsBtn = container.querySelector('#submit-tags-btn');
    submitTagsBtn?.addEventListener('click', async () => {
        const input = container.querySelector('#genre-suggestion-input');
        const errorDiv = container.querySelector('#tag-error');
        const raw = input?.value?.trim() || '';

        if (!raw) {
            if (errorDiv) {
                errorDiv.textContent = 'Type something first!';
                errorDiv.classList.remove('hidden');
            }
            return;
        }

        const { tags } = parseTagInput(raw);
        if (tags.length === 0) {
            if (errorDiv) {
                errorDiv.textContent = 'No valid tags found - try words like "driving" or "lonesome"';
                errorDiv.classList.remove('hidden');
            }
            return;
        }
        if (!songId) return;

        submitTagsBtn.disabled = true;
        submitTagsBtn.textContent = 'Sending...';

        const { error } = await window.SupabaseAuth.submitGenreSuggestions(songId, tags);

        submitTagsBtn.disabled = false;
        submitTagsBtn.textContent = 'Submit';

        if (error) {
            if (errorDiv) {
                errorDiv.textContent = 'Error: ' + error.message;
                errorDiv.classList.remove('hidden');
            }
            return;
        }

        input.value = '';
        container.querySelector('#add-tags-form')?.classList.add('hidden');
        container.querySelector('#tag-preview')?.classList.add('hidden');
        errorDiv?.classList.add('hidden');

        if (addTagsBtn) {
            const originalText = addTagsBtn.textContent;
            addTagsBtn.textContent = 'Thanks!';
            addTagsBtn.disabled = true;
            setTimeout(() => {
                addTagsBtn.textContent = originalText;
                addTagsBtn.disabled = false;
            }, 2000);
        }
    });

    // Tag voting
    const tagsContainer = container.querySelector('#song-tags-container');
    if (tagsContainer && window.SupabaseAuth?.isLoggedIn?.() && songId) {
        loadTagVotes(container, songId);

        tagsContainer.addEventListener('click', async (e) => {
            const voteBtn = e.target.closest('.vote-btn');
            if (!voteBtn) return;

            e.preventDefault();
            const tagEl = voteBtn.closest('.votable-tag');
            const tagName = tagEl?.dataset.tag;
            const voteValue = parseInt(voteBtn.dataset.vote, 10);
            if (!tagName) return;

            const currentVote = parseInt(tagEl.dataset.userVote || '0', 10);

            if (currentVote === voteValue) {
                const { error } = await window.SupabaseAuth.removeTagVote(songId, tagName);
                if (!error) {
                    tagEl.dataset.userVote = '0';
                    loadTagVotes(container, songId);
                }
            } else {
                const { error } = await window.SupabaseAuth.castTagVote(songId, tagName, voteValue);
                if (!error) {
                    tagEl.dataset.userVote = String(voteValue);
                    loadTagVotes(container, songId);
                }
            }
        });
    }
}

// ============================================
// EXPORT
// ============================================

/** Export a song: the actions listed in EXPORT_ACTIONS. */
export async function handleExport(action) {
    const song = currentSong;
    // Content is fetched per song page; an export fired before the .pro
    // landed (or from a surface that never rendered it) pulls it itself.
    let chordpro = currentChordpro;
    if (!chordpro && song) {
        chordpro = await getSongContent(song).catch(() => null);
    }
    if (!song || !chordpro) return;

    const title = song.title || 'song';
    trackExport(song.id, action);

    switch (action) {
        case 'print':
            window.print();
            break;
        case 'copy-chordpro':
            navigator.clipboard.writeText(chordpro);
            break;
        case 'copy-text':
            navigator.clipboard.writeText(chordpro.replace(/\[[^\]]+\]/g, '').replace(/\{[^}]+\}/g, ''));
            break;
        case 'download-chordpro':
            downloadFile(`${title}.pro`, chordpro, 'text/plain');
            break;
        case 'download-text':
            downloadFile(`${title}.txt`, chordpro.replace(/\[[^\]]+\]/g, '').replace(/\{[^}]+\}/g, ''), 'text/plain');
            break;
    }
}

/** The five export actions, in the order ⋯ ▸ Export / Print lists them. */
export const EXPORT_ACTIONS = [
    { action: 'print', label: '🖨️ Print' },
    { action: 'copy-chordpro', label: '📋 Copy ChordPro' },
    { action: 'copy-text', label: '📄 Copy Plain Text' },
    { action: 'download-chordpro', label: '⬇️ Download .pro' },
    { action: 'download-text', label: '⬇️ Download .txt' },
];
