// @vitest-environment jsdom
// The early offramp: "this song already has tabs for that instrument",
// said at the moment a work+instrument is chosen rather than at Submit.
//
// The bug this exists to prevent: a contributor targeted
// foggy-mountain-breakdown with a banjo tab, arranged it, hit Submit and
// only then met a 409 — with no fork path and no warning that the work
// already carried banjo takes. Contract principle 4 says the offramp is a
// choice offered EARLY, so these are the two things that must hold: the
// existing takes are found from data already in hand, and the panel
// offers three ways forward (view / add alongside / improve) — never a
// refusal.
import { describe, it, expect, vi } from 'vitest';

import {
    partMatchesInstrument, existingTabsFor, tabPartIdFor, tabDisplayName,
    existingTabsHeadline, tabEntryPlan, renderExistingTabsPanel,
} from '../../otf-editor/existing-tabs.js';

const FOGGY = {
    id: 'foggy-mountain-breakdown',
    title: 'Foggy Mountain Breakdown',
    tablature_parts: [
        { instrument: 'mandolin', label: 'Mandolin Break', file: 'data/tabs/f-mandolin-1.otf.json',
          src_file: 'mandolin.otf.json', default: true },
        { instrument: 'banjo', file: 'data/tabs/f-banjo-20690.otf.json',
          src_file: 'banjo.otf.json', author: 'schlange', default: true },
        { instrument: 'banjo', file: 'data/tabs/f-banjo-18967.otf.json',
          src_file: 'banjo-18967.otf.json', author: 'Devon Wells', difficulty: 'Expert' },
        { instrument: 'banjo', file: 'data/tabs/f-banjo-22352.otf.json',
          src_file: 'banjo-22352.otf.json', author: 'HOWDYDOODY' },
    ],
};

describe('instrument matching', () => {
    it('follows the app-wide instrument families, not string equality', () => {
        // getInstrumentTags is THE source of instrument identity: a part
        // stored as `5-string-banjo` answers to `banjo` in search, so it
        // must answer to `banjo` here too.
        expect(partMatchesInstrument({ instrument: '5-string-banjo' }, 'banjo')).toBe(true);
        expect(partMatchesInstrument({ instrument: 'upright-bass' }, 'bass')).toBe(true);
        expect(partMatchesInstrument({ instrument: 'banjo' }, 'banjo')).toBe(true);
        expect(partMatchesInstrument({ instrument: 'mandolin' }, 'banjo')).toBe(false);
    });

    it('with no instrument asked for, every tab counts', () => {
        // The work page's "+ Add a tab" button doesn't ask which
        // instrument, so the panel reports what the song has overall.
        expect(existingTabsFor(FOGGY, '').length).toBe(4);
        expect(existingTabsFor(FOGGY, null).length).toBe(4);
    });
});

describe('existingTabsFor', () => {
    it('finds the same-instrument siblings the corpus already carries', () => {
        const tabs = existingTabsFor(FOGGY, 'banjo');
        expect(tabs.map(t => t.src_file)).toEqual([
            'banjo.otf.json', 'banjo-18967.otf.json', 'banjo-22352.otf.json']);
    });

    it('is empty for an instrument the work has no tab for', () => {
        expect(existingTabsFor(FOGGY, 'dobro')).toEqual([]);
    });

    it('tolerates a row with no tabs at all', () => {
        expect(existingTabsFor({ id: 'x' }, 'banjo')).toEqual([]);
        expect(existingTabsFor(null, 'banjo')).toEqual([]);
    });
});

