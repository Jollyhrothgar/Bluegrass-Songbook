// Right-click context menu for the tab canvas.
//
// Dumb on purpose: items and enablement come from open() options, the
// behaviors are injected actions — the editor decides what copy/paste
// mean, tests can stub everything.

export class ContextMenu {
    /**
     * @param {Object} actions - { copy, cut, paste, delete, loop, play }
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
     * @param {Object} o - { hasSelection, hasClipboard }
     */
    open(x, y, { hasSelection = false, hasClipboard = false } = {}) {
        this.close();

        const items = [
            { id: 'copy', label: hasSelection ? 'Copy selection' : 'Copy', kbd: '⌘C' },
            { id: 'cut', label: hasSelection ? 'Cut selection' : 'Cut', kbd: '⌘X' },
            { id: 'paste', label: 'Paste', kbd: '⌘V', disabled: !hasClipboard },
            { id: 'delete', label: hasSelection ? 'Delete selection' : 'Delete note', kbd: '⌫' },
            { sep: true },
            hasSelection
                ? { id: 'loop', label: 'Loop selection', kbd: 'L' }
                : { id: 'play', label: 'Play from here', kbd: '⇧Space' },
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
            background: var(--bg, #fff);
            border: 1px solid var(--border, #ccc);
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.18);
            padding: 4px;
            font-size: 13px;
            user-select: none;
        `;

        for (const item of items) {
            if (item.sep) {
                const sep = document.createElement('div');
                sep.style.cssText = 'height:1px;background:var(--border, #ddd);margin:4px 6px;';
                menu.appendChild(sep);
                continue;
            }
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
            el.innerHTML = `<span>${item.label}</span><span style="opacity:.55">${item.kbd}</span>`;
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
