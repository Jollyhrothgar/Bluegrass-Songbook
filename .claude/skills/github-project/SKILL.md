---
name: github-project
description: GitHub project management for Bluegrass Songbook (Jollyhrothgar/Bluegrass-Songbook). Use when working with issues, milestones, labels, pull requests, or the workflows that labels trigger. To file a new issue, use the add-issue skill.
---

# GitHub Project Management

Repository: `Jollyhrothgar/Bluegrass-Songbook`. The working backlog is
`docs/plans/2026-09-30-fix-it-list.md`; issues hold longer-range ideas and
reader reports.

## Pull requests

```bash
gh pr create --base main --title "G14: ..." --body "..."   # name the fix-it IDs
gh pr checks <n>
gh pr merge <n> --merge --delete-branch    # merge commit, never --squash
gh api repos/:owner/:repo/pulls/<n>/comments
```

Merge with a merge commit so each item's commits stay bisectable and
revertable (one of the working agreements at the top of the fix-it list).
`main` is protected against force pushes and deletion (ruleset "Protect
main").

## Issues

```bash
gh issue list                                   # open
gh issue list --milestone "<title>"             # by milestone
gh issue list --label bug
gh issue view <n>
gh issue close <n> -c "Fixed in #<pr>"
gh issue edit <n> --add-label "<label>" --remove-label "<label>"
gh api repos/:owner/:repo/issues/<n> -X PATCH -F milestone=<number>   # or milestone=null

# Open issues with no milestone
gh issue list --limit 200 --json number,title,milestone \
  --jq '.[] | select(.milestone == null) | "\(.number): \(.title)"'
```

## Milestones and labels

Numbers, titles and labels drift; read them live, because a stale milestone
number silently files an issue in the wrong place:

```bash
gh api 'repos/:owner/:repo/milestones?state=all' --jq '.[] | "\(.number) | \(.title) | \(.state) | \(.open_issues) open"'
gh label list --limit 100
```

Labels with special meaning:

| Label | Meaning |
|-------|---------|
| `song-flag` (+ a sub-type such as `wrong-chord`, `lyric-error`, `bug-report`) | A reader's report from the site's 🚩 Report issue flow (`supabase/functions/create-flag-issue`). Reports of app bugs arrive with Song ID `app`: relabel them `bug`. |
| `tune-request` + `approved` | Triggers `process-tune-request.yml`, which imports a fiddle tune from TuneArch. The only label-triggered workflow. |
| `superuser-request` | A request for trusted-user status. |
| `song-submission`, `song-correction`, `tab-submission`, `tab-correction` | Dead: submissions go through the in-app editor now (`pending_songs` → `process-pending.yml` → `works/`). Nothing consumes these. |

## Workflows

List them with their real names instead of trusting a copy:

```bash
grep -H -m1 '^name:' .github/workflows/*.yml
```

A workflow that pushes to `main` must be listed by name in `build.yml`'s
`workflow_run` trigger, or its commits never deploy
(`tests/test_workflow_deploy_triggers.py` checks this).

## Projects

The classic Projects API (`gh api repos/:owner/:repo/projects`) returns 404.
`gh project list` needs the `read:project` scope, which the default token
lacks; `gh auth refresh -s read:project` opens a browser, so ask Mike before
running it.
