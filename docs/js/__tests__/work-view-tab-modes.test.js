// @vitest-environment jsdom
//
// The editor is a MODE of the song page (plan §9), not a page of its own.
//
// Before this, writing a tab meant leaving: `+ Add a tab` navigated to
// `create.html?work=…`, a standalone page with its own header, its own
// track label style and no idea what song it was for beyond a banner —
// and after Submit it printed a "View it" link to the page the tab had
// been headed for all along. These tests hold the replacement to its
// promise: whatever you are doing to a tab, you are doing it on the page
// the tab will be published on, with that page's chrome intact.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    openWork, openNewTabPage, startAddTabMode, teardownTablatureView,
    takeRefs, takeEditRef, findTakeByRef, getCurrentWork, availableParts,
} from '../work-view.js';
import { setAllSongs, setSongGroups } from '../state.js';
import { initShell } from '../shell.js';

// The real OTFEditor wants a canvas, soundfonts and a layout pass. What
// work-view actually depends on is a much smaller surface — this is it.
const editors = [];
vi.mock('../otf-editor/editor.js', () => ({
    OTFEditor: class {
        constructor(options) {
            this.options = options;
            this.isPlaying = false;
            this.destroyed = false;
            this.doc = options.otf;
            this.player = { metronomeEnabled: false, onPlaybackEnd: null };
            this.renderer = { setScale: vi.fn() };
            this.state = {
                otf: options.otf,
                setTempo: vi.fn(),
                facade: { on: vi.fn(), off: vi.fn(), canUndo: () => false },
            };
            options.container.innerHTML = '<div class="otf-editor">editor</div>';
            editors.push(this);
        }
        save() { return this.doc; }
        load(doc) { this.doc = doc; }
        download() {}
        togglePlayback() {}
        stop() {}
        destroy() { this.destroyed = true; }
    },
}));

const submitNewTab = vi.fn(async () => ({
    id: 'tab:gold-rush:abc123', workId: 'gold-rush', live: true, synced: true,
}));
vi.mock('../otf-editor/create-tab-entry.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, submitNewTab: (...args) => submitNewTab(...args) };
});

const OTF = {
    otf_version: '1.0',
    metadata: { title: 'Gold Rush', tempo: 120, time_signature: '4/4' },
    timing: { ticks_per_beat: 480 },
    tracks: [{ id: 'banjo', instrument: '5-string-banjo', role: 'lead',
               tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
    notation: { banjo: [{ measure: 1, notes: [] }] },
};

const SONG = {
    id: 'gold-rush',
    title: 'Gold Rush',
    artist: 'Bill Monroe',
    key: 'A',
    tablature_parts: [{
        instrument: 'banjo',
        label: 'Banjo',
        file: 'data/tabs/gold-rush-banjo-1.otf.json',
        src_file: 'banjo.otf.json',
        source: 'banjo-hangout',
        author: 'schlange',
        default: true,
    }],
};

const settle = () => new Promise(r => setTimeout(r, 0));
// The editor and its session are lazy-imported, so "the editor is open"
// is something to wait for rather than something to count ticks to.
const untilEditor = (n = 1) =>
    vi.waitFor(() => expect(editors.length).toBeGreaterThanOrEqual(n));
const band = () => document.getElementById('app-bottomband');

beforeEach(() => {
    editors.length = 0;
    submitNewTab.mockClear();
    // The shell is built ONCE (it is module state), so the page body is
    // replaced around it rather than under it.
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    document.getElementById('song-view')?.remove();
    const songView = document.createElement('div');
    songView.id = 'song-view';
    songView.innerHTML = '<div id="song-content"></div>';
    document.body.appendChild(songView);
    initShell({ nav: [] });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => structuredClone(OTF) }));
    window.history.replaceState({}, '', '#work/gold-rush');
    setAllSongs([structuredClone(SONG)]);
    setSongGroups({});
});

afterEach(() => {
    teardownTablatureView();
});

