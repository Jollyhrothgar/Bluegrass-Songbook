// Review queue: the destructive residue (delete / suppress / merge-redirect).
//
// These cover the parts that decide who can do what and what the panel is
// allowed to CLAIM happened — the two places where a mistake is a lie to the
// user rather than a cosmetic bug.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils.js', () => ({
    escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));

import {
    REVIEW_KINDS,
    deleteAffordance,
    canReview,
    canSeeQueue,
    deriveStatus,
    localCommandFor,
    summarizeQueue,
    sortQueue,
    validateRequest,
    renderReviewQueue,
} from '../review-queue.js';

const req = (over = {}) => ({
    id: 'r1',
    kind: 'delete',
    target_id: 'blue-moon-of-kentucky',
    payload: {},
    reason: 'duplicate of the Monroe cut',
    status: 'pending',
    created_at: '2026-08-15T10:00:00Z',
    ...over,
});

describe('affordances', () => {
    it('admins delete instantly, trusted users request, everyone else sees nothing', () => {
        expect(deleteAffordance({ isAdmin: true, isTrusted: true })).toBe('instant');
        // admin without the trusted flag still deletes instantly
        expect(deleteAffordance({ isAdmin: true, isTrusted: false })).toBe('instant');
        expect(deleteAffordance({ isAdmin: false, isTrusted: true })).toBe('request');
        expect(deleteAffordance({ isAdmin: false, isTrusted: false })).toBe('none');
        expect(deleteAffordance()).toBe('none');
    });

    it('only admins review, but trusted users can watch the queue', () => {
        expect(canReview({ isAdmin: true })).toBe(true);
        expect(canReview({ isAdmin: false, isTrusted: true })).toBe(false);
        expect(canSeeQueue({ isAdmin: false, isTrusted: true })).toBe(true);
        expect(canSeeQueue({ isAdmin: true, isTrusted: false })).toBe(true);
        expect(canSeeQueue({})).toBe(false);
    });
});

describe('status derivation', () => {
    it('reports pending and rejected plainly', () => {
        expect(deriveStatus(req())).toEqual({ status: 'pending', label: 'Pending', needsLocalRun: false });
        expect(deriveStatus(req({ status: 'rejected' })).label).toBe('Rejected');
    });

    it('an approved delete is done — the app executed it', () => {
        expect(deriveStatus(req({ status: 'approved' })))
            .toEqual({ status: 'approved', label: 'Approved — done', needsLocalRun: false });
    });

    it('an approved suppress/merge is NOT done — it waits on a local run', () => {
        for (const kind of ['suppress', 'merge-redirect']) {
            const d = deriveStatus(req({ kind, status: 'approved' }));
            expect(d.needsLocalRun).toBe(true);
            expect(d.label).toBe('Approved — run locally');
        }
    });

    it('treats a missing status as pending', () => {
        expect(deriveStatus({ kind: 'delete' }).status).toBe('pending');
    });
});

describe('local commands', () => {
    it('has none for delete: the app already did it', () => {
        expect(localCommandFor(req({ status: 'approved' }))).toBeNull();
    });

    it('suppress prints the curate command with the reason quoted safely', () => {
        const cmd = localCommandFor(req({ kind: 'suppress', reason: 'a "junk" scrape' }));
        expect(cmd).toBe(`./scripts/utility curate suppress blue-moon-of-kentucky --reason "a 'junk' scrape"`);
    });

    it('merge-redirect prints a merge plan pointing at the redirect target', () => {
        const cmd = localCommandFor(req({
            kind: 'merge-redirect',
            target_id: 'how-long-blues-2',
            payload: { redirect_to: 'how-long-blues' },
        }));
        expect(cmd).toContain('"canonical":"how-long-blues"');
        expect(cmd).toContain('"merge":["how-long-blues-2"]');
        expect(cmd).toContain('merge_works.py /tmp/merge-plan.json --execute');
    });

    it('refuses to invent a merge target it was never given', () => {
        expect(localCommandFor(req({ kind: 'merge-redirect', payload: {} }))).toBeNull();
    });
});

