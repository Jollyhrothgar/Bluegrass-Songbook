-- Wave 3 readmission scoring (2026-08-07). Re-measures bluegrass coverage for
-- every site work against a local MusicBrainz dump, fixing both error
-- directions in the 2026-07-23 wave-1 `mbcov` (see FINDINGS.md §5.3).
--
-- Wave 1 matched site works to MusicBrainz by fuzzy title, which
--   INFLATED  country songs containing a standard's title
--             ("She Sang Amazing Grace" inherited Amazing Grace's 57), and
--   DEFLATED  works whose site title abbreviates the MusicBrainz title
--             ("Cabin Home On The Hill" vs "Little Cabin Home on the Hill" -> 2).
--
-- Note a pure work-MBID join does NOT work as a replacement: only 19.4% of
-- MusicBrainz recordings are linked to a work at all (24% among bluegrass
-- artists), so joining on work id alone discards ~80% of the evidence. The
-- scoring below therefore unions recording-title matches with work-link
-- expansion, and reports title ambiguity alongside the score.
--
-- Usage: psql "$PGURL" -f readmit_query.sql   (mb-db on port 5440)

CREATE SCHEMA IF NOT EXISTS bgs;

CREATE OR REPLACE FUNCTION bgs.norm(t text) RETURNS text AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(t,'')), '[^a-z0-9]+', ' ', 'g'),
           '^(the|a|an) ', ''),
         '\s+', ' ', 'g');
$$ LANGUAGE sql IMMUTABLE;

