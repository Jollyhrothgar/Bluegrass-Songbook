// Song editor for Bluegrass Songbook

import {
    currentSong,
    editMode, setEditMode,
    editingSongId, setEditingSongId,
    editorNashvilleMode, setEditorNashvilleMode
} from './state.js';
import { escapeHtml } from './utils.js';
import { extractChords, detectKey, toNashville } from './chords.js';
import { trackEditor, trackSubmission } from './analytics.js';

/**
 * Get the submitter attribution for issue body.
 * Uses logged-in user's name/email if available, otherwise "Rando Calrissian"
 */
function getSubmitterAttribution() {
    const user = window.SupabaseAuth?.getUser?.();
    if (user) {
        // Prefer display name from user metadata, fall back to email
        return user.user_metadata?.full_name || user.email || 'Anonymous User';
    }
    return 'Rando Calrissian';
}

// Supabase configuration for anonymous submissions
const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

// Module-level state
let editorDetectedKey = null;

// DOM element references (set by init)
let editorPanelEl = null;
let editorTitleEl = null;
let editorArtistEl = null;
let editorWriterEl = null;
let editorContentEl = null;
let editorPreviewContentEl = null;
let editorCopyBtnEl = null;
let editorSaveBtnEl = null;
let editorSubmitBtnEl = null;
let editorStatusEl = null;
let editorNashvilleEl = null;
let editorCommentEl = null;
let editCommentRowEl = null;
let editSongBtnEl = null;
let hintsBtnEl = null;
let hintsPanelEl = null;
let hintsBackdropEl = null;
let hintsCloseEl = null;

// Other DOM references
let navSearchEl = null;
let navAddSongEl = null;
let navFavoritesEl = null;
let resultsDivEl = null;
let songViewEl = null;

/**
 * Enter edit mode for an existing song
 */
export function enterEditMode(song) {
    setEditMode(true);
    setEditingSongId(song.id);
    trackEditor('edit', song.id);

    // Populate editor with song data
    if (editorTitleEl) editorTitleEl.value = song.title || '';
    if (editorArtistEl) editorArtistEl.value = song.artist || '';
    if (editorWriterEl) editorWriterEl.value = song.composer || '';
    if (editorContentEl) editorContentEl.value = song.content || '';
    if (editorCommentEl) editorCommentEl.value = '';

    // Show comment field
    if (editCommentRowEl) editCommentRowEl.classList.remove('hidden');

    // Update submit button text
    if (editorSubmitBtnEl) editorSubmitBtnEl.textContent = 'Submit Correction';

    // Switch to editor panel (update nav state)
    [navSearchEl, navAddSongEl, navFavoritesEl].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    if (navAddSongEl) navAddSongEl.classList.add('active');

    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) searchContainer.classList.add('hidden');
    if (resultsDivEl) resultsDivEl.classList.add('hidden');
    if (songViewEl) songViewEl.classList.add('hidden');
    if (editorPanelEl) editorPanelEl.classList.remove('hidden');

    // Trigger preview update
    updateEditorPreview();
}

/**
 * Exit edit mode
 */
export function exitEditMode() {
    setEditMode(false);
    setEditingSongId(null);
    if (editCommentRowEl) editCommentRowEl.classList.add('hidden');
    if (editorCommentEl) editorCommentEl.value = '';
    if (editorSubmitBtnEl) editorSubmitBtnEl.textContent = 'Submit to Songbook';
}

/**
 * Check if a line is a chord line
 */
