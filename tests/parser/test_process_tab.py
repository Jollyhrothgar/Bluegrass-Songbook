"""Tests for scripts/lib/process_tab.py — PR-flow finalization: the
edge function commits the OTF file to a branch; this script validates
it and writes work.yaml provenance on the same branch."""

import json
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scripts' / 'lib'))

from process_tab import (  # noqa: E402
    validate_otf, process_changed, extract_field,
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


PR_BODY = """## Tab Correction

**Work ID:** gold-rush
**Title:** Gold Rush
**Instrument:** banjo
**Submitted by:** Picker Joe

### Changes Made
Fixed measure 3.
"""


class TestValidation:
    def test_accepts_good_otf(self):
        assert validate_otf(make_otf()) == []

    def test_rejects_structural_problems(self):
        assert validate_otf({'tracks': []})
        bad = make_otf()
        bad['notation']['banjo'][0]['events'][0]['notes'][0]['s'] = 9
        assert any('bad string' in p for p in validate_otf(bad))
        bad2 = make_otf()
        bad2['notation']['banjo'][0]['events'][0]['notes'][0]['f'] = 99
        assert any('bad fret' in p for p in validate_otf(bad2))


class TestParsing:
    def test_extract_field(self):
        assert extract_field(PR_BODY, 'Work ID') == 'gold-rush'
        assert extract_field(PR_BODY, 'Submitted by') == 'Picker Joe'
        assert extract_field(PR_BODY, 'Nope') is None


class TestFinalize:
    def _correction_setup(self, tmp_path, otf):
        works = tmp_path / 'works'
        wd = works / 'gold-rush'
        wd.mkdir(parents=True)
        (wd / 'work.yaml').write_text(yaml.dump({
            'id': 'gold-rush', 'title': 'Gold Rush',
            'parts': [{'type': 'tablature', 'instrument': 'banjo',
                       'format': 'otf', 'file': 'banjo.otf.json',
                       'provenance': {'source': 'banjo-hangout'}}],
        }))
        (wd / 'banjo.otf.json').write_text(json.dumps(otf))
        return works, wd

    def test_correction_records_provenance_on_existing_work(self, tmp_path):
        works, wd = self._correction_setup(tmp_path, make_otf('Gold Rush'))
        out = process_changed(['works/gold-rush/banjo.otf.json'],
                              PR_BODY, '77', 'mikegh', works_dir=works)
        assert out == [wd]
        work = yaml.safe_load((wd / 'work.yaml').read_text())
        prov = work['parts'][0]['provenance']
        assert prov['source'] == 'banjo-hangout'           # original kept
        assert prov['x_corrected_by'] == 'github:mikegh'
        assert prov['x_correction_pr'] == 77
        assert prov['x_corrected_attribution'] == 'Picker Joe'

    def test_submission_creates_work_yaml(self, tmp_path):
        works = tmp_path / 'works'
        wd = works / 'test-tune'
        wd.mkdir(parents=True)
        (wd / 'banjo.otf.json').write_text(json.dumps(make_otf()))
        body = "**Title:** Test Tune\n**Submitted by:** Someone Nice\n"
        out = process_changed(['works/test-tune/banjo.otf.json'],
                              body, '78', 'anon', works_dir=works)
        work = yaml.safe_load((out[0] / 'work.yaml').read_text())
        assert work['title'] == 'Test Tune'
        assert work['parts'][0]['provenance']['source'] == 'user-submission'
        assert work['parts'][0]['provenance']['author'] == 'Someone Nice'
        assert work['parts'][0]['provenance']['submission_pr'] == 78

    def test_invalid_otf_refused(self, tmp_path):
        bad = make_otf()
        bad['notation']['banjo'][0]['events'][0]['notes'][0]['f'] = 99
        works, _ = self._correction_setup(tmp_path, bad)
        with pytest.raises(SystemExit):
            process_changed(['works/gold-rush/banjo.otf.json'],
                            PR_BODY, '1', 'x', works_dir=works)

    def test_paths_outside_works_refused(self, tmp_path):
        with pytest.raises(SystemExit):
            process_changed(['docs/data/tabs/x.otf.json'], PR_BODY, '1', 'x',
                            works_dir=tmp_path / 'works')
        with pytest.raises(SystemExit):
            process_changed(['works/../etc/passwd.otf.json'], PR_BODY, '1', 'x',
                            works_dir=tmp_path / 'works')

    def test_no_tab_files_refused(self, tmp_path):
        with pytest.raises(SystemExit):
            process_changed(['README.md', ''], PR_BODY, '1', 'x',
                            works_dir=tmp_path / 'works')
