// Tab submission client — payload shape, size guard, error paths.
import { describe, it, expect, vi } from 'vitest';

import {
    serializeForSubmission, submitTab, MAX_OTF_CHARS,
} from '../../otf-editor/submit-tab.js';

const smallOtf = () => ({
    otf_version: '1.0',
    _partFile: 'data/tabs/x.otf.json', // view-cache junk — must be stripped
    metadata: { title: 'T' },
    tracks: [{ id: 'banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
    notation: { banjo: [] },
});

describe('serializeForSubmission', () => {
    it('compacts and strips underscore-prefixed cache fields', () => {
        const s = serializeForSubmission(smallOtf());
        expect(s).not.toContain('_partFile');
        expect(s).not.toContain('\n');
        expect(JSON.parse(s).tracks[0].id).toBe('banjo');
    });

    it('refuses oversized tabs with a helpful message', () => {
        const big = smallOtf();
        big.notation.banjo = Array.from({ length: 40000 }, (_, i) => ({
            measure: i + 1,
            events: [{ tick: 0, notes: [{ s: 1, f: 0 }] }],
        }));
        expect(() => serializeForSubmission(big)).toThrow(/too large/);
    });
});

describe('submitTab', () => {
    const okFetch = (result = { success: true, issueNumber: 7, issueUrl: 'https://x/7' }) =>
        vi.fn(async () => ({ ok: true, json: async () => result }));

    it('posts the correction payload to the edge function', async () => {
        const f = okFetch();
        const out = await submitTab({
            type: 'tab-correction', otf: smallOtf(), title: 'Gold Rush',
            instrument: 'banjo', workId: 'gold-rush', comment: 'fixed m3',
        }, f);
        expect(out).toEqual({ issueNumber: 7, issueUrl: 'https://x/7' });

        const [url, init] = f.mock.calls[0];
        expect(url).toContain('/functions/v1/create-tab-issue');
        const body = JSON.parse(init.body);
        expect(body.type).toBe('tab-correction');
        expect(body.workId).toBe('gold-rush');
        expect(body.comment).toBe('fixed m3');
        expect(body.submittedBy).toBe('Rando Calrissian'); // no auth in tests
        expect(JSON.parse(body.otf).tracks[0].id).toBe('banjo');
    });

    it('surfaces server errors', async () => {
        const f = vi.fn(async () => ({
            ok: false, json: async () => ({ error: 'Tab too large' }),
        }));
        await expect(submitTab({
            type: 'tab-submission', otf: smallOtf(), title: 'X', instrument: 'banjo',
        }, f)).rejects.toThrow('Tab too large');
    });
});
