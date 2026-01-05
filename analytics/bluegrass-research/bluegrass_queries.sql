-- Bluegrass Landing Page Research Queries
-- Run against local MusicBrainz PostgreSQL database (port 5440)
-- Usage: psql -h localhost -p 5440 -U musicbrainz -d musicbrainz_db -f bluegrass_queries.sql

-- =============================================================================
-- 1. BLUEGRASS CORPUS: Find all artists tagged "bluegrass" in MusicBrainz
-- =============================================================================

-- Artists with bluegrass tag (vote count >= 1)
SELECT
    a.name AS artist_name,
    a.gid AS artist_mbid,
    t.name AS tag_name,
    at.count AS vote_count
FROM artist a
JOIN artist_tag at ON a.id = at.artist
JOIN tag t ON at.tag = t.id
WHERE LOWER(t.name) IN ('bluegrass', 'progressive bluegrass', 'newgrass', 'traditional bluegrass')
  AND at.count >= 1
ORDER BY at.count DESC, a.name
LIMIT 200;

-- =============================================================================
-- 2. FIRST GENERATION ARTISTS (1945-1960): Jack Tuttle's Core Bands
-- =============================================================================

-- Query MusicBrainz IDs for first-generation bluegrass artists
-- These are the canonical bluegrass artists per Jack Tuttle's history

SELECT
    a.name AS artist_name,
    a.gid AS artist_mbid,
    a.begin_date_year AS career_start,
    a.type AS artist_type,
    STRING_AGG(DISTINCT t.name, ', ' ORDER BY t.name) AS all_tags
FROM artist a
LEFT JOIN artist_tag at ON a.id = at.artist AND at.count >= 1
LEFT JOIN tag t ON at.tag = t.id
WHERE a.name IN (
    -- First Generation (1945-1960)
    'Bill Monroe',
    'Bill Monroe & His Blue Grass Boys',
    'Bill Monroe and His Blue Grass Boys',
    'Flatt & Scruggs',
    'Lester Flatt',
    'Earl Scruggs',
    'The Stanley Brothers',
    'Ralph Stanley',
    'Carter Stanley',
    'Jimmy Martin',
    'Jim & Jesse',
    'Jim and Jesse',
    'Don Reno',
    'Reno & Smiley',
    'The Osborne Brothers',
    'Osborne Brothers',
    'Bobby Osborne',
    'Sonny Osborne'
)
GROUP BY a.name, a.gid, a.begin_date_year, a.type
ORDER BY a.begin_date_year NULLS LAST, a.name;

-- =============================================================================
-- 3. FOLK REVIVAL ERA (1960s)
-- =============================================================================

SELECT
    a.name AS artist_name,
    a.gid AS artist_mbid,
    a.begin_date_year AS career_start,
    STRING_AGG(DISTINCT t.name, ', ' ORDER BY t.name) AS all_tags
FROM artist a
LEFT JOIN artist_tag at ON a.id = at.artist AND at.count >= 1
LEFT JOIN tag t ON at.tag = t.id
WHERE a.name IN (
    'Doc Watson',
    'The Country Gentlemen',
    'Country Gentlemen',
    'Bill Keith',
    'Clarence White',
    'The Kentucky Colonels',
    'Kentucky Colonels',
    'New Lost City Ramblers'
)
GROUP BY a.name, a.gid, a.begin_date_year
ORDER BY a.begin_date_year NULLS LAST, a.name;

-- =============================================================================
-- 4. FESTIVAL/NEWGRASS ERA (1970s)
-- =============================================================================

SELECT
    a.name AS artist_name,
    a.gid AS artist_mbid,
    a.begin_date_year AS career_start,
    STRING_AGG(DISTINCT t.name, ', ' ORDER BY t.name) AS all_tags
FROM artist a
LEFT JOIN artist_tag at ON a.id = at.artist AND at.count >= 1
LEFT JOIN tag t ON at.tag = t.id
WHERE a.name IN (
    'Tony Rice',
    'J.D. Crowe',
    'J. D. Crowe',
    'J.D. Crowe & The New South',
    'The Seldom Scene',
    'Seldom Scene',
    'New Grass Revival',
    'Sam Bush',
    'John Hartford',
    'Norman Blake',
    'Vassar Clements'
)
GROUP BY a.name, a.gid, a.begin_date_year
ORDER BY a.begin_date_year NULLS LAST, a.name;

