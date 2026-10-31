// Unit tests for state.js reactive system
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Import the reactive state functions
import {
    subscribe,
    setState,
    getState,
    // Test with a few concrete state values
    currentView, setCurrentView,
    currentDetectedKey, setCurrentDetectedKey,
    currentSearchQuery, setCurrentSearchQuery,
    corpusLoadFailed, setCorpusLoadFailed,
    historyInitialized, setHistoryInitialized,
    bootRouteClaimed, setBootRouteClaimed, canRouteBootUrl,
    loadViewPrefs, chartCells, setChartCells, chartBars, setChartBars, chartOrder, setChartOrder,
    chartBeside, setChartBeside, autoHideControls, setAutoHideControls, abcScale, setAbcScale, tabScale, setTabScale, TAB_SCALE_KEY, tabBars, setTabBars, TAB_BARS_KEY,
    ABC_SCALE_KEY
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

describe('setCurrentDetectedKey', () => {
    afterEach(async () => {
        setCurrentDetectedKey(null);
        await flushRAF();
    });

    it('notifies subscribers when the key changes', async () => {
        const callback = vi.fn();
        const unsubscribe = subscribe('currentDetectedKey', callback);
        setCurrentDetectedKey('G');
        await flushRAF();
        unsubscribe();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith('G', 'currentDetectedKey');
    });

    it('is a no-op when the key is unchanged — nothing is notified', async () => {
        setCurrentDetectedKey('G');
        await flushRAF();

        const callback = vi.fn();
        const unsubscribe = subscribe('currentDetectedKey', callback);
        setCurrentDetectedKey('G');
        setCurrentDetectedKey('G');
        await flushRAF();
        unsubscribe();
        expect(callback).not.toHaveBeenCalled();
        expect(currentDetectedKey).toBe('G');
    });

    it('does not schedule a render frame for an unchanged key', async () => {
        setCurrentDetectedKey('D');
        await flushRAF();
        const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
        setCurrentDetectedKey('D');
        expect(raf).not.toHaveBeenCalled();
        raf.mockRestore();
    });

    it('still notifies for clearing the key and for setting it again', async () => {
        setCurrentDetectedKey('A');
        await flushRAF();
        const callback = vi.fn();
        const unsubscribe = subscribe('currentDetectedKey', callback);

        setCurrentDetectedKey(null);
        await flushRAF();
        setCurrentDetectedKey('A');
        await flushRAF();
        unsubscribe();
        expect(callback.mock.calls.map(c => c[0])).toEqual([null, 'A']);
    });

    it('coalesces an out-and-back within one frame into a single notification', async () => {
        setCurrentDetectedKey('E');
        await flushRAF();
        const callback = vi.fn();
        const unsubscribe = subscribe('currentDetectedKey', callback);

        // openWork clears the key, the render detects it again
        setCurrentDetectedKey(null);
        setCurrentDetectedKey('E');
        await flushRAF();
        unsubscribe();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith('E', 'currentDetectedKey');
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

describe('the song page\'s remembered choices (G19b)', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => {
        setChartCells(4); setChartBars(1); setChartOrder('once'); setChartBeside(true);
        setAutoHideControls(false); setAbcScale(1); setTabScale(1);
        localStorage.clear();
    });

    it('start where the mock draws them: 4 cells a row, one cell a bar, each section once, auto-hide off', () => {
        expect([chartCells, chartBars, chartOrder, chartBeside, autoHideControls])
            .toEqual([4, 1, 'once', true, false]);
    });

    it('persist in the view prefs and come back on load', () => {
        setChartCells(6); setChartBars(2); setChartOrder('sung'); setChartBeside(false); setAutoHideControls(true);
        setChartCells(4); setChartBars(1); setChartOrder('once'); setChartBeside(true); setAutoHideControls(false);
        localStorage.setItem('songbook-view-prefs', JSON.stringify(
            { chartCells: 6, chartBars: 2, chartOrder: 'sung', chartBeside: false, autoHideControls: true }));
        loadViewPrefs();
        expect([chartCells, chartBars, chartOrder, chartBeside, autoHideControls])
            .toEqual([6, 2, 'sung', false, true]);
    });

    it('ignore a value the page does not offer', () => {
        localStorage.setItem('songbook-view-prefs', JSON.stringify({ chartCells: 5, chartOrder: 'x', chartBars: 3 }));
        loadViewPrefs();
        expect([chartCells, chartBars, chartOrder]).toEqual([4, 1, 'once']);
    });

    it('keep the bars choice G18b2 stored under its own key', () => {
        localStorage.setItem('bgb-chart-bars', '2');
        loadViewPrefs();
        expect(chartBars).toBe(2);
    });

    it('give the notation its own remembered size, separate from the lyric text size', () => {
        setAbcScale(1.2);
        expect(localStorage.getItem(ABC_SCALE_KEY)).toBe('1.2');
        expect(JSON.parse(localStorage.getItem('songbook-view-prefs') || '{}').fontSizeLevel).toBeUndefined();
        setAbcScale(1);
        localStorage.setItem(ABC_SCALE_KEY, '1.4');
        loadViewPrefs();
        expect(abcScale).toBe(1.4);
        localStorage.setItem(ABC_SCALE_KEY, '9');
        loadViewPrefs();
        expect(abcScale).toBe(1.4);   // out of range: kept as it was
    });

    it('give the tab its own remembered size (G19c), separate from the text and the notation', () => {
        expect(tabScale).toBe(1);
        setTabScale(1.3);
        expect(localStorage.getItem(TAB_SCALE_KEY)).toBe('1.3');
        expect(localStorage.getItem(ABC_SCALE_KEY)).toBeNull();
        expect(JSON.parse(localStorage.getItem('songbook-view-prefs') || '{}').fontSizeLevel).toBeUndefined();
        setTabScale(1);
        localStorage.setItem(TAB_SCALE_KEY, '0.8');
        loadViewPrefs();
        expect(tabScale).toBe(0.8);
        localStorage.setItem(TAB_SCALE_KEY, '3');
        loadViewPrefs();
        expect(tabScale).toBe(0.8);   // out of range: kept as it was
    });

    describe('bars per row on a tab (G22)', () => {
        beforeEach(() => { sessionStorage.clear(); localStorage.removeItem(TAB_BARS_KEY); setTabBars('auto'); });
        afterEach(() => { sessionStorage.clear(); localStorage.removeItem(TAB_BARS_KEY); setTabBars('auto'); });

        it('is Auto until chosen, and keeps the latest choice in both stores', () => {
            sessionStorage.clear(); localStorage.removeItem(TAB_BARS_KEY);
            expect(tabBars).toBe('auto');
            setTabBars(3);
            expect(tabBars).toBe(3);
            expect(sessionStorage.getItem(TAB_BARS_KEY)).toBe('3');
            expect(localStorage.getItem(TAB_BARS_KEY)).toBe('3');
            setTabBars('auto');
            expect(sessionStorage.getItem(TAB_BARS_KEY)).toBe('auto');
            expect(localStorage.getItem(TAB_BARS_KEY)).toBe('auto');
            setTabBars(99);
            expect(tabBars).toBe(8);
            setTabBars(-4);
            expect(tabBars).toBe(1);
        });

        it('a window keeps its own choice over the latest anywhere', () => {
            sessionStorage.setItem(TAB_BARS_KEY, '2');
            localStorage.setItem(TAB_BARS_KEY, '6');
            loadViewPrefs();
            expect(tabBars).toBe(2);
        });

        it('a new window (empty sessionStorage) starts from the latest choice and keeps it', () => {
            sessionStorage.clear();
            localStorage.setItem(TAB_BARS_KEY, '6');
            loadViewPrefs();
            expect(tabBars).toBe(6);
            expect(sessionStorage.getItem(TAB_BARS_KEY)).toBe('6');
            localStorage.setItem(TAB_BARS_KEY, 'auto');   // another window changes it
            loadViewPrefs();
            expect(tabBars).toBe(6);                       // this one does not drift
        });

        it('ignores a bad value and the first build\'s offset key', () => {
            sessionStorage.clear();
            localStorage.setItem('bgb-tab-bars-offset', '3');
            localStorage.setItem(TAB_BARS_KEY, '40');
            loadViewPrefs();
            expect(tabBars).toBe('auto');
            setTabBars(2);
            expect(localStorage.getItem('bgb-tab-bars-offset')).toBeNull();
        });
    });
});
