// Unified feedback modal for Bluegrass Songbook
// One surface for song flags, song corrections, bug reports and general
// feedback - creates GitHub issues via the create-flag-issue edge function.

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

// Feedback types shown in the modal's type selector
const FEEDBACK_TYPES = [
    { id: 'song-issue', label: 'Song issue' },
    { id: 'song-correction', label: 'Song correction' },
    { id: 'bug-report', label: 'Bug report' },
    { id: 'general-feedback', label: 'General feedback' },
];

// Categories for the "Song issue" type (same ids the edge function labels)
const FLAG_TYPES = [
    { id: 'wrong-chord', label: 'Wrong chord', desc: 'A chord is incorrect' },
    { id: 'wrong-placement', label: 'Chord in wrong place', desc: 'Chord timing is off' },
    { id: 'lyric-error', label: 'Lyric error', desc: 'Typo or wrong words' },
    { id: 'missing-section', label: 'Missing section', desc: 'Verse/chorus missing' },
    { id: 'other', label: 'Other issue', desc: 'Something else' }
];

const DESCRIPTION_PLACEHOLDERS = {
    'song-issue': "E.g., 'The G chord in verse 2 should be C'",
    'song-correction': "Describe the correction, e.g. 'Verse 2 is missing; it goes...'",
    'bug-report': 'E.g., search results freeze when I type chord:VII...',
    'general-feedback': 'Tell us what you think...',
};

// ============================================
// STATE
// ============================================

let currentSong = null;
let currentType = 'general-feedback';
let hooks = {};

// DOM elements (cached on init)
let flagModal = null;
let flagModalClose = null;
let flagModalTitle = null;
let flagTypeSelect = null;
let flagSongContext = null;
let flagSongSection = null;
let flagCorrectionSection = null;
let flagCorrectionEditBtn = null;
let flagDescriptionLabel = null;
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
 * Open the unified feedback modal.
 * @param {Object} options
 * @param {string} options.type - preselected feedback type id
 * @param {Object} options.song - song context (for song issues/corrections)
 */
export function openFeedbackModal({ type = 'general-feedback', song = null } = {}) {
    if (!flagModal) return;

    currentSong = song;
    currentType = FEEDBACK_TYPES.some(t => t.id === type) ? type : 'general-feedback';

    // Reset form
    const radios = flagOptions?.querySelectorAll('input[type="radio"]');
    radios?.forEach(r => r.checked = false);
    if (flagDescription) flagDescription.value = '';
    if (flagTypeSelect) flagTypeSelect.value = currentType;

    updateTypeSections();

    // Show modal
    flagModal.classList.remove('hidden');

    track('feedback_modal_open', { type: currentType, song_id: song?.id });
}

/**
 * Open feedback modal preset to "Song issue" for a song.
 * Kept as the song-page entry point (work-view overflow "Report issue").
 */
export function openFlagModal(song) {
    if (!song) return;
    openFeedbackModal({ type: 'song-issue', song });
}

/**
 * Show/hide the per-type sections and refresh song context line.
 */
function updateTypeSections() {
    const isSongIssue = currentType === 'song-issue';
    const isCorrection = currentType === 'song-correction';

    flagSongSection?.classList.toggle('hidden', !isSongIssue);
    flagCorrectionSection?.classList.toggle('hidden', !isCorrection);
    flagCorrectionEditBtn?.classList.toggle('hidden', !currentSong);

    if (flagModalTitle) {
        flagModalTitle.textContent = isSongIssue ? 'Report an Issue' : 'Send Feedback';
    }

    // Song context line (song issues and corrections carry song info)
    if (flagSongContext) {
        if ((isSongIssue || isCorrection) && currentSong) {
            flagSongContext.textContent = `Song: ${currentSong.title || currentSong.id}${currentSong.artist ? ` by ${currentSong.artist}` : ''}`;
            flagSongContext.classList.remove('hidden');
        } else {
            flagSongContext.classList.add('hidden');
        }
    }

    if (flagDescription) {
        flagDescription.placeholder = DESCRIPTION_PLACEHOLDERS[currentType] || '';
    }
    if (flagDescriptionLabel) {
        flagDescriptionLabel.textContent = isSongIssue ? 'Details (optional):' : 'Details:';
    }
}

