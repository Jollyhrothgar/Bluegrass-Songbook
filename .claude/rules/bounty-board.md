---
paths:
  - "docs/js/title-match.js"
  - "docs/js/bounty-view.js"
  - "curation/bounty_decisions.yaml"
---

# The bounty board's title matching

`title-match.js` exposes no fuzzy ratio on purpose (scores 0.80-0.93 mix true
and false pairs: `500 Miles` / `900 Miles` scores 0.89) and returns candidate
arrays, never a best match. `partitionWanted()` (`bounty-view.js`) also filters
against `data/bounty_decisions.json`, built from `curation/bounty_decisions.yaml`.
Evidence: `sources/bounty-hunt/CLEANUP-PLAN.md`.
