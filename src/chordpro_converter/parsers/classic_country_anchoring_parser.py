import re
import logging
from bs4 import BeautifulSoup
from collections import Counter
from pathlib import Path
from html import unescape
from .base import BaseParser
import logging
logger = logging.getLogger("bluegrass_songbook_logger")


CHORD_PATTERN = re.compile(
  r'\b([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)\b'
)

class AnchoringParser(BaseParser):
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

    # Validate chord integrity
    chord_check_results, regex_chord_set, line_chord_set = self.check_chords(self.get_chords(), self._lines)
    if not chord_check_results:
        logger.warning(
            "Chord mismatch in file %s\n"
            "Title: %s | Artist: %s\n"
            "Regex chords: %s\n"
            "Line chords: %s\n",
            self._file_path.name,
            self.get_title(),
            self.get_artist(),
            sorted(regex_chord_set),
            sorted(line_chord_set)
        )
        self._lines = []
    # Validate lyric token count:
    lyric_token_threshold = 30
    if self.get_lyric_token_count(self._lines) < lyric_token_threshold:
        logger.warning(
            f"Lyric token count ({lyric_token_threshold}) is too low for file %s\n"
            "Title: %s | Artist: %s\n",
            self._file_path.name,
            self.get_title(),
            self.get_artist()
        )
        self._lines = []
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

  @classmethod
  def get_lyric_token_count(cls, lines: list[dict]) -> int:
    """
    Returns the number of tokens in the lyrics.
    """
    tokens_count = 0
    for line in lines:
      tokens_count += len(line['lyrics'].split())
    return tokens_count


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
  
  # Brute force filter boilerplate.
  def _is_boilerplate_line(self, text: str) -> bool:
    text = text.lower().strip()
    return any([
      "lyrics and chords are intended for your personal use" in text,
      "low prices on" in text,
      "easy to download" in text,
      "country gospel cd" in text,
      "most only $.99" in text,
      "freefind" in text
    ])


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
    Parses song content from <span> tags using the first exact, non-boilerplate title match.
    - Skips known boilerplate before and during capture
    - Strips junk lines between anchor and real song
    - Stops at known END_MARKER
    """
    END_MARKER = 'if you want to change the "key" on any song'

    spans = self._soup.find_all('span')
    lines = []

    normalized_title = re.sub(r"\s+", " ", title.strip().lower())
    title_match_index = None

    # --- Find the first exact title match that is not boilerplate ---
    for i, span in enumerate(spans):
      raw = unescape(span.string or '')
      flat = re.sub(r"\s+", " ", raw).strip().lower()
      if flat == normalized_title and not self._is_boilerplate_line(flat):
        title_match_index = i
        break

    if title_match_index is None:
      logger.warning("Could not match normalized title in span content: %s", self._file_path.name)
      return []

    # --- Start parsing from just after the title match ---
    for span in spans[title_match_index + 1:]:
      raw = unescape(span.string or '')
      flat = re.sub(r"\s+", " ", raw).strip().lower()
      text = raw.replace("\u00a0", " ").replace("\n", " ").replace("\r", " ").replace("\t", " ")

      if END_MARKER.lower() in flat:
        break

      if self._is_boilerplate_line(flat):
        continue

      lines.append(text if text.strip() else "$$EMPTY_LINE$$")

    # --- Trim junk from the beginning only ---
    def is_pre_song_junk(line: str) -> bool:
      junk = line.strip().lower()
      return junk in {"", ".", "-", "and", "freefind", "country gospel cd"}

    while lines and is_pre_song_junk(lines[0]):
      lines.pop(0)

    return lines



  @classmethod
  def check_if_line_is_chord(cls, line: str, chords: list) -> bool:
    return all(token in chords for token in line.split())

  @classmethod
  def _process_lyric_lines(cls, lyric_lines: list[str], chords: list[str]) -> list[dict[str, str]]:
    """
    Takes raw lyric lines and pairs chords with lyrics.
    Preserves intentional empty lines but skips redundant input lines.
    """
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