describe('validation', () => {
    it('rejects unknown kinds and missing targets', () => {
        expect(validateRequest({ kind: 'nuke', targetId: 'x' })).toMatch(/Unknown request kind/);
        expect(validateRequest({ kind: 'delete', targetId: '' })).toMatch(/Missing target/);
    });

    it('a merge-redirect needs a destination that is not itself', () => {
        expect(validateRequest({ kind: 'merge-redirect', targetId: 'a', payload: {} }))
            .toMatch(/needs the work it redirects to/);
        expect(validateRequest({ kind: 'merge-redirect', targetId: 'a', payload: { redirect_to: 'a' } }))
            .toMatch(/cannot redirect to itself/);
        expect(validateRequest({ kind: 'merge-redirect', targetId: 'a', payload: { redirect_to: 'b' } }))
            .toBeNull();
    });

    it('accepts every kind the table allows', () => {
        for (const kind of Object.keys(REVIEW_KINDS)) {
            const payload = kind === 'merge-redirect' ? { redirect_to: 'other' } : {};
            expect(validateRequest({ kind, targetId: 'song', payload })).toBeNull();
        }
    });
});

describe('summary and ordering', () => {
    const rows = [
        req({ id: 'a', status: 'approved', kind: 'suppress', created_at: '2026-08-01T00:00:00Z' }),
        req({ id: 'b', status: 'pending', created_at: '2026-08-10T00:00:00Z' }),
        req({ id: 'c', status: 'rejected', created_at: '2026-08-12T00:00:00Z' }),
        req({ id: 'd', status: 'pending', created_at: '2026-08-02T00:00:00Z' }),
        req({ id: 'e', status: 'approved', kind: 'delete', created_at: '2026-08-14T00:00:00Z' }),
    ];

    it('counts by status and flags the ones still owed a local run', () => {
        expect(summarizeQueue(rows)).toEqual({
            total: 5, pending: 2, approved: 2, rejected: 1, awaitingLocalRun: 1,
        });
        expect(summarizeQueue()).toEqual({
            total: 0, pending: 0, approved: 0, rejected: 0, awaitingLocalRun: 0,
        });
    });

    it('puts pending first oldest-first, then decided newest-first', () => {
        expect(sortQueue(rows).map(r => r.id)).toEqual(['d', 'b', 'e', 'c', 'a']);
    });

    it('does not mutate the input', () => {
        const input = [...rows];
        sortQueue(input);
        expect(input.map(r => r.id)).toEqual(rows.map(r => r.id));
    });
});

describe('rendering', () => {
    let panel;
    beforeEach(() => {
        panel = document.createElement('div');
        document.body.appendChild(panel);
    });

    it('shows approve/reject to admins only', () => {
        renderReviewQueue(panel, { requests: [req()], isAdmin: true });
        expect(panel.querySelectorAll('[data-review-action]').length).toBe(2);

        renderReviewQueue(panel, { requests: [req()], isAdmin: false });
        expect(panel.querySelectorAll('[data-review-action]').length).toBe(0);
    });

    it('offers no buttons on an already-decided request', () => {
        renderReviewQueue(panel, { requests: [req({ status: 'approved' })], isAdmin: true });
        expect(panel.querySelectorAll('[data-review-action]').length).toBe(0);
    });

    it('surfaces the local command for an approved suppress instead of claiming it is done', () => {
        renderReviewQueue(panel, {
            requests: [req({ kind: 'suppress', status: 'approved' })],
            isAdmin: true,
        });
        expect(panel.textContent).toContain('Approved — run locally');
        expect(panel.querySelector('.review-item-command-code').textContent)
            .toContain('curate suppress blue-moon-of-kentucky');
    });

    it('tells a non-admin viewer who actually decides', () => {
        renderReviewQueue(panel, { requests: [req()], isAdmin: false });
        expect(panel.textContent).toContain('An admin decides these');
    });

    it('renders an empty queue without blowing up', () => {
        renderReviewQueue(panel, { requests: [], isAdmin: true });
        expect(panel.querySelector('.review-queue-empty')).not.toBeNull();
        expect(panel.querySelector('.review-queue-list')).toBeNull();
    });

    it('escapes request text rather than injecting it', () => {
        renderReviewQueue(panel, {
            requests: [req({ reason: '<img src=x onerror=alert(1)>' })],
            isAdmin: true,
        });
        expect(panel.querySelector('img')).toBeNull();
        expect(panel.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});
