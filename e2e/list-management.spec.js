// E2E tests for List Management (create, delete, add/remove songs)
import { test, expect } from '@playwright/test';

// Helper to open sidebar
async function openSidebar(page) {
    await page.locator('#hamburger-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
}

// Helper to close sidebar
async function closeSidebar(page) {
    await page.locator('#sidebar-close').click();
    await expect(page.locator('.sidebar.open')).toBeHidden();
}

test.describe('List Creation', () => {
    test.beforeEach(async ({ page }) => {
        // Clear localStorage before each test
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        // Wait for the index to load: the post-load render would stomp any
        // navigation done before it (sub-second for users, a race for tests)
        await expect(page.locator('#search-stats')).toContainText('songs', { timeout: 15000 });
    });

    test('can create a new list from list picker', async ({ page }) => {
        // Search for a song
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('wagon wheel', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Click list button on result
        await page.locator('.result-list-btn').first().click();

        // List picker popup should appear (dynamic popup uses different selectors than modal)
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Click "New List" button - popup uses .list-picker-new-btn class
        const newListBtn = page.locator('.list-picker-new-btn');
        await newListBtn.click();

        // Form should appear - popup uses .list-picker-input and .list-picker-add-btn
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });

        // Enter list name
        await listInput.fill('Test Playlist');

        // Confirm creation
        await page.locator('.list-picker-add-btn').click();

        // Picker closes after creation, reopen to verify
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('.list-picker-popup')).toContainText('Test Playlist');
    });

    test('can create list from the Song Lists view', async ({ page }) => {
        // Open sidebar and go to the Song Lists view (the old manage-lists
        // modal was replaced by a dedicated view)
        await openSidebar(page);
        await page.locator('#nav-song-lists').click();
        await expect(page.locator('#song-lists-view')).toBeVisible();

        // "+ New List" reveals an inline name input; Enter commits
        await page.locator('#create-list-btn').click();
        const nameInput = page.locator('.new-list-input');
        await expect(nameInput).toBeVisible();
        await nameInput.fill('My New List');
        await nameInput.press('Enter');

        // List should appear as a card in the view
        await expect(page.locator('#manage-lists-container')).toContainText('My New List');
    });

    test('cannot create duplicate list names', async ({ page }) => {
        // Search and open list picker
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('cripple creek', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Create first list - popup uses .list-picker-new-btn, .list-picker-input, .list-picker-add-btn
        await page.locator('.list-picker-new-btn').click();
        await page.locator('.list-picker-input').fill('Unique List');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Reopen picker after it closes
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });

        // Try to create list with same name
        await page.locator('.list-picker-new-btn').click();
        await page.locator('.list-picker-input').fill('Unique List');
        await page.locator('.list-picker-add-btn').click();

        // Should show error (input border turns red) and not close picker
        await page.waitForTimeout(500);
        const listItems = page.locator('.list-picker-popup .list-picker-option');
        const count = await listItems.count();

        // Create another distinctly named list
        await page.locator('.list-picker-input').fill('Different List');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Reopen to check
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });
        const newCount = await page.locator('.list-picker-popup .list-picker-option').count();
        expect(newCount).toBe(count + 1); // Only the new unique one added
    });
});

