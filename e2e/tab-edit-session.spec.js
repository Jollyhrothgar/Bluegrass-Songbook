// E2E for the tab edit session on a work page.
//
// The bug this covers: editing a tab, switching to another part of the same
// work (the "Lyrics & Chords" button was sitting right there), and coming
// back — the edits were gone, silently. Edit mode is now a stand-alone
// session over ONE part: the page's controls stand down, the actions live in
// the fixed top band, and every change is drafted to localStorage.
import { test, expect } from '@playwright/test';

// A multi-part work: lead sheet + banjo/fiddle/guitar tabs, so the part
// switcher is really on the page rather than assumed.
const WORK = '/#work/cripple-creek/banjo-tab';

/** Open the work's banjo tab and enter edit mode. */
async function enterEditMode(page) {
    await page.goto(WORK);
    await page.locator('.tablature-container').first().waitFor({ timeout: 30000 });
    await page.locator('.tab-edit-btn').click();
    await page.locator('.otf-editor-toolbar').waitFor({ timeout: 15000 });
}

/** Place a note so the session is genuinely dirty. */
async function makeAnEdit(page) {
    await page.locator('.editor-canvas-container').click({ position: { x: 120, y: 60 } });
    await page.keyboard.press('5');
    await page.keyboard.press('Enter');
    await expect
        .poll(() => page.evaluate(() =>
            Object.keys(localStorage).filter(k => k.startsWith('otf-tab-draft:')).length))
        .toBeGreaterThan(0);
}

test.describe('tab edit session — stand-alone over one part', () => {
    test('the page stands down: part tabs, pills and title row are gone', async ({ page }) => {
        await page.goto(WORK);
        await page.locator('.tablature-container').first().waitFor({ timeout: 30000 });
        // The part switcher IS there in view mode — that is the whole point.
        await expect(page.locator('#part-tabs')).toBeVisible();

        await page.locator('.tab-edit-btn').click();
        await page.locator('.otf-editor-toolbar').waitFor({ timeout: 15000 });

        await expect(page.locator('body')).toHaveClass(/tab-editing/);
        await expect(page.locator('#part-tabs')).toBeHidden();
        await expect(page.locator('#song-pill-row')).toBeHidden();
        await expect(page.locator('.song-header')).toBeHidden();
    });

    test('actions live in the fixed top band, not in a bar that scrolls away', async ({ page }) => {
        await enterEditMode(page);

        const band = page.locator('.app-topbar');
        await expect(band.locator('.tab-edit-done')).toBeVisible();
        await expect(band.locator('.tab-edit-cancel')).toBeVisible();
        await expect(band.locator('.tab-edit-download')).toBeVisible();
        // The old inline bar is not in the document at all
        await expect(page.locator('.tab-edit-bar')).toHaveCount(0);
        await expect(page.locator('.topbar-title')).toContainText(/Cripple Creek/);
    });

    test('the window is the frame: the document does not scroll, the tab does', async ({ page }) => {
        await enterEditMode(page);

        const { scrollH, clientH } = await page.evaluate(() => ({
            scrollH: document.documentElement.scrollHeight,
            clientH: document.documentElement.clientHeight,
        }));
        // Nothing may grow the page past the viewport — that is what used to
        // carry Done off the top of a long tab.
        expect(scrollH).toBeLessThanOrEqual(clientH + 1);

        // The band and the editor's own toolbar both stay put, top and bottom.
        const topbar = await page.locator('.app-topbar').boundingBox();
        const toolbar = await page.locator('.otf-editor-toolbar').boundingBox();
        expect(topbar.y).toBeLessThanOrEqual(1);
        expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(clientH + 1);

        // The scroll region is the tab itself
        await expect(page.locator('.editor-canvas-container')).toHaveCSS('overflow-y', 'auto');
    });

    test('the app bottom band is gone — the editor brings its own', async ({ page }) => {
        await enterEditMode(page);
        await expect(page.locator('.app-bottomband')).toBeHidden();
        await expect(page.locator('.editor-status-bar')).toBeVisible();
    });
});

