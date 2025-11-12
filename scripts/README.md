# Scripts Directory

Utility scripts for the Bluegrass Songbook project.

## validator.py

Analyzes parsed ChordPro files to find potential parsing errors by identifying statistical outliers.

### Usage

```bash
# Run analysis on output directory
uv run python scripts/validator.py

# Custom output and analysis directories
uv run python scripts/validator.py --output-dir output --analysis-dir analysis

# Custom outlier threshold (default: 0.1%)
uv run python scripts/validator.py --threshold 1.0
```

### Output

- `analysis/histograms/` - Histogram images for each metric
- `analysis/reports/` - Outlier reports (top/bottom 0.1%)
- `analysis/summary_statistics.json` - Overall statistics
- `analysis/all_metrics.json` - Detailed metrics for every file

## compare_analysis.py

Compares two validator analysis runs to identify changes in parsing results. Useful for validating parser changes and ensuring no regressions.

### Usage

```bash
# Compare two analysis runs
uv run python scripts/compare_analysis.py \
    --before analysis_before_change \
    --after analysis_after_change \
    --show-changed-files

# Save comparison to file
uv run python scripts/compare_analysis.py \
    --before analysis_before_change \
    --after analysis_after_change \
    --output comparison_report.txt
```

### Output

The comparison shows:
- Changes in distribution statistics (mean, median, percentiles)
- Files that improved (0 → >0 metrics)
- Files that degraded (>0 → 0 metrics)
- Other significant changes (>10% change)

## analyze_changes.py

Comprehensive change analysis with intelligence. Analyzes every file's changes and categorizes them as positive, negative, or neutral. Flags dramatic changes and provides overall assessment.

### Usage

```bash
# Full analysis
uv run python scripts/analyze_changes.py \
    --before analysis_before_change \
    --after analysis_after_change

# Show only files needing review
uv run python scripts/analyze_changes.py \
    --before analysis_before_change \
    --after analysis_after_change \
    --review-only

# Show only dramatic changes (>10%)
uv run python scripts/analyze_changes.py \
    --before analysis_before_change \
    --after analysis_after_change \
    --dramatic-only

# Show only fixed files
uv run python scripts/analyze_changes.py \
    --before analysis_before_change \
    --after analysis_after_change \
    --category fixed

# Save detailed JSON report
uv run python scripts/analyze_changes.py \
    --before analysis_before_change \
    --after analysis_after_change \
    --output changes_report.json
```

### Change Categories

- **fixed**: 0→>0 (parsing failure fixed) - Always positive
- **regression**: >0→0 (working file broken) - Always negative, needs review
- **improved**: All metrics increased
- **degraded**: All metrics decreased - Needs review
- **mixed**: Dramatic changes (>10%) but not all in same direction - Needs review
- **neutral**: Minor changes, no significant impact

### Intelligence

The script automatically:
- Treats 0→>0 changes as always positive (fixing parsing failures)
- Flags regressions (>0→0) as critical issues
- Identifies dramatic changes (>10% for any metric)
- Provides overall assessment (POSITIVE/NEGATIVE/CAUTION/NEUTRAL)
- Categorizes changes for easy review

### Workflow for Parser Changes

1. **Before making changes:**
   ```bash
   # Backup current analysis
   cp -r analysis analysis_before_change
   ```

2. **After making changes:**
   ```bash
   # Re-run batch processing (if needed)
   uv run python batch_process.py
   
   # Re-run validator
   uv run python scripts/validator.py
   
   # Analyze changes with intelligence
   uv run python scripts/analyze_changes.py \
       --before analysis_before_change \
       --after analysis \
       --output changes_report.json
   
   # Review files needing attention
   uv run python scripts/analyze_changes.py \
       --before analysis_before_change \
       --after analysis \
       --review-only
   ```

## chord_counter.py

Counts chords in ChordPro files.

### Usage

```bash
# Count chords in a single file
uv run python scripts/chord_counter.py output/song.pro

# Count chords in all files
uv run python scripts/chord_counter.py output/*.pro

# Show top chords
uv run python scripts/chord_counter.py output/*.pro --top 10
```
