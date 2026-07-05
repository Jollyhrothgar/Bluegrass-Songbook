// Work-view edit session
//
// The glue between the site's work-view and the OTF editor: mounts the
// editor over a rendered tab, applies edits back to the view (Done /
// Ctrl+S), downloads the OTF, and never discards work without asking.
//
// UI-free of editor internals: the editor is injected via editorFactory
// so work-view can lazy-import OTFEditor and tests can stub it. The
// only editor surface used: save(), download(filename?), destroy(),
// state.facade.canUndo() (dirty check), and the onSave option.

/**
 * Pick the track to edit for a part. Mirrors work-view's lead-track
 * resolution: match the part instrument, then the lead role, then the
 * first track. Instrument specifics are data, not architecture.
 */
export function resolveEditTrackId(otf, instrument) {
    const tracks = otf?.tracks || [];
    if (instrument) {
        const match = tracks.find(t =>
            t.instrument?.includes(instrument) || t.id?.includes(instrument));
        if (match) return match.id;
    }
    const lead = tracks.find(t => t.role === 'lead');
    return (lead || tracks[0])?.id;
}

/**
 * Mount an edit session into a container.
 *
 * @param {Object} options
 * @param {HTMLElement} options.mount - where the session UI is appended
 * @param {Object} options.otf - document to edit
 * @param {string} [options.trackId] - track to edit (see resolveEditTrackId)
 * @param {string} [options.filename] - download filename (no extension)
 * @param {Function} options.editorFactory - ({container, otf, trackId, onSave}) => editor
 * @param {Function} [options.onApply] - receives the edited document
 * @param {Function} [options.onExit] - receives 'apply' | 'cancel' after unmount
 * @param {Function} [options.confirmDiscard] - () => boolean; defaults to window.confirm
 */
export function createTabEditSession({
    mount,
    otf,
    trackId = null,
    filename = null,
    editorFactory,
    onApply = () => {},
    onExit = () => {},
    confirmDiscard = null,
}) {
    const root = document.createElement('div');
    root.className = 'tab-edit-session';

    const bar = document.createElement('div');
    bar.className = 'tab-edit-bar';
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;flex-wrap:wrap;';
    bar.innerHTML = `
        <span class="tab-edit-title">✏️ Editing${trackId ? ` — ${trackId}` : ''}</span>
        <span class="tab-edit-actions" style="display:flex;gap:8px;">
            <button type="button" class="tab-edit-download qc-btn" title="Download the edited OTF">⬇ Download</button>
            <button type="button" class="tab-edit-cancel qc-btn" title="Discard changes and go back">Cancel</button>
            <button type="button" class="tab-edit-done qc-toggle-btn" title="Apply changes to the view">✓ Done</button>
        </span>
    `;
    root.appendChild(bar);

    const host = document.createElement('div');
    host.className = 'tab-edit-host';
    root.appendChild(host);
    mount.appendChild(root);

    const editor = editorFactory({
        container: host,
        otf,
        trackId,
        onSave: (doc) => onApply(doc),
    });

    let closed = false;
    const cleanup = () => {
        if (closed) return false;
        closed = true;
        editor.destroy?.();
        root.remove();
        return true;
    };

    const session = {
        root,
        editor,

        /** Apply current edits to the view and stay in the editor. */
        apply() {
            onApply(editor.save());
        },

        /** Save, unmount, apply, notify. */
        applyAndExit() {
            const doc = editor.save(); // before destroy — destroy nulls state
            if (!cleanup()) return;
            onApply(doc);
            onExit('apply');
        },

        /** Exit without applying; asks first when there are edits. */
        cancel() {
            const dirty = editor.state?.facade?.canUndo?.() || false;
            if (dirty) {
                const ask = confirmDiscard
                    || ((typeof window !== 'undefined' && window.confirm)
                        ? () => window.confirm('Discard your edits?')
                        : () => true);
                if (!ask()) return false;
            }
            if (!cleanup()) return false;
            onExit('cancel');
            return true;
        },

        /** Silent unmount (no onExit) — for teardown on navigation. */
        destroy() {
            cleanup();
        },
    };

    bar.querySelector('.tab-edit-done').addEventListener('click', () => session.applyAndExit());
    bar.querySelector('.tab-edit-cancel').addEventListener('click', () => session.cancel());
    bar.querySelector('.tab-edit-download').addEventListener('click', () => editor.download?.(filename));

    return session;
}
