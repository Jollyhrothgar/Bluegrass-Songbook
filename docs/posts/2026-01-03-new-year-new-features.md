---
title: New Year, New Features
date: 2026-01-03
summary: Tablature support, Strum Machine integration, print improvements, and a traffic spike that made my week.
---

## Y'all Came

I went from ~50 visitors a day to **829 unique visitors** in a single day. January 3rd? Another
697. That's nearly 1,500 new folks checking out the songbook in two days. Small potatoes I guess for
big boy websites, but this is exciting as my first real solo dev project.

![Daily Traffic](/posts/images/2026-01-03-traffic.png)

I have some google analytics set up - it looks like a lot of you are from Banjo Hangout (it's not
stalking, its just part of the web - when you click on a link, it's called a 'referral' and that
info is sent along to people like me, who can then use it to serve the audience. I guess I will
double down on the banjo tab feature I just built ... TODAY!

## What's New

### Tablature Support

I love and hate tabledit. I love it for what it has done for the community, but the format is closed
and even though the reader is free, it's hard to share / integrate / build on top of tef files. So I
reverse engineered the format, and created a new tab spec (more later) - Open Tab Format (kinda like
MIDI but with more info) and Human Tab Format - which is similar to ABC format, but built for
stringed & fretted instruments. More to come. For now - two tabs are posted that were directly
processed from tef files - a [mandolin break](/#work/foggy-mountain-breakdown) to foggy mountain breakdown, and a banjo break to
[shuckin the corn](/#work/shuckin-the-corn).

The infrastructure is in place, and I'm starting to add tabs from various sources. Right now it's
mostly fiddle tunes from TuneArch with ABC notation, but the system supports banjo tabs, guitar
tabs, mandolin tabs - whatever you've got. I haven't figured out how users can import their own tabs
yet - I suspect it will be something like "upload tef" and then it'll get parsed and served in the
open format. Probably later, I'll build a tab editor in browser.

When a song has tablature, you'll see instrument badges in the search results. Click through and you can switch between the lead sheet and the tab.

### Strum Machine Integration

If you haven't tried [Strum Machine](https://strummachine.com/), it's a fantastic practice tool -
gives you backing tracks with real instruments. Luke Abbot is an absolute king. We're lucky to have
him in the bluegrass dev community.

I've matched **652 songs** in the BluegrassBook to their Strum Machine equivalents. If a song has a
match, you'll see a "Practice with Strum Machine" link that takes you right there. It's a nice
workflow: find the chords here, practice with backing tracks there. You need a strum machine
account, but if this site drives subscribers for Luke, I will be a happy man.

More matches coming as I work through the catalog - I am exploring programmatic creation of rhythm
sheets, and maybe creating some kind of private shared list so all songs can have a strum machine
track.

### Print View Overhaul

The print view got some love. Cleaner layouts, better page breaks, and I ditched the old popup approach for proper CSS print styles. Hit Ctrl+P (or Cmd+P on Mac) on any song and you'll get something that actually looks good on paper.

Multi-column mode still works for cramming more onto a page if that's your thing.

### Fullscreen Focus Mode

When you're practicing from a list, hitting the fullscreen button now gives you a distraction-free view. Navigate through your setlist with the arrow buttons or your keyboard. Your phone sitting on the music stand just got a lot more useful.


## What's Coming

Peeking at the [GitHub issues](https://github.com/Jollyhrothgar/Bluegrass-Songbook/issues), here's what's on deck:

- **Tab editor** - create and edit tablature in the browser
- **Offline mode** - take your lists to the festival where there's no cell service
- **Strum Machine embedding** - play backing tracks right here instead of jumping to another site
- **Intelligent tab transposition** - transpose a banjo tab and have it re-finger for the new key
- **Social features** - contributor profiles, maybe some friendly competition

No promises on timelines. This is a labor of love, not a job. But the backlog is full of good ideas and I'm having fun building them.

## Thanks

To everyone who showed up this week - thanks for checking this out. If you find a wrong chord, a missing song, or just want to say hi, there's a feedback button on every page.

Cheers!
