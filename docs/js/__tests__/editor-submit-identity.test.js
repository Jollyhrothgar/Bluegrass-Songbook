// @vitest-environment jsdom
//
// Phase 2a: a song submission carries NO client-supplied identity — the
// session token is the attribution, derived server-side from the JWT.
//
// Phase 2b: there is now exactly ONE submission path. The untrusted branch
// that opened a GitHub issue (`create-song-issue`) is gone, so what these
// tests used to assert about the issue flow is asserted here about the
// unified path instead: everyone's submission goes to `pending_songs` and
// then to `auto-commit-song`, and nothing in the editor talks to
// create-song-issue any more.
//
// Phase 2c: `ownsContent` is the client's (deliberately conservative) guess
// at whether an edit is of your own chart. Missing provenance means "not
// yours", so the user is warned about the fork rather than surprised by it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ownsContent, triggerAutoCommit } from '../editor.js';

const EDITOR_SOURCE = readFileSync(resolve(__dirname, '../editor.js'), 'utf-8');

const ENTRY = {
    id: 'blue-moon-of-kentucky',
    title: 'Blue Moon of Kentucky',
    artist: 'Bill Monroe',
    content: '{meta: title Blue Moon of Kentucky}\n[G]Blue moon',
};

function mockSession(token, user) {
    window.SupabaseAuth = {
        supabase: {
            auth: {
                getSession: async () => ({
                    data: { session: token ? { access_token: token } : null },
                }),
            },
        },
        getUser: () => user || null,
    };
}

describe('the one submission path', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.SupabaseAuth;
    });

    it('sends the session token and no attribution field', async () => {
        mockSession('user-jwt');
        const fetchMock = vi.fn(async () => ({
            ok: true, status: 200, json: async () => ({ success: true, mode: 'create' }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        await triggerAutoCommit(ENTRY);

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/functions/v1/auto-commit-song');
        expect(init.headers.Authorization).toBe('Bearer user-jwt');

        const body = JSON.parse(init.body);
        expect(body.title).toBe('Blue Moon of Kentucky');
        expect(body.submittedBy).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('Rando');
    });

    it('never posts without a session', async () => {
        mockSession(null);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(triggerAutoCommit(ENTRY)).rejects.toThrow(/session/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("hands back the server's classification", async () => {
        mockSession('user-jwt');
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, mode: 'fork', workId: 'blue-moon-of-kentucky' }),
        })));

        const result = await triggerAutoCommit(ENTRY);
        expect(result.mode).toBe('fork');
        expect(result.workId).toBe('blue-moon-of-kentucky');
    });

    it('has no create-song-issue caller left in the editor', () => {
        expect(EDITOR_SOURCE).not.toContain('create-song-issue');
        expect(EDITOR_SOURCE).not.toContain('submitToGitHubIssue');
    });

    it('does not branch submission on trusted status', () => {
        // Trust decides in-place edit rights server-side; it must not decide
        // which endpoint the browser talks to, or how fast a submission lands.
        //
        // Phase 3b reads trust in the editor for exactly one thing: whether
        // the dedup offramp offers "promote it" when the matched work is
        // archived. Promotion genuinely is trusted-only (RLS enforces it), and
        // offering a button that 403s is worse than not offering it. So the
        // rule is asserted where it matters — the submission path itself —
        // rather than by banning the symbol from the file.
        const submitPath = EDITOR_SOURCE.slice(
            EDITOR_SOURCE.indexOf('async function submitSong'));
        expect(submitPath).not.toContain('isTrustedUser');
        expect(submitPath).not.toContain('trusted');

        // And only the offramp may read it, once.
        expect(EDITOR_SOURCE.match(/isTrustedUser/g)).toHaveLength(1);
    });
});

describe('ownsContent', () => {
    afterEach(() => {
        delete window.SupabaseAuth;
    });

    it('is false when nobody is signed in', () => {
        mockSession('tok', null);
        expect(ownsContent({ id: 'x', created_by: 'user-1' })).toBe(false);
    });

    it('is true for a live pending row you created', () => {
        mockSession('tok', { id: 'user-1' });
        expect(ownsContent({ id: 'x', created_by: 'user-1' })).toBe(true);
    });

    it('is true for a committed work whose lead sheet you submitted', () => {
        mockSession('tok', { id: 'user-1' });
        expect(ownsContent({ id: 'x', submitted_by: 'user-1' })).toBe(true);
    });

    it("is false for someone else's content", () => {
        mockSession('tok', { id: 'user-1' });
        expect(ownsContent({ id: 'x', submitted_by: 'user-2' })).toBe(false);
    });

    it('treats missing provenance as not-owned', () => {
        mockSession('tok', { id: 'user-1' });
        expect(ownsContent({ id: 'x' })).toBe(false);
        expect(ownsContent(null)).toBe(false);
    });
});
