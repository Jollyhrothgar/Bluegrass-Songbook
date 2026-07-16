// BountyView - Bounty page showing placeholder works + part-level bounties
// Two data sources: (1) placeholder works needing everything, (2) Supabase bounties on existing works

import { allSongs, bountyIndex, getBountyWorkCount } from './state.js';
import { isPlaceholder, escapeHtml, requireLogin } from './utils.js';
import { formatTagName } from './tags.js';
import { openAddSongPicker } from './add-song-picker.js';

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
    if (song.content) parts.push('Lyrics & chords');
    if (song.abc_content) parts.push('ABC notation');
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
 * Render the bounty view.
 */
export function renderBountyView(container) {
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

    container.innerHTML = `
        <div class="bounty-view">
            <div class="bounty-header">
                <h1 class="bounty-title">Bounty Board</h1>
                <p class="bounty-subtitle">Songs and parts the community is looking for. Know one? Help us out!</p>
                <p class="bounty-stats">${totalItems} bounties across ${filteredPlaceholders.length + getBountyWorkCount()} works</p>
            </div>

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
                    <h2 class="bounty-section-title">${currentFilter === 'all' ? 'Wanted Songs' : 'Wanted Songs'} <span class="bounty-group-count">(${filteredPlaceholders.length})</span></h2>
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
    container.querySelector('#bounty-request-song-btn')?.addEventListener('click', () => {
        if (!requireLogin('request songs')) return;
        openAddSongPicker({ mode: 'request' });
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
