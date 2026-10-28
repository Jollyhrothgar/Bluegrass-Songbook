// Node 25+ defines its own global `localStorage` / `sessionStorage` (Web
// Storage), which is `undefined` unless node runs with --localstorage-file.
// Vitest's jsdom environment does not replace a global that already exists,
// so on those Node versions every test that touches storage saw `undefined`
// (45 failures on Node 26; CI's Node 20 has no such global). Put jsdom's
// storage back. Writable + configurable so `vi.stubGlobal` still works.
for (const name of ['localStorage', 'sessionStorage']) {
    const storage = globalThis.jsdom?.window?.[name];
    if (storage && globalThis[name] !== storage) {
        Object.defineProperty(globalThis, name, { value: storage, writable: true, configurable: true });
    }
}
