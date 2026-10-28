# ---
# jupyter:
#   jupytext:
#     notebook_metadata_filter: -jupytext.text_representation.jupytext_version
#     text_representation:
#       extension: .py
#       format_name: percent
#       format_version: '1.3'
#   kernelspec:
#     display_name: Python 3 (ipykernel)
#     language: python
#     name: python3
# ---

# %% [markdown]
# # What Is Bluegrass? A Data-Driven Analysis
#
# This notebook explores how we use MusicBrainz data to mathematically define what makes a song "bluegrass."
#
# ## Data Sources & Code
#
# **Source Code:**
# - Grassiness scoring: `scripts/lib/tagging/grassiness.py`
# - Artist database builder: `scripts/lib/tagging/build_artist_database.py`
# - Tag enrichment integration: `scripts/lib/tag_enrichment.py`
#
# **Data Files:**
# - `docs/data/grassiness_scores.json` - Pre-computed scores for all songs
# - `docs/data/bluegrass_recordings.json` - Cache of bluegrass artist recordings from MusicBrainz
# - `docs/data/bluegrass_tagged.json` - Cache of bluegrass-tagged recordings from MusicBrainz
# - `docs/data/bluegrass_artist_database.json` - Artist metadata (years active, recording counts)
#
# **External Sources:**
# - [Wikipedia: List of bluegrass musicians](https://en.wikipedia.org/wiki/List_of_bluegrass_musicians)
# - [Wikipedia: List of bluegrass bands](https://en.wikipedia.org/wiki/List_of_bluegrass_bands)
# - [Roots Music Report: Contemporary Bluegrass Chart](https://www.rootsmusicreport.com)
# - [AllMusic: Contemporary Bluegrass](https://www.allmusic.com)
#
# **MusicBrainz Database:**
# - Local PostgreSQL instance on port 5440
# - Queries in `scripts/lib/tagging/grassiness.py`

# %%

# %%
import json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from collections import defaultdict
from pathlib import Path

# Style setup
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette('husl')
plt.rcParams['figure.figsize'] = (12, 6)
plt.rcParams['font.size'] = 12

# %% [markdown]
# ## How to Refresh the Data
#
# To update the grassiness scores with new data from MusicBrainz:
#
# ```bash
# # 1. Start the MusicBrainz database (requires local setup)
# # See: /Users/mike/workspace/music_brainz/mb-db/scripts/db start
#
# # 2. Build the artist database from Wikipedia/charts
# uv run python scripts/lib/tagging/build_artist_database.py --build
#
# # 3. Rebuild the recordings cache (queries MusicBrainz for all artist recordings)
# MB_PORT=5440 uv run python scripts/lib/tagging/grassiness.py --build-all
#
# # 4. Re-score all songs in the index
# uv run python scripts/lib/tagging/grassiness.py --score-index
#
# # 5. Rebuild the search index to include new scores
# ./scripts/bootstrap --quick
# ```
#
# **Scoring Formula:**
# ```python
# # For each song title, match against bluegrass artist recordings
# artist_score = sum(tier_weight * min(recording_count, 3) for each matching artist)
# tag_score = musicbrainz_tag_votes  # from recordings/releases tagged "bluegrass"
# total_score = artist_score + min(tag_score, 10)  # cap tag contribution
#
# # Tier weights (era-based):
# # Tier 1 (founding, pre-1960): weight = 4
# # Tier 2 (classic, 1960-1989): weight = 2  
# # Tier 3 (modern, 1990+): weight = 1
# ```

# %%
# Key MusicBrainz Queries (for reference)
#
# These queries are in scripts/lib/tagging/grassiness.py
# Run them with: MB_PORT=5440 uv run python scripts/lib/tagging/grassiness.py --build-all

# 1. Fetch all recordings by bluegrass artists:
ARTIST_RECORDINGS_QUERY = """
SELECT r.name as recording_name, ai.name as artist_name, COUNT(*) as recording_count
FROM musicbrainz.artist a
JOIN musicbrainz.artist_credit_name acn ON acn.artist = a.id
JOIN musicbrainz.recording r ON r.artist_credit = acn.artist_credit
WHERE a.name = ANY(%s)  -- list of 292 bluegrass artists
GROUP BY r.name, ai.name
"""

