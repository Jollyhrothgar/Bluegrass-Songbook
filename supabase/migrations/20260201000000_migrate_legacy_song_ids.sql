-- Migration: Convert legacy song IDs to new work IDs
-- NOTE: This migration was executed manually via MCP on 2026-02-01
-- Keeping this file for documentation purposes

-- Legacy IDs like 'manofconstantsorrowlyricsandchords' were converted to
-- new work slugs like 'man-of-constant-sorrow' in:
-- - user_list_items table
-- - user_favorites table
-- Duplicates were removed where both old and new IDs existed in the same list.

-- No-op since migration was run manually
SELECT 1;
