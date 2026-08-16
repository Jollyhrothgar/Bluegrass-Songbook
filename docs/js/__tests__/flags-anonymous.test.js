// @vitest-environment jsdom
// Phase 2a: reporting a problem is anonymous-capable. Flagging is a
// report, not content the reporter comes back looking for — the
// confirmation toast is the complete experience, so the submit path must
// NOT bounce anyone to a sign-in. When a session does exist, its token
// goes out and the edge function derives identity from it; either way the
// client never claims an attribution.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initFlags, openFeedbackModal } from '../flags.js';

function mountModal() {
    document.body.innerHTML = `
        <div id="flag-modal" class="modal hidden">
            <h2 id="flag-modal-title"></h2>
            <button id="flag-modal-close"></button>
            <select id="flag-type-select"></select>
            <p id="flag-song-context" class="hidden"></p>
            <div id="flag-song-section"><div id="flag-options"></div></div>
            <div id="flag-correction-section" class="hidden">
                <button id="flag-correction-edit-btn"></button>
            </div>
            <label id="flag-description-label"></label>
            <textarea id="flag-description"></textarea>
            <button id="flag-cancel"></button>
            <button id="flag-submit"></button>
        </div>
        <div id="flag-toast" class="toast hidden"></div>
    `;
}

/** Click Submit and let the async handler settle. */
async function clickSubmit() {
    document.getElementById('flag-submit').click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
}

const okFetch = () => vi.fn(async () => ({
    ok: true, json: async () => ({ success: true, issueNumber: 42, issueUrl: 'https://x/42' }),
}));

describe('anonymous feedback', () => {
    beforeEach(() => {
        mountModal();
        initFlags();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.SupabaseAuth;
        document.body.innerHTML = '';
    });

    it('submits with no session and never triggers sign-in', async () => {
        const signIn = vi.fn();
        window.SupabaseAuth = { isLoggedIn: () => false, signInWithGoogle: signIn };
        const fetchMock = okFetch();
        vi.stubGlobal('fetch', fetchMock);

        openFeedbackModal({ type: 'general-feedback' });
        document.getElementById('flag-description').value = 'the search box eats my typing';
        await clickSubmit();

        expect(signIn).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledOnce();

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/functions/v1/create-flag-issue');
        // Anonymous callers present the project anon key, which the edge
        // function resolves to "no user" — that IS the anonymous case.
        expect(init.headers.Authorization).toMatch(/^Bearer eyJ/);

        const body = JSON.parse(init.body);
        expect(body.flagType).toBe('general-feedback');
        expect(body.description).toBe('the search box eats my typing');
        expect(body.submittedBy).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('Rando');

        expect(document.getElementById('flag-toast').textContent).toMatch(/Thanks/);
        expect(document.getElementById('flag-modal').classList.contains('hidden')).toBe(true);
    });

    it('sends the session token when the reporter is signed in', async () => {
        window.SupabaseAuth = {
            isLoggedIn: () => true,
            supabase: {
                auth: { getSession: async () => ({ data: { session: { access_token: 'user-jwt' } } }) },
            },
        };
        const fetchMock = okFetch();
        vi.stubGlobal('fetch', fetchMock);

        openFeedbackModal({ type: 'general-feedback' });
        document.getElementById('flag-description').value = 'nice app';
        await clickSubmit();

        const [, init] = fetchMock.mock.calls[0];
        expect(init.headers.Authorization).toBe('Bearer user-jwt');
        expect(JSON.parse(init.body).submittedBy).toBeUndefined();
    });
});