# 2. Fetch recordings tagged "bluegrass" in MusicBrainz:
TAGGED_RECORDINGS_QUERY = """
SELECT r.name as recording_name, SUM(rt.count) as tag_score
FROM musicbrainz.recording r
JOIN musicbrainz.recording_tag rt ON rt.recording = r.id
JOIN musicbrainz.tag t ON t.id = rt.tag
WHERE lower(t.name) IN ('bluegrass', 'progressive bluegrass', 'newgrass', 'old-time', 'appalachian')
GROUP BY r.name
HAVING SUM(rt.count) >= 1
"""

# 3. Fetch recordings from bluegrass-tagged albums:
TAGGED_RELEASES_QUERY = """
SELECT r.name as recording_name, MAX(rgt.count) as tag_score
FROM musicbrainz.recording r
JOIN musicbrainz.track t ON t.recording = r.id
JOIN musicbrainz.medium m ON t.medium = m.id
JOIN musicbrainz.release rel ON m.release = rel.id
JOIN musicbrainz.release_group rg ON rel.release_group = rg.id
JOIN musicbrainz.release_group_tag rgt ON rgt.release_group = rg.id
JOIN musicbrainz.tag tag ON tag.id = rgt.tag
WHERE lower(tag.name) IN ('bluegrass', 'progressive bluegrass', 'newgrass', 'old-time', 'appalachian')
GROUP BY r.name
"""

print("Queries shown above - see grassiness.py for full implementation")

# %%
# Load the grassiness scores
with open('../docs/data/grassiness_scores.json') as f:
    scores_raw = json.load(f)

# Convert to DataFrame
scores_data = []
for song_id, data in scores_raw.items():
    scores_data.append({
        'song_id': song_id,
        'title': data.get('title', song_id),
        'score': data['score'],
        'artist_score': data.get('artist_score', 0),
        'tag_score': data.get('tag_score', 0),
        'num_artists': len(data.get('artists', [])),
        'artists': data.get('artists', [])
    })

df = pd.DataFrame(scores_data)
print(f"Loaded {len(df)} songs with grassiness scores")

# %% [markdown]
# ## Score Distribution
#
# How are grassiness scores distributed across all songs?

# %%
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

# Histogram of all scores
ax1 = axes[0]
ax1.hist(df['score'], bins=50, edgecolor='white', alpha=0.8, color='#2563eb')
ax1.axvline(x=50, color='red', linestyle='--', linewidth=2, label='Standard threshold (50)')
ax1.axvline(x=20, color='orange', linestyle='--', linewidth=2, label='Bluegrass threshold (20)')
ax1.set_xlabel('Grassiness Score')
ax1.set_ylabel('Number of Songs')
ax1.set_title('Distribution of Grassiness Scores')
ax1.legend()

