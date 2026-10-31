// A song opened from a set list (G19c): ← names the list, and the bottom dock
// starts with ‹ 2 of 9 ›. The old second bar (#song-nav-bar) is gone. ←/→ on
// the keyboard step through the list, except while typing. A tab in a list
// swaps its Tempo stepper for a ♩ chip so the dock still fits at 360px.
import { test, expect } from './fixtures.js';
import { openMenu, serveWithoutTabs } from './helpers.js';
import { pressTabEdit } from './helpers/tab-edit.js';
import { songReady } from './helpers/tour.js';

const LIST = 'l1';
const SONGS = ['old-home-place', 'foggy-mountain-breakdown/banjo-tab', 'wagon-wheel', 'blue-grass-breakdown', 'arkansas-traveler-1'];

test.beforeEach(async ({ page }) => {
    await page.addInitScript(([id, songs]) => {
        if (localStorage.getItem('songbook-lists')) return;
        localStorage.setItem('songbook-lists', JSON.stringify([
            { id, name: 'Friday Jam', songs, created: 1, updated: 1 },
        ]));
    }, [LIST, SONGS]);
});

const open = async (page, ref) => {
    await page.goto(`/#list/${LIST}/${ref}`);
    await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#list-pill')).toBeVisible({ timeout: 15000 });
};
const pos = (page) => page.locator('#list-pill .list-pos');
const prev = (page) => page.locator('#list-pill .list-prev');
const next = (page) => page.locator('#list-pill .list-next');