// ── Which take a URL names ───────────────────────────────────────────────
//
// `#work/{slug}/edit/{partRef}` has to survive a reload, so the ref cannot
// be an array index: takes are re-sorted by curation pins between builds.
// It is the take's own name — the works/ filename a correction targets.
describe('naming one take in a URL', () => {
    const take = SONG.tablature_parts[0];

    it('answers to its works/ name, its published name and its label', () => {
        expect(takeRefs(take)).toEqual(['banjo', 'gold-rush-banjo-1']);
    });

    it('mints links with the stable one (the works/ filename)', () => {
        expect(takeEditRef(take)).toBe('banjo');
    });

    it('finds the take a ref names, whichever name was used', () => {
        const parts = [{ type: 'lead-sheet' }, {
            type: 'tablature',
            arrangements: [
                { src_file: 'banjo.otf.json' },
                { src_file: 'banjo-18967.otf.json', file: 'data/tabs/f-banjo-18967.otf.json' },
            ],
        }];
        expect(findTakeByRef(parts, 'banjo-18967').index).toBe(1);
        expect(findTakeByRef(parts, 'f-banjo-18967').index).toBe(1);
        expect(findTakeByRef(parts, 'banjo').index).toBe(0);
        expect(findTakeByRef(parts, 'fiddle')).toBeNull();
        expect(findTakeByRef(parts, '')).toBeNull();
    });
});

// ── #work/{slug}/edit/{partRef} ──────────────────────────────────────────
describe('editing an existing take from its URL', () => {
    it('opens the song page with that take in the editor', async () => {
        await openWork('gold-rush', { editRef: 'banjo', fromDeepLink: true });
        await untilEditor();

        expect(editors).toHaveLength(1);
        expect(document.querySelector('#work-part-content .otf-editor')).not.toBeNull();
        // The page is still the song page: title, artist and all
        expect(document.querySelector('.song-title').textContent).toBe('Gold Rush');
        expect(document.querySelector('.song-artist-line').textContent).toBe('Bill Monroe');
    });

    it('keeps the bottom band, with the session buttons in the ✏️ Edit slot', async () => {
        await openWork('gold-rush', { editRef: 'banjo', fromDeepLink: true });
        await untilEditor();

        // The band did NOT become an italic notice
        expect(band().querySelector('.tab-play-btn')).not.toBeNull();
        expect(band().querySelector('.tab-tempo-display')).not.toBeNull();
        expect(band().querySelector('.tab-metronome-checkbox')).not.toBeNull();
        // ✏️ Edit is gone — its slot holds Submit correction / Download /
        // Cancel / Done instead
        expect(band().querySelector('.tab-edit-btn')).toBeNull();
        const actions = band().querySelector('.tab-edit-actions-slot .tab-edit-bar');
        expect(actions).not.toBeNull();
        expect(actions.querySelector('.tab-edit-submit').textContent)
            .toBe('🚀 Submit correction');
        expect(actions.querySelector('.tab-edit-done')).not.toBeNull();
    });

    it('writes the mode into the URL so a reload comes back here', async () => {
        await openWork('gold-rush', { editRef: 'banjo', fromDeepLink: true });
        await untilEditor();
        expect(window.location.hash).toBe('#work/gold-rush/edit/banjo');
    });

    it('Cancel puts the reader back on the tab, and the URL with them', async () => {
        await openWork('gold-rush', { editRef: 'banjo', fromDeepLink: true });
        await untilEditor();

        band().querySelector('.tab-edit-cancel').click();
        await settle();
        expect(window.location.hash).toBe('#work/gold-rush');
        expect(editors[0].destroyed).toBe(true);
    });
});

