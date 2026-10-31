// @vitest-environment jsdom
// The tab dock's Display sheet (G19c): it holds the band's controls while it is
// open, and gives every one back, listeners alive, when it closes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playInNote, fillDisplaySheet, buildTempoChip, barsLabel, PLAY, PAUSE, PLAY_LOOP } from '../tab-dock.js';

function band() {
    const controls = document.createElement('div');
    controls.className = 'tab-controls tab-dock';
    controls.innerHTML = `
        <button class="tab-play-btn">▶</button>
        <div class="tab-display-store" hidden>
            <label class="tab-loop-toggle"><input type="checkbox" class="tab-loop-checkbox"> Loop</label>
            <label class="tab-metronome-toggle"><input type="checkbox" class="tab-metronome-checkbox"> Metronome</label>
            <label class="tab-countin-toggle"><input type="checkbox" class="tab-countin-checkbox" checked> Count-in</label>
            <div class="qc-group pill-mode-group tab-repeat-group"><button class="pill-mode-btn" data-val="unrolled">Unrolled</button><button class="pill-mode-btn" data-val="repeats">Repeats</button></div>
            <div class="tab-track-mixer"><label><input type="checkbox" class="track-checkbox" data-track-id="banjo"></label></div>
            <span class="tab-capo-indicator"></span>
        </div>`;
    let idx = 7;
    controls._tabKey = {
        keys: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
        get index() { return idx; },
        capoFor: (i) => (i - 7 + 12) % 12,
        set: vi.fn((i) => { idx = i; }),
    };
    controls._tabDisplay = { size: { canStep: () => true, step: vi.fn() } };
    document.body.appendChild(controls);
    return controls;
}

describe('playInNote', () => {
    it('says the capo, the key played in and that the frets stay put', () => {
        expect(playInNote(2, 'A', 'G')).toBe('Capo 2: playing in A. Frets on the page stay as written (the tab is in G).');
    });
    it('says nothing when there is no capo', () => {
        expect(playInNote(0, 'G', 'G')).toBe('');
    });
});

describe('the play button labels', () => {
    it('are the glyphs, and ▶ Loop when a phrase is armed', () => {
        expect([PLAY, PAUSE, PLAY_LOOP]).toEqual(['▶', '⏸', '▶ Loop']);
    });
});

