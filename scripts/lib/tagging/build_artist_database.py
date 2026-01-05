#!/usr/bin/env python3
"""
Build a comprehensive bluegrass artist database from Wikipedia and chart sources.

Queries MusicBrainz for metadata on each artist to enable era-based scoring.
"""

import json
import os
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# =============================================================================
# Raw artist data from Wikipedia and charts
# =============================================================================

# From Wikipedia: List of bluegrass musicians
WIKIPEDIA_MUSICIANS = """
Tom Adams, Eddie Adcock, David "Stringbean" Akeman, Red Allen, Darol Anger,
Mike Auldridge, Kenny Baker, Jessie Baker, Butch Baldassari, Russ Barenberg,
Byron Berline, Carroll Best, Norman Blake, Kathy Boyd, Dale Ann Bradley,
David Bromberg, Herman Brock Jr, Jesse Brock, Alison Brown, Buckethead,
Buzz Busby, Roger Bush, Sam Bush, Ann Marie Calhoun, Jason Carter,
Vassar Clements, Michael Cleveland, Bill Clifton, Charlie Cline, Curly Ray Cline,
Mike Compton, John Byrne Cooke, J. P. Cormier, John Cowan, Dan Crary, J. D. Crowe,
Jamie Dailey, Charlie Daniels, Vernon Derrick, Hazel Dickens, Doug Dillard,
Jerry Douglas, Casey Driessen, John Duffey, Stuart Duncan, Chris Eldridge,
Bill Emerson, Bill Evans, Raymond Fairchild, Dennis Fetchet, Pete Fidler,
Lester Flatt, Béla Fleck, Sally Ann Forrester, Randall Franks, Tony Furtado,
Jerry Garcia, Josh Graves, Vince Gill, Brennan Gilmore, Johnny Gimble,
Rhiannon Giddens, Richard Greene, Clinton Gregory, David Grier, Andy Griffith,
David Grisman, Jamie Hartford, John Hartford, Aubrey Haynie, John Herald,
Bobby Hicks, Winky Hicks, Chris Hillman, Scott Holstein, Sierra Hull, Rob Ickes,
Jana Jae, Sarah Jarosz, Mitchell F. Jayne, Michael Kang, Kaia Kater, Larry Keel,
Leslie Keith, Irene Kelley, Danny Knicely, Kenny Kosek, Alison Krauss,
Gundula Krause, Robert Křesťan, Shawn Lane, Jim Lauderdale, Bernie Leadon,
Doyle Lawson, Kate Lee, Ray Legere, Laurie Lewis, Benjamin F. Logan,
Patty Loveless, Andy Leftwich, Claire Lynch, Mack Magaha, Benny Martin,
Jimmy Martin, Mac Martin, Steve Martin, Bessie Lee Mauldin, Del McCoury,
Jesse McReynolds, Jim McReynolds, Edgar Meyer, Charlie Monroe, Bill Monroe,
Alan Munde, Penny Nichols, Alecia Nugent, Tim O'Brien, Mark O'Connor,
Dolly Parton, Todd Phillips, Danny Paisley, Missy Raines, Tommy Ramone,
David Rawlings, Don Reno, Tony Rice, Alwyn Robinson, Peter Rowan, Gary Ruley,
Josh Shilling, Earl Scruggs, Ricky Skaggs, Arthur Lee "Red" Smiley,
Arthur "Guitar Boogie" Smith, Ruby Jane Smith, Johnny Staats, Carter Stanley,
Ralph Stanley, Chris Stapleton, Andy Statman, Larry Stephenson, Billy Strings,
Marty Stuart, Eddie Stubbs, Bryan Sutton, Gordon Terry, Chris Thile,
Tony Trischka, Josh Turner, Molly Tuttle, Dan Tyminski, Donna Ulisse,
Jim Van Cleve, Rhonda Vincent, Charlie Waller, Sara Watkins, Doc Watson,
Eric Weissberg, Dean Webb, Gillian Welch, Clarence White, Roland White,
Keith Whitley, Benny Williams, "Big" Paul Williams, Vern Williams, Chubby Wise,
Mac Wiseman, Gene Wooten, Rex Yetman
"""

