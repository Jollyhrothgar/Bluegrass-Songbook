// A whole Supabase, in the test runner.
//
// The rule this exists to serve: **everything a human can do must be
// reachable by Playwright against a mocked backend.** Submitting a tab,
// submitting a correction, and being asked to sign in are three of the most
// important things a human does on this site, and until now none of them had
// a test — because all three end in a network call to a real project.
//
// So: `page.route('**/*.supabase.co/**')` answers every one of them, and the
// helper records what it was asked for. The real supabase-js SDK still loads
// (from jsdelivr — it is a `<script>` in index.html, and stubbing it would
// test our stub instead of the app), so the code under test is the code that
// ships: `supabase.auth.getSession()`, `.from('pending_songs').upsert(…)`,
// `fetch(functions/v1/auto-commit-song)`. Only the far end is fake.
//
// Signing in is faked the way the SDK itself persists a session: a JSON
// blob in `localStorage['sb-<ref>-auth-token']`, seeded by an init script so
// it is there before any page code runs. `getSession()` then answers from
// storage with no network at all, which is exactly what happens for a real
// returning user.
//
// Usage:
//     const sb = await mockSupabase(page);              // signed in
//     const sb = await mockSupabase(page, { signedIn: false });
//     …
//     sb.assertClean();          // nothing unexpected left the browser
//     sb.rows('pending_songs');  // what the app actually wrote

import { expect } from '@playwright/test';

/** The project the app is hard-coded against (submit-tab.js, supabase-auth.js). */
export const SUPABASE_REF = 'ofmqlrnyldlmvggihogt';
export const SUPABASE_URL = `https://${SUPABASE_REF}.supabase.co`;

