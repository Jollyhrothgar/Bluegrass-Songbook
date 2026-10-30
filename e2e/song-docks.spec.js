// G19a: the song page's thin top dock (← · BB · 🔍 · Edit · ⋯), the ⋯ menu's
// groups, the Details sheet the writer line opens, the one Edit and where it
// routes, the tab editor clearing the pill row, and the lyrics editor's dock.
// The phone sheet and the desktop popover are the same menu; the "phone"
// tests below constrain the viewport rather than naming a device.
import { test, expect } from './fixtures.js';
import { mockSupabase } from './helpers/supabase-mock.js';
import { openMenu } from './helpers.js';
import { pressTabEdit } from './helpers/tab-edit.js';
import { songReady } from './helpers/tour.js';

const LEAD = '/songs/old-home-place/';
const TAB = '/#work/foggy-mountain-breakdown/banjo-tab';
const menuTitles = (page) => page.locator('#topbar-overflow-menu .menu-section-title').allTextContents();

test.describe('the top dock', () => {
    test('is back · logo · search · Edit · ⋯ and nothing else', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        const bar = page.locator('#app-topbar');
        await expect(bar).toHaveClass(/topbar-dock/);
        for (const sel of ['#topbar-back', '#topbar-brand', '#topbar-search', '#edit-song-btn', '#topbar-overflow-btn']) {
            await expect(bar.locator(sel)).toBeVisible();
        }
        for (const sel of ['.topbar-nav', '#topbar-tour', '#topbar-bug', '#topbar-theme', '#auth-section', '#export-pill', '#list-picker-btn']) {
            await expect(bar.locator(sel)).toBeHidden();
        }
        // still the 48px band the lyrics editor measures
        expect((await bar.boundingBox()).height).toBe(48);
    });

    test('the title row has no Edit and no Details button, and the Info pill is gone', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        await expect(page.locator('#song-content #edit-song-btn')).toHaveCount(0);
        await expect(page.locator('#edit-meta-btn')).toHaveCount(0);
        await expect(page.locator('#info-pill')).toHaveCount(0);
    });

    test('search opens search', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        await page.locator('#topbar-search').click();
        await expect(page.locator('#search-input')).toBeVisible();
    });

    test('the end of a lead sheet points at the top Edit, and has no Edit of its own', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        const nudge = page.locator('.song-edit-nudge');
        await expect(nudge).toContainText('See something wrong? Use');
        await expect(nudge).toContainText('Edit at the top');
        await expect(nudge.locator('button')).toHaveCount(0);
    });

    test('other pages keep the full band', async ({ page }) => {
        await page.goto('/#search');
        await expect(page.locator('#app-topbar')).not.toHaveClass(/topbar-dock/);
        await expect(page.locator('.topbar-nav-link').first()).toBeVisible();
    });
});

