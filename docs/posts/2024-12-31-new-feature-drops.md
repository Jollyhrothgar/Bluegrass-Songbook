---
title: New Feature Drops
date: 2024-12-31
summary: Playlists, search analytics, ideas for more content sources.
---

## Content Sources

Bluegrass doesn't have a lot of "chronically online" people - which is one of the reasons why I love
the genre. You can't make music without your extended bluegrass family.

But, that also means that bluegrass stuff just gets passed around by ear, or worse, forgotten.
There's so many online communities that try to create content repositories to figure out how to
warehouse and share stuff.

I've been thinking about the balance between hoovering that all up into the BluegrassBook index,
when to ask for permission vs forgiveness. I've opted for a sort of hybrid, I guess. Most of the
first index came from a total scrape of classic-country-lyrics.com whic happened to have a lot of
music I played in jams (it even has a dedicated bluegrass section!). The site seems like a labor of
love, from someone who deeply cares about sharing music, so I felt like - hey - it's online - I'm
gonna scrape it and then link back to it.

I felt bad and tried to reach out to the webmaster - and asked for forgiveness (and permission).

Thinking about other content sources, I'm thinking banjo hangout, mandolin hangout, flatpicker
paridise - these all have massive archives of music. Usually all in tef format - which actually has
to be [reverse-engineered](https://github.com/Jollyhrothgar/tef_decoder) if one is going to do
anything with it.

Also want to shout out to reddit's very own [pixiefarm](https://www.reddit.com/user/pixiefarm/) who
showed interest in this project right away and has been helping me identify other sources of roots
music.

### The List

- [Bluegrass Lyrics](https://www.bluegrasslyrics.com/): reached out to these guys, but I haven't
  heard back (they're already integrated with strum machine). I want to also get in touch with Luke
  from strume machine.
- [TuneArch](https://tunearch.org/wiki/TTA): they allow API usage / scraping for non commercial
  usage
- [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_Database): this was a tough one because I
  had to fix a broken docker image to download and host their database, but this is how I get data
  about genre tags.

## New Features

### Lists

Lists are for players that want to organize playlists or set lists and then save 'em. Incoming
features will be list sharing. You can print whole lists, and reorder them in the brower. If you are
logged in, they're synced with the backend cloud.


### Search

Tags, genres, artists, lyrics.


## What's Next


