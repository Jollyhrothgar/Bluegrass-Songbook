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

import { pitchedTracks } from '../renderers/otf-tracks.js';

/**
 * Pick the track to edit for a part. Mirrors work-view's lead-track
 * resolution: match the part instrument, then the lead role, then the
 * first track. Instrument specifics are data, not architecture.
 */
export function resolveEditTrackId(otf, instrument) {
    // Percussion is never editable here: the editor is a pitched-stave tool
    // (strings and frets), which a drum track has neither of.
    const tracks = pitchedTracks(otf?.tracks || []);
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
 * @param {Function} [options.onChange] - receives the document on every edit
 *   (drafts); passed straight through to the editor.
 * @param {HTMLElement} [options.barHost] - put the action bar HERE instead of
 *   above the canvas. §9.1: the song page's bottom band survives edit mode,
 *   so the session's buttons live in it rather than in a header of their own.
 * @param {string} [options.submitLabel] - Submit button text
 * @param {boolean} [options.showDone] - offer ✓ Done (apply back to the view).
 *   A tab that does not exist yet has nothing to apply back to.
 * @param {boolean} [options.commentRequired] - a correction says what changed;
 *   a brand-new take has nothing to describe, so it submits on the click.
 * @param {Function} [options.onSubmitted] - receives (result, doc) after a
 *   successful submit (the caller decides what the page becomes next).
 * @param {Array} [options.extraActions] - [{className, label, title, onClick}]
 *   buttons prepended to the group (e.g. "Import .tef…").
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
    onChange = null,
    barHost = null,
    submitLabel = '🚀 Submit correction',
    showDone = true,
    commentRequired = true,
    onSubmitted = null,
    extraActions = [],
}) {
    const root = document.createElement('div');
    root.className = 'tab-edit-session';

    const compact = !!barHost;
    const bar = document.createElement('div');
    bar.className = 'tab-edit-bar' + (compact ? ' is-compact' : '');
    bar.style.cssText = compact
        ? 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;'
        : 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;flex-wrap:wrap;';
    // LABELLED buttons take `qc-toggle-btn`, never `qc-btn`. `.qc-btn` is the
    // site's 32x32 ICON shell (the −/+ steppers): a hard `width: 32px` plus
    // `display:flex; justify-content:center`. Give it a word and the text
    // can't shrink past its min-content, so it wraps to ~55px of centred
    // lines that spill out of a 32px box on a 40px pitch — four labels drawn
    // on top of each other and over the toolbar below. `qc-toggle-btn` is
    // the labelled variant (padded, auto width) and is what ✓ Done and the
    // panel's Send already use.
    bar.innerHTML = `
        ${compact ? '' : '<span class="tab-edit-title"></span>'}
        <span class="tab-edit-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${onSubmit ? '<button type="button" class="tab-edit-submit qc-toggle-btn"></button>' : ''}
            <button type="button" class="tab-edit-download qc-toggle-btn" title="Download the edited OTF">⬇ Download</button>
            <button type="button" class="tab-edit-cancel qc-toggle-btn" title="Discard changes and go back">Cancel</button>
            ${showDone ? '<button type="button" class="tab-edit-done qc-toggle-btn" title="Apply changes to the view">✓ Done</button>' : ''}
            <span class="tab-edit-status"></span>
        </span>
    `;
    const submitBtn = bar.querySelector('.tab-edit-submit');
    if (submitBtn) {
        // textContent: the label is a caller-supplied string
        submitBtn.textContent = submitLabel;
        submitBtn.title = submitLabel.replace(/^\W+\s*/, '');
    }
    const actionsEl = bar.querySelector('.tab-edit-actions');
    for (const action of extraActions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${action.className || 'tab-edit-extra'} qc-toggle-btn`;
        btn.textContent = action.label || '';
        if (action.title) btn.title = action.title;
        btn.addEventListener('click', () => action.onClick?.(session));
        actionsEl.insertBefore(btn, actionsEl.firstChild);
    }
    // textContent, not interpolation: track ids come from OTF data,
    // which community submissions make untrusted input
    if (!compact) {
        bar.querySelector('.tab-edit-title').textContent =
            `✏️ Editing${trackId ? ` — ${trackId}` : ''}`;
    }
    (barHost || root).appendChild(bar);

    // Inline submit panel (comment required — same as song corrections)
    let submitPanel = null;
    if (onSubmit && commentRequired) {
        submitPanel = document.createElement('div');
        submitPanel.className = 'tab-edit-submit-panel';
        submitPanel.style.cssText = 'display:none;gap:8px;margin:0 0 8px;align-items:center;flex-wrap:wrap;';
        submitPanel.innerHTML = `
            <input type="text" class="tab-edit-submit-comment"
                   placeholder="Describe your changes (required)"
                   style="flex:1;min-width:220px;padding:6px 8px;">
            <button type="button" class="tab-edit-submit-send qc-toggle-btn">Send</button>
            <button type="button" class="tab-edit-submit-cancel qc-toggle-btn">Back</button>
            <span class="tab-edit-submit-status"></span>
        `;
        (barHost || root).appendChild(submitPanel);
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
        ...(onChange ? { onChange: (doc) => onChange(doc) } : {}),
    });

    let closed = false;
    const cleanup = () => {
        if (closed) return false;
        closed = true;
        editor.destroy?.();
        // The bar (and its panel) live in the bottom band in compact mode,
        // so they are NOT descendants of root and have to go themselves.
        bar.remove();
        submitPanel?.remove();
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

        /** Swap the document being edited (a .tef import into this mode). */
        replaceDocument(doc) {
            editor.load?.(doc);
        },

        /** One line of feedback in the action group (never markup). */
        setStatus(text) {
            const el = bar.querySelector('.tab-edit-status');
            if (el) el.textContent = text || '';
        },
    };

    bar.querySelector('.tab-edit-done')
        ?.addEventListener('click', () => session.applyAndExit());
    bar.querySelector('.tab-edit-cancel').addEventListener('click', () => session.cancel());
    bar.querySelector('.tab-edit-download').addEventListener('click', () => editor.download?.(filename));

    // A brand-new take has nothing to describe, so Submit IS the submission —
    // no comment panel in the way. (The correction path below is unchanged.)
    if (onSubmit && !commentRequired) {
        submitBtn.addEventListener('click', async () => {
            submitBtn.disabled = true;
            session.setStatus('Submitting…');
            const doc = editor.save();
            try {
                const result = await onSubmit(doc, '');
                session.setStatus(result && result.synced === false
                    ? 'Saved and live — syncing to the songbook shortly.'
                    : 'Submitted — your tab is live on this song now.');
                onSubmitted?.(result, doc);
            } catch (e) {
                session.setStatus(`Failed: ${e.message}`);
                submitBtn.disabled = false;
            }
        });
    }

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
            const doc = editor.save();
            try {
                const result = await onSubmit(doc, text);
                // There is no review gate any more: a correction is LIVE the
                // moment its row lands (submit-tab.js resolves at exactly
                // that point). The only thing left to report is whether the
                // durable commit was accepted too — and a `synced: false` is
                // not a failure, it is a retry the reconciler already owns.
                status.textContent = result && result.synced === false
                    ? 'Saved and live — syncing to the songbook shortly.'
                    : 'Submitted — your correction is live on this tab now.';
                onSubmitted?.(result, doc);
            } catch (e) {
                status.textContent = `Failed: ${e.message}`;
            }
        });
    }

    return session;
}
