// The tab editor's front door (G15c): an empty state with three choices. It
// owns no renderer, player or editor; every choice ends on the existing
// #new-tab page.
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createDraftStore, memoryBackend } from '../drafts.js';
import { parseNewTabOptions, TARGET_PRESETS } from '../otf-editor/create-tab-entry.js';
import {
    renderTabEditorHome,
    tabEditorHomeHtml,
    newTabHash,
    HOME_DRAFTS,
    INSTRUMENT_CHOICES,
    EXAMPLE_TAB_HREF,
} from '../tab-editor-home.js';

const tab = (title) => ({ metadata: { title }, tracks: [{ id: 'banjo' }] });

async function mount(options = {}) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const store = options.store || createDraftStore({ backend: memoryBackend() });
    await renderTabEditorHome(el, { store, track: vi.fn(), ...options });
    return { el, store };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('tabEditorHomeHtml', () => {
    it('says what the page is, the same words the generated page has', () => {
        const html = tabEditorHomeHtml([]);
        expect(html).toContain('<h1');
        expect(html).toContain('<h1 class="bounty-title">Tab Editor</h1>');
        expect(html).toContain('Your tabs stay on this device. Nothing is uploaded unless you submit it to the book.');
    });

    it('has the three actions and an example link', () => {
        const html = tabEditorHomeHtml([]);
        expect(html).toContain('Open a tab file…');
        expect(html).toContain('Start a new tab');
        expect(html).toContain('My tabs');
        expect(html).toContain(`href="${EXAMPLE_TAB_HREF}"`);
        expect(EXAMPLE_TAB_HREF).toBe('/#work/foggy-mountain-breakdown/banjo-tab');   // the tour's tab
    });

    it('offers every instrument parseNewTabOptions understands, and each round-trips', () => {
        expect(INSTRUMENT_CHOICES.map(i => i.value).sort()).toEqual(Object.keys(TARGET_PRESETS).sort());
        for (const { value } of INSTRUMENT_CHOICES) {
            expect(parseNewTabOptions(newTabHash({ instrument: value }).split('?')[1]).instrument).toBe(value);
        }
    });
});

describe('newTabHash', () => {
    it('is #new-tab with only what was filled in', () => {
        expect(newTabHash({})).toBe('#new-tab');
        expect(newTabHash({ title: '  Sally Goodin ', instrument: 'banjo' }))
            .toBe('#new-tab?title=Sally+Goodin&instrument=banjo');
    });

    it('carries a title that parseNewTabOptions gives back', () => {
        const hash = newTabHash({ title: 'Salt & Pepper? #1' });
        expect(parseNewTabOptions(hash.split('?')[1]).title).toBe('Salt & Pepper? #1');
    });
});

describe('renderTabEditorHome', () => {
    it('counts the visit (tab_editor_home)', async () => {
        const track = vi.fn();
        await mount({ track });
        expect(track).toHaveBeenCalledWith('tab_editor_home');
    });

    it('Open a tab file… opens the picker as the front-door source', async () => {
        const chooseFile = vi.fn();
        const { el } = await mount({ chooseFile });
        el.querySelector('.tab-open-file').click();
        expect(chooseFile).toHaveBeenCalledWith({ source: 'front-door' });
    });

    it('Start a new tab goes to #new-tab with the title and instrument', async () => {
        const navigate = vi.fn();
        const { el } = await mount({ navigate });
        el.querySelector('.tab-home-title').value = 'Sally Goodin';
        el.querySelector('.tab-home-instrument').value = 'mandolin';
        el.querySelector('.tab-home-new').dispatchEvent(new Event('submit', { cancelable: true }));
        expect(navigate).toHaveBeenCalledWith('#new-tab?title=Sally+Goodin&instrument=mandolin');
    });

    it('Start a new tab with nothing typed carries only the default instrument', async () => {
        const navigate = vi.fn();
        const { el } = await mount({ navigate });
        el.querySelector('.tab-home-new').dispatchEvent(new Event('submit', { cancelable: true }));
        expect(navigate).toHaveBeenCalledWith('#new-tab?instrument=banjo');
    });

    it('My tabs says so when there are none, and still links to All my tabs', async () => {
        const { el } = await mount();
        expect(el.querySelector('.tab-home-mytabs').textContent).toContain('No tabs yet.');
        expect(el.querySelector('a[href="#drafts"]').textContent).toContain('All my tabs');
    });

    it('My tabs shows the five newest as the same rows the My tabs page draws', async () => {
        let t = Date.parse('2026-10-28T12:00:00Z');
        const store = createDraftStore({ backend: memoryBackend(), now: () => (t += 1000) });
        for (let i = 1; i <= 7; i++) await store.save({ otf: tab(`Tab ${i}`) });
        const { el } = await mount({ store });
        expect(HOME_DRAFTS).toBe(5);
        const titles = [...el.querySelectorAll('.tab-home-mytabs .draft-row-title')].map(n => n.textContent);
        expect(titles).toEqual(['Tab 7', 'Tab 6', 'Tab 5', 'Tab 4', 'Tab 3']);
    });

    it('Open on a row navigates to the draft; Delete removes it', async () => {
        const store = createDraftStore({ backend: memoryBackend() });
        const saved = await store.save({ otf: tab('Doomed') });
        const navigate = vi.fn();
        const { el } = await mount({ store, navigate, confirmDelete: () => true });
        el.querySelector('.draft-open').click();
        expect(navigate).toHaveBeenCalledWith(`#new-tab?draft=${saved.id}`);

        el.querySelector('.draft-delete').click();
        await new Promise(r => setTimeout(r, 0));
        expect(await store.list()).toEqual([]);
        expect(el.querySelector('.draft-row')).toBeNull();
        expect(el.querySelector('.tab-home-mytabs').textContent).toContain('No tabs yet.');
    });

    it('survives a drafts store that cannot be opened', async () => {
        const { el } = await mount({ store: { list: () => Promise.reject(new Error('blocked')) } });
        expect(el.querySelector('.tab-open-file')).not.toBeNull();
        expect(el.querySelector('.tab-home-mytabs').textContent).toContain('No tabs yet.');
    });
});
