"""Tests for the bounty adjudication ledger emitter."""

import json
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts' / 'lib'))

import bounty_decisions as bd  # noqa: E402

REPO_ROOT = Path(__file__).parent.parent


class TestInferType:
    @pytest.mark.parametrize('title', [
        'Flatbush Waltz', 'Clarinet Polka', 'Blackberry Blossom Reel',
        'Sailors Hornpipe', "Fisher's Hornpipe", 'Soldier\'s Joy Breakdown',
    ])
    def test_promotes_tune_forms_to_instrumental(self, title):
        assert bd.infer_type(title, 'Vocal') == 'Instrumental'

    def test_leaves_real_vocals_alone(self):
        assert bd.infer_type('Blue Moon of Kentucky', 'Vocal') == 'Vocal'

    def test_cannot_catch_instrumentals_that_do_not_name_their_form(self):
        # "Maid Behind the Bar" is an Irish reel, but nothing in the title says
        # so. A title regex reaches only titles that name their tune form;
        # catching the rest needs the ledger tags in Phase 2's catalogue
        # builder. Documented so nobody reads this as full coverage.
        assert bd.infer_type('Maid Behind the Bar', 'Vocal') == 'Vocal'

    def test_never_overrides_an_explicit_type(self):
        # The gap analysis typed these deliberately; only the blanket SM
        # `Vocal` is up for correction.
        assert bd.infer_type('Some Waltz', 'Gospel') == 'Gospel'
        assert bd.infer_type('Some Waltz', 'Fiddle Tune') == 'Fiddle Tune'


class TestLedgerIntegrity:
    """The committed ledger must stay internally consistent."""

    @pytest.fixture(scope='class')
    def ledger(self):
        return yaml.safe_load((REPO_ROOT / 'curation' / 'bounty_decisions.yaml').read_text())

    @pytest.fixture(scope='class')
    def board_titles(self):
        path = REPO_ROOT / 'docs' / 'data' / 'wanted_songs.json'
        return {s['title'] for s in json.loads(path.read_text())['songs']}

    def test_every_covered_entry_pins_titles(self, ledger):
        # Deriving board titles from the key by slug was tried and abandoned —
        # see the comment in bounty_decisions.py. Explicit lists or nothing.
        missing = [k for k, v in ledger['covered'].items() if not v.get('titles')]
        assert not missing, f"covered entries without `titles`: {missing}"

    def test_pinned_titles_are_on_the_board(self, ledger, board_titles):
        detached = [t for v in ledger['covered'].values()
                    for t in v['titles'] if t not in board_titles]
        assert not detached, f"pinned titles no longer on the board: {detached}"

    def test_no_title_claimed_twice(self, ledger):
        seen, dupes = set(), []
        for key, v in ledger['covered'].items():
            for t in v['titles']:
                if t in seen:
                    dupes.append((key, t))
                seen.add(t)
        assert not dupes, f"titles claimed by two verdicts: {dupes}"

    def test_junk_entries_are_not_also_covered(self, ledger):
        junk = {e['title'] for e in ledger['not_a_song'].values()}
        covered = {t for v in ledger['covered'].values() for t in v['titles']}
        # A prefix-matching bug once swallowed the junk entry "Talk" into
        # "talk-about-suffering"; this is the guard against that class.
        assert not (junk & covered)

    def test_every_referenced_work_exists(self, ledger):
        ids = set()
        for name in ('index.jsonl', 'archive.jsonl'):
            path = REPO_ROOT / 'docs' / 'data' / name
            if not path.exists():
                pytest.skip('index not built')
            with open(path) as f:
                ids.update(json.loads(l)['id'] for l in f if l.strip())
        bad = [(k, v['work']) for k, v in ledger['covered'].items() if v['work'] not in ids]
        assert not bad, f"covered verdicts pointing at missing works: {bad}"


class TestBuildOutput:
    def test_emits_expected_shape(self, tmp_path):
        (tmp_path / 'index.jsonl').write_text(
            json.dumps({'id': 'sally-ann', 'chord_count': 0}) + '\n'
            + json.dumps({'id': 'make-me-a-pallet-on-the-floor', 'chord_count': 5}) + '\n'
        )
        payload = bd.build_bounty_decisions(tmp_path, quiet=True)

        assert 'covered' in payload and 'not_a_song' in payload and 'types' in payload
        # Chord counts come from the freshly built index, not the ledger.
        assert payload['covered']['Sally Ann via Tommy Jarrell, mostly 1 & 4']['chords'] == 0
        assert payload['covered']['Pallet on the Floor']['chords'] == 5
        assert (tmp_path / 'bounty_decisions.json').exists()

    def test_is_byte_stable(self, tmp_path):
        (tmp_path / 'index.jsonl').write_text('')
        bd.build_bounty_decisions(tmp_path, quiet=True)
        first = (tmp_path / 'bounty_decisions.json').read_bytes()
        bd.build_bounty_decisions(tmp_path, quiet=True)
        assert (tmp_path / 'bounty_decisions.json').read_bytes() == first

    def test_missing_ledger_is_not_an_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(bd, 'LEDGER_FILE', tmp_path / 'nope.yaml')
        assert bd.build_bounty_decisions(tmp_path, quiet=True) == {}
