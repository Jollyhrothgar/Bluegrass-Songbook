// The "Tab by" credit line in the tab editor (G15c, schema 1.1).
//
// The values live in the document as metadata.tab_by, so Download and Submit
// carry them. Who may CHANGE an existing credit is enforced server-side
// (pytest: tests/test_process_pending.py::TestTabCredit); here we only check
// that the editor does not offer the edit to someone it would be thrown away
// for.
import { test, expect } from './fixtures.js';
import { pressTabEdit } from './helpers/tab-edit.js';
import { saveAs } from './helpers/front-door.js';
import { mockSupabase } from './helpers/supabase-mock.js';

const band = (page) => page.locator('#app-bottomband');
const NEW_TAB = '/index.html#new-tab?title=E2E%20Breakdown&instrument=banjo';
const PUBLISHED = '/#work/foggy-mountain-breakdown/mandolin';   // credited to Joe Carr

async function openNewTab(page) {
    await page.goto(NEW_TAB);
    await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
}

async function openPublished(page) {
    await page.goto(PUBLISHED);
    await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
    await pressTabEdit(page);
    await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
}

async function typeANote(page, key = '5') {
    await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
    await page.keyboard.press(key);
    await expect(page.locator('.editor-renderer .note-text').first()).toBeVisible();
}

async function downloadedJson(download) {
    const { readFileSync } = await import('fs');
    return JSON.parse(readFileSync(await download.path(), 'utf-8'));
}

test.describe('a new take', () => {
    test('starts empty, with plain-language labels', async ({ page }) => {
        await openNewTab(page);
        const row = page.locator('.tab-credit');
        await expect(row.locator('.tab-credit-name')).toHaveValue('');
        await expect(row.locator('.tab-credit-name'))
            .toHaveAttribute('placeholder', 'Who wrote this tab? (optional)');
        await expect(row.locator('.tab-credit-url')).toHaveAttribute(
            'placeholder', 'Their web page, e.g. a Banjo Hangout profile (optional)');
        await expect(row.locator('.tab-credit-label').first()).toHaveText('Tab by');
        await expect(row.locator('.tab-credit-label').nth(1)).toHaveText('Link');
        await expect(row.locator('.tab-credit-note')).toBeHidden();
    });

    test('a typed credit and link land in the downloaded file', async ({ page }) => {
        await openNewTab(page);
        await typeANote(page);
        await page.locator('.tab-credit-name').fill('Jane Picker');
        await page.locator('.tab-credit-url').fill('https://www.banjohangout.org/my/janepicker');
        await page.locator('.tab-credit-url').press('Enter');

        const download = await saveAs(page, { format: 'otf' });
        const doc = await downloadedJson(download);
        expect(doc.metadata.tab_by).toEqual({
            name: 'Jane Picker', url: 'https://www.banjohangout.org/my/janepicker',
        });
        // tab_by arrived in schema 1.1; writers stamp the current version.
        expect(Number(doc.otf_version.split('.')[1])).toBeGreaterThanOrEqual(1);
        // canonical key order: tab_by sits in metadata, name before url
        expect(Object.keys(doc.metadata.tab_by)).toEqual(['name', 'url']);
    });

    test('a link that is not http(s) gets an inline message and is not stored', async ({ page }) => {
        await openNewTab(page);
        await typeANote(page);
        await page.locator('.tab-credit-name').fill('Jane');
        await page.locator('.tab-credit-url').fill('javascript:alert(1)');
        await page.locator('.tab-credit-url').press('Enter');
        await expect(page.locator('.tab-credit-error')).toContainText('http');

        const download = await saveAs(page, { format: 'otf' });
        const doc = await downloadedJson(download);
        expect(doc.metadata.tab_by).toEqual({ name: 'Jane' });
    });

    test('Submit carries tab_by in the row content', async ({ page }) => {
        const sb = await mockSupabase(page, {
            commit: { success: true, mode: 'create', workId: 'e2e-breakdown' },
        });
        await openNewTab(page);
        await typeANote(page);
        await page.locator('.tab-credit-name').fill('Jane Picker');
        await page.locator('.tab-credit-url').fill('https://example.com/jane');
        await page.locator('.tab-credit-url').press('Enter');

        await Promise.all([
            page.waitForURL(/#work\/e2e-breakdown$/, { timeout: 20000 }),
            band(page).locator('.tab-edit-submit').click(),
        ]);
        const row = sb.row('pending_songs');
        expect(JSON.parse(row.content).metadata.tab_by).toEqual({
            name: 'Jane Picker', url: 'https://example.com/jane',
        });
        sb.assertClean();
    });
});

test.describe('correcting a published take', () => {
    test('pre-fills the published credit, read-only for a reader who is not trusted',
        async ({ page }) => {
            await mockSupabase(page);                       // signed in, not trusted
            await openPublished(page);
            const name = page.locator('.tab-credit-name');
            await expect(name).toHaveValue(/^Joe Carr/);
            await expect(name).toHaveJSProperty('readOnly', true);
            await expect(page.locator('.tab-credit-url')).toHaveJSProperty('readOnly', true);
            await expect(page.locator('.tab-credit-note')).toHaveText(
                'Only trusted users can change an existing credit.');
        });

    test('a signed-out reader sees it read-only too', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await openPublished(page);
        await expect(page.locator('.tab-credit-name')).toHaveJSProperty('readOnly', true);
    });

    test('a trusted user can change it', async ({ page }) => {
        await mockSupabase(page, { rpc: { is_trusted_user: true } });
        await openPublished(page);
        const name = page.locator('.tab-credit-name');
        await expect(name).toHaveJSProperty('readOnly', false);
        await name.fill('Someone Else');
        await name.press('Enter');
        const download = await saveAs(page, { format: 'otf' });
        expect((await downloadedJson(download)).metadata.tab_by.name).toBe('Someone Else');
    });
});
