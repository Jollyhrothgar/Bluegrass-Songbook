"""TEF file parser for TablEdit tablature files.

Copied from TablEdit_Reverse project.
Supports both V2 (pre-3.00) and V3 (3.00+) TEF file formats.
"""

from .reader import TEFReader, TEFFile, TEFVersionError
from .otf import tef_to_otf, OTFDocument

__all__ = ["TEFReader", "TEFFile", "TEFVersionError", "tef_to_otf", "OTFDocument"]
