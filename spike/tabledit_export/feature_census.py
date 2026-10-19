"""Census of TablEdit features used by the corpus, field by field.

    uv run python spike/tabledit_export/feature_census.py [OUT_DIR]

Walks every corpus .tef at the byte level (not through the parser's
filters) and counts each field value: notes per value, files using it, and
published works using it. Where TablEdit's MusicXML export (OUT_DIR/xml, see
export_corpus.py) also carries a note, the census joins the two on (track,
measure, string, fret, nearest tick) and records which XML markings the
exporter attached, so a raw value can be named from TablEdit's own output.
Writes OUT_DIR/census.json.

Names come from TablEdit 3.06 itself (REA/Ghidra, fix-it A15): the
string-pointer table at 0x1000f57e0 lists the 8 dynamic levels then the
20 note effects in enum order (effect = cell byte 6 & 0x0f, V2 effect1 &
0x0f; bits 4-5 are the voice); the type-name table at 0x1000f3cbc names
the special components; the V2 upgrade FUN_1000459c4 maps V2 codes onto
them; FUN_10001f594 reads the attribute byte.
"""
import glob
import json
import re
import struct
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "sources" / "banjo-hangout" / "src"))
sys.path.insert(0, str(HERE))
from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from export_corpus import corpus  # noqa: E402

DYNAMICS = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"]
EFFECTS = ["none", "hammer-on", "pull-off", "slide", "choke", "brush",
           "natural harmonic", "artificial harmonic", "muted", "tapping",
           "vibrato", "tremolo", "bend", "bend and release", "roll",
           "dead note", "ringing note", "slap", "rasgueado", "ghost note"]
# Note attribute byte (V3 cell byte 8; V2 effect2 under fret-byte flag 0x80),
# from TablEdit's SpecialEffects dialog code (FUN_10001f594): low nibble =
# attribute, high nibble = a second effect from the EFFECTS list.
ATTRIBUTES = {1: "ringing", 2: "slap", 3: "rasgueado", 4: "ghost",
              5: "tremolo up/down", 6: "tremolo dive-return", 7: "staccato",
              8: "fade in", 9: "fade out"}
SECOND_EFFECTS = {1: "hammer-on", 2: "pull-off", 3: "roll", 5: "brush",
                  6: "natural harmonic", 7: "artificial harmonic",
                  8: "ringing", 9: "ghost", 10: "dead note", 11: "variation"}
# V2 effect2 values under flag 0x80 that TablEdit turns into layout flags
# (V3 byte 11) rather than an attribute.
LAYOUT_CODES = {0x0b: "exclude from beaming", 0x0c: "no stem", 0x0d: "move left",
                0x0e: "move right", 0xc0: "ottava bassa", 0xd0: "ottava alta"}
GRACE_KINDS = ["plain", "hammer/pull", "slide", "bend/release", "mordent",
               "double", "gruppetto", "trill"]
XML_NOTE_MARKS = ("grace", "fingering", "pluck", "hammer-on", "pull-off",
                  "slide", "time-modification", "dot")


def published_index():
    """(source, id) and mandozine file names that a published work uses."""
    ids, files = defaultdict(set), defaultdict(set)
    for wy in glob.glob(f"{REPO}/works/*/work.yaml"):
        text = open(wy).read()
        if "format: otf" not in text:
            continue
        work = Path(wy).parent.name
        for m in re.finditer(r"source: (\S+)\n(?:\s+\w+: .*\n)*?\s+source_id: '?(\w+)'?", text):
            ids[(m.group(1), m.group(2))].add(work)
        for m in re.finditer(r"source_file: (\S+\.tef)", text):
            files[m.group(1)].add(work)
    return ids, files


def works_for(key, path, ids, files):
    source = key.split("__")[0]
    num = re.match(r"(\d+)", path.name)
    hit = set()
    if num:
        hit |= ids.get((source, num.group(1)), set())
    return hit | files.get(path.name, set())


