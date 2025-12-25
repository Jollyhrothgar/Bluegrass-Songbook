## ChordPro Parser Validator

Side-by-side validation tool for reviewing parsed ChordPro output.

### Features

- **Split view**: Original HTML on left, generated ChordPro on right
- **Pattern grouping**: Files organized by HTML structure pattern
- **Quick feedback**: Mark files as ✓ Correct, ⚠ Minor Issues, or ✗ Wrong
- **Notes**: Add detailed feedback for issues
- **Keyboard shortcuts**: Navigate and mark files quickly

### Usage

1. **Run pattern analysis** (if not done already):
   ```bash
   python3 analyze_patterns.py html/ -o pattern_analysis.json
   ```

2. **Start the validator server**:
   ```bash
   python3 viewer/server.py
   ```

3. **Open in browser**:
   ```
   http://localhost:8000
   ```

4. **Review files**:
   - Use arrow keys (← →) or buttons to navigate
   - Press `1` for ✓ Correct, `2` for ⚠ Minor, `3` for ✗ Wrong
   - Add notes for issues in the text area
   - Feedback automatically saved to `viewer/feedback.jsonl`

### Keyboard Shortcuts

- `←` / `→` - Previous/Next file
- `1` - Mark as correct
- `2` - Mark as minor issues
- `3` - Mark as wrong

### Feedback Output

Feedback saved to `viewer/feedback.jsonl` in format:
```json
{"file": "songname.html", "status": "wrong", "notes": "Chords misaligned on line 3", "timestamp": "2025-10-05T..."}
```

### Workflow

1. Validator loads top 5 files from each HTML pattern (strategic sampling)
2. You review ~20-30 files representing different patterns
3. Feedback identifies which patterns need fixes
4. Parser updated for failing patterns
5. Re-run validation on same files to verify fixes
