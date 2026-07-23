// E2E tests for List Management (create, delete, add/remove songs).
// Lists are reached through the top band: Favorites and Lists nav links
// (the sidebar and its count badge are gone).
import { test, expect } from '@playwright/test';
import { gotoSearch, searchFor, navClick } from './helpers.js';

test.describe('List Creation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await gotoSearch(page);
    });

    test('can create a new list from list picker', async ({ page }) => {
        await searchFor(page, 'wagon wheel');

        // Click list button on result
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Click "New List" button
        await page.locator('.list-picker-new-btn').click();

        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });

        await listInput.fill('Test Playlist');
        await page.locator('.list-picker-add-btn').click();

        // Picker closes after creation, reopen to verify
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('.list-picker-popup')).toContainText('Test Playlist');
    });

    test('can create list from the Song Lists view', async ({ page }) => {
        // Top-band Lists link opens the Song Lists view
        await navClick(page, 'lists');
        await expect(page.locator('#song-lists-view')).toBeVisible();

        // "+ New List" reveals an inline name input; Enter commits
        await page.locator('#create-list-btn').click();
        const nameInput = page.locator('.new-list-input');
        await expect(nameInput).toBeVisible();
        await nameInput.fill('My New List');
        await nameInput.press('Enter');

        await expect(page.locator('#manage-lists-container')).toContainText('My New List');
    });

    test('cannot create duplicate list names', async ({ page }) => {
        await searchFor(page, 'cripple creek');
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Create first list
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

        // Should show error and not close picker
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
        await gotoSearch(page);
    });

    test('can add song to a custom list', async ({ page }) => {
        await searchFor(page, 'blue moon');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Create a new list - the song is automatically added when it's created
        await page.locator('.list-picker-new-btn').click();
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });
        await listInput.fill('Jam Songs');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Navigate to the list via the Song Lists view
        await navClick(page, 'lists');
        const listCard = page.locator('#manage-lists-container .list-card').filter({ hasText: 'Jam Songs' });
        await expect(listCard).toBeVisible({ timeout: 3000 });
        await listCard.click();

        await expect(page.locator('#list-header-count')).toContainText('1');
    });

    test('can add song to favorites', async ({ page }) => {
        await searchFor(page, 'salty dog');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        await page.locator('.list-picker-popup .favorites-option input').click();

        // The result button reflects membership (the sidebar badge is gone)
        await expect(page.locator('.result-list-btn').first()).toHaveClass(/has-lists/);
    });

    test('song can be in multiple lists', async ({ page }) => {
        await searchFor(page, 'foggy mountain');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        // Add to favorites
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Create a custom list
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

        await expect(page.locator('.result-item').first()).toHaveClass(/has-lists|is-favorite/);
    });
});

test.describe('Removing Songs from Lists', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await gotoSearch(page);
    });

    test('can remove song from favorites', async ({ page }) => {
        // First add to favorites
        await searchFor(page, 'john henry');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();
        await expect(page.locator('.result-list-btn').first()).toHaveClass(/has-lists/);

        // Close and reopen picker
        await page.locator('#search-input').click();
        await page.waitForTimeout(200);

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Uncheck favorites
        await page.locator('.list-picker-popup .favorites-option input').click();

        await page.waitForTimeout(300);
        await expect(page.locator('.result-list-btn').first()).not.toHaveClass(/has-lists/);
    });

    test('removing song from list in list view updates display', async ({ page }) => {
        await searchFor(page, 'will the circle');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites
        await navClick(page, 'favorites');

        await expect(page.locator('#search-stats')).toContainText('1');

        // Click list button on the item in favorites view
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Uncheck favorites
        await page.locator('.list-picker-popup .favorites-option input').click();
        await page.waitForTimeout(500);

        await expect(page.locator('#search-stats')).toContainText('0');
    });
});

test.describe('List Deletion', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await gotoSearch(page);
    });

    test('can delete custom list from the Song Lists view', async ({ page }) => {
        await searchFor(page, 'mountain');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

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
        await navClick(page, 'lists');
        await expect(page.locator('#song-lists-view')).toBeVisible({ timeout: 5000 });

        // Each non-favorites card has a delete button; deletion asks confirm()
        page.on('dialog', dialog => dialog.accept());
        const listCard = page.locator('#manage-lists-container .list-card').filter({ hasText: 'To Delete' });
        await expect(listCard).toBeVisible({ timeout: 3000 });
        await listCard.locator('.delete-list-btn').click();

        await expect(page.locator('#manage-lists-container')).not.toContainText('To Delete');
    });

    test('cannot delete favorites list', async ({ page }) => {
        await navClick(page, 'favorites');

        const deleteBtn = page.locator('#delete-list-btn');
        await expect(deleteBtn).toBeHidden();
    });

    test('delete button visible when viewing own custom list', async ({ page }) => {
        await searchFor(page, 'creek');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        await page.locator('.list-picker-new-btn').click();
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });
        await listInput.fill('My Custom List');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Reopen picker to add song to list
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });

        const listCheckbox = page.locator('.list-picker-popup .list-picker-option:has-text("My Custom List") input');
        await listCheckbox.click();

        // Close picker
        await page.locator('#search-input').click();
        await page.waitForTimeout(300);

        // Navigate to the list via the Song Lists view
        await navClick(page, 'lists');
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
        await gotoSearch(page);
    });

    test('custom lists appear in the Song Lists view', async ({ page }) => {
        await searchFor(page, 'railroad');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });

        await page.locator('.list-picker-new-btn').click();
        const listInput = page.locator('.list-picker-input');
        await expect(listInput).toBeVisible({ timeout: 3000 });
        await listInput.fill('Lists View Test');
        await page.locator('.list-picker-add-btn').click();
        await page.waitForTimeout(500);

        // Reopen picker to add song to list
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 3000 });
        await page.locator('.list-picker-popup .list-picker-option:has-text("Lists View Test") input').click();
        await page.waitForTimeout(300);

        // Close picker
        await page.locator('#search-input').click();
        await page.waitForTimeout(300);

        await navClick(page, 'lists');
        await expect(page.locator('#manage-lists-container')).toContainText('Lists View Test');
    });

    test('favorites nav link shows list contents', async ({ page }) => {
        await searchFor(page, 'whiskey');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        await navClick(page, 'favorites');

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
        await gotoSearch(page);

        await searchFor(page, 'home sweet');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        await navClick(page, 'favorites');
        await page.waitForTimeout(500);

        await expect(page.locator('#list-share-btn')).toBeVisible();
    });

    test('print button visible when viewing list', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await gotoSearch(page);

        await searchFor(page, 'rocky top');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        await navClick(page, 'favorites');
        await page.waitForTimeout(500);

        await expect(page.locator('#list-print-btn')).toBeVisible();
    });
});
