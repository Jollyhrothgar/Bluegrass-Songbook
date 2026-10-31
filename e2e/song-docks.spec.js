// G19a: the song page's thin top dock (← · BB · 🔍 · Edit · ⋯), the ⋯ menu's
// groups, the Details sheet the writer line opens, the one Edit and where it
// routes, the tab editor, and the lyrics editor's dock. The reading dock (G19b)
// is at the end of this file.
// The phone sheet and the desktop popover are the same menu; the "phone"
// tests below constrain the viewport rather than naming a device.
import { test, expect } from './fixtures.js';
import { mockSupabase } from './helpers/supabase-mock.js';
import { openMenu, openDock, closeSheet, serveWithoutTabs } from './helpers.js';
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

    test('while the tab editor is open the band is G17\'s (no View, no Display), and Done brings the dock back', async ({ page }) => {
        // arkansas-traveler-1: a lead sheet plus a banjo tab, so the tab dock has a View ▾
        await page.goto('/#work/arkansas-traveler-1/banjo-tab');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        await expect(page.locator('#app-bottomband #dock-view-btn')).toBeEnabled();

        await pressTabEdit(page, { waitForEditor: true });
        await expect(page.locator('body')).toHaveClass(/tab-editing/);
        await expect(page.locator('#app-bottomband #dock-view-btn, #app-bottomband #dock-display-btn')).toHaveCount(0);
        for (const sel of ['.tab-play-btn', '.tab-stop-btn', '.tab-tempo-display', '.tab-edit-submit', '.tab-edit-done']) {
            await expect(page.locator(`#app-bottomband ${sel}`).first(), sel).toBeVisible();
        }
        // the take header (status lines live there) and the editor's own chrome stay
        await expect(page.locator('#arrangement-host')).toBeAttached();

        await page.locator('#app-bottomband .tab-edit-done').click();
        await expect(page.locator('body')).not.toHaveClass(/tab-editing/);
        await expect(page.locator('#app-bottomband #dock-view-btn')).toBeEnabled();
        await expect(page.locator('#app-bottomband #dock-display-btn')).toBeVisible();
    });

    test('a new take (#new-tab) has Edit stepped aside, and no reading dock', async ({ page }) => {
        await page.goto('/#new-tab?title=E2E%20Docks&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await expect(page.locator('body')).toHaveClass(/tab-editing/);
        await expect(page.locator('#dock-key-btn')).toHaveCount(0);
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

    test('Display has no Edit row; Edit is the top band\'s', async ({ page }) => {
        await page.goto(TAB);
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        const sheet = await openDock(page, 'display');
        await expect(sheet.locator('.tab-edit-btn')).toHaveCount(0);
        await expect(sheet.getByText(/^Edit$/)).toHaveCount(0);
        await closeSheet(page);
        await pressTabEdit(page, { waitForEditor: true });
    });
});

// ── G19b: the reading dock ────────────────────────────────────────────────
// Key · Size · View · Display in the bottom band for a lyric sheet and a
// chart; ▶ · Tempo · Size · View for ABC notation. The part tabs, the pill row,
// the hybrid toggle and the chart's own header are gone. Chart choices, View
// and Auto-hide are covered where they live (chord-chart.spec.js,
// view-versions.spec.js, work-view.spec.js, ui.spec.js).
const ABC = '/#work/arkansas-traveler-1';
const dockFits = async (page, selector) => {
    const box = await page.locator('#app-bottomband').boundingBox();
    const vw = page.viewportSize().width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
    const overflow = await page.evaluate((sel) => {
        const dock = document.querySelector(sel);
        return { sw: dock.scrollWidth, cw: dock.clientWidth,
            kids: [...dock.children].map(k => { const r = k.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }) };
    }, selector);
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
    for (const [l, r] of overflow.kids) {
        expect(l).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(vw);
    }
};

test.describe('the reading dock', () => {
    test.use({ serviceWorkers: 'block' });

    test('the pill row and the part tabs are gone from the page', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        for (const sel of ['#song-pill-row', '#part-tabs', '#key-pill', '#display-pill', '#arrangement-pill', '.view-toggle', '.cc-head']) {
            await expect(page.locator(sel), sel).toHaveCount(0);
        }
    });

    test('wide: Key · Size · View · Display in the bottom band, at its left edge', async ({ page }) => {
        await serveWithoutTabs(page, 'old-home-place');
        await page.goto(LEAD);
        await songReady(page);
        const band = page.locator('#app-bottomband');
        await expect(band).toBeVisible();
        await expect(band.locator('#dock-key-btn')).toHaveText(/^Key: [A-G]/);
        await expect(band.locator('#dock-size')).toBeVisible();
        await expect(band.locator('#dock-view')).toBeVisible();
        await expect(band.locator('#dock-display-btn')).toHaveText('Display');
        await expect(band.locator('#abc-play-btn, .tab-controls')).toHaveCount(0);
        const keyBox = await band.locator('#dock-key-btn').boundingBox();
        expect(keyBox.x).toBeLessThan(120);
        // the page keeps clear of the band
        const h = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bottomband-h'));
        expect(parseFloat(h)).toBeGreaterThan(40);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'))).toBe('48px');
    });

    test('a song without a chart or versions has Key, Size and Display, and no View', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await songReady(page);
        await expect(page.locator('#dock-key-btn')).toBeVisible();
        await expect(page.locator('#dock-view, #dock-view-btn')).toHaveCount(0);
    });

    test('ABC notation: ▶ · Tempo · Size · View, and no Key or Display', async ({ page }) => {
        await page.goto(ABC);
        await expect(page.locator('#abc-notation svg').first()).toBeVisible({ timeout: 20000 });
        const band = page.locator('#app-bottomband');
        for (const sel of ['#abc-play-btn', '#abc-tempo-label', '#abc-size', '#dock-view-btn']) {
            await expect(band.locator(sel), sel).toBeVisible();
        }
        await expect(band.locator('#dock-key-btn, #dock-display-btn')).toHaveCount(0);
        await expect(page.locator('#song-pill-row, #view-abc-btn, #view-chords-btn')).toHaveCount(0);
    });

    test('ABC Size scales the notation, is remembered on its own, and leaves the lyric size alone', async ({ page }) => {
        await page.goto(ABC);
        const svg = page.locator('#abc-notation svg').first();
        await expect(svg).toBeVisible({ timeout: 20000 });
        const width = async () => (await svg.boundingBox()).height;
        const before = await width();
        await page.locator('#abc-size [data-size="1"]').click();
        await expect.poll(async () => (await page.locator('#abc-notation svg').first().boundingBox()).height).toBeGreaterThan(before);
        expect(await page.evaluate(() => localStorage.getItem('bgb-abc-scale'))).toBe('1.1');
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('songbook-view-prefs') || '{}').fontSizeLevel ?? 0)).toBe(0);
        await page.reload();
        await expect(page.locator('#abc-notation svg').first()).toBeVisible({ timeout: 20000 });
        expect(await page.evaluate(() => localStorage.getItem('bgb-abc-scale'))).toBe('1.1');
        await expect.poll(async () => (await page.locator('#abc-notation svg').first().boundingBox()).height).toBeGreaterThan(before);
    });

    test('the lyric Size is remembered and does not move the notation scale', async ({ page }) => {
        await page.goto(LEAD);
        await songReady(page);
        await page.locator('#dock-size [data-size="1"]').click();
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('songbook-view-prefs') || '{}').fontSizeLevel)).toBe(1);
        expect(await page.evaluate(() => localStorage.getItem('bgb-abc-scale'))).toBeNull();
    });
});

