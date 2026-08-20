// OTF Editor menu bar — plan `docs/plans/tab-editor-input-parity.md` §8.3
//
// TablEdit's grouping (File · Edit · Note · Play · Score · View · Help),
// trimmed to what we actually have, with every shortcut printed BESIDE
// its item. The keys are not written here: an item names an ACTION and
// the bar asks `keyFor(action, preset)` for the key, so a shortcut can
// never be advertised that isn't bound, and switching preset relabels
// the whole bar at once (`onPresetChange`).
//
// It is also the home for the rarely-used-but-real commands that had
// nowhere to live: insert/delete measure, ripple, repeats, tempo,
// measures-per-row, zoom, track rename/reorder. Those are not key
// bindings, so they arrive as `hooks` from the editor; an item whose
// hook is missing is simply not rendered (that is how a wrapper that
// can't do something says so — by not offering it).
//
// Deliberately library-free: plain <button> triggers and `role="menu"`
// lists. No Alt+letter mnemonics — they are OS-sensitive and Chromium
// eats several of them; menus open on click and are then arrow-driven.

import {
    ACTIONS, PRESETS, keyFor, prettyKeys, getPreset, setPreset, onPresetChange,
} from './bindings.js';

/** Below this width the bar collapses to a single ☰ sheet. */
export const NARROW_WIDTH = 720;

/** Where "About OTF" goes (relative to the page that mounts the editor). */
export const ABOUT_URL = 'js/otf-editor/DESIGN.md';

// ----------------------------------------------------------------------
// `when` predicates — one place, so "disabled" means the same thing in
// every menu. Each takes the editor state.
// ----------------------------------------------------------------------
const hasNote = (s) => !!s?.getNoteAtCursor?.();
const hasSelection = (s) => !!s?.selection;
const hasClipboard = (s) => !!s?.clipboard;
const hasText = (s) => !!s?.getAnnotationAtCursor?.();
const canUndo = (s) => !!s?.history?.canUndo?.();
const canRedo = (s) => !!s?.history?.canRedo?.();
const manyMeasures = (s) => (s?.getMeasureCount?.() || 1) > 1;

/**
 * THE menu tree. Items:
 *   {action}                  a binding action — label + key come from the table
 *   {action, label}           …with the menu's own wording
 *   {hook, label}             a callback the editor supplied (omitted if absent)
 *   {hook, label, checked}    …drawn as a latch
 *   {dynamic}                 expanded at open time by hooks[dynamic]()
 *   {preset}                  a preset radio (Help)
 *   {separator: true}         a rule
 *   {heading}                 a group label (our flat stand-in for a ▸ submenu)
 *   when(state)               enabled only when this returns true
 */
