# OTF: the tab format

OTF (Open Tab Format) is the Bluegrass Songbook's tab format: one JSON document
per tab, stored as `*.otf.json`. The authoritative definition is the JSON Schema
[`otf.schema.json`](otf.schema.json) (JSON Schema 2020-12, published at
`https://bluegrassbook.com/schema/otf.schema.json`). This guide explains it; if
the two ever disagree, the schema wins and this file has a bug.

Two validators enforce it, and a shared set of fixture files
(`tests/fixtures/otf/`) proves they agree:

| Language | Where | How |
|---|---|---|
| Python | `scripts/lib/otf_schema.py` (`check`, used by `process_pending.validate_otf`) | the schema through `jsonschema`, plus the cross-field rules |
| JS | `docs/js/otf-editor/otf-validate.js` (`validateOTF`, re-exported from `actions.js`) | hand-written checks, no browser dependency |

## Version rule

`otf_version` is `"MAJOR.MINOR"`.

| Version | Date | What changed |
|---|---|---|
| `1.0` | 2026-10-28 (G15a) | the first schema |
| `1.1` | 2026-10-29 (G15c) | optional `metadata.tab_by` (who wrote the tab), the first minor bump |


- Adding an **optional** field bumps the minor version.
- Anything else (a rename, a removal, a change of meaning, a new required
  field) bumps the major version.
- Files of any earlier `1.x` stay valid under the current schema.
- **Writers stamp the current version; readers accept any `1.x`** and reject
  any other major (`validateOTF` accepts `"1.1"` and rejects `"2.0"`).

## Key order

The order of properties in the schema is the canonical key order used when a
document is written out (G15b). Top level: `otf_version, metadata, timing,
tracks, notation`, then `annotations, reading_list, x_source`. Note:
`s f dur tie tech fx grace finger lh`.

Every object is closed (unknown keys are errors) except `x_source`, which is
free-form provenance. Keys starting with `_` are runtime view caches
(`_partFile`, `_tsChanges`, ...) and are never valid in a file.

## Fields

**Top level**

| Field | Meaning |
|---|---|
| `otf_version` | `"1.x"`, see above |
| `metadata` | `title`, `time_signature` (`"4/4"`), `tempo` (quarter-note BPM) required; `key`, `composer`, `tab_by` (1.1), `time_signature_changes` optional |
| `timing.ticks_per_beat` | ticks in a quarter note; 480 in every file so far |
| `tracks` | the instruments, see below |
| `notation` | `{trackId: [measure, ...]}`: every key names a track; a track may have no key (an empty track) |
| `annotations` | `[{measure, tick, text}]` placed text: section banners, chord names, remarks |
| `reading_list` | `[{from_measure, to_measure, name?}]` playback order, with repeats unrolled |
| `x_source` | free-form provenance (`type`, `source_id`, `author`, `url`, `converted_at`, ...) |

**`metadata.tab_by`** (1.1) is who wrote this tab: `{"name": ..., "url": ...}`, a
closed object. `name` is required, non-empty, already trimmed, at most 100
characters. `url` is optional, must start with `http://` or `https://`, at most
500 characters (say, their Banjo Hangout profile). It is not the song's
`composer`. The editor's "Tab by" / "Link" fields write it; on submission the
pipeline copies it to `provenance.author` / `provenance.author_url` in
`work.yaml` (anyone may fill a blank credit; changing one needs a trusted
submitter, and a refused change is written back into the stored file so the two
never disagree).

**`metadata.time_signature_changes`** is `[{measure, time_signature}]`. Each
entry applies **only to its own measure**; every other measure follows
`metadata.time_signature`. A measure of `n/d` is `ticks_per_beat * 4 * n / d`
ticks long.

**Track**: `id` (also the display name, and the key into `notation`),
`instrument` (free text), `tuning` (open strings, string 1 first, e.g.
`["D4","B3","G3","D3","G4"]`), optional `capo` (0 = none) and `role`
(`lead`, `rhythm`, `percussion`; a hint, not an ordering; the editor turns a legacy `backup` into `rhythm` on load). A percussion track
has `percussion: true` and `lines` (its line count) instead of a tuning
(`tuning: []`); the two go together, and `lines` is its string count.

**Measure**: `{measure, events}`; **event**: `{tick, notes}` where `tick` is the
offset from the start of the measure. Measures need not start at 1 and may be
partial (a pickup measure just has its events late in the bar).

**Note** (a string and a fret, plus optional articulation):