for (const width of [360, 390]) {
    test.describe(`the reading dock at ${width}px`, () => {
        test.use({ viewport: { width, height: 800 }, serviceWorkers: 'block' });

        test('Key · Size · Lyrics | Chart · Display fit on one row', async ({ page }) => {
            await serveWithoutTabs(page, 'old-home-place');
            await page.goto(LEAD);
            await songReady(page);
            await expect(page.locator('#dock-view')).toBeVisible();
            await dockFits(page, '.reading-dock');
            const heights = await page.locator('.reading-dock').evaluate(el => [...el.children].map(k => k.getBoundingClientRect().top));
            expect(new Set(heights.map(Math.round)).size).toBe(1);     // one row
        });

        test('the chart view keeps the same dock', async ({ page }) => {
            await serveWithoutTabs(page, 'old-home-place');
            await page.goto(`${LEAD}`);
            await songReady(page);
            await page.locator('#dock-view [data-view="chart"]').click();
            await expect(page.locator('.cc-tab .cc-sec').first()).toBeVisible();
            await dockFits(page, '.reading-dock');
        });

        test('the ABC dock fits', async ({ page }) => {
            await page.goto(ABC);
            await expect(page.locator('#abc-notation svg').first()).toBeVisible({ timeout: 20000 });
            await dockFits(page, '.reading-dock');
        });

        test('a song with versions: View ▾ fits beside Key, Size and Display', async ({ page }) => {
            await page.goto('/#work/wagon-wheel');
            await songReady(page);
            await expect(page.locator('#dock-view-btn')).toBeVisible();
            await dockFits(page, '.reading-dock');
        });

        test('the tab dock fits on one row, and so does it while playing (Stop joins it)', async ({ page }) => {
            await page.goto('/#work/lonesome-road-blues-1/banjo');
            await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
            await stubPlay(page);
            await expect(page.locator('#app-bottomband .tab-view-btn')).toBeVisible();
            await expect(page.locator('#app-bottomband #dock-display-btn')).toBeVisible();
            await dockFits(page, '.tab-controls');
            await expectOneRow(page);

            await page.locator('.tab-play-btn').click();
            await expect(page.locator('.tab-stop-btn')).toBeVisible();
            await dockFits(page, '.tab-controls');
            await expectOneRow(page);
        });
    });
}

