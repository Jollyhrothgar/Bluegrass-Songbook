from pathlib import Path
from typing import Any, Dict

class BaseParser:
  def get_title(self) -> str:
    """
    Parses the internal view of data and returns the title of a song as string.
    """
    raise NotImplementedError("Parser must implement the get_title method.")

  def get_artist(self) -> str:
    """
    Parses the internal view of data and returns the artist of a song as string.
    """
    raise NotImplementedError("Parser must implement the 'get_artist' method.")

  def get_lyrics(self) -> str:
    """
    Parses the internal view of data and returns the lyrics of a song as string.
    """
    raise NotImplementedError("Parser must implement the 'get_lyrics' method.")

  def get_chords(self) -> str:
    """
    Parses the internal view of data and returns the chords of a song as string.
    """
    raise NotImplementedError("Parser must implement the 'get_chords' method.")