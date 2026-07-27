"""Import ORACLE-VERIFIED tabs into works/ (job #3: publish the corpus).

Policy (Mike): only tabs whose parse matches the TablEdit oracle at 100%
(verdict VERIFIED in spike/oracle_manifest.json) are published. PARTIALs
follow as verification widens.

34 of the 87 verified pids predate the catalog scrape (they entered via
the raw_tabs triage); their page metadata (title/author/style) was
scraped from the Banjo Hangout detail pages on 2026-07-05 and is seeded
into the catalog here so every published tab carries attribution.

Run from sources/banjo-hangout/:  python3 src/import_verified.py [--dry-run]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from catalog import TabCatalog, TabEntry
from works_importer import import_tab

HERE = Path(__file__).parent.parent          # sources/banjo-hangout
REPO = HERE.parent.parent                    # repo root
MANIFEST = REPO / 'spike' / 'oracle_manifest.json'
CATALOG = HERE / 'tab_catalog.json'

# Detail-page metadata for verified pids missing from the catalog
# (scraped 2026-07-05 from banjohangout.org detail pages).
SCRAPED = [
    (12121, "Banjo In the Hollow", "Jollyhrothgar", "4-String (Tenor/Plectrum)"),
    (12123, "Shuckin' the Corn", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (12127, "Lonesome Road Blues", "Jollyhrothgar", "4-String (Tenor/Plectrum)"),
    (12135, "Daley's Reel", "Jollyhrothgar", "Other"),
    (13648, "Ashokan Farewell", "Jollyhrothgar", "Classical"),
    (13654, "Ducks on Millpond", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (14406, "Seneca Square Dance", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (14683, "Hot Corn Cold Corn", "Jollyhrothgar", "4-String (Tenor/Plectrum)"),
    (15032, "Done Gone", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (15318, "Harvest Home", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (17003, "Shooting Creek", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (17492, "Down Yonder", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (18136, "The Irish Washerwoman", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (18998, "Monroe's Hornpipe", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (19600, "Paddy on the Turnpike", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (19852, "Little Rabbit", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (20545, "Dear Old Dixie", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (20911, "Marching Jaybird", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (20924, "Give the Fiddler a Dram", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (20981, "Sally Ann", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (21678, "Waterbound", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (21690, "Paddy on the Turnpike", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (21802, "Tennessee Mountain Fox Chase", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (21999, "Arkansas Hoosier", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (22191, "Lonesome Road Blues", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (22228, "Waterbound", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (22290, "Scotland", "Jollyhrothgar", "Clawhammer and Old-Time"),
    (22446, "Chinese Breakdown", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (22456, "Down Yonder", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (23345, "Lonesome Fiddle Blues", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (23409, "Dixie Hoedown", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (24231, "I Don't Love Nobody", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (24337, "Cheyenne", "Jollyhrothgar", "Bluegrass (Scruggs)"),
    (25010, "Gold Rush", "banjoy", "Bluegrass (Scruggs)"),
]


def seed_catalog(catalog: TabCatalog) -> int:
    """Add scraped entries the catalog is missing. Returns count added."""
    added = 0
    for num, title, author, style in SCRAPED:
        pid = f"{num}_tef"
        if catalog.get_tab(pid):
            continue
        catalog.add_tab(TabEntry(
            id=pid,
            title=title,
            author=author,
            format='tef',
            source_url=f"https://www.banjohangout.org/tab/browse.asp?m=detail&v={num}",
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

    catalog = TabCatalog(CATALOG)
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
        slug = import_tab(catalog, tab)
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
