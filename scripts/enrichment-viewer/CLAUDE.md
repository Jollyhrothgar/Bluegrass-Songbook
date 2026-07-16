# Enrichment Viewer

Web-based tool for reviewing enrichment changes before applying them. Shows side-by-side diffs of original vs enriched ChordPro files.

## Usage

```bash
uv run python scripts/enrichment-viewer/server.py
# Opens at http://localhost:8000
```

## Structure

```
enrichment-viewer/
├── index.html       # Frontend: split-pane diff viewer (dark theme)
├── server.py        # Python HTTP server with JSON API
└── feedback.jsonl   # Stored user feedback (good/problem ratings)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Total files, protected count, to-enrich count |
| `/api/random` | GET | Random song for preview |
| `/api/next` | GET | Next song |
| `/api/prev` | GET | Previous song |
| `/api/song/{index}` | GET | Specific song by index |
| `/api/feedback` | POST | Save feedback (good/problem rating) |

## Keyboard Shortcuts

- `←` / `→` - Navigate songs
- `r` - Random song
- `g` - Mark as good (auto-advances)
- `p` - Mark as problem (auto-advances)
