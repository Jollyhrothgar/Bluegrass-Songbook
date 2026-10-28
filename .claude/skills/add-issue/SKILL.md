---
name: add-issue
description: File GitHub issues for Bluegrass Songbook with duplicate detection, live labels and milestones, and a two-way link to the fix-it list. Use when Mike asks to file, open, log or track an issue, or when work turns up a bug or follow-up that should outlive the session.
argument-hint: "<description> [--yes]"
---

# Add Issue

`/add-issue <description>` asks before creating. `--yes` creates with
best-guess defaults. A numbered list or semicolon-separated text means several
issues.

## 1. Check for duplicates in both backlogs

The fix-it list (`docs/plans/2026-09-30-fix-it-list.md`) is the working
backlog; GitHub issues hold longer-range ideas and outside reports. Search
both:

```bash
grep -n -i "<keyword>" docs/plans/2026-09-30-fix-it-list.md
gh issue list --state open --search "<keywords>"
gh issue list --state closed --search "<keywords>" --limit 5
```

If something matches, show it with its link or fix-it ID and ask: update the
existing one, create anyway, or skip.

## 2. Read labels and milestones live

Both drift, and `gh issue create` fails on a label or milestone that doesn't
exist:

```bash
gh label list --limit 100
gh api 'repos/:owner/:repo/milestones?state=all' --jq '.[] | "\(.number) | \(.title) | \(.state) | \(.open_issues) open"'
```

**Type label** (one): `bug`, `feature-request`, `technical-debt`,
`refactoring`, `documentation`, `rfc`, `new-data-source`.

Don't apply these: `bug-report` and the other song-flag sub-types
(`wrong-chord`, `lyric-error`, …), which the `create-flag-issue` edge function
sets on reader reports; or `song-submission`, `song-correction`,
`tab-submission`, `tab-correction`, which nothing consumes any more.

**Size** (if confident): `quick-win` (< 1 hour), `medium` (half a day to a
day), `large` (several days).

**Priority:** add `P0`–`P3` only when Mike states one. The fix-it list's order
is the priority otherwise.

**Milestone** by topic, checked against the live list (as of 2026-10-28;
Fiddle Tunes and User Login are closed):

| Topic | Milestone |
|-------|-----------|
| lists, setlists, favorites, offline | List Management Tools |
| search, filters, tags | Improve Search & Filtering |
| songs, imports, sources | Content |
| playback, metronome, backing | Playback Engine |
| tabs, tab editor, TEF, ABC | Tablature |
| profiles, users, community | Community |
| refactors, tests, CI, tech debt | Code Health |
| submissions, `pending_songs`, review queue | Contribution pipeline |
| fun, easter eggs | Fun Features |
| anything else | Backlog |

## 3. Write the body for a reader with no session context

```markdown
## Description
What is wrong or wanted, and who asked (Mike, a reader report, found while
working on <fix-it ID>). Name files and functions as `path/file.js`
`functionName`.

## Where things are
Code paths, data files, related PRs and issues.

## Acceptance Criteria
- [ ] Observable outcomes, including the test that proves each one.
```

## 4. Confirm, then create

Unless `--yes`, show the title, labels, milestone, body, and any related
issues, then ask with AskUserQuestion: Create / Edit first / Skip. In batch
mode, show one table (`# | Title | Labels | Milestone | Related`) and confirm
once.

```bash
gh issue create --title "<title>" --body "<body>" \
  --label "<type>,<size>" --milestone "<milestone title>"
```

Print each new issue's URL.

## 5. Link it to the fix-it list

If the issue belongs to a fix-it item, or is a follow-up found while working
on one, link both ways: name the ID in the issue body, and cite `#<number>` in
that item's Status row or Follow-ups entry on the current branch. Issue #309
and fix-it item E3 show the pattern. A finding that matters to the current
backlog belongs in the fix-it list even when it also gets an issue.