test.describe('Adding Songs to Lists', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        // Wait for the index to load: the post-load render would stomp any
        // navigation done before it (sub-second for users, a race for tests)
        await expect(page.locator('#search-stats')).toContainText('songs', { timeout: 15000 });
    });

    test('can add song to a custom list', async ({ page }) => {
        // Search for a song
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('blue moon', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Open list picker
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Create a new list - the song is automatically added when list is created
        await page.locator('.list-picker-new-btn').click();
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });
        await listInput.fill('Jam Songs');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Navigate to the list via the Song Lists view (lists no longer
        // render in the sidebar)
        await openSidebar(page);
        await page.locator('#nav-song-lists').click();
        const listCard = page.locator('#manage-lists-container .list-card').filter({ hasText: 'Jam Songs' });
        await expect(listCard).toBeVisible({ timeout: 3000 });
        await listCard.click();

        // Should show 1 song (automatically added when list was created);
        // the count renders in the list header bar
        await expect(page.locator('#list-header-count')).toContainText('1');
    });

    test('can add song to favorites', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('salty dog', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Click list button
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Check favorites
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Badge should update
        await expect(page.locator('#nav-favorites-count')).toHaveText('1');
    });

    test('song can be in multiple lists', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('foggy mountain', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Open list picker
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Add to favorites
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Create a custom list - popup uses .list-picker-new-btn, .list-picker-input, .list-picker-add-btn
        await page.locator('.list-picker-new-btn').click();
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });
        await listInput.fill('Banjo Songs');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Reopen picker to add to list
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });

        const listCheckbox = page.locator('.list-picker-popup .list-picker-option:has-text("Banjo Songs") input');
        await listCheckbox.click();

        // Close picker
        await page.locator('#search-input').click();

        // Result should show it's in lists (has-lists class)
        await expect(page.locator('.result-item').first()).toHaveClass(/has-lists|is-favorite/);
    });
});

test.describe('Removing Songs from Lists', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        // Wait for the index to load: the post-load render would stomp any
        // navigation done before it (sub-second for users, a race for tests)
        await expect(page.locator('#search-stats')).toContainText('songs', { timeout: 15000 });
    });

    test('can remove song from favorites', async ({ page }) => {
        // First add to favorites
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('john henry', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();
        await expect(page.locator('#nav-favorites-count')).toHaveText('1');

        // Close and reopen picker
        await page.locator('#search-input').click();
        await page.waitForTimeout(200);

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Uncheck favorites
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Badge should show 0 or be hidden
        await page.waitForTimeout(300);
        const badge = page.locator('#nav-favorites-count');
        const badgeText = await badge.textContent();
        expect(badgeText === '0' || await badge.isHidden()).toBeTruthy();
    });

    test('removing song from list in list view updates display', async ({ page }) => {
        // Add song to favorites first
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('will the circle', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites
        await openSidebar(page);
        await page.locator('#nav-favorites').click();

        await expect(page.locator('#search-stats')).toContainText('1');

        // Click list button on the item in favorites view
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Uncheck favorites
        await page.locator('.list-picker-popup .favorites-option input').click();
        await page.waitForTimeout(500);

        // Should show 0 items
        await expect(page.locator('#search-stats')).toContainText('0');
    });
});

test.describe('List Deletion', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        // Wait for the index to load: the post-load render would stomp any
        // navigation done before it (sub-second for users, a race for tests)
        await expect(page.locator('#search-stats')).toContainText('songs', { timeout: 15000 });
    });

    test('can delete custom list from the Song Lists view', async ({ page }) => {
        // Create a list first using the popup
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('mountain', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Create list - popup uses .list-picker-new-btn, .list-picker-input, .list-picker-add-btn
        await page.locator('.list-picker-new-btn').click();
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });
        await listInput.fill('To Delete');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Reopen picker to add song to list (popup closes after creation)
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });
        const listCheckbox = page.locator('.list-picker-popup .list-picker-option:has-text("To Delete") input');
        await listCheckbox.click();

        // Close picker
        await page.locator('#search-input').click();
        await page.waitForTimeout(300);

        // Open the Song Lists view
        await openSidebar(page);
        await page.locator('#nav-song-lists').click();
        await expect(page.locator('#song-lists-view')).toBeVisible({ timeout: 5000 });

        // Each non-favorites card has a delete button; deletion asks confirm()
        page.on('dialog', dialog => dialog.accept());
        const listCard = page.locator('#manage-lists-container .list-card').filter({ hasText: 'To Delete' });
        await expect(listCard).toBeVisible({ timeout: 3000 });
        await listCard.locator('.delete-list-btn').click();

        // List card should be removed
        await expect(page.locator('#manage-lists-container')).not.toContainText('To Delete');
    });

    test('cannot delete favorites list', async ({ page }) => {
        // Navigate to favorites
        await openSidebar(page);
        await page.locator('#nav-favorites').click();

        // Delete button should not be visible for favorites
        const deleteBtn = page.locator('#delete-list-btn');
        await expect(deleteBtn).toBeHidden();
    });

    test('delete button visible when viewing own custom list', async ({ page }) => {
        // Create and navigate to a custom list
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('creek', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Create list - popup uses .list-picker-new-btn, .list-picker-input, .list-picker-add-btn
        await page.locator('.list-picker-new-btn').click();
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });
        await listInput.fill('My Custom List');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Reopen picker to add song to list
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });

        // Check the new list to add song
        const listCheckbox = page.locator('.list-picker-popup .list-picker-option:has-text("My Custom List") input');
        await listCheckbox.click();

        // Close picker
        await page.locator('#search-input').click();
        await page.waitForTimeout(300);

        // Navigate to the list via the Song Lists view
        await openSidebar(page);
        await page.locator('#nav-song-lists').click();
        const listCard = page.locator('#manage-lists-container .list-card').filter({ hasText: 'My Custom List' });
        await expect(listCard).toBeVisible({ timeout: 3000 });
        await listCard.click();

        // Delete button lives in the list header bar for own custom lists
        await expect(page.locator('#list-delete-btn')).toBeVisible();
    });
});

