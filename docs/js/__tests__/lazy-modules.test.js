// The boot graph is a budget, and this is where it is enforced (B7a).
//
// index.html loads js/main.js; everything main.js imports STATICALLY arrives
// before the app can paint. Route-specific code (the song editor, the tab
// renderer and player, the bounty board, the review queue, ...) is reached
// with import() at the point of use instead. Nothing about the browser stops
// someone adding `import { x } from './editor.js'` back to main.js and
// silently putting ~700 KB back on every cold load — so a source scan does.
//
// It also keeps the two lists that have to mirror the graph honest:
//   - the <link rel="modulepreload"> tags in index.html (the boot graph), and
//   - the service worker's lazy-module precache (everything else), so
//     offline still works for code that is only fetched on demand.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, relative } from 'path';

import { PRECACHE_URLS } from '../sw-strategy.js';
import { LAZY_MODULE_URLS } from '../lazy-modules.js';

const jsDir = resolve(__dirname, '..');
const docsDir = resolve(jsDir, '..');
const ENTRY = resolve(jsDir, 'main.js');

/** Source without comments, so prose about an import never counts as one. */
function code(file) {
    return readFileSync(file, 'utf8')
        .replace(/^\s*\/\/.*$/gm, '')          // whole-line comments first: a `visual-editor/*` in one must not open a block comment
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Relative import specifiers of a module: { static: [...], dynamic: [...] }. */
function imports(file) {
    const src = code(file);
    const resolveSpec = (spec) => (spec.startsWith('.') ? resolve(dirname(file), spec) : null);
    const statics = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/gm),
        ...src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)]
        .map(m => resolveSpec(m[1])).filter(Boolean);
    const dynamic = [...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)]
        .map(m => resolveSpec(m[1])).filter(Boolean);
    return { static: statics, dynamic };
}

/** Every module reachable from `entry`; dynamic edges only when asked. */
function closure(entry, { dynamic = false } = {}) {
    const seen = new Set();
    const visit = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        const edges = imports(file);
        for (const dep of edges.static) visit(dep);
        if (dynamic) for (const dep of edges.dynamic) visit(dep);
    };
    visit(entry);
    return seen;
}

const rel = (file) => relative(jsDir, file);
const boot = closure(ENTRY);
const everything = closure(ENTRY, { dynamic: true });
const lazy = [...everything].filter(f => !boot.has(f));

describe('boot graph (static imports from main.js)', () => {
    const MUST_BE_LAZY = [
        // the song editor and everything only it uses
        'editor.js', 'smart-paste.js', 'dedup-check.js',
        'visual-editor/preview.js', 'visual-editor/model.js', 'chord-explorer/theory.js',
        // the tab editor's engine, and the tab drawing/playback modules
        'otf-editor/editor.js', 'otf-editor/state.js', 'otf-editor/facade.js',
        'otf-editor/cursor.js', 'otf-editor/actions.js', 'otf-editor/work-edit.js',
        'renderers/tablature.js', 'renderers/tab-player.js', 'renderers/tab-ascii.js',
        'renderers/index.js', 'audio-unlock.js',
        'tab-edit-band.js', 'tab-controls-sheet.js', 'tab-playback-interactions.js',
        // whole-page views and one-shot actions
        'review-queue.js', 'bounty-view.js', 'my-submissions.js', 'high-scores.js',
        'drafts-view.js', 'list-export.js', 'zip.js', 'title-match.js',
    ];

    it.each(MUST_BE_LAZY)('does not load %s at boot', (name) => {
        expect(boot.has(resolve(jsDir, name))).toBe(false);
    });

    it('still reaches each of them on demand', () => {
        for (const name of MUST_BE_LAZY) {
            // the registry (and tab-ascii, which only it imports) is not
            // reached by the app any more — tests and tooling use it
            if (name === 'renderers/index.js' || name === 'renderers/tab-ascii.js') continue;
            expect(everything.has(resolve(jsDir, name)), name).toBe(true);
        }
    });

    it('keeps the modules the first paint needs', () => {
        for (const name of ['state.js', 'search-core.js', 'work-view.js', 'song-view.js',
            'lists.js', 'renderers/chordpro.js', 'otf-editor/create-tab-entry.js']) {
            expect(boot.has(resolve(jsDir, name)), name).toBe(true);
        }
    });

    it('stays small: no more boot modules than today plus a little headroom', () => {
        // 33 when this landed (was 65). Raising this number is a decision to
        // make a cold load slower — say why in the commit.
        expect(boot.size).toBeLessThanOrEqual(36);
    });
});

