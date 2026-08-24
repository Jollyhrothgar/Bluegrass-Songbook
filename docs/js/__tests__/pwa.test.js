// PWA wiring: what gets registered where, the install affordance, and the
// file-opening path (.tef / .otf.json) shared by the OS file handler and
// drag-and-drop.
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    _setDeferredInstall,
    canInstall,
    canRegisterServiceWorker,
    consumeLaunchQueue,
    enableFileDrop,
    importFileToOtf,
    isStandalone,
    isSupportedTabFile,
    looksLikeOtf,
    openTabFile,
    promptInstall,
    registerServiceWorker,
    watchInstallPrompt,
} from '../pwa.js';
import { createDraftStore, memoryBackend } from '../drafts.js';

const OTF = { metadata: { title: 'Sally Goodin' }, tracks: [{ id: 'banjo' }], notation: {} };

/** A File stand-in — jsdom's File has no .text()/.arrayBuffer() in every version. */
const fakeFile = (name, { text = '', bytes = new Uint8Array([1, 2, 3]) } = {}) => ({
    name,
    text: async () => text,
    arrayBuffer: async () => bytes.buffer,
});

beforeEach(() => {
    _setDeferredInstall(null);
});

describe('isSupportedTabFile', () => {
    it('accepts the two formats the editor can open', () => {
        expect(isSupportedTabFile('Sally Goodin.tef')).toBe(true);
        expect(isSupportedTabFile('SALLY.TEF')).toBe(true);
        expect(isSupportedTabFile('banjo.otf.json')).toBe(true);
    });

    it('rejects everything else, including a bare .json', () => {
        expect(isSupportedTabFile('index.json')).toBe(false);
        expect(isSupportedTabFile('song.pro')).toBe(false);
        expect(isSupportedTabFile('')).toBe(false);
        expect(isSupportedTabFile(null)).toBe(false);
    });
});

describe('looksLikeOtf', () => {
    it('needs at least one track', () => {
        expect(looksLikeOtf(OTF)).toBe(true);
        expect(looksLikeOtf({ tracks: [] })).toBe(false);
        expect(looksLikeOtf({})).toBe(false);
        expect(looksLikeOtf(null)).toBe(false);
    });
});

describe('importFileToOtf', () => {
    it('parses a .tef through the in-browser TEF pipeline', async () => {
        const parseTef = vi.fn(() => OTF);
        const doc = await importFileToOtf(fakeFile('Sally.tef'), { parseTef });
        expect(doc).toBe(OTF);
        expect(parseTef).toHaveBeenCalledWith(expect.any(Uint8Array), 'Sally.tef');
    });

    it('reads an .otf.json straight through', async () => {
        const doc = await importFileToOtf(fakeFile('banjo.otf.json', {
            text: JSON.stringify(OTF),
        }));
        expect(doc.metadata.title).toBe('Sally Goodin');
    });

    it('rejects a file it cannot use', async () => {
        await expect(importFileToOtf(fakeFile('song.pro'))).rejects.toThrow(/not a \.tef/);
    });

    it('rejects an .otf.json with no tracks', async () => {
        await expect(importFileToOtf(fakeFile('empty.otf.json', { text: '{"tracks":[]}' })))
            .rejects.toThrow(/no tracks/);
    });

    it('rejects a .tef the parser could make nothing of', async () => {
        await expect(importFileToOtf(fakeFile('x.tef'), { parseTef: () => ({ tracks: [] }) }))
            .rejects.toThrow(/tracks/);
    });
});

describe('openTabFile', () => {
    it('parks the document as a draft and routes to #new-tab', async () => {
        const store = createDraftStore({ backend: memoryBackend() });
        const navigate = vi.fn();
        const draft = await openTabFile(fakeFile('Sally.tef'), {
            store, navigate, parseTef: () => OTF,
        });

        expect(draft.title).toBe('Sally Goodin');
        expect(navigate).toHaveBeenCalledWith(`#new-tab?draft=${draft.id}&file=1`);
        expect((await store.list()).length).toBe(1);
    });

    it('reports a bad file without navigating anywhere', async () => {
        const store = createDraftStore({ backend: memoryBackend() });
        const navigate = vi.fn();
        const notify = vi.fn();
        const result = await openTabFile(fakeFile('notes.txt'), { store, navigate, notify });

        expect(result).toBe(null);
        expect(navigate).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('notes.txt'),
            expect.objectContaining({ variant: 'warning' }));
    });
});

