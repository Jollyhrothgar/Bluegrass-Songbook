// @vitest-environment jsdom
// Phase 4a (#227 / #207): "My submissions" status derivation. Status is
// computed from two Supabase sources — submission_log (one row per write
// attempt) and pending_songs (the Live overlay) — plus whether the target
// id already resolves in the durable corpus. These tests cover the pure
// logic only; rendering/network wiring is exercised via renderMySubmissionsView.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    deriveSubmissionStatus, buildSubmissionRows, ACTION_LABELS, STATUS_LABELS,
    renderMySubmissionsView,
} from '../my-submissions.js';

describe('deriveSubmissionStatus', () => {
    it('pending row not yet committed -> live', () => {
        const status = deriveSubmissionStatus({
            pendingRow: { id: 'blue-moon', github_committed: false },
            workExists: false,
        });
        expect(status).toBe('live');
    });

    it('pending row committed -> in_songbook', () => {
        const status = deriveSubmissionStatus({
            pendingRow: { id: 'blue-moon', github_committed: true },
            workExists: false,
        });
        expect(status).toBe('in_songbook');
    });

    it('no pending row but the id already resolves in the corpus -> in_songbook', () => {
        const status = deriveSubmissionStatus({ pendingRow: null, workExists: true });
        expect(status).toBe('in_songbook');
    });

    it('log-only action, nothing durable or live yet -> requested', () => {
        const status = deriveSubmissionStatus({ pendingRow: null, workExists: false });
        expect(status).toBe('requested');
    });

    it('a committed pending row wins even if workExists is also true', () => {
        const status = deriveSubmissionStatus({
            pendingRow: { id: 'x', github_committed: true },
            workExists: true,
        });
        expect(status).toBe('in_songbook');
    });
});

describe('buildSubmissionRows', () => {
    it('joins a log row to its pending row by target_id', () => {
        const logRows = [
            { id: 'log1', action: 'song_submit', target_id: 'blue-moon', created_at: '2026-08-01T00:00:00Z', metadata: { title: 'fallback title' } },
        ];
        const pendingRows = [
            { id: 'blue-moon', title: 'Blue Moon of Kentucky', artist: 'Bill Monroe', github_committed: false, created_by: 'u1' },
        ];
        const [row] = buildSubmissionRows(logRows, pendingRows, new Set());
        expect(row.status).toBe('live');
        expect(row.statusLabel).toBe(STATUS_LABELS.live);
        expect(row.title).toBe('Blue Moon of Kentucky');
        expect(row.artist).toBe('Bill Monroe');
        expect(row.kind).toBe(ACTION_LABELS.song_submit);
        expect(row.linkable).toBe(true);
    });

    it('a committed pending row reports in_songbook and stays linkable', () => {
        const logRows = [
            { id: 'log2', action: 'song_submit', target_id: 'blue-moon', created_at: '2026-08-01T00:00:00Z' },
        ];
        const pendingRows = [
            { id: 'blue-moon', title: 'Blue Moon of Kentucky', github_committed: true },
        ];
        const [row] = buildSubmissionRows(logRows, pendingRows, new Set());
        expect(row.status).toBe('in_songbook');
        expect(row.linkable).toBe(true);
    });

    it('a log-only row (e.g. a flag report) with no pending row and no corpus match is requested and not linkable', () => {
        const logRows = [
            { id: 'log3', action: 'flag_report', target_id: 'some-song', created_at: '2026-08-01T00:00:00Z', metadata: { flag_type: 'wrong-chord' } },
        ];
        const [row] = buildSubmissionRows(logRows, [], new Set());
        expect(row.status).toBe('requested');
        expect(row.statusLabel).toBe(STATUS_LABELS.requested);
        expect(row.linkable).toBe(false);
        // No metadata.title on flag reports — falls back to the target id.
        expect(row.title).toBe('some-song');
    });

    it('a log-only row whose target id already resolves in the corpus is in_songbook and linkable (e.g. a merged tab PR)', () => {
        const logRows = [
            { id: 'log4', action: 'tab_submit', target_id: 'new-tune', created_at: '2026-08-01T00:00:00Z', metadata: { title: 'New Tune', instrument: 'banjo' } },
        ];
        const [row] = buildSubmissionRows(logRows, [], new Set(['new-tune']));
        expect(row.status).toBe('in_songbook');
        expect(row.linkable).toBe(true);
        expect(row.title).toBe('New Tune');
    });

    it('sorts newest first', () => {
        const logRows = [
            { id: 'old', action: 'flag_report', target_id: 'a', created_at: '2026-01-01T00:00:00Z' },
            { id: 'new', action: 'flag_report', target_id: 'b', created_at: '2026-08-01T00:00:00Z' },
        ];
        const rows = buildSubmissionRows(logRows, [], new Set());
        expect(rows.map(r => r.id)).toEqual(['new', 'old']);
    });

    it('handles missing/undefined inputs without throwing', () => {
        expect(buildSubmissionRows(null, null, null)).toEqual([]);
        expect(buildSubmissionRows(undefined, undefined, undefined)).toEqual([]);
    });
});

describe('renderMySubmissionsView', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.SupabaseAuth;
        document.body.innerHTML = '';
    });

    it('shows a sign-in prompt when logged out, and opens the auth modal on click', () => {
        window.SupabaseAuth = { getUser: () => null };
        const openAuthModal = vi.fn();
        window.addEventListener('open-auth-modal', openAuthModal);

        renderMySubmissionsView(container);

        expect(container.textContent).toMatch(/sign in/i);
        container.querySelector('#my-submissions-sign-in-btn').click();
        expect(openAuthModal).toHaveBeenCalledTimes(1);
    });

    it('shows a friendly empty state pointing at Add Song for a logged-in user with nothing', async () => {
        // submission_log query chains .select().eq().order(); pending_songs
        // chains .select().eq() — stub both shapes per table.
        const fromStub = (table) => {
            if (table === 'submission_log') {
                return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) };
            }
            return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
        };
        window.SupabaseAuth = {
            getUser: () => ({ id: 'u1' }),
            supabase: { from: fromStub },
        };

        renderMySubmissionsView(container);
        expect(container.textContent).toMatch(/loading/i);

        // Let the fetch promises resolve, then the re-render.
        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => setTimeout(r, 0));

        expect(container.textContent).toMatch(/haven't submitted anything/i);
        expect(container.querySelector('#my-submissions-add-btn')).toBeTruthy();
    });
});
