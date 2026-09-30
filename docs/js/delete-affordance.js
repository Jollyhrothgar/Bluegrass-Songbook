// Which delete affordance a viewer gets on a song page.
//
// Split out of review-queue.js so work-view.js can ask at boot without pulling
// in the whole review queue, which is only needed inside the Dungeon and is
// loaded on demand. review-queue.js re-exports it: the queue and the button
// agree because they share this one rule.

/**
 * Admins keep the instant path; trusted users get to ask; nobody else sees it.
 */
export function deleteAffordance({ isAdmin = false, isTrusted = false } = {}) {
    if (isAdmin) return 'instant';
    if (isTrusted) return 'request';
    return 'none';
}
