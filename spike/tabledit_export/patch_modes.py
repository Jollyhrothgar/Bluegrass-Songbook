"""patch_modes.py SRC.tef DST.tef: copy a .tef with every module's display
bits set, so TablEdit's MusicXML export includes every module.

TablEdit's exporter (FUN_1000982f0) skips a module whose track-record byte 16
has bits 4-6 clear, and most corpus files clear them on all modules but the
first. Prints how many modules were patched. The source file is not touched.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sources" / "banjo-hangout" / "src"))
from tef_parser import TEFReader  # noqa: E402

src, dst = sys.argv[1:3]
reader = TEFReader(src)
tef = reader.parse()
data = bytearray(reader.data)
patched = 0
for off in sorted({i.offset for i in tef.instruments if i.offset}):
    if (data[off + 16] >> 4) & 7 == 0:
        data[off + 16] = (data[off + 16] & 0x8F) | 0x10
        patched += 1
Path(dst).write_bytes(data)
print(patched)
