// Super-user request module for Bluegrass Songbook
// Allows regular users to request trusted/super-user status for instant editing

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
let superuserModal = null;
let superuserModalClose = null;
let superuserReason = null;
let superuserConfirm = null;
let superuserSubmitBtn = null;
let superuserCancelBtn = null;
let superuserToast = null;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Show toast notification
 */
function showToast(message, duration = 4000) {
    if (!superuserToast) return;

    superuserToast.textContent = message;
    superuserToast.classList.remove('hidden');

    setTimeout(() => {
        superuserToast.classList.add('hidden');
    }, duration);
}

/**
 * Get current user info
 */
function getCurrentUser() {
    return window.SupabaseAuth?.getUser?.();
}

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Open super-user request modal
 */
export function openSuperUserRequestModal() {
    const user = getCurrentUser();

    if (!user) {
        showToast('Please sign in first to request super-user access.');
        return;
    }

    if (!superuserModal) {
        console.warn('Super-user modal not found');
        return;
    }

    // Reset form
    if (superuserReason) superuserReason.value = '';
    if (superuserConfirm) superuserConfirm.checked = false;
    if (superuserSubmitBtn) superuserSubmitBtn.disabled = true;

    // Show modal
    superuserModal.classList.remove('hidden');

    track('superuser_modal_open');
}

/**
 * Close super-user request modal
 */
function closeSuperUserModal() {
    if (!superuserModal) return;
    superuserModal.classList.add('hidden');
}

/**
 * Submit super-user request via Edge Function (creates GitHub issue)
 */
async function submitSuperUserRequest() {
    const user = getCurrentUser();

    if (!user) {
        showToast('Please sign in to request super-user access.');
        return;
    }

    // Check confirmation checkbox
    if (!superuserConfirm?.checked) {
        showToast('Please confirm you understand the responsibility.');
        return;
    }

    const reason = superuserReason?.value?.trim() || '';

    // Disable submit button while processing
    if (superuserSubmitBtn) {
        superuserSubmitBtn.disabled = true;
        superuserSubmitBtn.textContent = 'Submitting...';
    }

    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-superuser-request`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
                userId: user.id,
                userEmail: user.email,
                userName: user.user_metadata?.full_name || null,
                reason: reason || undefined,
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to submit request');
        }

        // Track analytics
        track('superuser_request_submit', {
            has_reason: !!reason,
            issue_number: result.issueNumber,
        });

        // Close modal and show success
        closeSuperUserModal();
        showToast('Request submitted! We\'ll review it and get back to you.');

    } catch (err) {
        console.error('Super-user request error:', err);
        showToast('Failed to submit request. Please try again.');
    } finally {
        // Re-enable submit button
        if (superuserSubmitBtn) {
            superuserSubmitBtn.disabled = false;
            superuserSubmitBtn.textContent = 'Submit Request';
        }
    }
}

/**
 * Update submit button state based on checkbox
 */
function updateSubmitState() {
    if (superuserSubmitBtn && superuserConfirm) {
        superuserSubmitBtn.disabled = !superuserConfirm.checked;
    }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize super-user request module
 */
export function initSuperUserRequest() {
    // Cache DOM elements
    superuserModal = document.getElementById('superuser-modal');
    superuserModalClose = document.getElementById('superuser-modal-close');
    superuserReason = document.getElementById('superuser-reason');
    superuserConfirm = document.getElementById('superuser-confirm');
    superuserSubmitBtn = document.getElementById('superuser-submit');
    superuserCancelBtn = document.getElementById('superuser-cancel');
    superuserToast = document.getElementById('superuser-toast');

    if (!superuserModal) {
        // Modal not in DOM yet - that's OK, it will be added
        return;
    }

    // Wire up events
    superuserSubmitBtn?.addEventListener('click', submitSuperUserRequest);
    superuserCancelBtn?.addEventListener('click', closeSuperUserModal);
    superuserModalClose?.addEventListener('click', closeSuperUserModal);
    superuserConfirm?.addEventListener('change', updateSubmitState);

    // Close on backdrop click
    superuserModal.addEventListener('click', (e) => {
        if (e.target === superuserModal) {
            closeSuperUserModal();
        }
    });
}
