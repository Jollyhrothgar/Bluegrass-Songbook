// What the tab editor's front door specs (desktop and phone) share: two tab
// files to open, and the driving of the pages around them.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { expect } from '@playwright/test';
import { tefFixture } from './tef-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));

// A tracked, small, real OTF document (20 KB; unit-test fixture of the same song
// that works/welcome-to-new-york/banjo.otf.json holds).
const OTF_PATH = resolve(here, '../../docs/js/__tests__/fixtures/welcome-to-new-york-banjo.otf.json');

export const tef = tefFixture();

export function otfJsonFile() {
    const buffer = readFileSync(OTF_PATH);
    return { name: 'welcome-to-new-york.otf.json', mimeType: 'application/json', buffer };
}

export const notes = (page) => page.locator('.editor-renderer .note-text');

/** Load /tab-editor/ and wait for the app's empty state to replace the prerender article. */
export async function gotoFrontDoor(page) {
    await page.goto('/tab-editor/');
    await expect(page.locator('.tab-home')).toBeVisible({ timeout: 20000 });
}

/** Click a control that opens the file picker, and feed the chooser a file. */
export async function chooseFile(page, trigger, file) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger.click()]);
    await chooser.setFiles(file);
}

/** The editor is up with notes in it. */
export async function expectEditorWithNotes(page) {
    await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
    await expect(notes(page).first()).toBeVisible({ timeout: 20000 });
}

/** Open the editor's File menu and click an item, on a laptop or a phone. */
export async function clickFileItem(page, label) {
    const bar = page.locator('.otf-menu-bar');
    const hamburger = bar.locator('.menu-hamburger');
    if (await hamburger.isVisible()) {
        await hamburger.click();
    } else {
        await bar.locator('.menu-trigger[data-menu="file"]').click();
    }
    await page.locator('.menu-popup .menu-item', { hasText: label }).first().click();
}

/** ⋯ menu entry by its label. */
export async function clickOverflow(page, label) {
    await page.locator('#topbar-overflow-btn').click();
    await page.locator('#topbar-overflow-menu .pill-popover-item', { hasText: label }).click();
}

/** The Save as… panel (File ▸ Save as…, or Ctrl+S). */
export const saveAsPanel = (page) => page.locator('.otf-save-as-popover');

/**
 * File ▸ Save as…, pick a format and (optionally) a name, press Save, and hand
 * back the download. `format` is the radio's value: 'tef', 'otf' or 'txt'.
 */
export async function saveAs(page, { format = null, name = null } = {}) {
    await clickFileItem(page, 'Save as');
    const panel = saveAsPanel(page);
    await expect(panel).toBeVisible();
    if (format) await panel.locator(`input[name="save-as-format"][value="${format}"]`).check();
    if (name !== null) await panel.locator('.save-as-name').fill(name);
    await expect(panel.locator('.save-btn')).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), panel.locator('.save-btn').click()]);
    return download;
}
