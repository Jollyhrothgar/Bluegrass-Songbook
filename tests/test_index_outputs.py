"""The three-part published output of build_works_index.

Decision (Mike, 2026-07-31): the startup payload must be the bluegrass canon
only — phones on cell data were downloading ~49 MB of ChordPro before the
first search. So the builder now emits:

  docs/data/index.jsonl     canon rows (indexed is not False), no song content
  docs/data/archive.jsonl   indexed:false rows, same slim shape, clipped lyrics
  docs/data/songs/{id}.pro  full ChordPro per work, fetched when a page opens

These tests pin that contract: what is IN each file, what is NOT (content /
abc_content never ride along again), that a .pro file is byte-identical to the
old `content` field, that tablature rows carry the OTF track count, and that
repeat builds are byte-stable and prune their own orphans.
"""

import json
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

from build_works_index import (  # noqa: E402
    ARCHIVE_LYRICS_CHARS,
    build_works_index,
    otf_track_count,
    write_outputs,
)


# ---------------------------------------------------------------- helpers

def row(work_id, **kw):
    """A minimal built row as it looks right before write_outputs()."""
    base = {
        'id': work_id,
        'title': str(work_id).replace('-', ' ').title(),
        'source': 'test',
        'first_line': 'first line here',
        'lyrics': 'la ' * 400,          # longer than every clip threshold
        'content': f'{{meta: title {work_id}}}\n[G]la la la\n',
        'key': 'G',
        'mode': 'major',
    }
    base.update(kw)
    return base


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def write_otf(path, tracks=1, source_id=None):
    doc = {
        'metadata': {'title': 'Test Tune'},
        'tracks': [{'id': f't{i}', 'instrument': '5-string-banjo'}
                   for i in range(tracks)],
        'notation': {'t0': [{'measure': 1, 'events': [{'t': 0}]}]},
    }
    if source_id:
        doc['x_source'] = {'type': 'banjo-hangout', 'source_id': str(source_id)}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc))
    return path


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / 'docs' / 'data'
    d.mkdir(parents=True)
    return d


# ------------------------------------------------------- the output split

