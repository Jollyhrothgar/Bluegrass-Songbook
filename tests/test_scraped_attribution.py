"""Scraped tabs must never be credited to this repo's owner.

Every tab under a Hangout `source` was posted to that site by somebody
else. Our handle appearing in `provenance.author` does not mean we tabbed
it — it means the real poster's name was lost somewhere upstream and the
gap got filled with whoever was running the import.

That is exactly what happened once: `import_verified.py` seeded 34 tabs
into `sources/banjo-hangout/tab_catalog.json` on 2026-07-08 with a
hardcoded `author` of "Jollyhrothgar", and `works_importer` copied it
into 28 `work.yaml` files. Twenty-eight real people (mwblake, JanetB,
janolov, corcoran, ...) went uncredited for a month. Repaired 2026-08-19
by reading each tab's detail page.

These tests are the tripwire for a repeat. If one fails, do NOT satisfy
it by swapping in another plausible-looking name: go read
`provenance.source_url`, take the real handle off the page, and if the
page will not give one up, drop the `author` key entirely. A missing
author is honest and recoverable. A wrong one is theft that reads as
data.
"""

import json
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parent.parent
WORKS = REPO_ROOT / 'works'

# Handles that identify this repo's owner. A scraped tab carrying one of
# these is always wrong, regardless of which Hangout site it came from.
REPO_OWNER_HANDLES = {'jollyhrothgar', 'mike beaumier'}

# Sources whose `author` is a third-party uploader on someone else's site.
# `user-submission` is deliberately absent: the owner really can submit a
# tab himself, and works/welcome-to-new-york is a legitimate example.
SCRAPED_SOURCES = {
    'banjo-hangout',
    'mandolin-hangout',
    'flatpicker-hangout',
    'fiddle-hangout',
    'reso-hangout',
}

CATALOGS = sorted(REPO_ROOT.glob('sources/*-hangout/tab_catalog.json'))


def _scraped_parts():
    """Yield (work_id, part_file, provenance) for every scraped part."""
    for work_yaml in sorted(WORKS.glob('*/work.yaml')):
        try:
            data = yaml.safe_load(work_yaml.read_text()) or {}
        except yaml.YAMLError:  # a malformed work is another test's problem
            continue
        for part in (data.get('parts') or []):
            prov = part.get('provenance') or {}
            if prov.get('source') in SCRAPED_SOURCES:
                yield data.get('id', work_yaml.parent.name), part.get('file'), prov


class TestWorksAttribution:
    def test_no_scraped_part_credits_the_repo_owner(self):
        bad = [(wid, pfile, prov.get('source'), prov.get('source_id'),
                prov.get('author'))
               for wid, pfile, prov in _scraped_parts()
               if (prov.get('author') or '').strip().lower() in REPO_OWNER_HANDLES]

        assert not bad, (
            f"{len(bad)} scraped tab part(s) credit this repo's owner as the "
            f"author. We did not post these tabs to the Hangout sites — "
            f"somebody else did, and this erases them.\n\n"
            + "\n".join(
                f"  works/{wid}/{pfile}  source={src} source_id={sid} "
                f"author={author!r}"
                for wid, pfile, src, sid, author in bad
            )
            + "\n\nFix: open the tab's provenance.source_url, read the "
              "'Posted by' handle, and use that. If the page is gone or "
              "shows no poster, DELETE the author key rather than guessing "
              "— source_url still leads a reader to the real credit."
        )

    def test_scraped_authors_are_not_placeholders(self):
        """Catch the generic stand-ins that hide a lost author."""
        placeholders = {'unknown', 'n/a', 'na', 'none', 'null', 'anonymous',
                        'admin', 'user', 'tbd', ''}
        bad = [(wid, pfile, prov.get('author'))
               for wid, pfile, prov in _scraped_parts()
               if 'author' in prov
               and (prov.get('author') or '').strip().lower() in placeholders]

        assert not bad, (
            f"{len(bad)} scraped part(s) carry a placeholder author. Omit the "
            f"author key entirely instead — an absent author is honest, a "
            f"placeholder pretends the field was checked.\n"
            + "\n".join(f"  works/{wid}/{pfile}  author={a!r}"
                        for wid, pfile, a in bad)
        )


class TestCatalogAttribution:
    """The catalogs feed works/, so a bad author there re-infects on import."""

    @pytest.mark.parametrize('catalog_path', CATALOGS,
                             ids=lambda p: p.parent.name)
    def test_no_catalog_entry_credits_the_repo_owner(self, catalog_path):
        tabs = (json.loads(catalog_path.read_text()) or {}).get('tabs') or {}
        bad = [(tab_id, entry.get('title'), entry.get('author'))
               for tab_id, entry in tabs.items()
               if (entry.get('author') or '').strip().lower()
               in REPO_OWNER_HANDLES]

        rel = catalog_path.relative_to(REPO_ROOT)
        assert not bad, (
            f"{len(bad)} entr(ies) in {rel} credit this repo's owner. This is "
            f"the upstream of works/ — every import copies author straight "
            f"through, so leaving it here re-creates the bug on the next "
            f"import run.\n"
            + "\n".join(f"  {tab_id}  {title!r}  author={author!r}"
                        for tab_id, title, author in bad)
            + "\n\nSee sources/banjo-hangout/src/import_verified.py for how "
              "this happened the first time."
        )


def test_seed_table_has_no_owner_attribution():
    """The literal table that caused the 2026-07-08 corruption."""
    src = (REPO_ROOT / 'sources' / 'banjo-hangout' / 'src'
           / 'import_verified.py').read_text()
    # Only inspect the data table, not the docstring explaining the bug.
    table = src.split('SCRAPED = [', 1)[1].split(']', 1)[0]
    hits = [line.strip() for line in table.splitlines()
            if any(h in line.lower() for h in REPO_OWNER_HANDLES)]

    assert not hits, (
        "import_verified.py's SCRAPED table credits this repo's owner as the "
        "poster of a Banjo Hangout tab. That table is seed data for "
        "tab_catalog.json; this is the exact defect that mis-credited 28 "
        "tabs on 2026-07-08. Use the real handle from the tab's detail page, "
        "or None.\n" + "\n".join(f"  {h}" for h in hits)
    )
