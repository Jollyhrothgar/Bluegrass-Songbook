"""The sync scripts must fail loudly rather than serve a stale cache.

They used to warn and fall back to the on-disk copy, so a broken sync looked
like a successful one and the build shipped yesterday's data — a promotion made
in the UI could silently never reach the site.
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / 'scripts' / 'lib'))

import supabase_client  # noqa: E402
import fetch_promoted_songs as fps  # noqa: E402


class TestConnect:
    def test_exits_without_credentials(self, monkeypatch):
        monkeypatch.delenv('SUPABASE_URL', raising=False)
        monkeypatch.delenv('SUPABASE_SERVICE_ROLE_KEY', raising=False)
        monkeypatch.delenv('SUPABASE_KEY', raising=False)
        with pytest.raises(SystemExit) as e:
            supabase_client.connect('widgets')
        assert e.value.code == 1

    def test_names_the_missing_package_when_it_is_missing(self, monkeypatch, capsys):
        monkeypatch.setenv('SUPABASE_URL', 'https://x.supabase.co')
        monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'k')
        real = __builtins__['__import__'] if isinstance(__builtins__, dict) else __builtins__.__import__

        def boom(name, *a, **kw):
            if name == 'supabase':
                raise ModuleNotFoundError("No module named 'supabase'", name='supabase')
            return real(name, *a, **kw)

        monkeypatch.setattr('builtins.__import__', boom)
        with pytest.raises(SystemExit):
            supabase_client.connect('widgets')
        assert 'not installed' in capsys.readouterr().out

    def test_distinguishes_a_broken_dependency_from_a_missing_package(self, monkeypatch, capsys):
        # `except ImportError` around the supabase import also catches failures
        # from its dependency tree. Reporting those as "not installed" sent you
        # to reinstall a package that was already there.
        monkeypatch.setenv('SUPABASE_URL', 'https://x.supabase.co')
        monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'k')
        real = __builtins__['__import__'] if isinstance(__builtins__, dict) else __builtins__.__import__

        def boom(name, *a, **kw):
            if name == 'supabase':
                raise ModuleNotFoundError("No module named 'httpx'", name='httpx')
            return real(name, *a, **kw)

        monkeypatch.setattr('builtins.__import__', boom)
        with pytest.raises(SystemExit):
            supabase_client.connect('widgets')
        out = capsys.readouterr().out
        assert 'httpx' in out and 'not installed' not in out


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self, rows, fail=False):
        self._rows, self._fail = rows, fail

    def select(self, *_):
        return self

    def execute(self):
        if self._fail:
            raise RuntimeError('connection reset')
        return FakeResult(self._rows)


class FakeClient:
    def __init__(self, rows, fail=False):
        self._rows, self._fail = rows, fail

    def table(self, _name):
        return FakeTable(self._rows, self._fail)


class TestFetchPromoted:
    def test_success_writes_the_cache(self, monkeypatch, tmp_path):
        # The script derives the cache path from its own __file__, so point
        # that into tmp and let the real path logic run.
        fake_lib = tmp_path / 'scripts' / 'lib'
        fake_lib.mkdir(parents=True)
        monkeypatch.setattr(fps, '__file__', str(fake_lib / 'fetch_promoted_songs.py'))
        monkeypatch.setattr(fps, 'connect', lambda _what: FakeClient(
            [{'song_id': 'cripple-creek', 'promoted_at': 'now', 'reason': 'canon'}]))

        result = fps.fetch_promoted_songs()

        assert result['cripple-creek']['reason'] == 'canon'
        written = json.loads((tmp_path / 'docs' / 'data' / 'promoted_songs.json').read_text())
        assert written['cripple-creek']['promoted_at'] == 'now'

    def test_query_failure_exits_and_does_not_serve_cache(self, monkeypatch, capsys):
        monkeypatch.setattr(fps, 'connect', lambda _what: FakeClient([], fail=True))
        with pytest.raises(SystemExit) as e:
            fps.fetch_promoted_songs()
        assert e.value.code == 1
        out = capsys.readouterr().out
        assert 'Refusing to fall back' in out
