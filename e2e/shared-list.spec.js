// E2E: opening a share link (#list/<id>) in a signed-out window.
//
// A list that is not in the viewer's own library is fetched through the
// get_public_list RPC. The mocked backend answers with the function's REAL
// response shape (snake_case flags, top-level `songs`). The list page used to
// read list.songs / data.isOwner / data.canClaim, so every share link showed
// "0 songs".
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock.js';

const LIST_ID = '11111111-1111-4111-8111-111111111111';

// Byte-for-byte what supabase/migrations/20260109224000 get_public_list returns.
const PUBLIC_LIST = {
    list: {
        id: LIST_ID,
        name: 'Sunday Jam',
        user_id: '22222222-2222-4222-8222-222222222222',
        position: 0,
        owners: ['22222222-2222-4222-8222-222222222222'],
        orphaned_at: null,
    },
    songs: ['wagon-wheel', 'old-home-place'],
    is_owner: false,
    is_follower: false,
    is_orphaned: false,
    can_claim: false,
};

test.describe('Share link, signed out', () => {
    test('shows the songs in the list', async ({ page }) => {
        const sb = await mockSupabase(page, {
            signedIn: false,
            rpc: { get_public_list: PUBLIC_LIST },
        });
        await page.goto(`/#list/${LIST_ID}`);

        await expect(page.locator('#list-header-name')).toHaveText('Sunday Jam', { timeout: 20000 });
        await expect(page.locator('#list-header-count')).toHaveText('2 songs');
        await expect(page.locator('.result-item')).toHaveCount(2);
        await expect(page.locator('#results')).toContainText('Wagon Wheel');
        await expect(page.locator('#results')).toContainText('Old Home Place');

        // Someone else's list: labelled as shared, copyable, followable, not claimable.
        await expect(page.locator('#list-header-badge')).toHaveText('Shared List');
        await expect(page.locator('#list-duplicate-btn')).toContainText('Copy to My Lists');
        await expect(page.locator('#list-claim-btn')).toBeHidden();
        await expect(page.locator('#list-delete-btn')).toBeHidden();

        expect(sb.calls().some(c => c.includes('/rest/v1/rpc/get_public_list'))).toBe(true);
        sb.assertClean();
    });

    test('says so when the list does not exist', async ({ page }) => {
        await mockSupabase(page, {
            signedIn: false,
            rpc: { get_public_list: { error: 'List not found' } },
        });
        await page.goto(`/#list/${LIST_ID}`);

        await expect(page.locator('#results')).toContainText("doesn't exist", { timeout: 20000 });
    });
});
