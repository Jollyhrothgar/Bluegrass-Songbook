// Files in and files out: File ▸ Save as… / Ctrl+S, and the two ways a `.tef`
// gets into the editor (the band's 📂 button, and dropping one on the app).
//
// These are the paths a QA pass could not reach: a download is a browser
// event rather than a DOM change, and a file picker is a native dialog until
// a test drives the chooser. Both are drivable — they just needed a spec.
import { test, expect } from './fixtures.js';
import { pressTabEdit } from './helpers/tab-edit.js';
import { clickFileItem, saveAs, saveAsPanel } from './helpers/front-door.js';
import { tefFixture } from './helpers/tef-fixture.js';

const TAB_WORK = '/#work/foggy-mountain-breakdown/mandolin';

const band = (page) => page.locator('#app-bottomband');

async function editPublishedTake(page) {
    await page.goto(TAB_WORK);
    await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
    await pressTabEdit(page);
    await page.locator('.editor-renderer .stave-row').first()
        .waitFor({ timeout: 20000 });
}

async function typeANote(page, key = '7') {
    await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
    await page.keyboard.press(key);
    await expect(page.locator('.editor-renderer .note-text').first()).toBeVisible();
}

/** Read a download's body as parsed JSON. */
async function downloadedJson(download) {
    const path = await download.path();
    const { readFileSync } = await import('fs');
    return JSON.parse(readFileSync(path, 'utf-8'));
}

test.describe('saving the edited document (Save as…)', () => {
    test('Save as .otf.json writes the session filename, with the note in it',
        async ({ page }) => {
            await editPublishedTake(page);
            await typeANote(page, '9');

            const download = await saveAs(page, { format: 'otf' });

            // The session names the file after the take it is correcting.
            const name = download.suggestedFilename();
            expect(name).toMatch(/^foggy-mountain-breakdown-mandolin.*-edited\.otf\.json$/);

            const doc = await downloadedJson(download);
            expect(doc.otf_version).toBeTruthy();
            expect(Array.isArray(doc.tracks)).toBe(true);
            const frets = Object.values(doc.notation)
                .flat()
                .flatMap(m => m.events || [])
                .flatMap(e => e.notes || [])
                .map(n => n.f);
            expect(frets).toContain(9);
        });

    test('Ctrl+S opens Save as… on the song page too, and nothing is applied behind it', async ({ page }) => {
        await editPublishedTake(page);
        await typeANote(page, '9');
        await page.keyboard.press('Control+s');
        await expect(saveAsPanel(page)).toBeVisible();
        // a new take starts at .tef; a correction of a published take does too (no source file)
        await expect(saveAsPanel(page).locator('input[value="tef"]')).toBeChecked();
        await expect(saveAsPanel(page).locator('.save-as-name')).toHaveValue(/-edited\.tef$/);
        await page.keyboard.press('Escape');
        await expect(saveAsPanel(page)).toBeHidden();
        // still editing
        await expect(page.locator('.editor-renderer .stave-row').first()).toBeVisible();
    });

    test('Ctrl+S saves from the standalone editor', async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.editor-renderer .stave-row').first().waitFor();
        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press('4');
        await expect(page.locator('.note-text').first()).toHaveText('4');

        await page.keyboard.press('Control+s');
        const panel = saveAsPanel(page);
        await expect(panel).toBeVisible();
        await panel.locator('input[value="otf"]').check();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            panel.locator('.save-btn').click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/\.otf\.json$/);

        const doc = await downloadedJson(download);
        expect(doc.otf_version).toBeTruthy();
        const frets = Object.values(doc.notation)
            .flat()
            .flatMap(m => m.events || [])
            .flatMap(e => e.notes || [])
            .map(n => n.f);
        expect(frets).toContain(4);
    });
});

test.describe('importing a .tef', () => {
    const fixture = tefFixture();

    test('📂 Import .tef… replaces the take being written', async ({ page }) => {
        await page.goto('/index.html#new-tab?title=Empty%20Take&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first()
            .waitFor({ timeout: 20000 });

        // A fresh take has no notes at all — so any note afterwards came
        // from the file.
        expect(await page.locator('.editor-renderer .note-text').count()).toBe(0);

        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            clickFileItem(page, 'Import .tef'),
        ]);
        await chooser.setFiles(fixture.file);

        await expect(page.locator('.editor-renderer .note-text').first())
            .toBeVisible({ timeout: 20000 });
        await expect(band(page).locator('.tab-edit-status'))
            .toContainText(`Imported ${fixture.file.name}`);
        await expect(band(page).locator('.tab-edit-status'))
            .toContainText(`${fixture.measures} measures`);

        // The document really is the file's: its track came with it.
        const trackButtons = await page.locator('.track-buttons .track-button')
            .allTextContents();
        const shown = trackButtons.length
            ? trackButtons
            : [await page.locator('.editor-renderer').textContent()];
        expect(shown.join(' ')).toContain(fixture.trackIds[0]);
    });

    test('dropping a .tef anywhere on the app opens it in the editor',
        async ({ page }) => {
            await page.goto('/#search');
            await page.waitForSelector('#search-input');
            await expect(page.locator('#search-stats'))
                .toContainText(/[1-9][\d,]*\s+songs/, { timeout: 20000 });

            // pwa.js listens on `document` for a drop carrying a supported
            // file. Playwright cannot synthesise an OS drag, so the DataTransfer
            // is built in the page — which is exactly what the browser hands
            // the listener for a real drop.
            await page.evaluate(async ([name, bytes]) => {
                const file = new File([new Uint8Array(bytes)], name);
                const dt = new DataTransfer();
                dt.items.add(file);
                document.body.dispatchEvent(
                    new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
                document.body.dispatchEvent(
                    new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
            }, [fixture.file.name, [...fixture.file.buffer]]);

            // The file becomes a draft, and the draft id is the hand-off.
            await page.waitForURL(/#new-tab\?draft=/, { timeout: 20000 });
            await page.locator('.editor-renderer .stave-row').first()
                .waitFor({ timeout: 20000 });

            await expect(page.locator('.arr-status'))
                .toContainText('Imported from a file');
            await expect(page.locator('#new-tab-title'))
                .toHaveValue(fixture.title);
            expect(await page.locator('.editor-renderer .note-text').count())
                .toBeGreaterThan(0);
        });

    test('a file that is not a tab is left alone, not swallowed',
        async ({ page }) => {
            await page.goto('/#search');
            await page.waitForSelector('#search-input');
            const before = page.url();

            await page.evaluate(() => {
                const file = new File(['not a tab'], 'notes.txt', { type: 'text/plain' });
                const dt = new DataTransfer();
                dt.items.add(file);
                document.body.dispatchEvent(
                    new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
            });

            await page.waitForTimeout(500);
            expect(page.url()).toBe(before);
        });
});
