# Landing Page Research: Defining "What is Bluegrass"

This document synthesizes research for building a better landing page that surfaces bluegrass content more prominently.

## Problem Statement

From GitHub Issue #112:
- Users feel the site is a "bait-and-switch" - bluegrass branding but 17k+ songs including lots of non-bluegrass
- Need to surface the "bluegrass corpus" more prominently
- Landing page should pre-aggregate content into purposeful categories

## Current Data Inventory

### Tag Distribution (full index)
| Tag | Count |
|-----|-------|
| JamFriendly | 14,168 |
| ClassicCountry | 6,423 |
| Rockabilly | 1,175 |
| Modal | 946 |
| Outlaw | 869 |
| Pop | 817 |
| Folk | 721 |
| HonkyTonk | 662 |
| Gospel | 649 |
| **Bluegrass** | **588** |
| Instrumental | 505 |
| NashvilleSound | 369 |
| Jazzy | 53 |
| Jazz | 9 |
| WesternSwing | 7 |

### Bluegrass-Tagged Artists (24 artists in index)
Artists whose songs are tagged `Bluegrass` via MusicBrainz:
- Alison Krauss, Dan Tyminski, Dolly Parton, Don Reno, Earl Scruggs
- Hazel Dickens, Jimmy Martin, John Hartford, Larry Sparks, Lester Flatt
- Lonesome River Band, Nitty Gritty Dirt Band, Patty Loveless, Ricky Skaggs
- The Bluegrass Cardinals, The Gibson Brothers, The Grascals, The Louvin Brothers
- The Seldom Scene, The Stanley Brothers, The Steeldrivers, Trampled by Turtles, Vince Gill

### Golden Standard Collection
86 curated bluegrass songs in `sources/golden-standard/parsed/`

### Strum Machine Integration
Songs in our catalog that also exist in Strum Machine (a curated jam practice app) are marked. This is NOT a count of bluegrass songs - it's songs we can link to Strum Machine for practice.

---

## Canonical Source: Jack Tuttle's Bluegrass History

Jack Tuttle (jacktuttle.com) is a respected bluegrass instructor whose "About Bluegrass" page provides authoritative context.

### Bluegrass Timeline (Eras)

#### 1. Pre-Bluegrass Era (1920s-1945)
- 1920s: Radio and Records bring music to rural America
- 1925: WSM Radio, Grand Ole Opry
- 1927: Jimmy Rodgers and Carter Family - first "hillbilly" records
- 1935-1938: Monroe Brothers era
- 1939: Bill Monroe joins Grand Ole Opry (NOT bluegrass yet)

#### 2. Birth of Bluegrass (1945-1949)
- **1945**: Earl Scruggs joins Bill Monroe's band
- **1946**: First recording of bluegrass (Bill Monroe + Flatt, Scruggs, Wise, Watts)
- 1947: Stanley Brothers start
- 1948: Flatt & Scruggs leave Monroe

#### 3. Foundational Era (1950s)
- Bluegrass becomes a genre with a name
- 1951: Reno & Smiley
- 1952: Jim & Jesse
- 1954: Jimmy Martin + Osborne Brothers
- 1955: Flatt & Scruggs add Josh Graves (Dobro)
- 1957: Country Gentlemen (seeds of Newgrass)

#### 4. Folk Revival Era (1960s)
- 1960: Doc Watson discovered
- 1963: "High Lonesome" coined, Bill Keith melodic banjo
- 1964: Clarence White with Kentucky Colonels
- 1965: First bluegrass festival (Carlton Haney)
- 1966: Bluegrass Unlimited magazine, Carter Stanley dies

#### 5. Festival/Newgrass Era (1970s)
- 1972: Deliverance movie
- 1973: Clarence White dies, Tony Rice rises
- Festival scene explodes

#### 6. New Traditionalists Era (1980s)
- Skaggs, Stuart, Whitley, Gill
- 1982: Skaggs & Rice album
- 1985: IBMA forms

#### 7. Modern Era (1990s-2000s)
- 1995: Alison Krauss crossover success
- 1996: Bill Monroe dies
- 2000: O Brother Where Art Thou

### Core "First Generation" Bands (Jack Tuttle's List)

| Band | Significance |
|------|-------------|
| **Bill Monroe & Blue Grass Boys** | Father of Bluegrass, training ground for all |
| **Flatt & Scruggs** | Tightest rhythm, innovative banjo, smooth vocals |
| **Stanley Brothers** | Haunting mountain-style harmonies |
| **Jimmy Martin** | Strong voice, country end of spectrum |
| **Jim & Jesse** | Smooth vocals, Jesse's cross-picking mandolin |
| **Reno & Smiley** | Prolific songwriting, ahead-of-time banjo |
| **Osborne Brothers** | Harmony stacking, Bobby's high lead |