// ── G19c: the tab dock ────────────────────────────────────────────────────
// ▶ · Tempo · View ▾ · Display, the same on every width. Size, Play in,
// Layout, Feel, Practice, Tracks and Auto-hide are in the Display sheet;
// the tabs with their takes, and the tracks, are in View. Playing is stubbed
// (what Play was asked to do is recorded in window.__played) so the tests
// assert the controls reach the player without needing soundfonts.

/** Replace TabPlayer.play with a recorder that starts "playing"; the real stop() still runs. */
async function stubPlay(page) {
    await page.evaluate(async () => {
        const { TabPlayer } = await import('/js/renderers/tab-player.js');
        window.__played = [];
        TabPlayer.prototype.play = async function (otf, opts) {
            window.__played.push(opts);
            this.isPlaying = true;
        };
    });
}
const lastPlay = (page) => page.evaluate(() => window.__played.at(-1));

const expectOneRow = async (page) => {
    const centres = await page.locator('.tab-controls').evaluate(el => [...el.children]
        .filter(k => k.getBoundingClientRect().width > 0 && !k.classList.contains('tab-position'))
        .map(k => { const r = k.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);
};

const gotoTab = async (page, hash) => {
    await page.goto(hash);
    await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
    await stubPlay(page);
};

for (const width of [360, 390, 1440]) {
    test.describe(`the tab dock at ${width}px`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('is ▶ · Tempo · View · Display on one row, and Stop is not there until you play', async ({ page }) => {
            await gotoTab(page, '/#work/foggy-mountain-breakdown/ensemble');
            const band = page.locator('#app-bottomband');
            for (const sel of ['.tab-play-btn', '.tab-tempo-down', '.tab-tempo-display', '.tab-tempo-up', '#dock-view-btn', '#dock-display-btn']) {
                await expect(band.locator(sel), sel).toBeVisible();
            }
            await expect(band.locator('.tab-stop-btn')).toBeHidden();
            await expect(band.locator('.tab-more-btn')).toHaveCount(0);
            await dockFits(page, '.tab-controls');
            await expectOneRow(page);

            await page.locator('.tab-play-btn').click();
            await expect(page.locator('.tab-play-btn')).toHaveText('⏸');
            await expect(band.locator('.tab-stop-btn')).toBeVisible();
            await dockFits(page, '.tab-controls');
            await expectOneRow(page);
            await page.locator('.tab-stop-btn').click();
            await expect(band.locator('.tab-stop-btn')).toBeHidden();
            await expect(page.locator('.tab-play-btn')).toHaveText('▶');
        });
    });
}

test.describe('the tab page above the music', () => {
    test('one credit line replaces the takes bar and the track tabs', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/banjo-tab');
        await expect(page.locator('.arr-credit')).toContainText(/Banjo tab by .+/);
        await expect(page.locator('.arr-credit .arr-pin')).toBeVisible();   // the editor's pick
        for (const sel of ['.arr-bar', '#arr-list', '.arr-item', '.track-view-tabs', '.track-view-tab', '#song-pill-row', '#part-tabs']) {
            await expect(page.locator(sel), sel).toHaveCount(0);
        }
        // the title, the writer line and the practice line stay; so does the attribution after the tab
        await expect(page.locator('.song-title')).toBeVisible();
        await expect(page.locator('#song-details-btn')).toBeVisible();
        await expect(page.locator('.tab-attribution').first()).toBeAttached();
    });
});

