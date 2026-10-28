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
# # Bluegrass Songbook Analytics Dashboard
#
# Analytics for visitor engagement, user activity, and content curation.
#
# **Data caveats** (read before trusting a number):
# - `analytics_events` has a hole: `log_events` failed from 2026-01-07 until the
#   fix went live on 2026-10-01 (fix-it list A2). Event-based trends start there.
# - Events carry only an anonymous `visitor_id` (localStorage). Nothing links an
#   event to a signed-in account, so "signed-in" activity below comes from the
#   tables that do have `user_id` (votes, tags, lists, favorites) — contributors,
#   not readers.
# - `visitor_stats.unique_visitors` counts visitors seen **for the first time
#   ever** that day, not daily uniques. It is shown here as `new_visitors`.
# - PostgREST returns at most 1,000 rows per request; every query here pages
#   through `fetch_all` so totals are not silently capped.

# %%
# Setup
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client, ClientOptions
import pandas as pd
import matplotlib.pyplot as plt

# Load credentials from .env
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')

# Create client with session management disabled (server-side pattern)
# This avoids session persistence and reduces credential leak risk
supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY,
    options=ClientOptions(
        auto_refresh_token=False,
        persist_session=False,
    )
)
print('Connected to Supabase (service role, no session)')


PAGE_SIZE = 1000  # PostgREST max rows per request


def fetch_all(table, columns='*', order='created_at', **eq):
    """Every row of `table`, paged past the 1,000-row API cap."""
    rows, start = [], 0
    while True:
        query = supabase.table(table).select(columns)
        for col, val in eq.items():
            query = query.eq(col, val)
        if order:
            query = query.order(order)
        batch = query.range(start, start + PAGE_SIZE - 1).execute().data
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return pd.DataFrame(rows)
        start += PAGE_SIZE


def week_start(ts):
    """Monday (UTC) of the week each timestamp falls in."""
    return ts.dt.tz_convert('UTC').dt.tz_localize(None).dt.to_period('W-SUN').dt.start_time


EVENTS_RELIABLE_FROM = pd.Timestamp('2026-10-01', tz='UTC')

# Mike's own browsers, left out of visitor and event counts. Open
# https://bluegrassbook.com/?internal=1 in a browser to stop it counting from
# now on; the toast shows its visitor id — add it here to drop its history.
INTERNAL_VISITORS = {
}


# %% [markdown]
# ## Visitor Statistics

# %%
# Daily visitor stats (from log_visit, which runs on every page load)
df_visits = fetch_all('visitor_stats', 'date, page_views, unique_visitors', order='date')

if not df_visits.empty:
    # log_visit only bumps this column for a visitor_id it has never seen
    df_visits = df_visits.rename(columns={'unique_visitors': 'new_visitors'})
    df_visits['date'] = pd.to_datetime(df_visits['date'])
    df_visits = df_visits.sort_values('date')
    df_recent = df_visits[df_visits['date'] >= df_visits['date'].max() - pd.Timedelta(days=29)]

    print(f"All-time page views: {df_visits['page_views'].sum():,}")
    print(f"All-time new visitors: {df_visits['new_visitors'].sum():,}")
    print(f"\nLast 7 days:")
    display(df_recent.tail(7))
else:
    print('No visitor data yet')

# %%
# Plot daily visitors
if not df_visits.empty:
    fig, ax = plt.subplots(figsize=(12, 4))
    ax.bar(df_recent['date'], df_recent['page_views'], alpha=0.7, label='Page Views')
    ax.plot(df_recent['date'], df_recent['new_visitors'], 'ro-', label='New Visitors')
    ax.set_xlabel('Date')
    ax.set_ylabel('Count')
    ax.set_title('Daily Traffic (Last 30 Days)')
    ax.legend()
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.show()

# %% [markdown]
# ## Weekly Active Users
#
# Two populations that **cannot be joined** (see caveats above), so they are
# shown side by side rather than as a split of one total:
#
# - **App visitors** — distinct `visitor_id` per week in `analytics_events`
#   (anyone who loaded the app with JS, signed in or not). Weeks before
#   2026-10-01 are incomplete.
# - **Signed-in contributors** — distinct `user_id` per week that voted, tagged,
#   favorited, or created/edited a list. A floor on signed-in WAU: a signed-in
#   user who only reads never shows up.