# Bucket counts
ax2 = axes[1]
buckets = {
    '100+': len(df[df['score'] >= 100]),
    '50-99': len(df[(df['score'] >= 50) & (df['score'] < 100)]),
    '20-49': len(df[(df['score'] >= 20) & (df['score'] < 50)]),
    '10-19': len(df[(df['score'] >= 10) & (df['score'] < 20)]),
    '5-9': len(df[(df['score'] >= 5) & (df['score'] < 10)]),
    '1-4': len(df[(df['score'] >= 1) & (df['score'] < 5)]),
}
colors = ['#1e40af', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe']
bars = ax2.barh(list(buckets.keys())[::-1], list(buckets.values())[::-1], color=colors[::-1])
ax2.set_xlabel('Number of Songs')
ax2.set_title('Songs by Score Bucket')

# Add count labels
for bar, count in zip(bars, list(buckets.values())[::-1]):
    ax2.text(bar.get_width() + 50, bar.get_y() + bar.get_height()/2, 
             f'{count:,}', va='center', fontsize=10)

plt.tight_layout()
plt.savefig('grassiness_distribution.png', dpi=150, bbox_inches='tight')
plt.show()

# %% [markdown]
# ## Top Bluegrass Standards
#
# What are the highest-scoring bluegrass songs?

# %%
# Top 15 songs (deduplicated by title)
top_songs = df.sort_values('score', ascending=False).drop_duplicates('title').head(15)

fig, ax = plt.subplots(figsize=(12, 8))
colors = plt.cm.Blues(top_songs['score'] / top_songs['score'].max())
bars = ax.barh(range(len(top_songs)), top_songs['score'], color=colors)
ax.set_yticks(range(len(top_songs)))
ax.set_yticklabels(top_songs['title'])
ax.invert_yaxis()
ax.set_xlabel('Grassiness Score')
ax.set_title('Top 15 Bluegrass Standards by Grassiness Score')

# Add artist count labels
for i, (bar, row) in enumerate(zip(bars, top_songs.itertuples())):
    ax.text(bar.get_width() + 2, bar.get_y() + bar.get_height()/2,
            f'{row.num_artists} artists', va='center', fontsize=9, color='gray')

plt.tight_layout()
plt.savefig('top_bluegrass_standards.png', dpi=150, bbox_inches='tight')
plt.show()

# %% [markdown]
# ## Artist Score vs Tag Score
#
# Our scoring combines two signals: artist covers (primary) and MusicBrainz tags (secondary). How do they relate?

# %%
fig, ax = plt.subplots(figsize=(10, 8))

# Scatter plot with color by total score
scatter = ax.scatter(df['artist_score'], df['tag_score'], 
                     c=df['score'], cmap='viridis', alpha=0.5, s=20)
plt.colorbar(scatter, label='Total Score')

ax.set_xlabel('Artist Score (bluegrass artist covers)')
ax.set_ylabel('Tag Score (MusicBrainz community tags)')
ax.set_title('Two Signals: Artist Covers vs Community Tags')

# Add quadrant labels
ax.axhline(y=5, color='gray', linestyle='--', alpha=0.5)
ax.axvline(x=20, color='gray', linestyle='--', alpha=0.5)
ax.text(100, 2, 'Strong artist signal,\nweak tags', fontsize=9, alpha=0.7)
ax.text(5, 20, 'Weak artist signal,\nstrong tags', fontsize=9, alpha=0.7)

plt.tight_layout()
plt.savefig('artist_vs_tag_scores.png', dpi=150, bbox_inches='tight')
plt.show()

# %% [markdown]
# ## Core Artist Analysis
#
# How do we set thresholds? By analyzing what percentage of core bluegrass artists' catalogs pass each threshold.

# %%
# Build artist -> scores mapping
artist_songs = defaultdict(list)
for _, row in df.iterrows():
    for artist in row['artists']:
        artist_songs[artist].append(row['score'])

# Core bluegrass artists
core_artists = [
    'Bill Monroe', 'The Stanley Brothers', 'Ralph Stanley', 'Lester Flatt',
    'Earl Scruggs', 'Jimmy Martin', 'Mac Wiseman', 'Don Reno',
    'The Osborne Brothers', 'Doc Watson', 'The Country Gentlemen',
    'Jim and Jesse', 'Tony Rice', 'J.D. Crowe', 'Del McCoury'
]

# Calculate cumulative percentages
thresholds = [100, 50, 20, 10, 5]
artist_data = []

for artist in core_artists:
    if artist not in artist_songs:
        continue
    scores = artist_songs[artist]
    total = len(scores)
    row = {'artist': artist, 'total': total}
    for t in thresholds:
        pct = sum(1 for s in scores if s >= t) / total * 100
        row[f'>={t}'] = pct
    artist_data.append(row)

core_df = pd.DataFrame(artist_data)

# %%
# Heatmap of core artist thresholds
fig, ax = plt.subplots(figsize=(10, 8))

# Prepare data for heatmap
heatmap_data = core_df.set_index('artist')[[f'>={t}' for t in thresholds]]
heatmap_data.columns = [f'≥{t}' for t in thresholds]

sns.heatmap(heatmap_data, annot=True, fmt='.0f', cmap='Blues', 
            cbar_kws={'label': '% of catalog'}, ax=ax,
            linewidths=0.5, linecolor='white')
ax.set_title('What % of Each Artist\'s Catalog Passes Each Threshold?')
ax.set_xlabel('Score Threshold')
ax.set_ylabel('')

plt.tight_layout()
plt.savefig('core_artist_thresholds.png', dpi=150, bbox_inches='tight')
plt.show()

# %%
# Average across all core artists
avg_pcts = [core_df[f'>={t}'].mean() for t in thresholds]

fig, ax = plt.subplots(figsize=(10, 6))
bars = ax.bar([f'≥{t}' for t in thresholds], avg_pcts, color='#2563eb', edgecolor='white')
ax.set_ylabel('% of Core Artist Catalog')
ax.set_xlabel('Score Threshold')
ax.set_title('Average: What % of Core Bluegrass Artist Catalogs Pass Each Threshold?')
ax.set_ylim(0, 100)

# Add percentage labels
for bar, pct in zip(bars, avg_pcts):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2,
            f'{pct:.0f}%', ha='center', fontsize=12, fontweight='bold')

