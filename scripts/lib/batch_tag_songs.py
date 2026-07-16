#!/usr/bin/env python3
"""
Batch tag all songs using Claude's Message Batches API with structured outputs.

Uses Pydantic to enforce valid tag names and JSON schema.

Usage:
    export ANTHROPIC_API_KEY=your_key_here
    uv run python scripts/lib/batch_tag_songs.py              # Submit new batch
    uv run python scripts/lib/batch_tag_songs.py --dry-run    # Preview without submitting
    uv run python scripts/lib/batch_tag_songs.py --status ID  # Check batch status
    uv run python scripts/lib/batch_tag_songs.py --poll ID    # Poll until complete
    uv run python scripts/lib/batch_tag_songs.py --results ID # Fetch results
"""

import argparse
import json
import os
import sys
import time
from enum import Enum
from pathlib import Path
from typing import Optional


def load_env_file():
    """Load environment variables from ~/.env if it exists."""
    env_file = Path.home() / '.env'
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:  # Don't override existing
                        os.environ[key] = value


# Load ~/.env early
load_env_file()

try:
    import anthropic
except ImportError:
    print("Error: anthropic package not installed. Run: uv pip install anthropic")
    sys.exit(1)

try:
    from pydantic import BaseModel
except ImportError:
    print("Error: pydantic package not installed. Run: uv pip install pydantic")
    sys.exit(1)

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
INDEX_FILE = PROJECT_ROOT / 'docs' / 'data' / 'index.jsonl'
OUTPUT_FILE = PROJECT_ROOT / 'docs' / 'data' / 'llm_tags.json'
BATCH_STATE_FILE = PROJECT_ROOT / 'docs' / 'data' / 'batch_state.json'


# =============================================================================
# Tag Schema - must match scripts/lib/tag_enrichment.py
# =============================================================================

class Tag(str, Enum):
    """Valid tags for the Bluegrass Songbook."""
    # Primary Genres
    Bluegrass = "Bluegrass"
    BluegrassStandard = "BluegrassStandard"
    OldTime = "OldTime"
    Gospel = "Gospel"
    Folk = "Folk"
    ClassicCountry = "ClassicCountry"

    # ClassicCountry Sub-Genres
    HonkyTonk = "HonkyTonk"
    Outlaw = "Outlaw"
    NashvilleSound = "NashvilleSound"
    WesternSwing = "WesternSwing"
    Bakersfield = "Bakersfield"

    # Other Genres
    Rockabilly = "Rockabilly"
    Pop = "Pop"
    Jazz = "Jazz"
    Rock = "Rock"  # Rock, alternative, punk, indie - for covers

    # Vibe/Structure Tags
    Instrumental = "Instrumental"
    Waltz = "Waltz"


class SongTags(BaseModel):
    """Tags for a single song."""
    song_id: str
    tags: list[Tag]


class BatchTagResponse(BaseModel):
    """Response containing tags for multiple songs."""
    songs: list[SongTags]


# Tool definition for structured output
TAG_TOOL = {
    "name": "submit_song_tags",
    "description": "Submit genre tags for the batch of songs",
    "input_schema": {
        "type": "object",
        "properties": {
            "songs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "song_id": {"type": "string"},
                        "tags": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": [t.value for t in Tag]
                            }
                        }
                    },
                    "required": ["song_id", "tags"]
                }
            }
        },
        "required": ["songs"]
    }
}


# =============================================================================
# System Prompt
# =============================================================================

