"""Schema invariant parser + checks, against a recorded live dump.

No database is touched. `tests/fixtures/schema/live_public_schema.sql` is
verbatim `supabase db dump --schema public` output, taken 2026-08-19 right
after the repair migration landed, trimmed to the objects asserted on. Each
failure case is that fixture with one surgical edit — the schema as it actually
was during the outage, or as a plausible regression would leave it.
"""

import pytest

import schema_assert as sa


@pytest.fixture
def dump_text(fixtures_path):
    return (fixtures_path / 'schema' / 'live_public_schema.sql').read_text()


@pytest.fixture
def schema(dump_text):
    return sa.parse_dump(dump_text)


def check(schema, key):
    """Run one invariant by key; returns None when it holds."""
    inv = next(i for i in sa.INVARIANTS if i.key == key)
    return inv.check(schema)


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

class TestParseTables:
    def test_finds_tables(self, schema):
        assert {'pending_songs', 'submission_log', 'leaderboard_salt',
                'leaderboard_identities'} <= set(schema.tables)

    def test_nullable_vs_not_null(self, schema):
        cols = schema.tables['pending_songs'].columns
        assert cols['content'].nullable
        assert not cols['id'].nullable
        assert not cols['title'].nullable
        assert cols['artist'].nullable

    def test_not_null_after_a_default_is_seen(self, schema):
        """`"part_type" "text" DEFAULT 'lead-sheet'::"text" NOT NULL` — the
        NOT NULL trails the default, so a naive suffix check misses it."""
        assert not schema.tables['pending_songs'].columns['part_type'].nullable

    def test_all_inline_check_constraints(self, schema):
        names = schema.tables['pending_songs'].constraints
        assert 'pending_songs_metadata_has_no_content' in names
        assert 'pending_songs_tab_id_namespace' in names
        assert 'pending_songs_part_type' in names

    def test_multiline_constraint_is_captured_whole(self, schema):
        """pending_songs_content_size is dumped across five lines (a CASE
        expression). The continuation lines must attach to it, not become
        phantom columns."""
        body = schema.tables['pending_songs'].constraints['pending_songs_content_size']
        assert 'CASE' in body
        assert '2097152' in body
        assert '204800' in body
        # ...and the CASE arms must not have been read as columns.
        assert 'WHEN' not in schema.tables['pending_songs'].columns

    def test_part_type_constraint_body_lists_all_three(self, schema):
        body = schema.tables['pending_songs'].constraints['pending_songs_part_type']
        for value in ("'lead-sheet'", "'tablature'", "'metadata'"):
            assert value in body

    def test_absent_table_is_absent(self, schema):
        assert not schema.has_relation('doc_staging')


class TestParseFunctions:
    def test_finds_functions(self, schema):
        assert {'get_leaderboard', 'is_admin', 'is_trusted_user'} <= set(schema.functions)

    def test_security_definer(self, schema):
        assert schema.functions['get_leaderboard'].security_definer

    def test_search_path_pinned_is_read(self, schema):
        assert schema.functions['get_leaderboard'].search_path_pinned
        # is_trusted_user() genuinely has no `SET search_path` in production —
        # it was created after the 2026-01-07 hardening pass and missed it.
        assert not schema.functions['is_trusted_user'].search_path_pinned

    def test_grants(self, schema):
        assert schema.function_grants['get_leaderboard'] == {
            'anon', 'authenticated', 'service_role'}


class TestParsePolicies:
    def test_rls_flags(self, schema):
        assert schema.tables['pending_songs'].rls_enabled
        assert schema.tables['leaderboard_salt'].rls_enabled

    def test_leaderboard_tables_have_zero_policies(self, schema):
        assert schema.tables['leaderboard_salt'].policies == []
        assert schema.tables['leaderboard_identities'].policies == []

    def test_policy_command_and_check(self, schema):
        pol = next(p for p in schema.tables['submission_log'].policies
                   if p.command == 'INSERT')
        assert pol.name == 'Service role only'
        assert pol.check == 'false'

    def test_nested_parens_in_a_policy_body(self, schema):
        """`USING ((("created_by" = "auth"."uid"()) OR "public"."is_trusted_user"()))`
        — a regex that stops at the first `)` truncates this."""
        pol = next(p for p in schema.tables['pending_songs'].policies
                   if p.name == 'Owners and trusted users can update')
        assert 'is_trusted_user' in pol.using
        assert 'is_trusted_user' in pol.check

    def test_roles(self, schema):
        pol = next(p for p in schema.tables['pending_songs'].policies
                   if p.name == 'Authenticated users can insert own')
        assert pol.roles == ['authenticated']

    def test_effective_check_falls_back_to_using(self):
        pol = sa.Policy(name='x', table='t', command='ALL', roles=['public'],
                        using='false', check=None)
        assert pol.effective_check == 'false'