describe('reading-view tab playback does not pull in the editor', () => {
    it('tab-playback-interactions.js has no otf-editor/ in its static closure', () => {
        const closureOf = closure(resolve(jsDir, 'tab-playback-interactions.js'));
        expect([...closureOf].map(rel).filter(f => f.startsWith('otf-editor/'))).toEqual([]);
    });

    it('create-tab.js (new-take scaffolding on the song page) does not either', () => {
        const closureOf = closure(resolve(jsDir, 'otf-editor/create-tab.js'));
        expect([...closureOf].map(rel).filter(f => f !== 'otf-editor/create-tab.js'
            && f !== 'otf-editor/new-otf.js')).toEqual([]);
    });

    it('the editor still gets positionFromSvgPoint from its own cursor module', () => {
        const editor = code(resolve(jsDir, 'otf-editor/editor.js'));
        expect(editor).toMatch(/positionFromSvgPoint[\s\S]*from '\.\/cursor\.js'/);
    });
});

describe('dynamic import() targets', () => {
    it('every import() in the app resolves to a file that exists', () => {
        const missing = [];
        for (const file of everything) {
            for (const dep of imports(file).dynamic) {
                if (!existsSync(dep)) missing.push(`${rel(file)} -> ${dep}`);
            }
        }
        expect(missing).toEqual([]);
    });
});

describe('index.html modulepreload', () => {
    const html = readFileSync(resolve(docsDir, 'index.html'), 'utf8');
    const links = [...html.matchAll(/<link\s+rel="modulepreload"\s+href="([^"]+)"\s*\/?>/g)].map(m => m[1]);

    it('preloads exactly the boot graph (minus main.js, which has its own script tag)', () => {
        const want = [...boot].filter(f => f !== ENTRY).map(f => `js/${rel(f)}`).sort();
        expect([...links].sort()).toEqual(want);
    });

    it('sits immediately before the main.js script tag', () => {
        const scriptAt = html.indexOf('<script type="module" src="js/main.js">');
        expect(scriptAt).toBeGreaterThan(-1);
        const before = html.slice(0, scriptAt);
        const lastLink = before.lastIndexOf('<link rel="modulepreload"');
        expect(lastLink).toBeGreaterThan(-1);
        // nothing but whitespace and comments between the last link and the script
        const between = before.slice(before.indexOf('>', lastLink) + 1)
            .replace(/<!--[\s\S]*?-->/g, '').trim();
        expect(between).toBe('');
    });

    it('lists each module once', () => {
        expect(new Set(links).size).toBe(links.length);
    });
});

describe('service worker precache covers the lazily loaded modules', () => {
    it('precaches every module that is not in the boot graph', () => {
        const want = lazy.map(f => `./js/${rel(f)}`).sort();
        expect([...LAZY_MODULE_URLS].sort()).toEqual(want);
    });

    it('PRECACHE_URLS includes them all, and no boot module', () => {
        for (const url of LAZY_MODULE_URLS) expect(PRECACHE_URLS).toContain(url);
        const bootUrls = new Set([...boot].map(f => `./js/${rel(f)}`));
        expect(PRECACHE_URLS.filter(u => bootUrls.has(u))).toEqual([]);
    });

    it('every precached path exists', () => {
        for (const url of PRECACHE_URLS) {
            expect(existsSync(resolve(docsDir, url)) || url === './', url).toBe(true);
        }
    });
});
