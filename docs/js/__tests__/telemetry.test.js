// telemetry.js: only the production site, driven by a person, writes visit
// counts and analytics events. Everything else (local server, tailnet phone
// test, Playwright, headless crawlers) used to count as a new visitor per load.
import { describe, it, expect, beforeEach } from 'vitest';
import { telemetryEnabled, applyInternalParam, INTERNAL_KEY } from '../telemetry.js';

describe('telemetryEnabled', () => {
    it('is on for a person on the production site', () => {
        expect(telemetryEnabled({ hostname: 'bluegrassbook.com', webdriver: false })).toBe(true);
        expect(telemetryEnabled({ hostname: 'www.bluegrassbook.com', webdriver: false })).toBe(true);
    });

    it('is off for an automated browser, even on production', () => {
        expect(telemetryEnabled({ hostname: 'bluegrassbook.com', webdriver: true })).toBe(false);
    });

    it.each([
        'localhost',
        '127.0.0.1',
        '100.101.102.103',              // tailnet phone testing
        'mike-m4.tail1234.ts.net',
        'jollyhrothgar.github.io',
        'bluegrassbook.com.evil.example',
    ])('is off on %s', (hostname) => {
        expect(telemetryEnabled({ hostname, webdriver: false })).toBe(false);
    });

    it('reads the real page by default (jsdom is localhost)', () => {
        expect(telemetryEnabled()).toBe(false);
    });
});

describe('internal browsers', () => {
    const prod = { hostname: 'bluegrassbook.com', webdriver: false };

    beforeEach(() => localStorage.clear());

    it('is off on production in a browser marked internal', () => {
        localStorage.setItem(INTERNAL_KEY, '1');
        expect(telemetryEnabled(prod)).toBe(false);
        expect(telemetryEnabled({ ...prod, internal: false })).toBe(true);
    });

    function visit(href) {
        const calls = [];
        const history = { state: { songId: 'x' }, replaceState: (...a) => calls.push(a) };
        const result = applyInternalParam({ location: { href }, history, storage: localStorage });
        return { result, calls };
    }

    it('?internal=1 marks the browser and drops the parameter, keeping path, other params and hash', () => {
        const { result, calls } = visit('https://bluegrassbook.com/songs/tall-pines/?internal=1&x=2#search');
        expect(result).toBe(true);
        expect(localStorage.getItem(INTERNAL_KEY)).toBe('1');
        expect(calls).toEqual([[{ songId: 'x' }, '', '/songs/tall-pines/?x=2#search']]);
        expect(telemetryEnabled(prod)).toBe(false);
    });

    it('?internal=0 unmarks it', () => {
        localStorage.setItem(INTERNAL_KEY, '1');
        const { result, calls } = visit('https://bluegrassbook.com/?internal=0');
        expect(result).toBe(false);
        expect(localStorage.getItem(INTERNAL_KEY)).toBeNull();
        expect(calls[0][2]).toBe('/');
        expect(telemetryEnabled(prod)).toBe(true);
    });

    it.each(['https://bluegrassbook.com/#search', 'https://bluegrassbook.com/?internal=yes'])(
        'leaves %s alone', (href) => {
            const { result, calls } = visit(href);
            expect(result).toBeNull();
            expect(calls).toEqual([]);
            expect(localStorage.getItem(INTERNAL_KEY)).toBeNull();
        });
});
