# Manual Source

Hand-created ChordPro songs added directly by contributors (not parsed from external sources).

## Structure

```
manual/
├── parsed/           # .pro files in standard ChordPro format
│                     #   (24 as of 2026-08-19; `ls sources/manual/parsed | wc -l`)
└── protected.txt     # Filenames excluded from automated enrichment
```

## Adding a Song

Use the CLI tool:

```bash
./scripts/utility add-song ~/path/to/song.pro
```

## Provenance

All manual songs include:
- `{meta: x_source manual}`
- `{meta: x_submitted_by github:<username>}`
- `{meta: x_submitted <date>}`
- `{meta: x_submission_issue <number>}` (GitHub issue reference)
