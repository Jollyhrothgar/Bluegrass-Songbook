---
name: add-issue
description: Create GitHub issues with duplicate detection, labeling, and milestone assignment.
user-invocable: true
arguments: "<description> [--yes]"
---

# Add Issue Skill

Creates GitHub issues with intelligent defaults, duplicate detection, and proper categorization.

## Usage

```
/add-issue <description>           # Interactive: asks for confirmation
/add-issue <description> --yes     # Skip confirmation, create immediately
/add-issue <multiple issues>       # Detects and handles batch creation
```

## Examples

```
/add-issue Add dark mode toggle to settings
/add-issue Fix: search doesn't find songs with apostrophes --yes
/add-issue 1. Add export to PDF 2. Add print preview 3. Add page breaks
```

## Workflow

When this skill is invoked, follow these steps:

### Step 1: Parse Input

- Extract the issue description(s) from the argument
- Detect if `--yes` flag is present (skip confirmation)
- Detect if multiple issues are being requested (numbered list, semicolons, or clear separation)

### Step 2: Check for Duplicates/Related Issues

For each issue, search existing issues:

```bash
# Search open issues for related content
gh issue list --state open --search "<keywords from description>"

# Also check recently closed (might be already done)
gh issue list --state closed --search "<keywords from description>" --limit 5
```

If duplicates found:
- Show the related issue(s) with links
- Ask if user wants to: (a) update existing issue, (b) create anyway, (c) skip

### Step 3: Categorize the Issue

Based on the description, determine:

**First, read the live labels and milestones.** Both drift, and `gh issue
create` fails outright on a label or milestone that does not exist:

```bash
gh label list --limit 100
gh api 'repos/:owner/:repo/milestones?state=all' --jq '.[] | "\(.number) | \(.title) | \(.state)"'
```

The tables below are a starting guess, verified 2026-08-19 — not a substitute
for those two commands.

**Label** (pick one primary):
| Pattern | Label |
|---------|-------|
| "fix", "bug", "broken", "doesn't work", "error" | `bug` |
| "add", "new", "feature", "support", "allow" | `feature-request` |
| "refactor", "cleanup", "debt", "improve code" | `technical-debt` |
| "import", "source", "scrape" | `new-data-source` |

Song submissions and corrections are **not** issues any more — they go
through the in-app editor (`pending_songs` → `pending-commit` dispatch →
`works/`). An issue about a specific song is a *report*, labelled
`song-flag` by `create-flag-issue`.

**Milestone** (based on topic):
| Topic | Milestone |
|-------|-----------|
| lists, setlists, favorites, offline | List Management Tools (#2) |
| search, filter, tags, find | Improve Search & Filtering (#3) |
| songs, imports, sources | Content (#6) |
| playback, metronome, backing | Playback Engine (#7) |
| tabs, tablature, fiddle, ABC, notation | Tablature (#9) |
| profiles, users, community | Community (#10) |
| fun, easter egg, game | Fun Features (#5) |
| refactor, tests, tech debt | Code Health (#11) |
| submissions, pending_songs, review queue | Contribution pipeline (#12) |
| unclear/general | Backlog (#4) |

Milestone **#8 Fiddle Tunes is closed** — do not assign to it. ABC/fiddle-tune
work goes to Tablature (#9) or Content (#6).

**Size** (add as label if confident):
- `quick-win` - < 1 hour, low risk
- `medium` - Half-day to full day
- `large` - Multi-day, needs planning

**Priority** (if obvious):
- `P0` - DEFCON zero, do it now
- `P1` - Pretty important
- `P2` - Will do, but not immediately
- `P3` - Nice to have

### Step 4: Show Summary and Confirm

Unless `--yes` flag, use AskUserQuestion with Yes/No:

```
## Issue to Create

**Title:** <generated title>
**Labels:** bug, quick-win
**Milestone:** Improve Search & Filtering

**Body:**
<generated body>

Related issues found: #42 (similar topic)
```

Options: Create / Edit first / Skip

### Step 5: Create the Issue

```bash
gh issue create \
  --title "<title>" \
  --body "<body>" \
  --label "<labels>" \
  --milestone "<milestone name>"
```

After creation, output the issue URL.

## Issue Body Template

```markdown
## Description
<user's description, cleaned up>

## Acceptance Criteria
- [ ] <inferred from description>
```

## Batch Mode

When multiple issues detected:
1. Parse each issue separately
2. Run duplicate check for each
3. Show summary table:

```
| # | Title | Labels | Milestone | Duplicate? |
|---|-------|--------|-----------|------------|
| 1 | Add export to PDF | feature-request | Backlog | No |
| 2 | Add print preview | feature-request | Backlog | Similar: #23 |
| 3 | Add page breaks | feature-request | Backlog | No |
```

4. Single Yes/No confirmation for all (unless duplicates need resolution)
5. Create all, report results with URLs

## Notes

- Prefer updating existing issues over creating duplicates
- When in doubt about categorization, ask
- For `--yes` mode, use best-guess defaults without confirmation
- Reference github-project skill for current labels/milestones