class TestWriteOutputs:
    def test_index_holds_canon_rows_only(self, data_dir):
        write_outputs([row('canon-song'),
                       row('pruned-song', indexed=False)],
                      data_dir / 'index.jsonl')
        canon = read_jsonl(data_dir / 'index.jsonl')
        archive = read_jsonl(data_dir / 'archive.jsonl')
        assert [r['id'] for r in canon] == ['canon-song']
        assert [r['id'] for r in archive] == ['pruned-song']

    def test_content_never_rides_along(self, data_dir):
        write_outputs([row('a'), row('b', indexed=False)],
                      data_dir / 'index.jsonl')
        for path in ('index.jsonl', 'archive.jsonl'):
            for r in read_jsonl(data_dir / path):
                assert 'content' not in r
                assert 'abc_content' not in r

    def test_has_content_flags_the_lead_sheet(self, data_dir):
        write_outputs([row('with-sheet'),
                       row('tab-only', content='')],
                      data_dir / 'index.jsonl')
        rows = {r['id']: r for r in read_jsonl(data_dir / 'index.jsonl')}
        assert rows['with-sheet']['has_content'] is True
        # Omitted, not false — placeholders and tab-only works have no sheet.
        assert 'has_content' not in rows['tab-only']

    def test_has_abc_flags_an_embedded_abc_block(self, data_dir):
        write_outputs([row('tune', abc_content='X:1\nK:G\n'), row('song')],
                      data_dir / 'index.jsonl')
        rows = {r['id']: r for r in read_jsonl(data_dir / 'index.jsonl')}
        assert rows['tune']['has_abc'] is True
        assert 'has_abc' not in rows['song']

    def test_pro_file_is_the_old_content_field_byte_for_byte(self, data_dir):
        song = row('dark-as-a-dungeon')
        content = song['content']
        write_outputs([song], data_dir / 'index.jsonl')
        published = data_dir / 'songs' / 'dark-as-a-dungeon.pro'
        assert published.read_text(encoding='utf-8') == content

    def test_archive_works_get_content_files_too(self, data_dir):
        write_outputs([row('pruned', indexed=False)], data_dir / 'index.jsonl')
        assert (data_dir / 'songs' / 'pruned.pro').exists()

    def test_works_without_a_lead_sheet_get_no_file(self, data_dir):
        write_outputs([row('placeholder', content='')],
                      data_dir / 'index.jsonl')
        assert list((data_dir / 'songs').glob('*.pro')) == []

    def test_canon_lyrics_are_left_alone_archive_lyrics_are_clipped(self, data_dir):
        write_outputs([row('canon'), row('pruned', indexed=False)],
                      data_dir / 'index.jsonl')
        canon = read_jsonl(data_dir / 'index.jsonl')[0]
        archive = read_jsonl(data_dir / 'archive.jsonl')[0]
        # Search reads canon lyrics, so they keep whatever the builder set.
        assert canon['lyrics'] == 'la ' * 400
        # Archive rows only feed the work-page header fallback.
        assert len(archive['lyrics']) == ARCHIVE_LYRICS_CHARS
        assert archive['lyrics'] == ('la ' * 400)[:ARCHIVE_LYRICS_CHARS]

    def test_row_order_is_preserved(self, data_dir):
        write_outputs([row('a-song'),
                       row('b-song', indexed=False),
                       row('c-song'),
                       row('d-song', indexed=False)],
                      data_dir / 'index.jsonl')
        # write_outputs must not reorder: the caller sorted by id and that is
        # what keeps index.jsonl byte-stable between builds.
        assert [r['id'] for r in read_jsonl(data_dir / 'index.jsonl')] == \
            ['a-song', 'c-song']
        assert [r['id'] for r in read_jsonl(data_dir / 'archive.jsonl')] == \
            ['b-song', 'd-song']

    def test_numeric_work_ids_still_get_a_file(self, data_dir):
        # A couple of work ids are unquoted numbers in work.yaml, so they
        # arrive as ints (2393, 2402 in the real corpus).
        write_outputs([row(2402)], data_dir / 'index.jsonl')
        assert (data_dir / 'songs' / '2402.pro').exists()


class TestRebuilds:
    def test_unchanged_content_is_not_rewritten(self, data_dir):
        write_outputs([row('steady')], data_dir / 'index.jsonl')
        published = data_dir / 'songs' / 'steady.pro'
        before = published.stat().st_mtime_ns
        write_outputs([row('steady')], data_dir / 'index.jsonl')
        assert published.stat().st_mtime_ns == before

    def test_changed_content_is_rewritten(self, data_dir):
        write_outputs([row('edited')], data_dir / 'index.jsonl')
        write_outputs([row('edited', content='{meta: title edited}\n[C]new\n')],
                      data_dir / 'index.jsonl')
        assert (data_dir / 'songs' / 'edited.pro').read_text() == \
            '{meta: title edited}\n[C]new\n'

    def test_orphans_are_pruned(self, data_dir):
        write_outputs([row('renamed-away')], data_dir / 'index.jsonl')
        assert (data_dir / 'songs' / 'renamed-away.pro').exists()
        write_outputs([row('the-new-name')], data_dir / 'index.jsonl')
        assert not (data_dir / 'songs' / 'renamed-away.pro').exists()
        assert (data_dir / 'songs' / 'the-new-name.pro').exists()

    def test_both_files_are_byte_stable(self, data_dir):
        songs = [row('a'), row('b', indexed=False)]
        write_outputs([dict(s) for s in songs], data_dir / 'index.jsonl')
        first = ((data_dir / 'index.jsonl').read_bytes(),
                 (data_dir / 'archive.jsonl').read_bytes())
        write_outputs([dict(s) for s in songs], data_dir / 'index.jsonl')
        assert ((data_dir / 'index.jsonl').read_bytes(),
                (data_dir / 'archive.jsonl').read_bytes()) == first


# ------------------------------------------------------- OTF track counts

