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
    onSubmit = null,
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
            ${onSubmit ? '<button type="button" class="tab-edit-submit qc-btn" title="Submit this correction for review">🚀 Submit correction</button>' : ''}
            <button type="button" class="tab-edit-download qc-btn" title="Download the edited OTF">⬇ Download</button>
            <button type="button" class="tab-edit-cancel qc-btn" title="Discard changes and go back">Cancel</button>
            <button type="button" class="tab-edit-done qc-toggle-btn" title="Apply changes to the view">✓ Done</button>
        </span>
    `;
    root.appendChild(bar);

    // Inline submit panel (comment required — same as song corrections)
    let submitPanel = null;
    if (onSubmit) {
        submitPanel = document.createElement('div');
        submitPanel.className = 'tab-edit-submit-panel';
        submitPanel.style.cssText = 'display:none;gap:8px;margin:0 0 8px;align-items:center;flex-wrap:wrap;';
        submitPanel.innerHTML = `
            <input type="text" class="tab-edit-submit-comment"
                   placeholder="Describe your changes (required)"
                   style="flex:1;min-width:220px;padding:6px 8px;">
            <button type="button" class="tab-edit-submit-send qc-toggle-btn">Send</button>
            <button type="button" class="tab-edit-submit-cancel qc-btn">Back</button>
            <span class="tab-edit-submit-status"></span>
        `;
        root.appendChild(submitPanel);
    }

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

    if (onSubmit && submitPanel) {
        const status = submitPanel.querySelector('.tab-edit-submit-status');
        const comment = submitPanel.querySelector('.tab-edit-submit-comment');
        bar.querySelector('.tab-edit-submit').addEventListener('click', () => {
            submitPanel.style.display = 'flex';
            comment.focus();
        });
        submitPanel.querySelector('.tab-edit-submit-cancel').addEventListener('click', () => {
            submitPanel.style.display = 'none';
            status.textContent = '';
        });
        submitPanel.querySelector('.tab-edit-submit-send').addEventListener('click', async () => {
            const text = comment.value.trim();
            if (!text) {
                status.textContent = 'Please describe your changes.';
                return;
            }
            status.textContent = 'Submitting…';
            try {
                const result = await onSubmit(editor.save(), text);
                status.innerHTML = result?.issueUrl
                    ? `Submitted! <a href="${result.issueUrl}" target="_blank" rel="noopener">Issue #${result.issueNumber}</a> — it goes live once approved.`
                    : 'Submitted for review!';
            } catch (e) {
                status.textContent = `Failed: ${e.message}`;
            }
        });
    }

    return session;
}
