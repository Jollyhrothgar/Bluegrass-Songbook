// analytics.js flush(): a server-side failure must re-queue the batch.
//
// supabase.rpc() resolves { error } on a server error instead of throwing, so
// a flush() that only looked at exceptions dropped every batch for the eight
// months log_events was returning 404 (42P01).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const FLUSH_INTERVAL_MS = 30000;

let analytics;
let rpc;

async function load() {
    vi.resetModules();
    analytics = await import('../analytics.js');
    // jsdom is localhost, where telemetry is off; these tests are about flush()
    analytics.initAnalytics({ enabled: true }); // tracks session_start, starts the 30s flush timer
}

function sentEventNames(callIndex) {
    return rpc.mock.calls[callIndex][1].p_events.map(e => e.event_name);
}

// Every load() re-imports the module, and each copy registers its own page
// listeners; remove them after each test so a stale copy cannot answer an event.
let listeners;

beforeEach(() => {
    listeners = [];
    for (const target of [window, document]) {
        const add = target.addEventListener.bind(target);
        vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, opts) => {
            listeners.push([target, type, fn, opts]);
            add(type, fn, opts);
        });
    }
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    rpc = vi.fn();
    window.SupabaseAuth = { _getClient: () => ({ rpc }) };
});

afterEach(() => {
    for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete window.SupabaseAuth;
});

describe('flush', () => {
    it('sends the queue to log_events with the visitor id', async () => {
        rpc.mockResolvedValue({ data: 2, error: null });
        await load();
        analytics.track('a');

        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc.mock.calls[0][0]).toBe('log_events');
        expect(rpc.mock.calls[0][1].p_visitor_id).toMatch(/^v_/);
        expect(sentEventNames(0)).toEqual(['session_start', 'a']);
    });

    it('does not resend a batch the server accepted', async () => {
        rpc.mockResolvedValue({ data: 2, error: null });
        await load();

        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

        expect(rpc).toHaveBeenCalledTimes(1); // second tick: queue empty, nothing to send
    });

    it('re-queues the batch when rpc resolves { error } (the log_events 404)', async () => {
        rpc.mockResolvedValueOnce({
            data: null,
            error: { code: '42P01', message: 'relation "analytics_events" does not exist' }
        });
        rpc.mockResolvedValueOnce({ data: 1, error: null });
        await load();

        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
        expect(rpc).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(sentEventNames(1)).toEqual(['session_start']); // the same batch, retried
    });

    it('re-queues the batch when rpc throws', async () => {
        rpc.mockRejectedValueOnce(new Error('network down'));
        rpc.mockResolvedValueOnce({ data: 1, error: null });
        await load();

        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

        expect(rpc).toHaveBeenCalledTimes(2);
        expect(sentEventNames(1)).toEqual(['session_start']);
    });

    it('keeps new events behind the re-queued ones, in order', async () => {
        rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
        rpc.mockResolvedValueOnce({ data: 3, error: null });
        await load();

        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS - 1);
        analytics.track('later');
        await vi.advanceTimersByTimeAsync(1);       // first flush fails
        analytics.track('newer');
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

        expect(sentEventNames(1)).toEqual(['session_start', 'later', 'newer']);
    });

    it('does not hammer the endpoint once per event after a failure', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        await load();
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
        expect(rpc).toHaveBeenCalledTimes(1);

        // A burst big enough to trip the "queue is large" flush, right after the failure.
        for (let i = 0; i < 60; i++) analytics.track('burst');
        await vi.advanceTimersByTimeAsync(0);

        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it('retries on the next timer tick even when the failing request was slow', async () => {
        // The back-off is measured from when the failure comes back. With a
        // full-interval window the 60s tick fell inside it and was skipped.
        rpc.mockImplementation(() => new Promise(resolve =>
            setTimeout(() => resolve({ data: null, error: { message: 'boom' } }), 2000)));
        await load();
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS + 2000);
        expect(rpc).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS - 2000);
        expect(rpc).toHaveBeenCalledTimes(2);
    });

    it('still flushes when the tab is hidden right after a failure', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        await load();
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
        expect(rpc).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        try {
            document.dispatchEvent(new Event('visibilitychange'));
            await vi.advanceTimersByTimeAsync(0);
        } finally {
            delete document.hidden;
        }
        expect(rpc).toHaveBeenCalledTimes(2);
    });

    it('is a no-op without a Supabase client', async () => {
        window.SupabaseAuth = { _getClient: () => null };
        await load();
        await expect(vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS)).resolves.not.toThrow();
        expect(rpc).not.toHaveBeenCalled();
    });
});

describe('off the production site', () => {
    it('never initializes, so nothing is queued or sent', async () => {
        vi.resetModules();
        analytics = await import('../analytics.js');
        analytics.initAnalytics(); // jsdom: localhost
        analytics.track('a');

        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS * 3);
        window.dispatchEvent(new Event('beforeunload'));

        expect(rpc).not.toHaveBeenCalled();
    });
});

// search-gaps (scripts/lib/search_gaps.py) reads these events back to find
// what visitors could not find.
describe('search-gap events', () => {
    function sentEvents() {
        return rpc.mock.calls[0][1].p_events;
    }

    beforeEach(() => {
        rpc.mockResolvedValue({ data: 1, error: null });
    });

    it('records the search scope, so a count that included the dungeon reads as one', async () => {
        await load();
        analytics.trackSearch('salt spring', 0, { has_tag: false }, 'canon+dungeon');
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

        const [search, zero] = sentEvents().filter(e => e.event_name !== 'session_start');
        expect(search.event_name).toBe('search');
        expect(search.properties).toMatchObject({
            query: 'salt spring', result_count: 0, scope: 'canon+dungeon'
        });
        expect(zero.event_name).toBe('zero_results');
        expect(zero.properties.scope).toBe('canon+dungeon');
    });

    it('defaults the scope to the canon', async () => {
        await load();
        analytics.trackSearch('tall pines', 1, {});
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
        expect(sentEvents().find(e => e.event_name === 'search').properties.scope).toBe('canon');
    });

    it('logs a song page that was not found, with where the visitor came from', async () => {
        Object.defineProperty(document, 'referrer', { value: 'https://www.google.com/', configurable: true });
        try {
            await load();
            analytics.trackSongNotFound('gone-song', 'deep_link', 2);
        } finally {
            delete document.referrer;
        }
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

        const event = sentEvents().find(e => e.event_name === 'song_not_found');
        expect(event.properties).toEqual({
            song_id: 'gone-song',
            source: 'deep_link',
            suggestions: 2,
            path: expect.any(String),
            referrer: 'https://www.google.com/'
        });
    });

    it('leaves the referrer off an in-app miss: the page was not where the visit began', async () => {
        Object.defineProperty(document, 'referrer', { value: 'https://www.google.com/', configurable: true });
        try {
            await load();
            analytics.trackSongNotFound('gone-song', 'list', 0);
        } finally {
            delete document.referrer;
        }
        await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

        expect(sentEvents().find(e => e.event_name === 'song_not_found').properties.referrer).toBeNull();
    });
});
