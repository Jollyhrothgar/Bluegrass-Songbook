"""Priority list for Banjo Hangout tab scanning.

Prioritizes tabs that match:
1. Curated instrumental tune list (from tunearch)
2. Existing works without tablature
3. Golden standard bluegrass songs
"""

import re
import unicodedata
from pathlib import Path
from typing import Optional

import yaml


# Paths
REPO_ROOT = Path(__file__).parent.parent.parent.parent
WORKS_DIR = REPO_ROOT / 'works'
TUNEARCH_LIST = REPO_ROOT / 'sources' / 'tunearch' / 'src' / 'tune_list.py'


def normalize_title(title: str) -> str:
    """Normalize title for matching."""
    # Normalize unicode
    title = unicodedata.normalize('NFKD', title)
    title = title.encode('ascii', 'ignore').decode('ascii')

    # Remove common suffixes and parentheticals
    title = re.sub(r'\s*\([^)]*\)\s*$', '', title)
    title = re.sub(r'\s*-\s*(tab|banjo|break|solo|arr\.?).*$', '', title, flags=re.I)
    title = re.sub(r'\s*banjo\s*(tab|break|solo)?$', '', title, flags=re.I)

    # Normalize case and whitespace
    title = ' '.join(title.lower().split())

    return title


def get_tune_list_priorities() -> dict[str, int]:
    """Get priority scores from tunearch tune list.

    Returns dict of normalized title -> priority (1=highest, 20=lowest)
    """
    priorities = {}

    # Parse tune_list.py to extract tunes with their tiers
    if not TUNEARCH_LIST.exists():
        return priorities

    content = TUNEARCH_LIST.read_text()

    # Find TUNE_LIST definition
    in_list = False
    current_tier = 0

    for line in content.split('\n'):
        if 'TUNE_LIST = [' in line:
            in_list = True
            continue
        if not in_list:
            continue
        if line.strip() == ']':
            break

        # Check for tier comment
        tier_match = re.search(r'TIER (\d+)', line)
        if tier_match:
            current_tier = int(tier_match.group(1))
            continue

        # Extract tune name
        tune_match = re.search(r'"([^"]+)"', line)
        if tune_match:
            tune = tune_match.group(1)
            normalized = normalize_title(tune)
            if normalized not in priorities:
                priorities[normalized] = current_tier or 10

    return priorities


def get_works_without_banjo_tab() -> set[str]:
    """Get normalized titles of works that don't have banjo tablature.

    Returns set of normalized titles.
    """
    titles = set()

    for work_dir in WORKS_DIR.iterdir():
        if not work_dir.is_dir():
            continue
        work_yaml = work_dir / 'work.yaml'
        if not work_yaml.exists():
            continue

        try:
            data = yaml.safe_load(work_yaml.read_text())

            # Check if already has banjo tab
            has_banjo_tab = False
            for part in data.get('parts', []):
                if (part.get('type') == 'tablature' and
                    part.get('instrument') == 'banjo'):
                    has_banjo_tab = True
                    break

            if not has_banjo_tab:
                title = data.get('title', '')
                if title:
                    titles.add(normalize_title(title))
        except Exception:
            continue

    return titles


def get_instrumental_works() -> set[str]:
    """Get normalized titles of works tagged as Instrumental.

    Returns set of normalized titles.
    """
    titles = set()

    for work_dir in WORKS_DIR.iterdir():
        if not work_dir.is_dir():
            continue
        work_yaml = work_dir / 'work.yaml'
        if not work_yaml.exists():
            continue

        try:
            data = yaml.safe_load(work_yaml.read_text())
            tags = data.get('tags', [])

            if 'Instrumental' in tags:
                title = data.get('title', '')
                if title:
                    titles.add(normalize_title(title))
        except Exception:
            continue

    return titles


def build_priority_list() -> list[tuple[str, int]]:
    """Build prioritized list of titles to scan for.

    Returns list of (normalized_title, priority) tuples, sorted by priority.
    Priority 1 = highest, higher numbers = lower priority.
    """
    results = {}

    # Priority 1-20: Tune list items (already tiered)
    tune_priorities = get_tune_list_priorities()
    for title, tier in tune_priorities.items():
        results[title] = tier

    # Priority 25: Other instrumental works we have
    instrumentals = get_instrumental_works()
    for title in instrumentals:
        if title not in results:
            results[title] = 25

    # Priority 30: Any work without banjo tab
    # (Lower priority - there are 17k+ of these)
    works_needing_tabs = get_works_without_banjo_tab()
    for title in works_needing_tabs:
        if title not in results:
            results[title] = 30

    # Sort by priority
    sorted_list = sorted(results.items(), key=lambda x: x[1])
    return sorted_list


def match_title(tab_title: str, priority_list: list[tuple[str, int]]) -> Optional[int]:
    """Check if a tab title matches any priority title.

    Returns the priority if matched, None otherwise.
    """
    normalized = normalize_title(tab_title)

    for priority_title, priority in priority_list:
        if normalized == priority_title:
            return priority
        # Also try without "the" prefix
        if normalized.replace('the ', '') == priority_title.replace('the ', ''):
            return priority

    return None


def print_priority_stats():
    """Print statistics about the priority list."""
    tune_list = get_tune_list_priorities()
    instrumentals = get_instrumental_works()
    needs_tabs = get_works_without_banjo_tab()

    print("Priority List Statistics")
    print("=" * 40)
    print(f"Tier 1-5 tunes (essential):  {sum(1 for t, p in tune_list.items() if p <= 5)}")
    print(f"Tier 6-10 tunes (common):    {sum(1 for t, p in tune_list.items() if 6 <= p <= 10)}")
    print(f"Tier 11+ tunes (expanded):   {sum(1 for t, p in tune_list.items() if p > 10)}")
    print(f"Total curated tunes:         {len(tune_list)}")
    print()
    print(f"Instrumental works:          {len(instrumentals)}")
    print(f"Works needing banjo tab:     {len(needs_tabs)}")
    print()

    # Show top priorities
    priority_list = build_priority_list()
    print("Top 20 priorities:")
    for title, priority in priority_list[:20]:
        print(f"  [{priority:2d}] {title}")


if __name__ == '__main__':
    print_priority_stats()
