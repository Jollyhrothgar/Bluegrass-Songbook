-- Allow null content for document-only placeholder submissions
-- (placeholders with uploaded images/PDFs have no ChordPro content)
ALTER TABLE pending_songs ALTER COLUMN content DROP NOT NULL;
