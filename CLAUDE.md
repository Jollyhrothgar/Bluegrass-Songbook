# Bluegrass Songbook

A bluegrass jam songbook at [bluegrassbook.com](https://bluegrassbook.com): a
curated, searchable index of a few thousand songs, backed by an archive of
19,000+ works that still resolve by URL. The frontend in `docs/` is static
ES modules with no build step, served by GitHub Pages. Song data lives in
`works/`; accounts, lists and votes live in Supabase. Mike owns the project;
"Mike" below means the person you take instructions from.

## Commands

| Task | Command |
|------|---------|
| Set up a worktree (deps + index, ~25 s) | `./scripts/bootstrap` |
| Rebuild `docs/data/` from `works/` | `./scripts/bootstrap --quick` |
| Dev server (walks 8080–8090; `--exact` pins the port) | `./scripts/server [port]` |
| Unit tests (Vitest) | `npm test`; one file: `npx vitest run docs/js/__tests__/<file>` |
| Python tests | `uv run pytest`; one file: `uv run pytest tests/<file> -q` |
| E2E (Playwright, own server on 8137) | `npm run test:e2e`; one spec: `npx playwright test e2e/<spec>` |
| Every CLI subcommand | `./scripts/utility help` |

Run Python through `uv run`. Corpus sizes drift, so count them instead of
quoting this file: `ls works | wc -l` (all works), and after a build
`wc -l docs/data/index.jsonl` (searchable) and `docs/data/archive.jsonl`
(archived). On 2026-10-28: 19,246 / 2,589 / 16,651.

## Workflow: one worktree per change

Mike uses paseo, a tool that runs several coding agents at once, each in its
own git worktree off `main` (`~/.paseo/worktrees/<project>/<name>/`).

1. **Setup.** Paseo runs `./scripts/bootstrap` when it creates the worktree,
   as `paseo.json` says. Paseo reads that file from `main`, not from your
   branch. If `.venv`, `node_modules` or `docs/data/index.jsonl` is missing,
   run it yourself.
2. **Pick the work.** The backlog, called the fix-it list, is
   `docs/plans/2026-09-30-fix-it-list.md`. Read its Status table before
   proposing work.
3. **Branch.** `feature/<name>`, `bug/<name>` or `docs/<name>`. When the work
   has a fix-it ID (a letter and a number, such as `G14`), start commit
   subjects with it: `G14: ...`.
4. **Build and check.** Keep it simple (DRY, KISS, no speculative
   generality). Write the test first, especially for parser changes. Before a
   PR, run `npm test`, `uv run pytest`, and the E2E specs that cover any UI
   you touched.
5. **PR.** `gh pr create --base main`. Name the fix-it IDs in the body and
   update their Status rows in the same PR.
6. **Merge** with a merge commit, never a squash, so each item stays
   bisectable and revertable: `gh pr merge <n> --merge --delete-branch`.
   CI deploys `main` only when its tests pass (`build.yml`).

Parallel worktrees share some things:

- **Ports.** The `web` service in `paseo.json`, started from paseo, serves
  this worktree on its own port with a proxy URL. E2E binds 8137 exactly, so
  it fails fast while another worktree is running E2E. Then use
  `PW_PORT=<port> npm run test:e2e` with a port nothing is listening on:
  with `PW_PORT` set, Playwright tests whatever server already holds that
  port instead of starting its own.
- **The git stash** is shared by every worktree. Set work aside with a WIP
  commit instead.
- **`main` is protected** (ruleset "Protect main"): force pushes and branch
  deletion are rejected for everyone.

Without paseo: `cd <container>/.bare && git worktree add ../<dir> -b <branch> main`,
then `./scripts/bootstrap` in the new directory.

## Rules

- **Paid APIs need an explicit yes.** Before any paid call (Anthropic batch
  tagging, or any other paid service), show the cost estimate with its
  breakdown (token counts, rates, total), let Mike check the arithmetic, and
  wait for a clear "yes". Never auto-submit.
- **Research, then confirm the plan with Mike before changing code.** Ask
  yourself: can this corrupt the search index? Does it behave the same in the
  local long build (which has MusicBrainz and other local-only inputs; see
  "Local vs CI Operations" in `scripts/lib/CLAUDE.md`) and in GitHub Actions?
  Do the workflows still do what Mike intends for the live site?
- **Triage a complaint before fixing it.** When Mike says something looks
  wrong, when data surprises you, or when you are tempted to add a special
  case, dispatch the `triage` agent before writing a fix. It labels each fix
  ROOT FIX, BANDAID or WORKAROUND. The pipelines are layered (TEF → OTF →
  renderer; ChordPro → works → index → UI), so a display symptom often has a
  parser or data cause. A bandaid tracked in an issue is fine; an untracked
  one is not.
- **`works/` is authoritative.** Fix song metadata in `works/*/work.yaml`,
  never by regenerating from `sources/`. The full rules load from
  `.claude/rules/works.md` when you touch `works/`.
- **Never write secrets to disk.** `.env.tpl` holds 1Password `op://`
  references; `scripts/lib/with-secrets` injects the values per command, and
  `./scripts/utility` already uses it. Keep the 1Password app unlocked. Don't
  check sign-in with `op whoami`: under the app integration it says "not
  signed in" even when reads work. Details: "Secrets" in
  `scripts/lib/CLAUDE.md`.
- **Generated data is not tracked.** If a build produces it, it is gitignored,
  so `git status` only shows human edits. The exceptions load from
  `.claude/rules/generated-data.md`.
- **A workflow's push to `main` does not deploy.** GitHub starts no workflows
  for `GITHUB_TOKEN` pushes, so `build.yml` lists every content workflow by
  its `name:` in a `workflow_run` trigger. Adding or renaming a workflow that
  pushes means updating that list; `tests/test_workflow_deploy_triggers.py`
  fails if you forget. See "How a bot commit reaches the site" in
  `scripts/lib/CLAUDE.md`.

## Gotchas

- **`docs/` is the published site.** Everything committed under it is public,
  `docs/plans/` included.
- **MusicBrainz caches only build locally.** `./scripts/utility
  refresh-musicbrainz` needs the local MusicBrainz Postgres and
  `uv sync --extra analytics`; CI reads the committed caches (listed at the
  top of `scripts/lib/refresh-musicbrainz`). When an index build prints
  `MusicBrainz: N works' artists never checked`, it's time to run it.
- **Files that look live but aren't:** `scripts/lib/build_index.py` is the
  legacy builder (the index comes from `build_works_index.py`);
  `docs/data/wanted_songs.json` is build output (edit
  `curation/bounty_decisions.yaml`); `docs/posts/` is the pre-move copy of a
  blog that now lives on mikebeaumier.com.
- **Phone testing is plain http.** The tailnet URL `./scripts/server` prints is
  not a secure context, so clipboard reads and other secure-only APIs are
  missing there, though they work on the live https site.
- **Browser debugging:** the Chrome DevTools MCP, against a running
  `./scripts/server`. `./scripts/chrome` opens a debug browser with a saved
  login.
- **Some tracker labels are dead.** Submissions and corrections arrive through
  the in-app editor (`pending_songs` → `process-pending.yml` → `works/`), not
  as issues, so nothing consumes the `song-submission`, `song-correction`,
  `tab-submission` and `tab-correction` labels any more.

## Where to read more

A subdirectory's `CLAUDE.md` loads when you work on files in it.

| Area | Read |
|------|------|
| Frontend modules, routing, song paths, offline caching | `docs/js/CLAUDE.md` |
| Renderers and the tab player | `docs/js/renderers/CLAUDE.md` |
| Tab editor | `docs/js/otf-editor/CLAUDE.md`, `docs/js/otf-editor/DESIGN.md` |
| Lyrics & chords editor | `docs/js/lead-editor/CLAUDE.md` |
| Build pipeline, index, curation, prune, workflows | `scripts/lib/CLAUDE.md` |
| Tags and grassiness | `scripts/lib/tagging/CLAUDE.md` |
| Supabase schema, RLS, edge functions, migrations | `supabase/CLAUDE.md` |
| E2E tests and the Supabase mock | `e2e/CLAUDE.md` |
| Analytics; what visitors searched for and didn't find | `analytics/CLAUDE.md` |
| One song source (scraper, parser, import) | `sources/<source>/CLAUDE.md` |
| ChordPro syntax and our `x_` extensions | `chordpro` skill |
| TEF / tablature parsing bugs | `tab-debug` skill |
| Filing an issue; labels, milestones, PRs | `add-issue` and `github-project` skills |
| Opening or screenshotting one UI state | `design/ui-states/README.md` |
| Product vision | `ROADMAP.md` |
