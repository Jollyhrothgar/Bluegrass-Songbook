"""Tests for coverage_report.py — title normalization and dimension classification."""

import json

import yaml

from coverage_report import (
    DIMENSIONS,
    classify_work,
    dedupe_tune_list,
    normalize_title,
    scan_works,
)


class TestNormalizeTitle:

    def test_lowercases(self):
        assert normalize_title('Cripple Creek') == 'cripple creek'

    def test_strips_punctuation_and_apostrophes(self):
        assert normalize_title("Bonaparte's Retreat!") == 'bonapartes retreat'

    def test_collapses_whitespace(self):
        assert normalize_title('Old   Joe   Clark') == 'old joe clark'

    def test_drops_leading_the(self):
        assert normalize_title('The Big One') == 'big one'

    def test_drops_leading_a(self):
        assert normalize_title('A Brand New Broken Heart') == 'brand new broken heart'

    def test_drops_leading_an(self):
        assert normalize_title('An Old Song') == 'old song'

    def test_no_leading_article_unchanged(self):
        assert normalize_title('Jerusalem Ridge') == 'jerusalem ridge'

    def test_the_and_bare_title_match(self):
        # "The Big One" and "Big One" should normalize to the same key
        assert normalize_title('The Big One') == normalize_title('Big One')


class TestDedupeTuneList:

    def test_removes_exact_duplicates(self):
        result = dedupe_tune_list(['Wheel Hoss', 'Old Joe Clark', 'Wheel Hoss'])
        assert result == ['Wheel Hoss', 'Old Joe Clark']

    def test_removes_normalized_duplicates(self):
        result = dedupe_tune_list(['The Big One', 'A Big One'])
        assert result == ['The Big One']

    def test_preserves_order_of_first_occurrence(self):
        result = dedupe_tune_list(['B', 'A', 'B', 'C'])
        assert result == ['B', 'A', 'C']


def make_work(tmp_path, work_id, work_data, files=None):
    """Create a synthetic work directory under tmp_path/works/{work_id}/."""
    works_dir = tmp_path / 'works'
    work_dir = works_dir / work_id
    work_dir.mkdir(parents=True, exist_ok=True)
    work_data = {'id': work_id, **work_data}
    (work_dir / 'work.yaml').write_text(yaml.dump(work_data))
    for filename, content in (files or {}).items():
        path = work_dir / filename
        if isinstance(content, (dict, list)):
            path.write_text(json.dumps(content))
        else:
            path.write_text(content)
    return works_dir, work_dir, work_data