// ── #work/{slug}/add-tab ─────────────────────────────────────────────────
describe('adding a take to a song we have', () => {
    async function addTab(target = { instrument: 'banjo' }) {
        await openWork('gold-rush', { addTab: target, fromDeepLink: true });
        await untilEditor();
    }

    it('stays on the song page — same title, same other takes', async () => {
        await addTab();
        expect(document.querySelector('.song-title').textContent).toBe('Gold Rush');
        expect(document.querySelector('#work-part-content .otf-editor')).not.toBeNull();
        expect(editors).toHaveLength(1);
    });

    it('shows the new take in the versions list, labelled and unsaved', async () => {
        await addTab();
        const part = availableParts.find(p => p.type === 'tablature');
        expect(part.arrangements).toHaveLength(2);
        const take = part.arrangements[1];
        expect(take.label).toBe('Banjo — new take (unsaved)');
        expect(take.provisional).toBe(true);
        // …and it is the one selected
        expect(part.arrangementIndex).toBe(1);
        expect(document.querySelector('.arr-who').textContent)
            .toBe('Banjo — new take (unsaved)');
        expect(document.querySelector('.arr-meta').textContent).toContain('unsaved');
    });

    it('offers Submit tab / Download / Cancel — no Done, nothing to apply back', async () => {
        await addTab();
        const actions = band().querySelector('.tab-edit-actions-slot .tab-edit-bar');
        expect(actions.querySelector('.tab-edit-submit').textContent).toBe('🚀 Submit tab');
        expect(actions.querySelector('.tab-edit-download')).not.toBeNull();
        expect(actions.querySelector('.tab-edit-cancel')).not.toBeNull();
        expect(actions.querySelector('.tab-edit-done')).toBeNull();
    });

    it('offers the .tef import in the same place (create.html\'s drop zone)', async () => {
        await addTab();
        expect(band().querySelector('.tab-edit-import')).not.toBeNull();
    });

    it('starts from an empty document for the asked-for instrument', async () => {
        await addTab({ instrument: 'guitar' });
        const doc = editors[0].options.otf;
        expect(doc.tracks[0].instrument).toBe('6-string-guitar');
        expect(doc.metadata.title).toBe('Gold Rush');
    });

    it('takes a document handed to it (a parsed .tef) instead of an empty one', async () => {
        const imported = structuredClone(OTF);
        imported.metadata.title = 'Imported';
        startAddTabMode({ instrument: 'banjo', otf: imported });
        await untilEditor();
        expect(editors.at(-1).options.otf.metadata.title).toBe('Imported');
    });

    it('Cancel drops the unsaved take rather than leaving it in the list', async () => {
        await addTab();
        band().querySelector('.tab-edit-cancel').click();
        await settle();
        const part = availableParts.find(p => p.type === 'tablature');
        expect(part.arrangements).toHaveLength(1);
        expect(part.arrangements.some(a => a.provisional)).toBe(false);
    });

    it('submits against the work it is on, and stays there afterwards', async () => {
        await addTab();
        band().querySelector('.tab-edit-submit').click();
        await vi.waitFor(() => expect(submitNewTab).toHaveBeenCalled());
        const [, target] = submitNewTab.mock.calls[0];
        expect(target).toMatchObject({
            workId: 'gold-rush', instrument: 'banjo', title: 'Gold Rush',
        });

        await vi.waitFor(() => {
            expect(document.querySelector('.arr-status')).not.toBeNull();
        });
        // Stayed put: no "View it" link on a page somewhere else
        expect(window.location.hash).toBe('#work/gold-rush');
        expect(document.querySelector('.arr-status').textContent)
            .toMatch(/appears in search after the next build/);
    });

    it('the submitted take becomes PENDING in the versions list', async () => {
        await addTab();
        band().querySelector('.tab-edit-submit').click();
        await vi.waitFor(() => expect(submitNewTab).toHaveBeenCalled());
        await vi.waitFor(() => {
            const part = availableParts.find(p => p.type === 'tablature');
            const take = part.arrangements.find(a => a.pending);
            expect(take).toBeTruthy();
            expect(take.provisional).toBe(false);
            expect(take.pending_id).toBe('tab:gold-rush:abc123');
        });
    });
});

