#!/usr/bin/env python3
"""
Manage the catalog of popular bluegrass/old-time instrumentals to fetch

Includes curated list of popular fiddle tunes and instrumentals.
"""

import json
from pathlib import Path
from typing import List, Dict, Any

# Core bluegrass and old-time instrumentals - commonly played at jams
# Organized by rhythm type for variety
CORE_INSTRUMENTALS = [
    # === REELS (4/4) ===
    "Salt Creek",
    "Blackberry Blossom",
    "Whiskey Before Breakfast",
    "Red Haired Boy",
    "Billy in the Lowground",
    "Arkansas Traveler",
    "Turkey in the Straw",
    "Temperance Reel",
    "Fisher's Hornpipe",
    "Soldier's Joy",
    "Devil's Dream",
    "Forked Deer",
    "Liberty",
    "Rickett's Hornpipe",
    "Swallowtail Jig",
    "Saint Anne's Reel",
    "Beaumont Rag",
    "Black Mountain Rag",
    "Wheel Hoss",
    "Gold Rush",
    "Leather Britches",
    "June Apple",
    "Old Molly Hare",
    "Flop Eared Mule",
    "Grey Eagle",
    "Cherokee Shuffle",
    "Fire on the Mountain",
    "Big Mon",
    "Cotton Eyed Joe",
    "Boil Them Cabbage Down",
    "Old Joe Clark",
    "Cripple Creek",
    "Clinch Mountain Backstep",
    "Raw Hide",
    "Angeline the Baker",
    "Kitchen Girl",
    "Sail Away Ladies",
    "Cluck Old Hen",
    "Spotted Pony",
    "Back Up and Push",
    "Cumberland Gap",
    "John Hardy",
    "Way Downtown",
    "Shady Grove",
    "Little Maggie",
    "Jerusalem Ridge",
    "Road to Columbus",
    "Pike County Breakdown",
    "Dusty Miller",
    "Growling Old Man and Grumbling Old Woman",

    # === WALTZES (3/4) ===
    "Tennessee Waltz",
    "Kentucky Waltz",
    "Westphalia Waltz",
    "Ashokan Farewell",
    "Midnight on the Water",
    "Over the Waterfall",
    "Festival Waltz",
    "Flowers of Edinburgh",
    "Margaret's Waltz",
    "Old Spinning Wheel",
    "Faded Love",

    # === JIGS (6/8) ===
    "Irish Washerwoman",
    "Morrison's Jig",
    "Swallowtail Jig",
    "Kesh Jig",
    "Banish Misfortune",
    "Out on the Ocean",
    "Harvest Home",

    # === HORNPIPES ===
    "Sunderland Hornpipe",
    "Sailor's Hornpipe",
    "President Garfield's Hornpipe",
    "Rickett's Hornpipe",
    "Liverpool Hornpipe",

    # === BREAKDOWN/CONTEST TUNES ===
    "Foggy Mountain Breakdown",
    "Earl's Breakdown",
    "Flint Hill Special",
    "Bugle Call Rag",
    "Orange Blossom Special",
    "Fireball Mail",
    "Randy Lynn Rag",
    "Bluegrass Stomp",
    "Rawhide",
    "Home Sweet Home",
    "Black and White Rag",
    "Dixie Breakdown",
    "Lonesome Road Blues",
    "Nine Pound Hammer",
    "John Henry",

    # === SLOW/MODAL TUNES ===
    "Bonaparte's Retreat",
    "Last of Callahan",
    "Sandy River Belle",
    "East Tennessee Blues",
    "Stoney Point",
    "Cold Frosty Morning",
    "Walking in My Sleep",
    "Big Sciota",
    "Little Rabbit",

    # === CROOKED/UNUSUAL ===
    "Snowflake Reel",
    "Morrison's Jig",
    "Devil Went Down to Georgia",
]

# Categories to search on TuneArch to find more tunes
TUNEARCH_SEARCH_TERMS = [
    "bluegrass",
    "old-time",
    "fiddle contest",
    "breakdown",
    "appalachian",
    "country fiddle",
]


def get_tune_list() -> List[str]:
    """Get list of tunes to fetch"""
    return CORE_INSTRUMENTALS.copy()


def load_catalog(catalog_path: Path) -> Dict[str, Any]:
    """Load tune catalog from JSON file"""
    if catalog_path.exists():
        return json.loads(catalog_path.read_text(encoding='utf-8'))
    return {
        "tunes": [],
        "fetched": [],
        "failed": [],
        "not_found": []
    }


def save_catalog(catalog: Dict[str, Any], catalog_path: Path):
    """Save catalog state"""
    catalog_path.write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False),
        encoding='utf-8'
    )


def add_to_catalog(catalog: Dict[str, Any], tune_name: str, status: str):
    """Update catalog with fetch result"""
    # Remove from other lists first
    for key in ['fetched', 'failed', 'not_found']:
        if tune_name in catalog.get(key, []):
            catalog[key].remove(tune_name)

    # Add to appropriate list
    if status == 'fetched':
        catalog.setdefault('fetched', []).append(tune_name)
    elif status == 'not_found':
        catalog.setdefault('not_found', []).append(tune_name)
    else:
        catalog.setdefault('failed', []).append(tune_name)
