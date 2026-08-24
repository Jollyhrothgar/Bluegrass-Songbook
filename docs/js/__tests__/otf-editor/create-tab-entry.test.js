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
    launchTabCreator, submitNewTab, parseTabRoute, parseNewTabOptions,
    editTabHref,
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

    it('never emits a name the works writer (or the table constraint) would reject', () => {
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

// §9.1: the tab is written on the page it will be published on, so the
// "create page" is a hash route on the song page — the work id lives in
// the PATH now, not in a query parameter.
describe('target round trip', () => {
    it('carries work, instrument and title through the URL', () => {
        const href = createTabHref({
            workId: 'salt-creek', instrument: 'banjo', title: 'Salt Creek',
        });
        expect(href.startsWith('#work/salt-creek/add-tab?')).toBe(true);
        const route = parseTabRoute(href);
        expect(route.kind).toBe('add-tab');
        expect(route.target).toEqual({
            workId: 'salt-creek', instrument: 'banjo', title: 'Salt Creek',
            existingCount: 0,
        });
    });

    it('is the provisional new-tab page with no target', () => {
        expect(createTabHref()).toBe('#new-tab');
        expect(parseTabRoute('#new-tab').kind).toBe('new-tab');
        expect(parseCreateTarget('')).toEqual(
            { workId: null, instrument: null, title: null, existingCount: 0 });
    });

    it('drops a work id that is not a clean slug', () => {
        expect(createTabHref({ workId: '../../evil' })).toBe('#new-tab');
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
        expect(parseTabRoute(href).target.existingCount).toBe(3);
    });

    it('says you are adding ALONGSIDE, with the number, before a note is entered', () => {
        const text = targetBannerText({ instrument: 'banjo', existingCount: 3 });
        expect(text).toContain('alongside 3 existing banjo tabs');
        expect(text).toContain('nothing is replaced');
    });

    it('promises the part immediately when the work has no tab for this instrument', () => {
        // Not "when it's published" — a tab is live on the song's page the
        // moment it is submitted now.
        expect(targetBannerText({ instrument: 'banjo', existingCount: 0 }))
            .toBe('It joins that song as a new part as soon as you submit.');
        expect(targetBannerText({})).toContain('joins that song as a new part');
    });

    it('reads right for exactly one sibling', () => {
        expect(targetBannerText({ instrument: 'guitar', existingCount: 1 }))
            .toContain('alongside 1 existing guitar tab —');
    });

    it('refuses a count with no work behind it, or a junk one', () => {
        expect(createTabHref({ existingCount: 5 })).toBe('#new-tab');
        expect(parseCreateTarget('work=salt-creek&have=lots').existingCount).toBe(0);
        expect(parseCreateTarget('work=salt-creek&have=-3').existingCount).toBe(0);
        expect(parseCreateTarget('have=9').existingCount).toBe(0);
    });
});

describe('launchTabCreator', () => {
    it('sends a signed-in contributor to the song page, in add-tab mode', () => {
        const navigate = vi.fn();
        const ok = launchTabCreator(
            { workId: 'gold-rush', instrument: 'banjo', title: 'Gold Rush' },
            { requireLogin: loggedIn, navigate });
        expect(ok).toBe(true);
        expect(navigate).toHaveBeenCalledWith(
            '#work/gold-rush/add-tab?instrument=banjo&title=Gold+Rush');
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
        const submit = vi.fn(async () => ({
            id: 'gold-rush', workId: 'gold-rush', live: true, synced: true, mode: 'add',
        }));
        const out = await submitNewTab(
            otf(), { workId: 'gold-rush', instrument: 'banjo', title: 'Gold Rush' },
            { requireLogin: loggedIn, submit });
        // The live/durable answer is passed straight through to the page.
        expect(out.live).toBe(true);

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

    // A tab-only work is minted from this row and nothing else, and the
    // minted work is not a `status: placeholder` one — so the work-page
    // metadata editor never renders for it. Submit is the ONLY moment an
    // artist can be attached; dropping it here is how
    // works/welcome-to-new-york ended up with a title and nothing else.
    it('carries the artist on a mint, so the new work is attributed', async () => {
        const submit = vi.fn(async () => ({}));
        await submitNewTab(otf(), { artist: '  Bill Emerson  ' },
            { requireLogin: loggedIn, submit });
        expect(submit.mock.calls[0][0].artist).toBe('Bill Emerson');
    });

    it('drops the artist when the tab joins an existing work', async () => {
        // That work already has an artist; a tab contributor doesn't restate it.
        const submit = vi.fn(async () => ({}));
        await submitNewTab(otf(), { workId: 'gold-rush', artist: 'Bill Emerson' },
            { requireLogin: loggedIn, submit });
        expect('artist' in submit.mock.calls[0][0]).toBe(false);
    });

    it('sends no artist key at all when the field was left blank', async () => {
        const submit = vi.fn(async () => ({}));
        await submitNewTab(otf(), { artist: '   ' }, { requireLogin: loggedIn, submit });
        expect('artist' in submit.mock.calls[0][0]).toBe(false);
    });

    it('refuses to submit without a session', async () => {
        const submit = vi.fn();
        loggedOut.mockClear();
        await expect(submitNewTab(otf(), { workId: 'gold-rush' },
            { requireLogin: loggedOut, submit })).rejects.toThrow(/Sign in/);
        expect(submit).not.toHaveBeenCalled();
    });
});

// ── The editor is a URL (plan §9.2) ──────────────────────────────────────
//
// Three shapes, all of them the SONG PAGE in a different mode. They have to
// be reload-safe (a contributor who refreshes mid-edit lands back on the
// take they were editing) and they have to be parsed defensively: a hash is
// user input, and two of them live under `#work/` where a mis-parse would
// silently read as a part id.
describe('parseTabRoute', () => {
    it('reads the edit route, take and all', () => {
        expect(parseTabRoute('#work/gold-rush/edit/banjo-2')).toEqual({
            kind: 'edit', workId: 'gold-rush', partRef: 'banjo-2',
        });
    });

    it('reads the add-tab route with its target', () => {
        const route = parseTabRoute('#work/gold-rush/add-tab?instrument=banjo&have=8');
        expect(route.kind).toBe('add-tab');
        expect(route.workId).toBe('gold-rush');
        expect(route.target).toEqual({
            workId: 'gold-rush', instrument: 'banjo', title: null, existingCount: 8,
        });
    });

    it('reads the new-tab route and clamps everything in its query', () => {
        const route = parseTabRoute(
            '#new-tab?title=Salt+Creek&instrument=fiddle&ts=7/8&tempo=9000&measures=0');
        expect(route.kind).toBe('new-tab');
        expect(route.options.title).toBe('Salt Creek');
        // fiddle has no preset of its own — it is tuned like the mandolin
        expect(route.options.instruments).toEqual(['mandolin']);
        expect(route.options.timeSignature).toBe('4/4');   // 7/8 is not offered
        expect(route.options.tempo).toBe(280);             // clamped
        expect(route.options.measures).toBe(1);            // clamped
    });

    it('defaults a bare #new-tab to a 16-bar banjo tab in 4/4', () => {
        expect(parseTabRoute('#new-tab').options).toEqual({
            title: null, instrument: null, instruments: ['5-string-banjo'],
            timeSignature: '4/4', tempo: 120, measures: 16,
        });
    });

    it('leaves every other route alone', () => {
        expect(parseTabRoute('#work/gold-rush')).toBeNull();
        expect(parseTabRoute('#work/gold-rush/banjo-tab')).toBeNull();
        expect(parseTabRoute('#work/gold-rush/edit')).toBeNull();   // no take named
        expect(parseTabRoute('#search/salt')).toBeNull();
        expect(parseTabRoute('#list/abc/gold-rush')).toBeNull();
        expect(parseTabRoute('')).toBeNull();
        expect(parseTabRoute(null)).toBeNull();
    });

    it('refuses a work id that is not a clean slug', () => {
        expect(parseTabRoute('#work/..%2F..%2Fevil/add-tab')).toBeNull();
        expect(parseTabRoute('#work/Salt_Creek/edit/banjo')).toBeNull();
    });

    it('round-trips the edit link it mints', () => {
        const href = editTabHref('gold-rush', 'banjo-2');
        expect(href).toBe('#work/gold-rush/edit/banjo-2');
        expect(parseTabRoute(href).partRef).toBe('banjo-2');
    });

    it('survives a take name that needs encoding', () => {
        const href = editTabHref('gold-rush', 'banjo take/2');
        expect(parseTabRoute(href).partRef).toBe('banjo take/2');
    });
});

describe('parseNewTabOptions', () => {
    it('keeps a time signature the editor can actually build', () => {
        expect(parseNewTabOptions('ts=6/8').timeSignature).toBe('6/8');
        expect(parseNewTabOptions('ts=%3Cscript%3E').timeSignature).toBe('4/4');
    });

    it('truncates a runaway title instead of refusing it', () => {
        expect(parseNewTabOptions('title=' + 'x'.repeat(500)).title.length).toBe(200);
    });
});
