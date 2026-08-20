# Parser Debug Viewer

Web-based tool for validating parser output by comparing HTML source to generated ChordPro.

## Quick Start

```bash
./sources/classic-country/scripts/server debug_viewer
# → http://localhost:8000
```

## What It Does

- **Side-by-side comparison**: Original HTML (left) vs generated ChordPro (right)
- **Live parsing**: Uses current `parser.py` code - refresh to see changes instantly
- **Feedback tracking**: Mark files as correct/minor/wrong with notes

## Files

```
viewer/
├── server.py       # stdlib http.server (SimpleHTTPRequestHandler) — NOT Flask;
│                   #   no web framework dependency, just bs4 + the parser
├── index.html      # Single-page validation UI
├── random.html     # Random-song review UI (served at /random)
├── README.md       # Same material, non-agent copy
└── feedback.jsonl  # Logged feedback (append-only)
```

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /` | Serve validation UI (also `/index.html`) |
| `GET /random` | Serve the random-song UI (also `/random.html`) |
| `GET /html/{file}` | Serve original HTML from `raw/{file}` |
| `GET /api/chordpro/{file}` | **Live parse** HTML → ChordPro |
| `POST /api/feedback` | Save validation feedback |

## Development Workflow

1. Make parser changes in `src/parser.py`
2. Refresh browser - output updates immediately (no rebuild)
3. Compare HTML vs ChordPro side-by-side
4. Mark files and add notes for tracking

## Validation Criteria

**Correct**: Verses separated, chords aligned, metadata extracted, repeats handled

**Minor**: Small verse boundary issues, metadata partially missing, ±1-2 char chord alignment

**Wrong**: Verses merged, chords missing/misaligned, repeats ignored

## Analyzing Feedback

```bash
# Count by status
grep -c '"status": "correct"' viewer/feedback.jsonl
grep -c '"status": "wrong"' viewer/feedback.jsonl

# View wrong files
grep '"status": "wrong"' viewer/feedback.jsonl | jq .
```