-- =============================================================================
-- 5. NEW TRADITIONALISTS ERA (1980s)
-- =============================================================================

SELECT
    a.name AS artist_name,
    a.gid AS artist_mbid,
    a.begin_date_year AS career_start,
    STRING_AGG(DISTINCT t.name, ', ' ORDER BY t.name) AS all_tags
FROM artist a
LEFT JOIN artist_tag at ON a.id = at.artist AND at.count >= 1
LEFT JOIN tag t ON at.tag = t.id
WHERE a.name IN (
    'Ricky Skaggs',
    'Marty Stuart',
    'Keith Whitley',
    'Vince Gill',
    'Del McCoury',
    'The Del McCoury Band',
    'Doyle Lawson',
    'Doyle Lawson & Quicksilver',
    'IIIrd Tyme Out'
)
GROUP BY a.name, a.gid, a.begin_date_year
ORDER BY a.begin_date_year NULLS LAST, a.name;

-- =============================================================================
-- 6. MODERN ERA (1990s-2000s+)
-- =============================================================================

-- Note: Dolly Parton is an edge case - she has covered bluegrass songs but is not
-- considered a "bluegrass artist" by most. She may appear in results but should
-- be categorized differently (perhaps "Country Artists Who Cover Bluegrass").

SELECT
    a.name AS artist_name,
    a.gid AS artist_mbid,
    a.begin_date_year AS career_start,
    STRING_AGG(DISTINCT t.name, ', ' ORDER BY t.name) AS all_tags
FROM artist a
LEFT JOIN artist_tag at ON a.id = at.artist AND at.count >= 1
LEFT JOIN tag t ON at.tag = t.id
WHERE a.name IN (
    -- Modern Era (1990s-2000s)
    'Alison Krauss',
    'Alison Krauss & Union Station',
    'Union Station',
    'Nickel Creek',
    'Chris Thile',
    'The Infamous Stringdusters',
    'Punch Brothers',
    'Trampled by Turtles',
    'The Steeldrivers',
    'Billy Strings',
    'Molly Tuttle',
    'Sierra Hull',
    -- Progressive/Contemporary additions
    'Noam Pikelny',
    'Hot Rize',
    'Béla Fleck',
    'Bela Fleck',
    'Michael Cleveland',
    'Michael Cleveland & Flamekeeper',
    'Tony Trischka',
    'Blue Highway',
    'The Grascals',
    'Lonesome River Band',
    'Mountain Heart',
    'Dailey & Vincent',
    'The Gibson Brothers',
    'Greensky Bluegrass',
    'Yonder Mountain String Band',
    'Railroad Earth',
    'Leftover Salmon'
)
GROUP BY a.name, a.gid, a.begin_date_year
ORDER BY a.begin_date_year NULLS LAST, a.name;

-- =============================================================================
-- 7. PRE-BLUEGRASS INFLUENCES (1920s-1945)
-- =============================================================================

SELECT
    a.name AS artist_name,
    a.gid AS artist_mbid,
    a.begin_date_year AS career_start,
    STRING_AGG(DISTINCT t.name, ', ' ORDER BY t.name) AS all_tags
FROM artist a
LEFT JOIN artist_tag at ON a.id = at.artist AND at.count >= 1
LEFT JOIN tag t ON at.tag = t.id
WHERE a.name IN (
    'The Carter Family',
    'Jimmie Rodgers',
    'The Monroe Brothers',
    'Charlie Monroe',
    'Uncle Dave Macon',
    'Gid Tanner',
    'Riley Puckett'
)
GROUP BY a.name, a.gid, a.begin_date_year
ORDER BY a.begin_date_year NULLS LAST, a.name;

-- =============================================================================
-- 8. AGGREGATE: Count songs by era-based artist lists
-- =============================================================================

-- This query finds how many recordings exist for each era's artists
-- Useful for understanding content depth per era

