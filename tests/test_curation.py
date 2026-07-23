"""
Tests for the editorial curation registry (scripts/lib/curation.py).

Covers:
- load_registry() with absent/empty file
- apply_curation() group remapping, canonical flags, variant labels
- dangling registry ids warn (stderr) but don't fail
- filter_suppressed() unions registry.suppressed + deleted_songs
- is_suppressed() collision-suffix base matching
- import guard: publish_to_works() refuses suppressed slugs
"""

import copy

import pytest
import yaml

from curation import (
    Registry,
    apply_curation,
    filter_suppressed,
    is_suppressed,
    load_registry,
)
from process_submission import publish_to_works


def _song(song_id, title=None, group_id=None, **extra):
    song = {
        'id': song_id,
        'title': title or song_id.replace('-', ' ').title(),
        'group_id': group_id or f'hash-{song_id}',
    }
    song.update(extra)
    return song


class TestLoadRegistry:
    def test_absent_file_gives_empty_registry(self, tmp_path):
        registry = load_registry(tmp_path)
        assert registry.groups == {}
        assert registry.suppressed == {}
        assert registry.path == tmp_path / 'curation' / 'registry.yaml'

    def test_loads_groups_and_suppressed(self, tmp_path):
        reg_file = tmp_path / 'curation' / 'registry.yaml'
        reg_file.parent.mkdir(parents=True)
        reg_file.write_text(yaml.dump({
            'groups': {'canon': {'variants': {'var': {'label': 'Alt'}}}},
            'suppressed': {'bad-song': {'reason': 'spam'}},
        }))
        registry = load_registry(tmp_path)
        assert registry.groups['canon']['variants']['var']['label'] == 'Alt'
        assert 'bad-song' in registry.suppressed

    def test_empty_sections_tolerated(self, tmp_path):
        reg_file = tmp_path / 'curation' / 'registry.yaml'
        reg_file.parent.mkdir(parents=True)
        reg_file.write_text('groups:\nsuppressed: {}\n')
        registry = load_registry(tmp_path)
        assert registry.groups == {}
        assert registry.suppressed == {}


class TestApplyCuration:
    def test_empty_registry_is_noop(self):
        songs = [_song('a', group_id='g1'), _song('b', group_id='g2')]
        original = copy.deepcopy(songs)
        result = apply_curation(songs, Registry())
        assert result == original

    def test_canonical_flag_set(self):
        songs = [_song('canon', group_id='g1')]
        registry = Registry(groups={'canon': {'variants': {}}})
        result = apply_curation(songs, registry)
        assert result[0]['canonical'] is True
        assert result[0]['group_id'] == 'grp:canon'

    def test_explicit_variant_joins_group_even_when_fuzzy_missed(self):
        """A listed variant with a DIFFERENT computed group_id still joins."""
        songs = [
            _song('canon', group_id='g1'),
            _song('var', group_id='g-totally-different'),
        ]
        registry = Registry(groups={
            'canon': {'variants': {'var': {'label': 'Alt version'}}},
        })
        result = apply_curation(songs, registry)
        assert result[0]['group_id'] == 'grp:canon'
        assert result[1]['group_id'] == 'grp:canon'
        assert result[1]['variant_of'] == 'canon'
        assert result[1]['variant_label'] == 'Alt version'
        assert 'canonical' not in result[1]

    def test_whole_fuzzy_group_inherits_grp_id(self):
        """Unlisted songs sharing the canonical's group_id are remapped too."""
        songs = [
            _song('canon', group_id='shared'),
            _song('other', group_id='shared'),   # fuzzy-grouped, not in registry
            _song('unrelated', group_id='elsewhere'),
        ]
        registry = Registry(groups={'canon': {'variants': {}}})
        result = apply_curation(songs, registry)
        assert result[0]['group_id'] == 'grp:canon'
        assert result[1]['group_id'] == 'grp:canon'
        assert result[1]['variant_of'] == 'canon'
        assert 'variant_label' not in result[1]
        assert result[2]['group_id'] == 'elsewhere'
        assert 'variant_of' not in result[2]

    def test_dangling_canonical_warns_but_does_not_fail(self, capsys):
        songs = [_song('a', group_id='g1')]
        registry = Registry(groups={'ghost': {'variants': {}}})
        result = apply_curation(songs, registry)
        err = capsys.readouterr().err
        assert "canonical work 'ghost' not found" in err
        assert result[0]['group_id'] == 'g1'

    def test_dangling_variant_warns_but_does_not_fail(self, capsys):
        songs = [_song('canon', group_id='g1')]
        registry = Registry(groups={
            'canon': {'variants': {'ghost-variant': {'label': 'X'}}},
        })
        result = apply_curation(songs, registry)
        err = capsys.readouterr().err
        assert "variant work 'ghost-variant'" in err
        assert result[0]['canonical'] is True


