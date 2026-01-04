# Emerging Themes: Research Synthesis

Stepping back from the details to identify patterns across all research.

---

## Theme 1: The Corpus is Small and Stable

The "bluegrass problem" isn't a data problem—it's a framing problem.

| What we have | Count | Notes |
|--------------|-------|-------|
| Total songs | 17,652 | Feels overwhelming |
| Bluegrass-era artists | 782 | Actually manageable |
| Canonical bluegrass | ~1,000-1,200 | With tagging improvements |
| First Generation | 259 | The true canon |

**Implication**: This is small enough to be *fully curated by hand* if needed. No need for complex algorithms or dynamic systems. A human could review 782 songs.

The corpus won't grow massively because:
- Bluegrass history is fixed (Bill Monroe isn't recording new songs)
- The canon is established (IBMA, festivals, Jack Tuttle all agree)
- New modern artists add songs slowly

---

## Theme 2: The Eras Are the Natural Structure

Every source we consulted organizes bluegrass the same way:

```
Pre-Bluegrass (1920s-1945)     → Carter Family, Jimmie Rodgers
First Generation (1945-1960)   → Monroe, Flatt & Scruggs, Stanleys
Folk Revival (1960s)           → Doc Watson, Country Gentlemen
Festival/Newgrass (1970s)      → Tony Rice, Seldom Scene
New Traditionalists (1980s)    → Ricky Skaggs, Del McCoury
Modern (1990s+)                → Alison Krauss, Billy Strings
```

This isn't arbitrary—it's how the bluegrass community already thinks. Jack Tuttle uses it. Wikipedia uses it. IBMA implicitly uses it.

**Implication**: Eras could be the primary navigation structure. It's stable, authoritative, and self-explanatory.

---

## Theme 3: Two Audiences, One Site

The 17k songs serve two different needs:

| Audience | What they want | Songs |
|----------|---------------|-------|
| **"True bluegrass"** seekers | Bill Monroe, Stanley Brothers, the canon | ~1,000 |
| **"Jam musicians"** | Anything playable at a jam (including country) | ~14,000 JamFriendly |

The "bait and switch" feeling comes from not acknowledging this split.

**Implication**: The landing page could explicitly address both:
- "Bluegrass Standards" → the canon
- "Jam-Friendly Classics" → the broader collection (honestly labeled)

This reframes the 17k songs as a feature ("we also have country standards you'll hear at jams") rather than dilution.

---

## Theme 4: Curation > Algorithms

Given:
- Small, stable corpus
- Low maintenance goal
- Established canon

Dynamic/algorithmic approaches are overkill. What works:

| Approach | Maintenance | Fits our needs? |
|----------|-------------|-----------------|
| ML recommendations | High | ❌ Overkill |
| Real-time tag filtering | Medium | ❌ Exposes complexity |
| Pre-computed collections | Low (one-time) | ✅ Yes |
| Static curated lists | Very low | ✅ Yes |

**Implication**: Build static collections once, powered by internal data. No ongoing curation needed unless new songs are added.

---

## Theme 5: The Data is the Documentation

We've built detailed internal knowledge:
- Artist → Era mapping
- Artist aliases/normalization
- Bluegrass albums for edge cases (Dolly)
- Composer relationships
- Repertoire overlap graphs

This doesn't need to be exposed to users, but it *is* valuable documentation of "what is bluegrass" that could:
- Power static collection generation
- Be published as reference material
- Inform future contributors

**Implication**: The research artifacts are useful even if no code changes happen.

---

## Theme 6: The "Traditional" Problem

526 songs are attributed to "Traditional" with high bluegrass affinity. These are:
- Fiddle tunes (Cripple Creek, Salt Creek)
- Murder ballads (Pretty Polly, Banks of the Ohio)
- Gospel standards (I'll Fly Away, Angel Band)

These are *core* bluegrass repertoire but have no "artist" to organize around.

**Implication**: Need a way to surface traditional tunes that doesn't depend on artist-based navigation. "Fiddle Tunes" and "Gospel Standards" collections solve this.

---

## Theme 7: Honest Framing Beats Perfect Taxonomy

The site doesn't need to perfectly categorize every song. It needs to:

1. **Lead with bluegrass** → First impression matches the brand
2. **Acknowledge the breadth** → "Plus 14,000 jam-friendly country songs"
3. **Let users self-select** → Clear paths for different needs

A honest frame like:

> "782 songs from the bluegrass canon, plus thousands of country classics you'll hear at jams"

...is better than trying to tag everything perfectly.

---

## Theme 8: What "Self-Driving" Looks Like

For a low-maintenance site:

| Component | Self-driving approach |
|-----------|----------------------|
| Collections | Static, pre-computed, committed to git |
| Search | Already works, minimal changes |
| New songs | Rare additions, manual classification okay |
| Recommendations | "Similar songs" via pre-computed lists |
| Landing page | Static HTML with collection links |

No databases, no ML pipelines, no editorial calendar. Just well-organized static content.

---

## Synthesis: What Should the Landing Page Be?

Based on these themes:

1. **Hero**: Clear bluegrass identity, not "17,000 songs"
2. **Primary nav**: Era-based browsing (stable, canonical)
3. **Collections**: 5-6 static pre-computed lists
4. **Honest framing**: Acknowledge jam-friendly country as a feature
5. **Search**: Still there for power users, not the focus
6. **Maintenance**: Near-zero after initial build

The internal tagging work (eras, composers, aliases) generates the collections *once*, then we're done.

---

## Theme 9: Instrumentals Are a First-Class Need

The site isn't just lyrics+chords. Instrumentals are core to bluegrass:

| What musicians want | Current state |
|--------------------|---------------|
| Fiddle tunes | 505 tagged "Instrumental", TuneArch source |
| Banjo tabs | Some tablature support |
| Mandolin tunes | Scattered |
| Breakdown melodies | ABC notation support exists |

**Why this matters**:
- Jam sessions often kick off with instrumentals
- Fiddle tunes are how people learn to improvise
- Many musicians search specifically for "tunes" not "songs"
- This is a *different use case* from lyrics/chords

**Current gap**: Instrumentals exist but aren't surfaced prominently.

**Implication**: "Fiddle Tunes" or "Instrumentals" deserves its own top-level collection, possibly with:
- Key/mode filtering (lots of fiddle tunes are modal)
- Difficulty indicators
- Standard vs. crooked tunes
- Regional styles (Texas, Appalachian, contest)

The corpus isn't complete here—there are thousands of fiddle tunes that could be added. This is an area where the corpus *could* grow, unlike the bluegrass song canon.

---

## Theme 10: Two Content Types, Two Needs

| Type | What it is | User need | Format |
|------|-----------|-----------|--------|
| **Songs** | Lyrics + chords | Learn words, chord changes | ChordPro |
| **Tunes** | Melody, no words | Learn the melody, variations | ABC/Tab |

These serve different moments:
- Songs: "What are the words to Blue Moon of Kentucky?"
- Tunes: "How does Salt Creek go? What's the B part?"

**Implication**: Landing page should acknowledge both:
- "Songs" → lyrics, chords, singable
- "Tunes" → instrumentals, fiddle tunes, breakdowns

---

## Theme 11: The Corpus Has Structural Gaps

We scraped ONE lyrics site and ONE tune archive. Gaps are predictable:

| Gap Type | What's Missing | Why |
|----------|---------------|-----|
| **Banjo tabs** | Earl's Breakdown, Flint Hill Special, etc. | No banjo source scraped |
| **Modern artists** | Sam Bush, Béla Fleck, Chris Thile | Country site didn't have them |
| **Mandolin tabs** | Instrument-specific content | No mandolin source |

**Potential sources identified** (not yet scraped):
- banjohangout.org - "thousands" of banjo tabs
- mandolincafe.com - 1,948 mandolin tunes (closed archive)
- thesession.org - 30,000+ Irish/folk tunes
- taterjoes.com - bluegrass focused

**Gap identification without scraping**:
1. Compare against canonical artist lists → who's missing?
2. Compare against "standard tune" checklists → what tunes should we have?
3. Cross-reference MusicBrainz → artist X has 500 recordings, we have 46

**Implication**: Before building more features, might be worth filling high-value gaps (banjo tabs, missing artists).

---

## Open Questions

1. **Do we show song counts?** "259 songs" in First Generation—helpful or intimidating?
2. **How deep do eras go?** Link directly to search results, or intermediate pages?
3. **What's the visual language?** Cards? Lists? Artist photos?
4. **Mobile-first?** Jam musicians are often on phones at sessions.
5. **Instrumental growth?** Is the tune corpus worth expanding? (TuneArch, thesession.org, etc.)
6. **Tune difficulty?** Should we rate fiddle tunes by difficulty?
