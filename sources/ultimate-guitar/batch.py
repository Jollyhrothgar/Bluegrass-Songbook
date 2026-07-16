"""
Batch processor for Ultimate Guitar chord extraction.

Extracts chords from UG and merges with BluegrassLyrics songs.
Includes rate limiting and request pattern masking to avoid detection.

Usage:
    # Process 10 songs (default)
    uv run python sources/ultimate-guitar/batch.py

    # Process specific number
    uv run python sources/ultimate-guitar/batch.py --limit 50

    # Resume from last position
    uv run python sources/ultimate-guitar/batch.py --resume

    # Dry run (no requests, just show what would be processed)
    uv run python sources/ultimate-guitar/batch.py --dry-run
"""

import json
import time
import random
import asyncio
import argparse
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, asdict

# Conditional imports for MCP (not needed for dry-run)
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    ClientSession = None

from merge import merge_song, MergeResult
from extractor import SEARCH_RESULTS_JS, EXTRACT_CONTENT_JS, select_best_result


# Directories
BASE_DIR = Path(__file__).parent
BL_PARSED_DIR = BASE_DIR.parent / 'bluegrass-lyrics' / 'parsed'
RESULTS_DIR = BASE_DIR / 'results'
PROGRESS_FILE = BASE_DIR / 'batch_progress.json'


@dataclass
class BatchProgress:
    """Track batch processing progress."""
    started_at: str
    last_processed_at: str | None
    total_songs: int
    processed: int
    succeeded: int
    failed: int
    skipped: int  # Already processed or no UG match
    last_slug: str | None
    errors: list[dict]

    def to_dict(self):
        return asdict(self)

    @classmethod
    def load(cls) -> 'BatchProgress':
        if PROGRESS_FILE.exists():
            with open(PROGRESS_FILE) as f:
                data = json.load(f)
                return cls(**data)
        return cls(
            started_at=datetime.now().isoformat(),
            last_processed_at=None,
            total_songs=0,
            processed=0,
            succeeded=0,
            failed=0,
            skipped=0,
            last_slug=None,
            errors=[],
        )

    def save(self):
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)


def human_delay(min_seconds: float = 2.0, max_seconds: float = 5.0):
    """
    Sleep for a human-like random duration.
    Uses a slightly weighted distribution favoring middle values.
    """
    # Triangular distribution - more likely to be in the middle
    delay = random.triangular(min_seconds, max_seconds, (min_seconds + max_seconds) / 2)
    time.sleep(delay)
    return delay


def batch_pause():
    """
    Longer pause between batches of requests.
    Called every N songs to simulate taking a break.
    """
    pause = random.uniform(30, 60)  # 30-60 second break
    print(f"  [Batch pause: {pause:.0f}s]")
    time.sleep(pause)


def get_songs_to_process(resume_from: str | None = None) -> list[Path]:
    """
    Get list of BL songs that need chord processing.
    Excludes songs we've already processed.
    """
    # Get all BL parsed songs
    all_songs = sorted(BL_PARSED_DIR.glob('*.json'))

    # Get already processed
    processed = set()
    if RESULTS_DIR.exists():
        for f in RESULTS_DIR.glob('*.json'):
            processed.add(f.stem)

    # Filter
    songs = [s for s in all_songs if s.stem not in processed]

    # Resume from specific slug if requested
    if resume_from:
        try:
            idx = next(i for i, s in enumerate(songs) if s.stem == resume_from)
            songs = songs[idx:]
        except StopIteration:
            pass  # Start from beginning if not found

    return songs


