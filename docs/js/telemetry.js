// Telemetry gate: may this page load write visit counts and analytics events?
//
// Only the production site may. The Supabase URL is the production one
// everywhere (supabase-auth.js), so a local ./scripts/server, a tailnet phone
// test, Playwright and headless crawlers all wrote to the live tables — and
// every one of them starts with empty localStorage, so each page load counted
// as a brand-new visitor. In Oct 2026 that was most of the home page's
// "visitors" (E2E runs alone added ~300 a minute).

export const PRODUCTION_HOSTS = ['bluegrassbook.com', 'www.bluegrassbook.com'];

// The maintainer's own browsers: `/?internal=1` marks one (`?internal=0`
// unmarks it). Per browser, so clearing site data unmarks it too.
export const INTERNAL_KEY = 'bgb-internal';

function isInternal(storage = globalThis.localStorage) {
    try { return storage?.getItem(INTERNAL_KEY) === '1'; } catch { return false; }
}

/**
 * True only on the production host, in a browser not driven by automation
 * (`navigator.webdriver`: Playwright, Puppeteer, most headless crawlers) and
 * not marked internal.
 */
export function telemetryEnabled({
    hostname = globalThis.location?.hostname,
    webdriver = globalThis.navigator?.webdriver,
    internal = isInternal(),
} = {}) {
    return PRODUCTION_HOSTS.includes(hostname) && !webdriver && !internal;
}

/**
 * Read `?internal=1|0` off the URL: mark or unmark this browser, then drop the
 * parameter so it isn't bookmarked or shared. Returns the new state (true /
 * false), or null when the URL didn't ask. Must run before telemetry starts.
 */
export function applyInternalParam({
    location = globalThis.location,
    history = globalThis.history,
    storage = globalThis.localStorage,
} = {}) {
    const url = new URL(location.href);
    const value = url.searchParams.get('internal');
    if (value !== '1' && value !== '0') return null;
    try {
        if (value === '1') storage.setItem(INTERNAL_KEY, '1');
        else storage.removeItem(INTERNAL_KEY);
    } catch { return null; }
    url.searchParams.delete('internal');
    history?.replaceState(history.state, '', url.pathname + url.search + url.hash);
    return value === '1';
}
