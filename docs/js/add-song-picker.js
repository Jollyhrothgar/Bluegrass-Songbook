// Add Song Picker — type selection modal (Upload Image, Lyrics & Chords, Request a Song)
// Supports modes: 'default' (3 cards), 'request' (straight to form), 'contribute' (2 cards, pre-filled)

import { allSongs } from './state.js';
import { songHasContent, songHasAbc } from './song-content.js';
import { generateSlug, escapeHtml, isPlaceholder } from './utils.js';
import { track } from './analytics.js';
import { launchTabCreator } from './otf-editor/create-tab-entry.js';
import { tabEntryPlan, renderExistingTabsPanel } from './otf-editor/existing-tabs.js';

const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

let pickerModal = null;
let pickerCards = null;
let requestForm = null;
let tabTargetPanel = null;
let tabSearch = null;
let tabInstrument = null;
let tabResults = null;
let tabNewBtn = null;
let headerTitle = null;
let requestCard = null;
let onUpload = null;
let onChordPro = null;

// Form elements
let reqTitle = null;
let reqArtist = null;
let reqKey = null;
let reqNotes = null;
let reqSubmit = null;
let reqStatus = null;
let dedupWarning = null;

// Current context (set by openAddSongPicker)
let currentContext = {};

export function initAddSongPicker({ onUpload: uploadCb, onChordPro: chordProCb }) {
    pickerModal = document.getElementById('add-song-picker');
    if (!pickerModal) return;

    onUpload = uploadCb;
    onChordPro = chordProCb;

    pickerCards = pickerModal.querySelector('.picker-cards');
    requestForm = pickerModal.querySelector('.picker-request-form');
    headerTitle = document.getElementById('picker-header-title');
    requestCard = pickerModal.querySelector('.picker-card-request');

    // Tablature target step
    tabTargetPanel = pickerModal.querySelector('.picker-tab-target');
    tabSearch = document.getElementById('picker-tab-search');
    tabInstrument = document.getElementById('picker-tab-instrument');
    tabResults = document.getElementById('picker-tab-results');
    tabNewBtn = document.getElementById('picker-tab-new');

    // Form elements
    reqTitle = document.getElementById('picker-req-title');
    reqArtist = document.getElementById('picker-req-artist');
    reqKey = document.getElementById('picker-req-key');
    reqNotes = document.getElementById('picker-req-notes');
    reqSubmit = document.getElementById('picker-req-submit');
    reqStatus = document.getElementById('picker-req-status');
    dedupWarning = document.getElementById('picker-dedup-warning');

    // Close button
    document.getElementById('add-song-picker-close')?.addEventListener('click', closeAddSongPicker);

    // Backdrop click
    pickerModal.addEventListener('click', (e) => {
        if (e.target === pickerModal) closeAddSongPicker();
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !pickerModal.classList.contains('hidden')) closeAddSongPicker();
    });

    // Close on browser back/navigation
    window.addEventListener('popstate', closeAddSongPicker);
    window.addEventListener('hashchange', closeAddSongPicker);

    // Card clicks
    pickerModal.querySelectorAll('.picker-card').forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.type;
            if (type === 'request') {
                showRequestForm();
                return;
            }
            if (type === 'tablature') {
                startTabFlow();
                return;
            }
            closeAddSongPicker();
            const ctx = { ...currentContext };
            if (type === 'upload' && onUpload) onUpload(ctx);
            else if (type === 'chordpro' && onChordPro) onChordPro(ctx);
        });
    });

    // Back buttons (request form and tab-target step)
    pickerModal.querySelectorAll('.picker-back-btn').forEach(
        btn => btn.addEventListener('click', showCards));

    // Tab target: search existing works, or add the song as new via the tab
    tabSearch?.addEventListener('input', renderTabResults);
    tabResults?.addEventListener('click', (e) => {
        const row = e.target.closest('.picker-tab-result');
        if (!row) return;
        openTabCreator(row.dataset.workId, row.dataset.title);
    });
    tabNewBtn?.addEventListener('click', () => {
        // Belt-and-suspenders alongside renderTabResults hiding the button:
        // starting a tab with no target while the corpus never loaded is a
        // silent duplicate-minting window (triage, 2026-08-16), not an
        // informed "no, really, no song exists" choice.
        if (allSongs.length === 0) return;
        openTabCreator(null, tabSearch?.value?.trim() || '');
    });

    // Title input: enable submit + dedup check
    reqTitle?.addEventListener('input', updateRequestSubmitState);
    reqTitle?.addEventListener('blur', checkDedup);

    // Submit
    reqSubmit?.addEventListener('click', submitRequest);
}