def xml_notes(xml_path):
    """{(part, measure, string, fret): [(tick, marks)]} from TablEdit's export."""
    out = defaultdict(list)
    words = []
    try:
        root = ET.parse(xml_path).getroot()
    except ET.ParseError:
        return None, None
    for pi, part in enumerate(root.findall("part")):
        divisions = 240
        for m in part.findall("measure"):
            num = int(m.get("number"))
            d = m.find(".//divisions")
            if d is not None:
                divisions = int(d.text)
            scale = 480 / divisions
            tick = last = 0.0
            for el in m:
                if el.tag == "backup":
                    tick -= int(el.findtext("duration")) * scale
                elif el.tag == "forward":
                    tick += int(el.findtext("duration")) * scale
                elif el.tag == "direction":
                    for w in el.iter("words"):
                        words.append((pi, num, round(tick), (w.text or "").strip()))
                elif el.tag == "note":
                    grace = el.find("grace") is not None
                    chord = el.find("chord") is not None
                    dur = 0 if grace else int(el.findtext("duration") or 0) * scale
                    start = last if chord else tick
                    s, f = el.findtext(".//string"), el.findtext(".//fret")
                    if s is not None:
                        marks = {t for t in XML_NOTE_MARKS if el.find(f".//{t}") is not None}
                        if any(t.get("type") == "start" for t in el.findall("tie")):
                            marks.add("tie-start")
                        if any(t.get("type") == "stop" for t in el.findall("tie")):
                            marks.add("tie-stop")
                        out[(pi, num, int(s), int(f))].append((round(start), frozenset(marks)))
                    if not chord:
                        last = tick
                        tick += dur
    return out, words


def note_place(tef, ev):
    """(measure, tick) before triplet retiming: enough to find the XML note."""
    if tef.header.is_v2:
        ts = tef.header.v2_ts_size or 256
        return ev.position // ts + 1, (ev.position % ts & ~3) * 15 // 2
    idx, off = tef.v3_locate(ev.position)
    return idx + 1, off * 30


class Census:
    def __init__(self):
        self.notes = Counter()            # feature -> notes
        self.files = defaultdict(set)     # feature -> file keys
        self.works = defaultdict(set)     # feature -> published works
        self.published = defaultdict(set)  # feature -> published tabs (files)
        self.xml = defaultdict(Counter)   # feature -> XML marks on joined notes
        self.joined = Counter()           # feature -> notes joined to XML
        self.otf = defaultdict(Counter)   # feature -> what our OTF note carries

    def add(self, feature, key, works, n=1, marks=None, otf=None):
        self.notes[feature] += n
        if otf is not None:
            self.otf[feature][otf] += 1
        self.files[feature].add(key)
        self.works[feature] |= works
        if works:
            self.published[feature].add(key)
        if marks is not None:
            self.joined[feature] += 1
            self.xml[feature].update(marks or {"(none)"})

    def to_dict(self):
        return {f: {"notes": self.notes[f], "files": len(self.files[f]),
                    "works": len(self.works[f]), "published_tabs": len(self.published[f]),
                    "joined": self.joined[f],
                    "xml": dict(self.xml[f].most_common(6)),
                    "otf": dict(self.otf[f].most_common(6)),
                    "file_keys": sorted(self.files[f]),
                    "published_keys": sorted(self.published[f])}
                for f in sorted(self.notes)}


def attribute_features(value, prefix):
    hi, lo = value >> 4, value & 0x0f
    feats = []
    if lo and hi != 3:
        feats.append(f"{prefix}attribute: {ATTRIBUTES.get(lo, f'? {lo}')}")
    if hi:
        feats.append(f"{prefix}second effect: {SECOND_EFFECTS.get(hi, f'? {hi}')}")
    return feats