| Key | Values | Meaning |
|---|---|---|
| `s` | integer >= 1 | string, 1 = first tuning entry |
| `f` | integer 0-24 | fret, 0 = open |
| `dur` | integer >= 1 | duration in ticks (`whole` 1920, `quarter` 480, `eighth` 240, ...) |
| `tie` | boolean | tied from the previous note on this string |
| `tech` | `h p / \ x b` | hammer-on, pull-off, slide up, slide down, dead note, bend target |
| `fx` | list of effects | a set, kept in canonical order: `brush roll choke ghost staccato let-ring muted harmonic artificial-harmonic tap vibrato tremolo bend-release slap` |
| `grace` | `{f, kind?}` | grace note on the same string just before this one (no tick of its own); `kind` is `hp slide bend mordent double gruppetto trill`, absent = plain |
| `finger` | `T I M R P` | picking hand |
| `lh` | 0-4 | fretting hand (0 is a real value; clearing = absent) |

`brush` is a strummed chord (every note of the chord carries it); `roll` an
arpeggiated one. `choke` is TablEdit's Choke effect; it differs from
`tech: "b"`, the bend target. `muted` is a pitched, damped note (palm mute);
`tech: "x"` is the dead note. `let-ring` is TablEdit's "Ringing note".
`fx` and `grace` are TablEdit's own note model.

## Rules a schema cannot say

Enforced by both validators, on a document that already passes the schema.
Messages carry the rule id in brackets.

| Rule id | Meaning |
|---|---|
| `string_count` | a note's `s` is at most its track's string count (`tuning` length; `lines` for percussion) |
| `notation_keys` | every `notation` key names a track id (a track may have no key: an empty track) |
| `track_ids` | track ids are unique |
| `measure_order` | measure numbers are unique and ascending per track |
| `tick_order` | event ticks are unique and ascending within a measure |
| `tick_range` | every tick is inside the measure's length (from the time signature and its changes) |
| `duplicate_string` | at most one note per string per event |

One rule is a **warning**, not an error: `reading_list_overrun` (a
`reading_list` range that runs past the last written measure, #263).
Python returns warnings from `otf_schema.check`; JS returns them as
`validateOTF(...).warnings`.

## Example

```json
{
  "otf_version": "1.1",
  "metadata": {
    "title": "Old Joe Clark", "time_signature": "4/4", "tempo": 120, "key": "A",
    "tab_by": {"name": "Jane Picker", "url": "https://www.banjohangout.org/my/janepicker"}
  },
  "timing": {"ticks_per_beat": 480},
  "tracks": [
    {
      "id": "banjo",
      "instrument": "5-string-banjo",
      "tuning": ["E4", "C#4", "A3", "E3", "A4"],
      "capo": 2,
      "role": "lead"
    }
  ],
  "notation": {
    "banjo": [
      {
        "measure": 1,
        "events": [
          {"tick": 1680, "notes": [{"s": 2, "f": 2, "dur": 120}]},
          {"tick": 1800, "notes": [{"s": 1, "f": 0, "dur": 120}, {"s": 2, "f": 3, "dur": 120, "tech": "h"}]}
        ]
      },
      {
        "measure": 2,
        "events": [
          {"tick": 0, "notes": [{"s": 5, "f": 0, "dur": 480, "fx": ["let-ring"], "finger": "T"}]}
        ]
      }
    ]
  },
  "annotations": [{"measure": 1, "tick": 0, "text": "A part"}],
  "reading_list": [{"from_measure": 1, "to_measure": 2, "name": "A part"}]
}
```

## File layout

Every file is written the same way, by `scripts/lib/otf_format.py` (Python) and
`docs/js/otf-format.js` (JS), which produce identical bytes: UTF-8 with non-ASCII
left as is, 2-space indent, `": "` after keys, one trailing newline. Keys go in
the order of the properties in `otf.schema.json`; keys the schema doesn't name
(only inside `x_source`) keep their order after the known ones; keys starting
with `_` are dropped. One line each for an event, an annotation, a `reading_list`
entry, a `time_signature_changes` entry, and any array of plain values (`tuning`,
`fx`); an empty array is `[]`. Numbers are integers (`120`, never `120.0`).
`scripts/lib/reformat_otf.py` rewrites every tracked `.otf.json` into this layout,
and `tests/test_otf_format.py` fails if one is not. The compact forms in
`serializeForSubmission`, `take.content` and IndexedDB drafts are wire formats,
not files, and are left alone.

## Changing the format

1. Edit `otf.schema.json` (and bump the version per the rule above).
2. Update `otf_schema.py` / `otf-validate.js` if a cross-field rule changes.
3. Add a conformance fixture under `tests/fixtures/otf/{valid,invalid}/`
   (`schema--<what>`, `cross--<rule>[--variant]`, `warn--<rule>`).
4. The enum fences (`tests/test_otf_schema.py`,
   `docs/js/__tests__/otf-editor/otf-validate.test.js`) fail until every copy of
   an allowed-value list (`FX_ORDER`, `GRACE_KINDS`, fingerings, `TECHS`, ...)
   equals the schema's.
5. A new property also goes in `KEY_ORDER` in `docs/js/otf-format.js` (a test checks
   it against the schema), and `uv run python scripts/lib/reformat_otf.py` fixes
   any file the new order moves.
