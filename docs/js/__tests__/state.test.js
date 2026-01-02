// Unit tests for state.js reactive system
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Import the reactive state functions
import {
    subscribe,
    setState,
    getState,
    // Test with a few concrete state values
    currentView, setCurrentView,
    sidebarOpen, setSidebarOpen,
    currentSearchQuery, setCurrentSearchQuery
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
        setCurrentView('search');
        setSidebarOpen(false);
        setCurrentSearchQuery('');
        await flushRAF();
    });

    describe('getState', () => {
        it('returns specific state value when key provided', () => {
            expect(getState('currentView')).toBe('search');
            expect(getState('sidebarOpen')).toBe(false);
        });

        it('returns state snapshot when no key provided', () => {
            const snapshot = getState();
            expect(snapshot).toHaveProperty('currentView');
            expect(snapshot).toHaveProperty('sidebarOpen');
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

            setSidebarOpen(true);
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
            const sidebarCallback = vi.fn();

            subscribe('currentView', viewCallback);
            subscribe('sidebarOpen', sidebarCallback);

            setState({
                currentView: 'song',
                sidebarOpen: true
            });
            await flushRAF();

            expect(viewCallback).toHaveBeenCalledWith('song', 'currentView');
            expect(sidebarCallback).toHaveBeenCalledWith(true, 'sidebarOpen');
        });

        it('does not notify if value unchanged', async () => {
            const callback = vi.fn();
            subscribe('currentView', callback);

            // Set to same value
            setState({ currentView: 'search' });
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

        it('setSidebarOpen triggers subscribers', async () => {
            const callback = vi.fn();
            subscribe('sidebarOpen', callback);

            setSidebarOpen(true);
            await flushRAF();

            expect(callback).toHaveBeenCalledWith(true, 'sidebarOpen');
        });
    });
});

describe('State Values', () => {
    it('currentView defaults to search', () => {
        expect(getState('currentView')).toBe('search');
    });

    it('sidebarOpen defaults to false', () => {
        expect(getState('sidebarOpen')).toBe(false);
    });

    it('currentSearchQuery defaults to empty string', () => {
        expect(getState('currentSearchQuery')).toBe('');
    });
});