def note_features(tef, ev):
    """Feature labels for one note record, from TablEdit's cell layout."""
    r = ev.raw_data
    feats = []
    if len(r) == 12:                      # V3 cell
        typ, dur, eff = r[4], r[5], r[6]
        feats.append(f"dynamic {DYNAMICS[dur >> 5]}" if dur >> 5 != 7 else "tie (dynamic 7)")
        if typ & 0x40:
            feats.append("grace note (V3 type bit 0x40)")
        if typ & 0x80:
            feats.append("V3 type bit 7")
        feats.append(f"V3 effect {eff & 0x0f}: {EFFECTS[eff & 0x0f]}")

        if typ & 0x40:
            feats.append(f"grace kind: {GRACE_KINDS[r[7] >> 5]}")
        elif r[7] and not typ & 0x80:
            feats.append("V3 byte 7 (unresolved)")
        if r[8]:
            feats += attribute_features(r[8], "")
        if eff & 0x30:
            feats.append("voice: " + ("upper" if eff & 0x30 == 0x20 else "lower" if eff & 0x30 == 0x30 else "0x10"))
        if r[11] & 0x7f:
            feats.append(f"layout byte 11 0x{r[11] & 0x7f:02x}")
        if r[10]:
            feats.append("fingering byte (V3 10)")
    elif len(r) == 6:                     # V2 record
        fb, dur, e1, e2 = r[2], r[3], r[4], r[5]
        feats.append(f"dynamic {DYNAMICS[dur >> 5]}" if dur >> 5 != 7 else "tie (dynamic 7)")
        feats.append(f"V2 effect {e1 & 0x0f}: {EFFECTS[e1 & 0x0f]}")
        if e1 & 0x30:
            feats.append("voice: " + ("upper" if e1 & 0x30 == 0x20 else "lower" if e1 & 0x30 == 0x30 else "0x10"))
        flags = fb & 0xe0
        if flags == 0x40:
            feats.append("grace note (V2 fret-byte flag 0x40)")
            feats.append(f"grace kind: {GRACE_KINDS[e2 >> 5]}")
        elif flags == 0x20 and e2:
            feats.append("fingering byte (V2 effect2)")
        elif flags == 0x80 and e2:
            if e2 in LAYOUT_CODES:
                feats.append(f"layout: {LAYOUT_CODES[e2]}")
            else:
                feats += attribute_features(e2, "")
        elif e2:
            feats.append(f"V2 effect2 under flag 0x{flags:02x} (unresolved)")
    else:
        feats.append("V2 4-byte record (no effects)")
    return feats


V3_TYPES = {0x33: "rest", 0x35: "chord diagram", 0x36: "line break",
            0x37: "accent", 0x38: "crescendo", 0x39: "text", 0x3d: "connection (slur/bracket)",
            0x3e: "stroke/fingering", 0x75: "scale diagram", 0x78: "percussion",
            0x7d: "spacing marker", 0x7e: "MIDI patch change", 0xb6: "musical sign",
            0xb7: "reading guide", 0xbd: "beam break", 0xbe: "stem length",
            0xf5: "special character", 0xfd: "syncopation change", 0xfe: "tempo change"}
# V2 fret byte -> V3 type, from TablEdit's V2 upgrade (FUN_1000459c4)
V2_SPECIALS = {0x1d: 0x39, 0x1e: 0x37, 0x9e: 0x38, 0x1a: 0x33, 0x1c: 0x35, 0x5c: 0x35,
               0x9c: 0x35, 0x3c: 0x75, 0x7c: 0x75, 0xbc: 0x75, 0x3d: 0x3d, 0x3e: 0x3e,
               0x5d: 0xf5, 0x5e: 0xb7, 0x7d: 0x7d, 0x9d: 0x36, 0xdd: 0xb6, 0xde: 0x78}


def specials(reader, tef, key, works, c):
    """Non-note components: V3 types 0x33-0x3F, V2 fret codes 0x1a-0x1f."""
    data = reader.data
    if tef.header.is_v2:
        h = tef.header
        stride = reader.v2_component_stride(h)
        off = h.v2_component_offset
        for _ in range(h.v2_component_count):
            rec = data[off:off + stride]
            off += stride
            if len(rec) < stride:
                break
            code = rec[2] & 0x1f
            if code == 0x1b:
                c.add("time signature change", key, works)
            elif rec[2] in V2_SPECIALS:
                c.add(V3_TYPES[V2_SPECIALS[rec[2]]], key, works)
            elif rec[2] in V3_TYPES:  # not in the upgrade table: same byte as the V3 type
                c.add(V3_TYPES[rec[2]] + " (by type byte)", key, works)
            elif code >= 0x1b:
                c.add(f"V2 special byte 0x{rec[2]:02x} (unmapped)", key, works)
        return
    off = struct.unpack("<I", data[0x3C:0x40])[0]
    while off + 12 <= len(data):
        rec = data[off:off + 12]
        off += 12
        if struct.unpack("<I", rec[:4])[0] == 0xFFFFFFFF:
            break
        if rec[4] & 0x3f >= 0x33:
            c.add(V3_TYPES.get(rec[4], f"V3 type 0x{rec[4]:02x} (unnamed)"), key, works)