describe('tabEntryPlan', () => {
    it('proceeds untouched when nothing collides', () => {
        const plan = tabEntryPlan(FOGGY, 'dobro');
        expect(plan.kind).toBe('proceed');
        expect(plan.count).toBe(0);
    });

    it('proceeds when there is no target work at all (a brand-new song)', () => {
        expect(tabEntryPlan(null, 'banjo').kind).toBe('proceed');
    });

    it('reports what exists — as a choice, never a refusal', () => {
        const plan = tabEntryPlan(FOGGY, 'banjo');
        expect(plan.kind).toBe('existing');
        expect(plan.count).toBe(3);
        expect(plan.workId).toBe('foggy-mountain-breakdown');
        expect(plan.headline).toBe('Foggy Mountain Breakdown already has 3 banjo tabs');
        expect(plan.tabs).toHaveLength(3);
    });

    it('names the work page part the existing takes live under', () => {
        // buildPartsFromIndex gives an instrument ONE pill, slugged from
        // the default-first arrangement's label — #work/{id}/banjo-tab.
        expect(tabPartIdFor(FOGGY, 'banjo')).toBe('banjo-tab');
        expect(tabPartIdFor(FOGGY, 'mandolin')).toBe('mandolin-break');
        expect(tabPartIdFor(FOGGY, 'dobro')).toBe(null);
    });

    it('says "tab" not "tabs" for a single existing take', () => {
        expect(existingTabsHeadline('Salt Creek', 1, 'banjo'))
            .toBe('Salt Creek already has 1 banjo tab');
        expect(existingTabsHeadline('Salt Creek', 2, ''))
            .toBe('Salt Creek already has 2 tabs');
    });

    it('labels each take by who made it', () => {
        expect(tabDisplayName(FOGGY.tablature_parts[2]))
            .toBe('Banjo — Devon Wells (Expert)');
        expect(tabDisplayName({ instrument: 'banjo' })).toBe('Banjo');
    });
});

describe('the three-choice panel', () => {
    const build = () => {
        const onAdd = vi.fn(), onImprove = vi.fn(), onView = vi.fn(), onBack = vi.fn();
        const plan = tabEntryPlan(FOGGY, 'banjo');
        const el = renderExistingTabsPanel(plan, { onAdd, onImprove, onView, onBack });
        document.body.innerHTML = '';
        document.body.appendChild(el);
        return { el, plan, onAdd, onImprove, onView, onBack };
    };

    it('states the count before anything else happens', () => {
        const { el } = build();
        expect(el.querySelector('.tab-existing-head').textContent)
            .toBe('Foggy Mountain Breakdown already has 3 banjo tabs');
    });

    it('lists every existing take with a way to read it', () => {
        const { el, onView } = build();
        const rows = el.querySelectorAll('.tab-existing-view');
        expect(rows).toHaveLength(3);
        rows[1].click();
        expect(onView).toHaveBeenCalledTimes(1);
        expect(onView.mock.calls[0][0].src_file).toBe('banjo-18967.otf.json');
    });

    it('offers "add mine as another version" — the path that used to 409', () => {
        const { el, onAdd, plan } = build();
        el.querySelector('.tab-existing-add').click();
        expect(onAdd).toHaveBeenCalledWith(plan);
    });

    it('routes "improve this one" at the take that was picked', () => {
        const { el, onImprove } = build();
        el.querySelectorAll('.tab-existing-improve')[2].click();
        expect(onImprove).toHaveBeenCalledTimes(1);
        expect(onImprove.mock.calls[0][0].src_file).toBe('banjo-22352.otf.json');
    });

    it('has no Back button when the caller offers nowhere to go back to', () => {
        const el = renderExistingTabsPanel(tabEntryPlan(FOGGY, 'banjo'), { onAdd: () => {} });
        expect(el.querySelector('.tab-existing-back')).toBe(null);
    });

    it('escapes titles rather than interpolating them', () => {
        const el = renderExistingTabsPanel(
            tabEntryPlan({ id: 'x', title: '<img src=x onerror=1>',
                tablature_parts: [{ instrument: 'banjo' }] }, 'banjo'), {});
        expect(el.querySelector('img')).toBe(null);
        expect(el.querySelector('.tab-existing-head').textContent)
            .toContain('<img src=x onerror=1>');
    });
});
