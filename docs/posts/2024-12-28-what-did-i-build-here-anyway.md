---
title: What Did I Build Here Anyway?
date: 2024-12-28
summary: Summary of features built and roadmap
---

## The Human Speaks:

This post is going to be heavily co-authored by [claude
code](https://code.claude.com/docs/en/overview) which honestly, might be the most important
development tool ever built.

While I had a dataset that I put together with bluegrass songs hanging around my laptop for a while,
I really had no way to organize it effectively.

I've often been in the position of "I can really clearly articulate this idea I want to accomplish,
but I have no desire to learn all the syntax and frameworks I need to accomplish this". Another way
\-- I think I am pretty good about thinking from a systems and architecture perspective, but then
when it gets down to the nitty-gritty details of "Ah crap, I made this file too large and now I need
to refactor it because I'm running out of mental space to deal with it".

But - then Claude Code appeared. And I got dumped from my dream job at Google. Then I went to work
at a start up that does everything "AI First" and my world changed.

I built this entire application in about three long days. Which is pretty impressive to me because
I've never done anything like it. But I can now ask this really smart and eager helper, Claude to
help me structure my thoughts and ideas and then make it happen.

Okay - so I am rambling - and I know it sounds a little smug, but I am just pleased as can be that
this application is standing on it's own two legs and ACTUALLY WORKS.

Here's a structure overview of the state of the app, the remainder of this post is written by
Claude:

## Claude's Update on Milestones, Roadmap, Features, Etc

I've been helping Mike build this thing, so let me give you the tour.

### The Library: 17,600+ Songs

BluegrassBook has songs from multiple sources:

- **Classic Country** (~16,000 songs) - The foundation. Country, bluegrass, folk, gospel - if it's been played at a jam, it's probably here.
- **The Golden Standard** (86 songs) - Hand-picked bluegrass standards from Ryan Schindler's book.
- **TuneArch Fiddle Tunes** (550+ tunes) - Instrumental breakdowns with ABC notation, so you can see the melody.
- **Manual submissions** - Songs added by users like you.

Every song is stored in [ChordPro format](https://www.chordpro.org/) - an open standard that works with other apps. No lock-in.

### Finding Songs

**Just type.** The search box looks at titles, artists, and lyrics all at once:

```
blue moon kentucky
```

**Get specific** with field filters:

```
artist:hank williams
lyrics:lonesome highway
key:G
tag:bluegrass -tag:instrumental
```

**Find by chords** - this is the fun one. Search for songs that use specific Nashville numbers:

```
chord:VII,II       → Songs with ♭VII and II chords
prog:I-IV-V        → The classic progression
```

### Tags & Genres

Songs are tagged by genre (Bluegrass, ClassicCountry, Gospel, OldTime, HonkyTonk...) and vibe:

- **JamFriendly** - Simple chords, easy to pick up at a session
- **Modal** - Has that ♭VII sound (think "Old Home Place")
- **Instrumental** - Fiddle tunes and breakdowns
- **Waltz** - 3/4 time

Tags come from MusicBrainz artist data plus harmonic analysis of the chords themselves. And if you disagree with a tag? Vote on it. We're building the taxonomy together.

### Your Personal Library

Sign in with Google and you get:

- **Favorites** - One-click save, synced across devices
- **Custom Lists** - Build setlists, practice lists, whatever you need
- **Cloud sync** - Your lists follow you

Everything also works offline. The sync is a convenience, not a requirement.

### Reading & Printing

When you open a song:

- **Transpose** to any key with one click
- **Nashville numbers** toggle - see the chord function instead of letter names
- **Font size** controls for your screen or printed page
- **Compact mode** - collapse repeated sections
- **Print view** - clean layout with optional 2-column mode
- **Copy/Download** - Grab the ChordPro source or plain text, download as `.pro` or `.txt`
- **Dark/Light mode** - Easy on the eyes at late-night jams

### Fiddle Tunes & ABC Notation

For instrumentals, we show ABC notation - the standard way to write folk melodies:

```
|: E2AB c2BA | E2AB c2Bc :|
```

Click the "Show Notation" button and you'll see the sheet music rendered right there. Great for learning breaks.

### Song Editor

There's a built-in ChordPro editor with live preview. Use it to:

- **Add new songs** - Paste lyrics, add chords inline with `[G]` syntax
- **Fix existing songs** - Edit and submit corrections
- **Smart paste** - Paste chord-over-lyrics format and it converts to ChordPro automatically

### Contributing

See a wrong chord? Missing song? There's a feedback button on every page. For corrections, you can even edit the ChordPro directly and submit a fix.

### The Bluegrass Standards Board

And if you have *opinions* about what constitutes real bluegrass... well, there's a [complaints department](/bluegrass-standards-board.html) for that.

---

## What's Next?

Here's what we're working on (check [GitHub milestones](https://github.com/Jollyhrothgar/Bluegrass-Songbook/milestones) for the live list):

### Playback Engine
Rhythm backing for practice - metronome, boom-chick patterns, tempo control. Practice at 60 BPM, build up to jam speed.

### List Management
Shareable list links, export/import, full-screen setlist mode for gigs.

### More Content
We're analyzing gaps against BluegrassLyrics.com and other sources. If there's a standard that's missing, we want to know.

### Tablature Generation
Generate fiddle tab, banjo tab, mandolin tab from the melody. Still early but it's on the roadmap.

### Community Features
User profiles, contributor leaderboards, maybe even a "most wanted" list for songs people are requesting.

---

The goal is simple: one place for bluegrass musicians to find songs, build setlists, and practice - without paying subscriptions or getting locked into some app's proprietary format.

Your songs. Your format. Your community.
