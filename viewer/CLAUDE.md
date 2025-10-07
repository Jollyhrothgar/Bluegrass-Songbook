# ChordPro Validator - Web UI for Quality Validation

This directory contains a web-based validation tool for reviewing and providing feedback on ChordPro parser output.

## Files in This Directory

```
viewer/
├── CLAUDE.md         # This file - validator documentation
├── server.py         # Flask HTTP server with live parsing API
├── index.html        # Single-page validation UI
├── feedback.jsonl    # Feedback log (one JSON per line)
└── README.md         # User instructions
```

## Purpose

Manual quality validation is critical for a parser with 98.5% automated success rate. This viewer enables:

1. **Side-by-side comparison** - View original HTML and generated ChordPro
2. **Live parsing** - Server regenerates ChordPro on-the-fly from current parser code
3. **Structured feedback** - Track validation status (correct/minor/wrong) with notes
4. **Stratified sampling** - Review proportional samples by HTML structure type

## Quick Start

```bash
# Start server
python3 viewer/server.py

# Visit in browser
open http://localhost:8000

# Review files, mark status, add notes, submit feedback
# Feedback is appended to viewer/feedback.jsonl
```

## Architecture

### server.py - HTTP Server & Live Parser

**Server**: Simple `HTTPServer` with custom `SimpleHTTPRequestHandler`

**Port**: 8000

**Key Endpoints**:

1. **`GET /`** - Serve index.html (validation UI)

2. **`GET /api/files`** - Load file list from `stratified_sample_spot_check.json`
   ```json
   {
     "files": [
       {"name": "song.html", "structure_type": "pre_plain", "has_chords": true}
     ]
   }
   ```

3. **`GET /html/{filename}`** - Serve original HTML file for preview

4. **`GET /api/chordpro/{filename}`** - **Live parse** HTML and return ChordPro
   - Reads `html/{filename}`
   - Parses with current parser code (StructureDetector, ContentExtractor, ChordProGenerator)
   - Returns ChordPro text
   - **Critical**: This uses the CURRENT parser code, so changes are immediately reflected

5. **`POST /api/feedback`** - Save validation feedback
   ```json
   {
     "file": "song.html",
     "status": "correct|minor|wrong",
     "notes": "User feedback text"
   }
   ```

**Live Parsing Implementation** (server.py lines 130-180):
```python
def serve_chordpro(self, filename):
    html_path = Path('html') / filename

    with open(html_path, 'r', encoding='utf-8', errors='ignore') as f:
        html_content = f.read()

    # Parse HTML (live, using current parser code)
    soup = BeautifulSoup(html_content, 'html.parser')
    structure_type = StructureDetector.detect_structure_type(soup)

    if not structure_type:
        return error("Could not determine structure type")

    song = ContentExtractor.parse(soup, structure_type, filename)
    chordpro = ChordProGenerator.song_to_chordpro(song)

    # Return ChordPro text
    self.send_response(200)
    self.send_header('Content-Type', 'text/plain')
    self.wfile.write(chordpro.encode())
```

**Why live parsing?**: Enables rapid iteration. Make parser changes, refresh browser, see updated output immediately (no batch reprocessing needed).

### index.html - Single-Page UI

**Framework**: Vanilla JavaScript (no dependencies)

**Layout**: Three-column responsive design
- Left: File list with structure type badges
- Middle: Original HTML preview (iframe)
- Right: Generated ChordPro (monospace pre block)

**Feedback Form**:
- Status: Radio buttons (correct/minor/wrong)
- Notes: Textarea for detailed feedback
- Submit: POST to `/api/feedback`, append to JSONL

**Keyboard Navigation**:
- Click file to load
- Status and notes update per-file
- Submit saves feedback and moves to next file

**Progress Tracking**: Shows X/N files reviewed (based on feedback.jsonl entries)

### feedback.jsonl - Feedback Log

**Format**: JSON Lines (one object per line)

**Schema**:
```json
{"file": "filename.html", "status": "correct", "notes": ""}
{"file": "filename.html", "status": "minor", "notes": "Verse 1 split incorrectly"}
{"file": "filename.html", "status": "wrong", "notes": "All verses merged, chords missing"}
```

**Usage**:
- Appended to by server on each feedback submission
- Can contain multiple entries for same file (progressive refinement)
- Analyze with: `grep '"status": "wrong"' viewer/feedback.jsonl`
- Count by status:
  ```bash
  grep '"status": "correct"' viewer/feedback.jsonl | wc -l
  grep '"status": "minor"' viewer/feedback.jsonl | wc -l
  grep '"status": "wrong"' viewer/feedback.jsonl | wc -l
  ```

## Validation Workflow

1. **Generate sample**:
   ```bash
   uv run python3 create_new_spot_check.py
   ```
   Creates `stratified_sample_spot_check.json` with 10 files (proportional by structure type)