test.describe('Display on a tab', () => {
    test('holds Size, Bars per row, Play in, Feel, Practice, Tracks and Auto-hide', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/ensemble');
        const sheet = await openDock(page, 'display');
        const labels = (await sheet.locator('.dock-group-label').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim().split(' ')[0]);
        expect(labels).toEqual(['Size', 'Bars', 'Play', 'Feel', 'Practice', 'Tracks']);
        await expect(sheet.locator('#pill-autohide')).toBeVisible();
        await expect(sheet.locator('.tab-track-mixer .track-checkbox')).not.toHaveCount(0);
    });

    test('Layout (Unrolled / Repeats) is there when the tab has repeats, and redraws without closing the sheet', async ({ page }) => {
        await gotoTab(page, '/#work/arkansas-traveler-1/banjo-tab');
        let sheet = await openDock(page, 'display');
        await expect(sheet.locator('.dock-group-label', { hasText: 'Layout' })).toBeVisible();
        await expect(sheet.locator('.tab-repeat-group .pill-mode-btn.active')).toHaveText('Unrolled');
        await sheet.locator('.tab-repeat-group [data-val="repeats"]').click();
        sheet = page.locator('#dock-display-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.tab-repeat-group .pill-mode-btn.active')).toHaveText('Repeats');
        await closeSheet(page);
        await stubPlay(page);
        // the choice is live: the new band's controls are the ones the sheet moved
        await page.locator('.tab-play-btn').click();
        await expect(page.locator('.tab-play-btn')).toHaveText('⏸');
    });

    test('Tempo changes the tempo Play is asked for', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/banjo-tab');
        const shown = parseInt(await page.locator('.tab-tempo-display').textContent(), 10);
        await page.locator('.tab-tempo-up').click();
        await page.locator('.tab-tempo-up').click();
        await expect(page.locator('.tab-tempo-display')).toHaveText(String(shown + 10));
        await page.locator('.tab-play-btn').click();
        expect((await lastPlay(page)).tempo).toBe(shown + 10);
    });

    test('Play in sets the capo Play is asked for, and the frets stay put', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/banjo-tab');
        const before = await page.locator('.note-text').first().textContent();
        const sheet = await openDock(page, 'display');
        await sheet.locator('#tab-play-in .pill-key-btn', { hasText: /^A$/ }).click();   // the tab is in G: capo 2
        await closeSheet(page);
        await page.locator('.tab-play-btn').click();
        expect((await lastPlay(page)).transpose).toBe(2);
        expect(await page.locator('.note-text').first().textContent()).toBe(before);
    });

    test('Practice: Loop reaches Play, and a mixer track unmuted is sounded', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/ensemble');
        let sheet = await openDock(page, 'display');
        await sheet.locator('.tab-loop-toggle').click();
        const boxes = sheet.locator('.tab-track-mixer .track-checkbox');
        const ids = await boxes.evaluateAll(els => els.map(e => e.dataset.trackId));
        expect(ids.length).toBeGreaterThan(1);
        const lead = await boxes.evaluateAll(els => els.filter(e => e.checked).map(e => e.dataset.trackId));
        expect(lead).toHaveLength(1);                        // the lead track sounds by default
        const other = ids.find(id => !lead.includes(id));
        await sheet.locator(`.track-toggle:has([data-track-id="${other}"])`).click();   // chips: label click toggles
        await closeSheet(page);

        await page.locator('.tab-play-btn').click();
        const played = await lastPlay(page);
        expect(played.loop).toBe(true);
        expect([...played.trackIds].sort()).toEqual([lead[0], other].sort());
    });

    test('Size steps the staff, is remembered in its own key, and leaves the text and notation sizes alone', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/banjo-tab');
        const sheet = await openDock(page, 'display');
        await sheet.locator('#tab-size [data-size="1"]').click();
        await expect.poll(() => page.evaluate(() => localStorage.getItem('bgb-tab-scale'))).toBe('1.1');
        await expect(page.locator('.tablature-container').first()).toHaveCSS('--tab-scale', '1.1');
        expect(await page.evaluate(() => localStorage.getItem('bgb-abc-scale'))).toBeNull();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('songbook-view-prefs') || '{}').fontSizeLevel ?? 0)).toBe(0);
        await page.reload();
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        await expect(page.locator('.tablature-container').first()).toHaveCSS('--tab-scale', '1.1');
        const again = await openDock(page, 'display');
        await again.locator('#tab-size [data-size="-1"]').click();
        await expect.poll(() => page.evaluate(() => localStorage.getItem('bgb-tab-scale'))).toBe('1');
    });
});