# Add threshold interpretation
ax.axhline(y=70, color='green', linestyle='--', alpha=0.7)
ax.text(4.5, 72, '71% at ≥20 → "Bluegrass" threshold', fontsize=10, color='green')
ax.axhline(y=37, color='orange', linestyle='--', alpha=0.7)
ax.text(4.5, 39, '37% at ≥50 → "Standard" threshold', fontsize=10, color='orange')

plt.tight_layout()
plt.savefig('threshold_analysis.png', dpi=150, bbox_inches='tight')
plt.show()

# %% [markdown]
# ## Bluegrass-Focused vs Crossover Artists
#
# Not all artists have the same catalog distribution. Some stick to bluegrass, others cover lots of genres.

# %%
# Compare specific artists
compare_artists = {
    'Earl Scruggs': '#2563eb',
    'Bill Monroe': '#16a34a', 
    'Doyle Lawson & Quicksilver': '#dc2626',
    'Rhonda Vincent': '#d97706',
}

fig, ax = plt.subplots(figsize=(12, 6))

x = range(len(thresholds))
width = 0.2

for i, (artist, color) in enumerate(compare_artists.items()):
    if artist not in artist_songs:
        continue
    scores = artist_songs[artist]
    total = len(scores)
    pcts = [sum(1 for s in scores if s >= t) / total * 100 for t in thresholds]
    offset = (i - len(compare_artists)/2 + 0.5) * width
    ax.bar([xi + offset for xi in x], pcts, width, label=f'{artist} ({total} songs)', color=color)

ax.set_xticks(x)
ax.set_xticklabels([f'≥{t}' for t in thresholds])
ax.set_ylabel('% of Catalog')
ax.set_xlabel('Score Threshold')
ax.set_title('Catalog Distribution: Bluegrass-Focused vs Crossover Artists')
ax.legend(loc='upper right')
ax.set_ylim(0, 100)

plt.tight_layout()
plt.savefig('artist_comparison.png', dpi=150, bbox_inches='tight')
plt.show()

# %% [markdown]
# ## Number of Covering Artists vs Score
#
# Is there a relationship between how many bluegrass artists covered a song and its score?

# %%
fig, ax = plt.subplots(figsize=(10, 6))

# Only songs with at least one artist cover
covered = df[df['num_artists'] > 0]

ax.scatter(covered['num_artists'], covered['score'], alpha=0.4, s=30, c='#2563eb')
ax.set_xlabel('Number of Bluegrass Artists Who Covered the Song')
ax.set_ylabel('Grassiness Score')
ax.set_title('More Covers = Higher Score (as expected)')

# Add trend line
z = np.polyfit(covered['num_artists'], covered['score'], 1)
p = np.poly1d(z)
x_line = range(0, int(covered['num_artists'].max()) + 1)
ax.plot(x_line, p(x_line), 'r--', alpha=0.8, linewidth=2, label=f'Trend')