async def process_song(session: ClientSession, bl_path: Path, progress: BatchProgress) -> MergeResult | None:
    """
    Search UG for a song, extract chords, and merge with BL lyrics.
    Returns MergeResult on success, None on failure.
    """
    from urllib.parse import quote

    slug = bl_path.stem

    # Load BL data to get title
    with open(bl_path) as f:
        bl_data = json.load(f)
    title = bl_data.get('title', slug.replace('-', ' ').title())

    print(f"  Searching: {title}")

    # Search UG
    search_url = f"https://www.ultimate-guitar.com/search.php?title={quote(title)}&type=300"

    try:
        await session.call_tool("navigate_page", {"type": "url", "url": search_url})
        human_delay(1.5, 3.0)  # Wait for page load

        # Get search results
        result = await session.call_tool("evaluate_script", {"function": SEARCH_RESULTS_JS})
        results_text = result.content[0].text if result.content else "[]"
        results = json.loads(results_text)

        if not results:
            print(f"    No UG results found")
            return None

        # Select best result
        best = select_best_result(results, title)
        if not best:
            print(f"    No suitable result")
            return None

        print(f"    Found: {best['title']} by {best['artist']}")

        # Navigate to chord page
        human_delay(2.0, 4.0)  # Delay before next navigation
        await session.call_tool("navigate_page", {"type": "url", "url": best["url"]})
        human_delay(1.5, 3.0)

        # Extract content
        result = await session.call_tool("evaluate_script", {"function": EXTRACT_CONTENT_JS})
        data_text = result.content[0].text if result.content else "{}"
        data = json.loads(data_text)

        if "error" in data:
            print(f"    Extraction error: {data['error']}")
            return None

        ug_content = data.get("content", "")
        if not ug_content.strip():
            print(f"    Empty content extracted")
            return None

        # Merge with BL
        merge_result = merge_song(str(bl_path), ug_content, best["url"])

        print(f"    Coverage: {merge_result.coverage:.0%} ({merge_result.matched_lines}/{merge_result.total_lines})")

        return merge_result

    except Exception as e:
        print(f"    Error: {e}")
        progress.errors.append({
            'slug': slug,
            'error': str(e),
            'time': datetime.now().isoformat(),
        })
        return None


async def run_batch(limit: int = 10, resume: bool = False, dry_run: bool = False):
    """
    Process a batch of songs.
    """
    # Load progress
    progress = BatchProgress.load() if resume else BatchProgress(
        started_at=datetime.now().isoformat(),
        last_processed_at=None,
        total_songs=0,
        processed=0,
        succeeded=0,
        failed=0,
        skipped=0,
        last_slug=None,
        errors=[],
    )

    # Get songs to process
    resume_from = progress.last_slug if resume else None
    songs = get_songs_to_process(resume_from)
    songs = songs[:limit]

    progress.total_songs = len(songs)
    print(f"Processing {len(songs)} songs")

    if dry_run:
        print("\nDry run - would process:")
        for s in songs[:20]:
            print(f"  - {s.stem}")
        if len(songs) > 20:
            print(f"  ... and {len(songs) - 20} more")
        return

    if not MCP_AVAILABLE:
        print("Error: mcp package not installed. Run: uv pip install mcp")
        return

    # Ensure output directory exists
    RESULTS_DIR.mkdir(exist_ok=True)

    # Connect to Chrome DevTools MCP
    server_params = StdioServerParameters(
        command="npx",
        args=["-y", "chrome-devtools-mcp@latest", "--browserUrl", "http://127.0.0.1:9222"],
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            batch_count = 0
            for i, bl_path in enumerate(songs):
                slug = bl_path.stem
                print(f"\n[{i+1}/{len(songs)}] {slug}")

                # Process
                result = await process_song(session, bl_path, progress)

                if result:
                    # Save result
                    output_file = RESULTS_DIR / f"{slug}.json"
                    with open(output_file, 'w') as f:
                        json.dump(result.to_dict(), f, indent=2)
                    progress.succeeded += 1
                else:
                    progress.failed += 1

                progress.processed += 1
                progress.last_slug = slug
                progress.last_processed_at = datetime.now().isoformat()
                progress.save()

                # Rate limiting
                batch_count += 1
                if batch_count >= 10:
                    batch_pause()
                    batch_count = 0
                elif i < len(songs) - 1:
                    delay = human_delay(3.0, 7.0)
                    print(f"  [Delay: {delay:.1f}s]")

    # Final summary
    print(f"\n=== BATCH COMPLETE ===")
    print(f"Processed: {progress.processed}")
    print(f"Succeeded: {progress.succeeded}")
    print(f"Failed: {progress.failed}")
    print(f"Success rate: {progress.succeeded / max(progress.processed, 1):.0%}")


def main():
    parser = argparse.ArgumentParser(description='Batch process UG chord extraction')
    parser.add_argument('--limit', type=int, default=10, help='Max songs to process')
    parser.add_argument('--resume', action='store_true', help='Resume from last position')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be processed')
    args = parser.parse_args()

    asyncio.run(run_batch(limit=args.limit, resume=args.resume, dry_run=args.dry_run))


if __name__ == '__main__':
    main()