# From Wikipedia: List of bluegrass bands
WIKIPEDIA_BANDS = """
The Accidentals, Acoustic Syndicate, Authentic Unlimited, Balsam Range,
Barry Scott & Second Wind, Bearfoot, The Beef Seeds, Bill Monroe & His Bluegrass Boys,
Biscuit Burners, Blackberry Smoke, BlueBilly Grit, Blue Highway, Bluegrass Album Band,
Bluegrass Brothers, Bob Paisley and the Southern Grass, Kathy Boyd and Phoenix Rising,
Chesapeake, Charles River Valley Boys, The Charlie Daniels Band, The Coal Porters,
The Country Gentlemen, The Cox Family, Cherryholmes, Chatham County Line,
Clinch Mountain Boys, Crooked Still, Crow and the Canyon, Dailey & Vincent,
Danny Paisley and the Southern Grass, The Dead South, Del McCoury Band, Della Mae,
The Dillards, Dixie Flyers, Dixie Gentlemen, Doyle Lawson & Quicksilver,
Druhá Tráva, Dry Branch Fire Squad, East Coast Bluegrass Band,
Foggy Mountain Boys, Flatt and Scruggs, Front Porch String Band,
Gary Ruley and Mule Train, The Gibson Brothers, Good Old Guard Gospel Singers,
The Grascals, The Greenbriar Boys, The Greencards, Greensky Bluegrass,
Grass It Up, Hackensaw Boys, Hayde Bluegrass Orchestra, Hayseed Dixie,
The Hillbilly Thomists, The Hillmen, Hot Rize, IIIrd Tyme Out, Ila Auto,
The Infamous Stringdusters, Iron Horse, Jim and Jesse McReynolds and the Virginia Boys,
Jim & Jennie and the Pinetops, Johnson Mountain Boys, Kentucky Colonels,
Alison Krauss and Union Station, Lonesome Pine Fiddlers, Lonesome River Band,
Lonesome Sisters, Mission Mountain Wood Band, Mountain Heart, Muleskinner,
Nashville Bluegrass Band, Nashville Grass, Nefesh Mountain, New Grass Revival,
New South, Nickel Creek, Northern Lights, Nothin' Fancy, Oakhurst, Old & In the Way,
Osborne Brothers, Old Crow Medicine Show, Packway Handle Band, The Petersens,
Psychograss, Punch Brothers, The Rarely Herd, Rautakoura, Rhonda Vincent and the Rage,
Russell Moore and IIIrd Tyme Out, Railroad Earth, Saddle River String Band,
Salamander Crossing, The Seldom Scene, Sister Sadie, Sleepy Man Banjo Boys,
The Special Consensus, The Stanley Brothers, The SteelDrivers, The Steel Wheels,
Steep Canyon Rangers, The Stonemans, Billy Strings, Sweet Lillies, Tangleweed,
Trampled by Turtles, The Travelin' McCourys, Uncle Monk, Walker's Run, Water Tower,
Watkins Family Hour, The Waybacks, The Whiskey Boys, Robin and Linda Williams,
Wimberley Bluegrass Band, The Woodbox Gang, Yonder Mountain String Band
"""

# From Roots Music Report Top 50 (contemporary/active artists)
ROOTS_MUSIC_ARTISTS = """
Ashleigh Graham, The Burnett Sisters Band, Alison Krauss & Union Station,
Becky Buller, Alison Brown, Steve Martin, Leftover Salmon, Rick Faris,
DownRiver Collective, Tidalwave Road Bluegrass Band, East Nash Grass,
Sierra Hull, Matt Wallace, Wilson Banjo Co., Marty Falle, The Creekers,
Danny Burns, Molly Tuttle, Williamson Branch, Bibelhauser Brothers,
The Brothers Comatose, The Steeldrivers, Eddie Sanders, Grain Thief, Zach Top,
Tony Kamel, The Kentucky Gentlemen, Henhouse Prowlers, Special Consensus,
Jeremy Garrett, Sister Sadie, The Grascals, Pitney Meyer, The Faux Paws,
The Seldom Scene, Red Camel Collective, Jason Carter, Michael Cleveland,
Seth Mulder & Midnight Run, Iron Horse, Route 3, Graham Sharp, Jaelee Roberts,
Nefesh Mountain, Ragged Union
"""

# From AllMusic Contemporary Bluegrass (includes legends + contemporary)
ALLMUSIC_ARTISTS = """
Béla Fleck, Alison Krauss, Nickel Creek, Del McCoury, Jerry Douglas,
The Seldom Scene, Tony Trischka, David Grisman, Sam Bush, Punch Brothers,
The Gibson Brothers, Rhonda Vincent, Blue Highway, Doyle Lawson, Hot Rize,
James King, Sara Watkins, Sarah Jarosz, Yonder Mountain String Band, Sean Watkins,
Chatham County Line, Rob Ickes, Alison Brown, The Greencards, The Special Consensus,
Josh Graves, John Bullard, Russ Barenberg, Claire Lynch, Pierre Bensusan,
The Nashville Bluegrass Band, Lynn Morris, Al Tharp, Front Porch String Band,
Jake Armerding, Ralph Stanley, Grace & Tony, Steve Spurgin, Josh Williams,
Cadillac Sky, Ernie Thacker, Front Range, Three Ring Circle, Steep Canyon Rangers,
Noam Pikelny, John Cowan, Chris Jones, Onion Creek Crawdaddies, Della Mae,
Dale Ann Bradley, Hayseed Dixie, Randy Kohrs, The Hackensaw Boys, Marley's Ghost,
Mountain Heart, Bryan Sutton, Time for Three, The Grascals, Darren Hayman,
Dailey & Vincent, Tammy Rogers, The Infamous Stringdusters, Blind Corn Liquor Pickers,
Jesse McReynolds, Clinch Mountain Boys, The SteelDrivers, Sierra Hull, Hot Buttered Rum,
Joey + Rory, John Reischman, Steve Gulley, Bradley Walker, Davisson Brothers Band,
Balsam Range, Laurie Lewis, Candlewyck, The Black Lillies, Bob Amos,
Ralph Stanley & the Clinch Mountain Boys, Vassar Clements, Earl Scruggs,
Mac Wiseman, Peter Rowan, Steve Earle, Steve Martin, The Cox Family, Doc Watson,
New Grass Revival, The Del McCoury Band, Edie Brickell, Marty Stuart,
Marty Stuart & His Fabulous Superlatives, Dry Branch Fire Squad, Byron Berline,
Jerry Garcia, Dolly Parton, Charlie Louvin, Nora Jane Struthers
"""


