// ASCII tab tick math: characters map onto each measure's own length.

import { describe, it, expect } from 'vitest';
import { renderAsciiTab } from '../renderers/tab-ascii.js';

const TRACK = {
    id: 'banjo',
    instrument: '5-string-banjo',
    tuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
};

function firstStringLine(ascii) {
    return ascii.split('\n').find(l => l.includes('|'));
}

describe('renderAsciiTab', () => {
    it('maps a 4/4 measure across all 16 chars (was 60 ticks/char)', () => {
        const notation = [{
            measure: 1,
            events: [
                { tick: 0, notes: [{ s: 1, f: 2 }] },
                { tick: 960, notes: [{ s: 1, f: 5 }] },   // beat 3 -> middle
            ],
        }];
        const line = firstStringLine(
            renderAsciiTab(TRACK, notation, { time_signature: '4/4' }));
        const cells = line.split('|')[1];
        expect(cells[0]).toBe('2');
        expect(cells[8]).toBe('5');   // halfway, not clamped to the end
    });

    it('respects per-measure overrides', () => {
        const notation = [{
            measure: 1,
            events: [{ tick: 720, notes: [{ s: 1, f: 7 }] }],  // 3/4 midpoint
        }];
        const line = firstStringLine(renderAsciiTab(TRACK, notation, {
            time_signature: '4/4',
            time_signature_changes: [{ measure: 1, time_signature: '3/4' }],
        }));
        const cells = line.split('|')[1];
        expect(cells[8]).toBe('7');   // 720/1440 -> char 8
    });
});