# Label some outliers
top_covered = covered.nlargest(3, 'num_artists')
for _, row in top_covered.iterrows():
    ax.annotate(row['title'], (row['num_artists'], row['score']),
                xytext=(5, 5), textcoords='offset points', fontsize=9)

ax.legend()
plt.tight_layout()
plt.savefig('covers_vs_score.png', dpi=150, bbox_inches='tight')
plt.show()

# %%
# Load artist database
with open('../docs/data/bluegrass_artist_database.json') as f:
    artist_db = json.load(f)

artists_df = pd.DataFrame([
    {
        'name': name,
        'type': data.get('type'),
        'begin_year': data.get('begin_year'),
        'recording_count': data.get('recording_count', 0),
        'release_count': data.get('release_count', 0),
    }
    for name, data in artist_db.get('artists', {}).items()
])

# Add era classification
def classify_era(year):
    if pd.isna(year):
        return 'Unknown'
    elif year < 1960:
        return 'Founding (pre-1960)'
    elif year < 1990:
        return 'Classic (1960-1989)'
    else:
        return 'Modern (1990+)'

artists_df['era'] = artists_df['begin_year'].apply(classify_era)

print(f"Total artists in database: {len(artists_df)}")
print(f"\nBy era:")
print(artists_df['era'].value_counts())

# Top 20 by recording count
print(f"\nTop 20 artists by recording count:")
artists_df.nlargest(20, 'recording_count')[['name', 'era', 'begin_year', 'recording_count']]

# %%
# Visualize artist era distribution
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

# Era pie chart
ax1 = axes[0]
era_counts = artists_df['era'].value_counts()
colors = {'Founding (pre-1960)': '#1e40af', 'Classic (1960-1989)': '#3b82f6', 
          'Modern (1990+)': '#93c5fd', 'Unknown': '#e5e7eb'}
ax1.pie(era_counts.values, labels=era_counts.index, autopct='%1.0f%%',
        colors=[colors[e] for e in era_counts.index], startangle=90)
ax1.set_title('Bluegrass Artists by Era')

# Recording count by era
ax2 = axes[1]
era_order = ['Founding (pre-1960)', 'Classic (1960-1989)', 'Modern (1990+)', 'Unknown']
era_recordings = artists_df.groupby('era')['recording_count'].sum().reindex(era_order)
bars = ax2.bar(range(len(era_recordings)), era_recordings.values, 
               color=[colors[e] for e in era_order])
ax2.set_xticks(range(len(era_recordings)))
ax2.set_xticklabels([e.split('(')[0].strip() for e in era_order], rotation=15)
ax2.set_ylabel('Total Recordings in MusicBrainz')
ax2.set_title('Recording Volume by Era')

# Add count labels
for bar, count in zip(bars, era_recordings.values):
    ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1000,
             f'{count:,.0f}', ha='center', fontsize=10)

plt.tight_layout()
plt.savefig('artist_era_distribution.png', dpi=150, bbox_inches='tight')
plt.show()

# %% [markdown]
# ## Artist Database
#
# Let's look at the bluegrass artists we're tracking:

# %% [markdown]
# ## Summary
#
# Our grassiness scoring system:
#
# 1. **292 bluegrass artists** from Wikipedia and contemporary charts
# 2. **Era-based weighting**: Founding (4x) > Classic (2x) > Modern (1x)
# 3. **Two signals**: Artist covers (primary) + MusicBrainz tags (secondary)
# 4. **Empirical thresholds**: 50+ = Standard, 20+ = Bluegrass
#
# Result:
# - **205 Bluegrass Standards** (score ≥ 50)
# - **1,199 Bluegrass songs** (score ≥ 20)

# %%
# Final summary stats
print(f"Total songs scored: {len(df):,}")
print(f"Bluegrass Standards (≥50): {len(df[df['score'] >= 50]):,}")
print(f"Bluegrass (≥20): {len(df[df['score'] >= 20]):,}")
print(f"Borderline (10-19): {len(df[(df['score'] >= 10) & (df['score'] < 20)]):,}")
print(f"Crossover (<10): {len(df[df['score'] < 10]):,}")

# %%
