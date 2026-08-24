"""`supabase migration list` drift, in both directions.

The bug these pin: the old `./scripts/utility db-push` check printed only rows
that had a version in Local and nothing in Remote. A REMOTE-only row — what a
hand-applied migration or a `supabase migration repair` stamp leaves — matched
nothing, so the command printed "(none — local and remote agree)" and exited 0
while `supabase db push` was refusing with a drift error.
"""

import migration_drift as md

# Real output shape, including the chatter the CLI wraps the table in.
IN_SYNC = """Initialising login role...
Connecting to remote database...

  \x20
   Local          | Remote         | Time (UTC)          \x20
  ----------------|----------------|---------------------
   20260818000000 | 20260818000000 | 2026-08-18 00:00:00\x20
   20260818010000 | 20260818010000 | 2026-08-18 01:00:00\x20
   20260819000000 | 20260819000000 | 2026-08-19 00:00:00\x20

A new version of Supabase CLI is available: v2.115.0 (currently installed v2.67.1)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
"""

LOCAL_ONLY = """   Local          | Remote         | Time (UTC)          \x20
  ----------------|----------------|---------------------
   20260818000000 | 20260818000000 | 2026-08-18 00:00:00\x20
   20260819000000 |                | 2026-08-19 00:00:00\x20
"""

REMOTE_ONLY = """   Local          | Remote         | Time (UTC)          \x20
  ----------------|----------------|---------------------
   20260818000000 | 20260818000000 | 2026-08-18 00:00:00\x20
                  | 20260820000000 | 2026-08-20 00:00:00\x20
"""

BOTH_DIRECTIONS = """   Local          | Remote         | Time (UTC)          \x20
  ----------------|----------------|---------------------
   20260818000000 | 20260818000000 | 2026-08-18 00:00:00\x20
   20260819000000 |                | 2026-08-19 00:00:00\x20
                  | 20260820000000 | 2026-08-20 00:00:00\x20
"""


class TestParse:
    def test_in_sync(self):
        drift = md.parse_migration_list(IN_SYNC)
        assert drift.agree
        assert not drift.has_drift
        assert drift.in_sync == ['20260818000000', '20260818010000', '20260819000000']
        assert drift.local_only == []
        assert drift.remote_only == []

    def test_header_and_rule_and_chatter_are_not_versions(self):
        """The 'Local | Remote | Time' header and the ---|---|--- rule both have
        two pipes; neither may be mistaken for a migration."""
        drift = md.parse_migration_list(IN_SYNC)
        assert len(drift.in_sync) == 3

    def test_local_only_is_pending(self):
        drift = md.parse_migration_list(LOCAL_ONLY)
        assert drift.local_only == ['20260819000000']
        assert drift.remote_only == []
        assert not drift.has_drift
        assert not drift.agree

    def test_remote_only_is_drift(self):
        """THE REGRESSION. The old awk saw nothing here."""
        drift = md.parse_migration_list(REMOTE_ONLY)
        assert drift.remote_only == ['20260820000000']
        assert drift.local_only == []
        assert drift.has_drift
        assert not drift.agree

    def test_both_directions_at_once(self):
        drift = md.parse_migration_list(BOTH_DIRECTIONS)
        assert drift.local_only == ['20260819000000']
        assert drift.remote_only == ['20260820000000']
        assert drift.has_drift

    def test_empty_input(self):
        drift = md.parse_migration_list('')
        assert drift.agree
        assert drift.in_sync == []


class TestExitStatus:
    """db-push branches on these; getting them wrong either blocks a normal
    push or lets a drifted one through."""

    def test_in_sync_exits_zero(self, tmp_path, capsys):
        p = tmp_path / 'list.txt'
        p.write_text(IN_SYNC)
        assert md.main(['--input', str(p)]) == md.EXIT_IN_SYNC

    def test_pending_exits_two(self, tmp_path):
        p = tmp_path / 'list.txt'
        p.write_text(LOCAL_ONLY)
        assert md.main(['--input', str(p)]) == md.EXIT_PENDING

    def test_remote_drift_exits_one(self, tmp_path):
        p = tmp_path / 'list.txt'
        p.write_text(REMOTE_ONLY)
        assert md.main(['--input', str(p)]) == md.EXIT_REMOTE_DRIFT

    def test_remote_drift_wins_over_pending(self, tmp_path):
        """With drift in both directions the caller must STOP, not push."""
        p = tmp_path / 'list.txt'
        p.write_text(BOTH_DIRECTIONS)
        assert md.main(['--input', str(p)]) == md.EXIT_REMOTE_DRIFT


class TestOutput:
    def test_in_sync_says_so(self):
        text = md.format_drift(md.parse_migration_list(IN_SYNC))
        assert 'local and remote agree' in text
        assert 'DRIFT' not in text

    def test_remote_only_is_named_and_loud(self):
        text = md.format_drift(md.parse_migration_list(REMOTE_ONLY))
        assert 'DRIFT' in text
        assert '20260820000000' in text
        # It must NOT claim agreement — the whole bug.
        assert 'local and remote agree' not in text

    def test_remote_only_warns_about_repair(self):
        text = md.format_drift(md.parse_migration_list(REMOTE_ONLY))
        assert 'repair' in text
        assert 'db-check' in text

    def test_pending_lists_the_versions(self):
        text = md.format_drift(md.parse_migration_list(LOCAL_ONLY))
        assert '20260819000000' in text
        assert 'DRIFT' not in text
