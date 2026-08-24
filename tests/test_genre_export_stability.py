"""
Tests for export_genre_suggestions.write_output().

The hourly Sync Community Input workflow commits whatever this writes, guarded
by `git diff --staged --quiet`. A fresh `exported_at` on every run defeated that
guard: main collected a no-op commit (and a CI run) every hour for months.
write_output() carries the previous timestamp forward when nothing else moved,
so an unchanged export is byte-identical and the guard fires.
"""

import json

import pytest

import export_genre_suggestions as ege


@pytest.fixture
def out_file(tmp_path, monkeypatch):
    path = tmp_path / 'user_genre_suggestions.json'
    monkeypatch.setattr(ege, 'OUTPUT_FILE', path)
    return path


def payload(exported_at, songs=None):
    return {
        'exported_at': exported_at,
        'total_suggestions': 1,
        'unique_tags': 1,
        'unique_songs': 1,
        'songs': songs if songs is not None else {'some-song': {'bluegrass': 1}},
        'tag_totals': {'bluegrass': 1},
    }


def test_unchanged_payload_is_byte_identical(out_file):
    """The whole point: a re-run with identical data must not dirty the file."""
    ege.write_output(payload('2026-08-23T08:53:13.669082Z'))
    first = out_file.read_bytes()

    ege.write_output(payload('2026-08-23T09:48:10.963550Z'))

    assert out_file.read_bytes() == first


def test_changed_payload_takes_the_new_timestamp(out_file):
    ege.write_output(payload('2026-08-23T08:53:13.669082Z'))

    ege.write_output(payload('2026-08-23T09:48:10.963550Z',
                             songs={'some-song': {'bluegrass': 2}}))

    written = json.loads(out_file.read_text())
    assert written['exported_at'] == '2026-08-23T09:48:10.963550Z'
    assert written['songs'] == {'some-song': {'bluegrass': 2}}


def test_first_write_creates_the_file(out_file):
    ege.write_output(payload('2026-08-23T08:53:13.669082Z'))

    written = json.loads(out_file.read_text())
    assert written['exported_at'] == '2026-08-23T08:53:13.669082Z'


def test_corrupt_existing_file_is_overwritten(out_file):
    out_file.write_text('{ not json')

    ege.write_output(payload('2026-08-23T09:48:10.963550Z'))

    written = json.loads(out_file.read_text())
    assert written['exported_at'] == '2026-08-23T09:48:10.963550Z'


def test_empty_export_is_also_stable(out_file):
    """The no-rows branch writes through the same helper."""
    empty = {'exported_at': 'a', 'total_suggestions': 0, 'unique_tags': 0,
             'unique_songs': 0, 'songs': {}, 'tag_totals': {}}
    ege.write_output(empty)
    first = out_file.read_bytes()

    ege.write_output(dict(empty, exported_at='b'))

    assert out_file.read_bytes() == first
