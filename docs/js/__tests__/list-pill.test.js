// @vitest-environment jsdom
// The set-list pill (G19c): what it says and when, and which keys step.
import { describe, it, expect, vi } from 'vitest';
import { listPillModel, isStepKey, buildListPill } from '../list-pill.js';

const ctx = (currentIndex, n = 9, extra = {}) => ({
    listId: 'l1', listName: 'Friday Jam', songIds: Array.from({ length: n }, (_, i) => `s${i}`), currentIndex, ...extra,
});

describe('listPillModel', () => {
    it('is null outside a list', () => {
        expect(listPillModel(null)).toBeNull();
        expect(listPillModel({})).toBeNull();
        expect(listPillModel({ listId: 'l1', songIds: [], currentIndex: 0 })).toBeNull();
    });

    it('is null while the list itself is showing (index -1) or the index is off the end', () => {
        expect(listPillModel(ctx(-1))).toBeNull();
        expect(listPillModel(ctx(9))).toBeNull();
        expect(listPillModel(ctx(undefined))).toBeNull();
    });

    it('counts from one and names the list', () => {
        expect(listPillModel(ctx(1))).toMatchObject({ label: '2 of 9', listName: 'Friday Jam', hasPrev: true, hasNext: true });
    });

    it('has no prev on the first song and no next on the last', () => {
        expect(listPillModel(ctx(0))).toMatchObject({ hasPrev: false, hasNext: true });
        expect(listPillModel(ctx(8))).toMatchObject({ hasPrev: true, hasNext: false });
        expect(listPillModel(ctx(0, 1))).toMatchObject({ hasPrev: false, hasNext: false, label: '1 of 1' });
    });
});

describe('isStepKey', () => {
    const press = (key, target = document.body, init = {}) => {
        const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
        Object.defineProperty(e, 'target', { value: target });
        return isStepKey(e);
    };
    const inside = (html, sel) => {
        const host = document.createElement('div');
        host.innerHTML = html;
        document.body.appendChild(host);
        return host.querySelector(sel);
    };

    it('maps ← and → on the page', () => {
        expect(press('ArrowLeft')).toBe('prev');
        expect(press('ArrowRight')).toBe('next');
        expect(press('ArrowUp')).toBeNull();
        expect(press('a')).toBeNull();
    });

    it('ignores typing in an input, a textarea and a select', () => {
        expect(press('ArrowLeft', inside('<input>', 'input'))).toBeNull();
        expect(press('ArrowLeft', inside('<textarea></textarea>', 'textarea'))).toBeNull();
        expect(press('ArrowRight', inside('<select><option>a</option></select>', 'select'))).toBeNull();
    });

    it('ignores contenteditable and CodeMirror', () => {
        expect(press('ArrowLeft', inside('<div contenteditable="true"><span>x</span></div>', 'span'))).toBeNull();
        expect(press('ArrowLeft', inside('<div class="cm-editor"><div class="cm-content">x</div></div>', '.cm-content'))).toBeNull();
    });

    it('ignores the tab editor and its canvas, and the lyrics editor panel', () => {
        expect(press('ArrowRight', inside('<div class="otf-editor"><div class="editor-canvas-container" tabindex="0"><svg></svg></div></div>', '.editor-canvas-container'))).toBeNull();
        expect(press('ArrowRight', inside('<div class="otf-editor"><button>b</button></div>', 'button'))).toBeNull();
        expect(press('ArrowRight', inside('<div id="editor-panel"><button>b</button></div>', 'button'))).toBeNull();
    });

    it('ignores everything while the tab editor is open, even with focus on the page', () => {
        document.body.classList.add('tab-editing');
        expect(press('ArrowLeft')).toBeNull();
        document.body.classList.remove('tab-editing');
        expect(press('ArrowLeft')).toBe('prev');
    });

    it('ignores an open sheet', () => {
        expect(press('ArrowRight', inside('<div role="dialog"><button>b</button></div>', 'button'))).toBeNull();
    });

    it('ignores a modifier (Alt+← is Back) and a key someone else took', () => {
        expect(press('ArrowLeft', document.body, { altKey: true })).toBeNull();
        expect(press('ArrowLeft', document.body, { metaKey: true })).toBeNull();
        expect(press('ArrowLeft', document.body, { shiftKey: true })).toBeNull();
        const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
        e.preventDefault();
        expect(isStepKey(e)).toBeNull();
    });
});

describe('buildListPill', () => {
    it('shows ‹ 2 of 9 › and calls what each part is for', () => {
        const calls = { onPrev: vi.fn(), onNext: vi.fn(), onList: vi.fn() };
        const el = buildListPill(listPillModel(ctx(1)), calls);
        expect([...el.querySelectorAll('button')].map(b => b.textContent)).toEqual(['‹', '2 of 9', '›']);
        el.querySelector('.list-prev').click();
        el.querySelector('.list-pos').click();
        el.querySelector('.list-next').click();
        expect(calls.onPrev).toHaveBeenCalledOnce();
        expect(calls.onList).toHaveBeenCalledOnce();
        expect(calls.onNext).toHaveBeenCalledOnce();
        expect(el.querySelector('.list-pos').title).toBe('Back to Friday Jam');
    });

    it('disables prev at the start and next at the end', () => {
        const noop = { onPrev() {}, onNext() {}, onList() {} };
        const first = buildListPill(listPillModel(ctx(0)), noop);
        expect(first.querySelector('.list-prev').disabled).toBe(true);
        expect(first.querySelector('.list-next').disabled).toBe(false);
        const last = buildListPill(listPillModel(ctx(8)), noop);
        expect(last.querySelector('.list-prev').disabled).toBe(false);
        expect(last.querySelector('.list-next').disabled).toBe(true);
    });
});