SYSTEM_PROMPT = """You are a music genre classifier for a bluegrass-focused songbook. Your role is to
choose 1-3 tags (preferring fewer, more accurate tags) for each song from the allowed list.

## ALLOWED TAGS

### Primary Genres
- **Bluegrass**: Bill Monroe tradition, high lonesome, acoustic string band - first generation
  bluegrass music and traditional music commonly played by first generation bluegrass musicians.
- **BluegrassStandard**: Core jam repertoire - "Blue Moon of Kentucky", "Rocky Top", "Foggy Mountain
  Breakdown", "Old Home Place", "Nine Pound Hammer" - any song that is well established as a covered
  or jammed song in bluegrass circles.
- **OldTime**: Pre-bluegrass Appalachian tradition, clawhammer banjo, Irish/Celtic fiddle tunes.
- **Gospel**: Religious/spiritual songs mentioning God, Jesus, heaven, salvation.
- **Folk**: Singer-songwriter, protest songs, ballads (Dylan, Guthrie, Denver) - more common in the
  1960s (though bluegrass continues through all musical eras).
- **ClassicCountry**: Nashville country 1940s-1990s

### ClassicCountry Sub-Genres (ALSO add ClassicCountry when using these)
- **HonkyTonk**: Jukebox country, drinking songs - Hank Williams, Lefty Frizzell, Ernest Tubb
- **Outlaw**: 1970s rebellious - Willie Nelson, Waylon Jennings, Kris Kristofferson
- **NashvilleSound**: Polished production, strings - Patsy Cline, Jim Reeves, Eddy Arnold
- **WesternSwing**: Bob Wills, Texas swing, jazz-influenced
- **Bakersfield**: West Coast twang - Buck Owens, Merle Haggard, Dwight Yoakam

### Other Genres
- **Rockabilly**: 1950s rock-country - Elvis, Carl Perkins, Jerry Lee Lewis, Buddy Holly
- **Rock**: Rock, alternative, punk, indie, metal - Radiohead, Green Day, Beatles, Eagles
- **Pop**: Mainstream pop, Christmas songs, easy listening
- **Jazz**: Jazz standards, swing

### Structure Tags
- **Instrumental**: No vocals (fiddle tunes, breakdowns, rags)
- **Waltz**: 3/4 time signature

## RULES
1. BluegrassStandard = commonly played at jams, not just "by a bluegrass artist"
2. Sub-genres (HonkyTonk, Outlaw, etc.) → ALSO include ClassicCountry
3. OldTime = Appalachian/Irish fiddle tradition ONLY, not polkas/Cajun
4. Christmas songs → Pop
5. Rock/alternative/punk (Radiohead, Green Day, Beatles, Eagles) → Rock
6. Fiddle tunes with Traditional/Unknown artist → likely OldTime + Instrumental
7. If truly unknown → empty []

Use the submit_song_tags tool to return your classifications."""


def load_songs():
    """Load all songs from index.jsonl."""
    songs = []
    with open(INDEX_FILE) as f:
        for line in f:
            if line.strip():
                song = json.loads(line)
                songs.append({
                    'id': song['id'],
                    'title': song.get('title', ''),
                    'artist': song.get('artist', ''),
                    'first_line': song.get('first_line', '')
                })
    return songs


def create_batch_requests(songs, batch_size=50):
    """Create batch requests with tool use for structured output."""
    requests = []

    for i in range(0, len(songs), batch_size):
        batch = songs[i:i + batch_size]
        batch_id = f"batch_{i//batch_size:04d}"

        # Format songs for the prompt
        def format_song(s):
            line = f"- {s['id']}: \"{s['title']}\" by {s['artist'] or 'Traditional/Unknown'}"
            if s.get('first_line'):
                first_line = s['first_line'][:50]
                line += f" — \"{first_line}...\""
            return line

        songs_text = "\n".join([format_song(s) for s in batch])

        request = {
            "custom_id": batch_id,
            "params": {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4096,
                "system": SYSTEM_PROMPT,
                "tools": [TAG_TOOL],
                "tool_choice": {"type": "tool", "name": "submit_song_tags"},
                "messages": [{
                    "role": "user",
                    "content": f"Tag these {len(batch)} songs:\n\n{songs_text}"
                }]
            }
        }
        requests.append(request)

    return requests


