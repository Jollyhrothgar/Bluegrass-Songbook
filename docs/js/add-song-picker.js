// Add Song Picker — type selection modal (Upload Image, Lyrics & Chords, Request a Song)
// Supports modes: 'default' (3 cards), 'request' (straight to form), 'contribute' (2 cards, pre-filled)

import { allSongs } from './state.js';
import { generateSlug, escapeHtml } from './utils.js';
import { track } from './analytics.js';

const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

let pickerModal = null;
let pickerCards = null;
let requestForm = null;
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
            closeAddSongPicker();
            const ctx = { ...currentContext };
            if (type === 'upload' && onUpload) onUpload(ctx);
            else if (type === 'chordpro' && onChordPro) onChordPro(ctx);
        });
    });

    // Back button in request form
    pickerModal.querySelector('.picker-back-btn')?.addEventListener('click', showCards);

    // Title input: enable submit + dedup check
    reqTitle?.addEventListener('input', updateRequestSubmitState);
    reqTitle?.addEventListener('blur', checkDedup);

    // Submit
    reqSubmit?.addEventListener('click', submitRequest);
}

function showCards() {
    pickerCards?.classList.remove('hidden');
    requestForm?.classList.add('hidden');
    headerTitle.textContent = currentContext.mode === 'contribute' ? 'Help Complete This Song' : 'Add a Song';
}

function showRequestForm() {
    pickerCards?.classList.add('hidden');
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

function checkDedup() {
    if (!dedupWarning || !reqTitle) return;
    const title = reqTitle.value.trim();
    const artist = reqArtist?.value?.trim() || '';
    if (!title) {
        dedupWarning.classList.add('hidden');
        return;
    }

    const slug = generateSlug(title, artist);
    const existing = allSongs.find(s => s.id === slug);
    if (existing) {
        dedupWarning.innerHTML = `
            <span class="dedup-msg">A song matching "${escapeHtml(existing.title)}" already exists.</span>
            <a href="#work/${existing.id}" class="dedup-link" onclick="event.stopPropagation()">View it</a>
        `;
        dedupWarning.classList.remove('hidden');
    } else {
        dedupWarning.classList.add('hidden');
    }
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
        const supabase = window.SupabaseAuth?.supabase;
        const session = supabase ? (await supabase.auth.getSession()).data.session : null;
        if (!session) throw new Error('Not logged in');

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-song-request`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title, artist, key, notes, id: slug }),
        });

        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(body.error || 'Failed to submit request');
        }

        track('placeholder_request_submit', { has_artist: !!artist, has_notes: !!notes });

        if (reqStatus) { reqStatus.textContent = 'Request submitted!'; reqStatus.className = 'picker-req-status success'; }

        // Refresh pending songs so it shows up immediately
        if (window.refreshPendingSongs) await window.refreshPendingSongs();

        setTimeout(() => {
            closeAddSongPicker();
            window.location.hash = `#work/${slug}`;
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
    pickerCards?.classList.remove('hidden');
    requestForm?.classList.add('hidden');
}
