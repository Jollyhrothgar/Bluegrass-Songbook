# ChordPro Parser - Final Results

## Summary

Successfully converted **17,122 out of 17,381 HTML files** to ChordPro format (**98.5% success rate**).

## Performance

- **Total files processed:** 17,381
- **Successful conversions:** 17,122 (98.5%)
- **Failed conversions:** 259 (1.5%)
- **Processing time:** 310 seconds
- **Speed:** 56 files/second (using 16 threads)

## Structure Type Distribution

| Type | Count | Percentage |
|------|-------|------------|
| pre_plain | 10,227 | 59.7% |
| pre_tag | 5,450 | 31.8% |
| span_br | 1,445 | 8.4% |

## Key Improvements Made

### 1. Metadata Extraction
- Extracts title, artist, composer/writer from HTML
- Maps "Recorded by" to `{meta: artist}`
- Maps "Written by" to `{meta: writer}`
- Uses `{meta: tagname value}` format for all metadata

### 2. Verse Boundary Detection
- **pre_plain parser:** Detects verse boundaries using:
  - 2+ consecutive blank lines = always a verse boundary
  - Single blank line + chord line = verse boundary
  - Single blank line + lyrics = internal spacing (not a boundary)
- **pre_tag parser:** Handles both `<span>` elements and direct text nodes
- **span_br parser:** Walks DOM in document order to capture all `<br>` tags

### 3. Repeat Directive Support
- Detects "Repeat #N" instructions in all three parsers
- Duplicates referenced verses in ChordPro output
- Maintains correct playback sequence

### 4. Chord Alignment Preservation
- Maintains exact horizontal positioning from fixed-width HTML
- Inserts chords at correct positions in lyrics

## Known Limitations

### Failed Files (259 files, 1.5%)
- **Root cause:** HTML structure doesn't match any of the three supported patterns
- **Error:** "Could not determine structure type"
- **Examples:** Files with malformed HTML, missing `<br>` tags, or unusual layouts

### Quality Issues (from spot-check sample)
Some successfully parsed files may have:
- Over-split or under-split verses (especially in pre_tag files with complex layouts)
- Missing "Tag:" or special directive handling
- Malformed HTML rendering issues

## Output

- **Location:** `output/` directory
- **Format:** `.pro` files (ChordPro format)
- **Naming:** Same as input filename with `.pro` extension
- **Encoding:** UTF-8

## Files

- `batch_process.py` - Main batch processing script
- `batch_processing_report.json` - Detailed results
- `src/chordpro_parser/parser.py` - Core parser implementation
- `viewer/server.py` - Web-based validation UI

## Recommendations

1. **Production use:** The 98.5% success rate is production-ready for the vast majority of files
2. **Failed files:** The 259 failures can be:
   - Manually reviewed and converted
   - Excluded from the corpus
   - Fixed with additional HTML structure patterns (if patterns emerge)
3. **Quality validation:** Spot-check output files before final use

## Next Steps (Optional)

1. Investigate the 259 failed files to identify common patterns
2. Add additional HTML structure patterns if needed
3. Implement more sophisticated verse boundary heuristics
4. Add support for additional ChordPro directives (bridge, instrumental, etc.)
