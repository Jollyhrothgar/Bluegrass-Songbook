// Phone settings sheet for the tablature band. The point of the module is
// that controls are MOVED, not rebuilt — so every test here checks that the
// listeners work-view.js attached once still fire from the sheet, and that
// widening the viewport puts the band back exactly as it was.
import { describe, it, expect, beforeEach } from 'vitest';
import { attachTabControlsSheet } from '../tab-controls-sheet.js';

function fakeMedia(matches) {
    const listeners = [];
    return {
        matches,
        addEventListener: (_type, fn) => listeners.push(fn),
        removeEventListener: (_type, fn) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        },
        setMatches(v) {
            this.matches = v;
            listeners.slice().forEach(fn => fn({ matches: v }));
        },
    };
}

// Mirrors createTablatureControls' markup (a two-track work, so the mixer,
// repeat group and feel group are all present).
function buildControls() {
    const el = document.createElement('div');
    el.className = 'tab-controls';
    el.innerHTML = `
        <div class="qc-group tab-size-group">
            <button class="tab-size-down qc-btn">−</button>
            <span class="qc-label">Aa</span>
            <button class="tab-size-up qc-btn">+</button>
        </div>
        <div class="qc-group qc-key-group">
            <button class="tab-key-down qc-btn">−</button>
            <div class="pill tab-key-pill"><button class="pill-btn">G</button></div>
            <button class="tab-key-up qc-btn">+</button>
        </div>
        <div class="qc-group tab-tempo-group">
            <button class="tab-tempo-down qc-btn">−</button>
            <span class="qc-label tab-tempo-display">100</span>
            <button class="tab-tempo-up qc-btn">+</button>
        </div>
        <button class="tab-play-btn qc-toggle-btn">▶ Play</button>
        <button class="tab-stop-btn qc-toggle-btn" disabled>⏹ Stop</button>
        <button class="tab-edit-btn qc-toggle-btn">✏️ Edit</button>
        <label class="tab-metronome-toggle"><input type="checkbox" class="tab-metronome-checkbox"></label>
        <label class="tab-countin-toggle"><input type="checkbox" class="tab-countin-checkbox" checked></label>
        <label class="tab-loop-toggle"><input type="checkbox" class="tab-loop-checkbox"></label>
        <div class="qc-group pill-mode-group tab-repeat-group"><button class="pill-mode-btn">Unrolled</button></div>
        <div class="qc-group pill-mode-group tab-feel-group"><button class="pill-mode-btn">Four feel</button></div>
        <span class="tab-position"></span>
        <span class="tab-capo-indicator"></span>
        <div class="tab-track-mixer"><label class="track-toggle"><input type="checkbox" class="track-checkbox" data-track-id="banjo"></label></div>
    `;
    document.body.appendChild(el);
    return el;
}

const bandClasses = (controls) => [...controls.children]
    .map(c => c.className)
    .filter(c => !c.includes('tab-settings-sheet') && !c.includes('tab-more-btn'));

let controls;
let sheetApi;

beforeEach(() => {
    document.body.innerHTML = '';
    controls = buildControls();
});

describe('tab settings sheet — phone', () => {
    beforeEach(() => {
        sheetApi = attachTabControlsSheet(controls, fakeMedia(true));
    });

    it('leaves only the performance controls on the band', () => {
        const direct = bandClasses(controls);
        expect(direct.some(c => c.includes('tab-play-btn'))).toBe(true);
        expect(direct.some(c => c.includes('tab-stop-btn'))).toBe(true);
        expect(direct.some(c => c.includes('tab-tempo-group'))).toBe(true);
        expect(direct.some(c => c.includes('tab-loop-toggle'))).toBe(true);
        expect(direct.some(c => c.includes('tab-position'))).toBe(true);
        expect(direct.length).toBe(5);
    });

    it('moves everything else into the sheet', () => {
        const sheet = controls.querySelector('.tab-settings-sheet');
        for (const sel of ['.tab-size-group', '.qc-key-group', '.tab-repeat-group',
            '.tab-feel-group', '.tab-metronome-toggle', '.tab-countin-toggle',
            '.tab-track-mixer', '.tab-edit-btn', '.tab-capo-indicator']) {
            expect(sheet.querySelector(sel), sel).toBeTruthy();
        }
    });

    it('keeps the controls addressable from the band root', () => {
        // setupTablaturePlayer queries `controls`, not the band's children
        expect(controls.querySelector('.tab-size-down')).toBeTruthy();
        expect(controls.querySelectorAll('.track-checkbox').length).toBe(1);
    });

    it('preserves listeners across the move', () => {
        // Fresh controls so the listener predates the re-parent
        document.body.innerHTML = '';
        const fresh = buildControls();
        let clicks = 0;
        fresh.querySelector('.tab-size-down').addEventListener('click', () => clicks++);
        attachTabControlsSheet(fresh, fakeMedia(true));
        fresh.querySelector('.tab-settings-sheet .tab-size-down').click();
        expect(clicks).toBe(1);
    });

    it('labels every row it filled and hides the ones it did not', () => {
        const shown = [...controls.querySelectorAll('.tab-sheet-row:not(.hidden) .tab-sheet-label')]
            .map(el => el.textContent);
        expect(shown).toEqual(['Size', 'Key', 'Layout', 'Feel', 'Practice', 'Tracks', 'Tab']);

        document.body.innerHTML = '';
        const bare = buildControls();
        bare.querySelector('.tab-track-mixer').remove();
        bare.querySelector('.tab-feel-group').remove();
        attachTabControlsSheet(bare, fakeMedia(true));
        const bareRows = [...bare.querySelectorAll('.tab-sheet-row:not(.hidden) .tab-sheet-label')]
            .map(el => el.textContent);
        expect(bareRows).toEqual(['Size', 'Key', 'Layout', 'Practice', 'Tab']);
    });
});

