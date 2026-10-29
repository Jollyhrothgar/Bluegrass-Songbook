// Work-view edit session
//
// The glue between the site's work-view and the OTF editor: mounts the
// editor over a rendered tab, applies edits back to the view (Done /
// Ctrl+S), downloads the OTF, and never discards work without asking.
//
// ONE COMMAND SURFACE (G17). The session bar in the bottom band holds only
// the two buttons a visitor must not miss: Submit and ✓ Done (edit sessions).
// Everything else the session offers (Open…, Import .tef…, Save as…,
// Cancel) lives in the editor's File menu only, built from `fileActions`
// below, so no command is drawn twice. Cancel keeps its inline "Discard
// edits?" question, shown in the bar whichever surface raised it.
//
// Ctrl/Cmd+S opens Save as… (G15f), the same panel as the File item. It used
// to apply the edits to the view; ✓ Done (applyAndExit) is the one way to do
// that now, and session.apply() remains for callers that want it.
//
// UI-free of editor internals: the editor is injected via editorFactory
// so work-view can lazy-import OTFEditor and tests can stub it. The
// only editor surface used: save(), openSaveAs(), setSource(), load(),
// destroy() and state.facade.canUndo() (dirty check).

import { pitchedTracks } from '../renderers/otf-tracks.js';
import { chooseTabFile } from '../pwa.js';
import { createCreditRow } from './tab-credit.js';

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
 * @param {string} [options.protectedTrackId] - a correction's own track: the
 *   editor will not delete it (null for a new take or an opened file)
 * @param {string} [options.filename] - Save as's file name when there is no source (no extension)
 * @param {{name: string, bytes?: ArrayBuffer}} [options.source] - the file this document was
 *   opened from: Save as starts from its format and name, and writes a .tef over its bytes
 * @param {Function} options.editorFactory - ({container, otf, trackId, source, filename, ...}) => editor
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
 * @param {boolean} [options.lockExistingCredit] - a correction of a published
 *   take: an existing "Tab by" credit is read-only unless the user is trusted.
 * @param {Function} [options.isTrusted] - () => Promise<boolean>
 * @param {Array} [options.extraActions] - [{label, onClick}] File-menu entries
 *   after Open… (e.g. "📂 Import .tef…"). They are not bar buttons.
 */
