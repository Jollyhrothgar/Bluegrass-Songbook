# Supabase Backend

Backend infrastructure for the Bluegrass Songbook, hosted on Supabase.

## Components

### Edge Functions (`functions/`)

Serverless functions that run on Supabase Edge (Deno runtime).

| Function | Purpose | Trigger |
|----------|---------|---------|
| `create-song-issue` | Create GitHub issue for song submissions/corrections | POST from editor.js |
| `create-flag-issue` | Create GitHub issue for song problem reports | POST from flags.js |
| `create-song-request` | Create GitHub issue for song requests | POST from song-request.js |

All functions:
- Use GitHub API to create issues (no user GitHub auth required)
- Include submitter attribution in issue body
- Return issue number on success

**Deployment:**
```bash
supabase functions deploy create-song-issue
supabase functions deploy create-flag-issue
supabase functions deploy create-song-request
```

### Migrations (`migrations/`)

SQL migrations for the Supabase Postgres database. Version-controlled and applied via `supabase db push`.

**Key tables:**
- `song_lists` - User lists with multi-owner support (`owner_ids` array)
- `list_songs` - Songs in lists (many-to-many)
- `song_votes` - User votes for song versions
- `visitor_stats` - Page view and unique visitor counts
- `song_flag_counts` - Aggregated flag counts per song
- `admin_users` - Admin users who can delete songs
- `deleted_songs` - Soft-deleted songs (excluded from index at build time)

### Authentication

Google OAuth via Supabase Auth. User sessions managed by `supabase-auth.js` on frontend.

**Key functions in supabase-auth.js:**
- `signInWithGoogle()` - Initiates OAuth flow
- `getUser()` - Returns current user (sync, from cache)
- `isLoggedIn()` - Boolean check
- `fetchUserLists()` - Get user's lists from database
- `isAdmin()` - Check if current user is an admin (can delete songs)
- `deleteSong(songId)` - Soft-delete a song (admin only)

**Note:** `supabase-auth.js` is loaded as a regular script (NOT an ES module). Functions are exposed via `window.SupabaseAuth` object.

### Admin Features

Admin users can permanently delete songs from the songbook:

1. Admin user IDs are stored in `admin_users` table (managed via service role)
2. Delete button appears in song view for admins only
3. Songs are soft-deleted to `deleted_songs` table
4. Build process reads `docs/data/deleted_songs.json` and excludes those songs

**To add an admin:**
```sql
-- Run with service role (e.g., in Supabase SQL editor)
INSERT INTO admin_users (user_id) VALUES ('user-uuid-here');
```

**To sync deleted songs for build:**
```bash
./scripts/utility sync-deleted-songs
```

## Row-Level Security (RLS)

All tables have RLS policies:
- Lists: Owners can CRUD, anyone can read public lists
- Votes: Users can only vote once per song
- Stats: Increment-only via function

## Local Development

```bash
# Start local Supabase
supabase start

# Apply migrations
supabase db push

# Test edge functions locally
supabase functions serve create-song-issue --env-file .env.local
```

## Environment Variables

Edge functions require:
- `GITHUB_TOKEN` - PAT with repo scope for issue creation
- `GITHUB_OWNER` - Repository owner (e.g., "Jollyhrothgar")
- `GITHUB_REPO` - Repository name (e.g., "Bluegrass-Songbook")

Set via Supabase dashboard > Edge Functions > Secrets.
