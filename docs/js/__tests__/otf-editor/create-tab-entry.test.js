// @vitest-environment jsdom
// Phase 4c: the entry points into the new-tab flow. What matters here is
// the contract that leaves the browser — the instrument NAME the corpus
// will file the part under, and the workId that decides whether the
// submission joins an existing song or mints a new one — plus the login
// gate sitting at the action rather than the page.
import { describe, it, expect, vi } from 'vitest';

import {
    PART_INSTRUMENTS, partInstrumentFor, presetForInstrument,
    sanitizeInstrument, createTabHref, parseCreateTarget, targetBannerText,
    launchTabCreator, submitNewTab,
} from '../../otf-editor/create-tab-entry.js';
import { buildNewTab, INSTRUMENT_CHOICES } from '../../otf-editor/create-tab.js';

const loggedIn = () => true;
const loggedOut = vi.fn(() => false);

describe('part instrument naming', () => {
    it('publishes corpus instrument names, not editor presets', () => {
        const otf = buildNewTab({ instruments: ['5-string-banjo'] });
        expect(partInstrumentFor(otf)).toBe('banjo');
        expect(partInstrumentFor(buildNewTab({ instruments: ['6-string-guitar'] })))
            .toBe('guitar');
        expect(partInstrumentFor(buildNewTab({ instruments: ['upright-bass'] })))
            .toBe('bass');
    });

    it('never emits a name create-tab-pr would reject', () => {
        // /^[a-z0-9-]+$/ server-side — the tenor banjo TRACK ID is
        // `tenor_banjo`, which would 400. Every preset must survive.
        for (const choice of INSTRUMENT_CHOICES) {
            const name = partInstrumentFor(buildNewTab({ instruments: [choice.value] }));
            expect(name).toMatch(/^[a-z0-9-]+$/);
            expect(name.length).toBeLessThanOrEqual(40);
            expect(PART_INSTRUMENTS[choice.value]).toBe(name);
        }
    });

    it('lets an explicitly requested instrument win over the track', () => {
        // A fiddle bounty opens the mandolin stave (same GDAE tuning) but
        // the part is still a fiddle part.
        const otf = buildNewTab({ instruments: ['mandolin'] });
        expect(partInstrumentFor(otf, 'fiddle')).toBe('fiddle');
        expect(presetForInstrument('fiddle')).toBe('mandolin');
    });

    it('sanitizes junk instead of trusting it', () => {
        expect(sanitizeInstrument('Tenor_Banjo')).toBe('tenor-banjo');
        expect(sanitizeInstrument('../../etc')).toBe('etc');
        expect(sanitizeInstrument('!!!')).toBe('');
        expect(partInstrumentFor({ tracks: [{}] }, '!!!')).toBe('banjo');
    });
});

describe('target round trip', () => {
    it('carries work, instrument and title through the URL', () => {
        const href = createTabHref({
            workId: 'salt-creek', instrument: 'banjo', title: 'Salt Creek',
        });
        expect(href.startsWith('create.html?')).toBe(true);
        const target = parseCreateTarget(href.split('?')[1]);
        expect(target).toEqual({
            workId: 'salt-creek', instrument: 'banjo', title: 'Salt Creek',
            existingCount: 0,
        });
    });

    it('is the plain create page with no target', () => {
        expect(createTabHref()).toBe('create.html');
        expect(parseCreateTarget('')).toEqual(
            { workId: null, instrument: null, title: null, existingCount: 0 });
    });

    it('drops a work id that is not a clean slug', () => {
        expect(createTabHref({ workId: '../../evil' })).toBe('create.html');
        expect(parseCreateTarget('work=..%2F..%2Fevil&title=x').workId).toBeNull();
        expect(parseCreateTarget('work=Salt_Creek').workId).toBeNull();
    });
});

