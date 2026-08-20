"""Import ORACLE-VERIFIED tabs into works/ (job #3: publish the corpus).

Policy (Mike): only tabs whose parse matches the TablEdit oracle at 100%
(verdict VERIFIED in spike/oracle_manifest.json) are published. PARTIALs
follow as verification widens.

34 of the 87 verified pids predate the catalog scrape (they entered via
the raw_tabs triage, a personal folder of TEF files with no author
metadata in them); their page metadata is seeded into the catalog here
so every published tab carries attribution.

ATTRIBUTION WARNING (fixed 2026-08-19): the `author` column below
originally read "Jollyhrothgar" — the repo owner's handle — for 33 of
the 34 rows, and the docstring wrongly claimed it had been scraped from
the detail pages. It had not been: nothing here ever fetched a page, so
rows with no known author were filled in with the local user's handle.
That published 28 other people's tabs under the maintainer's name.
The authors below were recovered by reading the real
`browse.asp?m=detail&v={id}` pages; the five still marked None could not
be re-checked and are left blank ON PURPOSE. A missing author is
recoverable from source_url. A wrong one silently steals credit — never
default this field to anything, least of all to us.

Run from sources/banjo-hangout/:  python3 src/import_verified.py [--dry-run]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from catalog import TabCatalog, TabEntry
from site_config import get_site
from works_importer import import_tab

SITE = get_site('banjo-hangout')             # oracle verification is banjo-only
HERE = SITE.data_dir                         # sources/banjo-hangout
REPO = HERE.parent.parent                    # repo root
MANIFEST = REPO / 'spike' / 'oracle_manifest.json'
CATALOG = SITE.catalog_path

# Detail-page metadata for verified pids missing from the catalog.
# author is the Banjo Hangout poster, read off the tab's detail page.
# None means "not known" — leave it None rather than guessing (see the
# ATTRIBUTION WARNING above).
SCRAPED = [
    (12121, "Banjo In the Hollow", "Mirek Tim Patek", "4-String (Tenor/Plectrum)"),
    (12123, "Shuckin' the Corn", "Mirek Tim Patek", "Bluegrass (Scruggs)"),
    (12127, "Lonesome Road Blues", "Mirek Tim Patek", "4-String (Tenor/Plectrum)"),
    (12135, "Daley's Reel", "mwblake", "Other"),
    (13648, "Ashokan Farewell", "Ian_banjo", "Classical"),
    (13654, "Ducks on Millpond", "Julian44_4", "Clawhammer and Old-Time"),
    (14406, "Seneca Square Dance", "LyleK", "Clawhammer and Old-Time"),
    (14683, "Hot Corn Cold Corn", None, "4-String (Tenor/Plectrum)"),
    (15032, "Done Gone", "LyleK", "Clawhammer and Old-Time"),
    (15318, "Harvest Home", "Devon Wells", "Bluegrass (Scruggs)"),
    (17003, "Shooting Creek", "Julian44_4", "Clawhammer and Old-Time"),
    (17492, "Down Yonder", "janolov", "Clawhammer and Old-Time"),
    (18136, "The Irish Washerwoman", "drifter", "Clawhammer and Old-Time"),
    (18998, "Monroe's Hornpipe", "corcoran", "Bluegrass (Scruggs)"),
    (19600, "Paddy on the Turnpike", "PaddyThePicker", "Bluegrass (Scruggs)"),
    (19852, "Little Rabbit", "janolov", "Clawhammer and Old-Time"),
    (20545, "Dear Old Dixie", "bango", "Bluegrass (Scruggs)"),
    (20911, "Marching Jaybird", "janolov", "Clawhammer and Old-Time"),
    (20924, "Give the Fiddler a Dram", "dholland", "Bluegrass (Scruggs)"),
    (20981, "Sally Ann", "Jim Pankey", "Bluegrass (Scruggs)"),
    (21678, "Waterbound", "JanetB", "Clawhammer and Old-Time"),
    (21690, "Paddy on the Turnpike", None, "Clawhammer and Old-Time"),
    (21802, "Tennessee Mountain Fox Chase", "JanetB", "Clawhammer and Old-Time"),
    (21999, "Arkansas Hoosier", "JanetB", "Clawhammer and Old-Time"),
    (22191, "Lonesome Road Blues", None, "Bluegrass (Scruggs)"),
    (22228, "Waterbound", None, "Clawhammer and Old-Time"),
    (22290, "Scotland", "JanetB", "Clawhammer and Old-Time"),
    (22446, "Chinese Breakdown", "Buxton", "Bluegrass (Scruggs)"),
    (22456, "Down Yonder", None, "Bluegrass (Scruggs)"),
    (23345, "Lonesome Fiddle Blues", "Yohansen", "Bluegrass (Scruggs)"),
    (23409, "Dixie Hoedown", "Yohansen", "Bluegrass (Scruggs)"),
    (24231, "I Don't Love Nobody", "corcoran", "Bluegrass (Scruggs)"),
    (24337, "Cheyenne", "corcoran", "Bluegrass (Scruggs)"),
    (25010, "Gold Rush", "banjoy", "Bluegrass (Scruggs)"),
]

# We are not a Banjo Hangout poster. Any code path that would credit a
# scraped tab to this repo's owner has lost the real author somewhere
# upstream and is about to launder that loss into the corpus.
REPO_OWNER_HANDLES = {'jollyhrothgar', 'mike beaumier'}


def seed_catalog(catalog: TabCatalog) -> int:
    """Add scraped entries the catalog is missing. Returns count added."""
    added = 0
    for num, title, author, style in SCRAPED:
        pid = f"{num}_tef"
        if catalog.get_tab(pid):
            continue
        if author is not None and author.strip().lower() in REPO_OWNER_HANDLES:
            raise ValueError(
                f"{pid} ({title!r}) would be credited to {author!r}, this "
                f"repo's owner. A scraped Banjo Hangout tab was posted by "
                f"someone else; crediting us erases them. Use the real "
                f"handle from {SITE.tab_page_url(str(num))}, or None."
            )
        catalog.add_tab(TabEntry(
            id=pid,
            title=title,
            author=author,
            format='tef',
            source_url=SITE.tab_page_url(str(num)),
            style=style,
            status='downloaded',
        ))
        added += 1
    return added


def main():
    dry_run = '--dry-run' in sys.argv

    manifest = json.loads(MANIFEST.read_text())
    verified = [e['pid'] for e in manifest if e['result']['verdict'] == 'VERIFIED']
    print(f"Oracle manifest: {len(verified)} VERIFIED pids")

    catalog = TabCatalog(CATALOG, source=SITE.source)
    added = seed_catalog(catalog)
    print(f"Seeded {added} scraped entries into the catalog")

    stats = {'imported': 0, 'skipped': 0, 'missing': 0}
    for pid in sorted(verified):
        tab = catalog.get_tab(pid)
        if tab is None:
            print(f"  MISSING from catalog: {pid}")
            stats['missing'] += 1
            continue
        if tab.status == 'imported' and tab.work_slug:
            print(f"  already imported: {pid} -> {tab.work_slug}")
            stats['skipped'] += 1
            continue
        if dry_run:
            print(f"  would import: {pid} ({tab.title} / {tab.author})")
            continue
        print(f"Importing {pid}: {tab.title} ({tab.author})")
        slug = import_tab(catalog, tab, SITE)
        if slug:
            catalog.update_status(pid, 'imported')
            catalog.set_work_slug(pid, slug)
            stats['imported'] += 1
        else:
            catalog.update_status(pid, 'skipped', 'import declined (duplicate part?)')
            stats['skipped'] += 1

    if not dry_run:
        catalog.save()
    print(f"\nDone: {stats}")


if __name__ == '__main__':
    main()
