# Project: HTML Song Scrape to ChordPro Converter

## 1. Overview & Goal

The primary goal of this project is to develop a robust parser that can convert a large corpus of scraped HTML files, containing song lyrics and chords, into the ChordPro format. These HTML files originate from `https://www.classic-country-song-lyrics.com` and generally render song content in a fixed-width ASCII style, with chords positioned above the corresponding lyrics.

This system needs to handle inconsistencies in the source HTML and accurately preserve the musical information, especially the relationship between chords and lyrics, and the song's structure (verses, choruses, playback order).

## 2. Input Data

The input for this project will be a directory named `html/` located in the root of this repository. This directory contains numerous HTML files.

**Key characteristics of the input HTML files:**

* **Source:** Scraped from `www.classic-country-song-lyrics.com`.
* **Relevant Files:** Files most likely to contain processable song content often include "lyrics" in their filename. The system should be configured to process these.
* **General HTML File Structure (Observed Pattern):**
    * **Pre-Song Boilerplate:** Most song pages contain a common textual blurb *before* the main song content and metadata. (e.g., "Low prices on Books, Kindles Classic Country Music Cds..."). This can be used as a starting anchor to isolate relevant content.
    * **Metadata Section:** Information such as "Title," "Artist," "Recorded by," and "Written by" is usually present, typically appearing before the song's lyrics and chords. The exact HTML markup for this metadata varies.
    * **Song Content (Lyrics & Chords):**
        * Rendered in a way that simulates fixed-width font display in a browser.
        * Chords are placed directly above the lyric syllables/words they correspond to.
        * The HTML implementation of this varies significantly (see Section 4.1).
    * **Post-Song Boilerplate:** A common textual blurb often appears *after* the song lyrics and chords (e.g., "If you want to change the "Key" on any song..."). This can be used as an ending anchor.
    * **Paragraphs/Playback Instructions:** Some songs have explicit or implicit paragraph breaks (for verses/choruses) and may contain textual playback instructions like "Repeat #3 x2".

## 3. Desired Output Format

### 3.1. Primary Output: ChordPro Files

For each successfully parsed input HTML file, a corresponding `.pro` (ChordPro) file should be generated.

**Critical Requirements for ChordPro Output:**

