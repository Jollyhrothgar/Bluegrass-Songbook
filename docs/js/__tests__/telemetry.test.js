// telemetry.js: only the production site, driven by a person, writes visit
// counts and analytics events. Everything else (local server, tailnet phone
// test, Playwright, headless crawlers) used to count as a new visitor per load.
import { describe, it, expect } from 'vitest';
import { telemetryEnabled } from '../telemetry.js';

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