# %%
# Load all events once; later cells reuse df_all_events
df_all_events = fetch_all('analytics_events', 'visitor_id, event_name, properties, created_at')
df_all_events = df_all_events[~df_all_events['visitor_id'].isin(INTERNAL_VISITORS)]
df_all_events['created_at'] = pd.to_datetime(df_all_events['created_at'], format='ISO8601')
df_all_events['week'] = week_start(df_all_events['created_at'])
print(f"Events loaded: {len(df_all_events):,} "
      f"({df_all_events['created_at'].min():%Y-%m-%d} to {df_all_events['created_at'].max():%Y-%m-%d})")

# Signed-in activity: (user_id, timestamp) from every table that records a user
user_activity = []
for table, cols in [('song_votes', ['created_at', 'updated_at']),
                    ('genre_suggestions', ['created_at']),
                    ('tag_votes', ['created_at']),
                    ('user_favorites', ['created_at']),
                    ('user_lists', ['created_at'])]:
    df = fetch_all(table, ', '.join(['user_id'] + cols))
    for col in cols:
        if not df.empty:
            user_activity.append(df[['user_id', col]].rename(columns={col: 'ts'}).assign(source=table))

# List items have no user_id; attribute them to the list's owner
df_items = fetch_all('user_list_items', order=None)
df_owners = fetch_all('user_lists', 'id, user_id')
item_ts = next((c for c in ('created_at', 'added_at', 'updated_at') if c in df_items.columns), None)
if item_ts and not df_owners.empty:
    df_items = df_items.merge(df_owners, left_on='list_id', right_on='id')
    user_activity.append(df_items[['user_id', item_ts]].rename(columns={item_ts: 'ts'}).assign(source='user_list_items'))
elif not df_items.empty:
    print(f"user_list_items has no timestamp column ({list(df_items.columns)}); skipped")

df_user_activity = pd.concat(user_activity, ignore_index=True).dropna(subset=['ts'])
df_user_activity['ts'] = pd.to_datetime(df_user_activity['ts'], format='ISO8601')
df_user_activity['week'] = week_start(df_user_activity['ts'])
print(f"Signed-in actions loaded: {len(df_user_activity):,} from {df_user_activity['user_id'].nunique()} users")

# %%
# WAU table: app visitors vs signed-in contributors
wau_visitors = df_all_events.groupby('week')['visitor_id'].nunique().rename('app_visitors')
wau_new = (df_all_events.groupby('visitor_id')['week'].min()
           .value_counts().rename('first_time_visitors'))
wau_users = df_user_activity.groupby('week')['user_id'].nunique().rename('signed_in_contributors')

df_wau = pd.concat([wau_visitors, wau_new, wau_users], axis=1).fillna(0).astype(int).sort_index()
df_wau['returning_visitors'] = df_wau['app_visitors'] - df_wau['first_time_visitors']
df_wau['events_complete'] = df_wau.index >= EVENTS_RELIABLE_FROM.tz_localize(None).to_period('W-SUN').start_time
df_wau = df_wau[['app_visitors', 'first_time_visitors', 'returning_visitors',
                 'signed_in_contributors', 'events_complete']]
df_wau.index.name = 'week_of'

print("Weekly active users (weeks start Monday, UTC):")
print("Note: the current week is partial.\n")
display(df_wau[df_wau.index >= pd.Timestamp('2026-09-01')])

# %%
# Plot WAU (complete-event weeks only)
plot_wau = df_wau[df_wau['events_complete']]
if not plot_wau.empty:
    fig, ax = plt.subplots(figsize=(12, 4))
    ax.bar(plot_wau.index, plot_wau['first_time_visitors'], width=5, label='First-time visitors')
    ax.bar(plot_wau.index, plot_wau['returning_visitors'], width=5,
           bottom=plot_wau['first_time_visitors'], label='Returning visitors')
    ax.plot(plot_wau.index, plot_wau['signed_in_contributors'], 'ko-', label='Signed-in contributors')
    ax.set_xlabel('Week of')
    ax.set_ylabel('Weekly active')
    ax.set_title('Weekly Active Users (app events since 2026-10-01)')
    ax.legend()
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.show()

# %%
# Signed-in contributors: what they did, by week
recent_actions = df_user_activity[df_user_activity['week'] >= pd.Timestamp('2026-09-01')]
if not recent_actions.empty:
    print("Signed-in users per week, by action (one user can appear in several):")
    display(recent_actions.groupby(['week', 'source'])['user_id'].nunique().unstack(fill_value=0))
else:
    print('No signed-in activity since 2026-09-01')

