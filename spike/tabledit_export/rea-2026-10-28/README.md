# TablEdit reverse-engineering scripts, 2026-10-28

Throwaway analysis scripts from decoding the last TEF byte layouts for G15
(chord diagrams, bends, dynamics, reading guides). The findings live in
issue #318 and `docs/plans/2026-10-28-g15-checklist.md`; these are kept so
the numbers there can be re-derived. The Ghidra decompiles they were checked
against are not in this public repo (`~/workspace/TablEdit_Reverse/rea-2026-10-28/`
on Mike's Mac).

- `tefmarks.py` — V2/V3 component loaders + reading-guide (0xb7) census
- `derive.py` — port of TablEdit's "Create reading list from inserted symbols"
- `cmp_v2.py`, `cmp_v3.py`, `expand.py`, `dumpm.py` — compare derived vs stored reading lists
- `chords.py`, `validate.py`, `validate2.py` — chord-diagram records vs chord names
- `bends.py`, `dyn.py`, `midi_check.py` — bends and dynamics vs TablEdit's Rich-MIDI export
- `survey.py`, `survey2.py`, `variants.py`, `compat.py` — corpus surveys

GUI harnesses one level up: `../ax_midi.sh` (Rich-MIDI export), `../ax_xml.sh`
(MusicXML export). Both drive TablEdit on this Mac and need Accessibility.
