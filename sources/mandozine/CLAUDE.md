# Mandozine

TablEdit files from mandozine.com's tab archive (about 3,000 mandolin-centric
arrangements; the bulk zips are frozen at 2019). Used to fill wanted-list
instrumentals from `docs/data/wanted_songs.json`.

- `src/import_bounty.py [--dry-run]` matches wanted titles against archive
  filenames and imports through the shared Hangout pipeline
  (`sources/banjo-hangout/src/`: `TEFConverter`, `works_importer.import_tab`),
  using a local `SiteConfig` named `mandozine`.
- `tefs/` holds the TEF files actually imported (provenance archive); `parsed/`
  holds converted OTF.
- `tabs/` (full extraction) and `zips/` are not committed. Re-fetch with
  `https://mandozine.com/music/zip_files/allfiles.zip` into `zips/`, extract
  into `tabs/`. There is no .gitignore rule for them, so add one or keep
  them out of `git add`.
- Filenames encode metadata: `{Title}-{Key}-{Author}[-Guitar].tef` (for example
  `LeeHighwayBlues-D-Trad.tef`). `src/import_bounty.py` prefers mandolin (non `-Guitar`)
  files and `Trad` authorship, then rewrites provenance to `source: mandozine`
  plus the archive URL and `source_file`, because the shared importer would
  otherwise template Hangout URLs that do not exist.
- Substring title matching gives false hits: wanted "Fortune" matches
  `BanishMisfortune-*.tef`. Add such cases to `EXCLUDE_TITLES` in `src/import_bounty.py`.
