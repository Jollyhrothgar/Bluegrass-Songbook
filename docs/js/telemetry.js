// Telemetry gate: may this page load write visit counts and analytics events?
//
// Only the production site may. The Supabase URL is the production one
// everywhere (supabase-auth.js), so a local ./scripts/server, a tailnet phone
// test, Playwright and headless crawlers all wrote to the live tables — and
// every one of them starts with empty localStorage, so each page load counted
// as a brand-new visitor. In Oct 2026 that was most of the home page's
// "visitors" (E2E runs alone added ~300 a minute).

export const PRODUCTION_HOSTS = ['bluegrassbook.com', 'www.bluegrassbook.com'];

/**
 * True only on the production host, in a browser not driven by automation
 * (`navigator.webdriver`: Playwright, Puppeteer, most headless crawlers).
 */
export function telemetryEnabled({
    hostname = globalThis.location?.hostname,
    webdriver = globalThis.navigator?.webdriver,
} = {}) {
    return PRODUCTION_HOSTS.includes(hostname) && !webdriver;
}
