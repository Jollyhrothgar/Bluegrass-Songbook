// Unit tests read pinned copies (fixtures/), never the live song store.
//
// Anyone can edit or delete a song in the app, and the edit lands in works/
// as a bot commit. A test that read works/old-home-place/ failed the moment
// that song was edited (2026-10-28), and a failing test on main blocks every
// deploy. So this scans the test sources and fails if one reaches into works/
// again: copy what the test needs into fixtures/ instead.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TESTS = resolve(process.cwd(), 'docs/js/__tests__');

// A string literal that names the works/ directory: 'works/…', '../../works', `works`
const LIVE = /(['"`])(?:\.\.\/)*works(?:\/|\1)/;

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name === 'fixtures' || name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (name.endsWith('.js')) out.push(full);
    }
    return out;
}

describe('unit tests never read the live song store', () => {
    it('no test opens a file under works/', () => {
        const hits = [];
        for (const file of walk(TESTS)) {
            if (file.endsWith('no-live-corpus.test.js')) continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                const code = line.trim();
                if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
                if (code.endsWith('// not a file read')) return;   // a path a test checks for, never opens
                if (LIVE.test(code)) hits.push(`${file.slice(TESTS.length + 1)}:${i + 1}: ${code}`);
            });
        }
        expect(hits).toEqual([]);
    });

    it('catches the forms a test would use', () => {
        for (const reach of [
            "readFileSync('works/old-home-place/lead-sheet.pro')",
            "path.join(REPO_ROOT, 'works/cripple-creek/banjo.otf.json')",
            "path.resolve(__dirname, '../../../works')",
            "path.join(dir, 'works')",
        ]) expect(reach, reach).toMatch(LIVE);
        expect("readFileSync('fixtures/old-home-place.pro')").not.toMatch(LIVE);
        expect("const label = 'network works/fine'").not.toMatch(LIVE);
    });
});
