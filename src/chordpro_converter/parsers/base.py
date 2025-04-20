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