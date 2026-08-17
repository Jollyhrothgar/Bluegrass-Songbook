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
    def catalogue_ids(self):
        path = REPO_ROOT / 'docs' / 'data' / 'bluegrass_catalogue.json'
        if not path.exists():
            pytest.skip('catalogue not built')
        return {r['catalogue_id'] for r in json.loads(path.read_text())['songs']}

    def test_every_covered_entry_names_catalogue_ids(self, ledger):
        # Title-keyed verdicts were tried and detached wholesale when the
        # catalogue folded Strum Machine arrangement suffixes away.
        missing = [k for k, v in ledger['covered'].items() if not v.get('catalogue_ids')]
        assert not missing, f"covered entries without `catalogue_ids`: {missing}"

    def test_covered_ids_exist_in_the_catalogue(self, ledger, catalogue_ids):
        detached = [i for v in ledger['covered'].values()
                    for i in v['catalogue_ids'] if i not in catalogue_ids]
        assert not detached, f"verdicts pointing at absent catalogue rows: {detached}"

    def test_no_catalogue_id_claimed_twice(self, ledger):
        seen, dupes = set(), []
        for key, v in ledger['covered'].items():
            for i in v['catalogue_ids']:
                if i in seen:
                    dupes.append((key, i))
                seen.add(i)
        assert not dupes, f"catalogue ids claimed by two verdicts: {dupes}"

    def test_junk_entries_are_not_also_covered(self, ledger):
        junk = {e.get('catalogue_id') for e in ledger['not_a_song'].values()} - {None}
        covered = {i for v in ledger['covered'].values() for i in v['catalogue_ids']}
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
    def test_emits_expected_shape(self, tmp_path, monkeypatch):
        # Once build_wanted.py subtracts upstream, the committed board carries
        # no covered rows at all — the render-time filter is a pure safety net
        # that finds nothing. Drive the shape from a synthetic board instead,
        # so this still tests the join rather than the current corpus state.
        ledger = yaml.safe_load((REPO_ROOT / 'curation' / 'bounty_decisions.yaml').read_text())
        cid = next(iter(ledger['covered'].values()))['catalogue_ids'][0]
        work = next(v['work'] for v in ledger['covered'].values()
                    if v['catalogue_ids'][0] == cid)

        wanted = tmp_path / 'wanted.json'
        wanted.write_text(json.dumps({'songs': [
            {'catalogue_id': cid, 'title': 'Synthetic Row', 'type': 'Vocal'},
            {'catalogue_id': 'flatbush-waltz', 'title': 'Flatbush Waltz', 'type': 'Vocal'},
        ]}))
        monkeypatch.setattr(bd, 'WANTED_FILE', wanted)
        (tmp_path / 'index.jsonl').write_text(
            json.dumps({'id': work, 'chord_count': 4}) + '\n')

        payload = bd.build_bounty_decisions(tmp_path, quiet=True)

        assert 'covered' in payload and 'not_a_song' in payload and 'types' in payload
        # Joined on catalogue_id; chord count comes from the fresh index.
        assert payload['covered']['Synthetic Row']['work'] == work
        assert payload['covered']['Synthetic Row']['chords'] == 4
        # Type correction still reaches rows the catalogue mistyped.
        assert payload['types']['Flatbush Waltz'] == 'Instrumental'
        assert (tmp_path / 'bounty_decisions.json').exists()

    def test_is_byte_stable(self, tmp_path, monkeypatch):
        # Supplies its own wanted list rather than reading the committed one:
        # that file is generated during the index build, and CI runs the test
        # suite BEFORE the build, so in a fresh checkout it does not exist yet.
        wanted = tmp_path / 'wanted.json'
        wanted.write_text(json.dumps({'songs': [
            {'catalogue_id': 'flatbush-waltz', 'title': 'Flatbush Waltz', 'type': 'Vocal'},
        ]}))
        monkeypatch.setattr(bd, 'WANTED_FILE', wanted)
        (tmp_path / 'index.jsonl').write_text('')

        bd.build_bounty_decisions(tmp_path, quiet=True)
        first = (tmp_path / 'bounty_decisions.json').read_bytes()
        bd.build_bounty_decisions(tmp_path, quiet=True)
        assert (tmp_path / 'bounty_decisions.json').read_bytes() == first

    def test_missing_ledger_is_not_an_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(bd, 'LEDGER_FILE', tmp_path / 'nope.yaml')
        assert bd.build_bounty_decisions(tmp_path, quiet=True) == {}