// ── #new-tab ─────────────────────────────────────────────────────────────
describe('a tab for a song the songbook does not have', () => {
    it('renders a provisional work page with editable title and artist', async () => {
        openNewTabPage({ title: 'Brand New Tune', instrument: 'banjo' });
        await untilEditor();

        const title = document.getElementById('new-tab-title');
        const artist = document.getElementById('new-tab-artist');
        expect(title.value).toBe('Brand New Tune');
        expect(artist.value).toBe('');
        expect(document.querySelector('#work-part-content .otf-editor')).not.toBeNull();

        artist.value = 'The Stanley Brothers';
        artist.dispatchEvent(new Event('input'));
        expect(getCurrentWork().artist).toBe('The Stanley Brothers');
    });

    it('keeps the same band, take header and buttons as every other mode', async () => {
        openNewTabPage({ title: 'Brand New Tune' });
        await untilEditor();
        expect(band().querySelector('.tab-play-btn')).not.toBeNull();
        expect(document.querySelector('.arr-who').textContent)
            .toBe('Banjo — new take (unsaved)');
        expect(band().querySelector('.tab-edit-submit').textContent).toBe('🚀 Submit tab');
    });

    it('honours the shape asked for in the query string', async () => {
        openNewTabPage({
            title: 'Waltzy', instruments: ['mandolin'],
            timeSignature: '3/4', tempo: 90, measures: 8,
        });
        await untilEditor();
        const doc = editors[0].options.otf;
        expect(doc.metadata.time_signature).toBe('3/4');
        expect(doc.metadata.tempo).toBe(90);
        expect(doc.tracks[0].instrument).toBe('mandolin');
    });

    it('mints the work on submit and becomes that work\'s page — no reload', async () => {
        submitNewTab.mockResolvedValueOnce({
            id: 'tab:brand-new-tune:xyz', workId: 'brand-new-tune', synced: true,
        });
        openNewTabPage({ title: 'Brand New Tune' });
        await untilEditor();

        document.getElementById('new-tab-artist').value = 'Ralph Stanley';
        document.getElementById('new-tab-artist').dispatchEvent(new Event('input'));

        band().querySelector('.tab-edit-submit').click();
        await vi.waitFor(() => expect(submitNewTab).toHaveBeenCalled());
        const [, target] = submitNewTab.mock.calls[0];
        // A mint, so the artist travels (submit-tab drops it for a target work)
        expect(target).toMatchObject({
            workId: null, title: 'Brand New Tune', artist: 'Ralph Stanley',
        });

        await vi.waitFor(() => {
            expect(window.location.hash).toBe('#work/brand-new-tune');
        });
        expect(getCurrentWork().id).toBe('brand-new-tune');
        expect(document.querySelector('.arr-status').textContent)
            .toMatch(/appears in search after the next build/);
    });

    it('refuses to submit an untitled tab rather than minting "Untitled"', async () => {
        openNewTabPage({});
        await untilEditor();
        band().querySelector('.tab-edit-submit').click();
        await vi.waitFor(() => {
            expect(band().querySelector('.tab-edit-status').textContent)
                .toMatch(/song title/i);
        });
        expect(submitNewTab).not.toHaveBeenCalled();
    });
});

// ── Drafts (the one thing create.html did that had to survive it) ────────
//
// The editor saves to localStorage on every change, so a reload does not
// cost an evening's arranging. What create.html could not do — because it
// had no idea which song you were on — is bring the draft back only where
// it belongs: a draft written for `gold-rush` must not appear in a tab you
// just started for a different song.
describe('an unsaved draft', () => {
    beforeEach(() => {
        localStorage.removeItem('otf-editor-draft');
    });

    it('comes back on the take it was written for', async () => {
        const draft = structuredClone(OTF);
        draft.metadata.title = 'Half-finished';
        localStorage.setItem('otf-editor-draft', JSON.stringify({
            savedAt: new Date().toISOString(), otf: draft,
            target: { workId: 'gold-rush' },
        }));

        await openWork('gold-rush', { addTab: { instrument: 'banjo' }, fromDeepLink: true });
        await untilEditor();
        expect(editors[0].options.otf.metadata.title).toBe('Half-finished');
        expect(document.querySelector('.arr-status').textContent)
            .toMatch(/Picked up where you left off/);
    });

    it('stays parked when the draft belongs to another song', async () => {
        const draft = structuredClone(OTF);
        draft.metadata.title = 'Someone else\'s tune';
        localStorage.setItem('otf-editor-draft', JSON.stringify({
            savedAt: new Date().toISOString(), otf: draft,
            target: { workId: 'salt-creek' },
        }));

        await openWork('gold-rush', { addTab: { instrument: 'banjo' }, fromDeepLink: true });
        await untilEditor();
        expect(editors[0].options.otf.metadata.title).toBe('Gold Rush');
    });

    it('is written on every edit, and discarded when the take is', async () => {
        await openWork('gold-rush', { addTab: { instrument: 'banjo' }, fromDeepLink: true });
        await untilEditor();

        editors[0].options.onChange({ edited: 'yes' });
        expect(JSON.parse(localStorage.getItem('otf-editor-draft')).otf)
            .toEqual({ edited: 'yes' });

        band().querySelector('.tab-edit-cancel').click();
        await settle();
        expect(localStorage.getItem('otf-editor-draft')).toBeNull();
    });

    it('is never saved while CORRECTING a published take', async () => {
        await openWork('gold-rush', { editRef: 'banjo', fromDeepLink: true });
        await untilEditor();
        expect(editors[0].options.onChange).toBeUndefined();
    });
});

