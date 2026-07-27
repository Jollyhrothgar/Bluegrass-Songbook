"""Cross-site tab index and relevance scoring.

Merges the per-site tab catalogs (built by `batch_import.py scan --site X`)
into one index keyed by normalized tune title, then scores each tune for
import priority. This is the planning layer between "scan" (metadata only)
and "download": the ranked output decides what's worth fetching.

Score components, per tune cluster:
  - canonical tune-list tier (tiers 1-20; the strongest signal we have)
  - cross-site presence (a tune tabbed on 3 sites is community-vetted)
  - matches an existing work (fills a gap on a live song page)
  - per-instrument gap value (the matched work lacks a tab for that
    site's instrument — the whole point of the campaign)
  - genre fit (Bluegrass/Old-Time/Gospel/Folk over Rock covers)

None of the Hangout sites exposes download counts or ratings, so
"canonical version" selection within a tune stays editorial; this module
only ranks *tunes*, and lists every candidate arrangement for each.

Usage:
    uv run python sources/banjo-hangout/src/cross_site_index.py
    uv run python sources/banjo-hangout/src/cross_site_index.py --top 50
    uv run python sources/banjo-hangout/src/cross_site_index.py \
        --csv cross_site_ranked.csv --json cross_site_index.json
"""

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import yaml

from site_config import SITES, get_site, strip_title_decorations
from priority_list import get_tune_list_priorities

REPO_ROOT = Path(__file__).parent.parent.parent.parent
WORKS_DIR = REPO_ROOT / 'works'

PREFERRED_GENRES = {'bluegrass', 'old-time', 'old time', 'oldtime', 'gospel',
                    'folk', 'celtic/irish', 'celtic', 'irish', 'fiddle/celtic/irish',
                    'traditional'}
OFF_GENRES = {'rock', 'jazz/blues', 'pop', 'metal'}


