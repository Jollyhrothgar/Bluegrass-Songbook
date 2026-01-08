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

**Label** (pick one primary):
| Pattern | Label |
|---------|-------|
| "fix", "bug", "broken", "doesn't work", "error" | `bug` |
| "add", "new", "feature", "support", "allow" | `feature-request` |
| "refactor", "cleanup", "debt", "improve code" | `technical-debt` |
| "song", "chords", "lyrics" (submission) | `song-submission` |
| "wrong chords", "typo in song" | `song-correction` |
| "import", "source", "scrape" | `new-data-source` |

**Milestone** (based on topic):
| Topic | Milestone |
|-------|-----------|
| lists, setlists, favorites, offline | List Management Tools (#2) |
| search, filter, tags, find | Improve Search & Filtering (#3) |
| songs, imports, sources | Content (#6) |
| playback, metronome, backing | Playback Engine (#7) |
| fiddle, ABC, notation | Fiddle Tunes (#8) |
| tabs, tablature | Tablature (#9) |
| profiles, users, community | Community (#10) |
| fun, easter egg, game | Fun Features (#5) |
| unclear/general | Backlog (#4) |

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
**Labels:** bug, size:small
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
