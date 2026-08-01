# Mandozine Source

TablEdit files from [Mandozine](https://mandozine.com)'s tab archive
(~3,000 contributed arrangements, mandolin-centric, bulk zips frozen 2019).

Discovered during the Aug 2026 bounty-hunt source research; first used to
fill 12 wanted-list instrumentals (Lee Highway Blues, Dawg's Waltz, EMD,
Watson's Blues, ...).

```
mandozine/
├── src/import_bounty.py   # wanted-list matcher + import driver
├── tefs/                  # the TEF files actually imported (provenance archive)
├── parsed/                # converted OTF output
├── tabs/                  # full extracted archive (gitignored, re-fetch zip)
└── zips/                  # bulk zip downloads (gitignored)
```

Filenames encode metadata: `{Title}-{Key}-{Author}[-Guitar].tef`
(e.g. `LeeHighwayBlues-D-Trad.tef`, `Swing51-D-Grisman.tef`). The driver
prefers mandolin (non `-Guitar`) files and `Trad` authorship, converts via
the shared Hangout TEF→OTF pipeline (`sources/banjo-hangout/src/`), then
rewrites provenance to `source: mandozine` + archive URL + `source_file`
(the shared importer would otherwise template nonexistent Hangout URLs).

Re-fetch the archive: download
`https://mandozine.com/music/zip_files/allfiles.zip` into `zips/` and
extract into `tabs/`.

Beware false filename matches: substring matching maps wanted "Fortune"
to `BanishMisfortune-*.tef` (an unrelated Irish tune) — see
`EXCLUDE_TITLES` in the driver.
