# Quality Validation in Batch Processing

## Overview

The batch processor now includes quality validation to distinguish between files that:
- **Parse without errors** (technical success)
- **Have complete, usable content** (quality success)

## Quality Categories

Files are categorized into three quality levels:

### Complete
- Has 2+ paragraphs
- Has 10+ total lines
- Has 3+ lines with chords
- Has 5+ lines with lyrics
- **Ready for use** - full song content with chords and lyrics

### Incomplete
- Has 1+ paragraphs
- Has 3+ total lines
- Has some chords or lyrics
- **Partially usable** - missing some content but has song structure

### Minimal
- Has 0 paragraphs OR
- Has <3 total lines OR
- Has no chords or lyrics
- **Not usable** - only metadata or very little content (like "Man of Constant Sorrow" before the fix)

## Metrics Tracked

For each successfully parsed file, the batch processor now tracks:

- `has_content`: Whether song content exists
- `paragraph_count`: Number of paragraphs
- `total_lines`: Total lines of content
- `lines_with_chords`: Number of lines containing chords
- `lines_with_lyrics`: Number of lines containing lyrics
- `confidence`: Validation confidence score (0-100%)
- `quality_status`: One of 'complete', 'incomplete', or 'minimal'

## Report Output

The batch processing report now includes:

```
Content Quality:
  Complete:      XXXX (XX.X%)
  Incomplete:    XXXX (XX.X%)
  Minimal:       XXXX (XX.X%)

Quality Metrics (averages):
  Avg confidence:  XX.XX%
  Avg paragraphs:  XX.X
  Avg lines:       XX.X
```

## Example: "Man of Constant Sorrow"

**Before fix:**
- Status: "successful" (parsed without errors)
- Quality: "minimal" (only 3 lines of metadata)
- Paragraphs: 0
- Total lines: 0

**After fix:**
- Status: "successful" (parsed without errors)
- Quality: "complete" (full song content)
- Paragraphs: 5
- Total lines: 20
- Lines with chords: 20
- Lines with lyrics: 20
- Confidence: 100%

## Running Full Analysis

To get complete quality metrics for all files:

```bash
uv run python batch_process.py
```

This will generate a report with quality breakdowns and allow comparison between old and new parsing results.

## Benefits

1. **Track actual improvements**: See when files move from "minimal" to "complete"
2. **Identify issues**: Find files that parse but produce incomplete output
3. **Quality metrics**: Monitor average confidence, paragraphs, and lines
4. **Better reporting**: Distinguish between technical success and content quality

