"""
Curated list of popular bluegrass/old-time fiddle tunes for TuneArch fetching.

These are instrumentals commonly played at jams and sessions.
"""

import json
from pathlib import Path
from typing import List, Dict, Any

# Top fiddle tunes - prioritized by jam popularity
TUNE_LIST = [
    # Tier 1: Essential jam tunes
    "Old Joe Clark",
    "Soldier's Joy",
    "Red Haired Boy",
    "Whiskey Before Breakfast",
    "Fisher's Hornpipe",
    "Temperance Reel",
    "Arkansas Traveler",
    "Devil's Dream",
    "Liberty",
    "Cherokee Shuffle",

    # Tier 2: Very common
    "Billy in the Lowground",
    "Angeline the Baker",
    "Cripple Creek",
    "Bile Them Cabbage Down",
    "June Apple",
    "St. Anne's Reel",
    "Ragtime Annie",
    "Forked Deer",
    "Grey Eagle",

    # Tier 3: Popular classics
    "Turkey in the Straw",
    "Golden Slippers",
    "Flop Eared Mule",
    "Red Wing",
    "Leather Britches",
    "Cotton Eyed Joe",
    "Cattle in the Cane",
    "Eighth of January",
    "Road to Columbus",
    "Big Sciota",

    # Tier 4: Well-known tunes
    "Beaumont Rag",
    "Black Mountain Rag",
    "Kitchen Girl",
    "Clinch Mountain Backstep",
    "John Hardy",
    "Fire on the Mountain",
    "Katy Hill",
    "Sally Goodin",
    "Sally Ann",

    # Tier 5: Session favorites
    "Drowsy Maggie",
    "The Irish Washerwoman",
    "Mississippi Sawyer",
    "Rickett's Hornpipe",
    "Hop High Ladies",
    "Old Mother Flanagan",
    "Durang's Hornpipe",
    "Harvest Home",
    "Napoleon Crossing the Rhine",
    "Over the Waterfall",

    # Tier 6: More great tunes
    "Waynesboro",
    "Jerusalem Ridge",
    "Big Mon",
    "Wheel Hoss",
    "New Five Cent",
    "Festival Waltz",
    "Ashoken Farewell",
    "Westphalia Waltz",

    # Tier 7: Contest/show tunes
    "Orange Blossom Special",
    "Fiddler's Dream",
    "Texas Gales",
    "Foggy Mountain Breakdown",
    "Earl's Breakdown",
    "Lonesome Fiddle Blues",
    "Brilliancy",
    "Hamilton County Breakdown",
    "Rawhide",

    # Tier 8: Traditional gems
    "Growling Old Man",
    "Sugar in the Gourd",
    "Cluck Old Hen",
    "Squirrel Hunters",
    "Rock the Cradle Joe",
    "Sail Away Ladies",
    "Give the Fiddler a Dram",
    "Sugar Hill",

    # Tier 9: More instrumentals
    "Roanoke",
    "Pike County Breakdown",
    "Lonesome Road Blues",
    "John Henry",
    "Lost Indian",
    "Dusty Miller",
    "Tam Lin",
    "Kid on the Mountain",
    "Morrison's Jig",
]


def get_tune_list() -> List[str]:
    """Return the curated list of tunes to fetch."""
    return TUNE_LIST


def load_catalog(path: Path) -> Dict[str, Any]:
    """Load the tune catalog from JSON file."""
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {"tunes": [], "fetched": [], "failed": [], "not_found": []}


def save_catalog(catalog: Dict[str, Any], path: Path) -> None:
    """Save the tune catalog to JSON file."""
    with open(path, 'w') as f:
        json.dump(catalog, f, indent=2)


def add_to_catalog(catalog: Dict[str, Any], tune_name: str, status: str) -> None:
    """Add a tune to the catalog with given status."""
    if status not in catalog:
        catalog[status] = []
    if tune_name not in catalog[status]:
        catalog[status].append(tune_name)
