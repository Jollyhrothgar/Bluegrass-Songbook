#!/usr/bin/env python3
"""Export built index + archive rows for readmit_query.sql step 3.

    uv run python curation/decision-data/readmit_export.py > /tmp/site_works.csv
    psql "$PGURL" -c "\copy bgs.site_work(id,title,artist,indexed) FROM '/tmp/site_works.csv' WITH CSV"
"""
import csv, json, sys

w = csv.writer(sys.stdout)
for path, indexed in (('docs/data/index.jsonl', 1), ('docs/data/archive.jsonl', 0)):
    for line in open(path):
        s = json.loads(line)
        w.writerow([s['id'], s.get('title') or '', s.get('artist') or '', indexed])
