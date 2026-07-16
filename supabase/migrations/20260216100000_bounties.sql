-- Bounties: Part-level requests for works
-- Users can request specific parts (banjo tab, lead sheet, etc.) for any work

CREATE TABLE bounties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id text NOT NULL,
    part_type text NOT NULL,         -- 'lead-sheet', 'tablature', 'abc-notation', 'document'
    instrument text,                 -- For tablature: 'banjo', 'guitar', 'fiddle', 'mandolin', etc.
    description text,                -- Optional: "Looking for Scruggs-style 3-finger picking"
    created_by uuid REFERENCES auth.users(id),
    resolved_by uuid REFERENCES auth.users(id),
    resolved_at timestamptz,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz DEFAULT now()
);

-- Prevent duplicate open bounties for same work+part+instrument
CREATE UNIQUE INDEX idx_bounties_unique_open
    ON bounties(work_id, part_type, COALESCE(instrument, ''))
    WHERE status = 'open';

ALTER TABLE bounties ENABLE ROW LEVEL SECURITY;

-- Anyone can read bounties
CREATE POLICY "Bounties are publicly readable"
    ON bounties FOR SELECT USING (true);

-- Authenticated users can create bounties
CREATE POLICY "Authenticated users can create bounties"
    ON bounties FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Creator or trusted users can update (resolve) bounties
CREATE POLICY "Creator or trusted users can update bounties"
    ON bounties FOR UPDATE TO authenticated
    USING (
        created_by = auth.uid()
        OR auth.uid() IN (SELECT user_id FROM trusted_users)
    );

-- Indexes for common queries
CREATE INDEX idx_bounties_work_open ON bounties(work_id) WHERE status = 'open';
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bounties_created_by ON bounties(created_by);
