"""
Curated list of popular bluegrass/old-time fiddle tunes for TuneArch fetching.

These are instrumentals commonly played at jams and sessions.
"""

import json
from pathlib import Path
from typing import List, Dict, Any

# Top fiddle tunes - prioritized by jam popularity
# Expanded from Jack Tuttle's collection + TuneArch standards
TUNE_LIST = [
    # === TIER 1: Essential jam tunes (everyone knows these) ===
    "Old Joe Clark",
    "Soldier's Joy",
    "Red Haired Boy",
    "Whiskey Before Breakfast",
    "Salt Creek",
    "Blackberry Blossom",
    "Cripple Creek",
    "Arkansas Traveler",
    "Billy in the Lowground",
    "Turkey in the Straw",

    # === TIER 2: Very common jam tunes ===
    "Angeline the Baker",
    "June Apple",
    "Cherokee Shuffle",
    "Boil Them Cabbage Down",
    "Fisher's Hornpipe",
    "Red Wing",
    "Temperance Reel",
    "Devil's Dream",
    "Foggy Mountain Breakdown",
    "St. Anne's Reel",

    # === TIER 3: Standard session tunes ===
    "Leather Britches",
    "Forked Deer",
    "Eighth of January",
    "Jerusalem Ridge",
    "Sally Goodin",
    "Liberty",
    "Mississippi Sawyer",
    "Ragtime Annie",
    "Beaumont Rag",
    "Black Mountain Rag",

    # === TIER 4: Well-known classics ===
    "Big Mon",
    "Wheel Hoss",
    "Clinch Mountain Backstep",
    "Kitchen Girl",
    "Fire on the Mountain",
    "Cattle in the Cane",
    "Flop Eared Mule",
    "Cotton Eyed Joe",
    "Over the Waterfall",
    "Road to Columbus",

    # === TIER 5: Popular breakdowns ===
    "Bluegrass Breakdown",
    "Pike County Breakdown",
    "Foggy Mountain Special",
    "Brown County Breakdown",
    "Shenandoah Breakdown",
    "North Carolina Breakdown",
    "Dixie Breakdown",
    "Ashland Breakdown",
    "Earl's Breakdown",
    "Ground Speed",

    # === TIER 6: Contest/show tunes ===
    "Orange Blossom Special",
    "Lonesome Fiddle Blues",
    "Rawhide",
    "Big Sciota",
    "Brilliancy",
    "Remington Ride",
    "Done Gone",
    "Daybreak in Dixie",
    "Dear Old Dixie",
    "Dixie Hoedown",

    # === TIER 7: Traditional old-time ===
    "Cluck Old Hen",
    "Growling Old Man",
    "Squirrel Hunters",
    "Old Molly Hare",
    "Cumberland Gap",
    "Cuckoo's Nest",
    "Cold Frosty Morning",
    "Lost Indian",
    "Chinquapin Hunting",
    "Shuckin' the Corn",

    # === TIER 8: Waltzes ===
    "Ashokan Farewell",
    "Westphalia Waltz",
    "Lonesome Moonlight Waltz",
    "Festival Waltz",
    "Tennessee Waltz",
    "Cattle Call Waltz",
    "Shenandoah Waltz",
    "Ookpik Waltz",
    "Red Fox Waltz",
    "Lover's Waltz",

    # === TIER 9: More jam favorites ===
    "Hop High Ladies",
    "Old Mother Flanagan",
    "Katy Hill",
    "Dusty Miller",
    "Grey Eagle",
    "Golden Slippers",
    "Bonaparte's Retreat",
    "Napoleon Crossing the Rhine",
    "Rickett's Hornpipe",
    "Durang's Hornpipe",

    # === TIER 10: Kenny Baker / Bill Monroe tunes ===
    "Big Tilda",
    "Jerusalem Ridge",
    "Wheel Hoss",
    "Gold Rush",
    "Road to Columbus",
    "Watson Blues",
    "Cheyenne",
    "Southern Flavor",
    "Kentucky Mandolin",
    "Big Country",

    # === TIER 11: More traditional tunes ===
    "Dry and Dusty",
    "Spotted Pony",
    "Stoney Point",
    "Sandy River Belle",
    "Seneca Square Dance",
    "Josie Girl",
    "West Fork Gals",
    "Green Willis",
    "Dubuque",
    "Durham's Reel",

    # === TIER 12: Blues-influenced tunes ===
    "East Tennessee Blues",
    "Florida Blues",
    "Fiddler's Blues",
    "Farewell Blues",
    "Carter's Blues",
    "Maury River Blues",
    "Tennessee Blues",
    "Fireball Mail",

    # === TIER 13: Reels and hornpipes ===
    "Daley's Reel",
    "Ross Reel",
    "Calliope House",
    "Swallowtail Jig",
    "Tam Lin",
    "Kid on the Mountain",
    "Morrison's Jig",
    "Connemara",
    "Calum's Road",
    "Last of Harris",

    # === TIER 14: More session standards ===
    "Barlow Knife",
    "Bob Taylor's March",
    "Chapel Hill March",
    "Green River March",
    "Under the Double Eagle",
    "Alabama Jubilee",
    "Down Yonder",
    "Bugle Call Rag",
    "Texas Gals",
    "Texas",

    # === TIER 15: Additional classics ===
    "Pig in a Pen",
    "Reuben",
    "Little Rabbit",
    "Old Dangerfield",
    "Ebenezer",
    "Elzic's Farewell",
    "Morehead",
    "Jonesboro",
    "Robinson County",
    "Stoney Creek",

    # === TIER 16: More old-time ===
    "Bear Creek Hop",
    "Arab Bounce",
    "Banjo Signal",
    "Banjo in the Hollow",
    "Crossing the Cumberlands",
    "Old Swinging Bridge",
    "Rock That Cradle Lucy",
    "Skunk in the Collard Patch",
    "Sledd Ridin'",
    "Tater Patch",

    # === TIER 17: Waltzes and slow tunes ===
    "Maiden's Prayer",
    "Red Prairie Dawn",
    "Louisiana Fairytale",
    "Sugar Moon",

    # === TIER 18: Contest pieces ===
    "Grey Owl",
    "Blackjack",
    "Boston Boy",
    "Craggy Spring",
    "Denver Belle",
    "La Betaille",
    "Needle Case",
    "New Camptown Races",
    "Ninety Degrees",
    "Pike's Peak",

    # === TIER 19: More variety ===
    "Blue Grass Special",
    "Blue Grass Stomp",
    "Blue Grass Twist",
    "New Five Cents",
    "Roy's Rag",
    "Scotland",
    "Stepstone",
    "Stoney Lonesome",
    "Theme Time",
    "Red Wagon",

    # === TIER 20: Additional tunes ===
    "Doug's Tune",
    "Hard Times",
    "Liza Rose",
    "Old Aunt Adkins",
    "Old Ebenezer Scrooge",
    "Old Grey Horse",
    "Paddy on the Turnpike",
    "Sally Ann",
    "John Hardy",
    "John Henry",
    "Sugar in the Gourd",
    "Rock the Cradle Joe",
    "Sail Away Ladies",
    "Give the Fiddler a Dram",
    "Sugar Hill",
    "Harvest Home",
    "Waynesboro",
    "Fiddler's Dream",
    "Texas Gales",
    "Hamilton County Breakdown",
    "Lonesome Road Blues",
    "Drowsy Maggie",
    "The Irish Washerwoman",
    "Barefoot Fiddler",
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
