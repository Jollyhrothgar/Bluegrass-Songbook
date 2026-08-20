// PWA wiring: service-worker registration, the "new version" nudge, the
// install affordance, and file handling (.tef / .otf.json) — §9.3 of
// docs/plans/tab-editor-input-parity.md.
//
// The standalone app is THIS app, installed. Nothing here is a second
// product: files land on the same `#new-tab` route the site already uses, and
// submissions still go through submit-tab.js.
//
// main.js calls initPWA() once. Everything else in this module is either a
// pure helper (tested) or a browser-capability probe that no-ops when the
// capability is missing — which is what keeps it safe in jsdom and in the
// Playwright runs, where none of these APIs exist.

import { showToast } from './toast.js';
import { getDraftStore } from './drafts.js';

const TEF_RE = /\.tef$/i;
const OTF_JSON_RE = /\.otf\.json$/i;

/** Which dropped/opened files this app can do something with. Pure. */
export function isSupportedTabFile(name) {
    return TEF_RE.test(String(name || '')) || OTF_JSON_RE.test(String(name || ''));
}

/** Cheap structural check — the editor needs at least one track to mount. */
export function looksLikeOtf(doc) {
    return !!doc && Array.isArray(doc.tracks) && doc.tracks.length > 0;
}

/**
 * Turn an opened/dropped File into an OTF document.
 *
 * `.tef` goes through the in-browser TablEdit parser (js/tef-import), which
 * is the same code the create page's drop zone uses and is verified
 * byte-exact against the Python pipeline. `.otf.json` is already OTF.
 *
 * @param {File} file
 * @param {{parseTef?: Function}} [deps] - injected for tests
 * @returns {Promise<Object>} OTF document
 */
export async function importFileToOtf(file, { parseTef = null } = {}) {
    const name = file?.name || '';
    if (OTF_JSON_RE.test(name)) {
        const doc = JSON.parse(await file.text());
        if (!looksLikeOtf(doc)) throw new Error('That .otf.json has no tracks.');
        return doc;
    }
    if (!TEF_RE.test(name)) throw new Error(`"${name}" is not a .tef or .otf.json file.`);
    const parse = parseTef || (await import('./tef-import/index.js')).parseTef;
    const doc = parse(new Uint8Array(await file.arrayBuffer()), name);
    if (!looksLikeOtf(doc)) throw new Error("Couldn't read any tracks from that tab file.");
    return doc;
}

/**
 * Open a file in the tab editor: parse it, park it as a draft (so a reload,
 * a sign-in round trip or a crash doesn't lose it), then route to `#new-tab`.
 *
 * The draft IS the handoff mechanism — a hash route can't carry a document,
 * and this way the file survives whatever the browser does to the page next.
 */
export async function openTabFile(file, {
    store = getDraftStore(),
    parseTef = null,
    navigate = (hash) => { globalThis.location.hash = hash; },
    notify = showToast,
} = {}) {
    try {
        const otf = await importFileToOtf(file, { parseTef });
        const draft = await store.save({ otf, title: otf?.metadata?.title || file.name });
        navigate(`#new-tab?draft=${encodeURIComponent(draft.id)}&file=1`);
        return draft;
    } catch (err) {
        // Format specifics are not the user's problem — this is the same
        // wording the create page's drop zone uses.
        notify?.(`Could not open ${file?.name || 'that file'}: ${err.message}`,
            { variant: 'warning', duration: 6000 });
        return null;
    }
}

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------

/** Service workers need a secure context; localhost counts as one. */
export function canRegisterServiceWorker(loc = globalThis.location) {
    if (!loc) return false;
    if (loc.protocol === 'https:') return true;
    return loc.protocol === 'http:'
        && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname);
}

/**
 * Register sw.js and offer a reload when a new version takes over.
 *
 * Registered as a MODULE worker so sw.js can import the strategy table
 * instead of duplicating it. A browser too old for module workers simply
 * fails here and gets the plain online site.
 */
export function registerServiceWorker({
    navigator: nav = globalThis.navigator,
    location: loc = globalThis.location,
    notify = showToast,
    reload = () => globalThis.location.reload(),
} = {}) {
    if (!nav?.serviceWorker || !canRegisterServiceWorker(loc)) return null;

    // "Was this tab already running app code from an older worker?" is the
    // only honest test for "you should reload"; a first install has no old
    // code to replace and must stay silent.
    const hadController = !!nav.serviceWorker.controller;
    let nagged = false;
    const nagOnce = () => {
        if (nagged || !hadController) return;
        nagged = true;
        const toast = notify?.('Updated — reload for the new version.',
            { duration: 10000 });
        toast?.addEventListener?.('click', reload);
    };

    nav.serviceWorker.addEventListener('controllerchange', nagOnce);
    nav.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'sw-activated') nagOnce();
    });

    return nav.serviceWorker.register('sw.js', { type: 'module' })
        .catch((err) => {
            console.warn('Service worker registration failed (offline support off)', err);
            return null;
        });
}