# ---------------------------------------------------------------------------
# Invariants — the recorded live schema passes every one
# ---------------------------------------------------------------------------

class TestLiveSchemaPasses:
    def test_every_invariant_holds(self, schema):
        results = sa.run_invariants(schema)
        failed = [(r.invariant.key, r.detail) for r in results if not r.ok]
        assert failed == []

    def test_there_are_invariants_to_check(self, schema):
        assert len(sa.INVARIANTS) >= 10

    def test_keys_are_unique(self):
        keys = [i.key for i in sa.INVARIANTS]
        assert len(keys) == len(set(keys))

    def test_every_invariant_states_a_consumer(self):
        """`why` is the inclusion rule made auditable — an invariant with no
        named consumer does not belong in the set."""
        for inv in sa.INVARIANTS:
            assert len(inv.why) > 40, inv.key
            assert inv.what


# ---------------------------------------------------------------------------
# Invariants — each failure mode, reproduced from the same fixture
# ---------------------------------------------------------------------------

class TestFailureModes:
    def test_the_actual_outage(self, dump_text):
        """The schema exactly as it was before 20260819000000: content NOT
        NULL, while pending_songs_metadata_has_no_content demands it be null.
        A pair no row can satisfy — every metadata save 23502'd."""
        broken = dump_text.replace('    "content" "text",',
                                   '    "content" "text" NOT NULL,')
        assert broken != dump_text
        schema = sa.parse_dump(broken)
        detail = check(schema, 'pending_songs.content-nullable')
        assert detail is not None
        assert 'NOT NULL' in detail
        # The paired CHECK still passes — which is precisely why the pair is
        # unsatisfiable and neither half alone looks wrong.
        assert check(schema, 'pending_songs.metadata-has-no-content') is None

    def test_missing_metadata_check(self, dump_text):
        broken = '\n'.join(l for l in dump_text.split('\n')
                           if 'pending_songs_metadata_has_no_content' not in l)
        schema = sa.parse_dump(broken)
        detail = check(schema, 'pending_songs.metadata-has-no-content')
        assert detail is not None and 'missing' in detail

    def test_missing_metadata_needs_target(self, dump_text):
        broken = '\n'.join(l for l in dump_text.split('\n')
                           if 'pending_songs_metadata_needs_target' not in l)
        assert check(sa.parse_dump(broken),
                     'pending_songs.metadata-needs-target') is not None

    def test_part_type_without_metadata(self, dump_text):
        """The 20260818000000 version of the constraint — two values, not
        three. Present, correctly named, and still wrong."""
        broken = dump_text.replace(
            """CHECK (("part_type" = ANY (ARRAY['lead-sheet'::"text", 'tablature'::"text", 'metadata'::"text"])))""",
            """CHECK (("part_type" = ANY (ARRAY['lead-sheet'::"text", 'tablature'::"text"])))""")
        assert broken != dump_text
        detail = check(sa.parse_dump(broken), 'pending_songs.part-type-admits-metadata')
        assert detail is not None and "'metadata'" in detail

    def test_missing_id_namespace_checks(self, dump_text):
        for cname, key in (('pending_songs_tab_id_namespace',
                            'pending_songs.tab-id-namespace'),
                           ('pending_songs_metadata_id_namespace',
                            'pending_songs.metadata-id-namespace')):
            broken = '\n'.join(l for l in dump_text.split('\n') if cname not in l)
            assert check(sa.parse_dump(broken), key) is not None, cname

    def test_rls_off_on_pending_songs(self, dump_text):
        broken = dump_text.replace(
            'ALTER TABLE "public"."pending_songs" ENABLE ROW LEVEL SECURITY;', '')
        detail = check(sa.parse_dump(broken), 'pending_songs.rls')
        assert detail is not None and 'NOT enabled' in detail

    def test_leaderboard_salt_gains_a_policy(self, dump_text):
        """A single readable policy on the salt de-anonymizes the whole board:
        contributor uuids are already public in works/*/work.yaml."""
        broken = dump_text + (
            '\nCREATE POLICY "Anyone can read salt" ON "public"."leaderboard_salt" '
            'FOR SELECT USING (true);\n')
        detail = check(sa.parse_dump(broken), 'leaderboard_salt.locked')
        assert detail is not None and 'Anyone can read salt' in detail

    def test_leaderboard_identities_gains_a_policy(self, dump_text):
        broken = dump_text + (
            '\nCREATE POLICY "Read identities" ON "public"."leaderboard_identities" '
            'FOR SELECT USING (true);\n')
        assert check(sa.parse_dump(broken), 'leaderboard_identities.locked') is not None

    def test_leaderboard_salt_rls_off(self, dump_text):
        broken = dump_text.replace(
            'ALTER TABLE "public"."leaderboard_salt" ENABLE ROW LEVEL SECURITY;', '')
        assert check(sa.parse_dump(broken), 'leaderboard_salt.locked') is not None

    def test_get_leaderboard_loses_definer(self, dump_text):
        broken = dump_text.replace(
            'LANGUAGE "plpgsql" STABLE SECURITY DEFINER',
            'LANGUAGE "plpgsql" STABLE')
        assert broken != dump_text
        detail = check(sa.parse_dump(broken), 'get_leaderboard.definer')
        assert detail is not None and 'NOT security definer' in detail

    def test_get_leaderboard_missing_entirely(self, dump_text):
        broken = '\n'.join(l for l in dump_text.split('\n')
                           if 'get_leaderboard' not in l)
        detail = check(sa.parse_dump(broken), 'get_leaderboard.definer')
        assert detail is not None and 'does not exist' in detail

    def test_get_leaderboard_anon_grant_revoked(self, dump_text):
        broken = '\n'.join(
            l for l in dump_text.split('\n')
            if not (l.startswith('GRANT') and 'get_leaderboard' in l and '"anon"' in l))
        detail = check(sa.parse_dump(broken), 'get_leaderboard.grants')
        assert detail is not None and 'anon' in detail

    def test_submission_log_opened_to_clients(self, dump_text):
        """A client that can insert here forges leaderboard rank AND resets its
        own durable rate limit."""
        broken = dump_text.replace(
            'CREATE POLICY "Service role only" ON "public"."submission_log" '
            'FOR INSERT WITH CHECK (false);',
            'CREATE POLICY "Service role only" ON "public"."submission_log" '
            'FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));')
        assert broken != dump_text
        detail = check(sa.parse_dump(broken), 'submission_log.no-client-insert')
        assert detail is not None and 'accepts client writes' in detail

    def test_doc_staging_comes_back(self, dump_text):
        """A restore from a pre-August snapshot would do this, and the drop
        migration is already stamped — so nothing would remove it again."""
        broken = dump_text + (
            '\nCREATE TABLE IF NOT EXISTS "public"."doc_staging" (\n'
            '    "id" "uuid" NOT NULL\n'
            ');\n')
        detail = check(sa.parse_dump(broken), 'doc_staging.absent')
        assert detail is not None and 'still exists' in detail

    def test_doc_staging_returning_as_a_view_is_also_caught(self, dump_text):
        broken = dump_text + (
            '\nCREATE OR REPLACE VIEW "public"."doc_staging" AS SELECT 1;\n')
        assert check(sa.parse_dump(broken), 'doc_staging.absent') is not None


