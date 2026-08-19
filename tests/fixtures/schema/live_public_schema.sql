-- Recorded excerpt of `supabase db dump --schema public`, taken 2026-08-19 from
-- the live project, immediately after 20260819000000 was applied. Trimmed to the
-- objects tests/test_schema_assert.py asserts on; every line below is verbatim
-- dump output (function bodies replaced with `select 1` — the parser only reads
-- the header, and a real body is noise in a fixture).
--
-- Regenerate with:  supabase db dump --schema public

CREATE TABLE IF NOT EXISTS "public"."pending_songs" (
    "id" "text" NOT NULL,
    "replaces_id" "text",
    "title" "text" NOT NULL,
    "artist" "text",
    "composer" "text",
    "content" "text",
    "key" "text",
    "mode" "text",
    "tags" "jsonb" DEFAULT '{}'::"jsonb",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "github_committed" boolean DEFAULT false,
    "dedup_hold" "text",
    "notes" "text",
    "status" "text",
    "part_type" "text" DEFAULT 'lead-sheet'::"text" NOT NULL,
    "instrument" "text",
    "part_file" "text",
    CONSTRAINT "pending_songs_artist_len" CHECK ((("artist" IS NULL) OR ("char_length"("artist") <= 200))),
    CONSTRAINT "pending_songs_composer_len" CHECK ((("composer" IS NULL) OR ("char_length"("composer") <= 300))),
    CONSTRAINT "pending_songs_content_size" CHECK ((("content" IS NULL) OR ("octet_length"("content") <=
CASE
    WHEN ("part_type" = 'tablature'::"text") THEN 2097152
    ELSE 204800
END))),
    CONSTRAINT "pending_songs_dedup_hold_len" CHECK ((("dedup_hold" IS NULL) OR ("char_length"("dedup_hold") <= 5000))),
    CONSTRAINT "pending_songs_id_len" CHECK (("char_length"("id") <= 200)),
    CONSTRAINT "pending_songs_instrument_shape" CHECK ((("instrument" IS NULL) OR (("instrument" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text") AND ("char_length"("instrument") <= 40)))),
    CONSTRAINT "pending_songs_metadata_has_no_content" CHECK ((("part_type" <> 'metadata'::"text") OR ("content" IS NULL))),
    CONSTRAINT "pending_songs_metadata_id_namespace" CHECK ((("part_type" <> 'metadata'::"text") OR ("id" ~ '^meta:[a-z0-9-]*:[a-z0-9]{6,}$'::"text"))),
    CONSTRAINT "pending_songs_metadata_needs_target" CHECK ((("part_type" <> 'metadata'::"text") OR ("replaces_id" IS NOT NULL))),
    CONSTRAINT "pending_songs_notes_len" CHECK ((("notes" IS NULL) OR ("char_length"("notes") <= 5000))),
    CONSTRAINT "pending_songs_part_file_shape" CHECK ((("part_file" IS NULL) OR (("part_file" ~ '^[a-z0-9]+(-[a-z0-9]+)*\.otf\.json$'::"text") AND ("char_length"("part_file") <= 200)))),
    CONSTRAINT "pending_songs_part_type" CHECK (("part_type" = ANY (ARRAY['lead-sheet'::"text", 'tablature'::"text", 'metadata'::"text"]))),
    CONSTRAINT "pending_songs_replaces_len" CHECK ((("replaces_id" IS NULL) OR ("char_length"("replaces_id") <= 200))),
    CONSTRAINT "pending_songs_status_valid" CHECK ((("status" IS NULL) OR ("status" = ANY (ARRAY['complete'::"text", 'placeholder'::"text"])))),
    CONSTRAINT "pending_songs_tab_id_namespace" CHECK ((("part_type" <> 'tablature'::"text") OR ("id" ~ '^tab:[a-z0-9-]*:[a-z0-9]{6,}$'::"text"))),
    CONSTRAINT "pending_songs_tab_needs_instrument" CHECK ((("part_type" <> 'tablature'::"text") OR ("instrument" IS NOT NULL))),
    CONSTRAINT "pending_songs_tags_size" CHECK ((("tags" IS NULL) OR ("octet_length"(("tags")::"text") <= 8192))),
    CONSTRAINT "pending_songs_title_len" CHECK (("char_length"("title") <= 300))
);

CREATE TABLE IF NOT EXISTS "public"."submission_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "target_id" "text",
    "ip_address" "inet",
    "user_agent" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."leaderboard_identities" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hidden" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."leaderboard_salt" (
    "id" integer DEFAULT 1 NOT NULL,
    "salt" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "leaderboard_salt_id_check" CHECK (("id" = 1))
);

CREATE OR REPLACE FUNCTION "public"."get_leaderboard"() RETURNS TABLE("rank" integer, "display" "text", "total" integer, "songs" integer, "tabs" integer, "is_you" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$ select 1 $$;

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select 1 $$;

CREATE OR REPLACE FUNCTION "public"."is_trusted_user"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$ select 1 $$;

ALTER TABLE "public"."leaderboard_identities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."leaderboard_salt" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."pending_songs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."submission_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can delete any pending row" ON "public"."pending_songs" FOR DELETE TO "authenticated" USING ("public"."is_admin"());

CREATE POLICY "Admins can update any pending row" ON "public"."pending_songs" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

CREATE POLICY "Anyone can read pending songs" ON "public"."pending_songs" FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert own" ON "public"."pending_songs" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));

CREATE POLICY "Owners and trusted users can delete" ON "public"."pending_songs" FOR DELETE TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."is_trusted_user"()));

CREATE POLICY "Owners and trusted users can update" ON "public"."pending_songs" FOR UPDATE TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."is_trusted_user"())) WITH CHECK ((("created_by" = "auth"."uid"()) OR "public"."is_trusted_user"()));

CREATE POLICY "Service role only" ON "public"."submission_log" FOR INSERT WITH CHECK (false);

CREATE POLICY "Users see own" ON "public"."submission_log" FOR SELECT USING (("user_id" = "auth"."uid"()));

GRANT ALL ON FUNCTION "public"."get_leaderboard"() TO "anon";

GRANT ALL ON FUNCTION "public"."get_leaderboard"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_leaderboard"() TO "service_role";