test.describe('tab edit session — edits survive', () => {
    // Cleared ONCE, by hand — not via addInitScript, which re-runs on every
    // new document and would wipe the very draft the reload tests check for.
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
    });

    test('every edit is drafted to localStorage under a per-part key', async ({ page }) => {
        await enterEditMode(page);
        await makeAnEdit(page);

        const keys = await page.evaluate(() =>
            Object.keys(localStorage).filter(k => k.startsWith('otf-tab-draft:')));
        expect(keys).toHaveLength(1);
        // Addressed by work AND part, so two takes never overwrite each other
        expect(keys[0]).toContain('cripple-creek');

        const draft = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), keys[0]);
        expect(draft.otf.tracks.length).toBeGreaterThan(0);
        expect(Date.parse(draft.savedAt)).toBeGreaterThan(0);
    });

    test('reopening the part offers the draft back instead of silently losing it', async ({ page }) => {
        await enterEditMode(page);
        await makeAnEdit(page);

        // The worst case: the editor goes away without applying. A reload is
        // the harshest version — the whole in-memory document is gone, so
        // only the draft can bring the edits back. (goto(WORK) would NOT do:
        // the URL is unchanged, so it never reloads the app.)
        await page.reload();
        await page.locator('.tablature-container').first().waitFor({ timeout: 30000 });
        await page.locator('.tab-edit-btn').click();
        await page.locator('.otf-editor-toolbar').waitFor({ timeout: 15000 });

        const banner = page.locator('.tab-edit-draft-banner');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText(/unsaved edits/i);
        await expect(banner.locator('.tab-edit-draft-restore')).toBeVisible();

        // Offered, not applied behind your back — until you say so.
        await banner.locator('.tab-edit-draft-restore').click();
        await expect(banner).toHaveCount(0);
    });

    test('Discard drops the draft, so it is not offered a second time', async ({ page }) => {
        await enterEditMode(page);
        await makeAnEdit(page);

        await page.reload();
        await page.locator('.tablature-container').first().waitFor({ timeout: 30000 });
        await page.locator('.tab-edit-btn').click();
        await page.locator('.tab-edit-draft-banner .tab-edit-draft-discard').click();

        expect(await page.evaluate(() =>
            Object.keys(localStorage).filter(k => k.startsWith('otf-tab-draft:')).length)).toBe(0);
    });

    test('Cancel asks before discarding, and declining keeps you in the editor', async ({ page }) => {
        await enterEditMode(page);
        await makeAnEdit(page);

        page.once('dialog', d => d.dismiss());   // "Discard your edits?" → no
        await page.locator('.app-topbar .tab-edit-cancel').click();
        await expect(page.locator('.otf-editor-toolbar')).toBeVisible();
        await expect(page.locator('body')).toHaveClass(/tab-editing/);
    });

    test('Cancel accepted leaves edit mode and gives the page back', async ({ page }) => {
        await enterEditMode(page);
        await makeAnEdit(page);

        page.once('dialog', d => d.accept());
        await page.locator('.app-topbar .tab-edit-cancel').click();

        await expect(page.locator('body')).not.toHaveClass(/tab-editing/);
        await expect(page.locator('#part-tabs')).toBeVisible();
        await expect(page.locator('.tablature-container').first()).toBeVisible({ timeout: 20000 });
        // An explicit discard really discards — no zombie draft to re-offer
        expect(await page.evaluate(() =>
            Object.keys(localStorage).filter(k => k.startsWith('otf-tab-draft:')).length)).toBe(0);
    });

    test('Done applies the edits and clears the draft', async ({ page }) => {
        await enterEditMode(page);
        await makeAnEdit(page);

        await page.locator('.app-topbar .tab-edit-done').click();
        await expect(page.locator('body')).not.toHaveClass(/tab-editing/);
        await expect(page.locator('.tablature-container').first()).toBeVisible({ timeout: 20000 });
        expect(await page.evaluate(() =>
            Object.keys(localStorage).filter(k => k.startsWith('otf-tab-draft:')).length)).toBe(0);
    });
});