WITH era_artists AS (
    SELECT 'First Generation (1945-1960)' AS era, unnest(ARRAY[
        'Bill Monroe', 'Flatt & Scruggs', 'Lester Flatt', 'Earl Scruggs',
        'The Stanley Brothers', 'Ralph Stanley', 'Carter Stanley',
        'Jimmy Martin', 'Jim & Jesse', 'Don Reno', 'The Osborne Brothers'
    ]) AS artist_name
    UNION ALL
    SELECT 'Folk Revival (1960s)' AS era, unnest(ARRAY[
        'Doc Watson', 'The Country Gentlemen', 'Bill Keith',
        'Clarence White', 'The Kentucky Colonels'
    ]) AS artist_name
    UNION ALL
    SELECT 'Festival/Newgrass (1970s)' AS era, unnest(ARRAY[
        'Tony Rice', 'J.D. Crowe', 'The Seldom Scene', 'New Grass Revival',
        'Sam Bush', 'John Hartford', 'Norman Blake', 'Vassar Clements'
    ]) AS artist_name
    UNION ALL
    SELECT 'New Traditionalists (1980s)' AS era, unnest(ARRAY[
        'Ricky Skaggs', 'Marty Stuart', 'Keith Whitley', 'Vince Gill',
        'Del McCoury', 'Doyle Lawson'
    ]) AS artist_name
    UNION ALL
    SELECT 'Modern (1990s+)' AS era, unnest(ARRAY[
        'Alison Krauss', 'Nickel Creek', 'Chris Thile',
        'Punch Brothers', 'Billy Strings', 'Molly Tuttle'
    ]) AS artist_name
)
SELECT
    ea.era,
    COUNT(DISTINCT a.id) AS artists_found,
    COUNT(DISTINCT r.id) AS total_recordings
FROM era_artists ea
LEFT JOIN artist a ON LOWER(a.name) = LOWER(ea.artist_name)
LEFT JOIN artist_credit_name acn ON a.id = acn.artist
LEFT JOIN artist_credit ac ON acn.artist_credit = ac.id
LEFT JOIN recording r ON ac.id = r.artist_credit
GROUP BY ea.era
ORDER BY
    CASE ea.era
        WHEN 'First Generation (1945-1960)' THEN 1
        WHEN 'Folk Revival (1960s)' THEN 2
        WHEN 'Festival/Newgrass (1970s)' THEN 3
        WHEN 'New Traditionalists (1980s)' THEN 4
        WHEN 'Modern (1990s+)' THEN 5
    END;

-- =============================================================================
-- 9. BLUEGRASS TAG VARIANTS: Find all bluegrass-related tags
-- =============================================================================

SELECT
    t.name AS tag_name,
    COUNT(DISTINCT at.artist) AS artist_count,
    SUM(at.count) AS total_votes
FROM tag t
JOIN artist_tag at ON t.id = at.tag
WHERE LOWER(t.name) LIKE '%bluegrass%'
   OR LOWER(t.name) LIKE '%newgrass%'
   OR LOWER(t.name) IN ('old-time', 'old time', 'oldtime', 'string band')
GROUP BY t.name
ORDER BY total_votes DESC;

-- =============================================================================
-- 10. CROSS-REFERENCE: Artists in both our index and MusicBrainz bluegrass
-- =============================================================================

-- This is a template - replace the VALUES with actual artist names from our index
-- Run this after extracting unique artists from docs/data/index.jsonl

/*
WITH our_artists AS (
    SELECT unnest(ARRAY[
        'Bill Monroe',
        'Hank Williams',
        -- ... add more from index extraction
    ]) AS artist_name
)
SELECT
    oa.artist_name,
    CASE WHEN a.id IS NOT NULL THEN 'Found' ELSE 'Not Found' END AS in_musicbrainz,
    COALESCE(STRING_AGG(DISTINCT t.name, ', ' ORDER BY t.name), 'No tags') AS mb_tags
FROM our_artists oa
LEFT JOIN artist a ON LOWER(a.name) = LOWER(oa.artist_name)
LEFT JOIN artist_tag at ON a.id = at.artist AND at.count >= 1
LEFT JOIN tag t ON at.tag = t.id
GROUP BY oa.artist_name, a.id
ORDER BY oa.artist_name;
*/