2. **Start viewer**:
   ```bash
   python3 viewer/server.py
   ```

3. **Review files**:
   - Open http://localhost:8000
   - Click each file in list
   - Compare HTML (left) vs ChordPro (right)
   - Mark status: correct/minor/wrong
   - Add notes explaining issues
   - Submit feedback

4. **Analyze feedback**:
   ```bash
   # Read latest feedback
   tail -20 viewer/feedback.jsonl

   # Count by status
   grep -c '"status": "correct"' viewer/feedback.jsonl
   grep -c '"status": "minor"' viewer/feedback.jsonl
   grep -c '"status": "wrong"' viewer/feedback.jsonl

   # Find specific issues
   grep '"status": "wrong"' viewer/feedback.jsonl | jq .
   ```

5. **Fix issues in parser**, then **refresh browser** to see updated output (no rebuild needed!)

## Validation Criteria

### "correct" ✓
- All verses detected and separated correctly
- Chords aligned at correct lyric positions
- Metadata extracted (title, artist, composer)
- Repeat directives handled properly
- No extraneous content (boilerplate, footer)

### "minor" ⚠
- Minor verse boundary issues (over-split or under-split)
- Metadata partially missing (e.g., composer not extracted)
- Chord alignment off by 1-2 characters
- "Tag:" directive appearing as lyrics (known edge case)
- Footer boilerplate sometimes captured

### "wrong" ✗
- No verses detected
- All verses merged into one
- Chords completely missing or misaligned
- Repeat directives ignored
- Title/artist completely wrong or missing

## Quality Evolution

**Validation history** (from feedback.jsonl):

| Sample | Correct | Minor | Wrong | Notes |
|--------|---------|-------|-------|-------|
| 1st    | 5/10 (50%) | 3/10 | 2/10 | Initial quality baseline |
| 2nd    | 7/10 (70%) | 2/10 | 1/10 | After verse boundary + NavigableString fixes |
| 3rd    | 10/10 (100%) | 0/10 | 0/10 | After multi-verse repeat support |

**Key improvements between samples**:
1. Pre_plain verse boundary rule (2+ blank lines)
2. Pre_tag NavigableString detection fix
3. Multi-verse repeat syntax ("Repeat #4,5")

## Common Validation Patterns

**Verse boundary issues**:
- Look for blank lines in HTML
- Count verses in HTML vs ChordPro
- Check if verses are over-split (too many) or under-split (merged)

**Chord alignment issues**:
- Pick a specific chord in HTML
- Find corresponding lyric syllable
- Verify chord appears immediately before that syllable in ChordPro
- Example: HTML has `G7` above `cow`, ChordPro should have `[G7]cow`

**Repeat directive issues**:
- Find "Repeat #N" in HTML
- Count verse occurrences in ChordPro
- Verse N should appear twice (or more if multiple repeats)
- Multi-verse: "Repeat #4,5" should output verse 4, then verse 5

**Metadata extraction**:
- Check `{title: ...}` matches HTML title or first line
- Check `{artist: ...}` matches "Recorded by" in HTML
- Check `{composer: ...}` matches "Written by" in HTML

## Debugging Tips

### Serve Errors

If `GET /api/chordpro/{filename}` returns error:
1. Check parser error in terminal running server
2. Common issues:
   - "Could not determine structure type" - HTML doesn't match any pattern
   - AttributeError - Bug in parser code (check recent changes)
   - KeyError - Missing expected HTML element

### Compare Live vs Batch

**Live** (viewer): Uses current parser code
**Batch** (output/): Uses parser code from last batch run

If viewer shows different output than `output/{filename}.pro`:
- Parser was changed since last batch run
- Run `uv run python3 batch_process.py` to update batch output

### Missing Files

If file list is empty:
- Check `stratified_sample_spot_check.json` exists
- Run `uv run python3 create_new_spot_check.py` to generate sample
- Ensure `batch_processing_report.json` exists (needed to generate sample)

## Future Enhancements

1. **Diff view** - Highlight differences between old and new parser output
2. **Batch feedback** - Mark multiple files at once
3. **Filter by status** - Show only wrong/minor files
4. **Search** - Find files by name or structure type
5. **Statistics** - Show success rate, common issues
6. **Export** - Generate report from feedback.jsonl

## Integration with Development Workflow

```bash
# 1. Make parser changes
vim src/chordpro_parser/parser.py

# 2. Review changes immediately (no rebuild)
# - Server already running (python3 viewer/server.py)
# - Refresh browser to see updated output

# 3. When satisfied, run full batch
uv run python3 batch_process.py

# 4. Generate new sample for validation
uv run python3 create_new_spot_check.py

# 5. Validate sample in viewer
# Visit http://localhost:8000

# 6. Iterate as needed
```

**Key insight**: Live parsing in viewer enables rapid iteration without waiting for full batch processing (6+ minutes for 17,381 files).
