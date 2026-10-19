"""Export every corpus .tef through TablEdit's own MusicXML exporter.

    uv run python spike/tabledit_export/export_corpus.py [OUT_DIR]

OUT_DIR defaults to spike/tabledit_export/out/ (gitignored: ~200 MB). For
each file it writes OUT_DIR/xml/<key>.xml (TablEdit's export, all modules)
and OUT_DIR/otf/<key>.json (our parser's output), where key is
<source>__<file stem>. Files already exported are skipped, so a run can be
stopped and resumed. Re-run with --otf-only after a parser change.

Needs TablEdit installed and Accessibility access for the terminal: the
export is driven by AppleScript UI actions (ax_export.sh), no keystrokes,
about 2 s per file. TablEdit's save panel remembers the last folder it used:
export one file by hand into OUT_DIR/xml first, and every later export
lands there.
"""
import glob
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "sources" / "banjo-hangout" / "src"))
from tef_parser import TEFReader, tef_to_otf  # noqa: E402


def corpus():
    files = glob.glob(f"{REPO}/sources/*/downloads/*.tef") + glob.glob(f"{REPO}/sources/mandozine/tefs/*.tef")
    for f in sorted(files):
        source = f.split("/sources/")[1].split("/")[0]
        yield f"{source}__{Path(f).stem}".replace(" ", "_"), Path(f)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    otf_only = "--otf-only" in sys.argv
    out = Path(args[0]) if args else HERE / "out"
    (out / "xml").mkdir(parents=True, exist_ok=True)
    (out / "otf").mkdir(exist_ok=True)
    log = open(out / "export.log", "a")
    scratch = Path(tempfile.mkdtemp())
    for key, tef in corpus():
        try:
            json.dump(tef_to_otf(TEFReader(str(tef)).parse()).to_dict(), open(out / "otf" / f"{key}.json", "w"))
        except Exception as e:  # noqa: BLE001 - logged, the run goes on
            print(key, "PARSE-ERR", e, file=log, flush=True)
            continue
        xml = out / "xml" / f"{key}.xml"
        if otf_only or xml.exists():
            continue
        patched = scratch / f"{key}.tef"
        subprocess.run([sys.executable, HERE / "patch_modes.py", tef, patched], check=True, capture_output=True)
        r = subprocess.run([HERE / "ax_export.sh", patched, key], capture_output=True, text=True, timeout=60)
        msg = (r.stdout + r.stderr).strip().replace("\n", " ")[:160]
        if not xml.exists():
            msg += " | NOT IN OUT_DIR/xml: point the save panel there"
        print(key, msg, file=log, flush=True)


if __name__ == "__main__":
    main()