class TestFilterSuppressed:
    def test_unions_registry_and_deleted_songs(self):
        songs = [_song('keep'), _song('registry-hit'), _song('deleted-hit')]
        registry = Registry(suppressed={'registry-hit': {'reason': 'dup'}})
        deleted = {'deleted-hit': {'deleted_at': '2026-01-01', 'reason': None}}
        result = filter_suppressed(songs, deleted, registry)
        assert [s['id'] for s in result] == ['keep']

    def test_empty_sources_keep_everything(self):
        songs = [_song('a'), _song('b')]
        assert filter_suppressed(songs, {}, Registry()) == songs


class TestIsSuppressed:
    def test_exact_match_registry(self):
        registry = Registry(suppressed={'bad': {}})
        assert is_suppressed('bad', registry)
        assert not is_suppressed('good', registry)

    def test_exact_match_deleted_songs(self):
        assert is_suppressed('gone', Registry(), {'gone': {}})

    def test_collision_suffix_base_is_refused(self):
        registry = Registry(suppressed={'bad': {}})
        assert is_suppressed('bad-1', registry)
        assert is_suppressed('bad-42', registry)
        # Prefix without the -N collision pattern is NOT suppressed
        assert not is_suppressed('bad-song', registry)
        assert not is_suppressed('badder', registry)


class TestImportGuard:
    CHORDPRO = '{meta: title My Song}\n[G]Some lyrics here'

    def test_publish_refuses_suppressed_slug(self, tmp_path, capsys):
        reg_file = tmp_path / 'curation' / 'registry.yaml'
        reg_file.parent.mkdir(parents=True)
        reg_file.write_text(yaml.dump({
            'groups': {},
            'suppressed': {'my-song': {'reason': 'owner removed it'}},
        }))
        result = publish_to_works('my-song', 'My Song', None, self.CHORDPRO,
                                  'someone', '1', tmp_path)
        assert result is None
        assert not (tmp_path / 'works' / 'my-song').exists()
        assert 'suppressed' in capsys.readouterr().out.lower()

    def test_publish_refuses_collision_suffix_of_suppressed_base(self, tmp_path):
        reg_file = tmp_path / 'curation' / 'registry.yaml'
        reg_file.parent.mkdir(parents=True)
        reg_file.write_text(yaml.dump({
            'groups': {},
            'suppressed': {'my-song': {'reason': 'gone'}},
        }))
        result = publish_to_works('my-song-1', 'My Song 1', None, self.CHORDPRO,
                                  'someone', '2', tmp_path)
        assert result is None
        assert not (tmp_path / 'works' / 'my-song-1').exists()

    def test_publish_writes_when_not_suppressed(self, tmp_path):
        result = publish_to_works('my-song', 'My Song', 'Artist', self.CHORDPRO,
                                  'someone', '3', tmp_path)
        assert result == tmp_path / 'works' / 'my-song'
        assert (result / 'work.yaml').exists()
        assert (result / 'lead-sheet.pro').exists()

    def test_publish_collision_skips_suppressed_suffix_slug(self, tmp_path):
        """If the base exists and a suffixed slug is itself suppressed, the
        collision loop must skip past it rather than resurrect it."""
        # Existing work occupies the base slug
        existing = tmp_path / 'works' / 'my-song'
        existing.mkdir(parents=True)
        reg_file = tmp_path / 'curation' / 'registry.yaml'
        reg_file.parent.mkdir(parents=True)
        reg_file.write_text(yaml.dump({
            'groups': {},
            'suppressed': {'my-song-1': {'reason': 'bad copy'}},
        }))
        result = publish_to_works('my-song', 'My Song', None, self.CHORDPRO,
                                  'someone', '4', tmp_path)
        assert result == tmp_path / 'works' / 'my-song-2'
