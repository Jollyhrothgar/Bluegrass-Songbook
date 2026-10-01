// @vitest-environment jsdom
// A5: a sign-in redirect must not cost the user their place or their work.
// The record is written just before the redirect and consumed once after it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    RETURN_KEY, RETURN_TTL_MS, detectAuthRedirect, isSafeReturnHash,
    registerReturnSource, buildReturnRecord, persistReturnRecord,
    takeReturnRecord, pruneReturnRecord, clearReturnRecord,
} from '../auth-return.js';
import { requireLogin } from '../utils.js';

const NOW = 1_800_000_000_000;

function setHash(hash) {
    window.history.replaceState(null, '', `/${hash}`);
}

let unregister = [];
const source = (fn) => { const off = registerReturnSource(fn); unregister.push(off); return off; };

beforeEach(() => {
    localStorage.clear();
    setHash('');
});

afterEach(() => {
    unregister.forEach(off => off());
    unregister = [];
    delete window.SupabaseAuth;
    vi.restoreAllMocks();
});

describe('detectAuthRedirect', () => {
    it('recognises the implicit-flow return and an error return', () => {
        expect(detectAuthRedirect('#access_token=abc&expires_in=3600&token_type=bearer')).toBe('signed-in');
        expect(detectAuthRedirect('#refresh_token=x')).toBe('signed-in');
        expect(detectAuthRedirect('#error=access_denied&error_description=nope')).toBe('error');
        expect(detectAuthRedirect('', '?error=access_denied&error_description=nope')).toBe('error');
    });

    it('ignores ordinary routes (an app hash is not an auth return)', () => {
        expect(detectAuthRedirect('')).toBeNull();
        expect(detectAuthRedirect('#add')).toBeNull();
        expect(detectAuthRedirect('#work/foo/edit/bar?draft=d-1')).toBeNull();
        expect(detectAuthRedirect('#search/access_token')).toBeNull();
    });
});

describe('isSafeReturnHash', () => {
    it('accepts in-app routes only', () => {
        expect(isSafeReturnHash('#add')).toBe(true);
        expect(isSafeReturnHash('#edit/your-cheating-heart')).toBe(true);
        expect(isSafeReturnHash('#work/x/edit/banjo-1?draft=d-abc')).toBe(true);
        expect(isSafeReturnHash('')).toBe(false);
        expect(isSafeReturnHash('#')).toBe(false);
        expect(isSafeReturnHash('add')).toBe(false);
        expect(isSafeReturnHash('https://evil.example/#add')).toBe(false);
        expect(isSafeReturnHash(null)).toBe(false);
        expect(isSafeReturnHash('#access_token=abc')).toBe(false);
        expect(isSafeReturnHash('#invite/tok')).toBe(false);
        expect(isSafeReturnHash('#' + 'a'.repeat(700))).toBe(false);
    });
});

describe('the record', () => {
    it('is just the route when no editor is open', () => {
        setHash('#list/favorites');
        const record = buildReturnRecord(NOW);
        expect(record).toEqual({ v: 1, at: NOW, hash: '#list/favorites', kind: 'route' });
    });

    it('is nothing at home (there is no route to return to)', () => {
        expect(buildReturnRecord(NOW)).toBeNull();
        expect(persistReturnRecord(NOW)).toBe(false);
        expect(localStorage.getItem(RETURN_KEY)).toBeNull();
    });

    it("takes the open editor's route and state over the bare hash", () => {
        setHash('#add');
        source(() => ({
            kind: 'lead-sheet', hash: '#edit/some-song',
            state: { title: 'T', content: '[G]x', editingSongId: 'some-song' },
        }));
        const record = buildReturnRecord(NOW);
        expect(record.hash).toBe('#edit/some-song');
        expect(record.kind).toBe('lead-sheet');
        expect(record.state.content).toBe('[G]x');
    });

    it('skips sources that decline and survives one that throws', () => {
        setHash('#add');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        source(() => { throw new Error('boom'); });
        source(() => null);
        source(() => ({ kind: 'tab', hash: '#new-tab?draft=d-1' }));
        expect(buildReturnRecord(NOW).hash).toBe('#new-tab?draft=d-1');
    });

    it('never stores a route it would not replay', () => {
        setHash('#add');
        source(() => ({ kind: 'tab', hash: '#access_token=stolen' }));
        // the bad source hash is ignored; the page's own hash is used
        expect(buildReturnRecord(NOW).hash).toBe('#add');
    });
});

