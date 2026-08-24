// "Everything a human can do must be reachable by Playwright against a
// mocked backend."  A `window.prompt` / `confirm` / `alert` breaks that rule
// by construction: the browser draws those itself, so they are not in the
// DOM, not in the theme, not reachable by a screen reader's review cursor,
// and not clickable by a test — a spec can only `page.on('dialog')` and
// hope. On iOS they also take focus in a way the tab editor never gets back.
//
// So the tab-authoring surfaces are held to "no native dialogs" by a source
// scan. It is a lint, not a behaviour test: the behaviour tests live beside
// the popovers and in e2e/otf-editor*.spec.js. This one exists to stop the
// next `confirm()` from being merged, since nothing else would notice.
//
// Deliberately NOT the whole of docs/js: lists.js, main.js, review-queue.js
// and visual-editor.js still use native dialogs, and converting them is a
// separate job with its own e2e specs to update (arrangement-pill.spec.js
// and list-management.spec.js currently drive `page.on('dialog')`).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const jsDir = resolve(__dirname, '..');

/**
 * Source with comments removed, so prose ABOUT native dialogs (this rule is
 * worth explaining where it is enforced) never trips the scan.
 *
 * Naive but sufficient for this corpus: block comments go first, then a
 * `//` run to end-of-line whenever the text before it has balanced quotes
 * (which keeps `'https://…'` and a regex's `//` out of the crosshairs).
 */
export function stripComments(source) {
    const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '');
    return noBlocks.split('\n').map((line) => {
        for (let i = 0; i < line.length - 1; i++) {
            if (line[i] !== '/' || line[i + 1] !== '/') continue;
            const before = line.slice(0, i);
            const balanced = (ch) => (before.split(ch).length - 1) % 2 === 0;
            if (balanced("'") && balanced('"') && balanced('`')) return before;
        }
        return line;
    }).join('\n');
}

// `window.confirm(` / `globalThis.alert(` / a bare `prompt(`. The bare form
// needs the lookbehind: `promptInstall(` and `deferred.prompt()` are both
// legitimate and neither is a dialog.
const NATIVE_DIALOG = new RegExp(
    '(?:'
    + '\\b(?:window|globalThis|self)\\s*\\??\\.\\s*(prompt|confirm|alert)'
    + '|(?<![\\w.$])(prompt|confirm|alert)'
    + ')\\s*\\(', 'g');

/** Every native-dialog call site in a source string, as `name` + line. */
function findDialogs(source) {
    const clean = stripComments(source);
    const hits = [];
    for (const match of clean.matchAll(NATIVE_DIALOG)) {
        const line = clean.slice(0, match.index).split('\n').length;
        hits.push(`${match[1] || match[2]}() at line ${line}`);
    }
    return hits;
}

/** The tab-authoring surfaces, as {label, source} pairs. */
function surfaces() {
    const files = [];

    const editorDir = resolve(jsDir, 'otf-editor');
    for (const name of readdirSync(editorDir).filter(f => f.endsWith('.js'))) {
        files.push({
            label: `otf-editor/${name}`,
            source: readFileSync(resolve(editorDir, name), 'utf-8'),
        });
    }

    for (const name of ['tab-edit-band.js', 'tab-controls-sheet.js',
        'drafts-view.js', 'drafts.js', 'pwa.js']) {
        files.push({
            label: name,
            source: readFileSync(resolve(jsDir, name), 'utf-8'),
        });
    }

    // work-view.js is the song page — most of it is reading, not tabbing.
    // The tab code is its tail, from the .tef picker onwards; the anchor is
    // asserted below so a rename fails loudly instead of silently scanning
    // nothing.
    const workView = readFileSync(resolve(jsDir, 'work-view.js'), 'utf-8');
    const start = workView.indexOf('export async function pickTefFile');
    files.push({
        label: 'work-view.js (tab paths)',
        source: start === -1 ? workView : workView.slice(start),
        anchor: start,
    });

    return files;
}

describe('no native dialogs in the tab editor', () => {
    const files = surfaces();

    it('scans the work-view tab section, not an empty string', () => {
        const workView = files.find(f => f.label.startsWith('work-view'));
        expect(workView.anchor).toBeGreaterThan(0);
        expect(workView.source).toContain('mountTabEditor');
    });

    for (const { label, source } of files) {
        it(`${label} calls no window.prompt / confirm / alert`, () => {
            expect(findDialogs(source)).toEqual([]);
        });
    }

    it('the scan actually catches a native dialog', () => {
        expect(findDialogs('if (window.confirm("go?")) go();'))
            .toEqual(['confirm() at line 1']);
        expect(findDialogs('const name = prompt("Name:");'))
            .toEqual(['prompt() at line 1']);
        expect(findDialogs('globalThis.alert("hi");'))
            .toEqual(['alert() at line 1']);
    });

    it('the scan ignores prose and lookalike identifiers', () => {
        expect(findDialogs('// never call window.confirm() here')).toEqual([]);
        expect(findDialogs('/** not `window.prompt()` */')).toEqual([]);
        expect(findDialogs('await deferred.prompt();')).toEqual([]);
        expect(findDialogs('export function promptInstall() {}')).toEqual([]);
        expect(findDialogs('this.valuePopover.open({});')).toEqual([]);
    });
});
