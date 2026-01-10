// Song Request module for Bluegrass Songbook
// Allows users to request songs to be added - creates GitHub issues automatically

import { track } from './analytics.js';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

// ============================================
// STATE
// ============================================

// DOM elements (cached on init)
let requestModal = null;
let requestClose = null;
let requestTitle = null;
let requestArtist = null;
let requestDetails = null;
let requestSubmitBtn = null;
let requestCancelBtn = null;
let requestStatus = null;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get the submitter attribution for issue body.
 * Uses logged-in user's name/email if available, otherwise "Rando Calrissian"
 */
function getSubmitterAttribution() {
    const user = window.SupabaseAuth?.getUser?.();
    if (user) {
        return user.user_metadata?.full_name || user.email || 'Anonymous User';
    }
    return 'Rando Calrissian';
}

/**
 * Show status message in modal
 */
function showStatus(message, isError = false) {
    if (!requestStatus) return;
    requestStatus.textContent = message;
    requestStatus.className = 'modal-status' + (isError ? ' error' : ' success');
    requestStatus.classList.remove('hidden');
}

/**
 * Clear status message
 */
function clearStatus() {
    if (!requestStatus) return;
    requestStatus.textContent = '';
    requestStatus.classList.add('hidden');
}

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Open song request modal
 */
export function openSongRequestModal() {
    if (!requestModal) return;

    // Reset form
    if (requestTitle) requestTitle.value = '';
    if (requestArtist) requestArtist.value = '';
    if (requestDetails) requestDetails.value = '';
    clearStatus();

    // Show modal
    requestModal.classList.remove('hidden');

    // Focus title input
    requestTitle?.focus();

    track('song_request_modal_open');
}

/**
 * Close song request modal
 */
function closeSongRequestModal() {
    if (!requestModal) return;
    requestModal.classList.add('hidden');
    clearStatus();
}

/**
 * Submit song request via Edge Function (creates GitHub issue)
 */
async function submitSongRequest() {
    const title = requestTitle?.value?.trim();
    const artist = requestArtist?.value?.trim();
    const details = requestDetails?.value?.trim();

    if (!title) {
        showStatus('Please enter a song title.', true);
        requestTitle?.focus();
        return;
    }

    // Disable submit button while processing
    if (requestSubmitBtn) {
        requestSubmitBtn.disabled = true;
        requestSubmitBtn.textContent = 'Submitting...';
    }
    clearStatus();

    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-song-request`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
                songTitle: title,
                artist: artist || undefined,
                details: details || undefined,
                submittedBy: getSubmitterAttribution(),
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to submit request');
        }

        // Track analytics
        track('song_request_submit', {
            has_artist: !!artist,
            has_details: !!details,
            issue_number: result.issueNumber,
        });

        // Show success and close after delay
        showStatus('Request submitted! We\'ll look into adding this song.');

        setTimeout(() => {
            closeSongRequestModal();
        }, 2000);

    } catch (err) {
        console.error('Song request error:', err);
        showStatus('Failed to submit request. Please try again.', true);
    } finally {
        // Re-enable submit button
        if (requestSubmitBtn) {
            requestSubmitBtn.disabled = false;
            requestSubmitBtn.textContent = 'Submit Request';
        }
    }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize song request module
 */
export function initSongRequest() {
    // Cache DOM elements
    requestModal = document.getElementById('song-request-modal');
    requestClose = document.getElementById('song-request-close');
    requestTitle = document.getElementById('request-title');
    requestArtist = document.getElementById('request-artist');
    requestDetails = document.getElementById('request-details');
    requestSubmitBtn = document.getElementById('song-request-submit');
    requestCancelBtn = document.getElementById('song-request-cancel');
    requestStatus = document.getElementById('song-request-status');

    if (!requestModal) {
        console.warn('Song request modal not found, feature disabled');
        return;
    }

    // Wire up events
    requestSubmitBtn?.addEventListener('click', submitSongRequest);
    requestCancelBtn?.addEventListener('click', closeSongRequestModal);
    requestClose?.addEventListener('click', closeSongRequestModal);

    // Close on backdrop click
    requestModal.addEventListener('click', (e) => {
        if (e.target === requestModal) {
            closeSongRequestModal();
        }
    });

    // Submit on Enter in title field
    requestTitle?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitSongRequest();
        }
    });
}
