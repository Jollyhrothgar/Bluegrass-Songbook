// Phase 3b: the editor's half of the dedup offramp is wired, and the thing it
// replaced is gone.
//
// The scoring and the choice mapping are tested directly in
// dedup-check.test.js. What can only be checked here is that submitSong
// actually consults the offramp and actually honours the answer — the wiring
// is the part that silently rots.
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { showDedupModal } from '../editor.js';
import { Choice, Outcome } from '../dedup-check.js';

const EDITOR_SOURCE = readFileSync(resolve(__dirname, '../editor.js'), 'utf-8');
const SUBMIT_SONG = EDITOR_SOURCE.slice(
    EDITOR_SOURCE.indexOf('async function submitSong'));

describe('the editor offramp', () => {
    it('replaced the title-only confirm() with the real scorer', () => {
        // The old check fired on any same-titled song, offered no evidence,
        // and its only choice was "Submit anyway?".
        expect(EDITOR_SOURCE).not.toContain('Possible duplicate found');
        expect(EDITOR_SOURCE).not.toContain('Submit anyway?');
        expect(EDITOR_SOURCE).toContain("from './dedup-check.js'");
    });

    it('runs before the pending_songs write, not after', () => {
        const offramp = SUBMIT_SONG.indexOf('resolveDedupOfframp');
        const upsert = SUBMIT_SONG.indexOf('.upsert(pendingEntry');
        expect(offramp).toBeGreaterThan(-1);
        expect(upsert).toBeGreaterThan(-1);
        expect(offramp).toBeLessThan(upsert);
    });

    it('skips the check for an edit, whose target is already chosen', () => {
        expect(SUBMIT_SONG).toMatch(/if \(!editMode\) \{[\s\S]*?resolveDedupOfframp/);
    });

    it('honours a retarget by writing the row against the matched work', () => {
        // id AND replaces_id both move: the row is written as an edit of the
        // matched work, which is what makes the server classify it (update if
        // they own content there, otherwise a fork to a new arrangement)
        // instead of minting a second slug.
        expect(SUBMIT_SONG).toContain('const targetId = retargetId || slug;');
        expect(SUBMIT_SONG).toContain('id: targetId,');
        expect(SUBMIT_SONG).toContain('replaces_id: editMode ? editingSongId : retargetId,');
        // And the user lands on the work they actually contributed to.
        expect(SUBMIT_SONG).toContain('window.location.hash = `#song/${targetId}`');
    });

    it('never submits when the modal was dismissed', () => {
        expect(SUBMIT_SONG).toMatch(/if \(!outcome\.submit\) \{[\s\S]*?return;/);
    });

    it('loads the archive before matching, so archived duplicates are found', () => {
        const offramp = EDITOR_SOURCE.slice(
            EDITOR_SOURCE.indexOf('async function resolveDedupOfframp'));
        expect(offramp.indexOf('ensureArchiveLoaded'))
            .toBeLessThan(offramp.indexOf('findLikelyMatch'));
    });

    it('falls back to submitting as new when the check itself fails', () => {
        const offramp = EDITOR_SOURCE.slice(
            EDITOR_SOURCE.indexOf('async function resolveDedupOfframp'));
        expect(offramp).toMatch(/catch[\s\S]{0,200}return asNew;/);
    });
});

describe('the offramp modal', () => {
    const match = {
        song: {
            id: 'how-long-blues',
            title: 'How Long Blues',
            artist: 'Del McCoury',
            indexed: true,
        },
        verdict: {
            outcome: Outcome.ENRICH,
            score: 0.8857,
            matchedId: 'how-long-blues',
            titleSimilarity: 1,
            lowConfidence: false,
            autoActionable: true,
            warnings: [],
            details: {},
        },
    };

    afterEach(() => {
        document.getElementById('dedup-offramp-modal')?.remove();
        document.body.innerHTML = '';
    });

    it('names the match and shows the number the scorer decided on', async () => {
        showDedupModal(match);

        const modal = document.getElementById('dedup-offramp-modal');
        expect(modal).not.toBeNull();
        const lead = modal.querySelector('.dedup-offramp-lead').textContent;
        expect(lead).toContain('How Long Blues');
        expect(lead).toContain('Del McCoury');
        expect(lead).toContain('89% of its lyrics match');
    });

    it('resolves with the chosen action and tears itself down', async () => {
        const pending = showDedupModal(match);
        document.querySelector(`[data-choice="${Choice.ARRANGEMENT}"]`).click();

        await expect(pending).resolves.toBe(Choice.ARRANGEMENT);
        expect(document.getElementById('dedup-offramp-modal')).toBeNull();
    });

    it('resolves null on Escape — a dismissal is not consent to duplicate', async () => {
        const pending = showDedupModal(match);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        await expect(pending).resolves.toBeNull();
        expect(document.getElementById('dedup-offramp-modal')).toBeNull();
    });

    it('offers promote only on an archived match to a trusted user', async () => {
        const archived = { ...match, song: { ...match.song, indexed: false } };

        showDedupModal(archived, { trusted: false });
        expect(document.querySelector(`[data-choice="${Choice.PROMOTE}"]`)).toBeNull();
        document.getElementById('dedup-offramp-modal').remove();

        showDedupModal(archived, { trusted: true });
        expect(document.querySelector(`[data-choice="${Choice.PROMOTE}"]`)).not.toBeNull();
    });
});
