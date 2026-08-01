COPY (
  SELECT DISTINCT
    a.id            AS artist_id,
    a.name          AS artist_name,
    a.begin_date_year AS begin_year,
    lrw.entity1     AS work_id,
    COALESCE(w.name, r.name) AS title
  FROM musicbrainz.artist a
  JOIN musicbrainz.artist_credit_name acn ON a.id = acn.artist
  JOIN musicbrainz.artist_credit ac ON acn.artist_credit = ac.id
  JOIN musicbrainz.recording r ON r.artist_credit = ac.id
  LEFT JOIN musicbrainz.l_recording_work lrw ON lrw.entity0 = r.id
  LEFT JOIN musicbrainz.work w ON w.id = lrw.entity1
  WHERE a.id IN (
    SELECT at.artist
    FROM musicbrainz.artist_tag at
    JOIN musicbrainz.tag t ON at.tag = t.id
    WHERE lower(t.name) IN (
        'bluegrass','traditional bluegrass','progressive bluegrass','newgrass',
        'old-time','old time','oldtime','old-time music','bluegrass gospel',
        'string band','stringband','appalachian'
    )
      AND at.count >= 1
    UNION
    SELECT a2.id FROM musicbrainz.artist a2
    WHERE a2.name ILIKE ANY (ARRAY[
      'Bill Monroe','Bill Monroe & His Blue Grass Boys','Flatt & Scruggs','Lester Flatt','Earl Scruggs',
      'The Stanley Brothers','Stanley Brothers','Ralph Stanley','The Osborne Brothers','Jim & Jesse',
      'Reno & Smiley','Jimmy Martin','Mac Wiseman','The Country Gentlemen','The Seldom Scene',
      'J.D. Crowe','J.D. Crowe & the New South','Tony Rice','New Grass Revival','Hot Rize',
      'David Grisman','Del McCoury','The Del McCoury Band','Alison Krauss','Alison Krauss & Union Station',
      'The SteelDrivers','Billy Strings','Molly Tuttle','Punch Brothers','Sam Bush'
    ])
  )
) TO STDOUT WITH CSV HEADER;
