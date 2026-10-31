// The track switcher (G20a phone editor, G23 read view): the track name above the tab becomes a
// "Mandolin ▾ 1 of 4" button that lists the tracks. Desktop and one-track
// files are left exactly as the renderer drew them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackSwitcher, trackSwitcherLabel, friendlyTrackName } from '../track-switcher.js';

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
    let phone;
    beforeEach(() => {
        document.body.innerHTML = '';
        phone = true;
    });
    // The tab editor's adapter (otf-editor/editor.js)
    const make = (state, extra) => new TrackSwitcher({
        getTracks: () => state.getTracks(),
        getActive: () => state.trackId,
        choose: (id) => state.setTrack(id),
        enabled: () => phone,
        extra,
    });

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

describe('friendlyTrackName', () => {
    it('uses the track name when the file has one', () => {
        expect(friendlyTrackName({ id: 'guitar-2', name: 'Rhythm Guitar' })).toBe('Rhythm Guitar');
    });
    it('otherwise makes the id readable', () => {
        expect(friendlyTrackName({ id: 'guitar-2' })).toBe('Guitar 2');
        expect(friendlyTrackName({ id: 'banjo', name: '  ' })).toBe('Banjo');
        expect(friendlyTrackName({ id: 'upright_bass' })).toBe('Upright bass');
    });
});

describe('TrackSwitcher in the read view (labels, extra items)', () => {
    const tracks = [
        { id: 'banjo', label: 'Banjo' }, { id: 'guitar', label: 'Guitar' },
        { id: 'guitar-2', label: 'Guitar 2' }, { id: 'bass', label: 'Bass' },
    ];
    const extra = [{ id: 'all', label: 'All tracks' }];
    let active, chosen, enabled;
    beforeEach(() => {
        document.body.innerHTML = '';
        active = 'banjo'; chosen = []; enabled = true;
    });
    const make = () => new TrackSwitcher({
        getTracks: () => tracks, getActive: () => active,
        choose: (id) => { chosen.push(id); active = id; }, enabled: () => enabled, extra,
    });

    it('labels a track by its friendly name and place; All reads "All tracks ▾"', () => {
        expect(trackSwitcherLabel(tracks, 'banjo', extra)).toBe('Banjo ▾ 1 of 4');
        expect(trackSwitcherLabel(tracks, 'guitar-2', extra)).toBe('Guitar 2 ▾ 3 of 4');
        expect(trackSwitcherLabel(tracks, 'all', extra)).toBe('All tracks ▾');
        expect(trackSwitcherLabel(tracks.slice(0, 1), 'banjo', extra)).toBeNull();
    });

    it('lists the tracks then the extra items; choosing All calls choose("all") and relabels', () => {
        const info = trackInfo('banjo');
        const sw = make();
        sw.decorate(info);
        expect(info.querySelector('button').textContent).toBe('Banjo ▾ 1 of 4');
        info.querySelector('button').click();
        const items = [...info.querySelectorAll('[role="menuitemradio"]')];
        expect(items.map(i => i.textContent.replace('✓', ''))).toEqual(['Banjo', 'Guitar', 'Guitar 2', 'Bass', 'All tracks']);
        items[4].click();
        expect(chosen).toEqual(['all']);
        sw.decorate(info);                         // the host redraws after choosing
        expect(info.querySelector('button').textContent).toBe('All tracks ▾');
        info.querySelector('button').click();
        expect(info.querySelector('[aria-checked="true"]').textContent).toContain('All tracks');
    });

    it('enabled() false gives the plain name back, and true brings the button again', () => {
        const info = trackInfo('banjo');
        const sw = make();
        sw.decorate(info);
        enabled = false;
        sw.decorate(info);
        expect(info.querySelector('button')).toBeNull();
        expect(info.querySelector('strong').textContent).toBe('banjo');
        expect(info.classList.contains('has-track-switcher')).toBe(false);
        enabled = true;
        sw.decorate(info);
        expect(info.querySelector('button').textContent).toBe('Banjo ▾ 1 of 4');
    });
});
