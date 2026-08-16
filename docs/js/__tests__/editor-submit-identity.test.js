// @vitest-environment jsdom
// Phase 2a: a song submission/correction carries NO client-supplied
// identity. The session token is the attribution — it goes out as the
// bearer token and create-song-issue derives the submitter from it
// server-side. Without a session the request is never made at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { submitToGitHubIssue } from '../editor.js';

function mockSession(token) {
    window.SupabaseAuth = {
        supabase: {
            auth: {
                getSession: async () => ({
                    data: { session: token ? { access_token: token } : null },
                }),
            },
        },
    };
}

const SUBMISSION = {
    title: 'Blue Moon of Kentucky',
    artist: 'Bill Monroe',
    chordpro: '{meta: title Blue Moon of Kentucky}\n[G]Blue moon',
};

describe('submitToGitHubIssue', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.SupabaseAuth;
    });

    it('sends the session token and no attribution field', async () => {
        mockSession('user-jwt');
        const fetchMock = vi.fn(async () => ({
            ok: true, json: async () => ({ success: true, issueNumber: 12, issueUrl: 'https://x/12' }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        await submitToGitHubIssue(SUBMISSION);

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/functions/v1/create-song-issue');
        expect(init.headers.Authorization).toBe('Bearer user-jwt');

        const body = JSON.parse(init.body);
        expect(body.type).toBe('submission');
        expect(body.title).toBe('Blue Moon of Kentucky');
        expect(body.submittedBy).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('Rando');
    });

    it('never posts without a session', async () => {
        mockSession(null);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(submitToGitHubIssue(SUBMISSION)).rejects.toThrow(/Sign in/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never posts when the auth module has not loaded', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(submitToGitHubIssue(SUBMISSION)).rejects.toThrow(/Sign in/);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