// ---------------------------------------------------------------------------
// Install affordance
// ---------------------------------------------------------------------------

/** True when the page is already running as an installed app. */
export function isStandalone(win = globalThis) {
    if (win?.navigator?.standalone) return true;          // iOS
    return !!win?.matchMedia?.('(display-mode: standalone)')?.matches;
}

let deferredInstall = null;

/**
 * Capture Chromium's `beforeinstallprompt` so the app can offer Install from
 * its own menu instead of relying on the browser's address-bar icon (which is
 * invisible on most desktops and absent on Android's menu).
 *
 * @param {Function} onAvailable - called when Install becomes offerable
 */
export function watchInstallPrompt(onAvailable, win = globalThis) {
    if (!win?.addEventListener) return;
    win.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();          // keep the mini-infobar out of the way
        deferredInstall = e;
        if (!isStandalone(win)) onAvailable?.();
    });
    win.addEventListener('appinstalled', () => {
        deferredInstall = null;
        onAvailable?.(false);
    });
}

/** Is there a captured prompt to show? */
export function canInstall(win = globalThis) {
    return !!deferredInstall && !isStandalone(win);
}

/** Show the captured install prompt. Single-use — the event cannot be reused. */
export async function promptInstall() {
    const prompt = deferredInstall;
    if (!prompt) return null;
    deferredInstall = null;
    try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        return choice?.outcome || null;
    } catch (err) {
        return null;
    }
}

/** Test seam. */
export function _setDeferredInstall(value) { deferredInstall = value; }

// ---------------------------------------------------------------------------
// File handling: launchQueue (installed app) + drag-and-drop (anywhere)
// ---------------------------------------------------------------------------

/**
 * Consume files the OS opened the app with (manifest `file_handlers`).
 * Chromium only; everything else skips it.
 */
export function consumeLaunchQueue({ win = globalThis, open = openTabFile } = {}) {
    const queue = win?.launchQueue;
    if (!queue?.setConsumer) return false;
    queue.setConsumer(async (params) => {
        const handles = params?.files || [];
        for (const handle of handles) {
            try {
                const file = await handle.getFile();
                await open(file);
                break;   // one document per launch; the rest would fight over the route
            } catch (err) {
                console.warn('Could not open launched file', err);
            }
        }
    });
    return true;
}

/**
 * Accept a `.tef` / `.otf.json` dropped anywhere on the app.
 *
 * Scoped out of any element that marks itself `data-file-drop` (a surface
 * with its own drop handling and its own error copy), and it ignores drags
 * that carry no supported file so text drags, link drags and the browser's
 * own behaviour are untouched.
 */
export function enableFileDrop({
    root = globalThis.document,
    open = openTabFile,
} = {}) {
    if (!root?.addEventListener) return () => {};

    // A dragover event cannot see filenames (the spec hides them until drop)
    // and `.tef` has no registered MIME type, so the most we can ask here is
    // "is a file coming?". The extension check happens on drop, where the
    // name is available — a wrong-type drop is then simply ignored.
    const hasTabFile = (dt) => {
        const items = dt?.items ? [...dt.items] : [];
        if (items.length) return items.some(item => item.kind === 'file');
        return !!dt?.files?.length;
    };

    const onDragOver = (e) => {
        if (e.target?.closest?.('[data-file-drop]')) return;
        if (!hasTabFile(e.dataTransfer)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        root.body?.classList.add('file-dragover');
    };
    const onDragLeave = (e) => {
        if (e.relatedTarget) return;   // still inside the window
        root.body?.classList.remove('file-dragover');
    };
    const onDrop = (e) => {
        if (e.target?.closest?.('[data-file-drop]')) return;
        const file = [...(e.dataTransfer?.files || [])]
            .find(f => isSupportedTabFile(f.name));
        root.body?.classList.remove('file-dragover');
        if (!file) return;             // not ours — leave the event alone
        e.preventDefault();
        open(file);
    };

    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
    return () => {
        root.removeEventListener('dragover', onDragOver);
        root.removeEventListener('dragleave', onDragLeave);
        root.removeEventListener('drop', onDrop);
    };
}

// ---------------------------------------------------------------------------

/**
 * One call from main.js.
 * @param {{onInstallAvailable?: Function}} [options]
 */
export function initPWA({ onInstallAvailable = null } = {}) {
    registerServiceWorker();
    watchInstallPrompt((available) => onInstallAvailable?.(available !== false));
    consumeLaunchQueue();
    enableFileDrop();
}