class TestTrackCount:
    def test_counts_tracks(self, tmp_path):
        assert otf_track_count(write_otf(tmp_path / 'a.otf.json', tracks=3)) == 3

    def test_missing_file_abstains(self, tmp_path):
        assert otf_track_count(tmp_path / 'nope.otf.json') is None

    def test_garbage_abstains(self, tmp_path):
        path = tmp_path / 'bad.otf.json'
        path.write_text('not json')
        assert otf_track_count(path) is None

    def test_no_tracks_key_abstains(self, tmp_path):
        path = tmp_path / 'empty.otf.json'
        path.write_text('{"metadata": {}}')
        assert otf_track_count(path) is None


# ----------------------------------------------------- end-to-end build

class TestFullBuild:
    """build_works_index over a tiny throwaway repo.

    Guards the wiring the unit tests above can't see: that the copy step
    stamps `tracks`, and that the emitted files land in docs/data/.
    """

    @pytest.fixture
    def repo(self, tmp_path, monkeypatch):
        works = tmp_path / 'works'
        (tmp_path / 'docs' / 'data').mkdir(parents=True)

        sheet = works / 'canon-tune'
        sheet.mkdir(parents=True)
        (sheet / 'work.yaml').write_text(yaml.dump({
            'id': 'canon-tune', 'title': 'Canon Tune', 'artist': 'Tester',
            'parts': [{'type': 'tablature', 'instrument': 'banjo',
                       'format': 'otf', 'file': 'banjo.otf.json',
                       'provenance': {'source': 'banjo-hangout',
                                      'source_id': '111'}}],
        }, sort_keys=False))
        (sheet / 'lead-sheet.pro').write_text(
            '{meta: title Canon Tune}\n[G]Way down [C]yonder\n')
        write_otf(sheet / 'banjo.otf.json', tracks=2, source_id='111')

        pruned = works / 'pruned-tune'
        pruned.mkdir(parents=True)
        (pruned / 'work.yaml').write_text(yaml.dump({
            'id': 'pruned-tune', 'title': 'Pruned Tune', 'parts': []},
            sort_keys=False))
        (pruned / 'lead-sheet.pro').write_text(
            '{meta: title Pruned Tune}\n[D]Not bluegrass [A]at all\n')

        prune_csv = tmp_path / 'curation' / 'index_prune.csv'
        prune_csv.parent.mkdir(parents=True)
        prune_csv.write_text('id,title\npruned-tune,Pruned Tune\n')

        monkeypatch.chdir(tmp_path)
        return tmp_path

    @pytest.fixture
    def built(self, repo):
        build_works_index(Path('works'), Path('docs/data/index.jsonl'),
                          enrich_tags=False, fuzzy_grouping=False,
                          num_workers=1)
        return repo / 'docs' / 'data'

    def test_canon_and_archive_are_split(self, built):
        assert [r['id'] for r in read_jsonl(built / 'index.jsonl')] == \
            ['canon-tune']
        assert [r['id'] for r in read_jsonl(built / 'archive.jsonl')] == \
            ['pruned-tune']

    def test_song_files_are_written_for_both(self, built):
        assert (built / 'songs' / 'canon-tune.pro').read_text() == \
            '{meta: title Canon Tune}\n[G]Way down [C]yonder\n'
        assert (built / 'songs' / 'pruned-tune.pro').read_text() == \
            '{meta: title Pruned Tune}\n[D]Not bluegrass [A]at all\n'

    def test_tablature_rows_carry_the_track_count(self, built):
        part = read_jsonl(built / 'index.jsonl')[0]['tablature_parts'][0]
        assert part['tracks'] == 2
        assert part['file'] == 'data/tabs/canon-tune-banjo-111.otf.json'
        assert (built / 'tabs' / 'canon-tune-banjo-111.otf.json').exists()

    def test_a_rebuild_is_byte_identical(self, built):
        before = ((built / 'index.jsonl').read_bytes(),
                  (built / 'archive.jsonl').read_bytes())
        build_works_index(Path('works'), Path('docs/data/index.jsonl'),
                          enrich_tags=False, fuzzy_grouping=False,
                          num_workers=1)
        assert ((built / 'index.jsonl').read_bytes(),
                (built / 'archive.jsonl').read_bytes()) == before
