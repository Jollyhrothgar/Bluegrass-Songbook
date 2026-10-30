// The feature tour on a phone (mobile project, 390x844). A Google visitor on
// a phone lands on a song page, whose thin band is back · logo · search ·
// Edit · ⋯: ⋯ glows there (no room, and no need, for a Tour button), the tour
// starts from ⋯ ▸ Go to, and the steps have to find their controls. The editor
// demo has to work with the editor's DOCKED parts — the section bar and the
// chord picker sit at the bottom of the screen — and never raise a keyboard.
import { test, expect } from './fixtures.js';
import { songReady, here, ringAround, cardClear, next, leadText, startTourFromMenu } from './helpers/tour.js';

/** Once the card has settled, its bottom is above the top of `selector`. */
async function cardAbove(page, selector) {
    await page.locator('.tour-card').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    const gap = await page.evaluate((sel) => {
        const bar = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().height > 0);
        return bar.getBoundingClientRect().top - document.querySelector('.tour-card').getBoundingClientRect().bottom;
    }, selector);
    expect(gap).toBeGreaterThanOrEqual(0);
}

test('phone: ⋯ glows on the thin band and the tour finds every control', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/songs/old-home-place/');
    await songReady(page);

    // First visit: no Tour button on the thin band, ⋯ glows instead
    await expect(page.locator('#topbar-tour')).toBeHidden();
    await expect(page.locator('#topbar-overflow-btn')).toHaveClass(/tour-invite/);
    // Nothing in the band overlaps or spills
    const band = await page.evaluate(() => {
        const bar = document.getElementById('app-topbar');
        const boxes = [...bar.querySelectorAll('.topbar-back, .topbar-brand, #topbar-search, .topbar-action-btn, #topbar-overflow-btn')]
            .map(el => el.getBoundingClientRect()).filter(r => r.width > 0)
            .sort((a, b) => a.left - b.left);
        const overlap = boxes.some((r, i) => i > 0 && r.left < boxes[i - 1].right - 1);
        return { overlap, spill: Math.max(...boxes.map(r => r.right)) - bar.getBoundingClientRect().right };
    });
    expect(band.overlap).toBe(false);
    expect(band.spill).toBeLessThanOrEqual(0);

    // The tour is in ⋯ ▸ Go to, in the sheet
    await startTourFromMenu(page);
    // Search first: the box, then a line of the words typed in finds the song
    await ringAround(page, '#search-input');
    await cardClear(page, '#search-input');
    await next(page);
    await expect(page.locator('#search-input'))
        .toHaveValue('ten long years since I left my home', { timeout: 20000 });
    await ringAround(page, '#results .result-item');
    await cardClear(page, '#results .result-item');
    // no keyboard: the demo never focused the box
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('search-input');

    await next(page);
    await expect.poll(() => here(page)).toBe('/songs/old-home-place/');
    await songReady(page);
    await ringAround(page, '#key-pill');
    await cardClear(page, '#key-pill');
    await next(page);
    await ringAround(page, '#topbar-overflow-btn');
    await cardClear(page, '#topbar-overflow-btn');
    await next(page);
    await ringAround(page, '#edit-song-btn');
    expect(await here(page)).toBe('/songs/old-home-place/');

    // The editor demo, with the editor's parts docked at the bottom of the screen
    await next(page);
    await expect.poll(() => here(page)).toBe('/#add');
    await expect.poll(() => leadText(page), { timeout: 20000 }).toContain('In the sky, in the sky?');

    await next(page);                                    // sections: the bar is docked
    await ringAround(page, '.le-selbar-docked:not(.hidden) [data-wrap="chorus"]');
    await cardAbove(page, '.le-selbar-docked:not(.hidden)');
    await expect.poll(() => leadText(page), { timeout: 20000 }).toContain('{start_of_chorus');
    // no keyboard: the demo never focused the editor
    expect(await page.evaluate(() => document.activeElement?.closest?.('#editor-lead') == null)).toBe(true);

    await next(page);                                    // chords: the picker is docked
    await ringAround(page, '.chm-menu:not(.hidden) .chm-cell[data-chord="G"]');
    await cardAbove(page, '.chm-menu.chm-split .chm-body');
    await expect.poll(() => leadText(page), { timeout: 30000 }).toContain('In the sky, [D]in the [G]sky?');

    // The tab: Play in the band, the card above it; the editor let go quietly
    await next(page);
    await ringAround(page, '.tab-play-btn');
    await cardClear(page, '.tab-play-btn');
    await expect(page.locator('#editor-leave-modal')).toHaveCount(0);

    // Edit is the top band's, on a phone as anywhere
    await next(page);
    await ringAround(page, '#edit-song-btn');

    // Your own .tef: nothing to drag on a phone, so the copy names ⋯ ▸ Tab editor
    await next(page);
    await expect(page.locator('.tour-ring.tour-ring-zone')).toBeVisible();
    await expect(page.locator('.tour-body')).toContainText('Tab editor, then tap Open a tab file');
    await cardClear(page, '.tab-play-btn');

    await next(page);   // Done
    await expect.poll(() => here(page)).toBe('/songs/old-home-place/');
    await expect(page.locator('.tour-card')).toHaveCount(0);

    // From now on ⋯ stops glowing, and the tour stays in ⋯ ▸ Go to
    await expect(page.locator('#topbar-overflow-btn')).not.toHaveClass(/tour-invite/);
    await page.click('#topbar-overflow-btn');
    await expect(page.locator('#overflow-tour')).toBeVisible();
});