describe('persist and take', () => {
    it('round-trips once, then the record is gone', () => {
        setHash('#add');
        source(() => ({ kind: 'lead-sheet', hash: '#add', state: { content: '[G]kept' } }));
        expect(persistReturnRecord(NOW)).toBe(true);

        const record = takeReturnRecord(NOW + 60_000);
        expect(record.state.content).toBe('[G]kept');
        expect(takeReturnRecord(NOW + 61_000)).toBeNull();
        expect(localStorage.getItem(RETURN_KEY)).toBeNull();
    });

    it('expires, and removes what it refuses', () => {
        setHash('#add');
        persistReturnRecord(NOW);
        expect(takeReturnRecord(NOW + RETURN_TTL_MS + 1)).toBeNull();
        expect(localStorage.getItem(RETURN_KEY)).toBeNull();
    });

    it('refuses a record from the future, a wrong version and garbage', () => {
        const put = (value) => localStorage.setItem(RETURN_KEY,
            typeof value === 'string' ? value : JSON.stringify(value));
        put({ v: 1, at: NOW + 3_600_000, hash: '#add', kind: 'route' });
        expect(takeReturnRecord(NOW)).toBeNull();
        put({ v: 2, at: NOW, hash: '#add', kind: 'route' });
        expect(takeReturnRecord(NOW)).toBeNull();
        put({ v: 1, at: NOW, hash: 'javascript:alert(1)', kind: 'route' });
        expect(takeReturnRecord(NOW)).toBeNull();
        put({ v: 1, at: NOW, hash: '#add', kind: 'steal-cookies' });
        expect(takeReturnRecord(NOW)).toBeNull();
        put('{not json');
        expect(takeReturnRecord(NOW)).toBeNull();
    });

    it('keeps the route when the state is too big for storage', () => {
        setHash('#add');
        source(() => ({
            kind: 'lead-sheet', hash: '#add',
            state: { content: 'x'.repeat(1_600_000) },
        }));
        expect(persistReturnRecord(NOW)).toBe(true);
        const record = takeReturnRecord(NOW);
        expect(record.kind).toBe('route');
        expect(record.state).toBeUndefined();
        expect(record.hash).toBe('#add');
    });

    it('never throws when storage is unavailable', () => {
        setHash('#add');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(persistReturnRecord(NOW)).toBe(false);
    });

    it('pruneReturnRecord drops an expired record but leaves a fresh one', () => {
        setHash('#add');
        persistReturnRecord(Date.now() - RETURN_TTL_MS - 5000);
        pruneReturnRecord();
        expect(localStorage.getItem(RETURN_KEY)).toBeNull();

        persistReturnRecord(Date.now());
        pruneReturnRecord();
        expect(localStorage.getItem(RETURN_KEY)).not.toBeNull();
        clearReturnRecord();
        expect(localStorage.getItem(RETURN_KEY)).toBeNull();
    });
});

describe('requireLogin leaves the record before it redirects', () => {
    it('writes the record, THEN calls signInWithGoogle', () => {
        setHash('#add');
        source(() => ({ kind: 'lead-sheet', hash: '#add', state: { content: '[G]hi' } }));
        let recordAtRedirect = null;
        window.SupabaseAuth = {
            isLoggedIn: () => false,
            signInWithGoogle: vi.fn(() => { recordAtRedirect = localStorage.getItem(RETURN_KEY); }),
        };

        expect(requireLogin('submit songs')).toBe(false);
        expect(window.SupabaseAuth.signInWithGoogle).toHaveBeenCalledTimes(1);
        expect(JSON.parse(recordAtRedirect).state.content).toBe('[G]hi');
    });

    it('does nothing when already signed in', () => {
        setHash('#add');
        window.SupabaseAuth = { isLoggedIn: () => true, signInWithGoogle: vi.fn() };
        expect(requireLogin('submit songs')).toBe(true);
        expect(window.SupabaseAuth.signInWithGoogle).not.toHaveBeenCalled();
        expect(localStorage.getItem(RETURN_KEY)).toBeNull();
    });
});