/**
 * Close feedback modal
 */
function closeFlagModal() {
    if (!flagModal) return;
    flagModal.classList.add('hidden');
    currentSong = null;
}

/**
 * Submit feedback via Edge Function (creates GitHub issue).
 * The edge function requires an authenticated user, so the login gate
 * lives here at submit time; the mailto footer link is the anonymous path.
 */
async function submitFlag() {
    let flagType;
    const description = flagDescription?.value?.trim() || '';

    if (currentType === 'song-issue') {
        // Get selected flag category
        const selectedRadio = flagOptions?.querySelector('input[type="radio"]:checked');
        if (!selectedRadio) {
            showToast('Please select what type of issue you found.');
            return;
        }
        flagType = selectedRadio.value;

        // Require description for "other" type
        if (flagType === 'other' && !description) {
            showToast('Please describe the issue.');
            return;
        }
    } else {
        flagType = currentType;
        if (!description) {
            showToast('Please add some details first.');
            return;
        }
    }

    if (!requireLogin('send feedback')) return;

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

        const typeLabel = FEEDBACK_TYPES.find(t => t.id === currentType)?.label || 'Feedback';
        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-flag-issue`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
                'apikey': SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
                // Non-song feedback has no song context; the edge function
                // requires a songId, so 'app' marks app-level reports.
                songId: currentSong?.id || 'app',
                songTitle: currentSong?.title || (currentSong ? '' : typeLabel),
                songArtist: currentSong?.artist || '',
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
            song_id: currentSong?.id,
            feedback_type: currentType,
            flag_type: flagType,
            has_description: !!description,
            issue_number: result.issueNumber,
        });

        // Close modal and show success
        closeFlagModal();
        showToast('Thanks! Your report has been submitted.');

    } catch (err) {
        console.error('Feedback submission error:', err);
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
 * Build feedback type selector options HTML
 */
function buildTypeOptionsHtml() {
    return FEEDBACK_TYPES.map(type =>
        `<option value="${type.id}">${type.label}</option>`
    ).join('');
}

/**
 * Build flag options HTML (song-issue categories)
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
 * Initialize the feedback modal.
 * @param {Object} options
 * @param {Function} options.onEditSong - open the editor for a song
 *   (used by the correction type's "Edit This Song" button)
 */
export function initFlags(options = {}) {
    hooks = options;

    // Cache DOM elements
    flagModal = document.getElementById('flag-modal');
    flagModalClose = document.getElementById('flag-modal-close');
    flagModalTitle = document.getElementById('flag-modal-title');
    flagTypeSelect = document.getElementById('flag-type-select');
    flagSongContext = document.getElementById('flag-song-context');
    flagSongSection = document.getElementById('flag-song-section');
    flagCorrectionSection = document.getElementById('flag-correction-section');
    flagCorrectionEditBtn = document.getElementById('flag-correction-edit-btn');
    flagDescriptionLabel = document.getElementById('flag-description-label');
    flagOptions = document.getElementById('flag-options');
    flagDescription = document.getElementById('flag-description');
    flagSubmitBtn = document.getElementById('flag-submit');
    flagCancelBtn = document.getElementById('flag-cancel');
    flagToast = document.getElementById('flag-toast');

    if (!flagModal) {
        console.warn('Feedback modal not found, feedback disabled');
        return;
    }

    // Build type selector and song-issue categories
    if (flagTypeSelect) {
        flagTypeSelect.innerHTML = buildTypeOptionsHtml();
        flagTypeSelect.addEventListener('change', () => {
            currentType = flagTypeSelect.value;
            updateTypeSections();
        });
    }
    if (flagOptions) {
        flagOptions.innerHTML = buildFlagOptionsHtml();
    }

    // Correction type: hand off to the song editor
    flagCorrectionEditBtn?.addEventListener('click', () => {
        const song = currentSong;
        closeFlagModal();
        if (song && hooks.onEditSong) hooks.onEditSong(song);
    });

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