function editorIsChordLine(line) {
    if (!line.trim()) return false;
    const words = line.trim().split(/\s+/);
    if (words.length === 0) return false;
    const chordPattern = /^[A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?$/;
    const chordCount = words.filter(w => chordPattern.test(w)).length;
    return chordCount / words.length > 0.5;
}

/**
 * Check if a line is a section marker
 */
function editorIsSectionMarker(line) {
    return /^\[.+\]$/.test(line.trim());
}

/**
 * Check if a line is an instrumental line
 */
function editorIsInstrumentalLine(line) {
    return /^[—\-]?[A-G][#b]?---/.test(line.trim());
}

/**
 * Extract chords with their positions from a chord line
 */
function editorExtractChordsWithPositions(chordLine) {
    const chords = [];
    const pattern = /([A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:\/[A-G][#b]?)?)/g;
    let match;
    while ((match = pattern.exec(chordLine)) !== null) {
        chords.push({ chord: match[1], position: match.index });
    }
    return chords;
}

/**
 * Align chords to lyrics based on position
 */
function editorAlignChordsToLyrics(chordLine, lyricLine, chordPositions) {
    if (!chordPositions.length) return lyricLine;
    const sorted = [...chordPositions].sort((a, b) => b.position - a.position);
    let result = lyricLine;
    for (const { chord, position } of sorted) {
        let lyricPos = Math.min(position, result.length);
        result = result.slice(0, lyricPos) + `[${chord}]` + result.slice(lyricPos);
    }
    return result;
}

/**
 * Convert chord sheet format to ChordPro
 */
export function editorConvertToChordPro(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            result.push('');
            i++;
            continue;
        }

        if (editorIsSectionMarker(trimmed)) {
            const sectionName = trimmed.slice(1, -1).trim();
            const lowerName = sectionName.toLowerCase();
            if (lowerName.includes('chorus')) {
                result.push('{soc}');
            } else if (lowerName.includes('verse')) {
                result.push(`{sov: ${sectionName}}`);
            } else if (lowerName.includes('instrumental') || lowerName.includes('break')) {
                result.push(`{comment: ${sectionName}}`);
            } else if (lowerName.includes('bridge')) {
                result.push('{sob}');
            } else {
                result.push(`{comment: ${sectionName}}`);
            }
            i++;
            continue;
        }

        if (editorIsInstrumentalLine(trimmed)) {
            result.push(`{comment: ${trimmed}}`);
            i++;
            continue;
        }

        if (editorIsChordLine(line)) {
            const chordPositions = editorExtractChordsWithPositions(line);
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (!nextLine.trim() || editorIsChordLine(nextLine) || editorIsSectionMarker(nextLine.trim())) {
                    const chords = chordPositions.map(c => c.chord).join(' ');
                    result.push(`{comment: ${chords}}`);
                    i++;
                    continue;
                }
                const chordproLine = editorAlignChordsToLyrics(line, nextLine, chordPositions);
                result.push(chordproLine);
                i += 2;
                continue;
            } else {
                const chords = chordPositions.map(c => c.chord).join(' ');
                result.push(`{comment: ${chords}}`);
                i++;
                continue;
            }
        }

        result.push(line);
        i++;
    }

    return result.join('\n');
}

/**
 * Clean Ultimate Guitar paste format
 */
export function cleanUltimateGuitarPaste(text) {
    const isUG = text.includes('ultimate-guitar') ||
                 text.includes('Ultimate-Guitar') ||
                 (text.includes('Chords by') && text.includes('views') && text.includes('saves')) ||
                 (text.includes('Tuning:') && text.includes('Key:') && text.includes('Capo:'));

    if (!isUG) {
        return { text, title: null, artist: null, cleaned: false };
    }

    const lines = text.split('\n');
    let title = null;
    let artist = null;
    let songStartIndex = -1;
    let songEndIndex = lines.length;

    // Find title and artist
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const line = lines[i];
        const match = line.match(/^(.+?)\s+(?:Chords|Tab|Tabs)\s+by\s+(.+)$/i);
        if (match) {
            title = match[1].trim();
            artist = match[2].trim();
            break;
        }
    }

    // Find song content start
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^\[(Verse|Chorus|Intro|Bridge|Outro|Instrumental|Pre-Chorus|Hook|Interlude)/i.test(line)) {
            songStartIndex = i;
            break;
        }
        if (editorIsChordLine(line) && i + 1 < lines.length && lines[i + 1].trim() && !editorIsChordLine(lines[i + 1])) {
            songStartIndex = i;
            break;
        }
    }

    // Find song content end
    for (let i = songStartIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('Last update:') ||
            line === 'Rating' ||
            line === 'Welcome Offer' ||
            line.startsWith('© ') ||
            line === 'Chords' ||
            (line === 'X' && i > songStartIndex + 10) ||
            line.includes('Please, rate this tab') ||
            line.match(/^\d+\.\d+$/) ||
            line.match(/^\d+ rates$/)) {
            songEndIndex = i;
            break;
        }
    }

    if (songStartIndex === -1) {
        return { text, title, artist, cleaned: false };
    }

    const songLines = lines.slice(songStartIndex, songEndIndex);
    const cleanedLines = songLines
        .filter(line => {
            const trimmed = line.trim();
            if (trimmed === 'X') return false;
            if (trimmed.match(/^\d+\.\d+$/)) return false;
            if (trimmed.match(/^\(\d+,?\d*\)$/)) return false;
            if (trimmed === 'Chords' || trimmed === 'Guitar' || trimmed === 'Ukulele' || trimmed === 'Piano') return false;
            return true;
        });

    return {
        text: cleanedLines.join('\n'),
        title,
        artist,
        cleaned: true
    };
}

/**
 * Detect and convert chord sheet format
 */