test.describe('the pill and the back label', () => {
    test('a lyric page shows ← Friday Jam and ‹ 2 of 5 › in the dock', async ({ page }) => {
        await open(page, 'wagon-wheel');
        await expect(page.locator('#topbar-back .topbar-back-label')).toHaveText('Friday Jam');
        await expect(pos(page)).toHaveText('3 of 5');
        await expect(page.locator('#app-bottomband #list-pill')).toBeVisible();
        // the pill leads the dock
        await expect(page.locator('.reading-dock').first().locator('> *').first()).toHaveId('list-pill');
        await expect(page.locator('#dock-display-btn')).toBeVisible();
    });

    test('the old list bar is gone, and so is its class', async ({ page }) => {
        await open(page, 'wagon-wheel');
        await expect(page.locator('#song-nav-bar')).toHaveCount(0);
        await expect(page.locator('#exit-fullscreen-btn')).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/has-list-context/);
    });

    test('a song that is not from a list has no pill and a plain back', async ({ page }) => {
        await page.goto('/#work/old-home-place');
        await songReady(page);
        await expect(page.locator('#list-pill')).toHaveCount(0);
        await expect(page.locator('#topbar-back .topbar-back-label')).toBeHidden();
    });

    test('prev and next step through the list, and are disabled at the ends', async ({ page }) => {
        await open(page, 'old-home-place');
        await expect(pos(page)).toHaveText('1 of 5');
        await expect(prev(page)).toBeDisabled();
        await next(page).click();
        await expect(pos(page)).toHaveText('2 of 5');
        await expect(page.locator('.tablature-container').first()).toBeVisible({ timeout: 20000 });
        await next(page).click();
        await expect(pos(page)).toHaveText('3 of 5');
        await expect(page).toHaveURL(/wagon-wheel/);
        await prev(page).click();
        await expect(pos(page)).toHaveText('2 of 5');

        await open(page, 'arkansas-traveler-1');
        await expect(pos(page)).toHaveText('5 of 5');
        await expect(next(page)).toBeDisabled();
        await expect(prev(page)).toBeEnabled();
    });

    test('the middle goes back to the list, from the first song and after stepping', async ({ page }) => {
        await open(page, 'old-home-place');
        await page.goto('/#list/l1');       // the list, then into a song, the way a tap does
        await page.locator('.result-item').first().click();
        await expect(pos(page)).toHaveText('1 of 5');
        await pos(page).click();
        await expect(page).toHaveURL(/#list\/l1$/);
        await expect(page.locator('#song-view')).toBeHidden();

        await page.locator('.result-item').first().click();
        await next(page).click();
        await expect(pos(page)).toHaveText('2 of 5');
        await next(page).click();
        await expect(pos(page)).toHaveText('3 of 5');
        await page.locator('#topbar-back').click();     // ← does the same
        await expect(page).toHaveURL(/#list\/l1$/);
        await expect(page.locator('#song-view')).toBeHidden();
    });

    test('Song notes is still in ⋯ ▸ This song', async ({ page }) => {
        await open(page, 'wagon-wheel');
        const menu = await openMenu(page);
        await expect(menu.locator('#song-notes-btn')).toBeVisible();
    });

    test('a placeholder gets a dock with just the pill', async ({ page }) => {
        await open(page, 'blue-grass-breakdown');
        await expect(page.locator('.placeholder-badge')).toBeVisible();
        const dock = page.locator('#app-bottomband .reading-dock');
        await expect(dock.locator('> *')).toHaveCount(1);
        await expect(pos(page)).toHaveText('4 of 5');
        await next(page).click();
        await expect(pos(page)).toHaveText('5 of 5');
    });

    test('an ABC song in a list: the pill leads the notation dock', async ({ page }) => {
        await open(page, 'arkansas-traveler-1');
        await expect(page.locator('#abc-play-btn')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.abc-dock > *').first()).toHaveId('list-pill');
    });
});

test.describe('← and → keys', () => {
    test('step through the list', async ({ page }) => {
        await open(page, 'old-home-place');
        await page.locator('body').click({ position: { x: 5, y: 300 } });
        await page.keyboard.press('ArrowRight');
        await expect(pos(page)).toHaveText('2 of 5');
        await page.keyboard.press('ArrowLeft');
        await expect(pos(page)).toHaveText('1 of 5');
    });

    test('do nothing in an input, and Alt+← is left to the browser', async ({ page }) => {
        await open(page, 'old-home-place');
        await page.locator('#topbar-search').click();       // the search box takes focus
        await expect(page.locator('#search-input')).toBeVisible();
        await page.goto('/#list/l1/old-home-place');
        await expect(pos(page)).toBeVisible();
        // a stray text field on the page
        await page.evaluate(() => {
            const i = document.createElement('input');
            i.id = 'stray';
            document.body.appendChild(i);
            i.focus();
        });
        await page.keyboard.press('ArrowRight');
        await expect(pos(page)).toHaveText('1 of 5');
        await page.evaluate(() => document.getElementById('stray').remove());
        await page.keyboard.press('Alt+ArrowRight');
        await expect(pos(page)).toHaveText('1 of 5');
    });

    test('do nothing inside a contenteditable or CodeMirror', async ({ page }) => {
        await open(page, 'old-home-place');
        await page.evaluate(() => {
            const d = document.createElement('div');
            d.id = 'stray'; d.contentEditable = 'true'; d.textContent = 'x'; d.tabIndex = 0;
            document.body.appendChild(d);
            d.focus();
        });
        await page.keyboard.press('ArrowRight');
        await expect(pos(page)).toHaveText('1 of 5');
        await page.evaluate(() => {
            document.getElementById('stray').remove();
            const cm = document.createElement('div');
            cm.className = 'cm-editor';
            cm.innerHTML = '<button id="stray2">b</button>';
            document.body.appendChild(cm);
            document.getElementById('stray2').focus();
        });
        await page.keyboard.press('ArrowRight');
        await expect(pos(page)).toHaveText('1 of 5');
    });

    test('do nothing in the tab editor, with focus on its canvas or off it', async ({ page }) => {
        await open(page, 'foggy-mountain-breakdown/banjo-tab');
        await expect(page.locator('.tablature-container').first()).toBeVisible({ timeout: 20000 });
        await expect(pos(page)).toHaveText('2 of 5');
        await pressTabEdit(page, { waitForEditor: true });
        await page.locator('.editor-canvas-container').first().focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await expect(page).toHaveURL(/foggy-mountain-breakdown/);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ArrowRight');
        await expect(page).toHaveURL(/foggy-mountain-breakdown/);
        await expect(page.locator('.editor-renderer .stave-row').first()).toBeVisible();
    });
});

for (const width of [360, 390]) {
    test.describe(`a tab in a list at ${width}px`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('is ‹ 2 of 5 › · ▶ · ♩ chip · View · Display on one row; the chip steps the tempo', async ({ page }) => {
            await open(page, 'foggy-mountain-breakdown/banjo-tab');
            await expect(page.locator('.tablature-container').first()).toBeVisible({ timeout: 20000 });
            const band = page.locator('#app-bottomband');
            for (const sel of ['#list-pill', '.tab-play-btn', '#dock-tempo-chip', '#dock-view-btn', '#dock-display-btn']) {
                await expect(band.locator(sel), sel).toBeVisible();
            }
            await expect(band.locator('.dock-tempo')).toBeHidden();      // the stepper waits in the store
            const rects = await band.locator('.tab-controls').evaluate(el => ({
                sw: el.scrollWidth, cw: el.clientWidth,
                kids: [...el.children].filter(k => k.getBoundingClientRect().width > 0 && !k.classList.contains('tab-position'))
                    .map(k => { const r = k.getBoundingClientRect(); return { l: r.left, r: r.right, mid: r.top + r.height / 2 }; }),
            }));
            expect(rects.sw).toBeLessThanOrEqual(rects.cw + 1);
            expect(rects.kids.length).toBeGreaterThanOrEqual(5);
            for (const k of rects.kids) {
                expect(k.l).toBeGreaterThanOrEqual(0);
                expect(k.r).toBeLessThanOrEqual(width);
            }
            expect(Math.max(...rects.kids.map(k => k.mid)) - Math.min(...rects.kids.map(k => k.mid))).toBeLessThanOrEqual(1);

            const start = Number((await page.locator('.tab-tempo-display').textContent()));
            await page.locator('#dock-tempo-chip').click();
            const sheet = page.locator('#dock-tempo-sheet');
            await expect(sheet).toBeVisible();
            await sheet.locator('.tab-tempo-up').click();
            await expect(sheet.locator('.tab-tempo-display')).toHaveText(String(start + 5));
            await expect(page.locator('#dock-tempo-chip')).toContainText(String(start + 5));
            await page.keyboard.press('Escape');
            await expect(sheet).toHaveCount(0);
            await expect(page.locator('#dock-tempo-chip')).toContainText(String(start + 5));
        });
    });
}

test.describe('a tab not in a list', () => {
    test('keeps its Tempo − n + stepper and has no chip or pill', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/banjo-tab');
        await expect(page.locator('.tablature-container').first()).toBeVisible({ timeout: 20000 });
        await expect(page.locator('#app-bottomband .tab-tempo-up')).toBeVisible();
        await expect(page.locator('#dock-tempo-chip')).toHaveCount(0);
        await expect(page.locator('#list-pill')).toHaveCount(0);
    });
});

