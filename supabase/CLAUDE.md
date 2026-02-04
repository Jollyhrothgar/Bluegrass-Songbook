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
| `create-superuser-request` | Create GitHub issue for super-user access requests | POST from superuser-request.js |
| `auto-commit-song` | Commit pending_songs to GitHub repo | Scheduled |
| `cleanup-pending` | Remove stale pending songs | Scheduled |

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
- `user_lists` - User lists with multi-owner support (`owners` array)
- `user_list_items` - Songs in lists (many-to-many)
- `user_favorites` - User favorited songs
- `song_votes` - User votes for song versions
- `tag_votes` - User tag up/downvotes (trusted users can override tags)
- `genre_suggestions` - User-submitted genre suggestions
- `visitor_stats` - Page view and unique visitor counts
- `visitors` - Visitor tracking for analytics
- `analytics_events` - Behavioral analytics events
- `song_flags` - User-reported song issues
- `list_followers` - Users following lists they don't own
- `list_invites` - Invite tokens for list co-ownership
- `admin_users` - Admin users who can delete songs
- `deleted_songs` - Soft-deleted songs (excluded from index at build time)
- `trusted_users` - Users with instant edit privileges
- `pending_songs` - Trusted user edits awaiting GitHub commit

### Authentication

Google OAuth via Supabase Auth. User sessions managed by `supabase-auth.js` on frontend.

**Key functions in supabase-auth.js:**
- `signInWithGoogle()` - Initiates OAuth flow
- `getUser()` - Returns current user (sync, from cache)
- `isLoggedIn()` - Boolean check
- `fetchUserLists()` - Get user's lists from database
- `isAdmin()` - Check if current user is an admin (can delete songs)
- `deleteSong(songId)` - Soft-delete a song (admin only)
- `isTrustedUser()` - Check if current user has trusted status (can make instant edits)
- `savePendingSong(song)` - Save song to pending_songs table

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

### Trusted User Workflow

Trusted users can make instant edits that appear immediately without approval:

1. User is added to `trusted_users` table (manual admin action or via approved super-user request)
2. When editing, `isTrustedUser()` checks if user is trusted
3. Trusted users see "Save Changes" instead of "Submit for Review"
4. Edits are saved to `pending_songs` table with `github_committed: false`
5. Song appears immediately in search (merged with index at load time via `refreshPendingSongs()`)
6. Background job (`auto-commit-song`) commits to GitHub repo

**To add a trusted user:**
```sql
INSERT INTO trusted_users (user_id, created_by)
VALUES ('user-uuid-here', 'admin-manual');
```

**To request trusted status:** Regular users can request super-user access through the app. This creates a GitHub issue via `create-superuser-request` edge function. Admin approves by adding to `trusted_users` table and closing the issue.

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
