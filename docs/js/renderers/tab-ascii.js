// ASCII Tab Renderer
// Extracted from TablEdit_Reverse viewer for Bluegrass Songbook

/**
 * Render tablature as ASCII text
 * @param {Object} track - Track object with tuning and instrument info
 * @param {Array} notation - Array of measures with events
 * @param {Object} metadata - OTF metadata (title, etc.)
 * @returns {string} ASCII tablature
 */
export function renderAsciiTab(track, notation, metadata = {}) {
    if (!track || !notation) return 'No notation available';

    const numStrings = track.tuning?.length || 5;
    const charsPerMeasure = 16;
    const measuresPerLine = 4;

    let ascii = '';
    ascii += `${metadata.title || 'Untitled'}\n`;
    ascii += `${track.id} (${track.instrument})\n`;
    ascii += `Tuning: ${track.tuning?.join(' - ') || 'Standard'}\n`;
    ascii += '\n';

    for (let lineStart = 0; lineStart < notation.length; lineStart += measuresPerLine) {
        const lineMeasures = notation.slice(lineStart, lineStart + measuresPerLine);

        // Build string arrays
        const stringLines = Array.from({ length: numStrings }, () => []);

        lineMeasures.forEach((measure) => {
            const measureChars = Array.from({ length: numStrings }, () =>
                Array(charsPerMeasure).fill('-')
            );

            if (measure.events) {
                measure.events.forEach(event => {
                    // Map tick to character position (960 ticks/measure / 16 chars = 60 ticks/char)
                    const pos = Math.min(Math.floor(event.tick / 60), charsPerMeasure - 1);

                    event.notes.forEach(note => {
                        const stringIdx = note.s - 1;
                        if (stringIdx >= 0 && stringIdx < numStrings) {
                            // Handle double-digit frets
                            if (note.f >= 10 && pos + 1 < charsPerMeasure) {
                                measureChars[stringIdx][pos] = Math.floor(note.f / 10).toString();
                                measureChars[stringIdx][pos + 1] = (note.f % 10).toString();
                            } else {
                                measureChars[stringIdx][pos] = note.f.toString();
                            }
                        }
                    });
                });
            }

            measureChars.forEach((chars, si) => {
                stringLines[si].push(chars.join(''));
            });
        });

        // Measure numbers
        let numLine = '  ';
        lineMeasures.forEach(m => {
            numLine += m.measure.toString().padEnd(charsPerMeasure + 1);
        });
        ascii += numLine + '\n';

        // String lines with tuning labels
        stringLines.forEach((parts, si) => {
            const label = track.tuning?.[si]?.replace(/\d/, '') || (si + 1).toString();
            ascii += label.padStart(2) + '|' + parts.join('|') + '|\n';
        });

        ascii += '\n';
    }

    return ascii;
}

/**
 * Copy ASCII tab to clipboard
 */
export async function copyAsciiTab(track, notation, metadata = {}) {
    const ascii = renderAsciiTab(track, notation, metadata);
    try {
        await navigator.clipboard.writeText(ascii);
        return true;
    } catch (e) {
        console.error('Failed to copy:', e);
        return false;
    }
}
