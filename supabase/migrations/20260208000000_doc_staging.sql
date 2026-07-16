-- Staging bucket and table for document uploads pending approval
-- Trusted users bypass staging (auto-committed via edge function)
-- Regular users upload here; maintainer approves via GitHub issue

-- Staging bucket for document uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('doc-staging', 'doc-staging', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated users can upload to staging bucket
CREATE POLICY "Users can upload docs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'doc-staging');

-- RLS: users can read their own uploads
CREATE POLICY "Users can read own docs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'doc-staging' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Staging metadata table
CREATE TABLE IF NOT EXISTS doc_staging (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    work_id text NOT NULL,
    storage_path text NOT NULL,
    label text,
    file_size integer NOT NULL,
    created_at timestamptz DEFAULT now(),
    github_issue_number integer,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- RLS for doc_staging table
ALTER TABLE doc_staging ENABLE ROW LEVEL SECURITY;

-- Users can insert their own entries
CREATE POLICY "Users can create staging entries"
    ON doc_staging FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Users can read their own entries
CREATE POLICY "Users can read own staging entries"
    ON doc_staging FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Index for efficient lookups
CREATE INDEX idx_doc_staging_work_id ON doc_staging (work_id);
CREATE INDEX idx_doc_staging_status ON doc_staging (status);
