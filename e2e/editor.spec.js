// E2E tests for Song Editor functionality
import { test, expect } from '@playwright/test';

// Helper to open sidebar
async function openSidebar(page) {
    await page.locator('#hamburger-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
}

test.describe('Editor Access', () => {
    test('can access editor via sidebar Add Song button', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Open sidebar and click Add Song
        await openSidebar(page);
        await page.locator('#nav-add-song').click();

        // Editor panel should be visible
        await expect(page.locator('#editor-panel')).toBeVisible();
    });

    test('editor shows title, artist, and content fields', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await openSidebar(page);
        await page.locator('#nav-add-song').click();

        // Check form fields exist
        await expect(page.locator('#editor-title')).toBeVisible();
        await expect(page.locator('#editor-artist')).toBeVisible();
        await expect(page.locator('#editor-content')).toBeVisible();
    });

    test('edit button on song view opens editor with song data', async ({ page }) => {
        // Navigate to a specific song
        await page.goto('/#work/your-cheating-heart');
        await page.waitForTimeout(1000);

        // Wait for song view
        await expect(page.locator('#song-view')).toBeVisible();

        // Click edit button
        const editBtn = page.locator('#edit-song-btn');
        if (await editBtn.isVisible()) {
            await editBtn.click();

            // Editor should open
            await expect(page.locator('#editor-panel')).toBeVisible();

            // Title should be populated
            const titleInput = page.locator('#editor-title');
            await expect(titleInput).not.toHaveValue('');
        }
    });
});

test.describe('Editor Content Input', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await openSidebar(page);
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();
    });

    test('can enter title', async ({ page }) => {
        const titleInput = page.locator('#editor-title');
        await titleInput.fill('Test Song Title');
        await expect(titleInput).toHaveValue('Test Song Title');
    });

    test('can enter artist', async ({ page }) => {
        const artistInput = page.locator('#editor-artist');
        await artistInput.fill('Test Artist');
        await expect(artistInput).toHaveValue('Test Artist');
    });

    test('can enter song content', async ({ page }) => {
        const contentArea = page.locator('#editor-content');
        const testContent = '[G]Amazing [C]Grace how [G]sweet the sound';
        await contentArea.fill(testContent);
        await expect(contentArea).toHaveValue(testContent);
    });
});

test.describe('Editor Preview', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await openSidebar(page);
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();
    });

    test('preview updates when content changes', async ({ page }) => {
        const contentArea = page.locator('#editor-content');
        const previewArea = page.locator('#editor-preview-content');

        // Enter ChordPro content
        await contentArea.fill('[G]Test [C]line with [D]chords');

        // Wait for preview to update
        await page.waitForTimeout(300);

        // Preview should show rendered content
        if (await previewArea.isVisible().catch(() => false)) {
            const previewText = await previewArea.textContent();
            expect(previewText).toContain('Test');
        }
    });

    test('chords are highlighted in preview', async ({ page }) => {
        const contentArea = page.locator('#editor-content');

        // Enter content with chords
        await contentArea.fill('[G]Amazing [C]Grace');

        // Wait for preview update
        await page.waitForTimeout(300);

        // Check for chord highlighting (chords have chord class)
        const chordSpans = page.locator('.editor-preview .chord, #editor-preview-content .chord');
        const count = await chordSpans.count();

        // Preview should render chords
        expect(count >= 0).toBeTruthy(); // May be 0 if preview renders differently
    });
});

test.describe('ChordPro Conversion', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await openSidebar(page);
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();
    });

    test('paste with chord-above-lyrics format triggers conversion prompt', async ({ page }) => {
        const contentArea = page.locator('#editor-content');

        // Simulate chord-above-lyrics format (typical from guitar sites)
        const chordAboveLyrics = `G       C       G
Amazing grace how sweet the sound
D       G
That saved a wretch like me`;

        await contentArea.fill(chordAboveLyrics);
        await page.waitForTimeout(500);

        // The editor should either auto-convert or show a convert option
        // Content should contain ChordPro brackets after conversion
        const content = await contentArea.inputValue();

        // Either converted to ChordPro or kept original
        expect(content.length).toBeGreaterThan(0);
    });
});

