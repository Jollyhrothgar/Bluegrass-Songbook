// Unit tests for state.js reactive system
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Import the reactive state functions
import {
    subscribe,
    setState,
    getState,
    // Test with a few concrete state values
    currentView, setCurrentView,
    currentSearchQuery, setCurrentSearchQuery,
    corpusLoadFailed, setCorpusLoadFailed,
    historyInitialized, setHistoryInitialized,
    bootRouteClaimed, setBootRouteClaimed, canRouteBootUrl
} from '../state.js';

// Helper to wait for requestAnimationFrame callbacks
const flushRAF = () => new Promise(resolve => {
    requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    });
});

describe('Reactive State System', () => {
    afterEach(async () => {
        // Reset state to defaults and flush any pending notifications
        setCurrentView('home');
        setCurrentSearchQuery('');
        await flushRAF();
    });

    describe('getState', () => {
        it('returns specific state value when key provided', () => {
            expect(getState('currentView')).toBe('home');
            expect(getState('currentSearchQuery')).toBe('');
        });

        it('returns state snapshot when no key provided', () => {
            const snapshot = getState();
            expect(snapshot).toHaveProperty('currentView');
            expect(snapshot).toHaveProperty('currentSearchQuery');
        });
    });

    describe('subscribe', () => {
        it('calls callback when subscribed state changes', async () => {
            const callback = vi.fn();
            subscribe('currentView', callback);

            setCurrentView('song');
            await flushRAF();

            expect(callback).toHaveBeenCalledWith('song', 'currentView');
        });

        it('does not call callback for unrelated state changes', async () => {
            const callback = vi.fn();
            subscribe('currentView', callback);

            setCurrentSearchQuery('banjo');
            await flushRAF();

            expect(callback).not.toHaveBeenCalled();
        });

        it('returns unsubscribe function', async () => {
            const callback = vi.fn();
            const unsubscribe = subscribe('currentView', callback);

            // Unsubscribe before state change
            unsubscribe();

            setCurrentView('song');
            await flushRAF();

            expect(callback).not.toHaveBeenCalled();
        });

        it('supports wildcard subscription for all changes', async () => {
            const callback = vi.fn();
            subscribe('*', callback);

            setCurrentView('song');
            await flushRAF();

            expect(callback).toHaveBeenCalled();
            const [state, changedKeys] = callback.mock.calls[0];
            expect(changedKeys).toContain('currentView');
        });
    });

    describe('setState', () => {
        it('updates multiple state values at once', async () => {
            const viewCallback = vi.fn();
            const queryCallback = vi.fn();

            subscribe('currentView', viewCallback);
            subscribe('currentSearchQuery', queryCallback);

            setState({
                currentView: 'song',
                currentSearchQuery: 'banjo'
            });
            await flushRAF();

            expect(viewCallback).toHaveBeenCalledWith('song', 'currentView');
            expect(queryCallback).toHaveBeenCalledWith('banjo', 'currentSearchQuery');
        });

        it('does not notify if value unchanged', async () => {
            const callback = vi.fn();
            subscribe('currentView', callback);

            // Set to same value
            setState({ currentView: 'home' });
            await flushRAF();

            expect(callback).not.toHaveBeenCalled();
        });

        it('batches multiple updates into single notification', async () => {
            const callback = vi.fn();
            subscribe('currentView', callback);

            // Multiple rapid updates
            setCurrentView('song');
            setCurrentView('add-song');
            setCurrentView('favorites');

            await flushRAF();

            // Should only be called once with final value
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith('favorites', 'currentView');
        });
    });

    describe('legacy setters with notification', () => {
        it('setCurrentView triggers subscribers', async () => {
            const callback = vi.fn();
            subscribe('currentView', callback);

            setCurrentView('song');
            await flushRAF();

            expect(callback).toHaveBeenCalledWith('song', 'currentView');
        });

        it('setCurrentSearchQuery triggers subscribers', async () => {
            const callback = vi.fn();
            subscribe('currentSearchQuery', callback);

            setCurrentSearchQuery('fiddle');
            await flushRAF();

            expect(callback).toHaveBeenCalledWith('fiddle', 'currentSearchQuery');
        });
    });
});

