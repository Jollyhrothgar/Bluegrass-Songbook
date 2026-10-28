# Parser Debug Viewer

Side-by-side page for checking parser output: original HTML on the left, the
live-parsed ChordPro on the right. Started by
`./sources/classic-country/scripts/server debug_viewer` (http://localhost:8000).

- `server.py` is a stdlib `http.server`, not Flask. It imports `src/parser.py` on
  each request, so a parser edit shows after a browser refresh.
- Routes: `/` (validation UI), `/random` (random-song review), `/html/{file}`
  (from `raw/`), `/api/chordpro/{file}` (live parse), `POST /api/feedback`.
- Feedback is appended to `viewer/feedback.jsonl` as `correct`, `minor` or
  `wrong` plus a note (124 entries).
  `grep '"status": "wrong"' sources/classic-country/viewer/feedback.jsonl | jq .`
  lists the failures.

The viewer only matters if the parser is reopened; the parser is frozen.