def parse_artists(text: str) -> List[str]:
    """Parse comma-separated artist names, cleaning up formatting."""
    # Split by comma or newline
    names = re.split(r'[,\n]+', text)

    result = []
    for name in names:
        # Clean up
        name = name.strip()
        name = re.sub(r'\s+', ' ', name)  # Normalize whitespace

        # Skip empty
        if not name:
            continue

        # Remove parenthetical notes like "(aka ...)"
        name = re.sub(r'\s*\([^)]*\)\s*$', '', name)

        # Skip if too short
        if len(name) < 2:
            continue

        result.append(name)

    return result


def deduplicate_artists(all_artists: List[str]) -> List[str]:
    """Deduplicate artists, handling variations like 'The' prefix."""
    seen = {}  # normalized -> original

    for artist in all_artists:
        # Normalize for comparison
        normalized = artist.lower()
        normalized = re.sub(r'^the\s+', '', normalized)
        normalized = re.sub(r'\s+', ' ', normalized)

        # Keep first occurrence or longer version
        if normalized not in seen or len(artist) > len(seen[normalized]):
            seen[normalized] = artist

    return sorted(seen.values())


def get_all_bluegrass_artists() -> List[str]:
    """Get deduplicated list of all bluegrass artists from all sources."""
    all_artists = []

    all_artists.extend(parse_artists(WIKIPEDIA_MUSICIANS))
    all_artists.extend(parse_artists(WIKIPEDIA_BANDS))
    all_artists.extend(parse_artists(ROOTS_MUSIC_ARTISTS))
    all_artists.extend(parse_artists(ALLMUSIC_ARTISTS))

    return deduplicate_artists(all_artists)


# =============================================================================
# MusicBrainz Queries
# =============================================================================

def get_db_connection():
    """Get MusicBrainz database connection."""
    import psycopg2

    return psycopg2.connect(
        dbname=os.getenv("MB_DBNAME", "musicbrainz_db"),
        user=os.getenv("MB_USER", "musicbrainz"),
        password=os.getenv("MB_PASSWORD", "musicbrainz"),
        host=os.getenv("MB_HOST", "localhost"),
        port=os.getenv("MB_PORT", "5432"),
    )


def query_artist_metadata(artist_names: List[str]) -> Dict[str, Dict]:
    """
    Query MusicBrainz for artist metadata.

    Returns dict mapping artist name -> {
        'id': mbid,
        'name': canonical name,
        'type': 'Person' or 'Group',
        'begin_year': start year or None,
        'end_year': end year or None,
        'recording_count': number of recordings,
        'release_count': number of releases,
    }
    """
    query = """
    WITH artist_matches AS (
        SELECT
            a.id,
            a.gid,
            a.name,
            a.type,
            a.begin_date_year,
            a.end_date_year,
            -- Count recordings
            (SELECT COUNT(DISTINCT r.id)
             FROM musicbrainz.artist_credit_name acn
             JOIN musicbrainz.recording r ON r.artist_credit = acn.artist_credit
             WHERE acn.artist = a.id) as recording_count,
            -- Count releases
            (SELECT COUNT(DISTINCT rel.id)
             FROM musicbrainz.artist_credit_name acn
             JOIN musicbrainz.release rel ON rel.artist_credit = acn.artist_credit
             WHERE acn.artist = a.id) as release_count
        FROM musicbrainz.artist a
        WHERE a.name = ANY(%s)
    )
    SELECT * FROM artist_matches
    ORDER BY recording_count DESC
    """

    results = {}

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (artist_names,))

            for row in cur.fetchall():
                artist_id, mbid, name, artist_type, begin_year, end_year, rec_count, rel_count = row

                # Get type name
                type_name = None
                if artist_type:
                    cur.execute("SELECT name FROM musicbrainz.artist_type WHERE id = %s", (artist_type,))
                    type_row = cur.fetchone()
                    if type_row:
                        type_name = type_row[0]

                # Only keep if not already seen (prefer higher recording count)
                if name not in results or results[name]['recording_count'] < rec_count:
                    results[name] = {
                        'mbid': str(mbid),
                        'name': name,
                        'type': type_name,
                        'begin_year': begin_year,
                        'end_year': end_year,
                        'recording_count': rec_count,
                        'release_count': rel_count,
                    }

    return results


