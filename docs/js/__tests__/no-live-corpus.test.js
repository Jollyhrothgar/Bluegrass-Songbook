// A test of the code reads a frozen copy of a song (fixtures/), never the
// live one: anyone can edit or delete a song in the app, the edit lands in
// works/ as a bot commit, and a test that read works/old-home-place/ failed
// the moment that song was edited (2026-10-28), blocking every deploy.
//
// The rule (Mike, 2026-10-28; docs/js/CLAUDE.md, .claude/rules/tests.md): a
// test may read live works only to catch problems in that data, a smoke test
// such as "a real tab renders end to end" or a sweep of the whole corpus. So
// this flags a path to one particular song's file; a deliberate smoke test
// ends that line with `// live smoke test`, and a line that only names a path
// it never opens ends with `// not a file read`.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TESTS = resolve(process.cwd(), 'docs/js/__tests__');

// A string literal naming one song's file under works/: 'works/<slug>/…', '../../works/<slug>/…'
const LIVE = /(['"`])(?:\.\.\/)*works\/[^'"`/]+\//;

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

describe("unit tests don't read a live song", () => {
    it('no test opens one song from works/ unless it is a marked smoke test', () => {
        const hits = [];
        for (const file of walk(TESTS)) {
            if (file.endsWith('no-live-corpus.test.js')) continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                const code = line.trim();
                if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
                if (code.endsWith('// not a file read')) return;   // a path a test checks for, never opens
                if (code.endsWith('// live smoke test')) return;   // catches problems in the real data, on purpose
                if (LIVE.test(code)) hits.push(`${file.slice(TESTS.length + 1)}:${i + 1}: ${code}`);
            });
        }
        expect(hits).toEqual([]);
    });

    it('catches the forms a test would use', () => {
        for (const reach of [
            "readFileSync('works/old-home-place/lead-sheet.pro')",
            "path.join(REPO_ROOT, 'works/cripple-creek/banjo.otf.json')",
            "path.join(here, '../../../../works/red-haired-boy/ensemble.otf.json')",
        ]) expect(reach, reach).toMatch(LIVE);
        // A sweep of the whole corpus, or finding the repo root, names no one song
        expect("path.resolve(__dirname, '../../../works')").not.toMatch(LIVE);
        expect("path.join(dir, 'works')").not.toMatch(LIVE);
        expect("readFileSync('fixtures/old-home-place.pro')").not.toMatch(LIVE);
    });
});
