#!/usr/bin/env python3
"""
Run merges on all extracted UG content.

Usage:
    uv run python sources/ultimate-guitar/run_merges.py
    uv run python sources/ultimate-guitar/run_merges.py --embeddings  # Use semantic matching
    uv run python sources/ultimate-guitar/run_merges.py --song <slug>  # Single song
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from merge import merge_song

RAW_DIR = Path(__file__).parent / "raw_extractions"
BL_DIR = Path(__file__).parent.parent / "bluegrass-lyrics" / "parsed"
RESULTS_DIR = Path(__file__).parent / "results"

def main():
    parser = argparse.ArgumentParser(description="Merge UG chords with BL lyrics")
    parser.add_argument("--embeddings", action="store_true",
                       help="Use word embeddings for semantic matching")
    parser.add_argument("--song", type=str,
                       help="Process single song by slug")
    args = parser.parse_args()

    RESULTS_DIR.mkdir(exist_ok=True)

    if args.embeddings:
        print("Loading word embeddings (first run may download 66MB model)...")

    # Get files to process
    if args.song:
        files = [RAW_DIR / f"{args.song}.json"]
        if not files[0].exists():
            print(f"ERROR: No extraction for {args.song}")
            return
    else:
        files = sorted(RAW_DIR.glob("*.json"))

    for raw_file in files:
        slug = raw_file.stem
        bl_file = BL_DIR / f"{slug}.json"

        if not bl_file.exists():
            print(f"SKIP {slug}: No BL file")
            continue

        print(f"Merging {slug}...")

        with open(raw_file) as f:
            ug_data = json.load(f)

        try:
            result = merge_song(
                str(bl_file),
                ug_data["content"],
                ug_data.get("ug_url"),
                use_embeddings=args.embeddings
            )

            # Save result
            out_file = RESULTS_DIR / f"{slug}.json"
            with open(out_file, "w") as f:
                json.dump(result.to_dict(), f, indent=2)

            print(f"  Coverage: {result.coverage:.0%} ({result.matched_lines}/{result.total_lines})")
        except Exception as e:
            print(f"  ERROR: {e}")

    print(f"\nResults saved to {RESULTS_DIR}")

if __name__ == "__main__":
    main()
