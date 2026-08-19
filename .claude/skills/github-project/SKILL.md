---
name: github-project
description: GitHub project management for Bluegrass Songbook. Use when working with issues, milestones, labels, PRs, or release workflows.
---

# GitHub Project Management

Repository: `Jollyhrothgar/Bluegrass-Songbook`

## Quick Reference

```bash
# Issues
gh issue list                           # Open issues
gh issue list --state all               # All issues
gh issue list --milestone "Name"        # By milestone
gh issue list --label bug               # By label
gh issue view 42                        # View issue details
gh issue close 42 -c "Fixed in abc123"  # Close with comment

# Milestones
gh api repos/:owner/:repo/milestones    # List milestones
gh api repos/:owner/:repo/milestones --jq '.[] | {number, title, open_issues}'

# Assign issue to milestone
gh api repos/:owner/:repo/issues/42 -X PATCH -F milestone=2

# Remove from milestone
gh api repos/:owner/:repo/issues/42 -X PATCH -F milestone=null

# Labels
gh issue edit 42 --add-label "bug"
gh issue edit 42 --remove-label "bug"
```

## Milestones

**Milestone numbers and titles change. Always read them live before using
one** — passing a stale number to `-F milestone=N` silently files the issue in
the wrong place:

```bash
gh api 'repos/:owner/:repo/milestones?state=all' --jq '.[] | "\(.number) | \(.title) | \(.state)"'
```

Snapshot as of 2026-08-19 (open unless noted), for orientation only:

| # | Title | Purpose |
|---|-------|---------|
| 1 | User Login | **closed** |
| 2 | List Management Tools | User lists, setlists, offline access |
| 3 | Improve Search & Filtering | Search features, filters, tagging |
| 4 | Backlog | Lower priority items |
| 5 | Fun Features | Leaderboards, easter eggs |
| 6 | Content | New song sources, imports |
| 7 | Playback Engine | Metronome, chord backing |
| 8 | Fiddle Tunes | **closed** — ABC notation support shipped |
| 9 | Tablature | Tab display, editing, playback |
| 10 | Community | Profiles, contributions |
| 11 | Code Health | Refactors, test coverage, tech debt |
| 12 | Contribution pipeline | Submission → `pending_songs` → `works/` |

### Create a Milestone

```bash
gh api repos/:owner/:repo/milestones -X POST \
  -f title="Milestone Name" \
  -f description="What this milestone covers" \
  -f due_on="2025-03-01T00:00:00Z"  # Optional
```

### Milestone Progress

```bash
# Get open/closed counts
gh api repos/:owner/:repo/milestones --jq '.[] | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'
```

## Labels

**Applying a label that does not exist makes `gh issue create` fail.** The
repo has ~32 labels; read them live before choosing:

```bash
gh label list --limit 100
```

Commonly used ones (verified present 2026-08-19):

| Label | Purpose |
|-------|---------|
| `bug` | Something isn't working |
| `feature-request` | Add something new that doesn't exist |
| `technical-debt` | Non-blocking cleanup or improvements |
| `refactoring` | Code cleanup and restructuring |
| `documentation` | Documentation improvements |
| `song-flag` | A reader reported a problem with a song (read-only report, no workflow) |
| `tune-request` | Instrumental tune request (fetched from TuneArch on approval) |
| `approved` | Triggers the tune-request workflow |
| `new-data-source` | New song collection to import |
| `rfc` | Request for Comments - architectural decisions |
| `superuser-request` | Request for super-user/trusted status |
| `quick-win` / `medium` / `large` | Size |
| `P0` / `P1` / `P2` / `P3` | Priority |

### Automated Workflows

`tune-request` + `approved` is the **only** label combination that triggers a
GitHub Action:

| Labels | Action |
|--------|--------|
| `tune-request` + `approved` | `process-tune-request.yml` ("Process Tune Request") - imports a fiddle tune from TuneArch |

Song content no longer arrives by issue. Since phase 2b of
`docs/plans/contribution-pipeline.md`, any logged-in user's submission goes
straight to `pending_songs` (live in seconds) and then to `works/` via the
`pending-commit` dispatch handled by `process-pending.yml`.