for (const width of [360, 390]) {
    test.describe(`the lyric dock in a list at ${width}px`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('pill · Key · Size · View ▾ · Display fit on one row (View is the sheet, not Lyrics | Chart)', async ({ page }) => {
            // Old Home Place gained a banjo tab (#350), which would make View ▾ on its own;
            // without it, this checks the narrow-list rule itself
            await serveWithoutTabs(page, 'old-home-place');
            await open(page, 'old-home-place');
            await songReady(page);
            await expect(page.locator('#dock-view-btn')).toBeVisible();
            await expect(page.locator('#dock-view')).toHaveCount(0);
            // every control, not just the dock's own children: a segmented control clips what does not fit
            const boxes = await page.locator('#app-bottomband').evaluate(el => [...el.querySelectorAll('button')]
                .filter(b => b.getBoundingClientRect().width > 0)
                .map(b => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, t: Math.round(r.top + r.height / 2) }; }));
            expect(boxes.length).toBeGreaterThanOrEqual(8);
            for (const b of boxes) {
                expect(b.l).toBeGreaterThanOrEqual(0);
                expect(b.r).toBeLessThanOrEqual(width);
            }
            expect(Math.max(...boxes.map(b => b.t)) - Math.min(...boxes.map(b => b.t))).toBeLessThanOrEqual(2);
        });
    });
}

test.describe('the lyric dock in a list on a wide screen', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('keeps the Lyrics | Chart segments beside the pill', async ({ page }) => {
        await serveWithoutTabs(page, 'old-home-place');   // lyrics + chart only (#350 added a tab)
        await open(page, 'old-home-place');
        await songReady(page);
        await expect(page.locator('#dock-view')).toBeVisible();
        await expect(page.locator('.reading-dock > *').first()).toHaveId('list-pill');
    });
});

for (const width of [360, 390]) {
    test.describe(`the notation dock in a list at ${width}px`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('pill · ▶ · Tempo · Size · View fit on one row', async ({ page }) => {
            await open(page, 'arkansas-traveler-1');
            await expect(page.locator('#abc-play-btn')).toBeVisible({ timeout: 15000 });
            const boxes = await page.locator('#app-bottomband').evaluate(el => [...el.querySelectorAll('button')]
                .filter(b => b.getBoundingClientRect().width > 0)
                .map(b => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, t: Math.round(r.top + r.height / 2) }; }));
            for (const b of boxes) {
                expect(b.l).toBeGreaterThanOrEqual(0);
                expect(b.r).toBeLessThanOrEqual(width);
            }
            expect(Math.max(...boxes.map(b => b.t)) - Math.min(...boxes.map(b => b.t))).toBeLessThanOrEqual(2);
        });
    });
}

test.describe('the top dock with a long list name at 360px', () => {
    test.use({ viewport: { width: 360, height: 800 } });

    test('← Friday Jam, Oct 3 leaves room for Edit and ⋯', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('songbook-lists', JSON.stringify([
            { id: 'l2', name: 'Friday Jam, Oct 3', songs: ['old-home-place', 'wagon-wheel'], created: 1, updated: 1 },
        ])));
        await page.goto('/#list/l2/old-home-place');
        await expect(page.locator('#list-pill')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#topbar-back .topbar-back-label')).toHaveText('Friday Jam, Oct 3');
        for (const sel of ['#topbar-back', '#topbar-brand', '#topbar-search', '#edit-song-btn', '#topbar-overflow-btn']) {
            const box = await page.locator(sel).boundingBox();
            expect(box.x, sel).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width, sel).toBeLessThanOrEqual(360);
        }
    });
});