-- 1. bluegrass-family roster (same definition as wave 1's bg_query.sql)
DROP TABLE IF EXISTS bgs.bg_artist;
CREATE TABLE bgs.bg_artist AS
  SELECT at.artist AS id
  FROM musicbrainz.artist_tag at JOIN musicbrainz.tag t ON at.tag = t.id
  WHERE lower(t.name) IN ('bluegrass','traditional bluegrass','progressive bluegrass',
        'newgrass','old-time','old time','oldtime','old-time music','bluegrass gospel',
        'string band','stringband','appalachian')
    AND at.count >= 1
  UNION
  SELECT a2.id FROM musicbrainz.artist a2
  WHERE a2.name ILIKE ANY (ARRAY['Bill Monroe','Bill Monroe & His Blue Grass Boys',
    'Flatt & Scruggs','Lester Flatt','Earl Scruggs','The Stanley Brothers','Stanley Brothers',
    'Ralph Stanley','The Osborne Brothers','Jim & Jesse','Reno & Smiley','Jimmy Martin',
    'Mac Wiseman','The Country Gentlemen','The Seldom Scene','J.D. Crowe',
    'J.D. Crowe & the New South','Tony Rice','New Grass Revival','Hot Rize','David Grisman',
    'Del McCoury','The Del McCoury Band','Alison Krauss','Alison Krauss & Union Station',
    'The SteelDrivers','Billy Strings','Molly Tuttle','Punch Brothers','Sam Bush']);
CREATE INDEX ON bgs.bg_artist(id);

-- 2. every recording by those artists, normalized title + work link
DROP TABLE IF EXISTS bgs.bg_rec;
CREATE TABLE bgs.bg_rec AS
SELECT DISTINCT r.id AS rec_id, a.id AS artist_id, a.name AS artist_name,
       bgs.norm(r.name) AS ntitle, lrw.entity1 AS work_id
FROM musicbrainz.recording r
JOIN musicbrainz.artist_credit_name acn ON acn.artist_credit = r.artist_credit
JOIN musicbrainz.artist a ON a.id = acn.artist
JOIN bgs.bg_artist b ON b.id = a.id
LEFT JOIN musicbrainz.l_recording_work lrw ON lrw.entity0 = r.id;
CREATE INDEX ON bgs.bg_rec(ntitle);
CREATE INDEX ON bgs.bg_rec(work_id);

-- 3. site works: \copy id,title,artist,indexed from the built index + archive
--    (see readmit_export.py)

-- 4. hop 1 — exact normalized title match (kills wave 1's inflation)
DROP TABLE IF EXISTS bgs.hop1;
CREATE TABLE bgs.hop1 AS
SELECT sw.id AS site_id, br.artist_id, br.work_id
FROM bgs.site_work sw JOIN bgs.bg_rec br ON br.ntitle = sw.ntitle;
CREATE INDEX ON bgs.hop1(site_id);

-- 4b. bridge — the MusicBrainz title may carry 1-2 extra words around the site
--     title. STRICTLY one-directional (site title must be the shorter side),
--     which is what stops "She Sang Amazing Grace" from inheriting "Amazing
--     Grace"; there the site title is the longer one. Site title must be >= 3
--     words so generic names like "Blues" cannot sweep.
DROP TABLE IF EXISTS bgs.hop1b;
CREATE TABLE bgs.hop1b AS
SELECT sw.id AS site_id, br.artist_id, br.work_id
FROM bgs.site_work sw
JOIN bgs.bg_rec br
  ON br.ntitle LIKE '%' || sw.ntitle || '%'
 AND array_length(regexp_split_to_array(sw.ntitle,' '),1) >= 3
 AND array_length(regexp_split_to_array(br.ntitle,' '),1)
   - array_length(regexp_split_to_array(sw.ntitle,' '),1) BETWEEN 1 AND 2;
CREATE INDEX ON bgs.hop1b(site_id);

-- 5. work ids reachable from those recordings, plus MB works named the same
DROP TABLE IF EXISTS bgs.site_workid;
CREATE TABLE bgs.site_workid AS
SELECT DISTINCT site_id, work_id FROM bgs.hop1 WHERE work_id IS NOT NULL
UNION
SELECT sw.id, w.id FROM bgs.site_work sw
JOIN musicbrainz.work w ON bgs.norm(w.name) = sw.ntitle;
CREATE INDEX ON bgs.site_workid(site_id);
CREATE INDEX ON bgs.site_workid(work_id);

-- 6. coverage = distinct bluegrass artists across title matches AND work links
DROP TABLE IF EXISTS bgs.cov2;
CREATE TABLE bgs.cov2 AS
SELECT site_id, count(DISTINCT artist_id) AS cov FROM (
  SELECT site_id, artist_id FROM bgs.hop1
  UNION SELECT site_id, artist_id FROM bgs.hop1b
  UNION SELECT s.site_id, br.artist_id FROM bgs.site_workid s JOIN bgs.bg_rec br ON br.work_id = s.work_id
  UNION SELECT h.site_id, br.artist_id FROM bgs.hop1b h JOIN bgs.bg_rec br ON br.work_id = h.work_id
) u GROUP BY 1;
CREATE INDEX ON bgs.cov2(site_id);

-- 7. ambiguity — how many DISTINCT MusicBrainz works share this title. A score
--    on a title shared by 20+ works is a union across unrelated songs and must
--    NOT be trusted ("Take Me Home", "Country Boy", "Heaven").
DROP TABLE IF EXISTS bgs.ambig;
CREATE TABLE bgs.ambig AS
SELECT sw.id AS site_id, count(DISTINCT w.id) AS n_mb_works
FROM bgs.site_work sw
LEFT JOIN musicbrainz.work w ON bgs.norm(w.name) = sw.ntitle
GROUP BY 1;
CREATE INDEX ON bgs.ambig(site_id);

-- 8. wave 3 readmission set: pruned, coverage >= 5, title not ambiguous.
--    n_mb_works = 0 means NO MusicBrainz work entity carries this title, i.e.
--    nothing to be confused with -- it is included, not excluded.
SELECT sw.id, c.cov, a.n_mb_works, sw.title
FROM bgs.site_work sw
JOIN bgs.cov2 c ON c.site_id = sw.id
JOIN bgs.ambig a ON a.site_id = sw.id
WHERE sw.indexed = 0 AND c.cov >= 5 AND a.n_mb_works <= 4
ORDER BY c.cov DESC, sw.id;
