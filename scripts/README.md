# Scripts Directory

Utility scripts for the Bluegrass Songbook project.

## regression_test.py ⭐ PRIMARY TESTING TOOL

**Automated regression testing workflow. USE THIS for all parser changes.**

Automates the complete pre/post comparison workflow:
1. Creates baseline analysis from current output
2. Runs batch process with your changes
3. Creates post-change analysis
4. Compares results and flags regressions
5. Generates comprehensive summary

### Usage

```bash
# Full regression test (recommended)
python3 scripts/regression_test.py --name <change_description>

# Example
python3 scripts/regression_test.py --name repeat_fix

# Skip baseline if already created
python3 scripts/regression_test.py --name repeat_fix --skip-baseline

# Rerun comparison only (after batch already completed)
python3 scripts/regression_test.py --name repeat_fix --skip-baseline --skip-batch
```

### Output

Creates two analysis directories:
- `analysis_before_<name>/` - Baseline metrics, histograms, outlier reports
- `analysis_after_<name>/` - Post-change metrics, histograms, outlier reports

Prints to stdout:
- Detailed change analysis (per-file breakdown)
- Files flagged for review (>10% change in any metric)
- Summary statistics comparison
- Change categories (improved/degraded/neutral/fixed)
- Overall assessment (POSITIVE/NEGATIVE/CAUTION)

### When to Use

**Required:** Every time you modify `src/chordpro_parser/parser.py`

**Catches:**
- Unintended side effects on unrelated files
- Regressions in verse boundary detection
- Chord extraction failures
- Changes in output quality

### Workflow

```bash
# 1. Make parser changes
vim src/chordpro_parser/parser.py

# 2. Run regression test
python3 scripts/regression_test.py --name my_change

# 3. Review output
#    - Check for regressions
#    - Review files flagged for manual inspection
#    - Verify changes are intentional

# 4a. If clean, commit both parser and output
git add src/chordpro_parser/parser.py output/
git commit -m "Fix: description"

# 4b. If regressions found, rollback
git checkout HEAD -- output/              # Rollback all changes
git checkout HEAD -- output/bad_file.pro  # Rollback specific files
```

### Git Integration

The regression test **automatically checks git status** and warns if `output/` has uncommitted changes.

**Since output/ is tracked in git**, you have two rollback options:

1. **Fast rollback** - Restore from git (instant):
   ```bash
   git checkout HEAD -- output/
   ```

2. **Regenerate** - Revert parser code and rebuild (~3 min):
   ```bash
   git checkout HEAD -- src/chordpro_parser/parser.py
   uv run python3 batch_process.py
   ```

**Best practice:** Commit `output/` changes along with parser changes, so git history shows which parser version produced which output.

---

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

## select_outliers.py

Selects outlier files stratified by HTML structure type for focused debugging.

### Usage

```bash
# Select 1 bottom and 1 top outlier for chord count (default)
uv run python scripts/select_outliers.py

# Select outliers for different metrics
uv run python scripts/select_outliers.py --metric verse_count
uv run python scripts/select_outliers.py --metric word_count

# Select more outliers
uv run python scripts/select_outliers.py --count 5

# Custom paths
uv run python scripts/select_outliers.py \
    --batch-report batch_processing_report.json \
    --analysis-dir analysis
```

### Output

Displays:
- Structure type distribution in corpus
- Total outliers by category (bottom/top)
- Selected files with full paths (HTML and PRO)
- Structure type for each selected file
- Metric value for each file

### Stratification

Outlier selection is weighted by HTML structure type frequency:
- ~60% from pre_plain files
- ~32% from pre_tag files
- ~8% from span_br files

This ensures representative sampling across all parser code paths.

## create_outlier_sample.py

Creates a sample file for the viewer from selected outliers.

### Usage

```bash
# Create sample from specific files
uv run python scripts/create_outlier_sample.py \
    --files file1.html file2.html file3.html

# Create sample from outlier report (top 10)
uv run python scripts/create_outlier_sample.py \
    --from-report analysis/reports/chord_count_outliers.txt \
    --count 10

# Custom output location
uv run python scripts/create_outlier_sample.py \
    --files file1.html file2.html \
    --output my_sample.json
```

### Integration with Viewer

After creating the sample:

```bash
# Start viewer (uses stratified_sample_spot_check.json by default)
uv run python3 viewer/server.py

# Visit in browser
open http://localhost:8000
```

The viewer provides:
- Side-by-side comparison of HTML and generated ChordPro
- Live parsing (see changes immediately without batch reprocessing)
- Structured feedback collection
- Keyboard shortcuts for efficient navigation

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
