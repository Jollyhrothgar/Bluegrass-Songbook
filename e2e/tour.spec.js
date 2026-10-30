// The feature tour (G14): a first-time visitor's top band carries a glowing
// Tour button; the tour starts at search (what you can search for, then a
// line of Old Home Place typed into the real box finds it), rings the song's
// controls one at a time (Key, Lists, Edit), plays a song into the real
// lyrics & chords editor (typed in, sorted into sections, chorded), then the
// tab (Play, Edit, the page itself as a drop zone for your own .tef files),
// and stays out of the way. After the
// first time it lives in the ⋯ menu. The phone walk is tour-mobile.spec.js.
import { test, expect } from './fixtures.js';
import { songReady, here, ringAround, cardClear, arrowAt, next, leadText, startTourFromMenu } from './helpers/tour.js';

const tourBtn = (page) => page.locator('#topbar-tour');
const card = (page) => page.locator('.tour-card');
const count = (page) => page.locator('.tour-count');

test.describe('Feature tour', () => {
    test('a first visit: the glowing button walks all eleven steps and brings you back', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await expect(tourBtn(page)).toBeVisible();
        expect(await tourBtn(page).evaluate(el => getComputedStyle(el).animationName)).toBe('tour-glow');
        // Not in the ⋯ menu yet: one invitation, not two
        await page.click('#topbar-overflow-btn');
        await expect(page.locator('#topbar-overflow-menu')).toBeVisible();
        await expect(page.locator('#overflow-tour')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await tourBtn(page).click();
        await expect(tourBtn(page)).toBeHidden();

        // 1-2 at search: what you can search for, then a line of the words
        // typed into the real box finds the demo song
        await expect(count(page)).toHaveText('1 of 11');
        await expect(page.locator('.tour-label')).toContainText('Tour');
        await expect.poll(() => here(page)).toBe('/#search');
        await ringAround(page, '#search-input');
        await cardClear(page, '#search-input');
        await expect(page.locator('.tour-body')).toContainText('prog:I-IV-V');

        await next(page);
        await expect(count(page)).toHaveText('2 of 11');
        await expect(page.locator('#search-input'))
            .toHaveValue('ten long years since I left my home', { timeout: 20000 });
        await ringAround(page, '#results .result-item');
        await expect(page.locator('#results .result-item').first()).toContainText('Old Home Place');
        await cardClear(page, '#results .result-item');            // the card is off the song it found
        expect(await here(page)).toBe('/#search');                  // the tour's search, not the reader's: no URL

        // 3-5 on the song it found
        await next(page);
        await expect(count(page)).toHaveText('3 of 11');
        await expect.poll(() => here(page)).toBe('/songs/old-home-place/');
        await songReady(page);
        await ringAround(page, '#key-pill');
        await cardClear(page, '#key-pill');
        await arrowAt(page, '#key-pill');

        await next(page);
        await expect(count(page)).toHaveText('4 of 11');
        await ringAround(page, '#topbar-overflow-btn');           // Lists: ⋯ ▸ Save to list…
        await cardClear(page, '#topbar-overflow-btn');

        await next(page);
        await ringAround(page, '#edit-song-btn');

        // 6-8: the song played into the real editor (its thin band has no nav to ring)
        await next(page);
        await expect.poll(() => here(page)).toBe('/#add');
        await expect.poll(() => leadText(page), { timeout: 20000 })
            .toContain('In the sky, in the sky?');                     // typed to the end
        await expect(page.locator('#editor-title')).toHaveValue('Will the Circle Be Unbroken');

        await next(page);                                               // sections
        await ringAround(page, '.le-selbar:not(.hidden) [data-wrap="verse"]');
        await expect.poll(() => leadText(page), { timeout: 20000 }).toContain('{start_of_chorus');
        expect(await leadText(page)).toContain('{start_of_verse');

        await next(page);                                               // chords
        await ringAround(page, '#editor-mode-chords');
        await expect.poll(() => leadText(page), { timeout: 30000 }).toContain('In the sky, [D]in the [G]sky?');
        const chorded = await leadText(page);
        expect(chorded).toContain('[G]Will the circle be unbroken');
        expect(chorded).toContain('By and [C]by, by and [G]by?');
        // the demo's mode change is not the reader's: nothing remembered
        expect(await page.evaluate(() => localStorage.getItem('bgb-lead-mode'))).toBeNull();

        // 9-11 on the demo tab — leaving the editor asks nothing and keeps nothing
        await next(page);
        await expect(count(page)).toHaveText('9 of 11');
        await ringAround(page, '.tab-play-btn');               // the tab page is up...
        await expect(page.locator('#editor-leave-modal')).toHaveCount(0);   // ...and nothing asked
        expect(await leadText(page)).toBe('');
        await cardClear(page, '.tab-play-btn');
        await arrowAt(page, '.tab-play-btn');
        expect(await here(page)).toBe('/#work/foggy-mountain-breakdown/banjo-tab');

        await next(page);
        await ringAround(page, '#edit-song-btn');                 // the top band's Edit, for a tab too

        // 11: your own .tef — the page itself is the drop zone, outlined
        await next(page);
        await expect(page.locator('.tour-ring.tour-ring-zone')).toBeVisible();
        await expect(page.locator('.tour-body')).toContainText('Drag a .tef file onto any page');
        await cardClear(page, '.tab-play-btn');
        await expect(page.locator('.tour-next')).toHaveText('Done');

        await next(page);
        await expect(card(page)).toHaveCount(0);
        await expect.poll(() => here(page)).toBe('/');
        await expect(page.locator('#landing-page')).toBeVisible();
        await expect(page.locator('.auth-toast')).toContainText('⋯ menu');

        // From now on it lives in ⋯, across reloads
        await page.reload();
        await expect(page.locator('#landing-page')).toBeVisible();
        await expect(tourBtn(page)).toBeHidden();
        await page.click('#topbar-overflow-btn');
        await expect(page.locator('#overflow-tour')).toHaveText('✨ Take the tour');
    });

    test('a first visit to a song page: ⋯ glows instead of a Tour button, and opening the tour stops it', async ({ page }) => {
        await page.goto('/songs/house-of-gold/');
        await songReady(page);
        const more = page.locator('#topbar-overflow-btn');
        await expect(tourBtn(page)).toBeHidden();
        await expect(more).toHaveClass(/tour-invite/);
        expect(await more.evaluate(el => getComputedStyle(el).animationName)).toBe('tour-glow');

        await startTourFromMenu(page);
        await expect(card(page)).toBeVisible();
        await expect(more).not.toHaveClass(/tour-invite/);
        await page.click('.tour-close');
        await page.reload();
        await songReady(page);
        await expect(more).not.toHaveClass(/tour-invite/);
    });

    test('once seen, the tour leads the ⋯ menu, above the page\'s own items', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-tour-seen', '1'));
        await page.goto('/');
        await expect(page.locator('#landing-page')).toBeVisible();
        await page.click('#topbar-overflow-btn');
        await expect(page.locator('#topbar-overflow-menu .pill-popover-item').first())
            .toHaveText('✨ Take the tour');
    });

    test('on a song page the tour is ⋯ ▸ Go to, and stays there after the menu is re-seeded', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-tour-seen', '1'));
        await page.goto('/songs/house-of-gold/');
        await songReady(page);
        // seen: ⋯ no longer glows
        await expect(page.locator('#topbar-overflow-btn')).not.toHaveClass(/tour-invite/);
        await page.click('#topbar-overflow-btn');
        await expect(page.locator('#overflow-tour')).toBeVisible();
        // the tour starts at search, so come back to the song afterwards
        await page.click('#overflow-tour');
        await expect(card(page)).toBeVisible();
        await page.click('.tour-close');
        await page.goBack();
        await songReady(page);
        await page.click('#topbar-overflow-btn');
        await expect(page.locator('#overflow-tour')).toBeVisible();
        await page.click('#report-menu-btn');
        await expect(page.locator('#flag-btn')).toBeVisible();
    });

    test('a ?tour link starts the tour, and leaves the URL', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-tour-seen', '1'));
        await page.goto('/songs/house-of-gold/?tour');
        await expect(card(page)).toBeVisible({ timeout: 20000 });
        await ringAround(page, '#search-input');
        expect(await page.evaluate(() => location.search)).toBe('');
    });

    test('?tour=reset brings the glowing button back without starting anything', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-tour-seen', '1'));
        await page.goto('/');
        await expect(page.locator('#landing-page')).toBeVisible();
        await expect(tourBtn(page)).toBeHidden();
        await page.goto('/?tour=reset');
        await expect(tourBtn(page)).toBeVisible();
        await expect(card(page)).toHaveCount(0);
        expect(await page.evaluate(() => location.search)).toBe('');
        await page.click('#topbar-overflow-btn');
        await expect(page.locator('#overflow-tour')).toHaveCount(0);   // one invitation, not two
    });

    test("started on a song, the tour still searches and shows Old Home Place, and Done goes back to the reader's song", async ({ page }) => {
        await page.goto('/songs/house-of-gold/');
        await songReady(page);
        await startTourFromMenu(page);
        await ringAround(page, '#search-input');
        expect(await here(page)).toBe('/#search');
        await next(page);                               // find
        await next(page);                               // key: the song the search found
        await expect.poll(() => here(page)).toBe('/songs/old-home-place/');
        await ringAround(page, '#key-pill');
        for (let i = 0; i < 2; i++) await next(page);   // lists, edit
        expect(await here(page)).toBe('/songs/old-home-place/');

        for (let i = 0; i < 3; i++) await next(page);   // the editor demo, skipped through
        await next(page);                               // play: the demo tab
        await ringAround(page, '.tab-play-btn');
        await expect(page.locator('#editor-leave-modal')).toHaveCount(0);
        await next(page);                               // tab edit
        await next(page);                               // .tef
        await next(page);                               // Done
        await expect.poll(() => here(page)).toBe('/songs/house-of-gold/');
        await expect(page.locator('.song-title')).toContainText(/house of gold/i);
    });

    test('the reader takes over: a press in the editor stops the demo, and × leaves nothing behind', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-tour-seen', '1'));
        await page.goto('/songs/house-of-gold/?tour');
        await expect(card(page)).toBeVisible({ timeout: 20000 });
        for (let i = 0; i < 5; i++) await next(page);   // write
        await expect.poll(() => leadText(page), { timeout: 20000 }).toContain('loved ones');

        await page.click('#editor-lead .cm-content');   // the reader's own press
        const stopped = await leadText(page);
        await page.waitForTimeout(1200);
        expect(await leadText(page)).toBe(stopped);       // no more typing
        await expect(card(page)).toBeVisible();           // the tour is still there

        await page.click('.tour-close');
        await expect(card(page)).toHaveCount(0);
        expect(await leadText(page)).toBe('');            // the demo song is gone
        await page.click('#topbar-brand');                // and leaving asks nothing
        await expect(page.locator('#landing-page')).toBeVisible();
        await page.waitForTimeout(300);                   // the prompt would open a frame or two later
        await expect(page.locator('#editor-leave-modal')).toHaveCount(0);
    });

    test('the reader takes over the search demo by pressing in the box', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-tour-seen', '1'));
        await page.goto('/?tour');
        await expect(card(page)).toBeVisible({ timeout: 20000 });
        await next(page);                               // find: the demo starts typing
        const box = page.locator('#search-input');
        await expect.poll(() => box.inputValue()).toMatch(/^ten/);
        await box.click();                              // the reader's own press
        const stopped = await box.inputValue();
        await page.waitForTimeout(800);
        expect(await box.inputValue()).toBe(stopped);   // no more typing
        expect(stopped).not.toBe('ten long years since I left my home');
        await expect(card(page)).toBeVisible();         // the tour is still there
    });

    test('whatever the reader opens covers the card; the ring steps aside', async ({ page }) => {
        await page.goto('/songs/house-of-gold/');
        await songReady(page);
        await startTourFromMenu(page);
        await ringAround(page, '#search-input');
        await next(page);                               // find
        await next(page);                               // key, on the song the search found
        await songReady(page);
        await ringAround(page, '#key-pill');

        await page.click('#key-pill .pill-btn');
        const popover = page.locator('#key-pill .pill-popover');
        await expect(popover).toBeVisible();
        await expect(page.locator('.tour-ring')).toBeHidden();
        // The popover is on top wherever the two overlap
        const onTop = await popover.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return el.contains(hit);
        });
        expect(onTop).toBe(true);
        // and the tour is still there when it closes
        await page.keyboard.press('Escape');
        await expect(card(page)).toBeVisible();
    });

    test('wandering off ends the tour; × and Escape end it in place', async ({ page }) => {
        await page.goto('/songs/house-of-gold/');
        await songReady(page);

        await startTourFromMenu(page);
        await ringAround(page, '#search-input');
        await page.click('#topbar-brand');                    // they went home
        await expect(card(page)).toHaveCount(0, { timeout: 5000 });

        await page.goto('/songs/house-of-gold/');
        await songReady(page);
        await page.click('#topbar-overflow-btn');
        await page.click('#overflow-tour');
        await expect(card(page)).toBeVisible();
        await ringAround(page, '#search-input');
        await page.click('.tour-close');
        await expect(card(page)).toHaveCount(0);
        expect(await here(page)).toBe('/#search');            // × ends it where it is

        await page.click('#topbar-overflow-btn');
        await page.click('#overflow-tour');
        await expect(page.locator('.tour-next')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(card(page)).toHaveCount(0);
    });

    test('never pulls a reader out of an editor', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-tour-seen', '1'));
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible();
        await page.click('#topbar-overflow-btn');
        await page.click('#overflow-tour');
        await expect(page.locator('.auth-toast')).toContainText('Finish or close the editor first');
        await expect(card(page)).toHaveCount(0);
        expect(await here(page)).toBe('/#add');
    });

    test('no pulsing for a reader who asked for reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        await expect(tourBtn(page)).toBeVisible();
        expect(await tourBtn(page).evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    });
});