/** Where supabase-js parks the session. */
export const AUTH_STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`;

export const FAKE_USER = {
    id: '3f3f3f3f-1111-4222-8333-444444444444',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'picker@e2e.test',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    phone: '',
    confirmed_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: {
        name: 'E2E Picker',
        full_name: 'E2E Picker',
        avatar_url: '',
        email: 'picker@e2e.test',
    },
    identities: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
};

/** Hosts the browser is allowed to talk to for real. */
const ALLOWED_HOSTS = [/^localhost$/, /^127\.0\.0\.1$/, /(^|\.)jsdelivr\.net$/];

/**
 * Third-party fetches these tests neither need nor assert, blocked so a run
 * is hermetic: Google Analytics (fires on every page load) and WebAudioFont
 * (the soundfont the tab player streams — no test here listens to anything,
 * and the sandbox blocks that CDN anyway).
 */
const BLOCKED = /google-analytics\.com|googletagmanager\.com|analytics\.google\.com|surikov\.github\.io/;

const b64url = (obj) => Buffer.from(JSON.stringify(obj))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * A JWT the SDK will accept at face value.
 *
 * Not signed with anything real — nothing in the browser verifies it, and
 * the mocked server is us. It has to *parse*, though: some supabase-js
 * versions read `exp` out of the token rather than trusting `expires_at`,
 * and an unparseable token there is an immediate forced refresh.
 */
export function fakeJwt(user = FAKE_USER, expiresAt) {
    const header = b64url({ alg: 'HS256', typ: 'JWT' });
    const payload = b64url({
        sub: user.id,
        email: user.email,
        aud: 'authenticated',
        role: 'authenticated',
        iss: `${SUPABASE_URL}/auth/v1`,
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: expiresAt,
    });
    return `${header}.${payload}.e2e-not-a-real-signature`;
}

/** The session blob, in the shape the SDK writes and reads. */
export function fakeSession(user = FAKE_USER) {
    // Far future: `getSession()` refreshes anything within 30s of expiry,
    // and a refresh round trip is a race no test needs.
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 3600;
    return {
        access_token: fakeJwt(user, expiresAt),
        token_type: 'bearer',
        expires_in: 24 * 3600,
        expires_at: expiresAt,
        refresh_token: 'e2e-refresh-token',
        user,
    };
}

/** The HTML the mocked OAuth endpoint serves — the "login gate" a test sees. */
const OAUTH_GATE_HTML = `<!doctype html><html><head><title>Sign in</title></head>
<body><main id="e2e-oauth-gate"><h1>Sign in to continue</h1>
<p>The mocked Google OAuth hand-off. A real browser would be at
accounts.google.com by now.</p></main></body></html>`;

/**
 * Route every Supabase call to an in-test fake.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} [options]
 * @param {boolean} [options.signedIn=true] - seed a session in localStorage
 * @param {Object} [options.user=FAKE_USER]
 * @param {Object} [options.rpc] - `{name: value}` results for `rpc/<name>`
 * @param {Object} [options.commit] - body for `functions/v1/auto-commit-song`
 * @param {Object} [options.tables] - `{table: rows}` seed for GET /rest/v1
 * @returns {Promise<Object>} the mock handle (see the methods at the bottom)
 */
export async function mockSupabase(page, {
    signedIn = true,
    user = FAKE_USER,
    rpc = {},
    commit = { success: true, mode: 'create', workId: 'e2e-mocked-work' },
    tables = {},
} = {}) {
    const session = fakeSession(user);

    const state = {
        /** Everything the route handler answered, newest last. */
        calls: [],
        /** Rows the app WROTE, per table. */
        written: {},
        /** Supabase paths the mock did not recognise — a test failure. */
        unhandled: [],
        /** Requests that tried to leave for a host we don't allow. */
        external: [],
        /** What a GET returns, per table: seeded, plus whatever was written. */
        tables: { ...tables },
        commit: { ...commit },
        rpc: {
            is_trusted_user: false,
            is_admin: false,
            log_events: null,
            log_visit: null,
            ...rpc,
        },
    };

    if (signedIn) {
        await page.addInitScript(([key, value]) => {
            window.localStorage.setItem(key, value);
        }, [AUTH_STORAGE_KEY, JSON.stringify(session)]);
    }

    // A watcher, not a gate: page.route below answers everything, so this
    // only ever fires for a host we forgot. `assertClean()` reads it.
    page.on('request', (request) => {
        const host = new URL(request.url()).hostname;
        if (ALLOWED_HOSTS.some(re => re.test(host))) return;
        if (host.endsWith('supabase.co')) return;   // routed below
        if (BLOCKED.test(request.url())) return;    // aborted below
        state.external.push(request.url());
    });

    await page.route(BLOCKED, route => route.abort());

    await page.route('**/*.supabase.co/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const method = request.method();
        const json = (body, status = 200, headers = {}) => route.fulfill({
            status,
            contentType: 'application/json',
            headers,
            body: JSON.stringify(body),
        });
        state.calls.push(`${method} ${path}${url.search}`);

        // ── auth ──────────────────────────────────────────────────────
        if (path === '/auth/v1/authorize') {
            // signInWithOAuth navigates here. In the app this is the point
            // of no return — the "login gate" an anonymous contributor sees.
            return route.fulfill({
                status: 200, contentType: 'text/html', body: OAUTH_GATE_HTML,
            });
        }
        if (path === '/auth/v1/user') {
            return signedIn ? json({ user }) : json({ message: 'not logged in' }, 401);
        }
        if (path === '/auth/v1/token') {
            return signedIn
                ? json(session)
                : json({ error: 'invalid_grant' }, 400);
        }
        if (path === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
        if (path.startsWith('/auth/v1/')) return json({});

        // ── edge functions ────────────────────────────────────────────
        if (path === '/functions/v1/auto-commit-song') {
            return json(state.commit);
        }
        if (path.startsWith('/functions/v1/')) return json({ success: true });

        // ── rpc ───────────────────────────────────────────────────────
        if (path.startsWith('/rest/v1/rpc/')) {
            const name = path.slice('/rest/v1/rpc/'.length);
            return json(state.rpc[name] ?? null);
        }

        // ── tables ────────────────────────────────────────────────────
        if (path.startsWith('/rest/v1/')) {
            const table = path.slice('/rest/v1/'.length);
            if (method === 'GET') return json(state.tables[table] || []);
            if (method === 'DELETE') return json([], 200);
            // POST (insert/upsert) and PATCH (update): keep what was
            // written so a test can assert on the row rather than on a
            // status code. `part_type`, `instrument` and `content` are the
            // three columns that make a pending row a TAB (submit-tab.js).
            let body = null;
            try { body = JSON.parse(request.postData() || 'null'); } catch { /* not json */ }
            const rows = Array.isArray(body) ? body : (body ? [body] : []);
            (state.written[table] ||= []).push(...rows);
            state.tables[table] = [...(state.tables[table] || []), ...rows];
            return json(rows, 201);
        }

        state.unhandled.push(`${method} ${path}`);
        return json({ error: `e2e supabase mock has no route for ${path}` }, 501);
    });

    return {
        state,
        session,
        user,
        /** Rows the app wrote to `table`. */
        rows: (table) => state.written[table] || [],
        /** The single row the app wrote to `table` (fails if not exactly one). */
        row(table) {
            const rows = state.written[table] || [];
            expect(rows, `expected one ${table} write, got ${rows.length}`)
                .toHaveLength(1);
            return rows[0];
        },
        /** Every Supabase path touched, for debugging a surprise. */
        calls: () => [...state.calls],
        /** Change what auto-commit-song answers (per test). */
        setCommit(body) { state.commit = { ...state.commit, ...body }; },
        /** Seed what a GET on `table` returns. */
        setTable(table, rows) { state.tables[table] = rows; },
        /**
         * Nothing reached the real internet, and nothing hit a Supabase path
         * the mock doesn't understand. Both are failures worth naming: the
         * first means a test was quietly talking to production, the second
         * means the app grew a call this helper hasn't been taught.
         */
        assertClean() {
            expect(state.unhandled, 'un-mocked Supabase requests').toEqual([]);
            expect(state.external, 'requests to un-allowed hosts').toEqual([]);
        },
    };
}