# %% [markdown]
# ## User Activity

# %%
# Song votes, genre suggestions, tag votes (all-time)
df_votes = fetch_all('song_votes', 'user_id, song_id')
df_suggestions = fetch_all('genre_suggestions', 'user_id, song_id, raw_tag')
df_tag_votes = fetch_all('tag_votes', 'user_id, song_id, tag_name, vote_value')

print(f"Total song votes: {len(df_votes)}")
print(f"Total genre suggestions: {len(df_suggestions)}")
print(f"Total tag votes: {len(df_tag_votes)}")

# %%
# Top users by total activity
df_activity = (pd.concat([df[['user_id']] for df in (df_votes, df_suggestions, df_tag_votes) if not df.empty])
               .value_counts().rename('total_actions').reset_index()
               if not (df_votes.empty and df_suggestions.empty and df_tag_votes.empty) else pd.DataFrame())

if not df_activity.empty:
    print(f"Total active users: {len(df_activity)}")
    print(f"\nTop 10 most active users:")
    display(df_activity.head(10))
else:
    print('No user activity yet')

# %% [markdown]
# ## Song Engagement

# %%
# Most voted songs
if not df_votes.empty:
    top_voted = df_votes.groupby('song_id').size().sort_values(ascending=False).head(10)
    print("Top 10 most voted songs:")
    for song_id, count in top_voted.items():
        print(f"  {song_id}: {count} votes")
else:
    print('No song votes yet')

# %%
# Most tagged songs (genre suggestions)
if not df_suggestions.empty:
    top_tagged = df_suggestions.groupby('song_id').size().sort_values(ascending=False).head(10)
    print("Top 10 most tagged songs:")
    for song_id, count in top_tagged.items():
        print(f"  {song_id}: {count} tag suggestions")
else:
    print('No genre suggestions yet')

# %% [markdown]
# ## Tag Analytics

# %%
# Most suggested tags
if not df_suggestions.empty:
    tag_counts = df_suggestions['raw_tag'].value_counts().head(20)
    print("Top 20 suggested tags:")
    for tag, count in tag_counts.items():
        print(f"  {tag}: {count}")
else:
    print('No tag suggestions yet')

# %%
# Tag vote summary
if not df_tag_votes.empty:
    tag_vote_summary = df_tag_votes.groupby('tag_name').agg(
        upvotes=('vote_value', lambda x: (x == 1).sum()),
        downvotes=('vote_value', lambda x: (x == -1).sum()),
        net_score=('vote_value', 'sum')
    ).sort_values('net_score', ascending=False)
    
    print("Tag vote summary (top 15):")
    display(tag_vote_summary.head(15))
else:
    print('No tag votes yet')

# %% [markdown]
# ## Visitor Retention

# %%
# Visitor first/last seen analysis (log_visit; includes non-JS / static-page hits)
df_visitors = fetch_all('visitors', 'visitor_id, first_seen, last_seen', order='first_seen')
df_visitors = df_visitors[~df_visitors['visitor_id'].isin(INTERNAL_VISITORS)]

if not df_visitors.empty:
    df_visitors['first_seen'] = pd.to_datetime(df_visitors['first_seen'], format='ISO8601')
    df_visitors['last_seen'] = pd.to_datetime(df_visitors['last_seen'], format='ISO8601')

    # Returning visitors (last_seen != first_seen)
    df_visitors['is_returning'] = df_visitors['last_seen'].dt.date != df_visitors['first_seen'].dt.date
    returning_count = df_visitors['is_returning'].sum()
    total_visitors = len(df_visitors)

    print(f"Total unique visitors: {total_visitors:,}")
    print(f"Returning visitors: {returning_count:,} ({100*returning_count/total_visitors:.1f}%)")
    print(f"One-time visitors: {total_visitors - returning_count:,}")

    # Current snapshot only: visitors keeps just the latest last_seen, so no history
    now = pd.Timestamp.now(tz='UTC')
    active_7d = df_visitors[df_visitors['last_seen'] >= now - pd.Timedelta(days=7)]
    print(f"\nSeen in last 7 days: {len(active_7d):,} "
          f"({active_7d['is_returning'].sum():,} returning)")

    # New visitors by day
    new_by_day = df_visitors.groupby(df_visitors['first_seen'].dt.date).size().tail(14)
    print(f"\nNew visitors per day (last 14 days):")
    for date, count in new_by_day.items():
        print(f"  {date}: {count}")
else:
    print('No visitor data yet')

