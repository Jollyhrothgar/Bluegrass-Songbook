// @vitest-environment jsdom
// A tab that was submitted seconds ago renders from the pending overlay.
//
// The site normally loads a tab by fetching
// data/tabs/{work}-{instrument}-{source_id}.otf.json. A pending tab has no
// such file yet — the OTF is in the overlay row — so the loader branches on
// the take, and the cache key has to branch with it (otherwise a correction
// to the tab you are already looking at hits the cache and renders the very
// version it fixes).
import { describe, it, expect, vi } from 'vitest';

import {
    buildPartsFromIndex, applyArrangement, activeArrangement,
    loadPartOtf, otfCacheKey,
} from '../work-view.js';

const OTF = { otf_version: '1.0', tracks: [{ id: 'banjo' }] };

const publishedTake = (over = {}) => ({
    instrument: 'banjo',
    label: 'Banjo',
    src_file: 'banjo.otf.json',
    file: 'data/tabs/gold-rush-banjo-1.otf.json',
    source: 'banjo-hangout',
    author: 'schlange',
    default: true,
    ...over,
});

const pendingTake = (over = {}) => ({
    instrument: 'banjo',
    file: null,
    content: JSON.stringify(OTF),
    pending: true,
    pending_id: 'gold-rush',
    ...over,
});

describe('loadPartOtf', () => {
    it('parses a pending take out of the overlay — no request at all', async () => {
        const fetchImpl = vi.fn();
        const otf = await loadPartOtf(pendingTake(), fetchImpl);
        expect(otf).toEqual(OTF);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('still fetches a published take, revalidating the way it always did', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => OTF }));
        const part = publishedTake();
        expect(await loadPartOtf(part, fetchImpl)).toEqual(OTF);
        expect(fetchImpl).toHaveBeenCalledWith(part.file, { cache: 'no-cache' });
    });

    it('reports a failed fetch by file, as before', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false }));
        await expect(loadPartOtf(publishedTake(), fetchImpl))
            .rejects.toThrow(/Failed to load data\/tabs\/gold-rush-banjo-1/);
    });

    it('says something human when the overlay document will not parse', async () => {
        await expect(loadPartOtf(pendingTake({ content: '{not json' }), vi.fn()))
            .rejects.toThrow(/just submitted/);
    });
});

describe('otfCacheKey', () => {
    it('keys a published take by its file', () => {
        expect(otfCacheKey(publishedTake())).toBe('data/tabs/gold-rush-banjo-1.otf.json');
    });

    it('keys a pending take by its overlay row, so a correction cannot hit the cache', () => {
        // The correction keeps the published take's `file` (its identity),
        // so file alone would look like the document already in hand.
        const corrected = { ...publishedTake(), ...pendingTake({ file: undefined }) };
        expect(otfCacheKey(corrected)).toBe('pending:gold-rush');
        expect(otfCacheKey(corrected)).not.toBe(otfCacheKey(publishedTake()));
    });
});

describe('a pending take inside the instrument pill', () => {
    it('joins the published takes as another arrangement of the same pill', () => {
        const parts = buildPartsFromIndex({
            id: 'gold-rush', has_content: true,
            tablature_parts: [publishedTake(), pendingTake()],
        });
        const tabs = parts.filter(p => p.type === 'tablature');
        expect(tabs).toHaveLength(1);                    // still ONE pill
        const tab = tabs[0];
        // The URL segment belongs to the instrument, and a new take must not
        // move it — the pin's label still names the pill.
        expect(tab.partId).toBe('banjo');
        expect(tab.arrangements).toHaveLength(2);
        expect(activeArrangement(tab).author).toBe('schlange');   // pin unmoved
    });

    it('switching to it carries the document, and switching away drops it', () => {
        const parts = buildPartsFromIndex({
            id: 'gold-rush', has_content: true,
            tablature_parts: [publishedTake(), pendingTake()],
        });
        const tab = parts.find(p => p.type === 'tablature');

        expect(applyArrangement(tab, 1)).toBe(true);
        expect(tab.pending).toBe(true);
        expect(tab.content).toBe(JSON.stringify(OTF));
        expect(otfCacheKey(tab)).toBe('pending:gold-rush');

        expect(applyArrangement(tab, 0)).toBe(true);
        expect(tab.pending).toBeUndefined();
        expect(tab.content).toBeUndefined();
        expect(otfCacheKey(tab)).toBe('data/tabs/gold-rush-banjo-1.otf.json');
    });

    it('a tab-only pending work still builds a tab part and no lead sheet', () => {
        const parts = buildPartsFromIndex({
            id: 'brand-new-reel', source: 'pending',
            tablature_parts: [pendingTake({ instrument: 'mandolin', pending_id: 'brand-new-reel' })],
        });
        expect(parts).toHaveLength(1);
        expect(parts[0].type).toBe('tablature');
        expect(parts[0].label).toBe('Mandolin Tab');     // no label of its own
        expect(parts[0].default).toBe(true);
    });
});
