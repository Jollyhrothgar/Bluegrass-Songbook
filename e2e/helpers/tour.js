// Shared by tour.spec.js and tour-mobile.spec.js.
import { expect } from '@playwright/test';

export const songReady = (page) =>
    expect(page.locator('#song-content .prerender')).toHaveCount(0, { timeout: 20000 });

export const here = (page) => page.evaluate(() => location.pathname + location.hash);

export const next = (page) => page.click('.tour-next');

/** The first on-screen element for a selector, as a plain box (or null). */
function boxOf(sel) {
    const el = [...document.querySelectorAll(sel)]
        .find(e => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const { left, top, right, bottom } = el.getBoundingClientRect();
    return { left, top, right, bottom };
}

/** The ring is drawn, and it encloses the control. */
export async function ringAround(page, selector) {
    await expect.poll(() => page.evaluate(([sel, boxOfSrc]) => {
        const box = new Function(`return ${boxOfSrc}`)();
        const ring = document.querySelector('.tour-ring');
        const t = box(sel);
        if (!ring || ring.classList.contains('hidden') || !t) return false;
        const r = ring.getBoundingClientRect();
        return r.left <= t.left && r.top <= t.top && r.right >= t.right && r.bottom >= t.bottom;
    }, [selector, boxOf.toString()]), { timeout: 20000, message: `ring around ${selector}` }).toBe(true);
}

/** Let the card's arrival animation finish: it slides and scales in, so
 *  its box is only where it will stay once the animation is over. */
async function settled(page) {
    await page.locator('.tour-card').evaluate(el =>
        Promise.all(el.getAnimations().map(a => a.finished)));
}

/** The card covers neither the control it points at nor either band. */
export async function cardClear(page, selector) {
    await settled(page);
    const overlaps = await page.evaluate(([sel, boxOfSrc]) => {
        const box = new Function(`return ${boxOfSrc}`)();
        const c = box('.tour-card');
        const hits = (o) => !!o && c.left < o.right && c.right > o.left && c.top < o.bottom && c.bottom > o.top;
        return {
            target: hits(box(sel)),
            topBand: hits(box('#app-topbar')),
            bottomBand: hits(box('#app-bottomband:not(.hidden)')),
        };
    }, [selector, boxOf.toString()]);
    expect(overlaps).toEqual({ target: false, topBand: false, bottomBand: false });
}

/** The card's arrow sits under the control's centre (or as close as the card's corners allow). */
export async function arrowAt(page, selector) {
    await settled(page);
    const { arrowX, centre, cardLeft, cardRight } = await page.evaluate(([sel, boxOfSrc]) => {
        const box = new Function(`return ${boxOfSrc}`)();
        const card = document.querySelector('.tour-card');
        const c = card.getBoundingClientRect();
        const t = box(sel);
        return {
            arrowX: c.left + parseFloat(card.style.getPropertyValue('--tour-arrow-x')),
            centre: (t.left + t.right) / 2,
            cardLeft: c.left,
            cardRight: c.right,
        };
    }, [selector, boxOf.toString()]);
    const reachable = Math.max(cardLeft + 16, Math.min(centre, cardRight - 16));
    expect(Math.abs(arrowX - reachable)).toBeLessThanOrEqual(2);
}

/** The lyrics & chords editor's text (its test hook), or null when it is not mounted. */
export const leadText = (page) =>
    page.evaluate(() => document.getElementById('editor-lead')?.__lead?.getText() ?? null);