# %% [markdown]
# ## User Lists

# %%
# User-created lists
df_lists = fetch_all('user_lists', 'id, name, user_id, created_at')

if not df_lists.empty:
    print(f"Total user lists: {len(df_lists)}")
    print(f"Users with lists: {df_lists['user_id'].nunique()}")

    # Songs per list
    df_list_items = fetch_all('user_list_items', 'list_id, song_id', order=None)
    if not df_list_items.empty:
        songs_per_list = df_list_items.groupby('list_id').size()
        print(f"Total songs in lists: {len(df_list_items)}")
        print(f"Average songs per list: {songs_per_list.mean():.1f}")
else:
    print('No user lists yet')


# %% [markdown]
# ## Behavioral Analytics
#
# Event-based analytics tracking user interactions. All cells below read
# `df_all_events` (loaded in Weekly Active Users), so they cover every event,
# not a sample.

# %%
def props(event_name):
    """Events of one type with their properties expanded into columns."""
    df = df_all_events[df_all_events['event_name'] == event_name]
    expanded = pd.json_normalize(df['properties'].apply(lambda x: x or {}).tolist())
    return pd.concat([df.reset_index(drop=True), expanded], axis=1)


print(f"Total events tracked: {len(df_all_events):,}")
print(f"Since {EVENTS_RELIABLE_FROM:%Y-%m-%d}: "
      f"{(df_all_events['created_at'] >= EVENTS_RELIABLE_FROM).sum():,}")
print(f"\nEvent breakdown (all time):")
for event, count in df_all_events['event_name'].value_counts().items():
    print(f"  {event}: {count}")

# %%
# Most viewed songs (from analytics)
df_views = props('song_view')

if not df_views.empty and 'song_id' in df_views:
    df_views['source'] = df_views.get('source', pd.Series(dtype=str)).fillna('unknown')
    df_views = df_views[df_views['song_id'].fillna('') != '']

    # Top viewed songs
    top_songs = df_views['song_id'].value_counts().head(20)
    print(f"Top 20 most viewed songs ({len(df_views)} total views):\n")
    for song_id, count in top_songs.items():
        print(f"  {song_id[:50]:50} {count:4}")

    # View sources
    source_counts = df_views['source'].value_counts()
    print(f"\nView sources:")
    for source, count in source_counts.items():
        pct = 100 * count / len(df_views)
        print(f"  {source}: {count} ({pct:.1f}%)")
else:
    print("No song_view events yet")

# %%
# Export behavior - How do users use songs?
df_exports = props('export')

if not df_exports.empty:
    df_exports['type'] = df_exports.get('type', pd.Series(dtype=str)).fillna('unknown')
    export_counts = df_exports['type'].value_counts()
    total = len(df_exports)

    print(f"Export usage ({total} total):\n")
    for export_type, count in export_counts.items():
        pct = 100 * count / total
        bar = '█' * int(pct / 5)
        print(f"  {export_type:20} {count:4} ({pct:5.1f}%) {bar}")
else:
    print("No export events yet")

# Also check print events
print_count = (df_all_events['event_name'] == 'print').sum()
if print_count:
    print(f"\nPrint actions: {print_count}")

# %%
# Song engagement - Time spent viewing songs
df_time = props('song_time')

if not df_time.empty and 'duration_seconds' in df_time:
    df_time['duration'] = df_time['duration_seconds'].fillna(0)
    df_time = df_time[df_time['duration'] > 0]

if not df_time.empty and 'duration' in df_time:
    print(f"Song viewing time analysis ({len(df_time)} sessions):\n")
    print(f"  Average time: {df_time['duration'].mean():.1f} seconds")
    print(f"  Median time: {df_time['duration'].median():.1f} seconds")
    print(f"  Max time: {df_time['duration'].max():.0f} seconds")

    # Time buckets
    bins = [0, 10, 30, 60, 120, 300, float('inf')]
    labels = ['<10s', '10-30s', '30-60s', '1-2min', '2-5min', '>5min']
    df_time['bucket'] = pd.cut(df_time['duration'], bins=bins, labels=labels)
    bucket_counts = df_time['bucket'].value_counts().sort_index()

    print(f"\nTime distribution:")
    for bucket, count in bucket_counts.items():
        pct = 100 * count / len(df_time)
        bar = '█' * int(pct / 5)
        print(f"  {bucket:8} {count:4} ({pct:5.1f}%) {bar}")

    # Most engaged songs
    song_avg_time = df_time.groupby('song_id')['duration'].agg(['mean', 'count'])
    song_avg_time = song_avg_time[song_avg_time['count'] >= 3]  # Min 3 views
    song_avg_time = song_avg_time.sort_values('mean', ascending=False).head(10)

    if not song_avg_time.empty:
        print(f"\nMost engaging songs (min 3 views):")
        for song_id, row in song_avg_time.iterrows():
            print(f"  {song_id[:40]:40} {row['mean']:.0f}s avg ({row['count']:.0f} views)")
