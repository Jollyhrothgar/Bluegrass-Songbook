// Track switcher (G20a, generalised by G23).
//
// The track name above a staff ("mandolin / Standard / E A D G") becomes a
// button, "Mandolin ▾ 1 of 4", that opens a short list of the tracks. One
// control for the read view (every width, with an "All tracks" item) and the
// tab editor (phone only, no All). It is a pure control: the host says what
// the tracks are, which one is showing, and what choosing does.
//
// The header itself is drawn by renderers/tablature.js. This module leaves
// the renderer alone and decorates the header AFTER it is drawn, and the
// list is read from the host each time it opens.

/** A track id made readable: "guitar-2" -> "Guitar 2". */
export function friendlyTrackName(track) {
    const own = typeof track?.name === 'string' ? track.name.trim() : '';
    if (own) return own;
    const id = String(track?.id ?? '').replace(/[-_]+/g, ' ').trim();
    return id.charAt(0).toUpperCase() + id.slice(1);
}

const labelOf = (item) => item.label ?? item.id;

/**
 * "Mandolin ▾ 1 of 4" (a track) or "All tracks ▾" (an extra item), or null
 * when there is nothing to switch to. `parts` is {name, rest} for the button.
 */
export function trackSwitcherParts(tracks, activeId, extra = []) {
    if (tracks.length < 2) return null;
    const other = extra.find(x => x.id === activeId);
    if (other) return { name: labelOf(other), rest: ' ▾' };
    const index = Math.max(0, tracks.findIndex(t => t.id === activeId));
    return { name: labelOf(tracks[index]), rest: ` ▾ ${index + 1} of ${tracks.length}` };
}

export function trackSwitcherLabel(tracks, activeId, extra = []) {
    const p = trackSwitcherParts(tracks, activeId, extra);
    return p && p.name + p.rest;
}

export class TrackSwitcher {
    /**
     * @param {object} opts
     * @param {() => {id: string, label?: string}[]} opts.getTracks
     * @param {() => string} opts.getActive   a track id, or an `extra` id
     * @param {(id: string) => void} opts.choose
     * @param {() => boolean} [opts.enabled]  false leaves the header alone
     * @param {{id: string, label: string}[]} [opts.extra]  items after the tracks
     */
    constructor({ getTracks, getActive, choose, enabled = () => true, extra = [] }) {
        this.getTracks = getTracks;
        this.getActive = getActive;
        this.choose = choose;
        this.enabled = enabled;
        this.extra = extra;
        this._list = null;
        this._button = null;
        this._name = null;       // the renderer's <strong>, kept while the button stands in for it
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

    /** Swap the name in a `.track-info` for the button (or put it back). */
    decorate(infoEl) {
        this.close();
        const parts = this.enabled()
            ? trackSwitcherParts(this.getTracks(), this.getActive(), this.extra)
            : null;
        if (this._button && infoEl?.contains(this._button)) {
            // Drawn before: relabel, or give the plain name back
            if (parts) { this._fill(this._button, parts); return; }
            this._button.replaceWith(this._name);
            infoEl.classList.remove('has-track-switcher');
            this._button = null;
            return;
        }
        this._button = null;
        const name = infoEl?.querySelector('strong');
        if (!parts || !name) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'track-switcher-button';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        this._fill(btn, parts);
        btn.addEventListener('click', () => (this._list ? this.close() : this.open()));
        name.replaceWith(btn);
        this._name = name;
        infoEl.classList.add('has-track-switcher');
        this._button = btn;
    }

    // A track name is user-typed: text, not HTML. Only the name is
    // capitalised (CSS), so the count stays "1 of 4".
    _fill(btn, { name, rest }) {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'track-switcher-name';
        nameSpan.textContent = name;
        btn.replaceChildren(nameSpan, rest);
    }

    open() {
        const btn = this._button;
        if (!btn || this._list) return;
        const list = document.createElement('div');
        list.className = 'track-switcher-list';
        list.setAttribute('role', 'menu');
        const active = this.getActive();
        for (const t of [...this.getTracks(), ...this.extra]) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'track-switcher-item';
            item.setAttribute('role', 'menuitemradio');
            const current = t.id === active;
            item.setAttribute('aria-checked', String(current));
            const mark = document.createElement('span');
            mark.className = 'track-switcher-check';
            mark.textContent = current ? '✓' : '';
            const text = document.createElement('span');
            text.className = 'track-switcher-name';
            text.textContent = labelOf(t);
            item.append(mark, text);
            item.addEventListener('click', () => {
                this.close();
                this.choose(t.id);
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
