---
title: 2.0 — A Bluegrass Book That Acts Like One
date: 2026-07-26
summary: The index is jam repertoire now. One page per song, chrome that gets out of the way, and a bounty board that knows exactly what's missing.
---

The site just shipped its largest release. Here's what changed, and why.

![The new homepage: banner, search, collections](/posts/images/2.0-home.png)

## The index is bluegrass now

Keeping the entire imported corpus made search less useful for a site
dedicated to bluegrass — a query would surface thousands of classic-country
lead sheets, and "House of the Rising Sun" sat in the Bluegrass Standards
collection. So I made the call: any song I couldn't programmatically
identify as bluegrass — scored by which bluegrass artists actually recorded
it, across how many generations — was dropped from search. That cut the
index from **18,204 to about 5,200 songs**.

The data was all retained. Direct links and lists still work, and if song
requests come in for something that got cut, bringing it back is a
one-line change.

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

We used to provide too many views of the same content — a works view, a
focus view, a print view — and it was confusing. The new design assumes
that most people coming here just want to **read the music**, so everything
merged into one view that minimizes decoration and leaves the room to the
content: a slim bar on top, controls as small pills under the title, and a
transport bar on the bottom when a tab is playing. Scroll into a song and
even the top bar slides away; on a phone, the sheet runs edge to edge.

![Scrolled into a song on a phone: the entire screen is music](/posts/images/2.0-immersive.png)

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

## Tablature: a TablEdit for the browser

This one deserves its own headline. The tab system is no longer just a
viewer — it's targeting **full TablEdit compatibility for bluegrass
multipart tabs**, in the browser, no software to install:

- **Import your `.tef` files directly.** Drop a TablEdit file on the
  [create page](create.html) and it's parsed entirely in your browser —
  tracks, tunings, capos, repeats, and all — then opens in the editor,
  ready to review.
- **Edit in the browser.** Every tab on the site has an Edit button:
  fix a note, change a fingering, adjust a roll. Submissions go through
  the same human review as song corrections. You can also build a tab
  from scratch, and drafts save locally as you work.
- **Multipart playback.** Arrangements with banjo, guitar, mandolin, and
  bass play together, with a track mixer to bring parts in and out, solo
  buttons, looping, count-in, a metronome, and tempo control.
- **Faithful rendering.** Text annotations, fingerings, section names,
  repeat brackets and voltas, and TablEdit-style bends — played back as
  the quarter-tone chokes they are.

If you've got a folder of `.tef` files from years of collecting, this is
your invitation.

![A banjo tab with the playback transport and track mixer in the bottom band](/posts/images/2.0-tab-page.png)

## Thanks

None of this exists without the people who said yes:
[BluegrassLyrics.com](https://www.bluegrasslyrics.com),
[Classic Country Song Lyrics](https://www.classic-country-song-lyrics.com),
and the Golden Standard collection all gave permission for their content
to live on here. Banjo tabs link back to their original sources and
authors on every page.

## Since January, in numbers

- 764 songs imported from BluegrassLyrics.com, 494 with chords recovered
  by matching against Ultimate Guitar
- 18,204 → ~5,200 searchable songs; 236 → 194 Bluegrass Standards
- 515 missing standards catalogued and wanted
- Five views, one modal system, and roughly 3,000 net lines of code deleted
- 1,325 unit tests and 283 browser tests now guard all of it

The feedback button is in the top bar — the bug with the little bug on it.
Use it.