The `song-submission`, `song-correction`, `tab-submission` and
`tab-correction` labels **still exist in the repo but nothing consumes them** —
their workflows and edge functions are deleted. Do not apply them expecting an
automation to fire.

### The rest of the workflows

Not label-triggered; listed so you don't invent one. Verify with
`ls .github/workflows/`:

| File | `name:` | Trigger |
|------|---------|---------|
| `build.yml` | CI & Deploy | push to main, PRs |
| `deploy-functions.yml` | Deploy Supabase Functions | push to main touching `supabase/functions/**`; `workflow_dispatch` |
| `process-pending.yml` | Process Pending Submission | `pending-commit` repository_dispatch |
| `process-tune-request.yml` | Process Tune Request | issue labeled (see above) |
| `cleanup-pending.yml` | Cleanup Pending Songs | `workflow_run` after "CI & Deploy" |
| `reconcile-pending.yml` | Reconcile Pending Songs | cron `42 * * * *` |
| `sync-community-input.yml` | Sync Community Input | cron `27 * * * *` |
| `sync-deleted-songs.yml` | Sync Deleted + Promoted Songs | cron `17 * * * *` |

## Common Workflows

### Triage New Issue

```bash
# 1. View the issue
gh issue view 42

# 2. Add appropriate label
gh issue edit 42 --add-label "feature-request"

# 3. Assign to milestone
gh api repos/:owner/:repo/issues/42 -X PATCH -F milestone=2

# 4. Optionally add comment
gh issue comment 42 -b "Added to List Management milestone. Will address in next sprint."
```

### Close Resolved Issue

```bash
# Close with reference to fix
gh issue close 42 -c "Fixed in commit abc123 / PR #45"
```

### Bulk Operations

```bash
# Close all issues with a label
gh issue list --label "wontfix" --json number --jq '.[].number' | xargs -I {} gh issue close {}

# Add label to multiple issues
for i in 10 11 12; do gh issue edit $i --add-label "bug"; done

# Move issues to milestone
for i in 31 39 40; do gh api repos/:owner/:repo/issues/$i -X PATCH -F milestone=2; done
```

### Create Release

```bash
# Tag and create release
git tag -a v1.0.0 -m "Version 1.0.0"
git push origin v1.0.0

gh release create v1.0.0 \
  --title "v1.0.0 - List Management" \
  --notes "## Features
- Drag-and-drop setlists
- Offline list access
- Full screen performance mode"
```

## Pull Requests

```bash
# Create PR
gh pr create --title "Add setlist navigation" \
  --body "Closes #40" \
  --base main

# View PR checks
gh pr checks 45

# Merge PR
gh pr merge 45 --squash --delete-branch

# View PR comments
gh api repos/:owner/:repo/pulls/45/comments
```

## Issue Templates

Issues are created via the web UI or:

```bash
gh issue create --title "Bug: description" \
  --body "## Steps to reproduce
1.
2.

## Expected behavior

## Actual behavior" \
  --label "bug"
```

## Queries

```bash
# Issues without milestone
gh issue list --json number,title,milestone --jq '.[] | select(.milestone == null) | "\(.number): \(.title)"'

# Issues by author
gh issue list --author pixiefarm

# Recently updated
gh issue list --json number,title,updatedAt --jq 'sort_by(.updatedAt) | reverse | .[:5] | .[] | "\(.number): \(.title)"'

# Search issue content
gh issue list --search "offline in:body"
```

## Project Board (if using GitHub Projects)

`gh api repos/:owner/:repo/projects` is the **classic** Projects API and is
gone — it returns HTTP 404 on this repo. Projects v2 is GraphQL-only, via the
`gh project` subcommands:

```bash
gh project list
gh project view 1
```

These need the `read:project` scope, which the default `gh` token does not
carry. If you get "your authentication token is missing required scopes",
run `gh auth refresh -s read:project` — that is an interactive browser flow,
so ask the user rather than running it unprompted.
