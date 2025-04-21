import json
from pathlib import Path
from chordpro_converter.parsers.classic_country_scoring_parser import ScoringParser

TEST_INPUTS = [
    # "manofconstantsorrowlyricsandchords.html",
    # "nowandforeverlyricschords.html",
    # "talkaboutmeandseewhatshellsaylyricschords.html",
    # "thewonderfulworldofChristmaslyricschords.html",
    # "halfofthishalfofthatlyricschords.html",
    # "homeontherangelyricschords.html",
    # "whenyousaynothingatalllyricschords.html",
    # "theflowersthesunsetthetreeslyricschords.html",
    "mysterytrainlyricschords.html"
]

BASE_DIR = Path("tests/classic_country_lyrics/shared_song_inputs/classic_country_song_lyrics")

for filename in TEST_INPUTS:
    path = BASE_DIR / filename
    html = path.read_text(encoding="utf-8")
    parser = ScoringParser(html)
    parsed = parser.to_dict()

    label = filename
    padding = len(label)
    print("=" * padding)
    print(f"{label}")
    print("=" * padding)
    print(json.dumps(parsed, indent=2, ensure_ascii=False))
    print(len(parsed['lines']))