// Regression tests for issue #210 — "Increasing font size when printing a
// whole list does nothing."
//
// The list print view is a separate document (window.open + document.write)
// with its own stylesheet, so it sizes song text in px while the app sizes it
// with the FONT_SIZES em multipliers. generatePrintListPage() used to collect
// fontSizeLevel into its prefs and then never read it, and the print document
// hardcoded 14px — two font-size scales with no connection between them.
//
// printFontPxForLevel() is the bridge. These lock down that it stays derived
// from FONT_SIZES rather than drifting into a third independent scale.
import { describe, it, expect } from 'vitest';

import {
    FONT_SIZES,
    printFontPxForLevel,
    PRINT_BASE_FONT_PX,
    PRINT_FONT_PX_MIN,
    PRINT_FONT_PX_MAX,
} from '../state.js';

describe('printFontPxForLevel', () => {
    it('maps the default level to the print base size', () => {
        // Level 0 is the 1.0 multiplier — print output must be unchanged for
        // everyone who never touched the font size control.
        expect(printFontPxForLevel(0)).toBe(PRINT_BASE_FONT_PX);
    });

    it('scales by the same multiplier the song page uses', () => {
        expect(printFontPxForLevel(6)).toBe(28);   // 14 * 2.0
        expect(printFontPxForLevel(3)).toBe(20);   // 14 * 1.4 = 19.6, rounded
        expect(printFontPxForLevel(-2)).toBe(11);  // 14 * 0.8 = 11.2, rounded
    });

    it('increases monotonically across the whole scale', () => {
        const levels = Object.keys(FONT_SIZES).map(Number).sort((a, b) => a - b);
        const sizes = levels.map(printFontPxForLevel);
        for (let i = 1; i < sizes.length; i++) {
            expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
        }
    });

    it('clamps to the bounds of the print view size input', () => {
        // 14 * 0.5 = 7, below the input's min of 8.
        expect(printFontPxForLevel(-5)).toBe(PRINT_FONT_PX_MIN);

        for (const level of Object.keys(FONT_SIZES)) {
            const px = printFontPxForLevel(level);
            expect(px).toBeGreaterThanOrEqual(PRINT_FONT_PX_MIN);
            expect(px).toBeLessThanOrEqual(PRINT_FONT_PX_MAX);
        }
    });

    it('accepts string keys, since prefs round-trip through JSON', () => {
        // View prefs are persisted to localStorage, so the level can come back
        // as either a number or a string depending on the write path.
        expect(printFontPxForLevel('6')).toBe(printFontPxForLevel(6));
        expect(printFontPxForLevel('0')).toBe(printFontPxForLevel(0));
    });

    it('falls back to the base size for an unknown level', () => {
        // Never return NaN into a CSS custom property — that would silently
        // drop the rule and take the print view back to unstyled text.
        expect(printFontPxForLevel(undefined)).toBe(PRINT_BASE_FONT_PX);
        expect(printFontPxForLevel(null)).toBe(PRINT_BASE_FONT_PX);
        expect(printFontPxForLevel(999)).toBe(PRINT_BASE_FONT_PX);
    });
});
