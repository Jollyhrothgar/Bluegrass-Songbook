-- Submission log for spam tracking and audit trail
-- Records all contribution actions with IP, user agent, and user ID

CREATE TABLE submission_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    action text NOT NULL,       -- 'placeholder_request', 'song_submit', 'flag_report', 'doc_upload'
    target_id text,             -- work slug or song ID
    ip_address inet,
    user_agent text,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now()
);

ALTER TABLE submission_log ENABLE ROW LEVEL SECURITY;

-- Service role inserts (edge functions bypass RLS)
CREATE POLICY "Service role only" ON submission_log FOR INSERT WITH CHECK (false);

-- Users can see their own submissions
CREATE POLICY "Users see own" ON submission_log FOR SELECT USING (user_id = auth.uid());

CREATE INDEX idx_submission_log_user ON submission_log(user_id);
CREATE INDEX idx_submission_log_ip ON submission_log(ip_address);
CREATE INDEX idx_submission_log_created ON submission_log(created_at);
