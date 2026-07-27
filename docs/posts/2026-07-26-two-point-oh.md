---
title: 2.0 — A Bluegrass Book That Acts Like One
date: 2026-07-26
summary: The index is jam repertoire now. One page per song, chrome that gets out of the way, and a bounty board that knows exactly what's missing.
---

The site just shipped its largest release. Here's what changed, and why.

![The new homepage: banner, search, collections](/posts/images/2.0-home.png)

## The index is bluegrass now

Search used to return 18,204 songs, most of them classic-country lead sheets
that came along with the original import. "House of the Rising Sun" was
tagged a Bluegrass Standard. That's over.

Every song was scored against a MusicBrainz mirror by **who actually
recorded it**: how many bluegrass-family artists, across how many
generations. Songs with real jam pedigree stayed; 12,939 without it were
removed from search. The result is about **5,200 searchable songs** that
earn their place, and a Bluegrass Standards collection where every entry
was validated by both the recording graph and a hand review.

The prune is non-destructive. Nothing was deleted: direct links still work,
your lists still work, and any song a user contributed is exempt no matter
what the data says. There's a one-line command to bring any song back.

## One page per song

Songs and "works" used to be two different pages — a lead sheet view and a
dashboard of version cards, part cards, and forms. Now there is one page.
Lyrics and chords render by default; banjo tabs and fiddle notation are
tabs on the same page; alternate versions live behind a small "arrangements"
control with voting. Old URLs redirect permanently.

![The unified song page: title, control pills, and the sheet](/posts/images/2.0-song-page.png)

Duplicate versions got real curation. The same song split across two
entries — two "Misty"s, two "John Henry"s, three "Wayfaring Stranger"s —
now collapses to a single search result with the canonical version in
front and the rest one tap away. About two dozen standards were unified
this way, with tooling to keep going.

## Chrome that gets out of the way

The old interface stacked a 250px logo header, a hamburger menu, and three
different collapsible control bars on top of every song. All of it is gone,
replaced by a slim bar at the top and, when a tab is playing, a transport
bar at the bottom. Key, display, and song-info controls are small pills
under the title.

Focus mode no longer exists as a feature — because it's the default.
Scroll into a song and the top bar slides away; scroll up and it's back.
On a phone, the sheet runs edge to edge. Lines that used to wrap three
times fit whole.

![Scrolled into a song on a phone: the entire screen is music](/posts/images/2.0-immersive.png)

## Deleting things works now

An embarrassing one: the admin delete button wrote to a database table
that nothing ever read, so deleted songs resurrected on every deploy.
Deletions now sync into the repository hourly and stick. The same
machinery — a committed curation registry — holds canonical pins,
suppressions, and tag corrections, so editorial decisions survive
re-imports and re-tagging instead of living in one database nobody
checks.

## The bounty board knows what's missing

The same recording-graph analysis that pruned the index also produced a
map of what the book *should* have and doesn't: **515 canonical jam songs**,
led by 82 core standards — Cumberland Gap, Katy Hill, Rawhide, Bill
Cheatham. The bounty board now lists all of them, plus two gaps computed
from the index itself: **165 tunes that exist but lack banjo, mandolin, or
guitar tabs** (the whole corpus has 51 banjo tabs, one mandolin tab, and
zero guitar tabs — help), and **~100 songs with words but no chords**.
Tap any of them to contribute; the form comes prefilled.

![The bounty board, led by the missing core jam standards](/posts/images/2.0-bounty.png)

## Tab rendering, round three

The TEF import pipeline now carries text annotations, fingerings, section
names, repeat brackets rendered as single voltas, and TablEdit-style bends
played as quarter-tone chokes. Silent measures render as empty bars
instead of vanishing.

![A banjo tab with the playback transport and track mixer in the bottom band](/posts/images/2.0-tab-page.png)

## Since January, in numbers

- 764 songs imported from BluegrassLyrics.com, 494 with chords recovered
  by matching against Ultimate Guitar
- 18,204 → ~5,200 searchable songs; 236 → 194 Bluegrass Standards
- 515 missing standards catalogued and wanted
- Five views, one modal system, and roughly 3,000 net lines of code deleted
- 1,325 unit tests and 283 browser tests now guard all of it

The feedback button is in the top bar — the bug with the little bug on it.
Use it.
