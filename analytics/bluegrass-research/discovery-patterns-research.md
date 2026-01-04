# Discovery Patterns for Music Corpora

Research on how to design discovery experiences for a curated music collection, applied to bluegrass.

## The Core Tension

**MusicBrainz approach**: Information-dense, metadata-rich, faceted, exhaustive
- Great for: Power users, data nerds, completionists
- Problem: Overwhelming, clinical, doesn't spark joy

**Streaming service approach**: Curated, contextual, mood-based, algorithmic
- Great for: Casual discovery, "just play something good"
- Problem: Can feel manipulative, creates echo chambers

**Our opportunity**: A middle path for *intentional* musicians who want to find songs to learn and play.

---

## Key Concepts

### Lean-Back vs Lean-Forward

| Mode | Behavior | Example |
|------|----------|---------|
| **Lean-Back** | Passive, let the algorithm decide | Spotify's Autoplay, "Play similar" |
| **Lean-Forward** | Active, searching with intent | "I need a song in G for the jam tonight" |

**Bluegrass Songbook users are lean-forward**: They're looking for specific songs to learn, not passive listening. This changes everything about how we should design discovery.

### Browse vs Search

| Approach | When to use |
|----------|-------------|
| **Search** | User knows what they want ("Blue Moon of Kentucky") |
| **Browse** | User is exploring ("What are some good fiddle tunes?") |

Current site is search-heavy. Landing page should enable browsing.

---

## Discovery Patterns (from streaming services)

### 1. Curated Collections (Playlists)
**What it is**: Human-curated or algorithmically-generated lists with an editorial voice.

**Spotify examples**:
- "Discover Weekly" - Personalized recommendations
- "RapCaviar" - Flagship hip-hop playlist
- "Deep Focus" - Mood/context-based

**Bluegrass application**:
- "Jam Standards" - Songs everyone should know
- "First Generation Masters" - Bill Monroe, Flatt & Scruggs era
- "Festival Favorites" - What's getting played at festivals this year
- "Gospel Hour" - Traditional bluegrass gospel
- "Fiddle Tunes for Beginners" - Simple instrumentals to learn

**Key insight**: Collections should have a *voice* and *purpose*, not just be tag filters.

### 2. Contextual/Mood-Based

**What it is**: Organizing by use case rather than metadata.

**Streaming examples**:
- "Music for Studying"
- "Workout Beats"
- "Chill Vibes"

**Bluegrass application**:
- "Easy songs for your first jam"
- "Songs in G (no capo needed)"
- "Three-chord wonders"
- "Challenge yourself" (complex chord progressions)

**Key insight**: Users don't think in tags, they think in contexts.

### 3. Social Proof / Popularity

**What it is**: Showing what's popular or trending.

**Examples**:
- Netflix "Top 10"
- Spotify "What's Hot"
- Apple Music charts

**Bluegrass application**:
- "Most viewed this week"
- "Popular at jams" (based on JamFriendly tag + views)
- "Recently added"

**Key insight**: Popularity signals reduce decision fatigue.

### 4. Similarity-Based Discovery

**What it is**: "If you like X, try Y"

**Technical approaches**:
- Collaborative filtering (users who liked X also liked Y)
- Content-based (similar chords, key, tempo)
- Artist-based (same era, same style)

**Bluegrass application**:
- "Similar songs" on song detail page
- "More from this artist"
- "Songs with the same chord progression"
- "If you like Bill Monroe, try Ralph Stanley"

### 5. Serendipitous Discovery

**What it is**: Introducing variety to prevent echo chambers.

**Examples**:
- Spotify's "Blend" (mixing your taste with a friend's)
- "Shuffle" features
- Featured content that changes daily

**Bluegrass application**:
- "Song of the Day"
- "Random jam song" button
- "Explore beyond your favorites"

---

## Information Architecture Options

### Option A: Faceted Search (Current + Enhanced)
```
Search: [_______________] [Key: Any ▼] [Tags: Any ▼]

Results:
- Blue Moon of Kentucky (Bill Monroe) - G - Bluegrass, JamFriendly
- ...
```

**Pros**: Powerful, flexible, familiar
**Cons**: Can feel clinical, requires users to know what they want

### Option B: Browse-First (Magazine Style)
```
┌─────────────────────────────────────────────────────┐
│  🎵 BLUEGRASS SONGBOOK                    [Search]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  BLUEGRASS STANDARDS                                │
│  The songs every picker should know                 │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐                       │
│  │    │ │    │ │    │ │    │  → See all (200+)     │
│  └────┘ └────┘ └────┘ └────┘                       │
│                                                     │
│  LEARN BY ERA                                       │
│  ○ First Generation (1945-1960)                    │
│  ○ Folk Revival (1960s)                            │
│  ○ Festival Era (1970s)                            │
│  ○ Modern Bluegrass                                │
│                                                     │
│  QUICK PICKS                                        │
│  [🎸 3-Chord Songs] [🎻 Fiddle Tunes] [⛪ Gospel]   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Pros**: Inviting, guides exploration, showcases content
**Cons**: Requires curation effort, may not scale

### Option C: Hybrid (Recommended)
```
Landing page: Browse-first (curated collections)
Song search: Faceted search (for power users)
Song detail: Similarity recommendations
```

This gives:
- **New users**: Guided exploration through collections
- **Regular users**: Quick search to find specific songs
- **All users**: Discovery through "similar songs"

---

## What NOT to Do

### Don't Become MusicBrainz
- No exhaustive metadata display
- No "edit this entity" workflows
- No complex relationship graphs
- Keep it simple: song, artist, key, chords, lyrics

### Don't Over-Facet
> "Don't go crazy with facets. Information overload is bad enough."
> — Algolia UX Best Practices

Bad: 15 filter dropdowns (Genre, Era, Key, Mode, Chord Count, Composer, ...)
Good: 2-3 useful filters + curated collections

### Don't Forget the Purpose
Users come here to **find songs to play**. Every design decision should make that easier.

---

## Recommended Next Steps

1. **Define 5-7 curated collections** with clear editorial voice
2. **Design browse-first landing page** that showcases collections
3. **Keep existing search** for power users
4. **Add "similar songs"** to song detail pages
5. **Track what users actually search for** to inform future collections

---

## Sources

- [Algolia: Faceted Search UX](https://www.algolia.com/blog/ux/faceted-search-and-navigation)
- [A List Apart: Faceted Navigation](https://alistapart.com/article/design-patterns-faceted-navigation/)
- [Spotify Recommendation System Guide](https://www.music-tomorrow.com/blog/how-spotify-recommendation-system-works-complete-guide)
- [Lean Forward Listener](https://www.leanforwardlistener.com/) - Philosophy of intentional listening
- [Digital Turbine: Lean-Back Discovery](https://www.digitalturbine.com/blog/user-acquisition/anatomy-of-app-discovery-part-1-the-evolution-of-lean-back-discovery/)
- [UX Lessons from Netflix & Spotify](https://www.vanguard.cx/insights/ux-lessons-from-netflix-spotify-and-beyond-what-works-in-subscription-models)
