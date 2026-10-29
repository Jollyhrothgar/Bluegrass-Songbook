---
paths:
  - "docs/js/search-core.js"
  - "docs/js/search-query.js"
  - "docs/js/tags.js"
  - "scripts/lib/search_index.py"
  - "scripts/lib/search_gaps.py"
  - "tests/test_search_index.py"
---

# Search

Syntax lives in `docs/js/search-query.js`, scoring in `docs/js/search-core.js`;
read those, not a list here. Not obvious from the code:

- There is deliberately no `key:` filter (keys transpose) and no `covering:`
  filter. `status:`, `has:` and every negation except `-tag:` were removed on
  purpose; typing them degrades to plain text.
- Instrument tags (`tag:banjo`, `tag:multipart`, ...) are virtual:
  `tags.js::getInstrumentTags(song)` derives them from `tablature_parts` and
  `has_abc`, and matching, badges, the Tags dropdown and the Instrument facet all
  read it. Add a facet in `INSTRUMENT_FACETS` plus its checkbox in `index.html`.
- Facet chips write syntax into the search box so the box stays the single
  source of truth. The Instrument pill uses `tags.js::toggleFacetTag`; other
  surfaces sync through `tags.js::onTagSync(fn)`.
- Scope: canon by default; `#dungeon` (`dungeonMode`) searches the archive only;
  the "Include the dungeon" checkbox (`includeDungeon`, localStorage
  `songbook-include-dungeon`) searches both. `searchableSongs()` decides;
  `main.js::applySearchScope()` loads the archive when needed.
- `search_index.py` must match the site's search: `search_gaps.py` replays
  visitors' failed searches through it. Change `search()` in
  `docs/js/search-core.js` and `search_parsed()` in `search_index.py` together
  (`tests/test_search_index.py`). It lacks the site's stemmed-word fallback
  (`stemWord` in `docs/js/stem.js`, used by `search()`) and virtual instrument
  tags (`getInstrumentTags` in `docs/js/tags.js`), so it may find less than the
  site, never more.
