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

-- ---------------------------------------------------------------------------
-- List security section (A1/A2, 20260930000000 / 20260930010000).
-- UNLIKE everything above, this part is NOT from the live project: it is the
-- same `supabase db dump --schema public` output taken from a LOCAL replay of
-- supabase/migrations/ (supabase/tests/run.sh), trimmed the same way, because
-- those migrations had not been pushed when it was recorded. After the push,
-- replace it with the live dump.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."add_list_owner"("p_list_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
select 1
$$;

CREATE OR REPLACE FUNCTION "public"."remove_list_owner"("p_list_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
select 1
$$;

CREATE OR REPLACE FUNCTION "public"."log_events"("p_visitor_id" "text", "p_events" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  event_record JSONB;
  inserted_count INTEGER := 0;
BEGIN
  FOR event_record IN SELECT * FROM pg_catalog.jsonb_array_elements(p_events)
  LOOP
    INSERT INTO public.analytics_events (visitor_id, event_name, properties, created_at)
    VALUES (
      p_visitor_id,
      event_record->>'event_name',
      COALESCE(event_record->'properties', '{}'),
      COALESCE((event_record->>'timestamp')::timestamptz, NOW())
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;

ALTER TABLE "public"."list_followers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_list_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_lists" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Followers and owners can view followers" ON "public"."list_followers" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_list_owner"("list_id")));

CREATE POLICY "Owners and followers can view list items" ON "public"."user_list_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_lists"
  WHERE ("user_lists"."id" = "user_list_items"."list_id"))));

CREATE POLICY "Owners and followers can view lists" ON "public"."user_lists" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = ANY ("owners")) OR "public"."is_list_follower"("id")));

CREATE POLICY "Owners can delete list items" ON "public"."user_list_items" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."user_lists"
  WHERE (("user_lists"."id" = "user_list_items"."list_id") AND ("auth"."uid"() = ANY ("user_lists"."owners"))))));

CREATE POLICY "Owners can delete lists" ON "public"."user_lists" FOR DELETE USING (("auth"."uid"() = ANY ("owners")));

CREATE POLICY "Owners can insert list items" ON "public"."user_list_items" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_lists"
  WHERE (("user_lists"."id" = "user_list_items"."list_id") AND ("auth"."uid"() = ANY ("user_lists"."owners"))))));

CREATE POLICY "Owners can update list items" ON "public"."user_list_items" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."user_lists"
  WHERE (("user_lists"."id" = "user_list_items"."list_id") AND ("auth"."uid"() = ANY ("user_lists"."owners"))))));

CREATE POLICY "Owners can update lists" ON "public"."user_lists" FOR UPDATE USING (("auth"."uid"() = ANY ("owners")));

CREATE POLICY "Users can follow lists" ON "public"."list_followers" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "Users can insert own lists" ON "public"."user_lists" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (COALESCE("owners", '{}'::"uuid"[]) <@ ARRAY["auth"."uid"()])));

CREATE POLICY "Users can unfollow" ON "public"."list_followers" FOR DELETE USING (("auth"."uid"() = "user_id"));

REVOKE ALL ON FUNCTION "public"."add_list_owner"("p_list_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."add_list_owner"("p_list_id" "uuid", "p_user_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."remove_list_owner"("p_list_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."remove_list_owner"("p_list_id" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."remove_list_owner"("p_list_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."log_events"("p_visitor_id" "text", "p_events" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."log_events"("p_visitor_id" "text", "p_events" "jsonb") TO "anon";

GRANT ALL ON FUNCTION "public"."log_events"("p_visitor_id" "text", "p_events" "jsonb") TO "authenticated";

GRANT ALL ON FUNCTION "public"."log_events"("p_visitor_id" "text", "p_events" "jsonb") TO "service_role";