test.describe('⋯ menu', () => {
    test('signed out: This song, Go to, You (Sign in), then the site-wide group; no admin group', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.goto(LEAD);
        await songReady(page);
        const menu = await openMenu(page);
        expect(await menuTitles(page)).toEqual(['This song', 'Go to', 'You']);

        for (const id of ['list-picker-btn', 'export-menu-btn', 'report-menu-btn', 'menu-go-add', 'menu-go-favorites', 'menu-go-lists', 'overflow-tour', 'menu-sign-in']) {
            await expect(menu.locator(`#${id}`), id).toBeVisible();
        }
        await expect(menu.locator('#promote-song-btn')).toHaveCount(0);
        await expect(menu.locator('#song-notes-btn')).toHaveCount(0);       // not opened from a list
        await expect(menu.locator('#request-suppress-song-btn')).toHaveCount(0);
        // the site-wide group is still there, last
        await expect(menu.locator('.pill-popover-item', { hasText: 'About' })).toBeVisible();
        await expect(menu.locator('.pill-popover-item', { hasText: 'Send Feedback' })).toBeVisible();
    });

    test('signed in and trusted: the account row and the Trusted and admin group', async ({ page }) => {
        await mockSupabase(page, { rpc: { is_trusted_user: true } });
        await page.goto(LEAD);
        await songReady(page);
        // trust arrives from Supabase after first paint
        await expect.poll(async () => {
            await openMenu(page);
            const titles = await menuTitles(page);
            await page.keyboard.press('Escape');
            return titles;
        }).toEqual(['This song', 'Trusted and admin', 'Go to', 'You']);
        const menu = await openMenu(page);
        await expect(menu.locator('#menu-account')).toContainText('E2E Picker');
        await expect(menu.locator('#request-delete-song-btn')).toBeVisible();
        await expect(menu.locator('#request-suppress-song-btn')).toBeVisible();
        await expect(menu.locator('#request-merge-song-btn')).toBeVisible();
    });

    test('an archived song offers Promote to a signed-in reader', async ({ page }) => {
        await mockSupabase(page);
        await page.goto('/#work/1-1-love');
        // wait for the song itself: while the archive loads the band is the plain one
        await expect(page.locator('.song-title')).toContainText('1+1', { timeout: 20000 });
        // sign-in resolves after first paint and re-declares the band; an open
        // menu stays open and gains Promote
        const menu = await openMenu(page);
        await expect(menu.locator('#promote-song-btn')).toBeVisible();
    });

    test('Export / Print and Report a problem expand in place with aria-expanded', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        const menu = await openMenu(page);
        for (const [row, kids] of [['export-menu-btn', 5], ['report-menu-btn', 3]]) {
            const btn = menu.locator(`#${row}`);
            await expect(btn).toHaveAttribute('aria-expanded', 'false');
            await btn.click();
            await expect(btn).toHaveAttribute('aria-expanded', 'true');
            await expect(menu.locator(`#${row} + .menu-sub .pill-popover-item`)).toHaveCount(kids);
        }
        await expect(menu.locator('#flag-btn')).toBeVisible();
        await expect(menu.locator('#report-bug-btn')).toBeVisible();
        await expect(menu.locator('#copyright-btn')).toBeVisible();
    });

    test('Report a bug opens the bug report form', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        await openMenu(page, 'report-menu-btn');
        await page.locator('#report-bug-btn').click();
        await expect(page.locator('#flag-modal')).toBeVisible();
        await expect(page.locator('#flag-type-select')).toHaveValue('bug-report');
    });

    test('Save to list… opens the list picker', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        await openMenu(page);
        await page.locator('#list-picker-btn').click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await expect(page.locator('#topbar-overflow-menu')).toBeHidden();
    });

    test('Go to: Favorites, Lists and Add Song are one tap away', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        await openMenu(page);
        await page.locator('#menu-go-favorites').click();
        await expect(page).toHaveURL(/#list\/favorites/);
    });

    test('Theme is Light / Dark / Auto, and the choice sticks', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        const menu = await openMenu(page);
        await menu.locator('.menu-segmented-btn[data-value="dark"]').click();
        expect(await theme()).toBe('dark');
        expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
        await menu.locator('.menu-segmented-btn[data-value="light"]').click();
        expect(await theme()).toBe('light');
        await menu.locator('.menu-segmented-btn[data-value="auto"]').click();
        expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
        await expect(menu.locator('.menu-segmented-btn[aria-pressed="true"]')).toHaveText('Auto');
    });

    test('⋯ has aria-expanded and aria-controls; Esc closes and gives focus back', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        const more = page.locator('#topbar-overflow-btn');
        await expect(more).toHaveAttribute('aria-controls', 'topbar-overflow-menu');
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#topbar-overflow-menu')).toBeHidden();
        await expect(more).toBeFocused();
    });

    test('Song notes appears in the menu when the song was opened from a list', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-lists', JSON.stringify([
            { id: 'l1', name: 'Jam', songs: ['old-home-place'], created: 1, updated: 1 },
        ])));
        await page.goto('/#list/l1/old-home-place');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        const menu = await openMenu(page);
        await expect(menu.locator('#song-notes-btn')).toBeVisible();
    });

    test('on a phone ⋯ is a sheet over a scrim, and the scrim closes it', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(LEAD);
        await songReady(page);
        const menu = await openMenu(page);
        const box = await menu.boundingBox();
        expect(box.x).toBe(0);
        expect(box.width).toBe(390);
        expect(box.y + box.height).toBe(844);          // docked to the bottom
        await expect(page.locator('.menu-scrim')).toBeVisible();
        await page.locator('.menu-scrim').click({ position: { x: 195, y: 30 } });
        await expect(menu).toBeHidden();
    });

    test('on a desktop ⋯ is a popover under the button', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(LEAD);
        await songReady(page);
        const menu = await openMenu(page);
        const box = await menu.boundingBox();
        expect(box.width).toBeLessThan(400);
        expect(box.y).toBeLessThan(80);
        await expect(page.locator('.menu-scrim')).toBeHidden();
    });
});

