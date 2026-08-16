// @vitest-environment jsdom
// Phase 2a: requesting a song does not require an account. Anonymous
// requests are report-shaped — the edge function answers mode:'issue' and
// there is no placeholder work to navigate to, so the confirmation IS the
// experience. Signed-in requests still mint a placeholder and land on it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initAddSongPicker, openAddSongPicker } from '../add-song-picker.js';

function mountPicker() {
    document.body.innerHTML = `
        <div id="add-song-picker" class="modal hidden">
            <h2 id="picker-header-title"></h2>
            <button id="add-song-picker-close"></button>
            <div class="picker-cards">
                <button class="picker-card picker-card-request" data-type="request"></button>
            </div>
            <div class="picker-request-form hidden">
                <button class="picker-back-btn"></button>
                <input id="picker-req-title" type="text">
                <input id="picker-req-artist" type="text">
                <select id="picker-req-key"><option value=""></option></select>
                <textarea id="picker-req-notes"></textarea>
                <div id="picker-dedup-warning" class="hidden"></div>
                <button id="picker-req-submit" disabled></button>
                <span id="picker-req-status"></span>
            </div>
        </div>
    `;
}

async function submitRequest(title) {
    openAddSongPicker({ mode: 'request' });
    const titleEl = document.getElementById('picker-req-title');
    titleEl.value = title;
    titleEl.dispatchEvent(new Event('input'));
    document.getElementById('picker-req-submit').click();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
}

describe('song request', () => {
    beforeEach(() => {
        mountPicker();
        initAddSongPicker({ onUpload: () => {}, onChordPro: () => {} });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.SupabaseAuth;
        delete window.refreshPendingSongs;
        document.body.innerHTML = '';
    });

    it('goes through anonymously with the anon key', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({ success: true, id: 'lost-song', mode: 'issue', issueNumber: 9 }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        await submitRequest('Lost Song');

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/functions/v1/create-song-request');
        expect(init.headers.Authorization).toMatch(/^Bearer eyJ/);
        expect(JSON.parse(init.body).title).toBe('Lost Song');

        // Report-shaped: a confirmation, and no navigation to a work that
        // was never created.
        expect(document.getElementById('picker-req-status').textContent).toMatch(/Thanks/);
        expect(window.location.hash).toBe('');
    });

    it('sends the session token when the requester is signed in', async () => {
        window.SupabaseAuth = {
            supabase: {
                auth: { getSession: async () => ({ data: { session: { access_token: 'user-jwt' } } }) },
            },
        };
        window.refreshPendingSongs = vi.fn(async () => {});
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ success: true, id: 'lost-song', mode: 'placeholder' }),
        })));

        await submitRequest('Lost Song');

        const [, init] = globalThis.fetch.mock.calls[0];
        expect(init.headers.Authorization).toBe('Bearer user-jwt');
        expect(document.getElementById('picker-req-status').textContent).toMatch(/submitted/i);
        expect(window.refreshPendingSongs).toHaveBeenCalled();
    });
});
