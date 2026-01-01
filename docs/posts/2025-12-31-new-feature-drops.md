---
title: New Feature Drops
date: 2025-12-31
summary: Shareable setlists, drag-drop reordering, focus mode, and ideas for more content sources.
---

## Content Sources

Bluegrass doesn't have a lot of "chronically online" people - which is one of the reasons why I love
the genre. You can't make music without your extended bluegrass family.

But, that also means that bluegrass stuff just gets passed around by ear, or worse, forgotten.
There's so many online communities that try to create content repositories to figure out how to
warehouse and share stuff.

I've been thinking about the balance between hoovering that all up into the BluegrassBook index,
when to ask for permission vs forgiveness. I've opted for a sort of hybrid, I guess. Most of the
first index came from a total scrape of classic-country-lyrics.com which happened to have a lot of
music I played in jams (it even has a dedicated bluegrass section!). The site seems like a labor of
love, from someone who deeply cares about sharing music, so I felt like - hey - it's online - I'm
gonna scrape it and then link back to it.

I felt bad and tried to reach out to the webmaster - and asked for forgiveness (and permission).

Thinking about other content sources, I'm thinking banjo hangout, mandolin hangout, flatpicker
paradise - these all have massive archives of music. Usually all in tef format - which actually has
to be [reverse-engineered](https://github.com/Jollyhrothgar/tef_decoder) if one is going to do
anything with it.

Also want to shout out to reddit's very own [pixiefarm](https://www.reddit.com/user/pixiefarm/) who
showed interest in this project right away and has been helping me identify other sources of roots
music.

### The List

- [Bluegrass Lyrics](https://www.bluegrasslyrics.com/): reached out to these guys, but I haven't
  heard back (they're already integrated with strum machine). I want to also get in touch with Luke
  from Strum Machine.
- [TuneArch](https://tunearch.org/wiki/TTA): they allow API usage / scraping for non commercial
  usage
- [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_Database): this was a tough one because I
  had to fix a broken docker image to download and host their database, but this is how I get data
  about genre tags.

## New Features

### Lists & Setlists

This one's been a long time coming. You can now create lists - whether that's a setlist for your
next jam, a practice queue, or just songs you want to learn someday.

The fun part: **lists are shareable**. Just copy the URL and send it to your jam buddies. They can
view your list, and if they want their own copy, there's a "Copy to My Lists" button. No more
texting song titles back and forth.

Other list goodies:
- **Drag and drop** to reorder songs (works for favorites too)
- **Print the whole list** - one click, all the chord sheets
- **Navigate through your list** with prev/next buttons while viewing songs
- Everything syncs to the cloud if you're logged in

### Focus Mode

Sometimes you just want to practice without distractions. Hit the fullscreen button on any song and
you get a clean, focused view. Navigate through your list with arrow keys or the nav buttons. Your
phone won't judge you for playing the same three songs over and over.

### Tag Voting

The genre tags come from MusicBrainz, but they're not always right. Now you can upvote or downvote
tags on any song. Think "Foggy Mountain Breakdown" should be tagged as an instrumental? Vote it up.
See a tag that doesn't fit? Vote it down. The community helps keep things accurate.

### Search Improvements

Search got smarter:
- Filter by **artist**, **title**, **lyrics**, **key**, **tag**, or **composer**
- Exclude stuff with negative filters (e.g., `tag:bluegrass -tag:instrumental`)
- Search by **chord progressions** (`prog:I-IV-V`) or **Nashville numbers** (`chord:VII`)
- Tags are normalized now - searching "classic country" finds "ClassicCountry"

## What's Next

Still got a big list of stuff I want to build. Top of mind:
- **Offline mode** - take your lists to the festival where there's no cell service
- **Better tablature** - working on decoding those .tef files from the hangout forums
- **More content sources** - always looking for more songs to add to the index

If you've got ideas or want to help out, hit me up. This is a labor of love and I'm always happy to
chat with fellow pickers.

