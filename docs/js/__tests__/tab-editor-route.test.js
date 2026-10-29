// /tab-editor/ is a path the app owns (G15c), like a song's path: it is
// routed, and it is given back to the root the moment the reader leaves it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { TAB_EDITOR_PATH, SONG_PATH, normalizedHref } from '../state.js';

describe('TAB_EDITOR_PATH', () => {
    it('matches /tab-editor/ with or without the slash, and nothing else', () => {
        expect(TAB_EDITOR_PATH.test('/tab-editor/')).toBe(true);
        expect(TAB_EDITOR_PATH.test('/tab-editor')).toBe(true);
        for (const other of ['/', '/tab-editor/x/', '/songs/tab-editor/', '/tab-editors/', '/index.html']) {
            expect(TAB_EDITOR_PATH.test(other), other).toBe(false);
        }
    });

    it('is not a song path', () => {
        expect(SONG_PATH.test('/tab-editor/')).toBe(false);
    });
});

describe('normalizedHref (what the currentView subscriber does on leaving)', () => {
    it('leaves the front door alone while it is showing', () => {
        expect(normalizedHref('tab-editor', { pathname: '/tab-editor/', hash: '' })).toBeNull();
    });

    it('moves every other view to the root, keeping its hash', () => {
        expect(normalizedHref('search', { pathname: '/tab-editor/', hash: '#search' })).toBe('/#search');
        expect(normalizedHref('song', { pathname: '/tab-editor', hash: '#new-tab?draft=d-1' }))
            .toBe('/#new-tab?draft=d-1');
        expect(normalizedHref('home', { pathname: '/tab-editor/', hash: '' })).toBe('/');
    });

    it('still normalizes a song path for any view but the song', () => {
        expect(normalizedHref('search', { pathname: '/songs/x/', hash: '#search' })).toBe('/#search');
        expect(normalizedHref('song', { pathname: '/songs/x/', hash: '' })).toBeNull();
        expect(normalizedHref('tab-editor', { pathname: '/songs/x/', hash: '' })).toBe('/');
    });

    it('does nothing at the root', () => {
        expect(normalizedHref('search', { pathname: '/', hash: '#search' })).toBeNull();
    });

    // Back then Forward onto a song: the Forward lands before its route runs
    // (main.js parks popstate work for a task), so the view is still the page
    // being left. The history entry's own state says it is the song's, and
    // its URL was being rewritten to / (e2e/song-paths.spec.js).
    it('leaves an entry that is its path\'s own view alone, whatever the view says', () => {
        expect(normalizedHref('search', { pathname: '/songs/x/', hash: '' }, 'song')).toBeNull();
        expect(normalizedHref('search', { pathname: '/tab-editor/', hash: '' }, 'tab-editor')).toBeNull();
    });

    it('still normalizes when the entry belongs to another view or has no state', () => {
        expect(normalizedHref('search', { pathname: '/songs/x/', hash: '#search' }, null)).toBe('/#search');
        expect(normalizedHref('search', { pathname: '/songs/x/', hash: '#search' }, 'search')).toBe('/#search');
        expect(normalizedHref('home', { pathname: '/tab-editor/', hash: '' }, 'song')).toBe('/');
    });
});

// main.js can't be imported without booting the app, so its wiring is pinned
// by what it says (the behaviour itself is e2e/tab-editor-front-door.spec.js).
describe('main.js wiring', () => {
    const main = readFileSync(resolve(__dirname, '../main.js'), 'utf8');

    it('handleDeepLink routes the front door and says so, so boot does not rewrite it to /', () => {
        const fn = main.slice(main.indexOf('function handleDeepLink()'));
        const head = fn.slice(0, fn.indexOf('// Dungeon chrome persists'));
        expect(head).toMatch(/if \(!hash\) return routeSongPath\(\) \|\| routeTabEditorPath\(\)/);
        const route = main.slice(main.indexOf('function routeTabEditorPath()'));
        expect(route.slice(0, route.indexOf('\n}\n'))).toMatch(
            /TAB_EDITOR_PATH\.test[\s\S]*showView\('tab-editor'\)[\s\S]*pushHistoryState\('tab-editor', \{\}, true\)[\s\S]*return true/);
    });

    it('the currentView subscriber normalizes through normalizedHref', () => {
        expect(main).toMatch(/normalizedHref\(view, window\.location, history\.state\?\.view\)/);
    });

    it('the ⋯ menu offers My tabs and Tab editor, navigating without a reload', () => {
        expect(main).toMatch(/label: 'My tabs'[^\n]*showView\('drafts'\)/);
        expect(main).toMatch(/label: 'Tab editor'[^\n]*showView\('tab-editor'\)[^\n]*pushHistoryState\('tab-editor'\)/);
        expect(main).not.toMatch(/label: 'Drafts'/);
    });

    it('back/forward to the front door renders it', () => {
        expect(main).toMatch(/case 'tab-editor':\s*showView\('tab-editor'\)/);
    });
});