export function editorDetectAndConvert(text) {
    const lines = text.split('\n');
    let chordLineCount = 0;
    let consecutivePairs = 0;

    for (let i = 0; i < lines.length - 1; i++) {
        if (editorIsChordLine(lines[i]) && !editorIsChordLine(lines[i + 1]) && lines[i + 1].trim()) {
            consecutivePairs++;
        }
        if (editorIsChordLine(lines[i])) {
            chordLineCount++;
        }
    }

    if (consecutivePairs >= 2 || chordLineCount >= 3) {
        return editorConvertToChordPro(text);
    }

    return text;
}

/**
 * Parse editor content into sections
 */
function editorParseContent(content) {
    const lines = content.split('\n');
    const sections = [];
    let currentSection = { label: 'Verse 1', lines: [] };
    let verseCount = 1;

    for (const line of lines) {
        if (line.match(/^\{(sov|start_of_verse)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            const labelMatch = line.match(/:\s*(.+?)\s*\}/);
            currentSection = { label: labelMatch ? labelMatch[1] : `Verse ${++verseCount}`, lines: [] };
            continue;
        }
        if (line.match(/^\{(soc|start_of_chorus)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            currentSection = { label: 'Chorus', type: 'chorus', lines: [] };
            continue;
        }
        if (line.match(/^\{(eov|eoc|end_of)/i)) {
            if (currentSection.lines.length > 0) sections.push(currentSection);
            currentSection = { label: `Verse ${++verseCount}`, lines: [] };
            continue;
        }
        if (line.startsWith('{')) continue;

        if (!line.trim()) {
            if (currentSection.lines.length > 0) {
                sections.push(currentSection);
                currentSection = { label: `Verse ${++verseCount}`, lines: [] };
            }
            continue;
        }

        if (line.trim()) {
            currentSection.lines.push(line);
        }
    }

    if (currentSection.lines.length > 0) sections.push(currentSection);
    return sections;
}

/**
 * Render a line in the editor preview
 */
function editorRenderLine(line) {
    const chords = [];
    let lyrics = '';
    const regex = /\[([^\]]+)\]/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(line)) !== null) {
        lyrics += line.slice(lastIndex, match.index);
        chords.push({ chord: match[1], position: lyrics.length });
        lastIndex = regex.lastIndex;
    }
    lyrics += line.slice(lastIndex);

    if (chords.length === 0) {
        return `<div class="song-line"><div class="lyrics-line">${escapeHtml(lyrics)}</div></div>`;
    }

    let chordLine = '';
    let lastPos = 0;

    for (const { chord, position } of chords) {
        const displayChord = editorNashvilleMode && editorDetectedKey
            ? toNashville(chord, editorDetectedKey)
            : chord;
        const spaces = Math.max(0, position - lastPos);
        chordLine += ' '.repeat(spaces) + displayChord;
        lastPos = position + displayChord.length;
    }

    return `
        <div class="song-line">
            <div class="chord-line">${escapeHtml(chordLine)}</div>
            <div class="lyrics-line">${escapeHtml(lyrics)}</div>
        </div>
    `;
}

/**
 * Update editor preview
 */
export function updateEditorPreview() {
    if (!editorContentEl || !editorPreviewContentEl) return;

    const title = editorTitleEl?.value.trim() || '';
    const artist = editorArtistEl?.value.trim() || '';
    const content = editorContentEl.value;

    if (!content.trim()) {
        editorPreviewContentEl.innerHTML = '<p class="preview-placeholder">Enter a song to see preview...</p>';
        return;
    }

    const chords = extractChords(content);
    const { key } = detectKey(chords);
    editorDetectedKey = key;

    const sections = editorParseContent(content);

    let html = '<div class="song-header">';
    if (title) html += `<h2 class="song-title">${escapeHtml(title)}</h2>`;
    const metaParts = [];
    if (artist) metaParts.push(artist);
    if (key) metaParts.push(`Key: ${key}`);
    if (metaParts.length) html += `<div class="song-meta">${escapeHtml(metaParts.join(' | '))}</div>`;
    html += '</div>';

    for (const section of sections) {
        const indentClass = section.type === 'chorus' ? 'section-indent' : '';
        html += `<div class="song-section ${indentClass}">`;
        html += `<div class="section-label">${escapeHtml(section.label)}</div>`;
        html += '<div class="section-content">';
        for (const line of section.lines) {
            html += editorRenderLine(line);
        }
        html += '</div></div>';
    }

    editorPreviewContentEl.innerHTML = html;
}

/**
 * Generate ChordPro output
 */
export function editorGenerateChordPro() {
    const title = editorTitleEl?.value.trim() || '';
    const artist = editorArtistEl?.value.trim() || '';
    const writer = editorWriterEl?.value.trim() || '';
    const content = editorContentEl?.value.trim() || '';

    let output = '';

    if (title) output += `{meta: title ${title}}\n`;
    if (artist) output += `{meta: artist ${artist}}\n`;
    if (writer) output += `{meta: composer ${writer}}\n`;

    if (output) output += '\n';

    const sections = editorParseContent(content);

    for (const section of sections) {
        if (section.type === 'chorus') {
            output += '{start_of_chorus}\n';
        } else {
            output += `{start_of_verse: ${section.label}}\n`;
        }

        for (const line of section.lines) {
            output += line + '\n';
        }

        if (section.type === 'chorus') {
            output += '{end_of_chorus}\n\n';
        } else {
            output += '{end_of_verse}\n\n';
        }
    }

    return output.trim() + '\n';
}

/**
 * Generate a filename from title
 */
export function editorGenerateFilename(title) {
    if (!title) return 'untitled.pro';
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 50) + '.pro';
}

