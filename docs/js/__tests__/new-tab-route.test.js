// The `#new-tab` / `#work/{slug}/add-tab` seam: what the manifest's file
// handler, the manifest shortcut and the Drafts list's Open button actually
// hit today, and how the in-page (§9.1) surface takes over later.
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    clearNewTabHandler,
    createHrefFor,
    openNewTabRoute,
    parseNewTabHash,
    registerNewTabHandler,
} from '../new-tab-route.js';

afterEach(() => clearNewTabHandler());

describe('parseNewTabHash', () => {
    it('reads the bare new-tab route', () => {
        expect(parseNewTabHash('#new-tab')).toEqual({
            workId: null, takeRef: null, draftId: null, fromFile: false,
        });
    });

    it('reads a draft and a file-launch marker', () => {
        expect(parseNewTabHash('#new-tab?draft=d-1&file=1')).toEqual({
            workId: null, takeRef: null, draftId: 'd-1', fromFile: true,
        });
    });

    it('reads the add-tab route for an existing work', () => {
        expect(parseNewTabHash('#work/sally-goodin/add-tab?draft=d-2')).toEqual({
            workId: 'sally-goodin', takeRef: null, draftId: 'd-2', fromFile: false,
        });
    });

    it('reads the edit route, take and all', () => {
        expect(parseNewTabHash('#work/sally-goodin/edit/banjo.otf.json')).toMatchObject({
            workId: 'sally-goodin', takeRef: 'banjo.otf.json',
        });
    });

    it('is not one of ours for ordinary routes', () => {
        expect(parseNewTabHash('#work/sally-goodin')).toBe(null);
        expect(parseNewTabHash('#work/sally-goodin/banjo')).toBe(null);
        expect(parseNewTabHash('#drafts')).toBe(null);
        expect(parseNewTabHash('')).toBe(null);
    });

    it('refuses a work id that is not a slug', () => {
        expect(parseNewTabHash('#work/..%2F..%2Fetc/add-tab')).toBe(null);
    });
});

describe('createHrefFor', () => {
    it('falls back to the create page, carrying work and draft', () => {
        expect(createHrefFor(parseNewTabHash('#new-tab'))).toBe('create.html');
        expect(createHrefFor(parseNewTabHash('#new-tab?draft=d-1')))
            .toBe('create.html?draft=d-1');
        expect(createHrefFor(parseNewTabHash('#work/sally-goodin/add-tab?draft=d-1')))
            .toBe('create.html?work=sally-goodin&draft=d-1');
    });

    it('sends an in-progress correction to the same work (documented compromise)', () => {
        expect(createHrefFor(parseNewTabHash('#work/sally-goodin/edit/banjo.otf.json')))
            .toBe('create.html?work=sally-goodin');
    });
});

describe('openNewTabRoute', () => {
    it('ignores a hash that is not ours', () => {
        const navigate = vi.fn();
        expect(openNewTabRoute('#work/sally-goodin', { navigate })).toBe(false);
        expect(navigate).not.toHaveBeenCalled();
    });

    it('navigates to the fallback page when nothing has registered', () => {
        const navigate = vi.fn();
        expect(openNewTabRoute('#new-tab?draft=d-1', { navigate })).toBe(true);
        expect(navigate).toHaveBeenCalledWith('create.html?draft=d-1');
    });

    it('hands over to the in-page surface once it registers', () => {
        const navigate = vi.fn();
        const handler = vi.fn(() => true);
        registerNewTabHandler(handler);

        expect(openNewTabRoute('#work/sally-goodin/add-tab?draft=d-1', { navigate })).toBe(true);
        expect(handler).toHaveBeenCalledWith({
            workId: 'sally-goodin', takeRef: null, draftId: 'd-1', fromFile: false,
        });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('falls back when the registered handler declines or throws', () => {
        const navigate = vi.fn();
        registerNewTabHandler(() => false);
        openNewTabRoute('#new-tab', { navigate });
        expect(navigate).toHaveBeenCalledWith('create.html');

        navigate.mockClear();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        registerNewTabHandler(() => { throw new Error('not ready'); });
        openNewTabRoute('#new-tab', { navigate });
        expect(navigate).toHaveBeenCalledWith('create.html');
    });
});