* **Chord-Lyric Alignment:** This is paramount. Chords (`[C]`, `[G7]`, etc.) **must** be inserted directly before the specific syllable or word in the lyric line they are played over. The horizontal positioning from the fixed-width HTML layout must be accurately translated.
* **Paragraph Structure (Verses/Choruses):**
    * The parser **must** identify distinct blocks of lyrics/chords (which we've referred to as "paragraphs"). These represent verses, choruses, bridges, etc.
    * In ChordPro, these should be clearly delineated. Options include:
        * Using comment directives: `{comment: Verse 1}`, `{c: Chorus}`.
        * If verse types can be programmatically identified (e.g., by labels in the HTML or common patterns), use ChordPro directives like `{start_of_verse: Verse 1}` (`{sov}`), `{start_of_chorus}` (`{soc}`), and their corresponding end tags (`{eov}`, `{eoc}`). If not, generic comments are acceptable.
* **Metadata Directives:**
    * `{title: Song Title}` or `{t: Song Title}`
    * `{artist: Artist Name}` or `{a: Artist Name}` (usually the performer)
    * `{composer: Composer Name(s)}` or `{c: Composer Name(s)}` (often from "Written by")
    * Consider using `{meta: Recorded By: Recording Artist}` for recording information if distinct from the main artist.
* **Playback Instructions:**
    * Instructions like "Repeat #N xM" **must** be parsed.
    * The ChordPro output should reflect this playback order. Since ChordPro doesn't have a native "repeat block N" directive, this means the actual ChordPro blocks for the repeated paragraphs should be duplicated in the output sequence.

### 3.2. Recommended Intermediate Representation: JSONL

To decouple the complex HTML parsing logic from the ChordPro generation and to facilitate debugging and potential future uses, it is **highly recommended** to first parse the HTML into a structured JSON format (one JSON object per line in a `.jsonl` file, one object per song).

**Proposed JSONL Structure per Song:**

```json
{
  "title": "Extracted Song Title",
  "artist": "Extracted Artist Name (Performer)",
  "composer": "Extracted Composer/Author (Written By)",
  "recorded_by": "Extracted Recording Artist Info (if available)",
  "source_html_file": "original_filename.html",
  "song_content": {
    "paragraphs": [
      {
        "lines": [
          {
            "lyrics": "The actual lyric line text.",
            "chords": [
              {"chord": "G", "position": 0},
              {"chord": "Cmaj7", "position": 15}
            ]
          },
          {
            "lyrics": null,
            "chords_line": "Am G C F"
          },
          {
            "lyrics": "This lyric line has no chords.",
            "chords": []
          }
        ]
      }
    ],
    "playback_sequence": [0, 1, 0, 2],
    "raw_repeat_instruction_text": "Repeat #1 x2"
  }
}
```
## 4. Key Challenges & Parsing Instructions

The core challenge lies in the variability of the input HTML. A pre-analysis (using a script like `counter.py`) has confirmed that multiple distinct HTML structures are used to represent song data across the corpus.

### 4.1. HTML Structure Variability & Detection
* **Instruction:** The parser **must not** assume a single, fixed HTML structure. It needs to be designed to handle several common patterns.
* **Common Structures Identified:**
    1.  **`<pre>` Tag Dominant:** Song content (metadata, chords, lyrics) is primarily within a `<pre>` tag.
        * Lines are typically delimited by newline characters (`\n`) in the text content of the `<pre>`.
        * **Paragraph Breaks:**
            * Sometimes indicated by `<br>` tags *inside* the `<pre>` tag.
            * Other times, especially if a nested `<font face="Lucida Console">` (or similar) is the primary content holder within `<pre>`, paragraph breaks might be indicated by multiple consecutive newline characters (e.g., `\n\n`).
    2.  **`<span>` + `<br>` Sequence:** Song content is a sequence of `<span>` tags (often styled with `font-family: Courier New` or a similar fixed-width font), with `<br>` tags acting as line terminators and typically being siblings to the `<span>`s.
        * **Paragraph Breaks:** Likely indicated by multiple consecutive `<br>` tags, or a `<span>` containing only `&nbsp;` followed by its `<br>`, then another `<br>`.
* **Recommendation:** Implement a strategy-based parser. First, determine the structural type of the song snippet (e.g., based on the presence and arrangement of `<pre>`, specific `<span>`s, etc.), then apply a parsing strategy tailored to that type.

### 4.2. Metadata Extraction
* **Instruction:** Robustly extract Title, Artist, Composer ("Written by"), and "Recorded by" information.
* **Location & Markup:** This information is often found *before* the main block of chords and lyrics. It can be in `<h3>` tags, `<b>` tags, plain text lines, or embedded within the initial part of a `<pre>` block. The HTML `<title>` tag might also contain the song title and artist.
* **Heuristics:** Develop heuristics to identify and correctly label these metadata fields. For example, lines containing "Recorded by:" or "Written by:".

### 4.3. Paragraph Segmentation (Verses, Choruses)
* **CRITICAL INSTRUCTION:** The parser **must** accurately segment the song content into "paragraphs" (logical blocks like verses, choruses, bridges, intros, outros). These correspond to the elements in the `song_content.paragraphs` array in the JSONL.
* **Detection:** Utilize the paragraph break indicators specific to the HTML structure type (as outlined in 4.1). Differentiate these from single line breaks between a chord line and its lyric line, or between two lyric lines of the same verse.

### 4.4. Chord & Lyric Line Processing
* **CRITICAL INSTRUCTION:** For each paragraph, accurately pair chord lines with their corresponding lyric lines and determine the precise alignment of each chord.
* **Line Type Identification:**
    * Assume an alternating pattern (chord line, then lyric line) is common but not universal.
    * Chord lines predominantly feature chord notation (e.g., `G`, `Am7`, `C/G`, `F#m`) and whitespace. Regex can be very helpful here.
    * Lyric lines contain prose.
* **Handling Variations:**
    * **Instrumental Lines:** A line containing only chord patterns with no subsequent lyric line. Store as `{"lyrics": null, "chords_line": "G C G D"}`.
    * **Lyrics without Chords:** A lyric line with no chords printed above it. Represent as `{"lyrics": "...", "chords": []}`.
    * **Sustained Chords:** An empty (whitespace only) line where a chord line would be, above a lyric line, indicates the previous chord(s) are sustained. No new chord objects are needed for the lyric line at that point for the sustain.
* **Chord Alignment (for `song_content.paragraphs[i].lines[j].chords` array):**
    * This requires careful parsing of the chord line. For each recognized chord on the chord line, its starting character position (0-indexed) on that line is the key.
    * This character position needs to be mapped to the `position` field in the `{"chord": "Name", "position": index}` object, relative to the start of the *lyric line below it*.
    * The fixed-width nature of the original HTML is the basis for this positional mapping.

### 4.5. Playback Instructions ("Repeat #X")
* **CRITICAL INSTRUCTION:** The parser **must** detect and interpret instructions like "Repeat #3 x2", "Repeat verse 1", etc. These are usually found at the end of the song lyrics/chords.
* **Parsing:**
    * "N" in "Repeat #N" is typically a 1-indexed paragraph number.
    * "xM" indicates the number of additional times to play (e.g., x2 means play twice in total, or play one additional time after the first). Clarify interpretation or make it consistent. A common interpretation is "repeat the Nth paragraph M times in total".
* **Storing:** Populate the `song_content.playback_sequence` array in the JSONL based on these instructions. If no such instruction, the sequence is the default order of paragraphs. Store the `raw_repeat_instruction_text` as well.

## 5. Development Strategy & Approach (Suggestions)

* **Utilize Pre-Analysis:** The `counter.py` script (developed in prior stages) identifies different HTML structural signatures. Use its output to prioritize which HTML patterns to build parser strategies for first.
* **Modular Parser Functions:**
    * `extract_song_snippet(html_content, start_anchor_text, end_anchor_text)`: Isolates the relevant part of the HTML.
    * `determine_structure_type(snippet_soup)`: Classifies the snippet.
    * `parse_metadata(snippet_soup, structure_type)`
    * `segment_paragraphs(snippet_soup, structure_type)`
    * `process_paragraph_lines(paragraph_html_or_text, structure_type)`: Extracts aligned chords/lyrics for lines within one paragraph.
    * `parse_repeat_instructions(snippet_text)`
    * `generate_chordpro(parsed_json_data)`
* **Iterative Development:**
    1.  Implement parsing for the most common HTML structure identified.
    2.  Thoroughly test with multiple example files of that structure (the `tests/type_XXX` directories created by `counter.py` will be essential).
    3.  Gradually add support for other identified HTML structures.
* **Error Handling & Logging:** Implement robust error handling for files that don't conform. Log issues, malformed structures, and unparseable sections clearly. Outputting problematic file names is crucial.

## 6. Suggested Tools & Libraries (Python Context)

* **HTML Parsing:** `BeautifulSoup4` (bs4)
* **Pattern Matching:** Regular Expressions (`re` module) for chord patterns, metadata keywords, and repeat instructions.
* **File System & Utilities:** `os`, `shutil` (if any file operations are needed beyond reading).

## 7. What to Avoid

* **Hardcoding for a Single HTML Structure:** This will fail given the known variability.
* **Losing Chord-Lyric Alignment:** The precise horizontal positioning is key. Simple text extraction without careful alignment will render the output musically incorrect.
* **Ignoring Paragraph Structure:** Flattening the song into a single block of lines will lose verse/chorus distinctions and make "Repeat #X" impossible to interpret correctly.
* **Discarding "Repeat #X" Instructions:** These are integral to the song's performance.
* **Fragile Metadata Extraction:** Relying on overly specific CSS selectors for metadata if the markup is inconsistent. Keyword and pattern-based searching within relevant text blocks might be more robust.

By following these instructions, the LLM agent should be well-equipped to develop an effective parser that meets the project's critical requirements.