def norm_key(text: str) -> str:
    """Site-independent clustering key for a tune title."""
    if not text:
        return ''
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii').lower()
    text = re.sub(r"[^\w\s]", '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return re.sub(r'^(the|an?)\s+', '', text)


def entry_keys(title: str, site) -> list[str]:
    """Candidate cluster keys for a catalog entry, most-specific first.

    Hangout titles often carry a trailing artist ("Baby Elephant Walk -
    Henry Mancini"), so the segment before the first " - " is offered as
    a fallback key.
    """
    cleaned = strip_title_decorations(title, site.instrument_words)
    keys = [norm_key(cleaned)]
    if ' - ' in cleaned:
        base = norm_key(cleaned.split(' - ')[0])
        if base and base not in keys:
            keys.append(base)
    return [k for k in keys if k]


def load_catalogs() -> dict[str, list[dict]]:
    """site name -> raw TEF catalog entries (skips sites with no catalog)."""
    catalogs = {}
    for name, site in SITES.items():
        if not site.catalog_path.exists():
            continue
        data = json.loads(site.catalog_path.read_text())
        entries = [t for t in data.get('tabs', {}).values()
                   if t.get('format') == 'tef']
        catalogs[name] = entries
    return catalogs


def load_work_coverage() -> dict[str, dict]:
    """normalized title -> {'id': slug, 'instruments': set of tab instruments}.

    First work to claim a title wins (same tolerance as works_importer).
    """
    coverage = {}
    for work_dir in sorted(WORKS_DIR.iterdir()):
        yaml_path = work_dir / 'work.yaml'
        if not yaml_path.exists():
            continue
        try:
            work = yaml.safe_load(yaml_path.read_text())
        except yaml.YAMLError:
            continue
        if not work:
            continue
        key = norm_key(work.get('title', ''))
        if not key or key in coverage:
            continue
        instruments = {p.get('instrument') for p in (work.get('parts') or [])
                       if p.get('type') == 'tablature' and p.get('instrument')}
        coverage[key] = {'id': work.get('id', work_dir.name),
                         'instruments': instruments}
    return coverage


def load_tune_tiers() -> dict[str, int]:
    """normalized tune title -> tier (1 = most essential)."""
    tiers = {}
    for title, tier in get_tune_list_priorities().items():
        key = norm_key(title)
        if key and (key not in tiers or tier < tiers[key]):
            tiers[key] = tier
    return tiers


def build_clusters(catalogs: dict[str, list[dict]],
                   tiers: dict[str, int],
                   coverage: dict[str, dict]) -> list[dict]:
    """Merge per-site entries into scored tune clusters."""
    clusters: dict[str, dict] = defaultdict(
        lambda: {'sites': defaultdict(list), 'titles': set()})

    for site_name, entries in catalogs.items():
        site = get_site(site_name)
        for entry in entries:
            keys = entry_keys(entry.get('title', ''), site)
            if not keys:
                continue
            # Prefer a key that hits the tune list or an existing work;
            # otherwise cluster under the full cleaned title.
            key = next((k for k in keys if k in tiers or k in coverage),
                       keys[0])
            clusters[key]['sites'][site_name].append(entry)
            clusters[key]['titles'].add(entry.get('title', ''))

    scored = []
    for key, cluster in clusters.items():
        site_names = sorted(cluster['sites'])
        tier = tiers.get(key)
        work = coverage.get(key)

        score = 0.0
        if tier is not None and tier <= 20:
            score += (21 - tier) * 4
        score += 3 * len(site_names)              # cross-site agreement
        if work:
            score += 8                            # lands on a live song page
            for site_name in site_names:
                needed = get_site(site_name).fallback_instrument
                if needed not in work['instruments']:
                    score += 5                    # fills an instrument gap
        elif tier is not None:
            score += 4                            # canonical tune, no work yet

        genres = {(e.get('genre') or '').lower()
                  for entries in cluster['sites'].values()
                  for e in entries}
        if genres & PREFERRED_GENRES:
            score += 3
        elif genres and genres <= OFF_GENRES:
            score -= 6                            # rock covers, not repertoire

        scored.append({
            'key': key,
            'display_title': sorted(cluster['titles'])[0],
            'tier': tier,
            'work_id': work['id'] if work else None,
            'work_instruments': sorted(work['instruments']) if work else [],
            'sites': {s: [e['id'] for e in cluster['sites'][s]]
                      for s in site_names},
            'tab_count': sum(len(v) for v in cluster['sites'].values()),
            'genres': sorted(g for g in genres if g),
            'score': round(score, 1),
        })

    scored.sort(key=lambda c: (-c['score'], c['key']))
    return scored


def main() -> int:
    parser = argparse.ArgumentParser(description='Cross-site tab index + ranking')
    parser.add_argument('--top', type=int, default=40,
                        help='How many tunes to print (default 40)')
    parser.add_argument('--csv', type=Path, default=None)
    parser.add_argument('--json', type=Path, default=None)
    args = parser.parse_args()

    catalogs = load_catalogs()
    if not catalogs:
        print('No tab catalogs found — run batch_import.py scan first.',
              file=sys.stderr)
        return 1

    clusters = build_clusters(catalogs, load_tune_tiers(), load_work_coverage())

    total_tabs = sum(len(v) for v in catalogs.values())
    print(f"Cross-site index: {total_tabs} TEF tabs across "
          f"{len(catalogs)} sites -> {len(clusters)} tune clusters\n")
    for name in sorted(catalogs):
        print(f"  {name:<20} {len(catalogs[name]):>5} TEF tabs")

    print(f"\nTop {args.top} by relevance:")
    print(f"{'score':>6}  {'tier':>4}  {'sites':>5}  {'tabs':>4}  "
          f"{'work':<28} title")
    for c in clusters[:args.top]:
        print(f"{c['score']:>6}  {str(c['tier'] or '-'):>4}  "
              f"{len(c['sites']):>5}  {c['tab_count']:>4}  "
              f"{(c['work_id'] or '-'):<28} {c['display_title']}")

    if args.csv:
        with open(args.csv, 'w', newline='', encoding='utf-8') as fh:
            writer = csv.writer(fh)
            writer.writerow(['score', 'tier', 'title', 'work_id', 'sites',
                             'tab_count', 'genres', 'tab_ids'])
            for c in clusters:
                writer.writerow([
                    c['score'], c['tier'] or '', c['display_title'],
                    c['work_id'] or '', ';'.join(c['sites']),
                    c['tab_count'], ';'.join(c['genres']),
                    ';'.join(f"{s}:{i}" for s, ids in c['sites'].items()
                             for i in ids),
                ])
        print(f"\nWrote {len(clusters)} clusters to {args.csv}")

    if args.json:
        args.json.write_text(json.dumps(clusters, indent=1))
        print(f"Wrote {args.json}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
