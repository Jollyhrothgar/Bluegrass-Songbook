"""Build dynamics_v3_mixed.tef from cherokee_shuffle_21874_v3.tef (G15d1).

Every note in the source is code 0 (fff). This rewrites bits 5-7 of V3 cell
byte 5 so the file has a known mix: code 2 (f) everywhere except the
EXCEPTIONS below, and the one tie (code 7) left alone. Run from the repo
root:  uv run python tests/parser/fixtures/make_dynamics_fixture.py
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[2] / "sources" / "banjo-hangout" / "src"))
from tef_parser import TEFReader  # noqa: E402

SOURCE = HERE / "cherokee_shuffle_21874_v3.tef"
TARGET = HERE / "dynamics_v3_mixed.tef"

# note index (in file order) -> dynamic code (0 fff .. 6 pp)
EXCEPTIONS = {0: 3, 5: 0, 6: 0, 10: 6, 20: 1, 21: 4, 22: 5}
BASE = 2


def build() -> bytes:
    data = bytearray(SOURCE.read_bytes())
    tef = TEFReader(str(SOURCE)).parse()
    cursor = 0
    for i, ev in enumerate(tef.note_events):
        rec = ev.raw_data
        at = bytes(data).find(rec, cursor)
        assert at >= 0, f"record {i} not found"
        cursor = at + len(rec)
        if (rec[5] >> 5) == 7:
            continue                      # keep the tie
        code = EXCEPTIONS.get(i, BASE)
        data[at + 5] = (rec[5] & 0x1f) | (code << 5)
    return bytes(data)


if __name__ == "__main__":
    TARGET.write_bytes(build())
    print(f"wrote {TARGET}")
