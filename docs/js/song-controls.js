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
    fontSizeLevel, setFontSizeLevel,
    currentDetectedKey, setCurrentDetectedKey,
    originalDetectedKey, originalDetectedMode,
    subscribe
} from './state.js';
import { CHROMATIC_MAJOR_KEYS, CHROMATIC_MINOR_KEYS } from './chords.js';
import { escapeHtml, downloadFile } from './utils.js';
import { pill } from './shell.js';
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

/** Label for the Key pill button. */
export function keyPillLabel(key) {
    return key ? `Key of ${key}` : 'Key';
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
// KEY PILL
// ============================================

/**
 * Key pill: chromatic transpose, key list, Nashville toggle, Strum Machine.
 * Label live-updates ("Key of G").
 */
export function buildKeyPill(song) {
    const root = pill(keyPillLabel(currentDetectedKey), (container) => {
        const keys = originalDetectedMode === 'minor' ? CHROMATIC_MINOR_KEYS : CHROMATIC_MAJOR_KEYS;
        const hasStrum = !!song?.strum_machine_url;
        container.innerHTML = `
            <div class="pill-section pill-transpose-row">
                <button class="qc-btn" data-transpose="-1" title="Transpose down">−</button>
                <span class="pill-current-key">${escapeHtml(currentDetectedKey || '—')}</span>
                <button class="qc-btn" data-transpose="1" title="Transpose up">+</button>
            </div>
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
                <button class="qc-toggle-btn pill-nashville-btn ${nashvilleMode ? 'active' : ''}" title="Nashville numbers">Nashville</button>
                ${hasStrum ? `<button class="qc-toggle-btn pill-strum-btn" title="Practice on Strum Machine"><img src="images/strum_machine.png" alt="" class="qc-strum-icon"> Strum Machine</button>` : ''}
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
        });

        container.querySelector('.pill-strum-btn')?.addEventListener('click', () => {
            const url = currentDetectedKey
                ? `${song.strum_machine_url}?key=${encodeURIComponent(currentDetectedKey)}`
                : song.strum_machine_url;
            window.open(url, '_blank');
        });
    }, { id: 'key-pill', title: 'Key & transposition' });

    // Label follows the current key even when transposed elsewhere
    autoSub('currentDetectedKey', root, (key) => root.pillApi.setLabel(keyPillLabel(key)));
    return root;
}

// ============================================
// DISPLAY PILL
// ============================================

/**
 * Display pill: font size, layout toggles, chord display mode.
 * Same behavior the quick-controls bar had; re-render happens reactively.
 */
export function buildDisplayPill() {
    return pill('Display', (container) => {
        container.innerHTML = `
            <div class="pill-section pill-transpose-row">
                <button class="qc-btn" data-size="-1" title="Decrease font size">−</button>
                <span class="qc-label">Aa</span>
                <button class="qc-btn" data-size="1" title="Increase font size">+</button>
            </div>
            <div class="pill-section pill-checks">
                <label class="qc-checkbox"><input type="checkbox" id="pill-twocol" ${twoColumnMode ? 'checked' : ''}> Two columns</label>
                <label class="qc-checkbox"><input type="checkbox" id="pill-sections" ${showSectionLabels ? 'checked' : ''}> Section labels</label>
                <label class="qc-checkbox"><input type="checkbox" id="pill-compact" ${compactMode ? 'checked' : ''}> Compact</label>
            </div>
            <div class="pill-section qc-dropdown-row">
                <label>Chords</label>
                <select id="pill-chord-mode" class="qc-select">
                    <option value="all" ${chordDisplayMode === 'all' ? 'selected' : ''}>All</option>
                    <option value="first" ${chordDisplayMode === 'first' ? 'selected' : ''}>First Only</option>
                    <option value="none" ${chordDisplayMode === 'none' ? 'selected' : ''}>None</option>
                </select>
            </div>
        `;

        container.querySelectorAll('[data-size]').forEach(btn => {
            btn.addEventListener('click', () => {
                const delta = parseInt(btn.dataset.size, 10);
                const next = fontSizeLevel + delta;
                if (next >= -5 && next <= 6) setFontSizeLevel(next);
            });
        });
        container.querySelector('#pill-twocol').addEventListener('change', (e) => setTwoColumnMode(e.target.checked));
        container.querySelector('#pill-sections').addEventListener('change', (e) => setShowSectionLabels(e.target.checked));
        container.querySelector('#pill-compact').addEventListener('change', (e) => setCompactMode(e.target.checked));
        container.querySelector('#pill-chord-mode').addEventListener('change', (e) => setChordDisplayMode(e.target.value));
    }, { id: 'display-pill', title: 'Display options' });
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
 * Info pill: artists, composers, tags (+ suggest form), covering artists —
 * the content the old collapsible Info bar showed.
 */
export function buildInfoPill(song, versions = []) {
    return pill('Info', (container) => {
        const artist = song?.artist || '';
        const composer = song?.composer || '';

        // Build artists list: primary + covering artists + other version artists
        const allArtists = new Set();
        if (artist) allArtists.add(artist);
        (song?.covering_artists || []).forEach(a => allArtists.add(a));
        versions.forEach(v => { if (v.artist) allArtists.add(v.artist); });
        const artistsList = Array.from(allArtists);

        const infoItems = [];
        if (composer) {
            infoItems.push(`<div class="info-item"><span class="info-label">Written by:</span> ${escapeHtml(composer)}</div>`);
        }
        if (artistsList.length > 0) {
            const maxVisible = 3;
            const hasMore = artistsList.length > maxVisible;
            const visibleArtists = hasMore ? artistsList.slice(0, maxVisible) : artistsList;
            const hiddenArtists = hasMore ? artistsList.slice(maxVisible) : [];
            const artistsHtml = hasMore
                ? `<span class="artists-visible">${visibleArtists.map(a => escapeHtml(a)).join(', ')}</span><button class="artists-toggle" data-artists="expand" type="button">… <span class="artists-more">(+${hiddenArtists.length})</span></button><span class="artists-hidden hidden" data-artists="full">, ${hiddenArtists.map(a => escapeHtml(a)).join(', ')}</span><button class="artists-toggle hidden" data-artists="collapse" type="button">(collapse)</button>`
                : visibleArtists.map(a => escapeHtml(a)).join(', ');
            infoItems.push(`<div class="info-item"><span class="info-label">Artists:</span> <span class="artists-list">${artistsHtml}</span></div>`);
        }
        const bookDisplay = song?.book || null;
        const bookUrl = song?.book_url || null;
        if (bookDisplay) {
            const bookHtml = bookUrl
                ? `<a href="${bookUrl}" target="_blank" rel="noopener">${escapeHtml(bookDisplay)}</a>`
                : escapeHtml(bookDisplay);
            infoItems.push(`<div class="info-item"><span class="info-label">From:</span> ${bookHtml}</div>`);
        }
        if (song?.source && SOURCE_DISPLAY_NAMES[song.source]) {
            infoItems.push(`<div class="info-item"><span class="info-label">Source:</span> ${SOURCE_DISPLAY_NAMES[song.source]}</div>`);
        }
        if (song?.notes) {
            infoItems.push(`<div class="info-item"><span class="info-label">Notes:</span> ${escapeHtml(song.notes)}</div>`);
        }

        // Tags with voting controls
        const songTags = song?.tags || {};
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

        container.innerHTML = `
            <div class="info-content pill-info-content">
                <div class="info-details">${infoItems.join('') || '<em class="no-tags">No details</em>'}</div>
                <div class="info-tags">
                    <div class="info-tags-label">Tags:</div>
                    <div class="song-tags-row">
                        <span id="song-tags-container" class="song-tags" data-song-id="${song?.id || ''}">${tagsHtml}</span>
                        ${isLoggedIn ? `<button class="add-tags-btn" data-song-id="${song?.id || ''}">+ Add your own</button>` : ''}
                    </div>
                </div>
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
    }, { id: 'info-pill', title: 'Song info & tags', className: 'pill-wide' });
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

/** Load and display tag vote counts (scoped to the info pill's container). */
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
// EXPORT PILL
// ============================================

/**
 * Export a song: same actions the old export dropdown had.
 * Exported for the mobile bottom sheet, which reuses these actions.
 */
export function handleExport(action) {
    const song = currentSong;
    const chordpro = currentChordpro;
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

const EXPORT_ACTIONS = [
    { action: 'print', label: '🖨️ Print' },
    { action: 'copy-chordpro', label: '📋 Copy ChordPro' },
    { action: 'copy-text', label: '📄 Copy Plain Text' },
    { action: 'download-chordpro', label: '⬇️ Download .pro' },
    { action: 'download-text', label: '⬇️ Download .txt' },
];

/** Export pill for the top band (replaces the #export-dropdown markup). */
export function buildExportPill() {
    return pill('Export', (container, api) => {
        container.innerHTML = EXPORT_ACTIONS.map(a =>
            `<button class="pill-popover-item" data-action="${a.action}">${a.label}</button>`
        ).join('');
        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                api.close();
                handleExport(btn.dataset.action);
            });
        });
    }, { id: 'export-pill', title: 'Print / copy / download' });
}
