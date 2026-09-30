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
    analytics.initAnalytics(); // tracks session_start, starts the 30s flush timer
}

function sentEventNames(callIndex) {
    return rpc.mock.calls[callIndex][1].p_events.map(e => e.event_name);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    rpc = vi.fn();
    window.SupabaseAuth = { _getClient: () => ({ rpc }) };
});

afterEach(() => {
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

    it('is a no-op without a Supabase client', async () => {
        window.SupabaseAuth = { _getClient: () => null };
        await load();
        await expect(vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS)).resolves.not.toThrow();
        expect(rpc).not.toHaveBeenCalled();
    });
});
