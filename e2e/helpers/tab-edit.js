// Entering the tab editor from a song page: the top band's one Edit
// (`#edit-song-btn`, G19). On a tab part it opens the tab editor; it stays
// hidden until the tab has drawn, so the click waits for that.
import { expect } from '@playwright/test';

/** Press Edit on a tab page. Resolves once the editor's canvas is up when `waitForEditor`. */
export async function pressTabEdit(page, { waitForEditor = false } = {}) {
    await page.locator('#edit-song-btn').click();
    if (waitForEditor) {
        await expect(page.locator('.editor-renderer .stave-row').first()).toBeVisible({ timeout: 20000 });
    }
}
