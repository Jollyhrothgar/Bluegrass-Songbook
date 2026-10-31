// @vitest-environment jsdom
// The tab dock's Display sheet (G19c): it holds the band's controls while it is
// open, and gives every one back, listeners alive, when it closes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playInNote, fillDisplaySheet, PLAY, PAUSE, PLAY_LOOP } from '../tab-dock.js';

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
