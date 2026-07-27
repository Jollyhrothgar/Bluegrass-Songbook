// New-tab-from-scratch flow: form values → empty multi-track OTF →
// editor, with a localStorage draft so work survives reloads.
//
// Kept UI-thin and injected so create.html stays a shell and tests can
// exercise the logic in jsdom.

import { createMultiTrackOTF } from './actions.js';

export const DRAFT_KEY = 'otf-editor-draft';

export const INSTRUMENT_CHOICES = [
    { value: '5-string-banjo', label: 'Banjo (5-string, open G)' },
    { value: '6-string-guitar', label: 'Guitar' },
    { value: 'mandolin', label: 'Mandolin' },
    { value: 'upright-bass', label: 'Bass' },
    { value: 'tenor-banjo', label: 'Tenor banjo' },
    { value: 'dobro', label: 'Dobro' },
];

/** Build the OTF from (already validated) form values. */
export function buildNewTab({ title, instruments, timeSignature, tempo, measures }) {
    return createMultiTrackOTF({
        title: (title || 'Untitled').trim() || 'Untitled',
        instruments: instruments && instruments.length ? instruments : ['5-string-banjo'],
        timeSignature: timeSignature || '4/4',
        tempo: Math.max(40, Math.min(280, Number(tempo) || 120)),
        measures: Math.max(1, Math.min(128, Number(measures) || 16)),
    });
}

/** Persist a draft (called from the editor's onChange). */
export function saveDraft(otf, storage = globalThis.localStorage) {
    try {
        storage.setItem(DRAFT_KEY, JSON.stringify({
            savedAt: new Date().toISOString(),
            otf,
        }));
    } catch (e) {
        // quota/private-mode — drafts are best-effort
    }
}

/** @returns {{savedAt: string, otf: Object}|null} */
export function loadDraft(storage = globalThis.localStorage) {
    try {
        const raw = storage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (!draft?.otf?.tracks?.length) return null;
        return draft;
    } catch (e) {
        return null;
    }
}

export function clearDraft(storage = globalThis.localStorage) {
    try {
        storage.removeItem(DRAFT_KEY);
    } catch (e) { /* ignore */ }
}