describe('tab settings sheet — open/close', () => {
    let moreBtn;
    let sheet;

    beforeEach(() => {
        sheetApi = attachTabControlsSheet(controls, fakeMedia(true));
        moreBtn = controls.querySelector('.tab-more-btn');
        sheet = controls.querySelector('.tab-settings-sheet');
    });

    it('wires aria-expanded and aria-controls', () => {
        expect(moreBtn.getAttribute('aria-controls')).toBe(sheet.id);
        expect(moreBtn.getAttribute('aria-expanded')).toBe('false');
        moreBtn.click();
        expect(moreBtn.getAttribute('aria-expanded')).toBe('true');
        expect(sheet.classList.contains('hidden')).toBe(false);
    });

    it('toggles closed on a second tap', () => {
        moreBtn.click();
        moreBtn.click();
        expect(sheetApi.isOpen()).toBe(false);
    });

    it('closes on Escape', () => {
        moreBtn.click();
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(sheetApi.isOpen()).toBe(false);
    });

    it('closes on an outside click but not an inside one', () => {
        moreBtn.click();
        sheet.querySelector('.tab-size-down').click();
        expect(sheetApi.isOpen()).toBe(true);
        document.body.click();
        expect(sheetApi.isOpen()).toBe(false);
    });

    it('closes when Edit hands the band to the editor', () => {
        moreBtn.click();
        sheet.querySelector('.tab-edit-btn').click();
        expect(sheetApi.isOpen()).toBe(false);
    });
});

describe('tab settings sheet — desktop and breakpoint crossing', () => {
    it('inserts nothing while the media query does not match', () => {
        const before = [...controls.children];
        attachTabControlsSheet(controls, fakeMedia(false));
        expect(controls.querySelector('.tab-settings-sheet')).toBeNull();
        expect(controls.querySelector('.tab-more-btn')).toBeNull();
        expect([...controls.children]).toEqual(before);
    });

    it('restores the exact band DOM when the viewport widens', () => {
        const before = bandClasses(controls);
        const mq = fakeMedia(true);
        attachTabControlsSheet(controls, mq);
        expect(bandClasses(controls).length).toBe(5);

        mq.setMatches(false);
        expect(bandClasses(controls)).toEqual(before);
        expect(controls.querySelector('.tab-settings-sheet')).toBeNull();
        expect(controls.querySelector('.tab-more-btn')).toBeNull();
    });

    it('re-collapses when the viewport narrows again, sheet closed', () => {
        const mq = fakeMedia(false);
        const api = attachTabControlsSheet(controls, mq);
        mq.setMatches(true);
        controls.querySelector('.tab-more-btn').click();
        expect(api.isOpen()).toBe(true);

        mq.setMatches(false);
        mq.setMatches(true);
        expect(api.isOpen()).toBe(false);
        expect(bandClasses(controls).length).toBe(5);
    });

    it('keeps checkbox state through a round trip', () => {
        const mq = fakeMedia(false);
        attachTabControlsSheet(controls, mq);
        const box = controls.querySelector('.tab-metronome-checkbox');
        box.checked = true;
        mq.setMatches(true);
        mq.setMatches(false);
        expect(controls.querySelector('.tab-metronome-checkbox').checked).toBe(true);
    });

    it('drops the previous band listeners when a re-render replaces it', () => {
        const first = attachTabControlsSheet(controls, fakeMedia(true));
        controls.querySelector('.tab-more-btn').click();
        expect(first.isOpen()).toBe(true);

        const next = buildControls();
        attachTabControlsSheet(next, fakeMedia(true));
        // The old handlers are gone, so the orphaned sheet stops reacting
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(first.isOpen()).toBe(true);
        expect(next.querySelector('.tab-settings-sheet')).toBeTruthy();
    });
});