else:
    print("No song_time events yet")

# %%
# Feature adoption - Which features are users using? (last 30 days)
cutoff = pd.Timestamp.now(tz='UTC') - pd.Timedelta(days=30)
event_counts = df_all_events[df_all_events['created_at'] >= cutoff]['event_name'].value_counts()

if not event_counts.empty:
    # Group by feature category
    features = {
        'Search & Discovery': ['search', 'search_result_click', 'zero_results', 'collection_click'],
        'Song Viewing': ['song_view', 'song_time', 'version_picker'],
        'Display Options': ['transpose', 'display_mode', 'font_size', 'theme_toggle', 'tags_expand', 'chord_mode'],
        'Export': ['export', 'print', 'abc_playback'],
        'User Engagement': ['favorite_toggle', 'list_action', 'tag_vote', 'tag_suggest'],
        'Navigation': ['navigation', 'deep_link', 'bottom_sheet'],
        'Editor': ['editor_open', 'submission'],
        'Feedback': ['feedback_modal_open', 'feedback_submit', 'flag_modal_open', 'flag_submit', 'flag_milestone'],
    }

    print("Feature adoption (last 30 days):\n")
    for category, event_names in features.items():
        cat_total = sum(event_counts.get(e, 0) for e in event_names)
        print(f"{category}: {cat_total:,} events")
        for event in event_names:
            count = event_counts.get(event, 0)
            if count > 0:
                print(f"  - {event}: {count:,}")
        print()

    categorized = {e for names in features.values() for e in names} | {'session_start'}
    uncategorized = event_counts[~event_counts.index.isin(categorized)]
    if not uncategorized.empty:
        print(f"Uncategorized events (add them to `features`): {dict(uncategorized)}")
else:
    print("No events in last 30 days")

# %%
# Filter usage - Which search filters are being used?
df_filters = df_all_events[df_all_events['event_name'] == 'search']

if not df_filters.empty:
    # search-core.js sends properties.filters = {has_artist, has_title, ...}
    filter_flags = {
        'artist:': 'has_artist',
        'title:': 'has_title',
        'tag:': 'has_tag',
        'chord:': 'has_chord',
        'prog:': 'has_progression',
        'lyrics:': 'has_lyrics',
    }
    filter_counts = dict.fromkeys(filter_flags, 0)

    for p in df_filters['properties']:
        filters = (p or {}).get('filters') or {}
        for name, flag in filter_flags.items():
            if filters.get(flag):
                filter_counts[name] += 1

    total_searches = len(df_filters)
    print(f"Filter usage across {total_searches} searches:\n")
    for filter_name, count in sorted(filter_counts.items(), key=lambda x: -x[1]):
        pct = 100 * count / total_searches if total_searches > 0 else 0
        bar = '█' * int(pct / 5)
        print(f"  {filter_name:12} {count:4} ({pct:5.1f}%) {bar}")
else:
    print("No search events yet")

# %%
# Zero results - What can't users find?
df_zero = props('zero_results')

if not df_zero.empty and 'query' in df_zero:
    df_zero = df_zero[df_zero['query'].fillna('') != '']
    zero_counts = df_zero['query'].value_counts().head(20)
    print(f"Top 20 queries with zero results ({len(df_zero)} total):")
    print("(These represent content gaps or search UX issues)\n")
    for query, count in zero_counts.items():
        print(f"  \"{query}\": {count}")
else:
    print("No zero_results events yet (good sign!)")

# %%
# Top searches - What are users looking for?
df_searches = props('search')

if not df_searches.empty and 'query' in df_searches:
    df_searches['query'] = df_searches['query'].fillna('').str.lower().str.strip()
    df_searches = df_searches[df_searches['query'] != '']
    query_counts = df_searches['query'].value_counts().head(25)
    print(f"Top 25 search queries ({len(df_searches)} searches with text):")
    for query, count in query_counts.items():
        print(f"  \"{query}\": {count}")
else:
    print("No search events yet")