export const MENUS = [
    {
        id: 'file',
        label: 'File',
        items: [
            { dynamic: 'file' },
        ],
    },
    {
        id: 'edit',
        label: 'Edit',
        items: [
            { action: 'edit.undo', when: canUndo },
            { action: 'edit.redo', when: canRedo },
            { separator: true },
            { action: 'clip.cut', label: 'Cut' },
            { action: 'clip.copy', label: 'Copy' },
            { action: 'clip.paste', label: 'Paste', when: hasClipboard },
            { action: 'select.measureOrAll', label: 'Select all' },
            { separator: true },
            { action: 'measure.insertBefore', label: 'Insert measure before' },
            { action: 'measure.insertAfter', label: 'Insert measure after' },
            { action: 'measure.delete', label: 'Delete measure', when: manyMeasures },
            { action: 'measure.repeatPrevious', label: 'Repeat the previous measure' },
            { action: 'measure.rippleRight', label: 'Shift right' },
            { action: 'measure.rippleLeft', label: 'Shift left' },
            { separator: true },
            { hook: 'repeatSpan', label: 'Repeat measures ×2', when: hasSelection },
            { hook: 'removeRepeat', label: 'Remove repeat', when: hasSelection },
            { separator: true },
            { action: 'text.edit', label: 'Text at cursor…' },
            { action: 'text.delete', label: 'Delete text', when: hasText },
        ],
    },
    {
        id: 'note',
        label: 'Note',
        items: [
            { action: 'duration.auto', label: 'Automatic duration' },
            { separator: true },
            { action: 'duration.whole', label: 'Whole' },
            { action: 'duration.half', label: 'Half' },
            { action: 'duration.quarter', label: 'Quarter' },
            { action: 'duration.eighth', label: 'Eighth' },
            { action: 'duration.sixteenth', label: '16th' },
            { action: 'duration.thirtySecond', label: '32nd' },
            { action: 'duration.dotted', label: 'Dotted' },
            { action: 'duration.triplet', label: 'Triplet' },
            { separator: true },
            { action: 'duration.shorter', label: 'Shorter', when: hasNote },
            { action: 'duration.longer', label: 'Longer', when: hasNote },
            { action: 'duration.applyToSelection', label: 'Apply duration to selection', when: hasSelection },
            { action: 'duration.fix', label: 'Fix durations from spacing' },
            { separator: true },
            { action: 'effect.tie', label: 'Tie', when: hasNote },
            { action: 'effect.hammer', label: 'Hammer-on' },
            { action: 'effect.pull', label: 'Pull-off' },
            { action: 'effect.slide', label: 'Slide' },
            { action: 'effect.dead', label: 'Dead' },
            { action: 'effect.choke', label: 'Choke' },
            { action: 'effect.clear', label: 'Clear' },
            { action: 'effect.repeatLast', label: 'Repeat last effect' },
            { separator: true },
            { heading: 'Fingering' },
            { action: 'finger.thumb', label: 'Thumb', when: hasNote },
            { action: 'finger.index', label: 'Index', when: hasNote },
            { action: 'finger.middle', label: 'Middle', when: hasNote },
            { separator: true },
            { action: 'note.fretUp', label: 'Fret +1', when: hasNote },
            { action: 'note.fretDown', label: 'Fret −1', when: hasNote },
            { action: 'note.restringUp', label: 'String above, same pitch', when: hasNote },
            { action: 'note.restringDown', label: 'String below, same pitch', when: hasNote },
        ],
    },
    {
        id: 'play',
        label: 'Play',
        items: [
            { action: 'play.toggle', label: 'Play / stop' },
            { action: 'play.fromCursor', label: 'Play from the cursor' },
            { action: 'play.measure', label: 'Play this measure' },
            { action: 'play.loop', label: 'Loop the selection' },
            { separator: true },
            { hook: 'tempo', label: 'Tempo…' },
            { hook: 'metronome', label: 'Metronome', checked: 'metronomeOn' },
        ],
    },
    {
        id: 'score',
        label: 'Score',
        items: [
            { heading: 'Tracks' },
            { dynamic: 'tracks' },
            { hook: 'renameTrack', label: 'Rename track…' },
            { hook: 'moveTrackEarlier', label: 'Move track earlier' },
            { hook: 'moveTrackLater', label: 'Move track later' },
            { separator: true },
            { hook: 'tempo', label: 'Tempo…' },
            { hook: 'timeSignature', label: 'Time signature…' },
            { hook: 'tuning', label: 'Tuning…' },
            { separator: true },
            { action: 'nav.goToMeasure', label: 'Go to measure…' },
        ],
    },
    {
        id: 'view',
        label: 'View',
        items: [
            { heading: 'Grid' },
            { action: 'grid.toggle', label: 'Show the grid' },
            { action: 'grid.coarser', label: 'Coarser' },
            { action: 'grid.finer', label: 'Finer' },
            { action: 'grid.triplet', label: 'Triplet grid' },
            { separator: true },
            { heading: 'Measures per row' },
            { dynamic: 'measuresPerRow' },
            { separator: true },
            { hook: 'zoomIn', label: 'Zoom in' },
            { hook: 'zoomOut', label: 'Zoom out' },
            { hook: 'zoomReset', label: 'Reset zoom' },
        ],
    },
    {
        id: 'help',
        label: 'Help',
        items: [
            { action: 'help.toggle', label: 'Keyboard shortcuts' },
            { separator: true },
            { heading: 'Preset' },
            ...Object.values(PRESETS).map(p => ({ preset: p.id, label: p.label })),
            { separator: true },
            { hook: 'about', label: 'About OTF' },
        ],
    },
];

