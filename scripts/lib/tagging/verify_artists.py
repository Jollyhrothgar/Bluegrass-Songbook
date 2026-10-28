#!/usr/bin/env python3
"""Confirm each work's scraped `artist` against MusicBrainz (F9).

`artist` in work.yaml is whichever performer page a chart was scraped from.
It is never shown as the chart's artist — a cover is not a different
arrangement — but when MusicBrainz has that artist recording that title, the
song earns a "Recorded by" credit, with the year of the earliest dated
release.

The credit shown is the name MusicBrainz credits, not the scraped string, so
every name on a page is one MusicBrainz can show: a scraped "Doyle Lawson"
confirmed through his band is credited "Doyle Lawson & Quicksilver", and
"Earl Scruggs and Lester Flatt" becomes "Flatt & Scruggs".

A scraped name is tried as (MusicBrainz artist names and aliases, either way):
  1. written, and spelled with `&`/`and` swapped and with/without "The"
  2. its members, when it names a duo or list ("X and Y", "X / Y", "X, Y")
  3. bands any of those artists was a member of, and groups named
     "<name> & …" / "<name> and …" / "<name> with …"
Titles must match after normalization (grassiness.normalize_title, plus
"Blowin'" = "Blowing"). No fuzzy titles: a near-identical title is too often
a different song.

Writes docs/data/verified_artists.json, one entry per work that has a real
artist — checked ones included, so a build can tell "unconfirmed" from
"never checked":

    {"you-are-my-sunshine": {"artist": "Johnny Cash", "name": "Johnny Cash", "year": 1975},
     "baby-shark": {"artist": "Misc Children", "name": null}}

`artist` is the work's artist as written when checked; an index build ignores
an entry once the work's artist has changed. `year` is null when no release
of the recording carries a date.

Local only — needs the MusicBrainz database. Run as part of
`./scripts/utility refresh-musicbrainz`; CI reads the committed cache.
"""

import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))
from tagging.grassiness import get_db_connection, normalize_title  # noqa: E402

REPO_ROOT = Path(__file__).parent.parent.parent.parent
WORKS_DIR = REPO_ROOT / 'works'
OUTPUT_FILE = REPO_ROOT / 'docs' / 'data' / 'verified_artists.json'

Loader = getattr(yaml, 'CSafeLoader', yaml.SafeLoader)


# ----------------------------------------------------------------- matching

def title_key(title: str) -> str:
    """normalize_title, with a dropped g restored ("Blowin'" = "Blowing")."""
    return normalize_title(re.sub(r"in['’](?=\W|$)", 'ing', title or '', flags=re.I))


def name_variants(name: str) -> set:
    """The name as written, `&`/`and` swapped, with and without "The"."""
    base = name.lower().strip()
    out = {base, base.replace(' and ', ' & '), base.replace(' & ', ' and ')}
    for v in list(out):
        out.add(v[4:] if v.startswith('the ') else 'the ' + v)
    return out


def name_parts(name: str) -> set:
    """Members of a duo or list credit: "Earl Scruggs and Lester Flatt"."""
    parts = re.split(r'\s+(?:and|&|with)\s+|\s*/\s*|,\s*', name.lower().strip())
    parts = [p for p in parts if p]
    return set(parts) if len(parts) > 1 else set()


def confirm(works: list, candidates: dict, recordings: dict, years: dict) -> dict:
    """Pure matching step.

    works:      [(work_id, title, artist), ...]
    candidates: {artist: {mb_artist_id, ...}} — every MusicBrainz artist the
                scraped name may stand for (see the module docstring)
    recordings: {mb_artist_id: [(recording_id, recording_title, credit_name), ...]}
    years:      {recording_id: earliest dated release year or None}

    Returns one entry per work: the credit with the earliest dated matching
    recording (ties: more recordings, then the credit spelled like the scraped
    name), or {"artist": ..., "name": None} when nothing matched.
    """
    out = {}
    for work_id, title, artist in works:
        key = title_key(title)
        by_credit = defaultdict(set)
        for mb_id in candidates.get(artist, ()):
            for rec_id, rec_title, credit in recordings.get(mb_id, ()):
                if title_key(rec_title) == key:
                    by_credit[credit].add(rec_id)
        if not by_credit:
            out[work_id] = {'artist': artist, 'name': None}
            continue

        def rank(item):
            credit, rec_ids = item
            dated = [years[r] for r in rec_ids if years.get(r)]
            return (min(dated) if dated else 9999, -len(rec_ids),
                    credit.lower() != artist.lower(), credit.lower())

        credit, rec_ids = min(by_credit.items(), key=rank)
        dated = [years[r] for r in rec_ids if years.get(r)]
        out[work_id] = {'artist': artist, 'name': credit, 'year': min(dated) if dated else None}
    return out


# --------------------------------------------------------------- database

