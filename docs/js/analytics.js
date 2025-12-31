// Analytics module for Bluegrass Songbook
// Privacy-respecting behavioral analytics with batched event queue

// ============================================
// CONFIGURATION
// ============================================

const FLUSH_INTERVAL_MS = 30000;  // Flush every 30 seconds
const MAX_QUEUE_SIZE = 50;        // Flush if queue exceeds this

// ============================================
// STATE
// ============================================

let eventQueue = [];
let flushTimer = null;
let currentSongViewStart = null;  // For tracking time on song
let isInitialized = false;

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Get visitor ID from localStorage (reuses existing pattern from supabase-auth.js)
 */
function getVisitorId() {
    let visitorId = localStorage.getItem('songbook-visitor-id');
    if (!visitorId) {
        visitorId = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('songbook-visitor-id', visitorId);
    }
    return visitorId;
}

/**
 * Track an event (queued for batched send)
 */
export function track(eventName, properties = {}) {
    if (!isInitialized) return;

    // Add to queue
    eventQueue.push({
        event_name: eventName,
        properties: properties,
        timestamp: new Date().toISOString()
    });

    // Flush if queue is getting large
    if (eventQueue.length >= MAX_QUEUE_SIZE) {
        flush();
    }
}

/**
 * Flush event queue to server
 */
async function flush() {
    if (eventQueue.length === 0) return;

    // Grab current queue and reset
    const eventsToSend = [...eventQueue];
    eventQueue = [];

    // Check if Supabase is available
    if (typeof window.SupabaseAuth === 'undefined' || !window.SupabaseAuth._getClient) {
        return;
    }

    const visitorId = getVisitorId();

    try {
        const supabase = window.SupabaseAuth._getClient();
        if (!supabase) return;

        await supabase.rpc('log_events', {
            p_visitor_id: visitorId,
            p_events: eventsToSend
        });
    } catch (err) {
        // Silent fail - analytics should never break the app
        // Re-queue events on failure (with limit to prevent memory issues)
        if (eventQueue.length < MAX_QUEUE_SIZE * 2) {
            eventQueue = [...eventsToSend, ...eventQueue];
        }
    }
}

/**
 * Start the flush timer
 */
function startFlushTimer() {
    if (flushTimer) return;

    flushTimer = setInterval(() => {
        flush();
    }, FLUSH_INTERVAL_MS);
}

// ============================================
// SONG TIME TRACKING
// ============================================

/**
 * Start tracking time on a song
 */
export function startSongView(songId) {
    // End previous song view if any
    endSongView();

    currentSongViewStart = {
        songId: songId,
        startTime: Date.now()
    };
}

/**
 * End song view and track duration
 */
export function endSongView() {
    if (!currentSongViewStart) return;

    const duration = Math.round((Date.now() - currentSongViewStart.startTime) / 1000);

    // Only track if meaningful duration (> 3 seconds)
    if (duration > 3) {
        track('song_time', {
            song_id: currentSongViewStart.songId,
            duration_seconds: duration
        });
    }

    currentSongViewStart = null;
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize analytics module
 */
export function initAnalytics() {
    if (isInitialized) return;
    isInitialized = true;

    startFlushTimer();

    // Flush on page unload
    window.addEventListener('beforeunload', () => {
        endSongView();
        flush();
    });

    // Flush on visibility change (tab hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            flush();
        }
    });

    // Track session start
    track('session_start', {
        referrer: document.referrer || null,
        path: window.location.hash || '#'
    });
}

// ============================================
// CONVENIENCE WRAPPERS
// ============================================

// Search tracking
export function trackSearch(query, resultCount, filters) {
    track('search', {
        query: query.slice(0, 200),  // Limit query length
        result_count: resultCount,
        filters: filters,
        has_results: resultCount > 0
    });

    if (resultCount === 0 && query.trim().length > 0) {
        track('zero_results', {
            query: query.slice(0, 200),
            filters: filters
        });
    }
}

export function trackSearchResultClick(songId, position, query) {
    track('search_result_click', {
        song_id: songId,
        position: position,
        query: (query || '').slice(0, 100)
    });
}

// Song tracking
export function trackSongView(songId, source, groupId = null) {
    startSongView(songId);
    track('song_view', {
        song_id: songId,
        source: source,
        group_id: groupId
    });
}

export function trackTranspose(songId, fromKey, toKey) {
    track('transpose', {
        song_id: songId,
        from_key: fromKey,
        to_key: toKey
    });
}

export function trackDisplayMode(mode, value = true) {
    track('display_mode', { mode: mode, enabled: value });
}

export function trackFontSize(direction, level) {
    track('font_size', { direction: direction, level: level });
}

export function trackExport(songId, exportType) {
    track('export', {
        song_id: songId,
        type: exportType
    });
}

export function trackAbcPlayback(songId, action, tempo = null, transpose = null) {
    track('abc_playback', {
        song_id: songId,
        action: action,
        tempo: tempo,
        transpose: transpose
    });
}

// User data tracking
export function trackFavorite(songId, action) {
    track('favorite_toggle', {
        song_id: songId,
        action: action
    });
}

export function trackListAction(action, listId = null) {
    track('list_action', {
        action: action,
        list_id: listId
    });
}

// Navigation
export function trackNavigation(to, from = null) {
    track('navigation', {
        to: to,
        from: from
    });
}

export function trackDeepLink(type, path) {
    track('deep_link', {
        type: type,
        path: (path || '').slice(0, 100)
    });
}

// Feature usage
export function trackThemeToggle(theme) {
    track('theme_toggle', { theme: theme });
}

export function trackVersionPicker(groupId, action, selectedSongId = null) {
    track('version_picker', {
        group_id: groupId,
        action: action,
        selected_song_id: selectedSongId
    });
}

export function trackTagVote(songId, tag, vote) {
    track('tag_vote', {
        song_id: songId,
        tag: tag,
        vote: vote
    });
}

export function trackTagSuggest(songId, tags) {
    track('tag_suggest', {
        song_id: songId,
        tag_count: tags.length
    });
}

export function trackEditor(mode, songId = null) {
    track('editor_open', {
        mode: mode,
        song_id: songId
    });
}

export function trackSubmission(type) {
    track('submission', { type: type });
}