function showCards() {
    hideExistingTabsStep();
    pickerCards?.classList.remove('hidden');
    requestForm?.classList.add('hidden');
    tabTargetPanel?.classList.add('hidden');
    headerTitle.textContent = currentContext.mode === 'contribute' ? 'Help Complete This Song' : 'Add a Song';
}

/**
 * Tablature card. A tab is always a tab OF something, so the flow needs a
 * work before the editor is any use: in 'contribute' mode we already know
 * it (the picker was opened from that work's page), otherwise ask.
 */
function startTabFlow() {
    if (currentContext.targetSlug) {
        openTabCreator(currentContext.targetSlug, currentContext.title || '',
            { fromSearch: false });
        return;
    }
    hideExistingTabsStep();
    pickerCards?.classList.add('hidden');
    requestForm?.classList.add('hidden');
    tabTargetPanel?.classList.remove('hidden');
    headerTitle.textContent = 'Tab a Song';
    if (tabSearch) {
        tabSearch.value = currentContext.title || '';
        tabSearch.focus();
    }
    renderTabResults();
}

/**
 * Existing works whose title looks like the query. Deliberately the same
 * normalize+similarity pair the request form's dedup check uses — one
 * notion of "same song" in this file, not two.
 */
export function searchWorksForTab(query, songs = allSongs, limit = 8) {
    const q = normalizeForMatch(query);
    if (!q) return [];
    const scored = [];
    for (const song of songs) {
        const title = normalizeForMatch(song.title);
        if (!title) continue;
        const score = title.startsWith(q) ? 1 + similarity(q, title) : similarity(q, title);
        if (title.includes(q) || score >= 0.7) scored.push({ song, score });
    }
    scored.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));
    return scored.slice(0, limit).map(s => s.song);
}

/**
 * Pure: what the tab-target search box should show for a given query,
 * match set, and whether the corpus loaded at all. Split out so the three
 * states — a match, a genuine no-match, and "the corpus never loaded" — are
 * each one unit-testable branch instead of buried in DOM-building code.
 *
 * A load failure must never read as a confident "No song by that name":
 * that message asserts the corpus was searched and came up empty, which is
 * false when allSongs never loaded (triage, 2026-08-16 — the Foggy
 * Mountain "no song by that name" bug had exactly this cause).
 */
export function tabResultsState(query, matches, corpusEmpty) {
    if (corpusEmpty) {
        return { kind: 'corpus-empty', message: "The songbook isn't loaded — can't search songs right now." };
    }
    if (matches.length) {
        return { kind: 'matches' };
    }
    if (query?.trim()) {
        return { kind: 'no-match', message: 'No song by that name — you can add it as a new song and tab it.' };
    }
    return { kind: 'empty-query' };
}

function renderTabResults() {
    if (!tabResults) return;
    const query = tabSearch?.value || '';
    const matches = searchWorksForTab(query);
    const state = tabResultsState(query, matches, allSongs.length === 0);

    // Offering the add-as-new-song button while the corpus is empty
    // presents an unknown state as an informed choice — it can silently
    // mint a duplicate work the moment the index actually loads.
    tabNewBtn?.classList.toggle('hidden', state.kind === 'corpus-empty');

    if (state.kind === 'corpus-empty') {
        tabResults.innerHTML = `<div class="picker-tab-empty picker-tab-error">${escapeHtml(state.message)}</div>`;
        return;
    }
    if (state.kind === 'no-match') {
        tabResults.innerHTML = `<div class="picker-tab-empty">${escapeHtml(state.message)}</div>`;
        return;
    }
    if (state.kind === 'empty-query') {
        tabResults.innerHTML = '';
        return;
    }
    tabResults.innerHTML = matches.map(song => `
        <button class="picker-tab-result" data-work-id="${escapeHtml(song.id)}"
                data-title="${escapeHtml(song.title || song.id)}">
            <span class="picker-tab-result-title">${escapeHtml(song.title || song.id)}</span>
            ${song.artist ? `<span class="picker-tab-result-artist">${escapeHtml(song.artist)}</span>` : ''}
        </button>
    `).join('');
}

