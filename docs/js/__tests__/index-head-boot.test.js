// index.html <head>: theme before paint, deferred SDKs, no eager abcjs (perf B4/B5).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'docs/index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));

describe('index.html head', () => {
    it('defers supabase-js and supabase-auth.js, and does not load abcjs eagerly', () => {
        expect(head).toMatch(/<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2">/);
        expect(html).toMatch(/<script defer src="js\/supabase-auth\.js">/);
        expect(html).not.toMatch(/<script[^>]*abcjs/);
    });

    it('supabase-js precedes supabase-auth.js, both before main.js', () => {
        const a = html.indexOf('supabase-js@2');
        const b = html.indexOf('<script defer src="js/supabase-auth.js">');
        const c = html.indexOf('<script type="module" src="js/main.js">');
        expect(a).toBeLessThan(b);
        expect(b).toBeLessThan(c);
    });

    it('preconnects to jsdelivr and supabase', () => {
        expect(head).toContain('rel="preconnect" href="https://cdn.jsdelivr.net"');
        expect(head).toContain('rel="preconnect" href="https://ofmqlrnyldlmvggihogt.supabase.co"');
    });

    describe('inline theme script', () => {
        const src = head.match(/\(function \(\) \{\s*var t = null;[\s\S]*?\}\)\(\);/)[0];
        const run = (saved, osDark) => {
            document.head.innerHTML = '<meta name="theme-color" content="#fafafa">';
            document.documentElement.removeAttribute('data-theme');
            localStorage.clear();
            if (saved) localStorage.setItem('theme', saved);
            window.matchMedia = () => ({ matches: osDark });
            new Function(src)();
            return [
                document.documentElement.getAttribute('data-theme'),
                document.querySelector('meta[name="theme-color"]').getAttribute('content'),
            ];
        };
        it('uses the OS preference with no saved choice', () => {
            expect(run(null, true)).toEqual(['dark', '#000000']);
            expect(run(null, false)).toEqual(['light', '#fafafa']);
        });
        it('lets the saved choice win over the OS', () => {
            expect(run('light', true)).toEqual(['light', '#fafafa']);
            expect(run('dark', false)).toEqual(['dark', '#000000']);
        });
        it('ignores junk saved values', () => {
            expect(run('banana', true)).toEqual(['dark', '#000000']);
        });
    });
});
