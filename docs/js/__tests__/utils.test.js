// Unit tests for utils.js
import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeRegex, highlightMatch } from '../utils.js';

describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        expect(escapeHtml('a & b')).toBe('a &amp; b');
        // DOM-based escaping doesn't escape quotes (not needed outside attributes)
        expect(escapeHtml('"quoted"')).toBe('"quoted"');
    });

    it('returns plain text unchanged', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });
});

describe('escapeRegex', () => {
    it('escapes regex special characters', () => {
        expect(escapeRegex('a.b')).toBe('a\\.b');
        expect(escapeRegex('a*b')).toBe('a\\*b');
        expect(escapeRegex('a+b')).toBe('a\\+b');
        expect(escapeRegex('a?b')).toBe('a\\?b');
        expect(escapeRegex('a[b]c')).toBe('a\\[b\\]c');
    });

    it('returns plain text unchanged', () => {
        expect(escapeRegex('hello world')).toBe('hello world');
    });
});

describe('highlightMatch', () => {
    it('highlights single term', () => {
        expect(highlightMatch('Hello World', 'world')).toBe('Hello <mark>World</mark>');
    });

    it('highlights multiple occurrences', () => {
        expect(highlightMatch('one two one', 'one')).toBe('<mark>one</mark> two <mark>one</mark>');
    });

    it('case insensitive matching', () => {
        expect(highlightMatch('HELLO hello Hello', 'hello')).toBe(
            '<mark>HELLO</mark> <mark>hello</mark> <mark>Hello</mark>'
        );
    });

    it('highlights multiple terms', () => {
        expect(highlightMatch('red blue green', 'red green')).toBe(
            '<mark>red</mark> blue <mark>green</mark>'
        );
    });

    it('escapes HTML in text', () => {
        expect(highlightMatch('<b>bold</b>', 'bold')).toBe(
            '&lt;b&gt;<mark>bold</mark>&lt;/b&gt;'
        );
    });

    it('returns escaped text when query is empty', () => {
        expect(highlightMatch('<script>', '')).toBe('&lt;script&gt;');
    });

    it('returns escaped text when no matches', () => {
        expect(highlightMatch('hello world', 'xyz')).toBe('hello world');
    });

    it('merges overlapping matches', () => {
        // 'on' matches 'on' and 'one' also matches 'on'
        const result = highlightMatch('one two', 'on one');
        expect(result).toBe('<mark>one</mark> two');
    });

    it('merges adjacent matches into single highlight', () => {
        // Adjacent matches get merged into one continuous highlight
        expect(highlightMatch('ab', 'a b')).toBe('<mark>ab</mark>');
    });

    // Regression test: searching for terms containing "m", "a", "r", or "k"
    // used to corrupt the <mark> tags added by previous term replacements.
    // The bug caused output like "Sark>onark>s" instead of "S<mark>on</mark>s"
    describe('mark tag corruption bug (regression)', () => {
        // Helper to verify HTML is well-formed and content is preserved
        function assertValidHighlight(result, originalText) {
            // Balanced mark tags
            const markCount = (result.match(/<mark>/g) || []).length;
            const closeMarkCount = (result.match(/<\/mark>/g) || []).length;
            expect(markCount).toBe(closeMarkCount);

            // No malformed tags (doubled angle brackets from nested replacements)
            expect(result).not.toContain('<<');
            expect(result).not.toContain('>>');

            // Original text content preserved (after stripping tags)
            const stripped = result.replace(/<\/?mark>/g, '');
            expect(stripped).toBe(originalText);
        }

        it('does not corrupt when searching for "m"', () => {
            const result = highlightMatch('Sons of the Pioneers', 'on m');
            assertValidHighlight(result, 'Sons of the Pioneers');
            expect(result).toContain('<mark>');
        });

        it('does not corrupt when searching for "mark"', () => {
            const result = highlightMatch('Hello Mark', 'mark');
            expect(result).toBe('Hello <mark>Mark</mark>');
        });

        it('does not corrupt when searching for "a" with other terms', () => {
            const result = highlightMatch('When The Bloom Is On The Sage', 'on a');
            assertValidHighlight(result, 'When The Bloom Is On The Sage');
        });

        it('handles all letters in "mark" as search terms', () => {
            // This would maximally corrupt the old implementation
            const result = highlightMatch('Sample Text', 'm a r k');
            assertValidHighlight(result, 'Sample Text');
        });

        it('the exact bug case from issue report', () => {
            // Original bug: searching "on m" turned
            // "When The Bloom Is On The Sage" into "When The Bloom Is ark>Onark> The Sage"
            const result = highlightMatch('When The Bloom Is On The Sage', 'on m');
            assertValidHighlight(result, 'When The Bloom Is On The Sage');
            // "On" should be properly highlighted
            expect(result).toContain('<mark>On</mark>');
        });

        it('preserves original text content when highlighting', () => {
            const result = highlightMatch('Sons of the Pioneers', 'on');
            const stripped = result.replace(/<\/?mark>/g, '');
            expect(stripped).toBe('Sons of the Pioneers');
        });
    });
});