### Bluegrass Instruments
1. **Banjo** - "drive" of bluegrass, Earl Scruggs style
2. **Mandolin** - offbeat chop, tremolo, Bill Monroe
3. **Guitar** - bass runs, G runs, Tony Rice
4. **Fiddle** - double-stops, fills
5. **Bass** - root-fifth, bass runs
6. **Dobro** - slides, fills (added later by Flatt & Scruggs)

---

## Data Analysis Results

Run `uv run python analytics/bluegrass-research/analyze_bluegrass_corpus.py` for full analysis.

### Songs by Bluegrass Era (from index)

| Era | Songs | Example Artists |
|-----|-------|-----------------|
| Pre-Bluegrass (1920s-1945) | 6 | Carter Family, Jimmie Rodgers |
| **First Generation (1945-1960)** | **259** | Bill Monroe, Jimmy Martin, Ralph Stanley |
| Folk Revival (1960s) | 35 | Doc Watson, Country Gentlemen |
| Festival/Newgrass (1970s) | 60 | J.D. Crowe, New Grass Revival, Seldom Scene |
| **New Traditionalists (1980s)** | **387** | Ricky Skaggs, Del McCoury, Keith Whitley |
| Modern (1990s+) | 35 | Alison Krauss, Billy Strings, Blue Highway |
| **TOTAL** | **782** | |

### Country Crossover Artists (in index, but not "bluegrass")

| Artist | Songs | Notes |
|--------|-------|-------|
| George Jones | 319 | Honky-tonk, played at jams |
| Merle Haggard | 269 | Outlaw country |
| Willie Nelson | 165 | Outlaw country |
| Loretta Lynn | 137 | Classic country |
| Dolly Parton | 121 | Has bluegrass collabs, but primarily country |
| Emmylou Harris | 112 | Folk/country crossover |
| Patsy Cline | 90 | Nashville Sound |

---

## Proposed Landing Page Categories

### 1. "Bluegrass Standards" (The Canon)
**Count**: ~1,000 unique songs (combining sources)
**Sources**:
- Songs tagged `Bluegrass`: 588
- Songs from bluegrass-era artists: 782
- Golden Standard collection: 86

**Implementation**: `tag:Bluegrass OR artist:in(bluegrass_artist_list)`

Example songs:
- Blue Moon of Kentucky
- Man of Constant Sorrow
- Foggy Mountain Breakdown
- I'll Fly Away
- Rocky Top

### 2. "By Era" (Browsing by Bluegrass History)
Based on Jack Tuttle's timeline with song counts:

| Era | Songs | Key Artists |
|-----|-------|-------------|
| First Generation (1945-1960) | 259 | Monroe, Flatt & Scruggs, Stanley Brothers |
| Folk Revival (1960s) | 35 | Doc Watson, Country Gentlemen |
| Festival Era (1970s) | 60 | Tony Rice, Seldom Scene, New Grass Revival |
| New Traditionalists (1980s) | 387 | Ricky Skaggs, Del McCoury |
| Modern (1990s+) | 35 | Alison Krauss, Billy Strings |

**Implementation**: Artist → Era mapping (see `analyze_bluegrass_corpus.py`)

### 3. "Classic Country for Jams"
**Count**: Intersection of ClassicCountry (6,423) and JamFriendly (14,168)
**Query**: `tag:ClassicCountry tag:JamFriendly`

Songs that aren't "true bluegrass" but are commonly played at bluegrass jams:
- Hank Williams songs
- George Jones favorites
- Merle Haggard standards

### 4. "Fiddle Tunes & Instrumentals"
**Count**: 505 songs
**Query**: `tag:Instrumental`
- TuneArch fiddle tunes
- Banjo breakdowns
- Traditional tunes

### 5. "Gospel Bluegrass"
**Count**: 649 songs
**Query**: `tag:Gospel`
- Significant part of bluegrass tradition
- 3-4 part harmony songs

### 6. "Jam-Friendly Songs"
**Count**: 14,168 songs
**Query**: `tag:JamFriendly`
- Core value prop for jam musicians
- Songs with simple I-IV-V progressions
- ≤5 unique chords, no complex extensions

---

## Research To Do: MusicBrainz Queries

When connected to MusicBrainz, build queries to:

1. **Find ALL bluegrass-tagged artists** (not just those in our index)
2. **Match Jack Tuttle's artist list** against MusicBrainz
3. **Find songs by first-generation artists** for era browsing
4. **Build a "bluegrass corpus"** of artist IDs for filtering

### Key Artists to Query (from Jack Tuttle)