/**
 * Hand off to the tab editor. Login is gated inside launchTabCreator.
 *
 * Except: if the chosen work ALREADY has tabs for the chosen instrument,
 * that gets said here — before the editor opens and before an hour of
 * arranging — as a choice, not a refusal (contract principle 4). The data
 * is already in hand (`tablature_parts` on the index row), so this costs
 * no fetch. `force` is the "add mine as another version" answer coming
 * back through the same door.
 */
function openTabCreator(workId, title, { force = false, fromSearch = true } = {}) {
    const instrument = tabInstrument?.value || currentContext.instrument || '';
    const song = workId ? allSongs.find(s => s.id === workId) : null;
    const plan = tabEntryPlan(song, instrument, { title });

    if (!force && plan.kind === 'existing') {
        showExistingTabsStep(plan, { fromSearch });
        return;
    }
    const launched = launchTabCreator({
        workId: workId || null, instrument, title,
        existingCount: plan.count,
    });
    if (launched) closeAddSongPicker();
}

/** The tab-target step's sub-panel showing what's already published. */
let existingTabsStep = null;

function hideExistingTabsStep() {
    existingTabsStep?.remove();
    existingTabsStep = null;
    tabTargetPanel?.querySelectorAll('.picker-tab-choose')
        .forEach(el => el.classList.remove('hidden'));
}

function showExistingTabsStep(plan, { fromSearch = true } = {}) {
    hideExistingTabsStep();
    if (!tabTargetPanel) return;

    pickerCards?.classList.add('hidden');
    requestForm?.classList.add('hidden');
    tabTargetPanel.classList.remove('hidden');

    // Park the search step rather than destroy it — Back must return to
    // the results the contributor just came from. (In contribute mode the
    // work was already known and no search happened, so Back goes home.)
    for (const el of tabTargetPanel.children) el.classList.add('picker-tab-choose');
    tabTargetPanel.querySelectorAll('.picker-tab-choose')
        .forEach(el => el.classList.add('hidden'));

    existingTabsStep = renderExistingTabsPanel(plan, {
        onAdd: () => openTabCreator(plan.workId, plan.title, { force: true }),
        onView: (tab) => openWorkPart(plan, tab, { edit: false }),
        onImprove: (tab) => openWorkPart(plan, tab, { edit: true }),
        onBack: fromSearch ? hideExistingTabsStep : showCards,
    });
    tabTargetPanel.appendChild(existingTabsStep);
    if (headerTitle) headerTitle.textContent = 'This song already has tabs';
}

/**
 * Leave the picker for the work page's tab part — to read it, or to edit
 * it (the existing tab-correction path: work-view mounts the OTF editor
 * over the rendered tab and submits a `tab-correction`).
 *
 * work-view imports this module, so the import is dynamic to keep the
 * cycle out of module-evaluation order; by the time anyone clicks, the
 * SPA has long since loaded it.
 */
async function openWorkPart(plan, tab, { edit }) {
    closeAddSongPicker();
    const view = await import('./work-view.js');
    if (edit) view.requestTabEdit(plan.workId, tab.file);
    view.openWork(plan.workId, { partId: plan.partId || undefined });
}

function showRequestForm() {
    pickerCards?.classList.add('hidden');
    tabTargetPanel?.classList.add('hidden');
    requestForm?.classList.remove('hidden');
    headerTitle.textContent = 'Request a Song';

    // Pre-fill from context if available
    if (currentContext.title && reqTitle) reqTitle.value = currentContext.title;
    if (currentContext.artist && reqArtist) reqArtist.value = currentContext.artist;
    if (currentContext.key && reqKey) reqKey.value = currentContext.key;

    reqTitle?.focus();
    updateRequestSubmitState();
}