/**
 * The menu bar.
 *
 * @param {Object} options
 * @param {Object} options.state - EditorState (read for `when` predicates)
 * @param {Function} options.dispatch - (actionId) => void, i.e. keyboard.dispatchAction
 * @param {Object} [options.hooks] - named callbacks for the non-binding items
 * @param {Array}  [options.fileActions] - [{label, run, disabled?}] for File
 * @param {string} [options.aboutUrl]
 * @param {Function} [options.onClose] - called when a menu closes (refocus)
 */
export class EditorMenuBar {
    constructor(options = {}) {
        this.state = options.state || null;
        this.dispatch = options.dispatch || (() => {});
        this.hooks = options.hooks || {};
        this.fileActions = options.fileActions || [];
        this.aboutUrl = options.aboutUrl || ABOUT_URL;
        this.onClose = options.onClose || (() => {});
        this.narrowWidth = options.narrowWidth || NARROW_WIDTH;

        this.element = null;
        this.popup = null;
        this.openMenu = null;
        this._unsubPreset = null;
        this._onDocClick = this._onDocClick.bind(this);
        this._onResize = this._onResize.bind(this);
    }

    render(container) {
        this.element = document.createElement('div');
        this.element.className = 'otf-menu-bar';
        this.element.setAttribute('role', 'menubar');

        this.triggerRow = document.createElement('div');
        this.triggerRow.className = 'menu-triggers';
        this.element.appendChild(this.triggerRow);

        for (const menu of MENUS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu-trigger';
            btn.dataset.menu = menu.id;
            btn.textContent = menu.label;
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('aria-haspopup', 'true');
            btn.setAttribute('aria-expanded', 'false');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggle(menu.id);
            });
            btn.addEventListener('keydown', (e) => this._onTriggerKey(e, menu.id));
            this.triggerRow.appendChild(btn);
        }

        // The popup is a child of <body>, not of the bar: `.otf-editor`
        // clips its content (`overflow: hidden`, for the rounded corner)
        // and in fill mode the chrome sits at the BOTTOM of the editor,
        // so an in-flow menu is cut in half either way. Fixed position +
        // measured placement handles both, and drops up when it must.
        this.popup = document.createElement('div');
        this.popup.className = 'menu-popup';
        this.popup.setAttribute('role', 'menu');
        this.popup.hidden = true;
        document.body.appendChild(this.popup);

        this._applyStyles();
        container.appendChild(this.element);

        // A shortcut column that follows the preset — the whole point of
        // generating the bar from the table.
        this._unsubPreset = onPresetChange(() => {
            if (this.openMenu) this._buildPopup(this.openMenu);
        });
        document.addEventListener('click', this._onDocClick);
        globalThis.addEventListener?.('resize', this._onResize);
        this.updateLayout();
    }

    // ── Narrow screens: one ☰ opening the same menus ──────────────────
    /** @returns {number} the width the layout decision is made on */
    _width() {
        return this.element?.clientWidth
            || globalThis.innerWidth
            || this.narrowWidth + 1;
    }

    /** Show the trigger row, or a single ☰, depending on the width. */
    updateLayout() {
        if (!this.element) return;
        const narrow = this._width() < this.narrowWidth;
        if (narrow === this._narrow) return;
        this._narrow = narrow;
        this.element.classList.toggle('is-narrow', narrow);
        this.close();
        if (narrow && !this.hamburger) {
            this.hamburger = document.createElement('button');
            this.hamburger.type = 'button';
            this.hamburger.className = 'menu-hamburger';
            this.hamburger.textContent = '☰';
            this.hamburger.title = 'Menu';
            this.hamburger.setAttribute('aria-haspopup', 'true');
            this.hamburger.setAttribute('aria-expanded', 'false');
            this.hamburger.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggle('*');
            });
            this.element.insertBefore(this.hamburger, this.triggerRow);
        } else if (!narrow && this.hamburger) {
            this.hamburger.remove();
            this.hamburger = null;
        }
    }

    _onResize() { this.updateLayout(); }

    _onDocClick(e) {
        if (!this.element || this.popup.hidden) return;
        if (this.element.contains(e.target) || this.popup.contains(e.target)) return;
        this.close();
    }

    // ── Open / close ──────────────────────────────────────────────────
    toggle(menuId) {
        if (this.openMenu === menuId) this.close();
        else this.open(menuId);
    }

    /** @param {string} menuId - a menu id, or `'*'` for the ☰ sheet */
    open(menuId) {
        this._buildPopup(menuId);
        this.openMenu = menuId;
        this.popup.hidden = false;
        this._position(menuId);
        this._syncExpanded();
        const first = this.popup.querySelector('[role="menuitem"]:not([disabled])');
        first?.focus();
    }

    close() {
        if (!this.popup) return;
        this.popup.hidden = true;
        this.openMenu = null;
        this._syncExpanded();
    }

    /**
     * Put the popup under its trigger — or above it, when the editor's
     * chrome is at the bottom of the screen and there is no room below.
     */
    _position(menuId) {
        const anchor = menuId === '*'
            ? (this.hamburger || this.element)
            : this.triggerRow.querySelector(`.menu-trigger[data-menu="${menuId}"]`);
        const box = (anchor || this.element)?.getBoundingClientRect?.();
        if (!box) return;
        const vh = globalThis.innerHeight || 800;
        const vw = globalThis.innerWidth || 1024;
        const height = this.popup.offsetHeight || 0;
        const below = vh - box.bottom;
        const dropUp = height > below && box.top > below;
        this.popup.style.maxHeight = `${Math.max(160, (dropUp ? box.top : below) - 12)}px`;
        this.popup.style.top = dropUp ? '' : `${box.bottom + 2}px`;
        this.popup.style.bottom = dropUp ? `${vh - box.top + 2}px` : '';
        if (menuId === '*') {
            this.popup.style.left = `${Math.max(4, box.left)}px`;
            this.popup.style.right = `${Math.max(4, vw - box.left - 320)}px`;
        } else {
            const width = this.popup.offsetWidth || 260;
            this.popup.style.left = `${Math.max(4, Math.min(box.left, vw - width - 8))}px`;
            this.popup.style.right = '';
        }
    }

    _syncExpanded() {
        for (const btn of this.triggerRow.querySelectorAll('.menu-trigger')) {
            const on = btn.dataset.menu === this.openMenu;
            btn.setAttribute('aria-expanded', on ? 'true' : 'false');
            btn.classList.toggle('is-open', on);
        }
        this.hamburger?.setAttribute('aria-expanded',
            this.openMenu === '*' ? 'true' : 'false');
    }

    // ── The popup ─────────────────────────────────────────────────────
    _buildPopup(menuId) {
        this.popup.innerHTML = '';
        this.popup.classList.toggle('is-sheet', menuId === '*');
        const menus = menuId === '*'
            ? MENUS
            : MENUS.filter(m => m.id === menuId);
        for (const menu of menus) {
            if (menuId === '*') {
                const head = document.createElement('div');
                head.className = 'menu-sheet-head';
                head.textContent = menu.label;
                this.popup.appendChild(head);
            }
            for (const el of this._renderItems(menu.items)) {
                this.popup.appendChild(el);
            }
        }
    }

    /** @returns {HTMLElement[]} */
    _renderItems(items) {
        const out = [];
        for (const item of items) {
            if (item.separator) {
                const hr = document.createElement('div');
                hr.className = 'menu-separator';
                out.push(hr);
                continue;
            }
            if (item.heading) {
                const h = document.createElement('div');
                h.className = 'menu-heading';
                h.textContent = item.heading;
                out.push(h);
                continue;
            }
            if (item.dynamic) {
                for (const entry of this._dynamicItems(item.dynamic)) {
                    out.push(this._menuItem(entry));
                }
                continue;
            }
            if (item.preset) {
                out.push(this._menuItem({
                    label: item.label,
                    checked: getPreset() === item.preset,
                    role: 'menuitemradio',
                    run: () => setPreset(item.preset),
                    keepOpen: true,
                }));
                continue;
            }
            if (item.hook) {
                const fn = this._hook(item.hook);
                if (!fn) continue;
                out.push(this._menuItem({
                    label: item.label,
                    run: fn,
                    disabled: item.when ? !item.when(this.state) : false,
                    checked: item.checked ? !!this.hooks[item.checked]?.() : undefined,
                    role: item.checked ? 'menuitemcheckbox' : 'menuitem',
                }));
                continue;
            }
            const action = ACTIONS[item.action];
            if (!action) continue;   // an action that was renamed away
            out.push(this._menuItem({
                label: item.label || action.label,
                keys: keyFor(item.action, getPreset()),
                disabled: item.when ? !item.when(this.state) : false,
                run: () => this.dispatch(item.action),
                actionId: item.action,
            }));
        }
        // Trim rules that ended up adjacent (a whole group can vanish
        // when its hooks are missing)
        return out.filter((el, i) => {
            if (!el.classList.contains('menu-separator')) return true;
            const next = out[i + 1];
            return i > 0 && next && !next.classList.contains('menu-separator');
        });
    }

    /** The hook, or a built-in default where the bar can answer itself. */
    _hook(name) {
        if (this.hooks[name]) return this.hooks[name];
        if (name === 'about') {
            return () => globalThis.open?.(this.aboutUrl, '_blank', 'noopener');
        }
        return null;
    }

    _dynamicItems(name) {
        if (name === 'file') {
            return (this.fileActions || []).map(a => ({
                label: a.label,
                keys: a.action ? keyFor(a.action, getPreset()) : null,
                disabled: !!a.disabled,
                run: () => a.run?.(),
            }));
        }
        const fn = this.hooks[name];
        if (!fn) return [];
        return (fn() || []).map(entry => ({
            label: entry.label,
            checked: entry.checked,
            role: entry.checked === undefined ? 'menuitem' : 'menuitemradio',
            disabled: !!entry.disabled,
            run: () => entry.run?.(),
        }));
    }

    _menuItem({ label, keys, disabled, checked, run, role = 'menuitem',
        actionId, keepOpen = false }) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-item';
        btn.setAttribute('role', role);
        if (actionId) btn.dataset.action = actionId;
        if (checked !== undefined) {
            btn.setAttribute('aria-checked', checked ? 'true' : 'false');
            btn.classList.toggle('is-checked', !!checked);
        }
        if (disabled) btn.disabled = true;

        // textContent for both halves: labels and track names are data
        const name = document.createElement('span');
        name.className = 'menu-item-label';
        name.textContent = (checked ? '✓ ' : '') + String(label ?? '');
        btn.appendChild(name);

        const key = document.createElement('span');
        key.className = 'menu-item-key';
        key.textContent = keys ? prettyKeys(keys) : '';
        btn.appendChild(key);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.disabled) return;
            run?.();
            if (keepOpen) this._buildPopup(this.openMenu);
            else { this.close(); this.onClose(); }
        });
        btn.addEventListener('keydown', (e) => this._onItemKey(e));
        return btn;
    }

    // ── Keyboard ──────────────────────────────────────────────────────
    _onTriggerKey(e, menuId) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            this.open(menuId);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            const btns = [...this.triggerRow.querySelectorAll('.menu-trigger')];
            const i = btns.findIndex(b => b.dataset.menu === menuId);
            const next = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1))
                % btns.length];
            next.focus();
            if (this.openMenu) this.open(next.dataset.menu);
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            this.close();
            this.onClose();
        }
    }

    _onItemKey(e) {
        const items = [...this.popup.querySelectorAll(
            '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')]
            .filter(b => !b.disabled);
        const i = items.indexOf(e.target);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1))
                % items.length];
            next?.focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.close();
            this.onClose();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            const trigger = this.triggerRow.querySelector(
                `.menu-trigger[data-menu="${this.openMenu}"]`);
            trigger?.focus();
            this._onTriggerKey(e, this.openMenu);
        }
    }

    _applyStyles() {
        if (document.querySelector('style[data-otf-menu-bar]')) return;
        const style = document.createElement('style');
        style.setAttribute('data-otf-menu-bar', '');
        style.textContent = `
            .otf-menu-bar {
                position: relative;
                display: flex;
                align-items: center;
                gap: 2px;
                padding: 2px 6px;
                background: var(--bg-secondary, #f5f5f5);
                border-bottom: 1px solid var(--border, #ddd);
                font-size: 13px;
            }
            .menu-triggers { display: flex; gap: 2px; }
            .otf-menu-bar.is-narrow .menu-triggers { display: none; }
            .menu-trigger, .menu-hamburger {
                border: 1px solid transparent;
                background: none;
                color: var(--text, #333);
                padding: 3px 10px;
                border-radius: 4px;
                cursor: pointer;
                font: inherit;
            }
            .menu-trigger:hover, .menu-hamburger:hover {
                background: var(--bg-hover, #e9e9e9);
            }
            .menu-trigger.is-open {
                background: var(--bg, #fff);
                border-color: var(--border, #ddd);
            }
            .menu-popup {
                position: fixed;
                z-index: 2000;
                /* It hangs off <body>, so the bar's type size does not
                   cascade into it — say it again here. */
                font-size: 13px;
                min-width: 260px;
                max-height: 70vh;
                overflow: auto;
                padding: 4px;
                background: var(--bg, #fff);
                border: 1px solid var(--border, #ccc);
                border-radius: 6px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
            }
            .menu-popup[hidden] { display: none; }
            .menu-popup.is-sheet { min-width: 0; }
            .menu-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 24px;
                width: 100%;
                padding: 5px 10px;
                border: none;
                border-radius: 4px;
                background: none;
                color: var(--text, #333);
                font: inherit;
                text-align: left;
                cursor: pointer;
            }
            .menu-item:hover:not(:disabled), .menu-item:focus {
                background: var(--bg-hover, #e9e9e9);
                outline: none;
            }
            .menu-item:disabled { opacity: 0.45; cursor: default; }
            .menu-item-key {
                color: var(--text-muted, #888);
                font-size: 12px;
                white-space: nowrap;
            }
            .menu-separator {
                height: 1px;
                margin: 4px 6px;
                background: var(--border, #ddd);
            }
            .menu-heading, .menu-sheet-head {
                padding: 6px 10px 2px;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--text-muted, #888);
            }
            .menu-sheet-head {
                font-weight: 700;
                border-top: 1px solid var(--border, #ddd);
                margin-top: 4px;
            }
            .menu-popup .menu-sheet-head:first-child {
                border-top: 0;
                margin-top: 0;
            }
        `;
        document.head.appendChild(style);
    }

    destroy() {
        this._unsubPreset?.();
        document.removeEventListener('click', this._onDocClick);
        globalThis.removeEventListener?.('resize', this._onResize);
        this.element?.remove();
        this.popup?.remove();
        this.element = null;
        this.popup = null;
        this.hamburger = null;
    }
}
