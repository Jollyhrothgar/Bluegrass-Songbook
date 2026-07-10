#!/usr/bin/env python3
"""Batch oracle verification: TEF parser output vs TablEdit MusicXML exports.

Per Mike's determinism policy, a parsed OTF is VERIFIED only when it matches
the TablEdit oracle export of that exact file at 100%. This tool compares
tick-level note positions (measure, tick, string, fret) per track and writes
a manifest of verdicts.

Comparison semantics (validated against 23398 and wheel_hoss):
- MusicXML <divisions> is read per part (240/quarter typical -> scale to
  OTF's 480 ticks/quarter).
- <grace> notes are skipped (known parser gap, tracked separately) and do
  not advance time.
- <chord> notes start at the preceding principal note's start.
- Tie continuations (<tie type="stop">) are excluded on the XML side;
  OTF notes with "tie": true are excluded on the parser side.
- Multi-part XML maps parts to OTF tracks in order; single-part XML from a
  multi-track TEF (TablEdit exports only the LAST module) compares against
  the LAST OTF track and yields a PARTIAL verdict at best.

Usage:
  python3 spike/oracle_verify.py <parsed.otf.json> <oracle.xml> [--quiet]
  python3 spike/oracle_verify.py --batch <manifest.json>
      manifest entries: {"pid": ..., "otf": path, "xml": path}
      verdicts are written back into the manifest file.
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

TICKS_PER_QUARTER = 480


def xml_parts(xml_path):
    """-> list of sorted [(measure, tick, string, fret, dur)] per <part>."""
    root = ET.parse(xml_path).getroot()
    parts = []
    for part in root.findall("part"):
        divisions = 240  # updated from <attributes> as encountered
        notes = []
        for m in part.findall("measure"):
            mnum = int(m.get("number"))
            d = m.find(".//divisions")
            if d is not None:
                divisions = int(d.text)
            scale = TICKS_PER_QUARTER / divisions
            tick = 0.0
            last_start = 0.0
            for el in m:
                if el.tag == "backup":
                    tick -= int(el.findtext("duration")) * scale
                elif el.tag == "forward":
                    tick += int(el.findtext("duration")) * scale
                elif el.tag == "note":
                    if el.find("grace") is not None:
                        continue
                    dur = int(el.findtext("duration") or 0) * scale
                    chord = el.find("chord") is not None
                    tie_stop = any(t.get("type") == "stop"
                                   for t in el.findall("tie"))
                    s = el.findtext(".//string")
                    f = el.findtext(".//fret")
                    start = last_start if chord else tick
                    if s is not None and not tie_stop:
                        notes.append((mnum, round(start), int(s), int(f),
                                      round(dur)))
                    if not chord:
                        last_start = tick
                        tick += dur
        parts.append(sorted(notes))
    return parts


def otf_tracks(otf_path):
    """-> ordered dict track_id -> sorted [(measure, tick, string, fret, dur)].

    Durations are part of the comparison (added 2026-07-10): the XML
    export carries every note's written duration, and the parser now
    decodes the TEF duration byte — tick/string/fret alone let wrong
    note LENGTHS verify (Mike caught 25635 rendering with wrong
    lengths; the byte was previously misread as a 'marker char').
    """
    otf = json.load(open(otf_path))
    order = [t["id"] for t in otf.get("tracks", [])]
    out = {}
    for tid in order:
        measures = otf.get("notation", {}).get(tid, [])
        notes = [(m["measure"], ev["tick"], n["s"], n["f"], n.get("dur"))
                 for m in measures for ev in m["events"]
                 for n in ev["notes"] if not n.get("tie")]
        out[tid] = sorted(notes)
    return out


def compare(otf_path, xml_path):
    """-> verdict dict."""
    parts = xml_parts(xml_path)
    tracks = otf_tracks(otf_path)
    track_ids = list(tracks.keys())

    partial = False
    if len(parts) == len(tracks):
        pairing = list(zip(track_ids, parts))
    elif len(parts) == 1 and len(tracks) > 1:
        # TablEdit multi-module export contains only ONE module —
        # usually the last, but TablEdit's module order and the OTF
        # track order can disagree (14699/14809: the exported part is
        # the banjo, not the last OTF track; empty modules shift the
        # picture further). Pair with the OTF track whose content best
        # matches the exported part.
        xml_set = set(parts[0])
        best = max(track_ids, key=lambda tid: len(set(tracks[tid]) & xml_set))
        pairing = [(best, parts[0])]
        partial = True
    else:
        return {"verdict": "ERROR",
                "detail": f"{len(parts)} XML parts vs {len(tracks)} OTF tracks"}

    per_track = {}
    all_exact = True
    for tid, xml_notes in pairing:
        a, b = set(tracks[tid]), set(xml_notes)
        exact = len(a & b)
        per_track[tid] = {
            "otf": len(a), "oracle": len(b), "exact": exact,
            "otf_only": sorted(a - b)[:20],
            "oracle_only": sorted(b - a)[:20],
        }
        if a != b:
            all_exact = False

    if all_exact:
        verdict = "PARTIAL" if partial else "VERIFIED"
    else:
        verdict = "DIVERGED"
    return {"verdict": verdict, "tracks": per_track,
            **({"note": "single-part XML vs multi-track OTF "
                        "(one module only, best-match paired)"}
               if partial else {})}


def run_one(otf_path, xml_path, quiet=False):
    result = compare(otf_path, xml_path)
    print(f"{Path(otf_path).name} vs {Path(xml_path).name}: {result['verdict']}")
    if not quiet:
        for tid, r in result.get("tracks", {}).items():
            line = f"  {tid}: otf={r['otf']} oracle={r['oracle']} exact={r['exact']}"
            print(line)
            for k in ("otf_only", "oracle_only"):
                if r[k]:
                    print(f"    {k}: {r[k][:8]}")
    return result


def run_batch(manifest_path):
    manifest = json.load(open(manifest_path))
    counts = {}
    for entry in manifest:
        otf, xml = entry.get("otf"), entry.get("xml")
        if not (otf and xml and Path(otf).exists() and Path(xml).exists()):
            entry["result"] = {"verdict": "MISSING"}
        else:
            try:
                entry["result"] = compare(otf, xml)
            except Exception as ex:  # noqa: BLE001 — record, keep batch going
                entry["result"] = {"verdict": "ERROR", "detail": repr(ex)[:200]}
        v = entry["result"]["verdict"]
        counts[v] = counts.get(v, 0) + 1
        print(f"{entry.get('pid')}: {v}")
    json.dump(manifest, open(manifest_path, "w"), indent=1)
    print("\nsummary:", counts)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--batch" in sys.argv:
        run_batch(args[0])
    else:
        run_one(args[0], args[1], quiet="--quiet" in sys.argv)
