# Traditional Music UK Source

Chord data from [traditionalmusic.co.uk](https://www.traditionalmusic.co.uk/), a massive hand-built archive of 200,000+ pages of traditional, folk, and old music.

## Status: INDEXED - PARTIAL FETCH

## Site Characteristics

- **No search function** - Hand-built static site
- **No sitemap.xml** - But has URL lists in robots.txt
- **Mixed formats**: Text chords, images (PNG), PDFs
- **200,000+ pages** across many collections

## Relevant Collections

| Collection | Pages | Format |
|------------|-------|--------|
| top-bluegrass-chords | 1,895 | Images/PDF |
| country-music | 7,317 | Mixed |
| carter-family-songs | 231 | **Text chords** |
| folk-song-lyrics | 3,755 | Mixed |
| gospel-songs-chords | 1,211 | Mixed |
| country-gospel-chords | 1,773 | Mixed |
| old-time-music | 1,287 | Mixed |
| johnny-cash | 1,488 | Mixed |
| hank-williams | 358 | Mixed |
| willie-nelson | 803 | Mixed |
| dolly-parton | 631 | Mixed |

## Current State

### Index Built
- Downloaded all 6 URL lists (200,966 URLs)
- Filtered to relevant collections (35,310 songs)
- Built searchable index by normalized title

### BluegrassLyrics Matching
- Matched against 995 new BluegrassLyrics songs
- **237 exact matches**, 99 fuzzy matches
- 65 Carter Family songs have parseable text chords
- Other collections use images/PDFs (need OCR)

### Chord Fetching
- Fetched 65 Carter Family chord pages
- Chords are inline `[D]text[G]format` (ChordPro compatible)
- Saved to `fetched_chords.json`

## Chord Format Analysis

### Carter Family (text - works)
```
[D]There was a little ship
And she went by the name of the [G]Merry Golden Tree
```

### Other collections (images - need OCR)
- Chords stored as PNG images
- Would need OCR to extract
- Examples: top-bluegrass-chords, gospel-songs-chords

## File Structure

```
traditional-music-uk/
├── urllist*.txt        # Raw URL lists from site
├── build_index.py      # Build searchable index
├── match_bluegrass_lyrics.py  # Match against BL songs
├── fetch_chords.py     # Fetch text chord pages
├── song_index.json     # 35K relevant songs indexed
├── bl_match_results.json  # Matches with BluegrassLyrics
├── fetched_chords.json # 65 songs with text chords
├── raw/                # Cached HTML (gitignored)
├── parsed/             # Parsed chord data
└── CLAUDE.md           # This file
```

## Next Steps

1. [ ] Merge 65 text chord songs with BluegrassLyrics lyrics
2. [ ] Research OCR for image-based chord sheets
3. [ ] Identify which other collections have text vs image chords
4. [ ] Consider full site crawl for comprehensive indexing

## OCR Options to Research

- **Tesseract** - Free, open source, good for clean text
- **Claude Vision** - Could parse chord sheet images directly
- **Google Cloud Vision** - High quality, has cost
- **Music-specific OCR** - May exist for chord/tab recognition

## Attribution

When using chords from this source:
```chordpro
{meta: x_chords_source traditional-music-uk}
{meta: x_chords_url http://www.traditionalmusic.co.uk/carter-family-songs/song.htm}
```
