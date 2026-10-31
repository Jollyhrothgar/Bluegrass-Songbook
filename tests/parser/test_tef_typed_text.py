"""Typed fingering becomes `finger`, chord names become kind "chord" (G21b, G21d).

assign_text_roles(doc, rows) runs at the end of tef_to_otf; `rows[i]` is the
1-based string, on the text's own track, of doc.annotations[i] (None when the
text sits on no track). Corpus proof: test_tef_typed_fingering_fmb.py.

JS counterpart: docs/js/__tests__/tef-import-typed-text.test.js
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser.otf import (  # noqa: E402
    OTFAnnotation, OTFDocument, OTFEvent, OTFMeasure, OTFNote, assign_text_roles)


def doc_with(notes_at_tick_0, texts):
    """One banjo measure with the given notes at tick 0 (and a lone one at 240)."""
    doc = OTFDocument()
    doc.notation["banjo"] = [OTFMeasure(1, [
        OTFEvent(0, list(notes_at_tick_0)), OTFEvent(240, [OTFNote(s=2, f=3)])])]
    doc.annotations = [OTFAnnotation(measure=m, tick=t, text=x, track=track, place=place)
                       for (m, t, x, track, place) in texts]
    return doc


def run(doc, rows=None):
    assign_text_roles(doc, rows or [None] * len(doc.annotations))
    return doc


def test_a_letter_on_a_note_becomes_its_finger_and_leaves_the_annotations():
    doc = run(doc_with([OTFNote(s=5, f=0)], [(1, 0, "m", "banjo", "below")]), [5])
    assert doc.notation["banjo"][0].events[0].notes[0].finger == "M"
    assert doc.annotations == []


@pytest.mark.parametrize("typed,finger", [("t", "T"), ("I", "I"), (" m ", "M"), ("R", "R"), ("p", "P")])
def test_any_case_and_padding(typed, finger):
    doc = run(doc_with([OTFNote(s=1, f=0)], [(1, 0, typed, "banjo", None)]), [1])
    assert doc.notation["banjo"][0].events[0].notes[0].finger == finger


@pytest.mark.parametrize("typed", ["mi", "x", "a", "", "m."])
def test_only_the_five_letters_count(typed):
    doc = run(doc_with([OTFNote(s=1, f=0)], [(1, 0, typed, "banjo", None)]), [1])
    assert doc.notation["banjo"][0].events[0].notes[0].finger is None
    assert [a.text for a in doc.annotations] == [typed]


def test_a_letter_with_no_track_stays_text():
    doc = run(doc_with([OTFNote(s=1, f=0)], [(1, 0, "m", None, None)]), [None])
    assert doc.notation["banjo"][0].events[0].notes[0].finger is None
    assert len(doc.annotations) == 1


def test_no_note_at_that_tick_keeps_the_text_with_its_track_and_place():
    doc = run(doc_with([OTFNote(s=1, f=0)], [(1, 120, "i", "banjo", "below"),
                                             (2, 0, "i", "banjo", "below")]), [1, 1])
    assert [(a.measure, a.tick, a.text, a.track, a.place) for a in doc.annotations] == [
        (1, 120, "i", "banjo", "below"), (2, 0, "i", "banjo", "below")]


def test_a_letter_on_another_tracks_note_does_not_match():
    doc = run(doc_with([OTFNote(s=1, f=0)], [(1, 0, "m", "bass", None)]), [1])
    assert len(doc.annotations) == 1


def test_several_notes_the_letter_goes_on_the_note_on_its_string_row():
    chord = [OTFNote(s=1, f=0), OTFNote(s=3, f=0), OTFNote(s=5, f=0)]
    doc = run(doc_with(chord, [(1, 0, "i", "banjo", "below")]), [3])
    assert [n.finger for n in doc.notation["banjo"][0].events[0].notes] == [None, "I", None]
    assert doc.annotations == []


def test_several_notes_and_none_on_the_row_stays_text():
    chord = [OTFNote(s=1, f=0), OTFNote(s=3, f=0)]
    doc = run(doc_with(chord, [(1, 0, "i", "banjo", "below")]), [2])
    assert [n.finger for n in doc.notation["banjo"][0].events[0].notes] == [None, None]
    assert len(doc.annotations) == 1


def test_a_single_note_takes_the_letter_wherever_the_text_sits():
    doc = run(doc_with([OTFNote(s=4, f=0)], [(1, 0, "t", "banjo", "below")]), [1])
    assert doc.notation["banjo"][0].events[0].notes[0].finger == "T"


def test_a_note_that_has_a_finger_keeps_it_and_the_text_stays_text():
    doc = run(doc_with([OTFNote(s=4, f=0, finger="T")], [(1, 0, "m", "banjo", "below")]), [4])
    assert doc.notation["banjo"][0].events[0].notes[0].finger == "T"
    assert [a.text for a in doc.annotations] == ["m"]


def test_two_letters_on_one_note_the_first_wins_the_second_stays_text():
    doc = run(doc_with([OTFNote(s=4, f=0)], [(1, 0, "m", "banjo", None), (1, 0, "i", "banjo", None)]), [4, 4])
    assert doc.notation["banjo"][0].events[0].notes[0].finger == "M"
    assert [a.text for a in doc.annotations] == ["i"]


def test_chord_text_gets_kind_chord_and_other_text_gets_none():
    doc = run(doc_with([OTFNote(s=1, f=0)], [
        (1, 0, "G", "banjo", None), (1, 0, "em", "banjo", None), (1, 0, "A (G)", "banjo", None),
        (1, 0, "(D)", "banjo", None), (1, 0, "D/F#", "banjo", None),
        (1, 0, "Part A", "banjo", None), (1, 0, "etc.", "banjo", None), (1, 0, "A1", "banjo", None)]))
    assert [(a.text, a.kind) for a in doc.annotations] == [
        ("G", "chord"), ("em", "chord"), ("A (G)", "chord"), ("(D)", "chord"), ("D/F#", "chord"),
        ("Part A", None), ("etc.", None), ("A1", None)]


def test_a_letter_that_stays_text_is_not_a_chord():
    doc = run(doc_with([], [(1, 0, "m", "banjo", None), (1, 0, "i", "banjo", None)]))
    assert [(a.text, a.kind) for a in doc.annotations] == [("m", None), ("i", None)]


def test_to_dict_puts_kind_between_track_and_place_and_omits_it_for_text():
    doc = run(doc_with([OTFNote(s=1, f=0)], [(1, 0, "G", "banjo", "below"), (1, 0, "Hi", "banjo", None)]))
    out = doc.to_dict()["annotations"]
    assert list(out[0]) == ["measure", "tick", "text", "track", "kind", "place"]
    assert "kind" not in out[1]
