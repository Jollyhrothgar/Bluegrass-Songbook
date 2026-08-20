// The #drafts list: the one new surface the PWA adds.
import { describe, it, expect, vi } from 'vitest';

import { createDraftStore, memoryBackend } from '../drafts.js';
import {
    draftContextText,
    draftRowHtml,
    draftsViewHtml,
    formatUpdated,
    renderDraftsView,
} from '../drafts-view.js';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

const draft = (over = {}) => ({
    id: 'd-1',
    title: 'Sally Goodin',
    instrument: 'banjo',
    updatedAt: ago(5 * 60 * 1000),
    otf: { tracks: [{ id: 'banjo' }] },
    ...over,
});

describe('formatUpdated', () => {
    it('speaks in the units a human just used', () => {
        expect(formatUpdated(ago(10 * 1000), NOW)).toBe('just now');
        expect(formatUpdated(ago(12 * 60 * 1000), NOW)).toBe('12 min ago');
        expect(formatUpdated(ago(60 * 60 * 1000), NOW)).toBe('1 hour ago');
        expect(formatUpdated(ago(5 * 60 * 60 * 1000), NOW)).toBe('5 hours ago');
        expect(formatUpdated(ago(2 * 24 * 60 * 60 * 1000), NOW)).toBe('2 days ago');
    });

    it('falls back to a date beyond a week, and never crashes on junk', () => {
        expect(formatUpdated(ago(30 * 24 * 60 * 60 * 1000), NOW)).toMatch(/\d/);
        expect(formatUpdated('not a date', NOW)).toBe('unknown');
        expect(formatUpdated(undefined, NOW)).toBe('unknown');
    });
});

describe('draftContextText', () => {
    it('names where the draft came from', () => {
        expect(draftContextText(draft())).toBe('new song');
        expect(draftContextText(draft({ workId: 'sally-goodin' })))
            .toBe('new take for sally-goodin');
        expect(draftContextText(draft({ workId: 'sally-goodin', takeRef: 'banjo.otf.json' })))
            .toBe('correction to sally-goodin');
    });
});

describe('draftRowHtml', () => {
    it('shows title, instrument, context and age with Open/Delete', () => {
        const html = draftRowHtml(draft(), NOW);
        expect(html).toContain('Sally Goodin');
        expect(html).toContain('banjo');
        expect(html).toContain('5 min ago');
        expect(html).toContain('draft-open');
        expect(html).toContain('draft-delete');
    });

    it('escapes a title from an untrusted document', () => {
        const html = draftRowHtml(draft({ title: '<img src=x onerror=alert(1)>' }), NOW);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });
});

describe('draftsViewHtml', () => {
    it('explains itself when empty', () => {
        const html = draftsViewHtml([], NOW);
        expect(html).toContain('No drafts yet');
        expect(html).not.toContain('draft-row');
    });

    it('renders one row per draft', () => {
        const html = draftsViewHtml([draft(), draft({ id: 'd-2', title: 'Cripple Creek' })], NOW);
        expect(html.match(/class="draft-row"/g).length).toBe(2);
    });
});

describe('renderDraftsView', () => {
    const mount = () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        return el;
    };

    it('lists what the store holds, newest first', async () => {
        let t = NOW;
        const store = createDraftStore({ backend: memoryBackend(), now: () => (t += 1000) });
        await store.save({ otf: { metadata: { title: 'Older' }, tracks: [{ id: 'banjo' }] } });
        await store.save({ otf: { metadata: { title: 'Newer' }, tracks: [{ id: 'banjo' }] } });

        const el = mount();
        await renderDraftsView(el, { store, now: () => t });
        const titles = [...el.querySelectorAll('.draft-row-title')].map(n => n.textContent);
        expect(titles).toEqual(['Newer', 'Older']);
    });

    it('Open navigates to the draft’s route', async () => {
        const store = createDraftStore({ backend: memoryBackend() });
        const saved = await store.save({
            otf: { metadata: { title: 'Sally' }, tracks: [{ id: 'banjo' }] },
            workId: 'sally-goodin',
        });
        const navigate = vi.fn();
        const el = mount();
        await renderDraftsView(el, { store, navigate });

        el.querySelector('.draft-open').click();
        expect(navigate).toHaveBeenCalledWith(`#work/sally-goodin/add-tab?draft=${saved.id}`);
    });

    it('Delete asks first, then removes the row and the record', async () => {
        const store = createDraftStore({ backend: memoryBackend() });
        await store.save({ otf: { metadata: { title: 'Doomed' }, tracks: [{ id: 'b' }] } });
        const el = mount();

        await renderDraftsView(el, { store, confirmDelete: () => false });
        el.querySelector('.draft-delete').click();
        await Promise.resolve();
        expect((await store.list()).length).toBe(1);

        const el2 = mount();
        await renderDraftsView(el2, { store, confirmDelete: () => true });
        el2.querySelector('.draft-delete').click();
        await new Promise(r => setTimeout(r, 0));
        expect(await store.list()).toEqual([]);
        expect(el2.textContent).toContain('No drafts yet');
    });

    it('says so when the store cannot be opened, rather than blowing up', async () => {
        const el = mount();
        await renderDraftsView(el, { store: { list: () => Promise.reject(new Error('blocked')) } });
        expect(el.textContent).toContain("Couldn't open the drafts store");
    });
});
