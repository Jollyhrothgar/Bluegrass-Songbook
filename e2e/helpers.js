// Shared helpers for the e2e suite (post-redesign shell UI).
//
// The app chrome is the slim top band built by docs/js/shell.js:
//   - brand link  #topbar-brand
//   - nav links   .topbar-nav-link[data-nav="search|add|favorites|lists"]
//   - theme       #topbar-theme
//   - overflow    #topbar-overflow-btn / #topbar-overflow-menu
// Song pages add: #topbar-back, #edit-song-btn, #list-picker-btn and the
// Export pill (#export-pill) to the band; the song body renders the pill row
// (#key-pill, #display-pill, #info-pill, #arrangement-pill) and .part-tabs.
import { expect } from '@playwright/test';

/** Go to the search view and wait until the index has loaded (the
 *  post-load render would stomp any navigation done before it). */
export async function gotoSearch(page) {
    await page.goto('/#search');
    await page.waitForSelector('#search-input');
    await expect(page.locator('#search-stats')).toContainText('songs', { timeout: 20000 });
}

/** Type a query (fires input events) and wait for results. */
export async function searchFor(page, query) {
    const input = page.locator('#search-input');
    await input.click();
    await input.fill('');
    await input.pressSequentially(query, { delay: 20 });
    await page.waitForSelector('.result-item', { timeout: 10000 });
}

/** Search and open a result; `match` (RegExp/string) picks the result by its
 *  text — search ranking can put lookalike titles first. Resolves when the
 *  song page is up. */
export async function searchAndOpen(page, query, match = null) {
    await searchFor(page, query);
    const results = page.locator('.result-item');
    const target = match ? results.filter({ hasText: match }).first() : results.first();
    await target.click();
    await expect(page.locator('#song-view')).toBeVisible({ timeout: 10000 });
}

/** Chord elements in the rendered lead sheet. The renderer emits `&nbsp;`
 *  placeholder .cl-chord spans for chordless segments — filter to real ones. */
export function chords(page) {
    return page.locator('.cl-chord').filter({ hasText: /\S/ });
}

/** Click a top-band nav link by its data-nav id (search/add/favorites/lists). */
export async function navClick(page, id) {
    await page.locator(`.topbar-nav-link[data-nav="${id}"]`).click();
}

/** Open a pill's popover (Key / Display / Info / Arrangement / Export). */
export async function openPill(page, pillId) {
    await page.locator(`#${pillId} .pill-btn`).click();
    const popover = page.locator(`#${pillId} .pill-popover`);
    await expect(popover).toBeVisible();
    return popover;
}