function resetForm() {
    if (reqTitle) reqTitle.value = '';
    if (reqArtist) reqArtist.value = '';
    if (reqKey) reqKey.value = '';
    if (reqNotes) reqNotes.value = '';
    if (reqStatus) { reqStatus.textContent = ''; reqStatus.className = 'picker-req-status'; }
    if (dedupWarning) { dedupWarning.classList.add('hidden'); dedupWarning.innerHTML = ''; }
    if (reqSubmit) reqSubmit.disabled = true;
    currentContext = {};
}

function updateRequestSubmitState() {
    if (!reqSubmit) return;
    reqSubmit.disabled = !reqTitle?.value?.trim();
}

/**
 * Normalize a title for fuzzy comparison.
 * Strips articles, punctuation, normalizes whitespace, common abbreviations.
 */
function normalizeForMatch(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[''`]/g, '')
        .replace(/\bthe\b|\ba\b|\ban\b/g, '')
        .replace(/\bst\b/g, 'saint')
        .replace(/\bmt\b/g, 'mount')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Simple similarity score (0-1) between two strings.
 * Uses longest common subsequence ratio.
 */
function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    // Substring check (fast path)
    if (longer.includes(shorter)) return shorter.length / longer.length;
    // Levenshtein-based similarity
    const costs = [];
    for (let i = 0; i <= shorter.length; i++) {
        let lastVal = i;
        for (let j = 0; j <= longer.length; j++) {
            if (i === 0) { costs[j] = j; }
            else if (j > 0) {
                let newVal = costs[j - 1];
                if (shorter[i - 1] !== longer[j - 1]) {
                    newVal = Math.min(newVal, lastVal, costs[j]) + 1;
                }
                costs[j - 1] = lastVal;
                lastVal = newVal;
            }
        }
        if (i > 0) costs[longer.length] = lastVal;
    }
    return 1 - costs[longer.length] / longer.length;
}

function checkDedup() {
    if (!dedupWarning || !reqTitle) return;
    const title = reqTitle.value.trim();
    const artist = reqArtist?.value?.trim() || '';
    if (!title) {
        dedupWarning.classList.add('hidden');
        return;
    }

    const normalizedTitle = normalizeForMatch(title);
    const normalizedArtist = normalizeForMatch(artist);

    // Find matches: exact slug match first, then fuzzy title match
    const slug = generateSlug(title, artist);
    const candidates = [];

    for (const song of allSongs) {
        // Exact slug match
        if (song.id === slug) {
            candidates.push({ song, score: 1.0, reason: 'exact' });
            continue;
        }

        // Fuzzy title match
        const songNormTitle = normalizeForMatch(song.title);
        const titleScore = similarity(normalizedTitle, songNormTitle);

        if (titleScore >= 0.8) {
            // Boost if artist also matches
            let artistBoost = 0;
            if (normalizedArtist && song.artist) {
                const artistScore = similarity(normalizedArtist, normalizeForMatch(song.artist));
                if (artistScore > 0.7) artistBoost = 0.1;
            }
            candidates.push({ song, score: titleScore + artistBoost, reason: 'fuzzy' });
        }
    }

    if (candidates.length === 0) {
        dedupWarning.classList.add('hidden');
        return;
    }

    // Sort by score descending, take top 3
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 3);

    const matchHtml = top.map(({ song }) => {
        const hasParts = songHasContent(song) || song.tablature_parts?.length || songHasAbc(song);
        const badge = isPlaceholder(song) ? ' <span class="dedup-badge">placeholder</span>' : '';
        return `
            <div class="dedup-match">
                <a href="#work/${song.id}" class="dedup-link" onclick="event.stopPropagation()">${escapeHtml(song.title)}</a>
                ${song.artist ? ` <span class="dedup-artist">by ${escapeHtml(song.artist)}</span>` : ''}${badge}
                ${hasParts ? ' <button class="dedup-bounty-btn" data-work-id="' + song.id + '">Request a part instead</button>' : ''}
            </div>
        `;
    }).join('');

    dedupWarning.innerHTML = `
        <span class="dedup-msg">Did you mean one of these?</span>
        ${matchHtml}
        <div class="dedup-proceed">
            <button class="dedup-proceed-btn" id="dedup-proceed-btn">No, this is a different song</button>
        </div>
    `;
    dedupWarning.classList.remove('hidden');

    // Wire "Request a part instead" buttons
    dedupWarning.querySelectorAll('.dedup-bounty-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            closeAddSongPicker();
            // Navigate to the work view where they can use the bounty request
            window.location.hash = `#work/${btn.dataset.workId}`;
        });
    });

    // Wire "No, different song" button
    dedupWarning.querySelector('#dedup-proceed-btn')?.addEventListener('click', () => {
        dedupWarning.classList.add('hidden');
        reqSubmit.disabled = false;
    });

    // Disable submit while dedup warning is shown
    if (reqSubmit) reqSubmit.disabled = true;
}

