#!/usr/bin/env python3
"""Regenerate parsed/ OTF JSON for all source-backed files.

Reads spike/oracle_batch_queue.json (pid -> host tef path), maps host
paths to the current sandbox mounts, re-parses with the current parser,
and rewrites sources/banjo-hangout/parsed/<pid>.otf.json.

Preserves the existing x_source block verbatim (when present) so git
diffs show only musical changes, not converted_at churn.

Usage: python3 spike/regen_parsed.py  (from the worktree root)
"""

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

# Host -> sandbox mount mapping (order matters: longest prefix first).
# The raw_tabs mount lives under a per-session path — detect the live
# one instead of hardcoding a session name (a stale entry silently
# failed 66 regens for two days). Falls back to the host path itself
# (works when run on the Mac directly).
import glob as _glob


def _find_raw_tabs_mount(host_default: str) -> str:
    candidates = sorted(_glob.glob("/sessions/*/mnt/raw_tabs"))
    for c in reversed(candidates):
        if Path(c).is_dir():
            return c
    return host_default


_RAW_TABS_HOST = (
    "/Users/mike/Library/CloudStorage/GoogleDrive-michael.beaumier@gmail.com"
    "/My Drive/Music/Banjo/Tabs/banjo_hangout_download/data/raw_tabs")

PATH_MAP = [
    ("/Users/mike/workspace/bluegrassbook.com/feature-otf-editor",
     str(ROOT)),
    (_RAW_TABS_HOST, _find_raw_tabs_mount(_RAW_TABS_HOST)),
]


def map_path(host: str) -> Path:
    for prefix, mount in PATH_MAP:
        if host.startswith(prefix):
            return Path(mount + host[len(prefix):])
    return Path(host)


def main() -> int:
    queue = json.loads((ROOT / "spike/oracle_batch_queue.json").read_text())
    ok = fail = 0
    for entry in queue:
        pid = entry["pid"]
        tef_path = map_path(entry["tef_host"])
        out_path = ROOT / "sources" / "banjo-hangout" / "parsed" / f"{pid}.otf.json"
        try:
            tef = TEFReader(str(tef_path)).parse()
            otf_dict = tef_to_otf(tef).to_dict()
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {pid}: {e}")
            fail += 1
            continue
        x_source = None
        if out_path.exists():
            try:
                x_source = json.loads(out_path.read_text()).get("x_source")
            except Exception:  # noqa: BLE001
                pass
        otf_dict["x_source"] = x_source or {
            "type": "local",
            "source_file": tef_path.name,
            "converted_at": datetime.now().isoformat(),
        }
        out_path.write_text(json.dumps(otf_dict, indent=2))
        ok += 1
    print(f"regenerated {ok}, failed {fail}")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
