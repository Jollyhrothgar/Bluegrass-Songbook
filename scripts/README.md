# Scripts

| Script | What it does |
|--------|--------------|
| `bootstrap` | Install Python (uv) and JS (npm) deps, then build `docs/data/` from `works/`. `--quick` skips the installs. Safe to re-run. |
| `server [port]` | Serve `docs/` (default 8080; walks to 8090 if busy; `--exact` fails instead; `--cleanup` stops them all). |
| `utility <command>` | About 30 maintenance commands. `./scripts/utility help` is the list. |
| `chrome` | Open a debugging Chrome (port 9222) with a saved login, for the Chrome DevTools MCP. |
| `vendor-codemirror`, `vendor-hyphenation` | Rebuild the vendored bundles in `docs/vendor/`. |
| `build-syllable-corpus` | Rebuild the syllable corpus the visual editor's tests read. |

Python implementations live in `scripts/lib/`; `scripts/lib/CLAUDE.md`
describes the build pipeline. Sources that still have their own tooling keep
it in `sources/<source>/scripts/`.