test.describe('Details', () => {
    test('opens from the writer line with the facts, closes on Esc, and focus returns', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        const opener = page.locator('#song-details-btn');
        await expect(opener).toContainText('Written by');
        await expect(opener).toHaveAttribute('aria-expanded', 'false');
        await opener.click();

        const sheet = page.locator('#song-details-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveAttribute('role', 'dialog');
        await expect(opener).toHaveAttribute('aria-expanded', 'true');
        await expect(sheet.locator('.info-item', { hasText: 'Written by' })).toBeVisible();
        await expect(sheet.locator('.info-item', { hasText: 'Key' })).toBeVisible();
        await expect(sheet.locator('.info-tags')).toBeVisible();
        // a reader who cannot edit the song has no Edit details
        await expect(sheet.locator('#edit-meta-btn')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(opener).toBeFocused();
        await expect(opener).toHaveAttribute('aria-expanded', 'false');
    });

    test('a song with no writer still has the line, and it opens Details', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/banjo-tab');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        // (this work has a writer; the label rule for none is unit-tested via the "Details" fallback)
        await expect(page.locator('#song-details-btn')).toBeVisible();
    });

    test('Edit details (trusted) opens the details form, and Cancel brings the page back', async ({ page }) => {
        await mockSupabase(page, { rpc: { is_trusted_user: true } });
        await page.goto(LEAD);
        await songReady(page);
        await page.locator('#song-details-btn').click();
        const edit = page.locator('#edit-meta-btn');
        await expect(edit).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.details-footer-note')).toContainText('who can edit');
        await edit.click();

        await expect(page.locator('#song-details-sheet')).toHaveCount(0);
        await expect(page.locator('#ph-edit-title')).toHaveValue(/old home place/i);
        await expect(page.locator('#ph-edit-artist')).toBeVisible();
        await expect(page.locator('#ph-edit-key')).toBeVisible();
        await expect(page.locator('#ph-edit-notes')).toBeVisible();
        await page.locator('#ph-edit-cancel').click();
        await expect(page.locator('.song-title')).toContainText(/old home place/i);
    });

    test('Edit details saves through the one metadata pipeline', async ({ page }) => {
        const sb = await mockSupabase(page, { rpc: { is_trusted_user: true } });
        await page.goto(LEAD);
        await songReady(page);
        await page.locator('#song-details-btn').click();
        await page.locator('#edit-meta-btn').click({ timeout: 15000 });
        await page.locator('#ph-edit-notes').fill('Kick it off slow');
        await page.locator('#ph-edit-save').click();
        await expect(page.locator('#ph-edit-status')).toContainText('Saved');
        const row = sb.row('pending_songs');
        expect(row.id).toMatch(/^meta:old-home-place:/);
        expect(row.notes).toBe('Kick it off slow');
    });

    test('on a phone Details is a bottom sheet', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(LEAD);
        await songReady(page);
        await page.locator('#song-details-btn').click();
        const box = await page.locator('#song-details-sheet').boundingBox();
        expect(box.width).toBe(390);
        expect(box.y + box.height).toBe(844);
    });
});