describe('State Values', () => {
    it('currentView defaults to home', () => {
        expect(getState('currentView')).toBe('home');
    });

    it('currentSearchQuery defaults to empty string', () => {
        expect(getState('currentSearchQuery')).toBe('');
    });
});

describe('corpusLoadFailed', () => {
    afterEach(async () => {
        setCorpusLoadFailed(false);
        await flushRAF();
    });

    it('defaults to false', () => {
        expect(corpusLoadFailed).toBe(false);
        expect(getState('corpusLoadFailed')).toBe(false);
    });

    it('setCorpusLoadFailed(true) flips the flag and notifies subscribers', async () => {
        const callback = vi.fn();
        subscribe('corpusLoadFailed', callback);

        setCorpusLoadFailed(true);
        await flushRAF();

        expect(corpusLoadFailed).toBe(true);
        expect(getState('corpusLoadFailed')).toBe(true);
        expect(callback).toHaveBeenCalledWith(true, 'corpusLoadFailed');
    });

    it('setCorpusLoadFailed(false) clears it — the retry-succeeded path', async () => {
        setCorpusLoadFailed(true);
        await flushRAF();

        const callback = vi.fn();
        subscribe('corpusLoadFailed', callback);
        setCorpusLoadFailed(false);
        await flushRAF();

        expect(corpusLoadFailed).toBe(false);
        expect(callback).toHaveBeenCalledWith(false, 'corpusLoadFailed');
    });
});

// The boot sequence in main.js loadIndex() ends by routing the URL the page
// loaded with. That tail runs after a network round-trip, so a user can
// navigate first — and the tail used to yank them back. bootRouteClaimed is
// the flag that lets the tail tell "nobody has moved" from "the user already
// chose a view".
describe('bootRouteClaimed', () => {
    beforeEach(() => {
        setBootRouteClaimed(false);
        setHistoryInitialized(false);
    });

    afterEach(() => {
        setBootRouteClaimed(false);
        setHistoryInitialized(false);
    });

    it('defaults to unclaimed, so an untouched boot still routes its URL', () => {
        expect(bootRouteClaimed).toBe(false);
        expect(getState('bootRouteClaimed')).toBe(false);
        expect(canRouteBootUrl()).toBe(true);
    });

    it('canRouteBootUrl() goes false once the route is claimed', () => {
        setBootRouteClaimed(true);
        expect(bootRouteClaimed).toBe(true);
        expect(getState('bootRouteClaimed')).toBe(true);
        expect(canRouteBootUrl()).toBe(false);
    });

    it('round-trips through setState/getState like its siblings', () => {
        setState({ bootRouteClaimed: true });
        expect(getState('bootRouteClaimed')).toBe(true);
        setState({ bootRouteClaimed: false });
        expect(getState('bootRouteClaimed')).toBe(false);
    });

    // The two halves of the guard, as main.js sequences them:
    //   pushHistoryState() -> if (!historyInitialized) setBootRouteClaimed(true)
    //   boot tail          -> setHistoryInitialized(true); if (canRouteBootUrl()) route()
    const pushHistoryState = () => {
        if (!historyInitialized) setBootRouteClaimed(true);
    };
    const bootTail = (route) => {
        setHistoryInitialized(true);
        if (canRouteBootUrl()) route();
    };

    it('routes the boot URL when nothing navigated during load', () => {
        const route = vi.fn();
        bootTail(route);
        expect(route).toHaveBeenCalledTimes(1);
    });

    it('stands down when the user navigated while the index was loading', () => {
        const route = vi.fn();
        pushHistoryState();          // user clicks a nav link mid-boot
        expect(bootRouteClaimed).toBe(true);
        bootTail(route);
        expect(route).not.toHaveBeenCalled();
    });

    it('does not let post-boot navigation claim anything', () => {
        const route = vi.fn();
        bootTail(route);             // boot finishes untouched
        expect(route).toHaveBeenCalledTimes(1);

        pushHistoryState();          // ordinary navigation afterwards
        expect(bootRouteClaimed).toBe(false);
    });
});