def load_works(works_dir: Path = WORKS_DIR) -> list:
    """(id, title, artist) for every work with a real artist."""
    works = []
    for path in sorted(works_dir.glob('*/work.yaml')):
        with open(path) as f:
            data = yaml.load(f, Loader=Loader) or {}
        artist = str(data.get('artist') or '').strip()
        if artist and artist.lower() != 'traditional' and data.get('title'):
            works.append((str(data.get('id') or path.parent.name), str(data['title']), artist))
    return works


def resolve_names(cur, lower_names: set) -> dict:
    """{lower name: {artist ids}} by MusicBrainz artist name or alias."""
    cur.execute("""
        SELECT lower(a.name), a.id FROM musicbrainz.artist a WHERE lower(a.name) = ANY(%s)
        UNION
        SELECT lower(al.name), al.artist FROM musicbrainz.artist_alias al WHERE lower(al.name) = ANY(%s)
    """, (list(lower_names), list(lower_names)))
    out = defaultdict(set)
    for name, mb_id in cur:
        out[name].add(mb_id)
    return out


def find_candidates(cur, artists: list) -> dict:
    """{scraped artist: {MusicBrainz artist ids}} — names, members, bands."""
    names = {a: name_variants(a) | name_parts(a) for a in artists}
    resolved = resolve_names(cur, set().union(*names.values()) if names else set())
    cands = {a: set().union(*(resolved.get(n, set()) for n in ns)) for a, ns in names.items()}

    people = set().union(*cands.values()) if cands else set()
    cur.execute("""
        SELECT laa.entity0, laa.entity1
        FROM musicbrainz.l_artist_artist laa
        JOIN musicbrainz.link l ON l.id = laa.link
        JOIN musicbrainz.link_type lt ON lt.id = l.link_type
        WHERE lt.name = 'member of band' AND laa.entity0 = ANY(%s)
    """, (list(people),))
    bands = defaultdict(set)
    for person, band in cur:
        bands[person].add(band)

    patterns = [f'{a.lower()}{sep}%' for a in artists for sep in (' & ', ' and ', ' with ')]
    cur.execute("SELECT lower(a.name), a.id FROM musicbrainz.artist a WHERE lower(a.name) LIKE ANY(%s)",
                (patterns,))
    prefixed = list(cur)

    for a in artists:
        for person in list(cands[a]):
            cands[a] |= bands.get(person, set())
        prefix = a.lower()
        cands[a] |= {mb_id for name, mb_id in prefixed
                     if any(name.startswith(prefix + sep) for sep in (' & ', ' and ', ' with '))}
    return cands


def fetch_recordings(cur, artist_ids: set, wanted_titles: set) -> dict:
    """{artist id: [(recording id, title, credit name)]}, only for recordings
    whose title is one we are looking for."""
    cur.execute("""
        SELECT acn.artist, r.id, r.name, ac.name
        FROM musicbrainz.artist_credit_name acn
        JOIN musicbrainz.recording r ON r.artist_credit = acn.artist_credit
        JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
        WHERE acn.artist = ANY(%s)
    """, (list(artist_ids),))
    out = defaultdict(list)
    for mb_id, rec_id, rec_title, credit in cur:
        if title_key(rec_title) in wanted_titles:
            out[mb_id].append((rec_id, rec_title, credit))
    return out


def fetch_years(cur, recording_ids: list) -> dict:
    """{recording id: earliest release year} over every release the recording
    appears on, dated by country or not."""
    if not recording_ids:
        return {}
    cur.execute("""
        SELECT t.recording, MIN(COALESCE(rc.date_year, ruc.date_year))
        FROM musicbrainz.track t
        JOIN musicbrainz.medium m ON m.id = t.medium
        LEFT JOIN musicbrainz.release_country rc ON rc.release = m.release
        LEFT JOIN musicbrainz.release_unknown_country ruc ON ruc.release = m.release
        WHERE t.recording = ANY(%s)
        GROUP BY t.recording
    """, (recording_ids,))
    return {rec_id: year for rec_id, year in cur}


def main() -> None:
    start = time.time()
    works = load_works()
    artists = sorted({artist for _, _, artist in works})
    print(f"{len(works)} works with an artist ({len(artists)} distinct artists)")

    with get_db_connection() as conn, conn.cursor() as cur:
        candidates = find_candidates(cur, artists)
        all_ids = set().union(*candidates.values())
        print(f"  {len(all_ids)} MusicBrainz artists to search ({time.time() - start:.0f}s)")
        recordings = fetch_recordings(cur, all_ids, {title_key(t) for _, t, _ in works})
        rec_ids = sorted({r for recs in recordings.values() for r, _, _ in recs})
        years = fetch_years(cur, rec_ids)

    verified = confirm(works, candidates, recordings, years)
    OUTPUT_FILE.write_text(json.dumps(verified, indent=1, sort_keys=True, ensure_ascii=False) + '\n')
    confirmed = sum(1 for v in verified.values() if v.get('name'))
    print(f"Confirmed {confirmed} of {len(works)} works → {OUTPUT_FILE.relative_to(REPO_ROOT)} "
          f"({time.time() - start:.0f}s)")


if __name__ == '__main__':
    main()