describe('the Display sheet', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('holds Size, Play in, Layout, Practice, Tracks and Auto-hide, in that order', () => {
        const controls = band();
        const content = document.createElement('div');
        fillDisplaySheet(content, controls);
        const labels = [...content.querySelectorAll('.dock-group-label')].map(l => l.firstChild.textContent.trim());
        expect(labels).toEqual(['Size', 'Play in', 'Layout', 'Practice', 'Tracks']);
        expect(content.querySelector('#tab-size [data-size="1"]')).toBeTruthy();
        expect(content.querySelectorAll('#tab-play-in .pill-key-btn')).toHaveLength(12);
        expect(content.querySelector('#tab-play-in .pill-key-btn.active').textContent).toBe('G');
        expect(content.querySelector('#pill-autohide')).toBeTruthy();
    });

    it('moves the controls out of the band\'s store, and gives every one back on close', () => {
        const controls = band();
        const store = controls.querySelector('.tab-display-store');
        const before = [...store.children];
        const content = document.createElement('div');
        const putBack = fillDisplaySheet(content, controls);
        expect(store.children).toHaveLength(0);
        expect(content.contains(before[0])).toBe(true);
        putBack();
        expect(new Set(store.children)).toEqual(new Set(before));
    });

    it('keeps a moved control\'s listener alive across the trip', () => {
        const controls = band();
        const onChange = vi.fn();
        controls.querySelector('.tab-metronome-checkbox').addEventListener('change', onChange);
        const content = document.createElement('div');
        document.body.appendChild(content);   // a checkbox only fires change when connected
        const putBack = fillDisplaySheet(content, controls);
        content.querySelector('.tab-metronome-checkbox').click();
        expect(onChange).toHaveBeenCalledTimes(1);
        putBack();
        controls.querySelector('.tab-metronome-checkbox').click();
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('Play in picks a key through the band\'s key state', () => {
        const controls = band();
        const content = document.createElement('div');
        fillDisplaySheet(content, controls);
        content.querySelector('#tab-play-in [data-idx="9"]').click();
        expect(controls._tabKey.set).toHaveBeenCalledWith(9);
        expect(content.querySelector('#tab-play-in .pill-key-btn.active').textContent).toBe('A');
    });

    it('leaves out the groups the tab does not have (no reading list, one track)', () => {
        const controls = band();
        controls.querySelector('.tab-repeat-group').remove();
        controls.querySelector('.tab-track-mixer').remove();
        const content = document.createElement('div');
        fillDisplaySheet(content, controls);
        const labels = [...content.querySelectorAll('.dock-group-label')].map(l => l.firstChild.textContent.trim());
        expect(labels).toEqual(['Size', 'Play in', 'Practice']);
    });
});

describe('the tempo chip (a tab in a set list)', () => {
    function listBand() {
        const controls = document.createElement('div');
        controls.className = 'tab-controls tab-dock';
        controls.innerHTML = `
            <span class="dock-tempo tab-tempo-group"><button class="tab-tempo-down">−</button><span class="tab-tempo-display">120</span><button class="tab-tempo-up">+</button></span>
            <div class="tab-display-store" hidden></div>`;
        document.body.appendChild(controls);
        return controls;
    }
    beforeEach(() => { document.body.innerHTML = ''; });

    it('takes the stepper\'s place in the dock and shows ♩ and its number', () => {
        const controls = listBand();
        const chip = buildTempoChip(controls);
        expect(controls.firstElementChild).toBe(chip);
        expect(chip.textContent.replace(/\s+/g, ' ').trim()).toBe('♩ 120');
        // the stepper is still in the band, for the player to find
        expect(controls.querySelector('.tab-display-store .tab-tempo-group')).toBeTruthy();
        expect(controls.querySelector('.tab-tempo-display').textContent).toBe('120');
    });

    it('opens a sheet holding the stepper, and puts it back on close', () => {
        const controls = listBand();
        const chip = buildTempoChip(controls);
        const onUp = vi.fn();
        controls.querySelector('.tab-tempo-up').addEventListener('click', onUp);
        chip.click();
        const sheet = document.querySelector('#dock-tempo-sheet');
        expect(sheet.querySelector('.tab-tempo-group')).toBeTruthy();
        sheet.querySelector('.tab-tempo-up').click();
        expect(onUp).toHaveBeenCalledOnce();   // the player's listener rides along
        document.querySelector('.notes-sheet-close').click();
        expect(document.querySelector('#dock-tempo-sheet')).toBeNull();
        expect(controls.querySelector('.tab-display-store .tab-tempo-group')).toBeTruthy();
    });

    it('follows the number the player writes', async () => {
        const controls = listBand();
        const chip = buildTempoChip(controls);
        controls.querySelector('.tab-tempo-display').textContent = '135';
        await Promise.resolve();   // MutationObserver callbacks are microtasks
        expect(chip.textContent).toContain('135');
        expect(chip.getAttribute('aria-label')).toBe('Tempo 135, change');
    });
});

describe('Bars per row row (G22)', () => {
    const mount = (fit) => {
        const controls = band();
        const state = { fit };
        controls._tabDisplay.bars = {
            fit: () => state.fit,
            step: vi.fn((dir) => { state.fit = { ...state.fit, offset: state.fit.offset + dir, count: state.fit.count + dir }; }),
            reset: vi.fn(() => { state.fit = { ...state.fit, offset: 0, count: state.fit.auto }; }),
        };
        const content = document.createElement('div');
        document.body.appendChild(content);
        fillDisplaySheet(content, controls);
        return { content, controls };
    };

    it('words the label', () => {
        expect(barsLabel({ auto: 4, count: 4, offset: 0 })).toBe('Auto (4)');
        expect(barsLabel({ auto: 4, count: 5, offset: 1 })).toBe('5 (auto +1)');
        expect(barsLabel({ auto: 4, count: 2, offset: -2 })).toBe('2 (auto −2)');
    });

    it('steps, shows the count and resets with Auto', () => {
        const { content } = mount({ auto: 4, count: 4, offset: 0, lo: -3, hi: 2 });
        const label = content.querySelector('#tab-bars-auto');
        expect(label.textContent).toBe('Auto (4)');
        expect(label.disabled).toBe(true);
        content.querySelector('[data-bars="1"]').click();
        expect(label.textContent).toBe('5 (auto +1)');
        content.querySelector('[data-bars="1"]').click();
        expect(content.querySelector('[data-bars="1"]').disabled).toBe(true);   // at the top
        label.click();
        expect(label.textContent).toBe('Auto (4)');
    });

    it('disables the low end', () => {
        const { content } = mount({ auto: 1, count: 1, offset: 0, lo: 0, hi: 2 });
        expect(content.querySelector('[data-bars="-1"]').disabled).toBe(true);
        expect(content.querySelector('[data-bars="1"]').disabled).toBe(false);
    });
});
