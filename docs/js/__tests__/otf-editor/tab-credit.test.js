// The "Tab by" credit row (otf-editor/tab-credit.js).
import { describe, it, expect } from 'vitest';
import { EditingFacade } from '../../otf-editor/facade.js';
import {
    createCreditRow, parseCreditInput, creditFromPart,
} from '../../otf-editor/tab-credit.js';

function doc(tab_by) {
    return {
        otf_version: '1.0',
        metadata: { title: 'T', time_signature: '4/4', tempo: 120, ...(tab_by ? { tab_by } : {}) },
        timing: { ticks_per_beat: 480 },
        tracks: [{ id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
        notation: { banjo: [{ measure: 1, events: [] }] },
    };
}
const type = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('change'));
};
const tick = () => new Promise(r => setTimeout(r, 0));

describe('parseCreditInput', () => {
    it('trims, and treats a blank name and link as no credit', () => {
        expect(parseCreditInput('  Jane ', ' ')).toEqual({ credit: { name: 'Jane' } });
        expect(parseCreditInput('', '')).toEqual({ credit: null });
    });
    it('keeps an http(s) link and lower-cases a shouted scheme', () => {
        expect(parseCreditInput('J', 'HTTPS://x.test/a').credit.url).toBe('https://x.test/a');
    });
    it('refuses a non-http link, a link without a name, an over-long link', () => {
        expect(parseCreditInput('J', 'javascript:alert(1)').error).toMatch(/http/);
        expect(parseCreditInput('J', 'ftp://x').error).toBeTruthy();
        expect(parseCreditInput('', 'https://x.test').error).toBeTruthy();
        expect(parseCreditInput('J', 'https://x.test/' + 'a'.repeat(500)).error).toBeTruthy();
        expect(parseCreditInput('x'.repeat(101), '').error).toBeTruthy();
    });
});

describe('creditFromPart', () => {
    it('reads the published credit', () => {
        expect(creditFromPart({ author: 'schlange', author_url: 'https://h.test/my/schlange' }))
            .toEqual({ name: 'schlange', url: 'https://h.test/my/schlange' });
        expect(creditFromPart({ author: 'x', author_url: 'javascript:1' })).toEqual({ name: 'x' });
        expect(creditFromPart({})).toBeNull();
    });
});

describe('createCreditRow', () => {
    it('commits to the facade, one undo step per change', () => {
        const f = new EditingFacade(doc());
        const row = createCreditRow({ getFacade: () => f });
        const [name, url] = row.el.querySelectorAll('input');
        type(name, 'Jane');
        type(url, 'https://x.test/j');
        expect(f.getTabBy()).toEqual({ name: 'Jane', url: 'https://x.test/j' });
        f.undo();
        expect(f.getTabBy()).toEqual({ name: 'Jane' });
        f.undo();
        expect(f.getTabBy()).toBeNull();
        row.refresh();   // work-edit.js calls this on the editor's change event
        expect(name.value).toBe('');
    });

    it('shows an inline message for a bad link and stores nothing', () => {
        const f = new EditingFacade(doc());
        const row = createCreditRow({ getFacade: () => f });
        const [name, url] = row.el.querySelectorAll('input');
        type(name, 'Jane');
        type(url, 'javascript:alert(1)');
        const err = row.el.querySelector('.tab-credit-error');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toMatch(/http/);
        expect(f.getTabBy()).toEqual({ name: 'Jane' });   // the link was not stored
    });

    it('is read-only for an existing credit unless the reader is trusted', async () => {
        const f = new EditingFacade(doc({ name: 'schlange' }));
        const row = createCreditRow({ getFacade: () => f, lockExisting: true, isTrusted: async () => false });
        const [name] = row.el.querySelectorAll('input');
        await tick();
        expect(name.readOnly).toBe(true);
        expect(name.value).toBe('schlange');
        expect(row.el.querySelector('.tab-credit-note').hidden).toBe(false);
        type(name, 'Mallory');
        expect(f.getTabBy().name).toBe('schlange');

        const trusted = createCreditRow({ getFacade: () => f, lockExisting: true, isTrusted: async () => true });
        await tick();
        const [tname] = trusted.el.querySelectorAll('input');
        expect(tname.readOnly).toBe(false);
        type(tname, 'Jane');
        expect(f.getTabBy().name).toBe('Jane');
    });

    it('anyone may fill a blank credit, even on a correction', async () => {
        const f = new EditingFacade(doc());
        const row = createCreditRow({ getFacade: () => f, lockExisting: true, isTrusted: async () => false });
        await tick();
        const [name] = row.el.querySelectorAll('input');
        expect(name.readOnly).toBe(false);
        type(name, 'Jane');
        expect(f.getTabBy().name).toBe('Jane');
    });

    it('fails closed when the trust check throws', async () => {
        const f = new EditingFacade(doc({ name: 'a' }));
        const row = createCreditRow({
            getFacade: () => f, lockExisting: true,
            isTrusted: async () => { throw new Error('offline'); },
        });
        await tick();
        expect(row.el.querySelector('input').readOnly).toBe(true);
    });
});
