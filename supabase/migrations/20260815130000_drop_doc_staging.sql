-- ============================================================================
-- STOP. DO NOT APPLY THIS MIGRATION UNTIL YOU HAVE CHECKED FOR SURVIVORS.
-- ============================================================================
--
-- doc_staging and the `doc-staging` storage bucket were a dead end: the UI
-- told submitters "Submitted for review! You'll see it once approved" while
-- NOTHING downstream ever read the rows or the files — no workflow, no issue,
-- no human queue. Anything sitting in there is a real person's upload that was
-- silently dropped on the floor. It is the only copy.
--
-- BEFORE running this migration, inspect and rescue:
--
--   select id, user_id, work_id, storage_path, label, file_size, created_at,
--          status
--     from doc_staging
--    order by created_at;
--
--   -- files (the table can be empty while the bucket is not, and vice versa):
--   select name, owner, created_at, metadata
--     from storage.objects
--    where bucket_id = 'doc-staging'
--    order by created_at;
--
-- For each survivor worth keeping: download the object, add it under
-- works/<work_id>/ as a `type: document` part in work.yaml (that shelf is
-- untouched by phase 2d and still renders), and — where you can — tell the
-- submitter their upload landed. Only then apply this migration.
--
-- Phase 2d of docs/plans/contribution-pipeline.md. This kills the intake,
-- not the shelf: existing document parts in works/ and the published PDFs in
-- docs/data/docs/ keep being served.

-- The two storage policies exist only for this bucket.
drop policy if exists "Users can upload docs" on storage.objects;
drop policy if exists "Users can read own docs" on storage.objects;

-- Table policies and indexes go with the table.
drop table if exists doc_staging;

-- MANUAL STEP — buckets cannot be dropped from a SQL migration (deleting the
-- storage.buckets row leaves the objects orphaned rather than removing them).
-- After applying this file, and after the rescue pass above, delete the bucket
-- by hand:
--
--   supabase storage rm --experimental -r ss:///doc-staging
--   -- then remove the (now empty) bucket in the Supabase dashboard:
--   --   Storage -> doc-staging -> ... -> Delete bucket
--
-- Verify afterwards:
--   select id from storage.buckets where id = 'doc-staging';   -- 0 rows
