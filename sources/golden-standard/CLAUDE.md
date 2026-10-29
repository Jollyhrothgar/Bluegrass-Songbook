# Golden Standard Source

86 bluegrass standards from Ryan Schindler's Golden Standard fakebook, supplied
as one ChordPro-with-shorthand file, `raw/golden_standard.txt`
(songs separated by `{new_song}`).

Status: finished; 74 works cite `source: golden-standard`. `parsed/` holds the 86
`.pro` files (tracked). Of the 86, 59 overlap classic-country titles and carry
`x_version_label Golden Standard`, `x_version_type alternate` and
`x_book The Golden Standard by Ryan Schindler` (the overlap list is
`OVERLAPPING_TITLES` in `add_version_metadata.py`). Since 2026-10-26 versions are
recorded in `work.yaml` (`song:` / `version:`), not in these headers.

```bash
uv run python sources/golden-standard/parse_songs.py            # raw -> parsed/*.pro
uv run python sources/golden-standard/add_version_metadata.py   # stamp the overlapping 59
```

`parse_songs.py` expands shorthand directives (`{soc}` to `{start_of_chorus}`),
rewrites `{title: X}` as `{meta: title X}`, detects verse boundaries in unmarked
blocks, and adds `x_source golden-standard` and `x_submitted_by github:Jollyhrothgar`.
`analyze_structure.py` is a one-off report on section markers.