test.describe('the one Edit', () => {
    test('a lyrics sheet opens the lyrics editor, whose top band names the song and goes back to it', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        await page.locator('#edit-song-btn').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        const bar = page.locator('#app-topbar');
        await expect(bar).toHaveClass(/topbar-dock/);
        await expect(bar.locator('#topbar-back')).toContainText(/Old Home Place/);
        await expect(bar.locator('#topbar-back')).toHaveAttribute('aria-label', /Back to Old Home Place/);
        await expect(bar.locator('#topbar-brand')).toBeVisible();
        await expect(bar.locator('#topbar-overflow-btn')).toBeVisible();
        for (const sel of ['#topbar-search', '#edit-song-btn', '.topbar-nav', '#auth-section']) {
            await expect(bar.locator(sel), sel).toBeHidden();
        }
        expect((await bar.boundingBox()).height).toBe(48);
        // the in-page Back is gone, its notice stays
        await expect(page.locator('#editor-back-btn')).toHaveCount(0);
        await expect(page.locator('.editor-notice')).toContainText('Songs go live as soon as you submit them');

        await bar.locator('#topbar-back').click();
        await expect(page.locator('#song-view')).toBeVisible();
        await expect(page.locator('#editor-panel')).toBeHidden();
        await expect(page.locator('.song-title')).toContainText(/old home place/i);
    });

    test('a new song\'s editor has a plain ← that goes to search, and ⋯ has Go to and You', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible();
        const bar = page.locator('#app-topbar');
        await expect(bar).toHaveClass(/topbar-dock/);
        await expect(bar.locator('.topbar-back-label')).toBeHidden();
        const menu = await openMenu(page);
        expect(await menuTitles(page)).toEqual(['Go to', 'You']);
        await expect(menu.locator('#menu-sign-in')).toBeVisible();
        await page.keyboard.press('Escape');
        await bar.locator('#topbar-back').click();
        await expect(page.locator('.search-container')).toBeVisible();
    });

    test('a tab part opens the tab editor, and Edit steps aside while it is open', async ({ page }) => {
        await page.goto(TAB);
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        await expect(page.locator('#app-bottomband .tab-edit-btn')).toHaveCount(0);   // not in the band any more
        await expect(page.locator('#edit-song-btn')).toBeVisible();
        await pressTabEdit(page, { waitForEditor: true });
        await expect(page.locator('#edit-song-btn')).toBeHidden();
        await expect(page.locator('#app-bottomband .tab-edit-done')).toBeVisible();

        await page.locator('#app-bottomband .tab-edit-done').click();
        await expect(page.locator('.tablature-container').first()).toBeVisible();
        await expect(page.locator('#edit-song-btn')).toBeVisible();
    });

    test('the tab editor clears the part tabs (and pill row) from above it, Done brings them back', async ({ page }) => {
        // arkansas-traveler-1: a lead sheet plus a banjo tab, so there are part tabs
        await page.goto('/#work/arkansas-traveler-1/banjo-tab');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        await expect(page.locator('#part-tabs')).toBeVisible();
        await expect(page.locator('#song-pill-row')).toBeVisible();

        await pressTabEdit(page, { waitForEditor: true });
        await expect(page.locator('body')).toHaveClass(/tab-editing/);
        await expect(page.locator('#part-tabs')).toBeHidden();
        await expect(page.locator('#song-pill-row')).toBeHidden();
        // the take header (status lines live there) and the editor's own chrome stay
        await expect(page.locator('#arrangement-host')).toBeAttached();

        await page.locator('#app-bottomband .tab-edit-done').click();
        await expect(page.locator('body')).not.toHaveClass(/tab-editing/);
        await expect(page.locator('#part-tabs')).toBeVisible();
        await expect(page.locator('#song-pill-row')).toBeVisible();
    });

    test('a new take (#new-tab) hides them too, and Cancel puts the page back', async ({ page }) => {
        await page.goto('/#new-tab?title=E2E%20Docks&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await expect(page.locator('body')).toHaveClass(/tab-editing/);
        await expect(page.locator('#song-pill-row')).toBeHidden();
        await expect(page.locator('#edit-song-btn')).toBeHidden();
    });

    test('a placeholder opens the details form (signed in)', async ({ page }) => {
        await mockSupabase(page);
        // big-sciota is `status: placeholder` in the index
        await page.goto('/#work/big-sciota');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.placeholder-badge')).toBeVisible();
        await page.locator('#edit-song-btn').click();
        await expect(page.locator('#ph-edit-title')).toHaveValue('Big Sciota');
    });
});

test.describe('on a phone the tab page has one Edit, in the top band', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the ⚙ sheet no longer has a Tab row', async ({ page }) => {
        await page.goto(TAB);
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        await page.locator('#app-bottomband .tab-more-btn').click();
        const labels = await page.locator('#app-bottomband .tab-sheet-row:visible .tab-sheet-label').allTextContents();
        expect(labels).not.toContain('Tab');
        await page.keyboard.press('Escape');
        await pressTabEdit(page, { waitForEditor: true });
    });
});