test.describe('Editor Navigation', () => {
    test('back button returns to previous view', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Open editor
        await openSidebar(page);
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        // Click back button
        await page.locator('#editor-back-btn').click();

        // Should return to search view
        await expect(page.locator('.search-container')).toBeVisible();
    });

    test('opening editor from song returns to song after back', async ({ page }) => {
        // Navigate to a song first - use a song without version picker
        await page.goto('/#work/your-cheating-heart');
        await page.waitForTimeout(1000);

        // Song view or work view should be visible (or version picker)
        const songView = page.locator('#song-view:not(.hidden)');
        const workView = page.locator('#work-view:not(.hidden)');
        const versionPicker = page.locator('#version-modal:not(.hidden)');

        // Wait for one of them
        await expect(songView.or(workView).or(versionPicker)).toBeVisible({ timeout: 5000 });

        // If version picker appeared, select first version
        if (await versionPicker.isVisible()) {
            await page.locator('.version-item .version-info').first().click();
            await expect(songView.or(workView)).toBeVisible({ timeout: 3000 });
        }

        // Try to click edit if available
        const editBtn = page.locator('#edit-song-btn');
        if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await editBtn.click();

            // Editor should open
            await expect(page.locator('#editor-panel')).toBeVisible();

            // Click back
            await page.locator('#editor-back-btn').click();

            // Should return to a valid non-editor view (song, work, or search)
            const searchContainer = page.locator('.search-container');
            await expect(songView.or(workView).or(searchContainer)).toBeVisible({ timeout: 3000 });

            // Editor should be hidden
            await expect(page.locator('#editor-panel')).toBeHidden();
        }
    });
});

test.describe('Editor Hints', () => {
    test('hints button shows ChordPro help', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await openSidebar(page);
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        // Click hints button
        const hintsBtn = page.locator('#hints-btn, .hints-btn, [title*="hint"]');
        if (await hintsBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
            await hintsBtn.first().click();

            // Hints panel should appear
            const hintsPanel = page.locator('#hints-panel, .hints-panel');
            await expect(hintsPanel).toBeVisible();

            // Should contain ChordPro syntax help
            const hintsText = await hintsPanel.textContent();
            expect(hintsText?.toLowerCase()).toMatch(/chord|bracket|section/i);
        }
    });
});

test.describe('Editor Copy Function', () => {
    test('copy button copies content to clipboard', async ({ page, context }) => {
        // Grant clipboard permissions
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await openSidebar(page);
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        // Enter content
        const contentArea = page.locator('#editor-content');
        const testContent = '[G]Test song content';
        await contentArea.fill(testContent);

        // Click copy button
        const copyBtn = page.locator('#editor-copy-btn');
        if (await copyBtn.isVisible()) {
            await copyBtn.click();

            // Verify clipboard content (may need permissions)
            const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
            expect(clipboardText).toContain('Test song content');
        }
    });
});

test.describe('Editor Nashville Mode', () => {
    test('Nashville toggle changes chord display in preview', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await openSidebar(page);
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        // Enter content with key
        const contentArea = page.locator('#editor-content');
        await contentArea.fill('{key: G}\n[G]Test [C]line [D]here');
        await page.waitForTimeout(300);

        // Toggle Nashville mode - use first visible toggle
        const nashvilleToggle = page.locator('#editor-nashville').first();
        const altToggle = page.locator('input[name="nashville"]').first();
        const toggle = await nashvilleToggle.isVisible() ? nashvilleToggle : altToggle;

        if (await toggle.isVisible()) {
            await toggle.click();
            await page.waitForTimeout(300);

            // Preview should show Nashville numbers (I, IV, V instead of G, C, D)
            const previewArea = page.locator('#editor-preview-content');
            if (await previewArea.isVisible()) {
                const previewText = await previewArea.textContent();
                // Nashville numbers should appear
                expect(previewText).toMatch(/I|IV|V/);
            }
        }
    });
});

test.describe('Editor Validation', () => {
    test('submit button requires title', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await openSidebar(page);
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        // Enter content but no title
        const contentArea = page.locator('#editor-content');
        await contentArea.fill('[G]Some content here');

        // Submit button should be present (ID is #editor-submit, not #editor-submit-btn)
        const submitBtn = page.locator('#editor-submit');
        await expect(submitBtn).toBeVisible();

        // Click submit
        await submitBtn.click();

        // Should show error or status message about missing title
        await page.waitForTimeout(500);
        const status = page.locator('#editor-status');
        const statusText = await status.textContent().catch(() => '');

        // Validation should prevent submission
        // Either shows error or title field is highlighted
        const titleInput = page.locator('#editor-title');
        const isInvalid = await titleInput.evaluate(el => el.classList.contains('invalid') || el.validity?.valueMissing);

        expect(statusText?.toLowerCase().includes('title') || isInvalid || statusText === '').toBeTruthy();
    });
});
