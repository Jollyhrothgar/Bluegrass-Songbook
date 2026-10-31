// Shared helpers for the e2e suite (post-redesign shell UI).
//
// The app chrome is the slim top band built by docs/js/shell.js:
//   - brand link  #topbar-brand
//   - nav links   .topbar-nav-link[data-nav="search|add|favorites|lists"]
//   - theme       #topbar-theme
//   - overflow    #topbar-overflow-btn / #topbar-overflow-menu
// Song pages have the thin top dock: #topbar-back, #topbar-search, the one
// Edit (#edit-song-btn) and ⋯. Everything else is in ⋯ (see openMenu below):
// Save to list (#list-picker-btn), Export / Print (#export-menu-btn), Report a
// problem (#report-menu-btn), Take the tour (#overflow-tour). The song body has
// the writer line (#song-details-btn) that opens the Details sheet; the
// controls are the reading dock in the bottom band (G19b): Key (#dock-key-btn),
// Size (#dock-size), View (#dock-view segments, or #dock-view-btn for a sheet)
// and Display (#dock-display-btn). `openDock` opens one of their sheets.
import { expect } from '@playwright/test';

/** Go to the search view and wait until the index has loaded.
 *
 *  The count must be NONZERO: the search view paints "0 songs" whenever it
 *  renders against an empty corpus, so a bare 'songs' match let tests sail
 *  past a still-loading boot and race whatever the boot tail does next. */
export async function gotoSearch(page) {
    await page.goto('/#search');
    await page.waitForSelector('#search-input');
    await expect(page.locator('#search-stats')).toContainText(/[1-9][\d,]*\s+songs?\b/, { timeout: 20000 });
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

/** Open one of the reading dock's sheets: 'key', 'display' or 'view' (View ▾, a song with versions or tabs).
 *  Returns the sheet; it is modal, so close it with `closeSheet` before touching the page. */
export async function openDock(page, which) {
    const sheet = page.locator(which === 'view' ? '#song-view-sheet' : `#dock-${which}-sheet`);
    await page.locator(`#dock-${which}-btn`).click();
    await expect(sheet).toBeVisible();
    return sheet;
}

/** Close the open dock sheet (Esc), and wait for it to go. */
export async function closeSheet(page) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.dock-sheet')).toHaveCount(0);
}

/** The key the dock's Key button shows: "A" from "Key: A". */
export async function dockKey(page) {
    return ((await page.locator('#dock-key-btn').textContent()) || '').replace(/^Key:\s*/, '').trim();
}

/** Open a pill's popover (the list export pill; the song page's pills are the dock now). */
export async function openPill(page, pillId) {
    await page.locator(`#${pillId} .pill-btn`).click();
    const popover = page.locator(`#${pillId} .pill-popover`);
    await expect(popover).toBeVisible();
    return popover;
}

/** Open the top band's ⋯ menu; `expand` opens a row that expands in place
 *  (#export-menu-btn, #report-menu-btn). Returns the menu. */
export async function openMenu(page, expand = null) {
    await page.locator('#topbar-overflow-btn').click();
    const menu = page.locator('#topbar-overflow-menu');
    await expect(menu).toBeVisible();
    if (expand) await page.locator(`#${expand}`).click();
    return menu;
}

/** Go to search from a page with the thin top dock: the song page's 🔍, or the
 *  lyrics editor's ⋯ ▸ Go to ▸ Search (its band has no search icon). */
export async function goToSearch(page) {
    if (await page.locator('#topbar-search').isVisible()) {
        await page.locator('#topbar-search').click();
        return;
    }
    await openMenu(page);
    await page.locator('#menu-go-search').click();
}