test.describe('View on a tab', () => {
    test('lists the song\'s tabs with their version counts, with no Tracks (those are on the staff)', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/ensemble');
        const sheet = await openDock(page, 'view');
        await expect(sheet.locator('.dock-sheet-heading')).toHaveText(['Tabs for this song']);
        const banjo = sheet.locator('[data-part="banjo-tab"]');
        await expect(banjo).toContainText('Banjo');
        await expect(banjo.locator('.dock-count')).toHaveText(/^\d+ versions$/);
        await expect(banjo.locator('.dock-chev')).toBeVisible();
        await expect(sheet.locator('[data-part].on')).toContainText('Ensemble');
        await expect(sheet.locator('[data-track]')).toHaveCount(0);
        await expect(sheet).not.toContainText('Tracks');
    });

    test('a part with several takes drills into them, the pick starred and the one showing ticked', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/banjo-tab');
        const who = (await page.locator('.arr-credit .arr-who').textContent()).trim();
        const sheet = await openDock(page, 'view');
        await sheet.locator('[data-part="banjo-tab"]').click();
        await expect(sheet.locator('.notes-sheet-title')).toContainText(/Banjo tabs\s+\d+ versions/);
        const takes = sheet.locator('.dock-take');
        expect(await takes.count()).toBeGreaterThan(1);
        await expect(takes.first().locator('.dock-pin')).toHaveText('★');
        await expect(takes.first()).toHaveClass(/on/);
        await expect(takes.first().locator('.dock-take-who')).toHaveText(who);

        // back, then in again, then pick another take: the page shows it
        await sheet.locator('.dock-back').click();
        await expect(sheet.locator('.notes-sheet-title')).toHaveText('View');
        await sheet.locator('[data-part="banjo-tab"]').click();
        const second = takes.nth(1);
        const secondWho = (await second.locator('.dock-take-who').textContent()).trim();
        await second.click();
        await expect(page.locator('#song-view-sheet')).toHaveCount(0);
        await expect(page.locator('.arr-credit .arr-who')).toHaveText(secondWho);
        await expect(page.locator('.arr-credit .arr-pin')).toHaveCount(0);    // not the editor's pick
        await page.locator('.tablature-container').first().waitFor();
        // the sheet now ticks the take on screen
        const again = await openDock(page, 'view');
        await again.locator('[data-part="banjo-tab"]').click();
        await expect(again.locator('.dock-take.on .dock-take-who')).toHaveText(secondWho);
    });

    test('another instrument\'s take opens that part on it', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/ensemble');
        const sheet = await openDock(page, 'view');
        await sheet.locator('[data-part="banjo-tab"]').click();
        await sheet.locator('.dock-take').nth(1).click();
        await expect(page).toHaveURL(/banjo-tab/);
        await expect(page.locator('.arr-credit')).toContainText('Banjo tab by');
    });
});

test.describe('auto-hide on a tab', () => {
    test.use({ viewport: { width: 700, height: 480 } });

    const scrollBy = async (page, dy) => {
        for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, dy);
            await page.waitForTimeout(50);
        }
    };

    test('hides both bands on scroll down when Auto-hide is on, not while the tab plays', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/banjo-tab');
        const sheet = await openDock(page, 'display');
        await sheet.locator('#pill-autohide').check();
        await closeSheet(page);

        await page.locator('.tab-play-btn').click();          // playing: its auto-scroll must not take the bands away
        await expect(page.locator('.tab-stop-btn')).toBeVisible();
        await scrollBy(page, 120);
        await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
        await expect(page.locator('#app-bottomband')).toBeInViewport();

        await page.locator('.tab-stop-btn').click();          // stopped: scrolling hides them
        await scrollBy(page, 120);
        await expect(page.locator('body')).toHaveClass(/chrome-hidden/);
        expect((await page.locator('#app-bottomband').boundingBox()).y).toBeGreaterThanOrEqual(480 - 6);
        await scrollBy(page, -120);
        await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
    });

    test('with Auto-hide off the bands stay where they are', async ({ page }) => {
        await gotoTab(page, '/#work/foggy-mountain-breakdown/banjo-tab');
        await scrollBy(page, 120);
        await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
    });
});