export function createTabEditSession({
    mount,
    otf,
    trackId = null,
    protectedTrackId = null,
    filename = null,
    source = null,
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
    onOpenFile = null,
    lockExistingCredit = false,
    isTrusted = null,
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

    // "Tab by" credit: right under the page's title/artist, above the editor.
    let credit = null;
    const creditSlot = document.createElement('div');
    creditSlot.className = 'tab-credit-slot';
    root.appendChild(creditSlot);

    const host = document.createElement('div');
    host.className = 'tab-edit-host';
    root.appendChild(host);
    mount.appendChild(root);

    const editor = editorFactory({
        container: host,
        otf,
        trackId,
        protectedTrackId,
        source,
        filename,
        ...(onChange ? { onChange: (doc) => onChange(doc) } : {}),
        // In compact mode the bottom band owns playback, so the editor's
        // status bar drops its own transport (plan §8.3: one transport).
        hostTransport: compact,
        // The File menu holds every session command except Submit and Done's
        // buttons (which the bar also carries); same handlers. `editor` and
        // `session` are consts assigned below; every `run` is a closure
        // invoked long after both exist.
        fileActions: [
            // Open… first, as every File menu has it. The caller decides what
            // opening means (work-view flushes the autosave first); with no
            // caller it is the plain picker, which opens the file as a draft.
            {
                label: '📂 Open…',
                run: () => (onOpenFile ? onOpenFile(session) : chooseTabFile({ source: 'menu' })),
            },
            // Import .tef…, only where the session offers it
            ...extraActions.map(a => ({
                label: a.label,
                run: () => a.onClick?.(session),
            })),
            // Ctrl+S opens the same panel, so the File item prints its key.
            {
                label: '💾 Save as…',
                action: 'edit.save',
                run: () => editor.openSaveAs?.(),
            },
            { separator: true },
            ...(onSubmit ? [{
                label: submitLabel,
                run: () => bar.querySelector('.tab-edit-submit')?.click(),
            }] : []),
            { label: 'Cancel', run: () => session.cancel() },
            ...(showDone ? [{ label: '✓ Done', run: () => session.applyAndExit() }] : []),
        ],
    });

    credit = createCreditRow({
        getFacade: () => editor.state?.facade,
        lockExisting: lockExistingCredit,
        isTrusted,
    });
    creditSlot.appendChild(credit.el);
    // Undo / redo / a loaded file change the credit without touching the inputs.
    editor.state?.on?.('change', () => credit?.refresh());

    let closed = false;
    const cleanup = () => {
        if (closed) return false;
        closed = true;
        credit?.destroy();
        closeInline();
        editor.destroy?.();
        // The bar (and its panel) live in the bottom band in compact mode,
        // so they are NOT descendants of root and have to go themselves.
        bar.remove();
        submitPanel?.remove();
        root.remove();
        return true;
    };

    // ── "Discard edits?" — inline, in the bar (never window.confirm) ───
    let discardAsk = null;

    /** Take the question down without answering it. */
    function closeInline() {
        discardAsk?.remove();
        discardAsk = null;
    }

    /**
     * Ask in the bar, beside the button that raised the question.
     * Idempotent: a second Cancel click re-focuses the standing question
     * rather than stacking a second one.
     */
    function askInline() {
        if (discardAsk) {
            discardAsk.querySelector('.tab-edit-discard-yes')?.focus();
            return discardAsk;
        }
        discardAsk = document.createElement('span');
        discardAsk.className = 'tab-edit-discard-confirm';
        discardAsk.setAttribute('role', 'alertdialog');
        discardAsk.setAttribute('aria-label', 'Discard edits?');
        // A whole row of the bar: it is raised from the File menu now, far
        // from the bar, so it must be unmissable, and on a phone it needs
        // the full width to keep both answers on screen.
        discardAsk.style.cssText =
            'display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1 1 100%;';
        discardAsk.innerHTML = `
            <span class="tab-edit-discard-question">Discard edits?</span>
            <button type="button" class="tab-edit-discard-yes qc-toggle-btn">Discard</button>
            <button type="button" class="tab-edit-discard-no qc-toggle-btn">Keep editing</button>
        `;
        discardAsk.querySelector('.tab-edit-discard-yes')
            .addEventListener('click', () => {
                closeInline();
                session._exit();
            });
        discardAsk.querySelector('.tab-edit-discard-no')
            .addEventListener('click', () => {
                closeInline();
                editor.focus?.();
            });
        // Escape is "keep editing" — the same answer the panel's own
        // button gives, from the key everyone reaches for first.
        discardAsk.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                e.preventDefault();
                closeInline();
                editor.focus?.();
            }
        });
        actionsEl.appendChild(discardAsk);
        discardAsk.querySelector('.tab-edit-discard-yes').focus();
        return discardAsk;
    }

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

        /**
         * Exit without applying; asks first when there are edits.
         *
         * The ask is an INLINE confirm in the bar, not `window.confirm`.
         * A native dialog is drawn by the browser, so it is outside the
         * DOM (no test can drive it), outside the theme, and on a phone
         * it covers the very edits it is asking about. The inline strip
         * sits where the buttons are, which is where the click that
         * raised the question came from.
         *
         * Because the answer arrives later, `cancel()` returns FALSE when
         * it merely asked — "not exited (yet)". The injected
         * `confirmDiscard` still answers synchronously, which is what
         * keeps the unit tests (and any host that wants its own dialog)
         * working unchanged.
         *
         * @returns {boolean} true when the session actually exited
         */
        cancel() {
            const dirty = editor.state?.facade?.canUndo?.() || false;
            if (dirty) {
                if (confirmDiscard) {
                    if (!confirmDiscard()) return false;
                } else {
                    askInline();
                    return false;
                }
            }
            return session._exit();
        },

        /** The unconditional half of cancel — no question asked. */
        _exit() {
            if (!cleanup()) return false;
            onExit('cancel');
            return true;
        },

        /** Silent unmount (no onExit) — for teardown on navigation. */
        destroy() {
            cleanup();
        },

        /** Swap the document being edited (a .tef import into this mode). */
        replaceDocument(doc, newSource = null) {
            editor.setSource?.(newSource);
            editor.load?.(doc);
            credit?.refresh();
        },

        /** One line of feedback in the action group (never markup). */
        setStatus(text) {
            const el = bar.querySelector('.tab-edit-status');
            if (el) el.textContent = text || '';
        },
    };

    bar.querySelector('.tab-edit-done')
        ?.addEventListener('click', () => session.applyAndExit());
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