// ── After Submit, both flows stay put (plan §9.1, last row) ──────────────
//
// The old create page printed a "View it" link to a page you then had to
// click through to; a correction printed its status inside the editor and
// left you there. Both now report on the page they happened on, in the
// take header, in the same words.
describe('submitting a correction', () => {
    const submitted = [];

    beforeEach(() => {
        submitted.length = 0;
        window.SupabaseAuth = { isLoggedIn: () => true, getUser: () => ({ id: 'u1' }) };
        window.refreshPendingSongs = vi.fn(async () => {});
    });

    async function submitCorrection() {
        await openWork('gold-rush', { editRef: 'banjo', fromDeepLink: true });
        await untilEditor();
        band().querySelector('.tab-edit-submit').click();
        const panel = band().querySelector('.tab-edit-submit-panel');
        panel.querySelector('.tab-edit-submit-comment').value = 'fixed bar 12';
        panel.querySelector('.tab-edit-submit-send').click();
        return panel;
    }

    it('marks the take pending and says so in the take header on ✓ Done', async () => {
        // submit-tab is dynamically imported by work-view; stub the network
        // underneath it rather than the module, so the payload still travels
        // through the real submitTab.
        global.fetch = vi.fn(async (url) => {
            if (String(url).includes('auto-commit-song')) {
                return { ok: true, json: async () => ({ success: true, workId: 'gold-rush' }) };
            }
            return { ok: true, json: async () => structuredClone(OTF) };
        });
        window.SupabaseAuth = {
            isLoggedIn: () => true,
            getUser: () => ({ id: 'u1' }),
            supabase: {
                auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
                from: () => ({ upsert: async (row) => { submitted.push(row); return { error: null }; } }),
            },
        };

        const panel = await submitCorrection();
        await vi.waitFor(() => expect(submitted).toHaveLength(1));
        expect(submitted[0]).toMatchObject({
            part_type: 'tablature',
            instrument: 'banjo',
            part_file: 'banjo.otf.json',   // WHICH take was corrected
            replaces_id: 'gold-rush',
            notes: 'fixed bar 12',
        });
        await vi.waitFor(() => {
            expect(panel.querySelector('.tab-edit-submit-status').textContent)
                .toMatch(/live on this tab now/);
        });

        band().querySelector('.tab-edit-done').click();
        await settle();
        // Stayed on the song page, with the status where the take is named
        expect(window.location.hash).toBe('#work/gold-rush');
        expect(document.querySelector('.arr-status').textContent)
            .toMatch(/appears in search after the next build/);
        expect(document.querySelector('.arr-meta').textContent)
            .toContain('just submitted');
        expect(window.refreshPendingSongs).toHaveBeenCalled();
    });
});

// ── The race that ate the edit band (found in a real browser) ────────────
//
// `#work/{slug}/add-tab` renders the song page first, which starts loading
// the PUBLISHED take, and then adds the unsaved one. Both live on the same
// part object (a second banjo take is still the banjo pill), so "did the
// active part change?" could not tell the superseded render to stop — and
// when the fetch landed after the editor had mounted, it painted a
// read-mode band over the edit-mode one: no Submit, no Cancel, no way out.
describe('a slow published take cannot clobber the editor', () => {
    it('keeps the session buttons when the fetch lands after the mount', async () => {
        let release;
        const held = new Promise(r => { release = r; });
        global.fetch = vi.fn(async () => {
            await held;
            return { ok: true, json: async () => structuredClone(OTF) };
        });

        await openWork('gold-rush', {
            addTab: { instrument: 'banjo' }, fromDeepLink: true,
        });
        await untilEditor();

        release();                       // the read view's document arrives late
        await settle();
        await settle();

        expect(band().querySelector('.tab-edit-submit')).not.toBeNull();
        expect(band().querySelector('.tab-edit-btn')).toBeNull();
        expect(document.querySelector('#work-part-content .otf-editor')).not.toBeNull();
    });
});

// One pill per instrument FAMILY, here as everywhere else: a part filed as
// `5-string-banjo` is the banjo pill in search, in the facets and on the
// page, so a new banjo take joins it instead of minting a second pill that
// says the same word.
describe('adding a take next to one filed under the long instrument name', () => {
    it('joins the existing pill rather than opening a second one', async () => {
        const song = structuredClone(SONG);
        song.tablature_parts[0].instrument = '5-string-banjo';
        setAllSongs([song]);

        await openWork('gold-rush', {
            addTab: { instrument: 'banjo' }, fromDeepLink: true,
        });
        await untilEditor();

        const tabParts = availableParts.filter(p => p.type === 'tablature');
        expect(tabParts).toHaveLength(1);
        expect(tabParts[0].arrangements).toHaveLength(2);
        expect(tabParts[0].arrangements[1].provisional).toBe(true);
    });
});
