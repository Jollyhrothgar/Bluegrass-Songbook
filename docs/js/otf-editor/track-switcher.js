// Phone track switcher (G20a).
//
// The toolbar's Track row is hidden on a phone (G17), so a multi-track file
// showed no way to change track. On a phone the track name above the tab
// ("mandolin / Standard / E A D G") becomes a button, "mandolin ▾ 1 of 4",
// that opens a short list of the tracks.
//
// The header itself is drawn by renderers/tablature.js, which the read view
// shares. This module leaves the renderer alone and decorates the header
// AFTER each editor render (editor.js, renderer.onAfterRender), so every
// redraw (rename, reorder, add, delete, undo) relabels the button for free,
// and the list is read from the document each time it opens.

/** "mandolin ▾ 1 of 4", or null when there is nothing to switch to. */
export function trackSwitcherLabel(tracks, activeId) {
    if (tracks.length < 2) return null;
    const index = Math.max(0, tracks.findIndex(t => t.id === activeId));
    return `${activeId} ▾ ${index + 1} of ${tracks.length}`;
}

export class TrackSwitcher {
    /**
     * @param {object} opts
     * @param {EditorState} opts.state
     * @param {() => boolean} opts.isPhone
     * @param {() => void} opts.onChoose  called after a track is chosen
     *        (the editor puts focus back on its canvas)
     */
    constructor({ state, isPhone, onChoose }) {
        this.state = state;
        this.isPhone = isPhone;
        this.onChoose = onChoose;
        this._list = null;
        this._button = null;
        this._onPointerDown = (e) => {
            if (this._list && !this._list.contains(e.target) &&
                !this._button?.contains(e.target)) this.close();
        };
        this._onKeyDown = (e) => {
            if (e.key !== 'Escape' || !this._list) return;
            e.stopPropagation();
            const button = this._button;
            this.close();
            button?.focus();
        };
    }

    /** Swap the name in a freshly drawn `.track-info` for the button. */
    decorate(infoEl) {
        this.close();
        this._button = null;
        const label = this.isPhone()
            ? trackSwitcherLabel(this.state.getTracks(), this.state.trackId)
            : null;
        const name = infoEl?.querySelector('strong');
        if (!label || !name) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'track-switcher-button';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        // A track name is user-typed: text, not HTML. Only the name is
        // capitalised, so the count stays "1 of 4".
        const nameSpan = document.createElement('span');
        nameSpan.className = 'track-switcher-name';
        nameSpan.textContent = this.state.trackId;
        btn.append(nameSpan, label.slice(this.state.trackId.length));
        btn.addEventListener('click', () => (this._list ? this.close() : this.open()));
        name.replaceWith(btn);
        infoEl.classList.add('has-track-switcher');
        this._button = btn;
    }

    open() {
        const btn = this._button;
        if (!btn || this._list) return;
        const list = document.createElement('div');
        list.className = 'track-switcher-list';
        list.setAttribute('role', 'menu');
        for (const t of this.state.getTracks()) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'track-switcher-item';
            item.setAttribute('role', 'menuitemradio');
            const current = t.id === this.state.trackId;
            item.setAttribute('aria-checked', String(current));
            const mark = document.createElement('span');
            mark.className = 'track-switcher-check';
            mark.textContent = current ? '✓' : '';
            const text = document.createElement('span');
            text.className = 'track-switcher-name';
            text.textContent = t.id;
            item.append(mark, text);
            item.addEventListener('click', () => {
                this.close();
                this.state.setTrack(t.id);
                this.onChoose?.();
            });
            list.appendChild(item);
        }
        btn.after(list);
        btn.setAttribute('aria-expanded', 'true');
        this._list = list;
        document.addEventListener('pointerdown', this._onPointerDown, true);
        document.addEventListener('keydown', this._onKeyDown, true);
    }

    close() {
        document.removeEventListener('pointerdown', this._onPointerDown, true);
        document.removeEventListener('keydown', this._onKeyDown, true);
        this._list?.remove();
        this._list = null;
        this._button?.setAttribute('aria-expanded', 'false');
    }

    destroy() {
        this.close();
        this._button = null;
    }
}