class TestClassifyWork:

    def test_chords_and_lyrics_detected(self, tmp_path):
        pro = "{meta: title Test}\n[G]Hello there [C]my friend\n"
        _, work_dir, work = make_work(
            tmp_path, 'test-song',
            {'title': 'Test Song', 'parts': [
                {'type': 'lead-sheet', 'format': 'chordpro', 'file': 'lead-sheet.pro'},
            ]},
            files={'lead-sheet.pro': pro},
        )
        dims = classify_work(work_dir, work)
        assert dims['chords'] == 1
        assert dims['lyrics'] == 1
        assert all(dims[d] == 0 for d in DIMENSIONS if d not in ('chords', 'lyrics'))

    def test_directive_only_lines_are_not_lyrics(self, tmp_path):
        pro = "{meta: title Instrumental}\n{start_of_verse}\n{end_of_verse}\n"
        _, work_dir, work = make_work(
            tmp_path, 'instr-song',
            {'title': 'Instrumental Song', 'parts': [
                {'type': 'lead-sheet', 'format': 'chordpro', 'file': 'lead-sheet.pro'},
            ]},
            files={'lead-sheet.pro': pro},
        )
        dims = classify_work(work_dir, work)
        assert dims['chords'] == 0
        assert dims['lyrics'] == 0

    def test_abc_block_excluded_from_lyrics_and_chords(self, tmp_path):
        pro = "{start_of_abc}\nX:1\nK:G\nGABc [dcBA]\n{end_of_abc}\n"
        _, work_dir, work = make_work(
            tmp_path, 'abc-embed',
            {'title': 'Embedded ABC', 'parts': [
                {'type': 'lead-sheet', 'format': 'chordpro', 'file': 'lead-sheet.pro'},
            ]},
            files={'lead-sheet.pro': pro},
        )
        dims = classify_work(work_dir, work)
        assert dims['chords'] == 0
        assert dims['lyrics'] == 0

    def test_lead_sheet_fallback_without_explicit_part(self, tmp_path):
        """A work with no `parts` list but a lead-sheet.pro on disk still counts,
        matching build_works_index.py's tolerant lead-sheet detection."""
        pro = "[D]Some lyric line here\n"
        _, work_dir, work = make_work(
            tmp_path, 'no-parts-song',
            {'title': 'No Parts Song', 'parts': []},
            files={'lead-sheet.pro': pro},
        )
        dims = classify_work(work_dir, work)
        assert dims['chords'] == 1
        assert dims['lyrics'] == 1

    def test_direct_tablature_instrument(self, tmp_path):
        _, work_dir, work = make_work(
            tmp_path, 'banjo-tab-song',
            {'title': 'Banjo Tab Song', 'parts': [
                {'type': 'tablature', 'format': 'otf', 'file': 'banjo.otf.json',
                 'instrument': 'banjo'},
            ]},
            files={'banjo.otf.json': {'tracks': []}},
        )
        dims = classify_work(work_dir, work)
        assert dims['tab-banjo'] == 1
        assert dims['tab-guitar'] == 0

    def test_ensemble_maps_multiple_instruments(self, tmp_path):
        otf = {
            'tracks': [
                {'id': 'guitar', 'instrument': '6-string-guitar'},
                {'id': 'bass', 'instrument': 'upright-bass'},
                {'id': 'mandolin', 'instrument': 'mandolin'},
                {'id': 'banjo', 'instrument': '5-string-banjo'},
            ]
        }
        _, work_dir, work = make_work(
            tmp_path, 'ensemble-song',
            {'title': 'Ensemble Song', 'parts': [
                {'type': 'tablature', 'format': 'otf', 'file': 'ensemble.otf.json',
                 'instrument': 'ensemble'},
            ]},
            files={'ensemble.otf.json': otf},
        )
        dims = classify_work(work_dir, work)
        assert dims['tab-guitar'] == 1
        assert dims['tab-bass'] == 1
        assert dims['tab-mandolin'] == 1
        assert dims['tab-banjo'] == 1
        assert dims['tab-dobro'] == 0
        assert dims['tab-fiddle'] == 0

    def test_unknown_instrument_skipped_without_crashing(self, tmp_path):
        _, work_dir, work = make_work(
            tmp_path, 'tenor-banjo-song',
            {'title': 'Tenor Banjo Song', 'parts': [
                {'type': 'tablature', 'format': 'otf', 'file': 'tenor-banjo.otf.json',
                 'instrument': 'tenor-banjo'},
            ]},
            files={'tenor-banjo.otf.json': {'tracks': []}},
        )
        dims = classify_work(work_dir, work)
        assert all(dims[d] == 0 for d in DIMENSIONS)

    def test_abc_notation_part(self, tmp_path):
        _, work_dir, work = make_work(
            tmp_path, 'abc-song',
            {'title': 'ABC Song', 'parts': [
                {'type': 'abc-notation', 'format': 'abc', 'file': 'melody.abc'},
            ]},
        )
        dims = classify_work(work_dir, work)
        assert dims['abc'] == 1

    def test_placeholder_with_no_parts_has_no_coverage(self, tmp_path):
        _, work_dir, work = make_work(
            tmp_path, 'placeholder-song',
            {'title': 'Placeholder Song', 'status': 'placeholder', 'parts': []},
        )
        dims = classify_work(work_dir, work)
        assert all(dims[d] == 0 for d in DIMENSIONS)


class TestScanWorks:

    def test_scans_multiple_work_directories(self, tmp_path):
        works_dir, _, _ = make_work(
            tmp_path, 'song-one',
            {'title': 'Song One', 'parts': [
                {'type': 'lead-sheet', 'format': 'chordpro', 'file': 'lead-sheet.pro'},
            ]},
            files={'lead-sheet.pro': '[G]Some lyric\n'},
        )
        make_work(
            tmp_path, 'song-two',
            {'title': 'Song Two', 'parts': []},
        )
        rows = scan_works(works_dir)
        by_id = {r['id']: r for r in rows}
        assert set(by_id) == {'song-one', 'song-two'}
        assert by_id['song-one']['chords'] == 1
        assert by_id['song-two']['chords'] == 0
