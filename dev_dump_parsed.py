import json
from pathlib import Path
from chordpro_converter.parsers.classic_country_scoring_parser import ScoringParser

TEST_INPUTS = [
    # "manofconstantsorrowlyricsandchords.html",
    # "talkaboutmeandseewhatshellsaylyricschords.html",
    # "thewonderfulworldofChristmaslyricschords.html",
    # "halfofthishalfofthatlyricschords.html",
    # "homeontherangelyricschords.html",
    "nowandforeverlyricschords.html"
]

BASE_DIR = Path("tests/classic_country_lyrics/shared_song_inputs/classic_country_song_lyrics")

for filename in TEST_INPUTS:
    path = BASE_DIR / filename
    html = path.read_text(encoding="utf-8")
    parser = ScoringParser(html)
    parsed = parser.to_dict()

    print("=" * 80)
    print(f"{filename}")
    print("=" * 80)
    print(json.dumps(parsed, indent=2, ensure_ascii=False))
    print(len(parsed['lines']))