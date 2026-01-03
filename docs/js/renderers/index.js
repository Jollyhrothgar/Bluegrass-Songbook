// Renderer Registry for Bluegrass Songbook
// Central module for rendering different content types (ChordPro, Tablature, etc.)

import { TabRenderer, INSTRUMENT_ICONS } from './tablature.js';
import { TabPlayer, getInstrumentKey, PITCH_TO_MIDI, INSTRUMENTS } from './tab-player.js';
import { renderAsciiTab, copyAsciiTab } from './tab-ascii.js';

/**
 * Renderer registry - maps format types to renderer modules
 */
export const RENDERERS = {
    /**
     * OTF (Open Tab Format) - tablature
     */
    otf: {
        name: 'Tablature',
        extensions: ['.otf.json', '.otf.yaml'],
        canPlayback: true,

        /**
         * Render OTF to a container
         */
        render(container, otfData, trackId, options = {}) {
            const track = otfData.tracks?.find(t => t.id === trackId);
            const notation = otfData.notation?.[trackId];

            if (options.ascii) {
                const pre = document.createElement('pre');
                pre.className = 'ascii-tab';
                pre.textContent = renderAsciiTab(track, notation, otfData.metadata);
                container.innerHTML = '';
                container.appendChild(pre);
            } else {
                const renderer = new TabRenderer(container, options.rendererOptions);
                renderer.render(track, notation, otfData.timing?.ticks_per_beat || 480);
            }
        },

        /**
         * Create a player for OTF data
         */
        createPlayer() {
            return new TabPlayer();
        }
    },

    /**
     * ChordPro format - lead sheets
     * (Existing rendering is in song-view.js - this is a placeholder for future extraction)
     */
    chordpro: {
        name: 'Lead Sheet',
        extensions: ['.pro', '.cho', '.chopro'],
        canPlayback: false,

        render(container, content, options = {}) {
            // TODO: Extract ChordPro rendering from song-view.js
            // For now, this is handled by the existing song-view module
            throw new Error('ChordPro rendering should use song-view.js directly');
        }
    },

    /**
     * HTF (Human Tab Format) - authoring format
     * Requires compilation to OTF before rendering
     */
    htf: {
        name: 'Human Tab Format',
        extensions: ['.htf'],
        canPlayback: false,

        render(container, content, options = {}) {
            // TODO: Implement HTF → OTF compiler
            throw new Error('HTF must be compiled to OTF before rendering');
        }
    }
};

/**
 * Get renderer for a given format
 */
export function getRenderer(format) {
    return RENDERERS[format.toLowerCase()] || null;
}

/**
 * Detect format from file extension
 */
export function detectFormat(filename) {
    const lower = filename.toLowerCase();
    for (const [format, config] of Object.entries(RENDERERS)) {
        if (config.extensions.some(ext => lower.endsWith(ext))) {
            return format;
        }
    }
    return null;
}

// Re-export commonly used items
export {
    TabRenderer,
    TabPlayer,
    INSTRUMENT_ICONS,
    getInstrumentKey,
    PITCH_TO_MIDI,
    INSTRUMENTS,
    renderAsciiTab,
    copyAsciiTab
};