async function submitRequest() {
    const title = reqTitle?.value?.trim();
    const artist = reqArtist?.value?.trim() || '';
    const key = reqKey?.value || '';
    const notes = reqNotes?.value?.trim() || '';

    if (!title) return;

    const slug = generateSlug(title, artist);

    reqSubmit.disabled = true;
    if (reqStatus) { reqStatus.textContent = 'Submitting...'; reqStatus.className = 'picker-req-status'; }

    try {
        // Requesting a song does NOT require login (Phase 2a): it's a
        // request, not content the requester will come back looking for.
        // Signed in → the session token, and the server makes a placeholder
        // owned by the requester. Anonymous → the anon key, and the server
        // files a `tune-request` issue instead; the toast is the whole
        // experience, so there is nowhere to navigate afterwards.
        const supabase = window.SupabaseAuth?.supabase;
        const session = supabase ? (await supabase.auth.getSession()).data.session : null;
        const authToken = session?.access_token || SUPABASE_ANON_KEY;

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-song-request`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title, artist, key, notes, id: slug }),
        });

        const result = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(result.error || 'Failed to submit request');
        }

        track('placeholder_request_submit', {
            has_artist: !!artist,
            has_notes: !!notes,
            anonymous: !session,
        });

        if (result.mode === 'issue') {
            // Anonymous: no placeholder work exists to navigate to
            if (reqStatus) {
                reqStatus.textContent = 'Thanks! Your request has been logged.';
                reqStatus.className = 'picker-req-status success';
            }
            setTimeout(closeAddSongPicker, 1500);
            return;
        }

        if (reqStatus) { reqStatus.textContent = 'Request submitted!'; reqStatus.className = 'picker-req-status success'; }

        // Refresh pending songs so it shows up immediately
        if (window.refreshPendingSongs) await window.refreshPendingSongs();

        setTimeout(() => {
            closeAddSongPicker();
            window.location.hash = `#song/${slug}`;
        }, 1000);

    } catch (err) {
        console.error('Request submission error:', err);
        if (reqStatus) { reqStatus.textContent = err.message || 'Failed to submit.'; reqStatus.className = 'picker-req-status error'; }
        reqSubmit.disabled = false;
    }
}

export function openAddSongPicker(options = {}) {
    if (!pickerModal) return;

    // Reset state
    resetForm();
    currentContext = { ...options };

    if (options.mode === 'contribute') {
        // Hide request card — placeholder already exists, show upload/chordpro only
        requestCard?.classList.add('hidden');
        headerTitle.textContent = 'Help Complete This Song';
        showCards();
    } else if (options.mode === 'request') {
        // Skip cards, go straight to request form
        requestCard?.classList.remove('hidden');
        showRequestForm();
        pickerModal.classList.remove('hidden');
        return; // don't show cards first
    } else {
        // Default — show all 3 cards
        requestCard?.classList.remove('hidden');
        headerTitle.textContent = 'Add a Song';
        showCards();
    }

    pickerModal.classList.remove('hidden');
}

export function closeAddSongPicker() {
    pickerModal?.classList.add('hidden');
    // Reset to cards view for next open
    hideExistingTabsStep();
    pickerCards?.classList.remove('hidden');
    requestForm?.classList.add('hidden');
    tabTargetPanel?.classList.add('hidden');
    if (tabResults) tabResults.innerHTML = '';
}
