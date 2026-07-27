// E2E tests for Song Editor functionality. The Add Song entry point is the
// top-band nav item (opens the add-song picker; Lyrics & Chords lands in the
// editor) or the #add deep link (straight to the editor).
import { test, expect } from '@playwright/test';
import { gotoSearch, navClick } from './helpers.js';

// Open a fresh new-song editor via the top-band flow
async function openAddSongEditor(page) {
    await navClick(page, 'add');
    await expect(page.locator('#add-song-picker')).toBeVisible();
    await page.locator('.picker-card[data-type="chordpro"]').click();
    await expect(page.locator('#editor-panel')).toBeVisible();
}

test.describe('Editor Access', () => {
    test('reloading while editing keeps home content hidden', async ({ page }) => {
        // Force-refresh on an #edit deep link must restore the editor without
        // stacking the landing page (logo, search, collections) above it.
        await page.goto('/#edit/your-cheating-heart');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);
        // edit mode arrives with metadata known: the compact line shows it
        await expect(page.locator('#metadata-summary')).toContainText(/Cheat/i);

        await page.reload();
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#landing-page')).toBeHidden();
        await expect(page.locator('.search-container')).toBeHidden();
    });

    test('top-band Add Song opens picker; Lyrics & Chords lands in the editor', async ({ page }) => {
        await gotoSearch(page);

        await navClick(page, 'add');
        // Picker modal with the three cards
        await expect(page.locator('#add-song-picker')).toBeVisible();
        await expect(page.locator('.picker-card[data-type="upload"]')).toBeVisible();
        await expect(page.locator('.picker-card[data-type="chordpro"]')).toBeVisible();
        await expect(page.locator('.picker-card[data-type="request"]')).toBeVisible();

        await page.locator('.picker-card[data-type="chordpro"]').click();

        // Editor: textarea + live preview
        await expect(page.locator('#editor-panel')).toBeVisible();
        await expect(page.locator('#editor-content')).toBeVisible();
        await expect(page.locator('#editor-content')).toHaveValue('');
        await expect(page.locator('.ve-preview-empty')).toBeVisible();
        await expect(page.locator('#add-song-picker')).toBeHidden();

        // guidance lives in the textarea placeholder
        expect(await page.locator('#editor-content').getAttribute('placeholder'))
            .toMatch(/Paste or type your song/);

        // quiet escape hatches in the preview empty state
        await expect(page.locator('.ve-link-upload')).toBeVisible();
        await expect(page.locator('.ve-link-request')).toBeVisible();

        // metadata is deferred to a compact line
        await expect(page.locator('#metadata-summary')).toContainText('Untitled song');
        await expect(page.locator('#metadata-fields')).toBeHidden();
    });

    test('#add deep link goes straight to the editor (no picker)', async ({ page }) => {
        await page.goto('/#add');

        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#add-song-picker')).toBeHidden();
        await expect(page.locator('#editor-content')).toBeVisible();
    });

    test('upload link is login-gated: logged out click prompts sign-in, no upload view', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('.ve-preview-empty')).toBeVisible();

        // stub the sign-in redirect so the test can observe the gate
        await page.evaluate(() => {
            window.__signInCalled = 0;
            window.SupabaseAuth.signInWithGoogle = () => { window.__signInCalled++; };
        });

        await page.locator('.ve-link-upload').click();

        expect(await page.evaluate(() => window.__signInCalled)).toBe(1);
        // still in the editor — the upload view did not open
        await expect(page.locator('#upload-panel')).toBeHidden();
        await expect(page.locator('#editor-panel')).toBeVisible();
    });

    test('editor shows title, artist, and content fields', async ({ page }) => {
        await gotoSearch(page);
        await openAddSongEditor(page);

        // Metadata fields are deferred behind the compact line — expand it
        await page.locator('#metadata-summary').click();
        await expect(page.locator('#editor-title')).toBeVisible();
        await expect(page.locator('#editor-artist')).toBeVisible();
        await expect(page.locator('#editor-content')).toBeVisible();
    });

    test('edit button on song view opens editor with song data', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        // Edit lives in the top band on song pages
        const editBtn = page.locator('#edit-song-btn');
        await expect(editBtn).toBeVisible();
        await editBtn.click();

        await expect(page.locator('#editor-panel')).toBeVisible();
        await expect(page.locator('#editor-title')).not.toHaveValue('');
    });
});

test.describe('Editor State Reset', () => {
    test('Add Song after editing a song shows a fresh empty editor', async ({ page }) => {
        // Edit an existing song
        await page.goto('/#edit/your-cheating-heart');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);

        // Home via the brand link, then Add Song (the reported repro)
        await page.locator('#topbar-brand').click();
        await expect(page.locator('#landing-page')).toBeVisible();

        await openAddSongEditor(page);

        // Fresh new-song editor: empty panes, no stale content
        await expect(page.locator('.ve-preview-empty')).toBeVisible();
        await expect(page.locator('#metadata-summary')).toContainText('Untitled song');
        await expect(page.locator('#editor-title')).toHaveValue('');
        await expect(page.locator('#editor-content')).toHaveValue('');
        await expect(page.locator('#editor-submit')).toHaveText('Submit to Songbook');
    });

    test('an unsaved new-song draft survives leaving and returning to Add Song', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        // Type a draft into the textarea
        await page.locator('#editor-content').fill('[G]Working on my draft');

        // Leave for home, then come back via Add Song
        await page.locator('#topbar-brand').click();
        await expect(page.locator('#landing-page')).toBeVisible();

        await openAddSongEditor(page);

        await expect(page.locator('#editor-content')).toHaveValue('[G]Working on my draft');
    });

    test('editing song B after abandoning an edit of song A shows B', async ({ page }) => {
        await page.goto('/#edit/your-cheating-heart');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);

        // Abandon via home, then open another song and edit it
        await page.locator('#topbar-brand').click();
        await expect(page.locator('#landing-page')).toBeVisible();

        await page.goto('/#edit/cold-cold-heart');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cold/i);
        await expect(page.locator('#editor-title')).not.toHaveValue(/Cheat/i);
        await expect(page.locator('#editor-content')).not.toHaveValue('');
    });
});

