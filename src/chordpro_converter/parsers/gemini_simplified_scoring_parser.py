import re
from bs4 import BeautifulSoup
from typing import List, Tuple, Dict, Optional
import logging
from html import unescape  # Import unescape


class ScoringParser:
    """
    Parses HTML to extract song lyrics and chord information.
    """

    CHORD_PATTERN = re.compile(
        r'\b([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)\b'
    )
    JUNK_PHRASES = [
        "freefind", "prices on", "classic country music cds", "country gospel cds",
        "download classic country", "click here", "lyrics are the property",
        "key changer", "this software was developed", "banner", "mp3s",
        "most only $.99", "search engine", "classic country music",
        "if you want to change the \"key\""
    ]
    WINDOW_SIZE = 30

    def __init__(self, html: str):
        self.soup = BeautifulSoup(html, "html.parser")
        self.span_lines = self._extract_spans_or_pre()
        self.chord_set = self._extract_chords()
        self.title, self.artist, self.writer = self._extract_metadata()
        self._used_pre = False  # Initialize here

    def _extract_spans_or_pre(self) -> List[str]:
        """Extracts lines from <pre> or <span> tags."""
        pre = self.soup.find("pre")
        if pre:
            self._used_pre = True
            return [line.rstrip("\n") for line in pre.get_text("\n").splitlines()]
        courier_spans = self.soup.find_all("span",
                                          style=lambda s: s and ("Courier New" in s or "Courier" in s))
        if courier_spans:
            return [unescape(span.get_text(" ")).replace("\xa0", " ").replace("\n",
                                                                              " ").strip("\n").rstrip()
                    for span in courier_spans if span.get_text().strip()]
        return []

    def _extract_chords(self) -> set[str]:
        """Extracts unique chord symbols."""
        return set(self.CHORD_PATTERN.findall(" ".join(self.span_lines)))

    def _score_block(self, block: List[str]) -> int:
        """Scores a block of text based on chord presence and line length."""
        score = 0
        for line in block:
            tokens = line.strip().split()
            if not tokens:
                score += 1
            elif all(t in self.chord_set for t in tokens):
                score += 5
            elif any(t in self.chord_set for t in tokens):
                score += 2
            elif len(tokens) >= 4:
                score += 2
        return score

    def _sliding_windows(self, window_size: int = WINDOW_SIZE) -> List[Tuple[int, List[str]]]:
        """Generates sliding windows of text."""
        return [(i, self.span_lines[i:i + window_size]) for i in
                range(len(self.span_lines) - window_size + 1)]

    def find_best_block(self, window_size: int = WINDOW_SIZE) -> List[str]:
        """Finds the best block of lyrics based on scoring."""
        lower_lines = [line.lower() for line in self.span_lines]
        start_idx = next(
            (i + 1 for i, line in enumerate(lower_lines) if
             self.title.lower() in line or self.artist.lower() in line), 0)

        candidates = self._sliding_windows(window_size)
        if not candidates:  # handle the case where span_lines is empty
            return []

        best_start, best_block = max(candidates, key=lambda item: self._score_block(item[1]),
                                      default=(0, []))

        extended = list(best_block)
        trailing_score = 0
        for line in self.span_lines[best_start + len(best_block):]:
            if not line.strip() or any(t in self.chord_set for t in line.strip().split()):
                extended.append(line)
                trailing_score = 0
            elif len(line.strip().split()) >= 4 and not any(
                    p in line.lower() for p in self.JUNK_PHRASES):
                extended.append(line)
                trailing_score = 0
            else:
                trailing_score += 1
                if trailing_score >= 2:
                    break
                extended.append(line)

        while extended and (not extended[0].strip() or "written by" in extended[0].lower() or
                           any(p in extended[0].lower() for p in self.JUNK_PHRASES) or
                           self.artist.lower() in extended[0].lower() or self.title.lower() in
                           extended[0].lower()):
            extended.pop(0)
        while extended and any(p in extended[-1].lower() for p in self.JUNK_PHRASES):
            extended.pop()
        return extended

    def to_dict(self) -> Dict[str, any]:
        """Converts parsed data to a dictionary."""
        block = self.find_best_block()
        lines = []
        for i, line in enumerate(block):
            line = line.replace("\n", " ").rstrip()
            if not line.strip():
                lines.append({"chords": "", "lyrics": ""})
                continue
            if any(phrase in line.lower() for phrase in self.JUNK_PHRASES):
                continue

            tokens = line.strip().split()
            is_chord_line = tokens and all(t in self.chord_set for t in tokens)

            if is_chord_line and i + 1 < len(block):
                next_line = block[i + 1].replace("\n", " ").rstrip()
                next_tokens = next_line.strip().split() if next_line else [] # FIX: Define next_tokens
                if next_line and not any(t in self.chord_set for t in next_tokens):
                    lines.append({"chords": line.rstrip(), "lyrics": next_line.rstrip()})
                    i += 2
                    continue
                else:
                    lines.append({"chords": line.rstrip(), "lyrics": ""})
                    i += 1
                    continue

            if self.CHORD_PATTERN.fullmatch(line.strip()) and i + 1 < len(block):
                next_line = block[i + 1].replace("\n", " ").rstrip()
                if len(next_line.split()) >= 3:
                    lines.append({"chords": line.rstrip(), "lyrics": next_line})
                    i += 2
                    continue

            chord_match = self.CHORD_PATTERN.search(line)
            if chord_match and len(tokens) == 1 and i + 1 < len(block):
                next_line = block[i + 1].replace("\n", " ").rstrip()
                lines.append({"chords": line.rstrip(), "lyrics": next_line.rstrip()})
                i += 2
                continue

            if i > 0 and lines and lines[-1]["chords"] and not lines[-1]["lyrics"]:
                lines[-1]["lyrics"] = line
            else:
                lines.append({"chords": "", "lyrics": line})
            i += 1
        return {
            "title": self.title,
            "artist": self.artist,
            "writer": self.writer,
            "lines": lines,
            "chords": sorted(self.chord_set)
        }

    def _extract_metadata(self) -> Tuple[str, str, Optional[str]]:
        """Extracts title, artist, and writer from HTML."""
        tag = self.soup.find("title")
        if not tag or "|" not in tag.text:
            logging.warning("Title tag not found or malformed.")
            return "NO TITLE FOUND", "NO ARTIST FOUND", None
        raw_title, raw_artist = [part.strip() for part in tag.text.split("|", 1)]
        title = re.sub(r"lyrics( and)? chords", "", raw_title, flags=re.IGNORECASE).strip()
        artist = raw_artist.strip()
        writer = None
        if self._used_pre:
            pre = self.soup.find("pre")
            if pre:
                lines = pre.get_text("\n").splitlines()
                for line in lines[:10]:
                    if "written by" in line.lower():
                        writer = line.strip()
                        break
        return title, artist, writer