def build_artist_database(output_file: Path) -> Dict:
    """
    Build comprehensive artist database with MusicBrainz metadata.
    """
    import time

    print("Parsing artist lists...")
    artists = get_all_bluegrass_artists()
    print(f"  Found {len(artists)} unique artists/bands")

    print("\nQuerying MusicBrainz for metadata...")
    start = time.time()

    # Query in batches
    batch_size = 50
    all_metadata = {}
    not_found = []

    for i in range(0, len(artists), batch_size):
        batch = artists[i:i + batch_size]
        print(f"  Batch {i // batch_size + 1}/{(len(artists) + batch_size - 1) // batch_size}...")

        metadata = query_artist_metadata(batch)
        all_metadata.update(metadata)

        # Track not found
        for name in batch:
            if name not in metadata:
                not_found.append(name)

    elapsed = time.time() - start
    print(f"\nFound {len(all_metadata)} artists in MusicBrainz ({elapsed:.1f}s)")
    print(f"Not found: {len(not_found)}")

    if not_found:
        print("\nArtists not found in MusicBrainz:")
        for name in sorted(not_found)[:20]:
            print(f"  - {name}")
        if len(not_found) > 20:
            print(f"  ... and {len(not_found) - 20} more")

    # Build output
    database = {
        'artists': all_metadata,
        'not_found': not_found,
        'sources': ['wikipedia_musicians', 'wikipedia_bands', 'roots_music_report', 'allmusic'],
        'version': 1,
    }

    # Save
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump(database, f, indent=2)

    print(f"\nSaved to {output_file}")

    return database


def analyze_database(db_file: Path):
    """Analyze the artist database to inform tier assignments."""
    with open(db_file) as f:
        database = json.load(f)

    artists = database['artists']

    print(f"\n=== Artist Database Analysis ===")
    print(f"Total artists: {len(artists)}")

    # Group by era
    founding = []  # pre-1970
    classic = []   # 1970-1995
    modern = []    # 1996+
    unknown = []

    for name, data in artists.items():
        begin = data.get('begin_year')
        if not begin:
            unknown.append((name, data))
        elif begin < 1970:
            founding.append((name, data))
        elif begin < 1996:
            classic.append((name, data))
        else:
            modern.append((name, data))

    print(f"\nBy era:")
    print(f"  Founding (<1970): {len(founding)}")
    print(f"  Classic (1970-1995): {len(classic)}")
    print(f"  Modern (1996+): {len(modern)}")
    print(f"  Unknown: {len(unknown)}")

    # Top by recording count
    print(f"\nTop 30 by recording count:")
    sorted_artists = sorted(artists.items(), key=lambda x: -x[1]['recording_count'])
    for name, data in sorted_artists[:30]:
        begin = data.get('begin_year', '?')
        print(f"  {data['recording_count']:5d} | {begin} | {name}")

    # Founding era artists
    print(f"\nFounding era artists (<1970):")
    for name, data in sorted(founding, key=lambda x: -x[1]['recording_count'])[:20]:
        print(f"  {data['recording_count']:5d} | {data.get('begin_year', '?')} | {name}")


# =============================================================================
# CLI
# =============================================================================

if __name__ == '__main__':
    import argparse

    DATA_DIR = Path(__file__).parent.parent.parent.parent / 'docs' / 'data'
    DEFAULT_OUTPUT = DATA_DIR / 'bluegrass_artist_database.json'

    parser = argparse.ArgumentParser(description='Build bluegrass artist database')
    parser.add_argument('--build', action='store_true', help='Build database from MusicBrainz')
    parser.add_argument('--analyze', action='store_true', help='Analyze existing database')
    parser.add_argument('--list', action='store_true', help='Just list parsed artists')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT, help='Output file')

    args = parser.parse_args()

    if args.list:
        artists = get_all_bluegrass_artists()
        print(f"Found {len(artists)} unique artists:\n")
        for artist in artists:
            print(f"  {artist}")

    elif args.build:
        build_artist_database(args.output)

    elif args.analyze:
        if not args.output.exists():
            print(f"Database not found: {args.output}")
            print("Run with --build first")
        else:
            analyze_database(args.output)

    else:
        parser.print_help()
