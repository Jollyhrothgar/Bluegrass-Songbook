// New-tab flow: form → OTF builder + localStorage drafts.
import { describe, it, expect, beforeEach } from 'vitest';

import {
    buildNewTab, saveDraft, loadDraft, clearDraft, DRAFT_KEY,
    INSTRUMENT_CHOICES,
} from '../../otf-editor/create-tab.js';
import { EditorState } from '../../otf-editor/state.js';

describe('buildNewTab', () => {
    it('builds from form values', () => {
        const otf = buildNewTab({
            title: '  Salt Creek  ',
            instruments: ['5-string-banjo', '6-string-guitar'],
            timeSignature: '2/2',
            tempo: '100',
            measures: '32',
        });
        expect(otf.metadata.title).toBe('Salt Creek');
        expect(otf.metadata.time_signature).toBe('2/2');
        expect(otf.metadata.tempo).toBe(100);
        expect(otf.tracks.map(t => t.id)).toEqual(['banjo', 'guitar']);
        expect(otf.notation.guitar).toHaveLength(32);
    });

    it('clamps and defaults hostile input', () => {
        const otf = buildNewTab({ title: '', instruments: [], tempo: '9999', measures: '-3' });
        expect(otf.metadata.title).toBe('Untitled');
        expect(otf.tracks.map(t => t.id)).toEqual(['banjo']);
        expect(otf.metadata.tempo).toBe(280);
        expect(otf.notation.banjo).toHaveLength(1);
    });

    it('every instrument choice is buildable', () => {
        const otf = buildNewTab({ instruments: INSTRUMENT_CHOICES.map(c => c.value) });
        expect(otf.tracks).toHaveLength(INSTRUMENT_CHOICES.length);
        for (const t of otf.tracks) expect(t.tuning.length).toBeGreaterThan(3);
    });
});

describe('drafts', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips through localStorage', () => {
        const otf = buildNewTab({ title: 'Draft Tune', instruments: ['mandolin'] });
        saveDraft(otf);
        const draft = loadDraft();
        expect(draft.otf.metadata.title).toBe('Draft Tune');
        expect(typeof draft.savedAt).toBe('string');
        clearDraft();
        expect(loadDraft()).toBeNull();
    });

    it('rejects corrupt drafts', () => {
        localStorage.setItem(DRAFT_KEY, '{not json');
        expect(loadDraft()).toBeNull();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ otf: { tracks: [] } }));
        expect(loadDraft()).toBeNull();
    });
});

describe('EditorState.setTrack (in-editor track switching)', () => {
    it('switches editing target, resets cursor to the new track', () => {
        const otf = buildNewTab({ instruments: ['5-string-banjo', 'upright-bass'] });
        const state = new EditorState({ otf });
        state.insertNote(5); // on banjo
        expect(state.setTrack('bass')).toBe(true);
        expect(state.trackId).toBe('bass');
        expect(state.getStringCount()).toBe(4);
        expect(state.cursor.measure).toBe(1);
        state.insertNote(2, { string: 1 });
        expect(state.otf.notation.bass[0].events).toHaveLength(1);
        expect(state.otf.notation.banjo[0].events).toHaveLength(1); // untouched
    });

    it('rejects unknown tracks', () => {
        const state = new EditorState({ otf: buildNewTab({}) });
        expect(state.setTrack('kazoo')).toBe(false);
        expect(state.trackId).toBe('banjo');
    });
});
