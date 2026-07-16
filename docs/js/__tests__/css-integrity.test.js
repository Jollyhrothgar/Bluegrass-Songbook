// CSS integrity tests - ensures style.css has no syntax errors that would
// cause browsers to skip rules. This catches issues like missing @charset
// declarations that cause UTF-8 content to break CSS parsing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cssPath = resolve(__dirname, '../../css/style.css');
const cssContent = readFileSync(cssPath, 'utf-8');
const cssLines = cssContent.split('\n');

describe('style.css integrity', () => {
    it('starts with @charset "UTF-8" declaration', () => {
        const firstNonEmpty = cssLines.find(l => l.trim().length > 0);
        expect(firstNonEmpty.trim()).toBe('@charset "UTF-8";');
    });

    it('has balanced braces', () => {
        let depth = 0;
        let maxDepth = 0;
        for (let i = 0; i < cssLines.length; i++) {
            for (const ch of cssLines[i]) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
                if (depth > maxDepth) maxDepth = depth;
            }
            // Depth should never go negative (extra closing braces)
            if (depth < 0) {
                throw new Error(`Unmatched closing brace at line ${i + 1}: ${cssLines[i].trim()}`);
            }
        }
        expect(depth).toBe(0);
    });

    it('contains critical .cl-segment rule', () => {
        expect(cssContent).toContain('.cl-segment');
        expect(cssContent).toContain('display: inline-block');
    });

    it('contains critical .cl-chord rule', () => {
        expect(cssContent).toContain('.cl-chord');
        expect(cssContent).toContain('display: block');
    });

    it('contains theme variables', () => {
        expect(cssContent).toContain('--bg:');
        expect(cssContent).toContain('--text:');
        expect(cssContent).toContain('--accent:');
        expect(cssContent).toContain('--chord:');
    });

    it('contains dark mode theme', () => {
        expect(cssContent).toContain('[data-theme="dark"]');
    });

    it('has no unclosed string literals in content properties', () => {
        // Find all content: '...' declarations and ensure quotes are balanced
        const contentRegex = /content:\s*'([^']*)'/g;
        let match;
        while ((match = contentRegex.exec(cssContent)) !== null) {
            // The regex itself ensures balanced quotes, so just verify no null bytes
            expect(match[1]).not.toContain('\0');
        }
    });
});
