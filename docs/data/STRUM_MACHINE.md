# Strum Machine Integration

Integration with [Strum Machine](https://strummachine.com) for practice backing tracks.

## How It Works

1. **Pre-computed matching**: Run `./scripts/utility strum-machine-match` to batch match all songs against Strum Machine's database
2. **Cache stored**: Results cached in `docs/data/strum_machine_cache.json`
3. **Build integration**: `build_index.py` reads cache and adds `strum_machine_url` to matched songs
4. **UI display**: Song view shows "Practice on Strum Machine" button for matched songs

## Commands

```bash
# Test a single song match
./scripts/utility strum-machine-test "Foggy Mountain Breakdown"

# Batch match all songs (takes ~30 min for 17k songs at 10 req/sec)
./scripts/utility strum-machine-match

# Rebuild index to pick up cached matches
./scripts/bootstrap --quick
```

## API Reference

### Match Songs (undocumented)
```
GET https://strummachine.com/api/v0/match-songs?q={title}
Authorization: Bearer {API_KEY}

Response:
{
  "query": "Big Sciota",
  "results": [
    {"title": "Big Sciota", "label": "C to Em version", "url": "...", "score": 1},
    {"title": "Big Sciota", "label": "Em to C version", "url": "...", "score": 1}
  ],
  "total": 2
}

Scores:
- 1 = exact match
- 0.9 = close match (typo, etc)
- 0 = no match
```

### URL Parameters
```
# Open song in specific key and tempo
https://strummachine.com/app/songs/{id}?key=G&bpm=200
```

### Songs API
```
GET    /songs              # List user's songs
POST   /songs              # Create song
GET    /songs/{id}         # Get song
PUT    /songs/{id}         # Update song
DELETE /songs/{id}         # Delete song
```

### Lists API
```
GET    /lists              # List user's lists
POST   /lists              # Create list
GET    /lists/{id}         # Get list with songs
PUT    /lists/{id}         # Update list name
DELETE /lists/{id}         # Delete list
POST   /lists/{id}/songs   # Add song to list
DELETE /lists/{id}/songs/{songId}  # Remove song from list
```

## Rate Limits

- 10 requests per second for match-songs endpoint
- Batch matching ~17k songs takes ~30 minutes

## Environment Setup

Set `STRUM_MACHINE_API_KEY` in `~/.env`:
```
STRUM_MACHINE_API_KEY=your_api_key_here
```

## Future Ideas

- Create Strum Machine list with all matched Bluegrass Songbook songs
- Sync user's Bluegrass Songbook lists to Strum Machine lists
- Deep link to specific song sections
