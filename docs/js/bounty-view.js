// BountyView - Dynamic bounty page driven by placeholder works in the index
// Replaces the static bounty.html with a SPA view at #bounty

import { allSongs } from './state.js';
import { isPlaceholder, escapeHtml } from './utils.js';
import { formatTagName } from './tags.js';

/**
 * Render the bounty view showing all placeholder works grouped by tag
 */
export function renderBountyView(container) {
    const placeholders = allSongs.filter(isPlaceholder);

    // Group by primary tag
    const groups = {};
    for (const song of placeholders) {
        const tags = Object.keys(song.tags || {});
        const primaryTag = tags.length > 0 ? tags[0] : 'Other';
        if (!groups[primaryTag]) groups[primaryTag] = [];
        groups[primaryTag].push(song);
    }

    // Sort groups by size (most items first)
    const sortedGroups = Object.entries(groups)
        .sort((a, b) => b[1].length - a[1].length);

    // Sort songs within each group alphabetically
    for (const [, songs] of sortedGroups) {
        songs.sort((a, b) => a.title.localeCompare(b.title));
    }

    const groupsHtml = sortedGroups.map(([tag, songs]) => `
        <div class="bounty-group">
            <h2 class="bounty-group-title">${escapeHtml(formatTagName(tag))} <span class="bounty-group-count">(${songs.length})</span></h2>
            <div class="bounty-grid">
                ${songs.map(song => `
                    <a href="#work/${song.id}" class="bounty-card">
                        <div class="bounty-card-title">${escapeHtml(song.title)}</div>
                        ${song.artist ? `<div class="bounty-card-artist">${escapeHtml(song.artist)}</div>` : ''}
                        ${song.notes ? `<div class="bounty-card-notes">${escapeHtml(song.notes.slice(0, 80))}${song.notes.length > 80 ? '...' : ''}</div>` : ''}
                        ${song.document_parts?.length ? '<span class="doc-badge">PDF</span>' : ''}
                    </a>
                `).join('')}
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="bounty-view">
            <div class="bounty-header">
                <h1 class="bounty-title">Bluegrass Bounty</h1>
                <p class="bounty-subtitle">Songs and tunes we're looking for. Know one? Help us out!</p>
                <p class="bounty-stats">${placeholders.length} song${placeholders.length !== 1 ? 's' : ''} looking for content</p>
            </div>
            ${placeholders.length > 0 ? groupsHtml : '<p class="bounty-empty">No bounty items right now. Check back soon!</p>'}
            <div class="bounty-cta">
                <p>Know a song we're missing?</p>
                <a href="#request-song" class="bounty-cta-btn">Request a Song</a>
            </div>
        </div>
    `;
}
