// Transient bottom-of-screen toast. Extracted from main.js so any module can
// speak up without importing main (and without minting a fourth private copy
// of the same six lines).

export const TOAST_DURATION_MS = 3000;

/**
 * Show a toast notification.
 * @param {string} message
 * @param {Object} [options]
 * @param {'success'|'warning'} [options.variant='success']
 * @param {number} [options.duration=TOAST_DURATION_MS]
 * @returns {HTMLElement} the toast element (already in the DOM)
 */
export function showToast(message, options = {}) {
    const { variant = 'success', duration = TOAST_DURATION_MS } = options;

    const toast = document.createElement('div');
    toast.className = variant === 'success' ? 'auth-toast' : `auth-toast ${variant}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, duration);

    return toast;
}
