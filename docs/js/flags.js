// Flags module for Bluegrass Songbook
// Allows users to report song issues (wrong chords, placement, lyrics, etc.)

import { track } from './analytics.js';

// ============================================
// CONFIGURATION
// ============================================

const FLAG_TYPES = [
    { id: 'wrong-chord', label: 'Wrong chord', desc: 'A chord is incorrect' },
    { id: 'wrong-placement', label: 'Chord in wrong place', desc: 'Chord timing is off' },
    { id: 'lyric-error', label: 'Lyric error', desc: 'Typo or wrong words' },
    { id: 'missing-section', label: 'Missing section', desc: 'Verse/chorus missing' },
    { id: 'other', label: 'Other issue', desc: 'Something else' }
];

const MILESTONES = [1, 5, 10, 25, 50, 100];

// ============================================
// STATE
// ============================================

let currentSongId = null;
let flagCount = 0;

// DOM elements (cached on init)
let flagModal = null;
let flagModalClose = null;
let flagOptions = null;
let flagDescription = null;
let flagSubmitBtn = null;
let flagCancelBtn = null;
let flagToast = null;
let flagCountEl = null;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get visitor ID from localStorage
 */
function getVisitorId() {
    let visitorId = localStorage.getItem('songbook-visitor-id');
    if (!visitorId) {
        visitorId = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('songbook-visitor-id', visitorId);
    }
    return visitorId;
}

/**
 * Get Supabase client (from SupabaseAuth global)
 */
function getSupabase() {
    if (typeof window.SupabaseAuth !== 'undefined' && window.SupabaseAuth._getClient) {
        return window.SupabaseAuth._getClient();
    }
    return null;
}

/**
 * Show toast notification
 */
function showToast(message, duration = 3000) {
    if (!flagToast) return;

    flagToast.textContent = message;
    flagToast.classList.remove('hidden');

    setTimeout(() => {
        flagToast.classList.add('hidden');
    }, duration);
}

/**
 * Check for milestone and show celebration toast
 */
function checkMilestone(count) {
    if (MILESTONES.includes(count)) {
        showToast(`You've submitted ${count} flags! Thanks for helping improve the songbook.`, 4000);
        track('flag_milestone', { count });
    }
}

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Open flag modal for a song
 */
export function openFlagModal(songId) {
    if (!flagModal) return;

    currentSongId = songId;

    // Reset form
    const radios = flagOptions?.querySelectorAll('input[type="radio"]');
    radios?.forEach(r => r.checked = false);
    if (flagDescription) flagDescription.value = '';

    // Show modal
    flagModal.classList.remove('hidden');

    track('flag_modal_open', { song_id: songId });
}

/**
 * Close flag modal
 */
function closeFlagModal() {
    if (!flagModal) return;
    flagModal.classList.add('hidden');
    currentSongId = null;
}

/**
 * Submit flag to Supabase
 */
async function submitFlag() {
    const supabase = getSupabase();
    if (!supabase) {
        showToast('Unable to submit flag. Please try again.');
        return;
    }

    // Get selected flag type
    const selectedRadio = flagOptions?.querySelector('input[type="radio"]:checked');
    if (!selectedRadio) {
        showToast('Please select what type of issue you found.');
        return;
    }

    const flagType = selectedRadio.value;
    const description = flagDescription?.value?.trim() || null;

    // Require description for "other" type
    if (flagType === 'other' && !description) {
        showToast('Please describe the issue.');
        return;
    }

    const visitorId = getVisitorId();

    try {
        const { data, error } = await supabase.rpc('submit_flag', {
            p_song_id: currentSongId,
            p_flag_type: flagType,
            p_description: description,
            p_visitor_id: visitorId
        });

        if (error) throw error;

        // Update local count
        flagCount++;
        localStorage.setItem('songbook-flag-count', flagCount.toString());

        // Track analytics
        track('flag_submit', {
            song_id: currentSongId,
            flag_type: flagType,
            has_description: !!description
        });

        // Close modal and show success
        closeFlagModal();
        showToast(`Thanks! You've submitted ${flagCount} flag${flagCount === 1 ? '' : 's'}.`);

        // Check for milestone
        checkMilestone(flagCount);

    } catch (err) {
        console.error('Flag submission error:', err);
        showToast('Failed to submit flag. Please try again.');
    }
}

/**
 * Get user's flag count from Supabase
 */
export async function syncFlagCount() {
    const supabase = getSupabase();
    if (!supabase) return;

    const visitorId = getVisitorId();

    try {
        const { data, error } = await supabase.rpc('get_visitor_flag_count', {
            p_visitor_id: visitorId
        });

        if (!error && data !== null) {
            flagCount = data;
            localStorage.setItem('songbook-flag-count', flagCount.toString());
        }
    } catch (err) {
        // Silent fail - use local count
    }
}

/**
 * Get current flag count
 */
export function getFlagCount() {
    return flagCount;
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Build flag options HTML
 */
function buildFlagOptionsHtml() {
    return FLAG_TYPES.map(type => `
        <label class="flag-option">
            <input type="radio" name="flag-type" value="${type.id}">
            <span class="flag-option-label">${type.label}</span>
            <span class="flag-option-desc">${type.desc}</span>
        </label>
    `).join('');
}

/**
 * Initialize flags module
 */
export function initFlags() {
    // Cache DOM elements
    flagModal = document.getElementById('flag-modal');
    flagModalClose = document.getElementById('flag-modal-close');
    flagOptions = document.getElementById('flag-options');
    flagDescription = document.getElementById('flag-description');
    flagSubmitBtn = document.getElementById('flag-submit');
    flagCancelBtn = document.getElementById('flag-cancel');
    flagToast = document.getElementById('flag-toast');
    flagCountEl = document.getElementById('flag-count');

    if (!flagModal) {
        console.warn('Flag modal not found, flags disabled');
        return;
    }

    // Build options
    if (flagOptions) {
        flagOptions.innerHTML = buildFlagOptionsHtml();
    }

    // Wire up events
    flagSubmitBtn?.addEventListener('click', submitFlag);
    flagCancelBtn?.addEventListener('click', closeFlagModal);
    flagModalClose?.addEventListener('click', closeFlagModal);

    // Close on backdrop click
    flagModal.addEventListener('click', (e) => {
        if (e.target === flagModal) {
            closeFlagModal();
        }
    });

    // Load local count
    flagCount = parseInt(localStorage.getItem('songbook-flag-count') || '0', 10);

    // Sync with server (async, non-blocking)
    syncFlagCount();
}
