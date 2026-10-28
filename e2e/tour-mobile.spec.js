// The feature tour on a phone (mobile project, 390x844). A Google visitor on
// a phone lands on a song page, whose band is cut to back · logo · Lists · ⋯:
// the Tour button has to fit there, and the steps whose control lives
// elsewhere on a phone have to find it (tab Edit: the ⚙ sheet). The editor
// demo has to work with the editor's DOCKED parts — the section bar and the
// chord picker sit at the bottom of the screen — and never raise a keyboard.
import { test, expect } from '@playwright/test';
import { songReady, here, ringAround, cardClear, next, leadText } from './helpers/tour.js';

/** Once the card has settled, its bottom is above the top of `selector`. */
async function cardAbove(page, selector) {
    await page.locator('.tour-card').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    const gap = await page.evaluate((sel) => {
        const bar = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().height > 0);
        return bar.getBoundingClientRect().top - document.querySelector('.tour-card').getBoundingClientRect().bottom;
    }, selector);
    expect(gap).toBeGreaterThanOrEqual(0);
}

test('phone: the button fits a song page band and the tour finds every control', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/songs/old-home-place/');
    await songReady(page);

    const btn = page.locator('#topbar-tour');
    await expect(btn).toBeVisible();
    // Nothing in the band overlaps or spills
    const band = await page.evaluate(() => {
        const bar = document.getElementById('app-topbar');
        const boxes = [...bar.querySelectorAll('.topbar-back, .topbar-brand, .topbar-action-btn, .topbar-tour-btn, #topbar-overflow-btn')]
            .map(el => el.getBoundingClientRect()).filter(r => r.width > 0)
            .sort((a, b) => a.left - b.left);
        const overlap = boxes.some((r, i) => i > 0 && r.left < boxes[i - 1].right - 1);
        return { overlap, spill: Math.max(...boxes.map(r => r.right)) - bar.getBoundingClientRect().right };
    });
    expect(band.overlap).toBe(false);
    expect(band.spill).toBeLessThanOrEqual(0);

    await btn.click();
    await ringAround(page, '#key-pill');
    await cardClear(page, '#key-pill');
    await next(page);
    await ringAround(page, '#list-picker-btn');
    await cardClear(page, '#list-picker-btn');
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

    // Edit has moved into the ⚙ sheet on a phone
    await next(page);
    await ringAround(page, '.tab-more-btn');
    await expect(page.locator('.tour-body')).toContainText('On a phone, Edit is under ⚙.');

    // Your own .tef: nothing to drag on a phone, so the copy names Add Song ▸ Tablature
    await next(page);
    await expect(page.locator('.tour-ring.tour-ring-zone')).toBeVisible();
    await expect(page.locator('.tour-body')).toContainText('Add Song ▸ Tablature');
    await cardClear(page, '.tab-play-btn');

    await next(page);   // Done
    await expect.poll(() => here(page)).toBe('/songs/old-home-place/');
    await expect(page.locator('.tour-card')).toHaveCount(0);

    // From now on it is the FIRST thing in ⋯, not under the song's five items
    await page.click('#topbar-overflow-btn');
    await expect(page.locator('#topbar-overflow-menu .pill-popover-item').first())
        .toHaveText('✨ Take the tour');
});
