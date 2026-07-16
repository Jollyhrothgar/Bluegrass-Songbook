// Flags module for Bluegrass Songbook
// Allows users to report song issues - creates GitHub issues automatically

import { track } from './analytics.js';
import { requireLogin } from './utils.js';

/**
 * Get the submitter attribution for issue body.
 * Requires logged-in user (anonymous path removed).
 */
function getSubmitterAttribution() {
    const user = window.SupabaseAuth?.getUser?.();
    return user?.user_metadata?.full_name || user?.email || 'Anonymous User';
}

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

const FLAG_TYPES = [
    { id: 'wrong-chord', label: 'Wrong chord', desc: 'A chord is incorrect' },
    { id: 'wrong-placement', label: 'Chord in wrong place', desc: 'Chord timing is off' },
    { id: 'lyric-error', label: 'Lyric error', desc: 'Typo or wrong words' },
    { id: 'missing-section', label: 'Missing section', desc: 'Verse/chorus missing' },
    { id: 'other', label: 'Other issue', desc: 'Something else' }
];

// ============================================
// STATE
// ============================================

let currentSong = null;

// DOM elements (cached on init)
let flagModal = null;
let flagModalClose = null;
let flagOptions = null;
let flagDescription = null;
let flagSubmitBtn = null;
let flagCancelBtn = null;
let flagToast = null;

// ============================================
// HELPER FUNCTIONS
// ============================================

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

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Open flag modal for a song
 */
export function openFlagModal(song) {
    if (!flagModal || !song) return;
    if (!requireLogin('report issues')) return;

    currentSong = song;

    // Reset form
    const radios = flagOptions?.querySelectorAll('input[type="radio"]');
    radios?.forEach(r => r.checked = false);
    if (flagDescription) flagDescription.value = '';

    // Show modal
    flagModal.classList.remove('hidden');

    track('flag_modal_open', { song_id: song.id });
}

/**
 * Close flag modal
 */
function closeFlagModal() {
    if (!flagModal) return;
    flagModal.classList.add('hidden');
    currentSong = null;
}

/**
 * Submit flag via Edge Function (creates GitHub issue)
 */
async function submitFlag() {
    if (!currentSong) {
        showToast('No song selected.');
        return;
    }

    // Get selected flag type
    const selectedRadio = flagOptions?.querySelector('input[type="radio"]:checked');
    if (!selectedRadio) {
        showToast('Please select what type of issue you found.');
        return;
    }

    const flagType = selectedRadio.value;
    const description = flagDescription?.value?.trim() || '';

    // Require description for "other" type
    if (flagType === 'other' && !description) {
        showToast('Please describe the issue.');
        return;
    }

    // Disable submit button while processing
    if (flagSubmitBtn) {
        flagSubmitBtn.disabled = true;
        flagSubmitBtn.textContent = 'Submitting...';
    }

    try {
        // Use user's session token for authenticated requests
        const supabase = window.SupabaseAuth?.supabase;
        const session = supabase ? (await supabase.auth.getSession()).data.session : null;
        const authToken = session?.access_token || SUPABASE_ANON_KEY;

        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-flag-issue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
                'apikey': SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
                songId: currentSong.id,
                songTitle: currentSong.title || '',
                songArtist: currentSong.artist || '',
                flagType,
                description: description || undefined,
                submittedBy: getSubmitterAttribution(),
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to submit report');
        }

        // Track analytics
        track('flag_submit', {
            song_id: currentSong.id,
            flag_type: flagType,
            has_description: !!description,
            issue_number: result.issueNumber,
        });

        // Close modal and show success
        closeFlagModal();
        showToast('Thanks! Your report has been submitted.');

    } catch (err) {
        console.error('Flag submission error:', err);
        showToast('Failed to submit report. Please try again.');
    } finally {
        // Re-enable submit button
        if (flagSubmitBtn) {
            flagSubmitBtn.disabled = false;
            flagSubmitBtn.textContent = 'Submit Report';
        }
    }
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
}