First Generation (1945-1960):
- Bill Monroe
- Flatt & Scruggs / Lester Flatt / Earl Scruggs
- Stanley Brothers / Ralph Stanley / Carter Stanley
- Jimmy Martin
- Jim & Jesse / Jim McReynolds / Jesse McReynolds
- Don Reno / Reno & Smiley
- Osborne Brothers / Bobby Osborne / Sonny Osborne

Later Essential Artists:
- Doc Watson, Tony Rice, J.D. Crowe
- Ricky Skaggs, Del McCoury, Alison Krauss
- Doyle Lawson, Seldom Scene, Country Gentlemen

---

## Implementation Notes

1. **Hide stats**: Remove "17,000 songs" from landing page
2. **Feature bluegrass first**: Show bluegrass-tagged songs on landing
3. **Curated sections**: Pre-built search queries for each category
4. **Era browsing**: Allow browsing by bluegrass era (1945-1959, etc.)
5. **Artist-centric**: Consider artist cards for first-generation bands

---

## Additional Canonical Sources

### IBMA (International Bluegrass Music Association)

The IBMA is the authoritative body for bluegrass music. Their annual awards provide a canonical list of current bluegrass artists.

**2024 IBMA Award Winners:**
- Entertainer of the Year: The Del McCoury Band (9th win!)
- Album of the Year: *City of Gold* - Molly Tuttle & Golden Highway
- Song of the Year: "Fall in Tennessee" - Authentic Unlimited
- Vocal Group of the Year: Authentic Unlimited
- Collaborative Recording: "Brown's Ferry Blues" - Tony Trischka featuring Billy Strings

**2025 IBMA Award Winners:**
- Entertainer of the Year: Billy Strings
- Gospel Recording: "He's Gone" - Jaelee Roberts
- Instrumental Recording: "Ralph's Banjo Special" - Kristin Scott Benson, Gena Britt & Alison Brown

**Hall of Fame (2024):** Alan Munde, Katy Daley, Jerry Douglas

### Major Bluegrass Festivals (2025)

Festivals are canonical sources for "who is bluegrass" - artists booked at major bluegrass festivals are de facto bluegrass artists.

| Festival | Location | Notable Artists |
|----------|----------|-----------------|
| **DelFest** | Cumberland, MD | Del McCoury Band, Travelin' McCourys, Sierra Ferrell |
| **Tico Time** | Durango, CO | Infamous Stringdusters, Leftover Salmon, Railroad Earth |
| **Wintergrass** | Bellevue, WA | Steep Canyon Rangers, Della Mae |
| **Earl Scruggs Festival** | Mill Spring, NC | Named after the legend |
| **IBMA World of Bluegrass** | Chattanooga, TN | Industry conference + shows |

### Wikipedia: Bluegrass Subgenres

| Subgenre | Description | Key Artists |
|----------|-------------|-------------|
| **Traditional** | Original Bill Monroe style, acoustic instruments, I-IV-V progressions | Bill Monroe, Stanley Brothers, Flatt & Scruggs |
| **Progressive/Newgrass** | Fuses jazz, rock, other styles; extended solos | New Grass Revival, Seldom Scene, Kentucky Colonels |
| **Neo-Traditional** | Modern take on traditional sound with polish | Alison Krauss, Del McCoury, Nickel Creek |
| **Bluegrass Gospel** | Christian lyrics, 3-4 part harmony | (cross-cuts all eras) |

---

## Edge Cases & Notes

### Country Artists Who Cover Bluegrass
Some artists are NOT primarily bluegrass but have covered bluegrass songs:
- **Dolly Parton** - Has covered many bluegrass songs, collaborated with bluegrass artists, but is primarily a country artist
- **Emmylou Harris** - Similar situation; country/folk but has bluegrass collaborations

### Progressive Artists to Include
Modern progressive/contemporary artists (per user research):
- Noam Pikelny, Hot Rize, Béla Fleck (NOT Flecktones)
- Michael Cleveland, Tony Trischka, Blue Highway
- Greensky Bluegrass, Yonder Mountain String Band
- Railroad Earth, Leftover Salmon

---

## Files Referenced
- `docs/data/index.jsonl` - Full song index
- `docs/data/artist_tags.json` - MusicBrainz artist tags cache
- `sources/golden-standard/` - 86 curated bluegrass songs
- `scripts/lib/tag_enrichment.py` - Tag taxonomy and mapping
- `analytics/bluegrass-research/bluegrass_queries.sql` - MusicBrainz SQL queries

## External Sources
- [IBMA Awards](https://ibma.org/international-bluegrass-music-awards/)
- [Bluegrass Today](https://bluegrasstoday.com/)
- [Bluegrass Country Festival Calendar](https://bluegrasscountry.org/festivals/)
- [Wikipedia: Bluegrass Music](https://en.wikipedia.org/wiki/Bluegrass_music)
- [Jack Tuttle's About Bluegrass](https://www.jacktuttle.com/about-bluegrass/)