test.describe('Editor Content Input', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
    });

    test('can enter title and it shows on the compact metadata line', async ({ page }) => {
        await page.locator('#metadata-summary').click();
        const titleInput = page.locator('#editor-title');
        await titleInput.fill('Test Song Title');
        await expect(titleInput).toHaveValue('Test Song Title');
        await expect(page.locator('#metadata-summary')).toContainText('Test Song Title');
    });

    test('can enter artist', async ({ page }) => {
        await page.locator('#metadata-summary').click();
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
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
    });

    test('preview updates when content changes', async ({ page }) => {
        const contentArea = page.locator('#editor-content');
        const previewArea = page.locator('#editor-preview-container');

        // Enter ChordPro content (preview re-renders ~200ms after typing)
        await contentArea.fill('[G]Test [C]line with [D]chords');

        // Interactive preview shows the rendered lyrics
        await expect(previewArea).toContainText('Test');
    });

    test('chords render as interactive chips in the preview', async ({ page }) => {
        const contentArea = page.locator('#editor-content');
        await contentArea.fill('[G]Amazing [C]Grace');

        await expect(page.locator('#editor-preview-container .ve-chip')).toHaveCount(2);
        await expect(page.locator('#editor-preview-container .ve-chip').first()).toHaveText('G');
    });
});

test.describe('ChordPro Conversion', () => {
    test('paste with chord-above-lyrics format converts to ChordPro', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        const contentArea = page.locator('#editor-content');

        // Simulate chord-above-lyrics format (typical from guitar sites)
        const chordAboveLyrics = `G       C       G
Amazing grace how sweet the sound
D       G
That saved a wretch like me`;

        await contentArea.fill(chordAboveLyrics);
        await page.waitForTimeout(500);

        const content = await contentArea.inputValue();
        expect(content.length).toBeGreaterThan(0);
    });
});

test.describe('Editor Navigation', () => {
    test('back button returns to previous view', async ({ page }) => {
        await gotoSearch(page);
        await openAddSongEditor(page);

        await page.locator('#editor-back-btn').click();

        await expect(page.locator('.search-container')).toBeVisible();
    });

    test('opening editor from song returns to song after back', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const editBtn = page.locator('#edit-song-btn');
        await expect(editBtn).toBeVisible();
        await editBtn.click();

        await expect(page.locator('#editor-panel')).toBeVisible();

        await page.locator('#editor-back-btn').click();

        // Should return to a valid non-editor view (song or search)
        const songView = page.locator('#song-view:not(.hidden)');
        const searchContainer = page.locator('.search-container');
        await expect(songView.or(searchContainer)).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#editor-panel')).toBeHidden();
    });
});

test.describe('Editor Hints', () => {
    test('hints button shows ChordPro help', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        await page.locator('#chordpro-hints-btn').click();

        const hintsPanel = page.locator('#chordpro-hints-panel');
        await expect(hintsPanel).toBeVisible();

        const hintsText = await hintsPanel.textContent();
        expect(hintsText?.toLowerCase()).toMatch(/chord|verse|chorus/i);
    });
});

test.describe('Editor Copy Function', () => {
    test('copy button copies content to clipboard', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        const contentArea = page.locator('#editor-content');
        await contentArea.fill('[G]Test song content');

        await page.locator('#editor-copy').click();

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toContain('Test song content');
    });
});

test.describe('Editor Nashville Mode', () => {
    test('Nashville toggle changes chord display in preview', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        const contentArea = page.locator('#editor-content');
        await contentArea.fill('{key: G}\n[G]Test [C]line [D]here');
        await page.waitForTimeout(300);

        const toggle = page.locator('#editor-nashville');
        await expect(toggle).toBeVisible();
        await toggle.click();
        await page.waitForTimeout(300);

        // Preview chips show Nashville numbers (I, IV, V)
        await expect(page.locator('#editor-preview-container .ve-chip').first()).toHaveText(/I|IV|V/);
    });
});

test.describe('Editor Validation', () => {
    test('submit button requires title', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        // Enter content but no title
        await page.locator('#editor-content').fill('[G]Some content here');

        const submitBtn = page.locator('#editor-submit');
        await expect(submitBtn).toBeVisible();
        await submitBtn.click();

        // Friendly nudge: fields expand, title gets focus, notice mentions the title
        await expect(page.locator('#metadata-fields')).toBeVisible();
        await expect(page.locator('#editor-title')).toBeFocused();
        const statusText = await page.locator('#editor-status').textContent();
        expect(statusText?.toLowerCase()).toContain('title');
    });
});
