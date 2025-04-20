import re
import logging
from bs4 import BeautifulSoup
from collections import Counter
from pathlib import Path
from html import unescape
from .base import BaseParser

CHORD_PATTERN = re.compile(
  r'\b([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)\b'
)

class ClassicCountrySongLyricsParser(BaseParser):
  def __init__(self, file_path: str):
    self._file_path = Path(file_path)
    self._title = None
    self._artist = None
    self._lines = None
    self._chords = None
    with self._file_path.open() as f:
      self._file_string = f.read()
    self._soup = BeautifulSoup(self._file_string, 'html.parser')

  def get_title(self) -> str:
    if self._title is None:
      self._title, _ = self._parse_title_and_artist()
    return self._title

  def get_artist(self) -> str:
    if self._artist is None:
      _, self._artist = self._parse_title_and_artist()
    return self._artist

  def get_chords(self) -> Counter:
    if self._chords is None:
      self._chords = self._parse_chords()
    return self._chords

  def get_song(self) -> list[dict[str, str]]:
    if self._lines is None:
      self._chords = self.get_chords()
      lines = self._parse_song_from_span(self.get_artist(), self.get_title())
      self._lines = self._process_lyric_lines(lines, self._chords)
    # Implement a check to avoid false positives.
    # Error case detected in nowandforeverlyricschords.html which presented in commit 
    # aeaf1aa60edb07c48428c89e81078f0b954a352e where this song shows as correctly parsed (it is not). This case is
    # detectable because while the regex for chords is correct, the chord lines do not have all the chords.
    chord_check_results, regex_chord_set, line_chord_set = self.check_chords(self.get_chords(), self._lines)
    if not chord_check_results:
      self._lines = []
      raise ValueError(f"Chord sets do not match. Regex extracted chords: {regex_chord_set}, Line extracted chords: {line_chord_set}")


    return self._lines

  def to_dict(self) -> dict:
    return {
      "title": self.get_title(),
      "chords": self.get_chords(),
      "artist": self.get_artist(),
      "lines": self.get_song()
    }
  
  @classmethod
  def check_chords(cls, chords: list[str], lines: list[dict]) -> bool:
    """
    Processe cls.get_chords() against cls._lines to check if all the chords are present.
    """
    line_chord_set = set()
    for line in lines:
      line_chords = [ch.strip() for ch in line['chords'].split()]
      line_chord_set.update(line_chords)
    regex_chord_set = set(chords)
    return line_chord_set == regex_chord_set, regex_chord_set, line_chord_set


  def _parse_title_and_artist(self) -> tuple[str, str]:
    title, artist = "NO TITLE FOUND", "NO ARTIST FOUND"
    tag = self._soup.find("title")
    if tag and "|" in tag.text:
      parts = [part.strip() for part in tag.text.split("|")]
      if len(parts) == 2:
        raw_title, raw_artist = parts
        title = re.sub(r"lyrics( and)? chords", "", raw_title, flags=re.IGNORECASE).strip()
        artist = raw_artist.strip()
    return title, artist

  def _parse_chords(self) -> Counter:
    clean_text = re.sub(r"\s", " ", self._soup.get_text())
    return list(Counter(CHORD_PATTERN.findall(clean_text)).keys())

  # Parses the song content from a sequence of <span> tags.
  # This logic assumes a known structure from classic-country-song-lyrics.com:
  # - Chords and lyrics are stacked inside <span> elements in alternating lines
  # - The song begins after the artist/title span
  # - The song ends when a known "end marker" string appears
  # - Whitespaces are flattened (\n, \t, \r, \u00a0) but spacing between tokens is preserved for chord alignment
  # NOTE: We keep two versions of the text:
  # - `flat` is normalized for detecting the end marker reliably
  # - `text` preserves visual structure for accurate spacing
  def _parse_song_from_span(self, artist: str, title: str) -> list[str]:
    """
    Assumes all chords and lyrics are stored in <span> tags.
    Song starts shortly after spans containing artist and title.
    Song ends when a span contains the full known end marker string.
    """
    END_MARKER = 'if you want to change the "key" on any song'

    spans = self._soup.find_all('span')
    lines = []
    capturing = False

    for i, span in enumerate(spans):
      raw = unescape(span.string or '')
      flat = re.sub(r"\s", " ", raw).strip().lower()
      text = raw.replace(" ", " ").replace("\n", " ").replace("\r", " ").replace("\t", " ")

      if not capturing:
        prev_1 = spans[i - 1].get_text(strip=True) if i > 0 else ""
        prev_2 = spans[i - 2].get_text(strip=True) if i > 1 else ""
        if (
          (title.lower() in prev_1.lower() or title.lower() in prev_2.lower()) and
          (artist.lower() in prev_1.lower() or artist.lower() in prev_2.lower())
        ):
          capturing = True
          continue

      if capturing:
        if END_MARKER.lower() in flat:
          break
        lines.append(text if text.strip() else "$$EMPTY_LINE$$")

    return lines

  @classmethod
  def check_if_line_is_chord(cls, line: str, chords: list) -> bool:
    return all(token in chords for token in line.split())

  @classmethod
  def _process_lyric_lines(cls, lyric_lines: list[str], chords: list) -> list[dict[str, str]]:
    processed = []
    skip_next = False

    for i in range(len(lyric_lines) - 1):
      if skip_next:
        skip_next = False
        continue

      line = lyric_lines[i]
      next_line = lyric_lines[i + 1]

      if line == "$$EMPTY_LINE$$":
        processed.append({"chords": "", "lyrics": ""})
      elif cls.check_if_line_is_chord(line.strip(), chords):
        processed.append({"chords": line.rstrip("\n"), "lyrics": next_line.rstrip("\n")})
        skip_next = True
      else:
        processed.append({"chords": "", "lyrics": line.rstrip("\n")})

    return processed
