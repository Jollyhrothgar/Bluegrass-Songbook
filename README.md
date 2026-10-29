# Bluegrass Songbook

A songbook for bluegrass jams at [bluegrassbook.com](https://bluegrassbook.com).
Search shows a few thousand songs from the bluegrass canon. Another 16,000+
are archived in what the site calls the dungeon: they keep their URLs, and
the "Include the dungeon" checkbox next to the search results searches them
too.

## What it does

- **Search** by title, artist, writer or lyrics, plus chord and progression
  search in Nashville numbers (`chord:VII`, `prog:I-IV-V`) and tags
  (`tag:Gospel`).
- **Song pages** at `/songs/{song}/`, with each version of a song at
  `/songs/{song}/{version}/`. Every page can transpose, switch display modes,
  and export.
- **Credits you can trust.** The writer is the credit. "Recorded by" lists only
  recordings MusicBrainz confirms, each linked to a YouTube search.
- **Practice:** Strum Machine backing tracks where one exists.
- **Tablature:** banjo, fiddle, guitar, mandolin and dobro tabs imported from
  TablEdit (`.tef`) files, with playback, a track mixer, and an in-browser tab
  editor.
- **Lyrics & chords editor** with Lyrics, Chords and ChordPro modes.
- **Lists** that sync across devices once you sign in, and that you can
  share, print, and co-own with other people.
- **Contributing:** signed-in users add and correct songs and tabs in the app.
  Anyone can report a problem with a song, no account needed.
- **Works offline** once loaded (service worker), with dark and light themes.
- A **feature tour** for first-time visitors.

## Songs

Each song is a directory in `works/`: a `work.yaml` with its metadata, plus
one or more parts, usually a ChordPro lead sheet:

```chordpro
{meta: title Your Cheatin Heart}
{meta: composer Hank Williams}

{start_of_verse: Verse 1}
Your cheatin' [C]heart will make you [F]weep
You'll cry and [C]cry and try to [G7]sleep
{end_of_verse}
```

These files open in ChordPro apps such as OnSong, SongbookPro and
MobileSheets. The song lyrics and chords belong to their songwriters and
publishers (see [License](#license)).

## Contributing

- **Add or correct a song:** sign in on the site and use **Add Song** or
  **Edit**. Your change is live within seconds, then a GitHub Actions
  workflow commits it to this repository's `works/` directory.
- **Report a problem with a song:** use **🚩 Report issue** on its page.
- **Code:** open a pull request against `main`. To work on one:

  ```bash
  ./scripts/bootstrap   # install Python (uv) and JS (npm) deps, build the index
  ./scripts/server      # serve docs/ at http://localhost:8080
  ```

  Test commands and project conventions are in [CLAUDE.md](CLAUDE.md). The
  backlog is
  [`docs/plans/2026-09-30-fix-it-list.md`](docs/plans/2026-09-30-fix-it-list.md).
- **Security problems:** report them privately, as [SECURITY.md](SECURITY.md)
  describes.

## License

**Proprietary. All Rights Reserved.** See [LICENSE](LICENSE) for full terms.

The source is publicly viewable, but it is not open source. The website, the tab editor, the tools, and everything else the copyright holder authored may not be copied, modified, distributed, hosted, or reused for any purpose without written permission.

- **Permitted**: Using bluegrassbook.com, reading the source on GitHub, proposing changes via pull request
- **Prohibited**: Everything else, including cloning, self-hosting, personal or educational copies, derivative works, and AI training

Code contributions are assigned to the copyright holder.

**User-submitted content is not claimed.** Lyrics, chords, tabs, and other song material that users upload remain the property of their songwriters, publishers, arrangers, and submitters. Contributing song content does not assign it to the copyright holder. See the "User Content" section of [LICENSE](LICENSE).
