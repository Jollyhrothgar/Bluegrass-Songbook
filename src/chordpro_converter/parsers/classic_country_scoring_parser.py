import re
from bs4 import BeautifulSoup
from collections import Counter
from html import unescape

CHORD_PATTERN = re.compile(
  r'\b([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)\b'
)

JUNK_PHRASES = [
  "freefind",
  "prices on",
  "classic country music cds",
  "country gospel cds",
  "download classic country",
  "click here",
  "lyrics are the property",
  "key changer",
  "this software was developed",
  "banner",
  "mp3s",
  "most only $.99",
  "search engine",
  "classic country music"
]

class ScoringParser:
  def __init__(self, html: str):
    self.soup = BeautifulSoup(html, "html.parser")
    self._used_pre = False
    self.span_lines = self._extract_spans_or_pre()
    self.chord_set = self._extract_chords()
    self.title, self.artist, self.writer = self._extract_metadata()

  def _extract_spans_or_pre(self) -> list[str]:
    spans = self.soup.find_all("span")
    pre = self.soup.find("pre")

    if pre:
      raw = pre.get_text("\n")
      lines = [line.rstrip("\n") for line in raw.splitlines()]
      self._used_pre = True
      return lines

    if spans:
      self._used_pre = False
      return [
        unescape(span.get_text() or "").replace("\xa0", " ")
        for span in spans
        if span.get_text(strip=True)
      ]

    return []

  def _extract_chords(self) -> set[str]:
    all_text = " ".join(self.span_lines)
    return set(CHORD_PATTERN.findall(all_text))

  def _score_block(self, block: list[str]) -> int:
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

  def _sliding_windows(self, window_size: int = 30) -> list[tuple[int, list[str]]]:
    return [(i, self.span_lines[i:i + window_size]) for i in range(len(self.span_lines) - window_size + 1)]

  def find_best_block(self, window_size: int = 30) -> list[str]:
    lower_lines = [line.lower() for line in self.span_lines]

    start_idx = 0
    for i, line in enumerate(lower_lines):
      if self.title.lower() in line or self.artist.lower() in line:
        start_idx = i
        break

    relevant_lines = self.span_lines[start_idx:]
    if len(relevant_lines) < window_size:
      print(f"[WARN] Not enough lines for windowing: {len(relevant_lines)} lines in source.")
      best_start = 0
      best_block = relevant_lines
    else:
      candidates = [(i, relevant_lines[i:i + window_size]) for i in range(len(relevant_lines) - window_size + 1)]
      best_start, best_block = max(candidates, key=lambda item: self._score_block(item[1]), default=(0, relevant_lines))

    extended = list(best_block)
    trailing_score = 0
    for line in relevant_lines[best_start + len(best_block):]:
      if not line.strip():
        extended.append(line)
        continue
      tokens = line.strip().split()
      if all(t in self.chord_set for t in tokens):
        extended.append(line)
        trailing_score = 0
        continue
      if any(t in self.chord_set for t in tokens):
        extended.append(line)
        trailing_score = 0
        continue
      if len(tokens) >= 4 and not any(p in line.lower() for p in JUNK_PHRASES):
        extended.append(line)
        trailing_score = 0
        continue
      trailing_score += 1
      if trailing_score >= 2:
        break
      extended.append(line)

    while extended and (
      not extended[0].strip()
      or "written by" in extended[0].lower()
      or any(p in extended[0].lower() for p in JUNK_PHRASES)
    ):
      extended.pop(0)

    return extended

  def to_dict(self) -> dict:
    block = self.find_best_block()

    lines = []
    i = 0
    while i < len(block):
      line = block[i].rstrip("\n")
      if not line.strip():
        lines.append({"chords": "", "lyrics": ""})
        i += 1
        continue

      lowered = " ".join(line.lower().split())
      if any(phrase in lowered for phrase in JUNK_PHRASES):
        i += 1
        continue

      tokens = line.strip().split()
      is_chord_line = tokens and all(t in self.chord_set for t in tokens)

      if is_chord_line and i + 1 < len(block):
        next_line = block[i + 1].rstrip("\n")
        next_tokens = next_line.strip().split()
        if next_line and not any(t in self.chord_set for t in next_tokens):
          lines.append({"chords": line, "lyrics": next_line})
          i += 2
          continue
        else:
          lines.append({"chords": line, "lyrics": ""})
          i += 1
          continue

      if CHORD_PATTERN.fullmatch(line.strip()) and i + 1 < len(block):
        lyric_line = block[i + 1].rstrip("\n")
        if len(lyric_line.strip().split()) >= 3:
          lines.append({"chords": line.rstrip(), "lyrics": lyric_line.rstrip()})
          i += 2
          continue

      chord_match = CHORD_PATTERN.search(line)
      if chord_match and len(tokens) == 1 and i + 1 < len(block):
        next_line = block[i + 1].rstrip("\n")
        lines.append({"chords": line.rstrip(), "lyrics": next_line.rstrip()})
        i += 2
        continue

      if i > 0 and lines and lines[-1]["chords"] and not lines[-1]["lyrics"]:
        prev = lines.pop()
        lines.append({"chords": prev["chords"], "lyrics": line})
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

  def _extract_metadata(self) -> tuple[str, str, str | None]:
    tag = self.soup.find("title")
    if not tag or "|" not in tag.text:
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