/**
 * Toggle hints panel
 */
function toggleHints() {
    if (!hintsPanelEl || !hintsBackdropEl) return;
    const isHidden = hintsPanelEl.classList.contains('hidden');
    if (isHidden) {
        hintsPanelEl.classList.remove('hidden');
        hintsBackdropEl.classList.remove('hidden');
    } else {
        closeHints();
    }
}

/**
 * Close hints panel
 */
export function closeHints() {
    if (hintsPanelEl) hintsPanelEl.classList.add('hidden');
    if (hintsBackdropEl) hintsBackdropEl.classList.add('hidden');
}

/**
 * Initialize editor module with DOM elements
 */
export function initEditor(options) {
    const {
        editorPanel,
        editorTitle,
        editorArtist,
        editorWriter,
        editorContent,
        editorPreviewContent,
        editorCopyBtn,
        editorSaveBtn,
        editorSubmitBtn,
        editorStatus,
        editorNashville,
        editorComment,
        editCommentRow,
        editSongBtn,
        hintsBtn,
        hintsPanel,
        hintsBackdrop,
        hintsClose,
        navSearch,
        navAddSong,
        navFavorites,
        resultsDiv,
        songView
    } = options;

    editorPanelEl = editorPanel;
    editorTitleEl = editorTitle;
    editorArtistEl = editorArtist;
    editorWriterEl = editorWriter;
    editorContentEl = editorContent;
    editorPreviewContentEl = editorPreviewContent;
    editorCopyBtnEl = editorCopyBtn;
    editorSaveBtnEl = editorSaveBtn;
    editorSubmitBtnEl = editorSubmitBtn;
    editorStatusEl = editorStatus;
    editorNashvilleEl = editorNashville;
    editorCommentEl = editorComment;
    editCommentRowEl = editCommentRow;
    editSongBtnEl = editSongBtn;
    hintsBtnEl = hintsBtn;
    hintsPanelEl = hintsPanel;
    hintsBackdropEl = hintsBackdrop;
    hintsCloseEl = hintsClose;
    navSearchEl = navSearch;
    navAddSongEl = navAddSong;
    navFavoritesEl = navFavorites;
    resultsDivEl = resultsDiv;
    songViewEl = songView;

    // Edit song button
    if (editSongBtnEl) {
        editSongBtnEl.addEventListener('click', () => {
            if (currentSong) {
                enterEditMode(currentSong);
            }
        });
    }

    // Paste handler
    if (editorContentEl) {
        editorContentEl.addEventListener('paste', () => {
            setTimeout(() => {
                let text = editorContentEl.value;
                let statusMessage = '';

                const ugResult = cleanUltimateGuitarPaste(text);
                if (ugResult.cleaned) {
                    text = ugResult.text;
                    statusMessage = 'Imported from Ultimate Guitar';

                    if (ugResult.title && editorTitleEl && !editorTitleEl.value.trim()) {
                        editorTitleEl.value = ugResult.title;
                    }
                    if (ugResult.artist && editorArtistEl && !editorArtistEl.value.trim()) {
                        editorArtistEl.value = ugResult.artist;
                    }
                }

                const converted = editorDetectAndConvert(text);
                if (converted !== text || ugResult.cleaned) {
                    editorContentEl.value = converted;
                    updateEditorPreview();
                    if (editorStatusEl) {
                        editorStatusEl.textContent = statusMessage || 'Converted from chord sheet format';
                        editorStatusEl.className = 'save-status success';
                        setTimeout(() => { editorStatusEl.textContent = ''; }, 3000);
                    }
                }
            }, 0);
        });

        editorContentEl.addEventListener('input', updateEditorPreview);
    }

    if (editorTitleEl) editorTitleEl.addEventListener('input', updateEditorPreview);
    if (editorArtistEl) editorArtistEl.addEventListener('input', updateEditorPreview);

    if (editorNashvilleEl) {
        editorNashvilleEl.addEventListener('change', (e) => {
            setEditorNashvilleMode(e.target.checked);
            updateEditorPreview();
        });
    }

    // Hints
    if (hintsBtnEl) hintsBtnEl.addEventListener('click', toggleHints);
    if (hintsCloseEl) hintsCloseEl.addEventListener('click', closeHints);
    if (hintsBackdropEl) hintsBackdropEl.addEventListener('click', closeHints);

    // Copy button
    if (editorCopyBtnEl) {
        editorCopyBtnEl.addEventListener('click', async () => {
            const chordpro = editorGenerateChordPro();
            try {
                await navigator.clipboard.writeText(chordpro);
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Copied!';
                    editorStatusEl.className = 'save-status success';
                    setTimeout(() => { editorStatusEl.textContent = ''; }, 2000);
                }
            } catch (err) {
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Copy failed';
                    editorStatusEl.className = 'save-status error';
                }
            }
        });
    }

    // Save button
    if (editorSaveBtnEl) {
        editorSaveBtnEl.addEventListener('click', () => {
            const title = editorTitleEl?.value.trim();
            if (!title) {
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Title required';
                    editorStatusEl.className = 'save-status error';
                }
                return;
            }

            const chordpro = editorGenerateChordPro();
            const filename = editorGenerateFilename(title);

            const blob = new Blob([chordpro], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (editorStatusEl) {
                editorStatusEl.textContent = `Downloaded: ${filename}`;
                editorStatusEl.className = 'save-status success';
                setTimeout(() => { editorStatusEl.textContent = ''; }, 3000);
            }
        });
    }

    // Submit button
    if (editorSubmitBtnEl) {
        editorSubmitBtnEl.addEventListener('click', async () => {
            const title = editorTitleEl?.value.trim();
            const artist = editorArtistEl?.value.trim();

            if (!title) {
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Title required';
                    editorStatusEl.className = 'save-status error';
                }
                return;
            }

            const chordpro = editorGenerateChordPro();
            const content = editorContentEl?.value.trim();

            if (!content) {
                if (editorStatusEl) {
                    editorStatusEl.textContent = 'Song content required';
                    editorStatusEl.className = 'save-status error';
                }
                return;
            }

            let submissionData;

            if (editMode && editingSongId) {
                const comment = editorCommentEl?.value.trim();
                if (!comment) {
                    if (editorStatusEl) {
                        editorStatusEl.textContent = 'Please describe your changes';
                        editorStatusEl.className = 'save-status error';
                    }
                    return;
                }

                submissionData = {
                    type: 'correction',
                    title,
                    artist: artist || undefined,
                    songId: editingSongId,
                    chordpro,
                    comment,
                    submittedBy: getSubmitterAttribution()
                };
            } else {
                submissionData = {
                    type: 'submission',
                    title,
                    artist: artist || undefined,
                    chordpro,
                    submittedBy: getSubmitterAttribution()
                };
            }

            // Disable button and show submitting state
            editorSubmitBtnEl.disabled = true;
            if (editorStatusEl) {
                editorStatusEl.textContent = 'Submitting...';
                editorStatusEl.className = 'save-status';
            }

            try {
                const response = await fetch(`${SUPABASE_URL}/functions/v1/create-song-issue`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'apikey': SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify(submissionData)
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(result.error || 'Failed to submit');
                }

                trackSubmission(editMode ? 'correction' : 'new_song');

                if (editorStatusEl) {
                    editorStatusEl.innerHTML = `Submitted! <a href="${result.issueUrl}" target="_blank">View issue #${result.issueNumber}</a>`;
                    editorStatusEl.className = 'save-status success';
                }

                if (editMode) {
                    exitEditMode();
                } else {
                    // Clear form for new submissions
                    if (editorTitleEl) editorTitleEl.value = '';
                    if (editorArtistEl) editorArtistEl.value = '';
                    if (editorContentEl) editorContentEl.value = '';
                    updateEditorPreview();
                }

            } catch (error) {
                console.error('Submission error:', error);
                if (editorStatusEl) {
                    editorStatusEl.textContent = `Error: ${error.message}`;
                    editorStatusEl.className = 'save-status error';
                }
            } finally {
                editorSubmitBtnEl.disabled = false;
            }
        });
    }
}
