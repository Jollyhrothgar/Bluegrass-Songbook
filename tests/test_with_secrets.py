"""scripts/lib/with-secrets picks 1Password when it can actually read secrets.

`op whoami` is not that signal. With the 1Password desktop app's CLI
integration, `whoami` reports "account is not signed in" in every fresh shell
while `op read` / `op run` work (the app authorizes them on demand). Probing
with `whoami` sent every command to the plaintext `.env` fallback, or, once
that was deleted, to no secrets at all.

Each test runs a copy of the real script in a scratch repo with a fake `op`
on PATH, so nothing here touches 1Password.
"""

import os
import shutil
import stat
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / 'scripts' / 'lib' / 'with-secrets'

# A fake `op`. `whoami` always fails, as it does under app integration.
# `inject` and `run` succeed unless FAKE_OP_LOCKED is set; `run` exports
# SECRET=from-op and executes the command after `--`.
FAKE_OP = """#!/usr/bin/env bash
case "$1" in
    whoami) echo '[ERROR] account is not signed in' >&2; exit 1 ;;
    inject|read)
        if [ -n "${FAKE_OP_LOCKED:-}" ]; then
            echo '[ERROR] authorization prompt dismissed' >&2; exit 1
        fi
        echo 'SECRET=from-op' ;;
    run)
        if [ -n "${FAKE_OP_LOCKED:-}" ]; then
            echo '[ERROR] authorization prompt dismissed' >&2; exit 1
        fi
        while [ "$1" != "--" ]; do shift; done; shift
        SECRET=from-op exec "$@" ;;
    *) exit 2 ;;
esac
"""


def _repo(tmp_path, *, env_file=None):
    root = tmp_path / 'repo'
    (root / 'scripts' / 'lib').mkdir(parents=True)
    shutil.copy(SCRIPT, root / 'scripts' / 'lib' / 'with-secrets')
    (root / '.env.tpl').write_text('SECRET=op://Vault/Item/field\n')
    if env_file is not None:
        (root / '.env').write_text(env_file)

    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    op = bin_dir / 'op'
    op.write_text(FAKE_OP)
    op.chmod(op.stat().st_mode | stat.S_IEXEC)
    return root, bin_dir


def _run(root, bin_dir, **extra_env):
    env = {k: v for k, v in os.environ.items() if k != 'SECRET'}
    env['PATH'] = f"{bin_dir}{os.pathsep}{env['PATH']}"
    env.update(extra_env)
    return subprocess.run(
        [str(root / 'scripts' / 'lib' / 'with-secrets'), '--',
         'bash', '-c', 'echo "SECRET=${SECRET:-unset}"'],
        capture_output=True, text=True, env=env, check=False,
    )


def test_uses_1password_when_whoami_fails_but_secrets_resolve(tmp_path):
    root, bin_dir = _repo(tmp_path)
    result = _run(root, bin_dir)
    assert result.returncode == 0, result.stderr
    assert 'SECRET=from-op' in result.stdout


def test_prefers_1password_over_a_stale_env_file(tmp_path):
    root, bin_dir = _repo(tmp_path, env_file='SECRET=from-file\n')
    result = _run(root, bin_dir)
    assert 'SECRET=from-op' in result.stdout


def test_falls_back_to_env_file_when_1password_cannot_resolve(tmp_path):
    root, bin_dir = _repo(tmp_path, env_file='SECRET=from-file\n')
    result = _run(root, bin_dir, FAKE_OP_LOCKED='1')
    assert result.returncode == 0, result.stderr
    assert 'SECRET=from-file' in result.stdout


def test_reports_op_error_when_nothing_resolves(tmp_path):
    root, bin_dir = _repo(tmp_path)
    result = _run(root, bin_dir, FAKE_OP_LOCKED='1')
    assert 'SECRET=unset' in result.stdout
    # op's own reason is passed through, not a guess that it is "locked".
    assert 'authorization prompt dismissed' in result.stderr