test.describe('List Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        // Wait for the index to load: the post-load render would stomp any
        // navigation done before it (sub-second for users, a race for tests)
        await expect(page.locator('#search-stats')).toContainText('songs', { timeout: 15000 });
    });

    test('custom lists appear in the Song Lists view', async ({ page }) => {
        // Create a list
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('railroad', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Create list - popup uses .list-picker-new-btn, .list-picker-input, .list-picker-add-btn
        await page.locator('.list-picker-new-btn').click();
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });
        await listInput.fill('Sidebar Test');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Reopen picker to add song to list
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });
        await page.locator('.list-picker-popup .list-picker-option:has-text("Sidebar Test") input').click();
        await page.waitForTimeout(300);

        // Close picker
        await page.locator('#search-input').click();
        await page.waitForTimeout(300);

        // Lists no longer render in the sidebar; they live in the
        // Song Lists view
        await openSidebar(page);
        await page.locator('#nav-song-lists').click();
        await expect(page.locator('#manage-lists-container')).toContainText('Sidebar Test');
    });

    test('clicking list in sidebar shows list contents', async ({ page }) => {
        // Add song to favorites
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('whiskey', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate via sidebar
        await openSidebar(page);
        await page.locator('#nav-favorites').click();

        // Should show the list view with its header count
        await expect(page.locator('#list-header')).toBeVisible();
        await expect(page.locator('#list-header-count')).toContainText('1 song');
    });
});

test.describe('List Sharing', () => {
    test('share button visible when viewing list', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        // Wait for the index to load: the post-load render would stomp any
        // navigation done before it (sub-second for users, a race for tests)
        await expect(page.locator('#search-stats')).toContainText('songs', { timeout: 15000 });

        // Add to favorites
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('home sweet', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites
        await openSidebar(page);
        await page.locator('#nav-favorites').click();
        await page.waitForTimeout(500);

        // Share button now lives in the list header bar
        const shareBtn = page.locator('#list-share-btn');
        await expect(shareBtn).toBeVisible();
    });

    test('print button visible when viewing list', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        // Wait for the index to load: the post-load render would stomp any
        // navigation done before it (sub-second for users, a race for tests)
        await expect(page.locator('#search-stats')).toContainText('songs', { timeout: 15000 });

        // Add to favorites
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('rocky top', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites
        await openSidebar(page);
        await page.locator('#nav-favorites').click();
        await page.waitForTimeout(500);

        // Print button now lives in the list header bar
        const printBtn = page.locator('#list-print-btn');
        await expect(printBtn).toBeVisible();
    });
});