# ---------------------------------------------------------------------------
# Reporting / CLI
# ---------------------------------------------------------------------------

class TestReporting:
    def test_passing_report(self, schema):
        text = sa.format_results(sa.run_invariants(schema))
        assert '0 failed' in text
        assert 'FAIL' not in text

    def test_failing_report_names_the_fix(self, dump_text):
        broken = dump_text.replace('    "content" "text",',
                                   '    "content" "text" NOT NULL,')
        text = sa.format_results(sa.run_invariants(sa.parse_dump(broken)))
        assert 'FAIL' in text
        assert 'pending_songs.content-nullable' in text
        assert 'supabase db dump' in text
        assert 'RAISE EXCEPTION' in text

    def test_verbose_prints_rationale_for_passes(self, schema):
        results = sa.run_invariants(schema)
        assert 'why:' not in sa.format_results(results)
        assert 'why:' in sa.format_results(results, verbose=True)

    def test_cli_exit_zero_on_good_dump(self, fixtures_path, capsys):
        path = fixtures_path / 'schema' / 'live_public_schema.sql'
        assert sa.main(['--dump-file', str(path)]) == 0

    def test_cli_exit_one_on_bad_dump(self, fixtures_path, tmp_path):
        text = (fixtures_path / 'schema' / 'live_public_schema.sql').read_text()
        bad = tmp_path / 'bad.sql'
        bad.write_text(text.replace('    "content" "text",',
                                    '    "content" "text" NOT NULL,'))
        assert sa.main(['--dump-file', str(bad)]) == 1

    def test_cli_list_does_not_touch_the_database(self, capsys):
        assert sa.main(['--list']) == 0
        out = capsys.readouterr().out
        assert 'pending_songs.content-nullable' in out
