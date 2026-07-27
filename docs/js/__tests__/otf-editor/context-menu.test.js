// Unit tests for the right-click context menu (injected actions).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ContextMenu } from '../../otf-editor/context-menu.js';

describe('ContextMenu', () => {
    let menu, actions;

    beforeEach(() => {
        vi.useFakeTimers();
        actions = {
            copy: vi.fn(), cut: vi.fn(), paste: vi.fn(),
            delete: vi.fn(), loop: vi.fn(), play: vi.fn(),
        };
        menu = new ContextMenu(actions);
    });

    afterEach(() => {
        menu.close();
        vi.useRealTimers();
    });

    it('opens with the phrase actions', () => {
        menu.open(100, 100, { hasSelection: true, hasClipboard: true });
        expect(menu.isOpen).toBe(true);
        const labels = [...document.querySelectorAll('.context-menu-item')]
            .map(el => el.textContent);
        expect(labels.join('|')).toContain('Copy selection');
        expect(labels.join('|')).toContain('Loop selection');
    });

    it('without a selection offers note-level actions and play-from-here', () => {
        menu.open(100, 100, { hasSelection: false, hasClipboard: true });
        const html = document.querySelector('.otf-context-menu').textContent;
        expect(html).toContain('Delete note');
        expect(html).toContain('Play from here');
        expect(html).not.toContain('Loop selection');
    });

    it('disables Paste with an empty clipboard', () => {
        menu.open(100, 100, { hasClipboard: false });
        const paste = document.querySelector('.context-paste');
        expect(paste.disabled).toBe(true);
        paste.click();
        expect(actions.paste).not.toHaveBeenCalled();
        expect(menu.isOpen).toBe(true); // disabled click doesn't close
    });

    it('clicking an item fires its action and closes', () => {
        menu.open(100, 100, { hasSelection: true, hasClipboard: true });
        document.querySelector('.context-cut').click();
        expect(actions.cut).toHaveBeenCalled();
        expect(menu.isOpen).toBe(false);
        expect(document.querySelector('.otf-context-menu')).toBeNull();
    });

    it('Escape and outside presses dismiss it', () => {
        menu.open(100, 100, {});
        vi.runAllTimers(); // arm the dismiss listeners
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(menu.isOpen).toBe(false);

        menu.open(100, 100, {});
        vi.runAllTimers();
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(menu.isOpen).toBe(false);
    });

    it('reopening replaces the previous menu', () => {
        menu.open(100, 100, {});
        menu.open(200, 200, {});
        expect(document.querySelectorAll('.otf-context-menu')).toHaveLength(1);
    });
});
