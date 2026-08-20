// Right-click context menu for the tab canvas.
//
// Dumb on purpose: items and enablement come from open() options, the
// behaviors are injected actions — the editor decides what copy/paste
// mean, tests can stub everything.
//
// The KEY LABELS are not written here either: each item names a binding
// action and `keyFor(action, preset)` prints whatever the active preset
// binds it to, so the menu re-labels itself when the preset changes and
// can never advertise a key that isn't bound (plan §8.3 "One source").

import { keyFor, getPreset } from './bindings.js';

export class ContextMenu {
    /**
     * @param {Object} actions - id → handler. Ids not in `actions` are
     *   dropped from the menu, so a host can offer a subset.
     */
    constructor(actions = {}) {
        this.actions = actions;
        this.element = null;
        this._boundDismiss = (e) => this._onDismiss(e);
        this._boundKey = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    get isOpen() {
        return !!this.element;
    }

    /**
     * Open at a viewport point.
     * @param {number} x
     * @param {number} y
     * @param {Object} o - { hasSelection, hasClipboard, hasNote, preset }
     */
    open(x, y, {
        hasSelection = false, hasClipboard = false, hasNote = false,
        preset = getPreset(),
    } = {}) {
        this.close();

        const kbd = (action, fallback = '') => keyFor(action, preset) || fallback;

        const items = [
            { id: 'copy', label: hasSelection ? 'Copy selection' : 'Copy', kbd: kbd('clip.copy', '⌘C') },
            { id: 'cut', label: hasSelection ? 'Cut selection' : 'Cut', kbd: kbd('clip.cut', '⌘X') },
            { id: 'paste', label: 'Paste', kbd: kbd('clip.paste', '⌘V'), disabled: !hasClipboard },
            { id: 'delete', label: hasSelection ? 'Delete selection' : 'Delete note', kbd: kbd('note.deleteOrMeasure', '⌫') },
            { sep: true },
            hasSelection
                ? { id: 'loop', label: 'Loop selection', kbd: kbd('play.loop', 'L') }
                : { id: 'play', label: 'Play from here', kbd: kbd('play.fromCursor', '⇧Space') },
            { id: 'playMeasure', label: 'Play this measure', kbd: kbd('play.measure') },
            { sep: true },
            // Note-level fixes (the corpus has these; the editor could not
            // produce dead notes, chokes or ties until the table landed)
            { id: 'tie', label: 'Tie to previous note', kbd: kbd('effect.tie'), disabled: !hasNote && !hasSelection },
            { id: 'dead', label: 'Dead note', kbd: kbd('effect.dead'), disabled: !hasNote && !hasSelection },
            { id: 'choke', label: 'Choke / bend', kbd: kbd('effect.choke'), disabled: !hasNote && !hasSelection },
            { id: 'clearTech', label: 'Clear effect', kbd: kbd('effect.clear'), disabled: !hasNote && !hasSelection },
            { id: 'restringUp', label: 'Move up a string (same pitch)', kbd: kbd('note.restringUp'), disabled: !hasNote },
            { id: 'restringDown', label: 'Move down a string (same pitch)', kbd: kbd('note.restringDown'), disabled: !hasNote },
            { sep: true },
            { id: 'fixDurations', label: hasSelection ? 'Fix durations in selection' : 'Fix durations in measure', kbd: kbd('duration.fix') },
            { sep: true },
            { id: 'insertMeasureBefore', label: 'Insert measure before', kbd: kbd('measure.insertBefore') },
            { id: 'insertMeasureAfter', label: 'Insert measure after', kbd: kbd('measure.insertAfter') },
            { id: 'deleteMeasure', label: 'Delete this measure', kbd: kbd('measure.delete') },
            { id: 'repeatPrevious', label: 'Repeat previous measure', kbd: kbd('measure.repeatPrevious') },
            { id: 'rippleRight', label: 'Ripple right (open a slot)', kbd: kbd('measure.rippleRight') },
            { id: 'rippleLeft', label: 'Ripple left (close the gap)', kbd: kbd('measure.rippleLeft') },
        ];
        if (hasSelection) {
            items.push({ sep: true });
            items.push({ id: 'repeat', label: 'Repeat measures ×2', kbd: '|: :|' });
            items.push({ id: 'unrepeat', label: 'Remove repeat', kbd: '' });
        }

        const menu = document.createElement('div');
        menu.className = 'otf-context-menu';
        menu.style.cssText = `
            position: fixed;
            z-index: 1000;
            min-width: 180px;
            max-height: 80vh;
            overflow-y: auto;
            background: var(--bg, #fff);
            border: 1px solid var(--border, #ccc);
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.18);
            padding: 4px;
            font-size: 13px;
            user-select: none;
        `;

        let lastWasSep = true;
        for (const item of items) {
            if (item.sep) {
                if (lastWasSep) continue;
                const sep = document.createElement('div');
                sep.style.cssText = 'height:1px;background:var(--border, #ddd);margin:4px 6px;';
                menu.appendChild(sep);
                lastWasSep = true;
                continue;
            }
            // A host that doesn't provide the handler doesn't get the item
            if (!this.actions[item.id]) continue;
            lastWasSep = false;
            const el = document.createElement('button');
            el.type = 'button';
            el.className = `context-menu-item context-${item.id}`;
            el.disabled = !!item.disabled;
            el.style.cssText = `
                display: flex;
                justify-content: space-between;
                gap: 16px;
                width: 100%;
                padding: 6px 10px;
                border: 0;
                border-radius: 4px;
                background: none;
                text-align: left;
                cursor: ${item.disabled ? 'default' : 'pointer'};
                opacity: ${item.disabled ? 0.4 : 1};
            `;
            const kbdText = item.kbd == null ? '' : item.kbd;
            el.innerHTML = `<span>${item.label}</span><span style="opacity:.55">${kbdText}</span>`;
            if (!item.disabled) {
                el.addEventListener('mouseenter', () => { el.style.background = 'var(--bg-secondary, #eee)'; });
                el.addEventListener('mouseleave', () => { el.style.background = 'none'; });
                el.addEventListener('click', () => {
                    this.close();
                    this.actions[item.id]?.();
                });
            }
            menu.appendChild(el);
        }

        document.body.appendChild(menu);
        this.element = menu;

        // Clamp into the viewport
        const rect = menu.getBoundingClientRect();
        const left = Math.min(x, (window.innerWidth || rect.right) - rect.width - 8);
        const top = Math.min(y, (window.innerHeight || rect.bottom) - rect.height - 8);
        menu.style.left = `${Math.max(0, left)}px`;
        menu.style.top = `${Math.max(0, top)}px`;

        // Dismiss on any outside press or Escape (deferred so the
        // opening right-click itself doesn't immediately close it)
        setTimeout(() => {
            if (!this.element) return;
            document.addEventListener('mousedown', this._boundDismiss);
            document.addEventListener('contextmenu', this._boundDismiss);
            document.addEventListener('keydown', this._boundKey);
        }, 0);
    }

    _onDismiss(event) {
        if (this.element && !this.element.contains(event.target)) {
            this.close();
        }
    }

    close() {
        if (!this.element) return;
        this.element.remove();
        this.element = null;
        document.removeEventListener('mousedown', this._boundDismiss);
        document.removeEventListener('contextmenu', this._boundDismiss);
        document.removeEventListener('keydown', this._boundKey);
    }
}
