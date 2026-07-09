"""Tests for scripts/lib/process_tab.py — the tab twin of the song
correction pipeline (GitHub issue → works/)."""

import json
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts' / 'lib'))

from process_tab import (  # noqa: E402
    extract_otf, validate_otf, process, slugify,
)


def make_otf(title='Test Tune'):
    return {
        'otf_version': '1.0',
        'metadata': {'title': title, 'time_signature': '4/4', 'tempo': 120},
        'timing': {'ticks_per_beat': 480},
        'tracks': [{'id': 'banjo', 'instrument': '5-string-banjo',
                    'tuning': ['D4', 'B3', 'G3', 'D3', 'G4']}],
        'notation': {'banjo': [
            {'measure': 1, 'events': [{'tick': 0, 'notes': [{'s': 3, 'f': 2, 'dur': 240}]}]},
        ]},
    }


def correction_body(otf, work_id='gold-rush'):
    return f"""## Tab Correction

**Work ID:** {work_id}
**Title:** Gold Rush
**Instrument:** banjo
**Submitted by:** Picker Joe

### Changes Made
Fixed measure 3.

### Updated OTF Content

```json
{json.dumps(otf, separators=(',', ':'))}
```
"""


def submission_body(otf):
    return f"""## Tab Submission

**Title:** Test Tune
**Instrument:** banjo
**Submitted by:** Picker Joe

### OTF Content

```json
{json.dumps(otf, separators=(',', ':'))}
```
"""


class TestParsing:
    def test_extracts_otf_json(self):
        otf = make_otf()
        assert extract_otf(correction_body(otf)) == otf

    def test_rejects_bad_json(self):
        assert extract_otf('```json\n{nope\n```') is None
        assert extract_otf('no block at all') is None


class TestValidation:
    def test_accepts_good_otf(self):
        assert validate_otf(make_otf()) == []

    def test_rejects_structural_problems(self):
        assert validate_otf({'tracks': []})
        bad = make_otf()
        bad['notation']['banjo'][0]['events'][0]['notes'][0]['s'] = 9  # off the neck
        assert any('bad string' in p for p in validate_otf(bad))
        bad2 = make_otf()
        bad2['notation']['banjo'][0]['events'][0]['notes'][0]['f'] = 99
        assert any('bad fret' in p for p in validate_otf(bad2))


class TestApply:
    def test_correction_replaces_otf_and_records_provenance(self, tmp_path):
        works = tmp_path / 'works'
        wd = works / 'gold-rush'
        wd.mkdir(parents=True)
        (wd / 'work.yaml').write_text(yaml.dump({
            'id': 'gold-rush', 'title': 'Gold Rush',
            'parts': [{'type': 'tablature', 'instrument': 'banjo',
                       'format': 'otf', 'file': 'banjo.otf.json',
                       'provenance': {'source': 'banjo-hangout'}}],
        }))
        (wd / 'banjo.otf.json').write_text('{"old": true}')

        otf = make_otf('Gold Rush')
        out = process(correction_body(otf), '123', 'mikegh', works_dir=works)
        assert out == wd
        assert json.loads((wd / 'banjo.otf.json').read_text())['metadata']['title'] == 'Gold Rush'
        work = yaml.safe_load((wd / 'work.yaml').read_text())
        prov = work['parts'][0]['provenance']
        assert prov['source'] == 'banjo-hangout'          # original kept
        assert prov['x_corrected_by'] == 'github:mikegh'
        assert prov['x_correction_issue'] == 123
        assert prov['x_corrected_attribution'] == 'Picker Joe'

    def test_correction_to_missing_work_fails(self, tmp_path):
        with pytest.raises(SystemExit):
            process(correction_body(make_otf(), work_id='no-such-work'),
                    '1', 'x', works_dir=tmp_path / 'works')

    def test_hostile_work_id_rejected(self, tmp_path):
        body = correction_body(make_otf(), work_id='../../etc')
        with pytest.raises(SystemExit):
            process(body, '1', 'x', works_dir=tmp_path / 'works')

    def test_submission_creates_a_new_work(self, tmp_path):
        works = tmp_path / 'works'
        works.mkdir()
        out = process(submission_body(make_otf()), '55', 'someone', works_dir=works)
        assert out.name == 'test-tune'
        work = yaml.safe_load((out / 'work.yaml').read_text())
        assert work['title'] == 'Test Tune'
        assert work['parts'][0]['provenance']['source'] == 'user-submission'
        assert work['parts'][0]['provenance']['author'] == 'Picker Joe'
        assert work['parts'][0]['provenance']['submission_issue'] == 55
        assert json.loads((out / 'banjo.otf.json').read_text())['tracks'][0]['id'] == 'banjo'

    def test_submission_slug_conflicts_get_suffixed(self, tmp_path):
        works = tmp_path / 'works'
        (works / 'test-tune').mkdir(parents=True)
        out = process(submission_body(make_otf()), '56', 'x', works_dir=works)
        assert out.name == 'test-tune-1'

    def test_invalid_otf_refused(self, tmp_path):
        bad = make_otf()
        bad['tracks'] = []
        with pytest.raises(SystemExit):
            process(submission_body(bad), '1', 'x', works_dir=tmp_path / 'works')


def test_slugify():
    assert slugify("Bill Cheatham's Reel!") == 'bill-cheatham-s-reel'
    assert slugify('   ') == 'untitled'
