// The phone's track switcher: the track name above the tab becomes a
// "Mandolin ▾ 1 of 4" button that lists the tracks. Desktop and one-track
// files are left exactly as the renderer drew them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackSwitcher, trackSwitcherLabel } from '../../otf-editor/track-switcher.js';

const mkState = (ids, trackId = ids[0]) => ({
    trackId,
    getTracks() { return this.ids.map(id => ({ id })); },
    ids,
    setTrack: vi.fn(function (id) { this.trackId = id; return true; }),
});

/** What the renderer draws: <div.track-info><strong>name</strong>…</div> */
function trackInfo(name) {
    const info = document.createElement('div');
    info.className = 'track-info';
    info.innerHTML = '<strong></strong><span class="tuning-display">E A D G</span>';
    info.querySelector('strong').textContent = name;
    document.body.appendChild(info);
    return info;
}

describe('trackSwitcherLabel', () => {
    it('is null for one track (no arrow, no count)', () => {
        expect(trackSwitcherLabel([{ id: 'banjo' }], 'banjo')).toBeNull();
    });
    it('names the active track and its place', () => {
        const tracks = ['mandolin', 'banjo', 'fiddle', 'bass'].map(id => ({ id }));
        expect(trackSwitcherLabel(tracks, 'mandolin')).toBe('mandolin ▾ 1 of 4');
        expect(trackSwitcherLabel(tracks, 'fiddle')).toBe('fiddle ▾ 3 of 4');
    });
});

describe('TrackSwitcher', () => {
    let phone, onChoose;
    beforeEach(() => {
        document.body.innerHTML = '';
        phone = true;
        onChoose = vi.fn();
    });
    const make = (state) => new TrackSwitcher({ state, isPhone: () => phone, onChoose });

    it('turns the name into a labelled button on a phone with 2+ tracks', () => {
        const info = trackInfo('mandolin');
        make(mkState(['mandolin', 'banjo'])).decorate(info);
        const btn = info.querySelector('button.track-switcher-button');
        expect(btn.textContent).toBe('mandolin ▾ 1 of 2');
        expect(btn.getAttribute('aria-haspopup')).toBe('true');
        expect(btn.getAttribute('aria-expanded')).toBe('false');
        expect(info.querySelector('.tuning-display')).not.toBeNull();
    });

    it('leaves a one-track file and a wide screen alone', () => {
        const one = trackInfo('banjo');
        make(mkState(['banjo'])).decorate(one);
        expect(one.querySelector('button')).toBeNull();
        expect(one.querySelector('strong').textContent).toBe('banjo');

        phone = false;
        const wide = trackInfo('banjo');
        make(mkState(['banjo', 'fiddle'])).decorate(wide);
        expect(wide.querySelector('button')).toBeNull();
    });

    it('lists the tracks with a check on the current one; choosing switches', () => {
        const state = mkState(['mandolin', 'banjo', 'fiddle'], 'banjo');
        const info = trackInfo('banjo');
        make(state).decorate(info);
        const btn = info.querySelector('button');
        btn.click();
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        const items = [...info.querySelectorAll('.track-switcher-list [role="menuitemradio"]')];
        expect(items.map(i => i.textContent.replace('✓', '').trim()))
            .toEqual(['mandolin', 'banjo', 'fiddle']);
        expect(items.map(i => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
        items[2].click();
        expect(state.setTrack).toHaveBeenCalledWith('fiddle');
        expect(onChoose).toHaveBeenCalled();
        expect(info.querySelector('.track-switcher-list')).toBeNull();
    });

    it('follows a rename and a delete (the list is read fresh each time)', () => {
        const state = mkState(['mandolin', 'banjo', 'fiddle']);
        const sw = make(state);
        let info = trackInfo('mandolin');
        sw.decorate(info);

        state.ids = ['mandolin', 'banjo-2', 'fiddle'];           // rename
        info.querySelector('button').click();
        expect([...info.querySelectorAll('[role="menuitemradio"]')].map(i => i.textContent))
            .toContain('banjo-2');

        state.ids = ['mandolin', 'fiddle'];                       // delete
        info = trackInfo('mandolin');                             // renderer redraws
        sw.decorate(info);
        expect(info.querySelector('button').textContent).toBe('mandolin ▾ 1 of 2');

        state.ids = ['mandolin'];                                 // delete again
        info = trackInfo('mandolin');
        sw.decorate(info);
        expect(info.querySelector('button')).toBeNull();
    });

    it('closes on Escape and on a tap outside', () => {
        const info = trackInfo('mandolin');
        make(mkState(['mandolin', 'banjo'])).decorate(info);
        const btn = info.querySelector('button');
        btn.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(info.querySelector('.track-switcher-list')).toBeNull();
        expect(btn.getAttribute('aria-expanded')).toBe('false');

        btn.click();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(info.querySelector('.track-switcher-list')).toBeNull();
    });
});
