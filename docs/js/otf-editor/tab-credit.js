// "Tab by" credit row for the tab editor: who wrote this tab, plus an
// optional link (say, their Banjo Hangout profile).
//
// The values live in the document as `metadata.tab_by` ({name, url?}), so
// Download / Submit carry them and reopening a file restores them. Edits go
// through EditingFacade.setTabBy: one undo step per committed change (on
// blur / Enter, not per keystroke).
//
// Who may change an EXISTING credit is decided by the server
// (process_pending.resolve_credit); this row only mirrors that rule so the
// reader is not offered an edit that will be thrown away: when a take already
// has a credit and the signed-in user is not trusted, the fields are
// read-only. No window.prompt/confirm/alert: errors are inline.

export const TAB_BY_NAME_MAX = 100;
export const TAB_BY_URL_MAX = 500;

/** The part's published credit as a valid tab_by, or null. */
export function creditFromPart(part) {
    const name = String(part?.author || '').trim().slice(0, TAB_BY_NAME_MAX).trim();
    if (!name) return null;
    const url = String(part?.author_url || '').trim();
    return /^https?:\/\//.test(url) && url.length <= TAB_BY_URL_MAX ? { name, url } : { name };
}

/**
 * Validate what was typed. Returns `{credit}` (null = no credit) or `{error}`.
 * A bare scheme in capitals ("HTTPS://") is lower-cased rather than refused.
 */
export function parseCreditInput(nameText, urlText) {
    const name = String(nameText || '').trim();
    let url = String(urlText || '').trim();
    if (url) url = url.replace(/^(https?):\/\//i, (m, s) => `${s.toLowerCase()}://`);
    if (name.length > TAB_BY_NAME_MAX) return { error: `Keep the name under ${TAB_BY_NAME_MAX} letters.` };
    if (url && !/^https?:\/\//.test(url)) {
        return { error: 'The link has to start with http:// or https://' };
    }
    if (url.length > TAB_BY_URL_MAX) return { error: 'That link is too long.' };
    if (!name && url) return { error: 'Add a name for this link, or clear the link.' };
    if (!name) return { credit: null };
    return { credit: url ? { name, url } : { name } };
}

/**
 * @param {Object} o
 * @param {Function} o.getFacade - () => EditingFacade (it can be replaced by a load)
 * @param {boolean} o.lockExisting - an existing credit is read-only unless trusted
 * @param {Function} [o.isTrusted] - () => Promise<boolean>
 * @returns {{el: HTMLElement, refresh: Function, destroy: Function}}
 */
export function createCreditRow({ getFacade, lockExisting = false, isTrusted = null }) {
    const el = document.createElement('div');
    el.className = 'tab-credit';
    el.innerHTML = `
        <label class="tab-credit-field">
            <span class="tab-credit-label">Tab by</span>
            <input class="tab-credit-name" type="text" maxlength="${TAB_BY_NAME_MAX}"
                   autocomplete="off"
                   placeholder="Who wrote this tab? (optional)">
        </label>
        <label class="tab-credit-field">
            <span class="tab-credit-label">Link</span>
            <input class="tab-credit-url" type="url" inputmode="url" maxlength="${TAB_BY_URL_MAX}"
                   autocomplete="off" autocapitalize="off" spellcheck="false"
                   placeholder="Their web page, e.g. a Banjo Hangout profile (optional)">
        </label>
        <div class="tab-credit-error" role="alert" hidden></div>
        <div class="tab-credit-note" hidden>Only trusted users can change an existing credit.</div>`;
    const nameEl = el.querySelector('.tab-credit-name');
    const urlEl = el.querySelector('.tab-credit-url');
    const errEl = el.querySelector('.tab-credit-error');
    const noteEl = el.querySelector('.tab-credit-note');

    let locked = false;
    let destroyed = false;

    const setError = (msg) => { errEl.textContent = msg || ''; errEl.hidden = !msg; };
    const setLocked = (on) => {
        locked = on;
        nameEl.readOnly = on;
        urlEl.readOnly = on;
        el.classList.toggle('is-locked', on);
        noteEl.hidden = !on;
    };

    /** Show what the document holds. */
    function refresh() {
        // Never overwrite what is being typed.
        if (document.activeElement === nameEl || document.activeElement === urlEl) return;
        const credit = getFacade()?.getTabBy?.() || null;
        nameEl.value = credit?.name || '';
        urlEl.value = credit?.url || '';
        setError('');
    }

    function commit() {
        if (locked) return;
        const facade = getFacade();
        if (!facade) return;
        const parsed = parseCreditInput(nameEl.value, urlEl.value);
        if (parsed.error) { setError(parsed.error); return; }
        setError('');
        facade.setTabBy(parsed.credit);
        refresh();
    }

    for (const input of [nameEl, urlEl]) {
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
            // Enter commits; editor shortcuts must not see typing here.
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
        });
    }

    refresh();
    if (lockExisting && getFacade()?.getTabBy?.()) {
        // Read-only until we know the reader is trusted: failing closed.
        setLocked(true);
        Promise.resolve(isTrusted ? isTrusted() : false).then((trusted) => {
            if (!destroyed && trusted === true) setLocked(false);
        }).catch(() => {});
    }

    return {
        el,
        refresh,
        destroy() { destroyed = true; el.remove(); },
    };
}