def submit_batch(client, requests):
    """Submit a batch to the API."""
    print(f"Submitting batch with {len(requests)} requests...")

    message_batch = client.messages.batches.create(requests=requests)

    print(f"Batch created: {message_batch.id}")
    print(f"Status: {message_batch.processing_status}")
    print(f"Requests: {message_batch.request_counts}")

    state = {
        'batch_id': message_batch.id,
        'created_at': str(message_batch.created_at),
        'total_requests': len(requests),
        'status': message_batch.processing_status
    }
    with open(BATCH_STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

    return message_batch


def check_status(client, batch_id):
    """Check the status of a batch."""
    batch = client.messages.batches.retrieve(batch_id)

    print(f"Batch: {batch.id}")
    print(f"Status: {batch.processing_status}")
    print(f"Request counts: {batch.request_counts}")

    if batch.processing_status == "ended":
        print(f"Results URL: {batch.results_url}")

    return batch


def fetch_results(client, batch_id):
    """Fetch and process results from a completed batch."""
    batch = client.messages.batches.retrieve(batch_id)

    if batch.processing_status != "ended":
        print(f"Batch not complete. Status: {batch.processing_status}")
        return None

    print(f"Fetching results for {batch_id}...")

    all_tags = {}
    errors = []
    valid_tags = {t.value for t in Tag}

    for result in client.messages.batches.results(batch_id):
        custom_id = result.custom_id

        if result.result.type == "succeeded":
            message = result.result.message

            # Extract tool use response
            for block in message.content:
                if hasattr(block, 'type') and block.type == 'tool_use':
                    if block.name == 'submit_song_tags':
                        songs_data = block.input.get('songs', [])
                        for song in songs_data:
                            song_id = song.get('song_id')
                            tags = song.get('tags', [])
                            # Validate tags
                            valid = [t for t in tags if t in valid_tags]
                            if song_id:
                                all_tags[song_id] = valid
                        print(f"  {custom_id}: {len(songs_data)} songs tagged")

        elif result.result.type == "errored":
            errors.append(f"{custom_id}: {result.result.error}")
            print(f"  {custom_id}: Error")

        elif result.result.type == "expired":
            errors.append(f"{custom_id}: Expired")
            print(f"  {custom_id}: Expired")

    # Load existing and merge
    existing_tags = {}
    if OUTPUT_FILE.exists():
        with open(OUTPUT_FILE) as f:
            existing_tags = json.load(f)

    existing_tags.update(all_tags)

    with open(OUTPUT_FILE, 'w') as f:
        json.dump(existing_tags, f, indent=2, sort_keys=True)

    print(f"\nResults saved to {OUTPUT_FILE}")
    print(f"Total songs tagged: {len(existing_tags)}")

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for err in errors[:10]:
            print(f"  - {err}")

    return all_tags


def poll_until_complete(client, batch_id, poll_interval=60):
    """Poll until batch completes."""
    print(f"Polling for completion (every {poll_interval}s)...")

    while True:
        batch = client.messages.batches.retrieve(batch_id)
        counts = batch.request_counts

        print(f"  {batch.processing_status} | "
              f"Processing: {counts.processing} | "
              f"Succeeded: {counts.succeeded} | "
              f"Errored: {counts.errored}")

        if batch.processing_status == "ended":
            print("\nBatch complete!")
            return batch

        time.sleep(poll_interval)


def main():
    parser = argparse.ArgumentParser(description="Batch tag songs using Claude API")
    parser.add_argument('--status', metavar='BATCH_ID', help='Check status of a batch')
    parser.add_argument('--results', metavar='BATCH_ID', help='Fetch results from completed batch')
    parser.add_argument('--poll', metavar='BATCH_ID', help='Poll until complete, then fetch')
    parser.add_argument('--dry-run', action='store_true', help='Preview without submitting')
    parser.add_argument('--batch-size', type=int, default=50,
                        help='Songs per request (default: 50)')
    args = parser.parse_args()

    # Check for API key (not needed for dry-run)
    if not args.dry_run and not os.environ.get('ANTHROPIC_API_KEY'):
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        sys.exit(1)

    client = None if args.dry_run else anthropic.Anthropic()

    if args.status:
        check_status(client, args.status)
        return

    if args.results:
        fetch_results(client, args.results)
        return

    if args.poll:
        poll_until_complete(client, args.poll)
        fetch_results(client, args.poll)
        return

    # Load songs
    print("Loading songs...")
    songs = load_songs()
    print(f"Found {len(songs)} songs")

    # Skip already-tagged songs
    existing_tags = {}
    if OUTPUT_FILE.exists():
        with open(OUTPUT_FILE) as f:
            existing_tags = json.load(f)
        print(f"Already tagged: {len(existing_tags)} songs")

    songs_to_tag = [s for s in songs if s['id'] not in existing_tags]
    print(f"Songs to tag: {len(songs_to_tag)}")

    if not songs_to_tag:
        print("All songs already tagged!")
        return

    # Create requests
    requests = create_batch_requests(songs_to_tag, batch_size=args.batch_size)
    print(f"Created {len(requests)} batch requests ({args.batch_size} songs each)")

    # Cost estimate
    # With tool use: ~1200 tokens system + 30 tokens/song input, ~15 tokens/song output
    num_requests = len(requests)
    input_tokens = (num_requests * 1200) + (len(songs_to_tag) * 35)
    output_tokens = len(songs_to_tag) * 18
    input_cost = (input_tokens / 1_000_000) * 1.50  # Sonnet batch
    output_cost = (output_tokens / 1_000_000) * 7.50
    total_cost = input_cost + output_cost

    print(f"\nEstimated cost: ${total_cost:.2f}")
    print(f"  Input:  {input_tokens:,} tokens @ $1.50/MTok = ${input_cost:.2f}")
    print(f"  Output: {output_tokens:,} tokens @ $7.50/MTok = ${output_cost:.2f}")

    if args.dry_run:
        print("\n=== DRY RUN ===")
        print(f"Would submit {len(requests)} requests covering {len(songs_to_tag)} songs")
        print(f"\nFirst request preview:")
        print(json.dumps(requests[0], indent=2)[:1500] + "...")
        print(f"\nValid tags: {[t.value for t in Tag]}")
        return

    response = input("\nSubmit batch? [y/N] ")
    if response.lower() != 'y':
        print("Cancelled")
        return

    batch = submit_batch(client, requests)
    print(f"\nBatch submitted! ID: {batch.id}")
    print(f"To poll: uv run python {__file__} --poll {batch.id}")


if __name__ == '__main__':
    main()
