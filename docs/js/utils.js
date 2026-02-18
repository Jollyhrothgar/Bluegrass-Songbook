// Utility functions for Bluegrass Songbook

/**
 * Escape HTML special characters
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight search term matches in text
 *
 * Finds all matches first, then builds result in a single pass to avoid
 * corrupting <mark> tags when a search term contains 'm', 'a', 'r', or 'k'.
 */
export function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);

    const terms = query.toLowerCase().split(/\s+/).filter(t => t);
    if (terms.length === 0) return escapeHtml(text);

    // Find all match positions in the original text
    const matches = [];
    terms.forEach(term => {
        const regex = new RegExp(escapeRegex(term), 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
            matches.push({
                start: match.index,
                end: match.index + match[0].length
            });
        }
    });

    if (matches.length === 0) return escapeHtml(text);

    // Sort by start position, then by length (longer matches first for ties)
    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    // Merge overlapping ranges
    const merged = [];
    for (const m of matches) {
        if (merged.length === 0 || m.start > merged[merged.length - 1].end) {
            merged.push({ start: m.start, end: m.end });
        } else {
            // Extend the last range if needed
            merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, m.end);
        }
    }

    // Build result with escaping and highlights in one pass
    let result = '';
    let pos = 0;
    for (const m of merged) {
        // Add escaped text before this match
        if (pos < m.start) {
            result += escapeHtml(text.slice(pos, m.start));
        }
        // Add highlighted match (escaped inside the mark tag)
        result += '<mark>' + escapeHtml(text.slice(m.start, m.end)) + '</mark>';
        pos = m.end;
    }
    // Add remaining text after last match
    if (pos < text.length) {
        result += escapeHtml(text.slice(pos));
    }

    return result;
}

/**
 * Download a file with the given content
 */
export function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Generate a local unique ID
 */
export function generateLocalId() {
    return 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Check if a song is a tablature-only work (no lead sheet content)
 * Used to determine routing between openSong() and openWork()
 */
export function isTabOnlyWork(song) {
    return song?.tablature_parts?.length > 0 && !song.content;
}

/**
 * Check if a song is a placeholder (no content yet)
 */
export function isPlaceholder(song) {
    return song?.status === 'placeholder';
}

/**
 * Check if a work has multiple viewable parts (lead sheet + tab, etc.)
 * Used to decide whether to show the dashboard or go straight to content.
 */
export function hasMultipleParts(song) {
    let count = 0;
    if (song?.content) count++;
    count += song?.tablature_parts?.length || 0;
    count += song?.document_parts?.length || 0;
    return count > 1;
}

/**
 * Gate contribution actions behind login.
 * If not logged in, triggers Google sign-in and returns false.
 * Usage: if (!requireLogin('add songs')) return;
 */
export function requireLogin(actionDescription) {
    if (window.SupabaseAuth?.isLoggedIn?.()) return true;
    window.SupabaseAuth?.signInWithGoogle?.();
    return false;
}

/**
 * Generate a URL-friendly slug from title and artist
 */
export function generateSlug(title, artist) {
    const base = artist
        ? `${title}-${artist}`
        : title;
    return base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
}

/**
 * Parse a list item reference into workId and optional partId.
 * References are either "work-slug" (whole work) or "work-slug/part-slug" (specific part).
 */
export function parseItemRef(ref) {
    const slash = ref.indexOf('/');
    if (slash === -1) return { workId: ref, partId: null };
    return { workId: ref.slice(0, slash), partId: ref.slice(slash + 1) };
}

/**
 * Slugify a string for use as a part ID in URLs.
 */
export function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