def header_tables(reader, tef, key, works, c):
    data = reader.data
    if tef.header.is_v2:
        return
    for ptr in range(0x40, 0x9C, 4):
        p = struct.unpack("<I", data[ptr:ptr + 4])[0]
        if 0 < p < len(data) - 4:
            a, b = struct.unpack("<HH", data[p:p + 4])
            if b or (ptr == 0x54 and a):
                c.add(f"V3 header table @0x{ptr:02x}", key, works, n=b or a)


def track_fields(reader, tef, key, works, c):
    for inst in tef.instruments:
        o = inst.offset
        if not o:
            continue
        rec = reader.data[o:o + 20]
        for i in (4, 5, 10, 11, 14, 15, 16, 17, 18, 19):
            c.add(f"track byte +{i} = {rec[i]}", key, works)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "out"
    ids, files = published_index()
    notes, special, header, tracks = Census(), Census(), Census(), Census()
    xml_words = Counter()
    for key, path in corpus():
        reader = TEFReader(str(path))
        try:
            tef = reader.parse()
        except Exception:  # noqa: BLE001 - counted below, not fatal
            notes.add("PARSE ERROR", key, set())
            continue
        works = works_for(key, path, ids, files)
        xml_path = out / "xml" / f"{key}.xml"
        xn, words = xml_notes(xml_path) if xml_path.exists() else (None, None)
        if words:
            xml_words[key] = len(words)
        doc = tef_to_otf(tef).to_dict()
        oi = defaultdict(list)
        for tid, ms in doc["notation"].items():
            for m in ms:
                for e in m["events"]:
                    for n in e["notes"]:
                        oi[(tid, m["measure"], n["s"], n["f"])].append((e["tick"], n))
        tids = [t["id"] for t in doc["tracks"]]
        for ev in tef.note_events:
            sf = ev.decode_string_fret()
            got = "(not in OTF)"
            if sf and ev.track < len(tids):
                m, t = note_place(tef, ev)
                hit = min(oi.get((tids[ev.track], m, sf[0], sf[1]), []), key=lambda x: abs(x[0] - t), default=None)
                if hit and abs(hit[0] - t) <= 240:
                    n = hit[1]
                    got = " ".join(f"{k}={n[k]}" for k in ("tech", "tie", "finger", "lh") if n.get(k)) or "plain note"
            marks = None
            if xn is not None and sf:
                m, t = note_place(tef, ev)
                cands = xn.get((ev.track, m, sf[0], sf[1]), [])
                best = min(cands, key=lambda x: abs(x[0] - t), default=None)
                if best and abs(best[0] - t) <= 160:
                    marks = best[1]
            for feat in note_features(tef, ev):
                notes.add(feat, key, works, marks=marks, otf=got)
        specials(reader, tef, key, works, special)
        header_tables(reader, tef, key, works, header)
        track_fields(reader, tef, key, works, tracks)
    result = {"notes": notes.to_dict(), "specials": special.to_dict(),
              "header": header.to_dict(), "tracks": tracks.to_dict(),
              "xml_words_files": len(xml_words)}
    json.dump(result, open(out / "census.json", "w"), indent=1)
    for section in ("notes", "specials", "header"):
        print(f"\n== {section}")
        for f, v in sorted(result[section].items(), key=lambda kv: -kv[1]["files"]):
            print(f"{f:42} notes={v['notes']:7} files={v['files']:4} pub={v['published_tabs']:4} works={v['works']:4} xml={v['xml']} otf={v.get('otf', {})}")


if __name__ == "__main__":
    main()