// The create page is standalone — it never loads the search index — so
// the sibling count travels in the URL from the entry point that already
// counted them. It is display copy: nothing branches on it.
describe('the target banner is honest from the first pixel', () => {
    it('carries the existing-tab count through the round trip', () => {
        const href = createTabHref({
            workId: 'foggy-mountain-breakdown', instrument: 'banjo',
            title: 'Foggy Mountain Breakdown', existingCount: 3,
        });
        expect(parseCreateTarget(href.split('?')[1]).existingCount).toBe(3);
    });

    it('says you are adding ALONGSIDE, with the number, before a note is entered', () => {
        const text = targetBannerText({ instrument: 'banjo', existingCount: 3 });
        expect(text).toContain('alongside 3 existing banjo tabs');
        expect(text).toContain('nothing is replaced');
    });

    it('keeps the old copy when the work has no tab for this instrument', () => {
        expect(targetBannerText({ instrument: 'banjo', existingCount: 0 }))
            .toBe('It joins that song as a new part when it’s published.');
        expect(targetBannerText({})).toContain('joins that song as a new part');
    });

    it('reads right for exactly one sibling', () => {
        expect(targetBannerText({ instrument: 'guitar', existingCount: 1 }))
            .toContain('alongside 1 existing guitar tab —');
    });

    it('refuses a count with no work behind it, or a junk one', () => {
        expect(createTabHref({ existingCount: 5 })).toBe('create.html');
        expect(parseCreateTarget('work=salt-creek&have=lots').existingCount).toBe(0);
        expect(parseCreateTarget('work=salt-creek&have=-3').existingCount).toBe(0);
        expect(parseCreateTarget('have=9').existingCount).toBe(0);
    });
});

describe('launchTabCreator', () => {
    it('sends a signed-in contributor to the targeted create page', () => {
        const navigate = vi.fn();
        const ok = launchTabCreator(
            { workId: 'gold-rush', instrument: 'banjo', title: 'Gold Rush' },
            { requireLogin: loggedIn, navigate });
        expect(ok).toBe(true);
        expect(navigate).toHaveBeenCalledWith(
            'create.html?work=gold-rush&instrument=banjo&title=Gold+Rush');
    });

    it('gates on login at the click, and goes nowhere without one', () => {
        const navigate = vi.fn();
        loggedOut.mockClear();
        const ok = launchTabCreator({ workId: 'gold-rush' },
            { requireLogin: loggedOut, navigate });
        expect(ok).toBe(false);
        expect(loggedOut).toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });
});

describe('submitNewTab', () => {
    const otf = () => buildNewTab({ title: 'Gold Rush', instruments: ['5-string-banjo'] });

    it('submits a new part for an existing work', async () => {
        const submit = vi.fn(async () => ({ prNumber: 3, prUrl: 'https://github.com/x/pull/3' }));
        await submitNewTab(otf(), { workId: 'gold-rush', instrument: 'banjo', title: 'Gold Rush' },
            { requireLogin: loggedIn, submit });

        const payload = submit.mock.calls[0][0];
        expect(payload.type).toBe('tab-submission');
        expect(payload.workId).toBe('gold-rush');   // targets works/gold-rush/
        expect(payload.instrument).toBe('banjo');   // → banjo.otf.json
        expect(payload.title).toBe('Gold Rush');
        expect(payload.otf.tracks[0].id).toBe('banjo');
        expect(payload.comment).toBeUndefined();    // submissions need none
    });

    it('omits workId entirely for a tab that brings its own song', async () => {
        const submit = vi.fn(async () => ({}));
        await submitNewTab(otf(), {}, { requireLogin: loggedIn, submit });
        const payload = submit.mock.calls[0][0];
        expect('workId' in payload).toBe(false);
        expect(payload.title).toBe('Gold Rush');    // from the document
    });

    it('refuses to submit without a session', async () => {
        const submit = vi.fn();
        loggedOut.mockClear();
        await expect(submitNewTab(otf(), { workId: 'gold-rush' },
            { requireLogin: loggedOut, submit })).rejects.toThrow(/Sign in/);
        expect(submit).not.toHaveBeenCalled();
    });
});