describe('canRegisterServiceWorker', () => {
    it('allows https and localhost only', () => {
        expect(canRegisterServiceWorker({ protocol: 'https:', hostname: 'bluegrassbook.com' })).toBe(true);
        expect(canRegisterServiceWorker({ protocol: 'http:', hostname: 'localhost' })).toBe(true);
        expect(canRegisterServiceWorker({ protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
        expect(canRegisterServiceWorker({ protocol: 'http:', hostname: 'bluegrassbook.com' })).toBe(false);
        expect(canRegisterServiceWorker({ protocol: 'file:', hostname: '' })).toBe(false);
        expect(canRegisterServiceWorker(null)).toBe(false);
    });
});

describe('registerServiceWorker', () => {
    const fakeSW = (controller = null) => {
        const listeners = {};
        return {
            controller,
            register: vi.fn(() => Promise.resolve({})),
            addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
            fire: (type, event) => (listeners[type] || []).forEach(fn => fn(event)),
        };
    };
    const https = { protocol: 'https:', hostname: 'bluegrassbook.com' };

    it('does nothing on an insecure origin', () => {
        const sw = fakeSW();
        registerServiceWorker({
            navigator: { serviceWorker: sw },
            location: { protocol: 'http:', hostname: 'example.com' },
        });
        expect(sw.register).not.toHaveBeenCalled();
    });

    it('does nothing where service workers do not exist (jsdom, old Safari)', () => {
        expect(registerServiceWorker({ navigator: {}, location: https })).toBe(null);
    });

    it('registers sw.js as a module worker', async () => {
        const sw = fakeSW();
        await registerServiceWorker({ navigator: { serviceWorker: sw }, location: https });
        expect(sw.register).toHaveBeenCalledWith('sw.js', { type: 'module' });
    });

    it('offers a reload when a NEW worker replaces the one this page loaded on', async () => {
        const sw = fakeSW({ /* an existing controller */ });
        const notify = vi.fn(() => ({ addEventListener: vi.fn() }));
        await registerServiceWorker({
            navigator: { serviceWorker: sw }, location: https, notify,
        });
        sw.fire('controllerchange');
        expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Updated/), expect.any(Object));
    });

    it('stays silent on a first install (nothing was replaced)', async () => {
        const sw = fakeSW(null);
        const notify = vi.fn();
        await registerServiceWorker({
            navigator: { serviceWorker: sw }, location: https, notify,
        });
        sw.fire('controllerchange');
        sw.fire('message', { data: { type: 'sw-activated' } });
        expect(notify).not.toHaveBeenCalled();
    });

    it('nags only once', async () => {
        const sw = fakeSW({});
        const notify = vi.fn(() => ({ addEventListener: vi.fn() }));
        await registerServiceWorker({
            navigator: { serviceWorker: sw }, location: https, notify,
        });
        sw.fire('controllerchange');
        sw.fire('message', { data: { type: 'sw-activated' } });
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('survives a failed registration', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sw = fakeSW();
        sw.register = vi.fn(() => Promise.reject(new Error('no module workers here')));
        await expect(registerServiceWorker({
            navigator: { serviceWorker: sw }, location: https,
        })).resolves.toBe(null);
    });
});

describe('install affordance', () => {
    const fakeWin = (standalone = false) => {
        const listeners = {};
        return {
            navigator: {},
            matchMedia: () => ({ matches: standalone }),
            addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
            fire: (type, event) => (listeners[type] || []).forEach(fn => fn(event)),
        };
    };

    it('knows when it is already installed', () => {
        expect(isStandalone(fakeWin(true))).toBe(true);
        expect(isStandalone(fakeWin(false))).toBe(false);
        expect(isStandalone({ navigator: { standalone: true } })).toBe(true);
    });

    it('captures beforeinstallprompt and reports the offer', () => {
        const win = fakeWin();
        const onAvailable = vi.fn();
        watchInstallPrompt(onAvailable, win);

        const event = { preventDefault: vi.fn(), prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) };
        win.fire('beforeinstallprompt', event);

        expect(event.preventDefault).toHaveBeenCalled();   // no mini-infobar
        expect(onAvailable).toHaveBeenCalled();
        expect(canInstall(win)).toBe(true);
    });

    it('does not offer Install inside the installed app', () => {
        const win = fakeWin(true);
        const onAvailable = vi.fn();
        watchInstallPrompt(onAvailable, win);
        win.fire('beforeinstallprompt', { preventDefault: vi.fn() });
        expect(onAvailable).not.toHaveBeenCalled();
        expect(canInstall(win)).toBe(false);
    });

    it('prompts once and then has nothing left to offer', async () => {
        const win = fakeWin();
        watchInstallPrompt(() => {}, win);
        const event = {
            preventDefault: vi.fn(),
            prompt: vi.fn(() => Promise.resolve()),
            userChoice: Promise.resolve({ outcome: 'accepted' }),
        };
        win.fire('beforeinstallprompt', event);

        expect(await promptInstall()).toBe('accepted');
        expect(event.prompt).toHaveBeenCalled();
        expect(canInstall(win)).toBe(false);
        expect(await promptInstall()).toBe(null);
    });

    it('withdraws the offer once installed', () => {
        const win = fakeWin();
        const onAvailable = vi.fn();
        watchInstallPrompt(onAvailable, win);
        win.fire('beforeinstallprompt', { preventDefault: vi.fn() });
        win.fire('appinstalled', {});
        expect(canInstall(win)).toBe(false);
        expect(onAvailable).toHaveBeenLastCalledWith(false);
    });
});

describe('consumeLaunchQueue', () => {
    it('skips browsers without the File Handling API', () => {
        expect(consumeLaunchQueue({ win: {}, open: vi.fn() })).toBe(false);
    });

    it('opens the first launched file', async () => {
        const open = vi.fn();
        const file = fakeFile('Sally.tef');
        let consumer = null;
        const win = { launchQueue: { setConsumer: (fn) => { consumer = fn; } } };

        expect(consumeLaunchQueue({ win, open })).toBe(true);
        await consumer({ files: [{ getFile: async () => file }, { getFile: async () => fakeFile('b.tef') }] });
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith(file);
    });
});

describe('enableFileDrop', () => {
    const dropEvent = (files, target = document.body) => ({
        target,
        preventDefault: vi.fn(),
        dataTransfer: { files, items: files.map(() => ({ kind: 'file' })) },
    });

    it('opens a .tef dropped anywhere on the app', () => {
        const open = vi.fn();
        const listeners = {};
        const root = {
            body: document.body,
            addEventListener: (t, fn) => { listeners[t] = fn; },
            removeEventListener: () => {},
        };
        enableFileDrop({ root, open });

        const file = { name: 'Sally.tef' };
        const event = dropEvent([file]);
        listeners.drop(event);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(open).toHaveBeenCalledWith(file);
    });

    it('leaves unrelated drops to the browser', () => {
        const open = vi.fn();
        const listeners = {};
        const root = {
            body: document.body,
            addEventListener: (t, fn) => { listeners[t] = fn; },
            removeEventListener: () => {},
        };
        enableFileDrop({ root, open });

        const event = dropEvent([{ name: 'photo.png' }]);
        listeners.drop(event);
        expect(open).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('stays out of an element that owns its own drop zone', () => {
        const open = vi.fn();
        const listeners = {};
        const root = {
            body: document.body,
            addEventListener: (t, fn) => { listeners[t] = fn; },
            removeEventListener: () => {},
        };
        enableFileDrop({ root, open });

        const zone = document.createElement('div');
        zone.setAttribute('data-file-drop', '');
        document.body.appendChild(zone);
        listeners.drop(dropEvent([{ name: 'Sally.tef' }], zone));
        expect(open).not.toHaveBeenCalled();
    });

    it('returns a teardown and no-ops without a document', () => {
        expect(typeof enableFileDrop({ root: null })).toBe('function');
    });
});
