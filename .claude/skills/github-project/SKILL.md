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

| # | Title | Purpose |
|---|-------|---------|
| 2 | List Management Tools | User lists, setlists, offline access |
| 3 | Improve Search & Filtering | Search features, filters, tagging |
| 4 | Backlog | Lower priority items |
| 5 | Fun Features | Leaderboards, easter eggs |
| 6 | Content | New song sources, imports |
| 7 | Playback Engine | Metronome, chord backing (future) |
| 8 | Fiddle Tunes | ABC notation support (future) |
| 9 | Tablature | Tab generation (future) |
| 10 | Community | Profiles, contributions (future) |

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

| Label | Purpose |
|-------|---------|
| `bug` | Something isn't working |
| `feature-request` | Add something new that doesn't exist |
| `technical-debt` | Non-blocking cleanup or improvements |
| `song-submission` | New song variant or addition |
| `song-correction` | Fix to existing song |
| `approved` | Triggers GitHub Actions workflows |
| `new-data-source` | New song collection to import |
| `rfc` | Request for Comments - architectural decisions |

### Automated Workflows

These label combinations trigger GitHub Actions:

| Labels | Action |
|--------|--------|
| `song-submission` + `approved` | `process-song-submission.yml` - adds new song |
| `song-correction` + `approved` | `process-song-correction.yml` - updates song |

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

```bash
# List projects
gh api repos/:owner/:repo/projects

# Note: GitHub Projects v2 uses GraphQL - see gh project commands
gh project list
gh project view 1
```
