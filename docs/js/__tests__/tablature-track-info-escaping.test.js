// The track-info row prints strings that came out of an OTF document.
//
// OTF documents are hand-edited in works/ and arrive from user submissions
// and TEF imports, so `track.id`, `track.instrument` and `track.tuning` are
// all untrusted. The row used to build itself with innerHTML and no
// escaping at all. The editor sanitizes ids a HUMAN types, which covers
// exactly one of the ways an id gets here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TabRenderer } from '../renderers/tablature.js';

const HOSTILE = '<img src=x onerror="alert(1)"> & "quoted" \'single\'';

const NOTATION = [{ measure: 1, events: [{ tick: 0, notes: [{ s: 1, f: 0 }] }] }];

describe('TabRenderer track-info escaping', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });
    afterEach(() => container.remove());

    const renderWith = (track) => {
        const r = new TabRenderer(container);
        r.render(track, NOTATION);
        return container.querySelector('.track-info');
    };

    it('injects no elements from a hostile track id', () => {
        const info = renderWith({
            id: HOSTILE, instrument: '5-string-banjo',
            tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
        });
        expect(info.querySelector('img')).toBeNull();
        expect(info.querySelector('strong').textContent).toBe(HOSTILE);
        expect(info.innerHTML).not.toContain('<img');
        expect(info.innerHTML).toContain('&lt;img');
    });

    it('injects no elements from a hostile instrument name', () => {
        const info = renderWith({
            id: 'banjo', instrument: HOSTILE,
            tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
        });
        expect(info.querySelector('img')).toBeNull();
        expect(info.textContent).toContain(HOSTILE);
    });

    it('injects no elements from hostile tuning pitches', () => {
        const info = renderWith({
            id: 'banjo', instrument: 'weird',
            tuning: ['<script>bad()</script>', 'B&B', 'G"3', 'D3', 'G4'],
        });
        expect(info.querySelector('script')).toBeNull();
        const chips = [...info.querySelectorAll('.tuning-string')].map(n => n.textContent);
        expect(chips).toHaveLength(5);
        expect(chips[0]).toBe('<script>bad()</script>');   // text, not markup
        expect(chips[1]).toBe('B&B');
        expect(chips[2]).toBe('G"');                       // digit stripped
    });

    it('still draws the row it always drew', () => {
        const info = renderWith({
            id: 'banjo', instrument: '5-string-banjo',
            tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
        });
        expect(info.querySelector('strong').textContent).toBe('banjo');
        expect(info.querySelector('.tuning-name').textContent).toBe('Open G');
        expect(info.querySelectorAll('.tuning-string')).toHaveLength(5);
        // The 5th string chip keeps its marker class
        expect(info.querySelectorAll('.tuning-string.fifth')).toHaveLength(1);
        // instrument is hidden when it merely repeats the id
        expect(info.textContent).toContain('5-string-banjo');
    });

    it('hides the instrument label when it equals the track id', () => {
        const info = renderWith({
            id: 'mandolin', instrument: 'mandolin',
            tuning: ['E4', 'A3', 'D3', 'G2'],
        });
        expect(info.children).toHaveLength(2);   // <strong> + .tuning-display
    });
});
