// Main entry point for Bluegrass Songbook
// This module orchestrates all other modules and handles initialization

import {
    allSongs, setAllSongs,
    songGroups, setSongGroups,
    setHistoryInitialized,
    historyInitialized,
    currentDetectedKey,
    originalDetectedKey
} from './state.js';
import { initTagDropdown, syncTagCheckboxes } from './tags.js';
import { initFavorites, performFullSync, updateSyncUI, showFavorites, hideFavorites } from './favorites.js';
import { initLists, renderSidebarLists, renderListPickerDropdown, performFullListsSync, clearListView, renderListsModal, createList, addSongToList } from './lists.js';
import { initSongView, openSong, openSongFromHistory, goBack, renderSong, getCurrentSong, getCurrentChordpro } from './song-view.js';
import { initSearch, search, showRandomSongs, renderResults, parseSearchQuery } from './search-core.js';
import { initEditor, updateEditorPreview, enterEditMode, editorGenerateChordPro } from './editor.js';
import { escapeHtml } from './utils.js';
import { extractChords, toNashville, transposeChord, getSemitonesBetweenKeys, generateKeyOptions } from './chords.js';

// ============================================
// DOM ELEMENTS
// ============================================

const searchInput = document.getElementById('search-input');
const searchStats = document.getElementById('search-stats');
const resultsDiv = document.getElementById('results');
const songView = document.getElementById('song-view');
const songContent = document.getElementById('song-content');
const backBtn = document.getElementById('back-btn');
const themeToggle = document.getElementById('theme-toggle');

// Sidebar elements
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const menuBtn = document.getElementById('hamburger-btn');
const homeBtn = document.getElementById('home-btn');
const logoLink = document.getElementById('logo-link');
const navSearch = document.getElementById('nav-search');
const navAddSong = document.getElementById('nav-add-song');
const navFavorites = document.getElementById('nav-favorites');
const navFavoritesCount = document.getElementById('nav-favorites-count');
const navListsContainer = document.getElementById('nav-lists-container');
const manageListsBtn = document.getElementById('nav-manage-lists');

// List picker elements
const listPickerBtn = document.getElementById('list-picker-btn');
const listPickerDropdown = document.getElementById('list-picker-dropdown');
const customListsContainer = document.getElementById('custom-lists-container');
const favoritesCheckbox = document.getElementById('favorites-checkbox');
const createListBtn = document.getElementById('create-list-btn');
const newListInput = document.getElementById('new-list-input');

// Version modal
const versionModal = document.getElementById('version-modal');
const versionModalClose = document.getElementById('version-modal-close');
const versionModalTitle = document.getElementById('version-modal-title');
const versionList = document.getElementById('version-list');

// Lists modal
const listsModal = document.getElementById('lists-modal');
const listsModalClose = document.getElementById('lists-modal-close');
const listsContainer = document.getElementById('lists-container');
const modalCreateListBtn = document.getElementById('modal-create-list-btn');
const modalNewListInput = document.getElementById('modal-new-list-input');

// Account modal
const accountBtn = document.getElementById('account-btn');
const accountModal = document.getElementById('account-modal');
const accountModalClose = document.getElementById('account-modal-close');
const signInBtn = document.getElementById('sign-in-btn');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');

// Song actions
const printBtn = document.getElementById('print-btn');
const copyBtn = document.getElementById('copy-btn');
const copyDropdown = document.getElementById('copy-dropdown');
const downloadBtn = document.getElementById('download-btn');
const downloadDropdown = document.getElementById('download-dropdown');
const editSongBtn = document.getElementById('edit-song-btn');

// Editor elements
const editorPanel = document.getElementById('editor-panel');
const editorBackBtn = document.getElementById('editor-back-btn');
const editorTitle = document.getElementById('editor-title');
const editorArtist = document.getElementById('editor-artist');
const editorWriter = document.getElementById('editor-writer');
const editorContent = document.getElementById('editor-content');
const editorPreviewContent = document.getElementById('editor-preview-content');
const editorCopyBtn = document.getElementById('editor-copy');
const editorSaveBtn = document.getElementById('editor-save');
const editorSubmitBtn = document.getElementById('editor-submit');
const editorStatus = document.getElementById('editor-status');
const editorNashville = document.getElementById('editor-nashville');
const editorComment = document.getElementById('editor-comment');
const editCommentRow = document.getElementById('edit-comment-row');
const hintsBtn = document.getElementById('chordpro-hints-btn');
const hintsPanel = document.getElementById('chordpro-hints-panel');
const hintsBackdrop = document.getElementById('chordpro-hints-backdrop');
const hintsClose = document.getElementById('chordpro-hints-close');

// Tag dropdown
const tagDropdownBtn = document.getElementById('tag-dropdown-btn');
const tagDropdownContent = document.getElementById('tag-dropdown-content');

// Feedback elements
const feedbackBtn = document.getElementById('feedback-btn');
const feedbackDropdown = document.getElementById('feedback-dropdown');
const navFeedback = document.getElementById('nav-feedback');

// Bug report modal
const bugModal = document.getElementById('bug-modal');
const bugModalClose = document.getElementById('bug-modal-close');
const bugFeedback = document.getElementById('bug-feedback');
const bugSubmitBtn = document.getElementById('submit-bug-btn');

// Song correction modal
const correctionModal = document.getElementById('correction-modal');
const correctionModalClose = document.getElementById('correction-modal-close');
const correctionEditBtn = document.getElementById('correction-edit-btn');
const correctionFeedbackBtn = document.getElementById('correction-feedback-btn');

// Contact modal
const contactModal = document.getElementById('contact-modal');
const contactModalClose = document.getElementById('contact-modal-close');
const contactModalTitle = document.getElementById('contact-modal-title');
const contactFeedback = document.getElementById('contact-feedback');
const contactSubmitBtn = document.getElementById('submit-contact-btn');

// ============================================
// THEME HANDLING
// ============================================

function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
}

// ============================================
// HISTORY MANAGEMENT
// ============================================

function pushHistoryState(view, data = {}) {
    if (!historyInitialized) return;

    let hash = '';
    const state = { view, ...data };

    switch (view) {
        case 'song':
            hash = `#song/${data.songId}`;
            break;
        case 'add-song':
            hash = '#add';
            break;
        case 'favorites':
            hash = '#favorites';
            break;
        case 'search':
        default:
            hash = data.query ? `#search/${encodeURIComponent(data.query)}` : '';
            break;
    }

    history.pushState(state, '', hash || window.location.pathname);
}

function handleHistoryNavigation(state) {
    if (!state) {
        showView('search');
        return;
    }

    switch (state.view) {
        case 'song':
            if (state.songId) {
                openSongFromHistory(state.songId);
            }
            break;
        case 'add-song':
            showView('add-song');
            break;
        case 'favorites':
            showView('favorites');
            break;
        case 'search':
        default:
            showView('search');
            if (state.query) {
                searchInput.value = state.query;
                search(state.query);
            }
            break;
    }
}

function showView(mode) {
    const searchContainer = document.querySelector('.search-container');

    // Reset all nav states
    [navSearch, navAddSong, navFavorites].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });

    // Clear list view state
    clearListView();

    switch (mode) {
        case 'search':
            searchContainer?.classList.remove('hidden');
            resultsDiv?.classList.remove('hidden');
            songView?.classList.add('hidden');
            editorPanel?.classList.add('hidden');
            navSearch?.classList.add('active');
            hideFavorites();
            break;
        case 'add-song':
            searchContainer?.classList.add('hidden');
            resultsDiv?.classList.add('hidden');
            songView?.classList.add('hidden');
            editorPanel?.classList.remove('hidden');
            navAddSong?.classList.add('active');
            break;
        case 'favorites':
            searchContainer?.classList.remove('hidden');
            resultsDiv?.classList.remove('hidden');
            songView?.classList.add('hidden');
            editorPanel?.classList.add('hidden');
            navFavorites?.classList.add('active');
            showFavorites();
            break;
    }
}

function handleDeepLink() {
    const hash = window.location.hash;
    if (!hash) return false;

    if (hash.startsWith('#song/')) {
        const songId = hash.slice(6);
        openSong(songId);
        return true;
    } else if (hash === '#add') {
        showView('add-song');
        pushHistoryState('add-song');
        return true;
    } else if (hash === '#favorites') {
        showView('favorites');
        pushHistoryState('favorites');
        return true;
    } else if (hash.startsWith('#search/')) {
        const query = decodeURIComponent(hash.slice(8));
        searchInput.value = query;
        search(query);
        return true;
    }

    return false;
}

// ============================================
// SIDEBAR NAVIGATION
// ============================================

function openSidebar() {
    sidebar?.classList.add('open');
    sidebarBackdrop?.classList.remove('hidden');
    sidebarBackdrop?.classList.add('visible');
}

function closeSidebar() {
    sidebar?.classList.remove('open');
    sidebarBackdrop?.classList.remove('visible');
    setTimeout(() => {
        sidebarBackdrop?.classList.add('hidden');
    }, 300);
}

function navigateTo(mode) {
    closeSidebar();
    showView(mode);
    pushHistoryState(mode);
}

// ============================================
// LOAD INDEX
// ============================================

async function loadIndex() {
    if (resultsDiv) {
        resultsDiv.innerHTML = '<div class="loading">Loading songbook...</div>';
    }

    try {
        const response = await fetch('data/index.jsonl');
        const text = await response.text();
        const songs = text.trim().split('\n').map(line => JSON.parse(line));
        setAllSongs(songs);

        // Build song groups for version detection
        const groups = {};
        songs.forEach(song => {
            const groupId = song.group_id;
            if (groupId) {
                if (!groups[groupId]) {
                    groups[groupId] = [];
                }
                groups[groupId].push(song);
            }
        });
        setSongGroups(groups);

        // Update subtitle with song count
        const distinctTitles = new Set(songs.map(s => s.title?.toLowerCase())).size;
        const subtitle = document.getElementById('subtitle');
        if (subtitle) {
            subtitle.textContent = `${distinctTitles.toLocaleString()} songs with chords`;
        }

        if (resultsDiv) {
            resultsDiv.innerHTML = '';
        }
        if (searchStats) {
            searchStats.textContent = `${distinctTitles.toLocaleString()} songs`;
        }

        // Enable browser history navigation
        setHistoryInitialized(true);

        // Handle deep links or show default view
        if (!handleDeepLink()) {
            showRandomSongs();
            searchInput?.focus();
            history.replaceState({ view: 'search' }, '', window.location.pathname);
        }
    } catch (error) {
        console.error('Failed to load index:', error);
        if (resultsDiv) {
            resultsDiv.innerHTML = `<div class="loading">Error loading songs: ${error.message}</div>`;
        }
    }
}

// ============================================
// AUTH UI
// ============================================

function updateAuthUI(user) {
    if (user) {
        // Hide sign-in button, show user info
        signInBtn?.classList.add('hidden');
        userInfo?.classList.remove('hidden');

        // Populate user info
        if (userAvatar) {
            userAvatar.src = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
        }
        if (userName) {
            userName.textContent = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
        }

        updateSyncUI('syncing');
        performFullSync();
        performFullListsSync();
    } else {
        // Show sign-in button, hide user info
        signInBtn?.classList.remove('hidden');
        userInfo?.classList.add('hidden');
        updateSyncUI('offline');
    }
}

// ============================================
// MODALS
// ============================================

function closeAccountModal() {
    accountModal?.classList.add('hidden');
}

function openAccountModal() {
    accountModal?.classList.remove('hidden');
}

function closeListsModal() {
    listsModal?.classList.add('hidden');
}

function openListsModal() {
    listsModal?.classList.remove('hidden');
    renderListsModal();
}


// ============================================
// FEEDBACK
// ============================================

function toggleFeedbackDropdown() {
    feedbackDropdown?.classList.toggle('hidden');
}

function closeFeedbackDropdown() {
    feedbackDropdown?.classList.add('hidden');
}

function handleFeedbackOption(type) {
    closeFeedbackDropdown();
    closeSidebar();

    const song = getCurrentSong();

    switch (type) {
        case 'song-issue':
            // Open bug report modal for song display issues
            if (bugModal) {
                bugModal.classList.remove('hidden');
                if (bugFeedback) {
                    bugFeedback.value = song ? `Song: ${song.title} by ${song.artist}\n\n` : '';
                    bugFeedback.focus();
                }
            }
            break;
        case 'song-correction':
            // Show correction modal with edit option
            if (song) {
                correctionModal?.classList.remove('hidden');
            } else {
                // No song open, just show feedback form
                openContactModal('Song Correction', '');
            }
            break;
        case 'search-problem':
        case 'app-issue':
        case 'request-song':
        case 'feature-idea':
        case 'general':
        case 'copyright':
            // Open contact modal for general feedback
            const titles = {
                'search-problem': 'Report Search Problem',
                'app-issue': 'Report App Issue',
                'request-song': 'Request a Song',
                'feature-idea': 'Feature Idea',
                'general': 'General Feedback',
                'copyright': 'Copyright Concern'
            };
            openContactModal(titles[type] || 'Send Feedback', '');
            break;
    }
}

function openContactModal(title, prefill) {
    if (contactModal) {
        if (contactModalTitle) {
            contactModalTitle.textContent = title;
        }
        contactModal.classList.remove('hidden');
        if (contactFeedback) {
            contactFeedback.value = prefill;
            contactFeedback.focus();
        }
    }
}

function closeBugModal() {
    bugModal?.classList.add('hidden');
    if (bugFeedback) bugFeedback.value = '';
}

function closeCorrectionModal() {
    correctionModal?.classList.add('hidden');
}

function closeContactModal() {
    contactModal?.classList.add('hidden');
    if (contactFeedback) contactFeedback.value = '';
}

function submitBugReport() {
    const feedback = bugFeedback?.value.trim();
    if (!feedback) return;

    const subject = encodeURIComponent('Song Issue Report');
    const body = encodeURIComponent(feedback);
    window.open(`mailto:bluegrassbook.feedback@gmail.com?subject=${subject}&body=${body}`);
    closeBugModal();
}

function submitContactForm() {
    const feedback = contactFeedback?.value.trim();
    if (!feedback) return;

    const title = contactModalTitle?.textContent || 'Feedback';
    const subject = encodeURIComponent(title);
    const body = encodeURIComponent(feedback);
    window.open(`mailto:bluegrassbook.feedback@gmail.com?subject=${subject}&body=${body}`);
    closeContactModal();
}

// ============================================
// PRINT VIEW
// ============================================

function openPrintView() {
    const song = getCurrentSong();
    const chordpro = getCurrentChordpro();
    if (!song || !chordpro) return;

    const title = song.title || 'Song';
    const artist = song.artist || '';
    const key = currentDetectedKey || song.key || 'C';

    const printHtml = generatePrintPage(title, artist, key, chordpro);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow popups for print view');
        return;
    }
    printWindow.document.write(printHtml);
    printWindow.document.close();
}

function generatePrintPage(title, artist, key, chordpro) {
    const song = getCurrentSong();
    const originalKey = originalDetectedKey || song?.key || 'C';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} - Bluegrass Book</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Courier New', Courier, monospace;
            background: white;
            color: black;
            padding: 1rem;
            max-width: 1200px;
            margin: 0 auto;
        }
        .controls {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            align-items: center;
            padding: 1rem;
            background: #f5f5f5;
            border-radius: 8px;
            margin-bottom: 1.5rem;
        }
        @media print {
            .controls { display: none; }
            body { padding: 0; max-width: none; }
        }
        .control-group { display: flex; align-items: center; gap: 0.5rem; }
        select, button {
            padding: 0.4rem 0.6rem;
            font-size: 0.85rem;
            border: 1px solid #ccc;
            border-radius: 4px;
            background: white;
            cursor: pointer;
        }
        button:hover { background: #eee; }
        .control-label {
            font-size: 0.9rem;
            font-family: system-ui, sans-serif;
            font-weight: 600;
            color: #444;
            white-space: nowrap;
        }
        .font-size-control {
            display: flex;
            align-items: center;
            gap: 4px;
            background: #f0f0f0;
            border-radius: 4px;
            padding: 4px 8px;
            margin-left: 12px;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-left: 16px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 6px 12px;
        }
        .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 0.85rem;
            font-family: system-ui, sans-serif;
            cursor: pointer;
        }
        .size-btn {
            width: 28px;
            height: 28px;
            padding: 0;
            font-size: 1.1rem;
            font-weight: bold;
            border: none;
            background: white;
            border-radius: 3px;
        }
        #font-size-input {
            width: 45px;
            height: 24px;
            text-align: center;
            border: none;
            border-radius: 3px;
            font-size: 0.85rem;
            -moz-appearance: textfield;
        }
        #font-size-input::-webkit-outer-spin-button,
        #font-size-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .print-btn {
            background: #2563eb;
            color: white;
            border: none;
            margin-left: auto;
        }
        .print-btn:hover { background: #1d4ed8; }
        .header {
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid black;
        }
        .two-columns .header { column-span: all; }
        .title {
            font-size: 1.5rem;
            font-weight: bold;
            font-family: system-ui, sans-serif;
        }
        .artist {
            font-size: 1.1rem;
            color: #444;
            font-family: system-ui, sans-serif;
        }
        .key-info {
            font-size: 0.9rem;
            color: #666;
            margin-top: 0.25rem;
            font-family: system-ui, sans-serif;
        }
        .two-columns #song-content {
            column-count: 2;
            column-gap: 2rem;
        }
        .section {
            margin-bottom: 1rem;
            break-inside: avoid;
        }
        .section-label {
            font-weight: bold;
            margin-bottom: 0.25rem;
            font-family: system-ui, sans-serif;
        }
        .hide-labels .section-label { display: none; }
        .line-group { margin-bottom: 0.25rem; }
        .chord-line {
            font-weight: bold;
            color: black;
            white-space: pre;
            line-height: 1.2;
        }
        .chord-line.nashville { color: #444; }
        .lyric-line {
            white-space: pre;
            line-height: 1.3;
        }
        .hide-chords .chord-line { display: none; }
        .repeat-instruction {
            font-style: italic;
            color: #666;
            margin: 0.5rem 0;
            font-family: system-ui, sans-serif;
        }
        #song-content { font-size: var(--font-size, 14px); }
    </style>
</head>
<body>
    <div class="controls">
        <div class="control-group">
            <span class="control-label">Key:</span>
            <select id="key-select">
                ${generateKeyOptions(key)}
            </select>
        </div>
        <div class="font-size-control">
            <span class="control-label">Size:</span>
            <button id="font-decrease" class="size-btn">−</button>
            <input type="number" id="font-size-input" value="14" min="8" max="32">
            <button id="font-increase" class="size-btn">+</button>
        </div>
        <div class="checkbox-group">
            <span class="control-label">Show:</span>
            <label>
                <select id="chord-mode-select">
                    <option value="all" selected>All Chords</option>
                    <option value="first">First Only</option>
                    <option value="none">No Chords</option>
                </select>
            </label>
            <label><input type="checkbox" id="compact-toggle"> Compact</label>
            <label><input type="checkbox" id="nashville-toggle"> Nashville</label>
            <label><input type="checkbox" id="columns-toggle"> 2 Columns</label>
            <label><input type="checkbox" id="labels-toggle" checked> Labels</label>
        </div>
        <button class="print-btn" onclick="window.print()">Print</button>
    </div>

    <div class="header">
        <div class="title">${escapeHtml(title)}</div>
        ${artist ? `<div class="artist">${escapeHtml(artist)}</div>` : ''}
        <div class="key-info">Key: <span id="current-key">${escapeHtml(key)}</span></div>
    </div>

    <div id="song-content"></div>

    <script>
        const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
        const originalChordpro = ${JSON.stringify(chordpro)};
        const originalKey = ${JSON.stringify(key)};
        let currentKey = originalKey;
        let nashvilleMode = false;
        let compactMode = false;
        let chordMode = 'all';

        function normalizeKey(key) {
            const map = { 'Db': 'C#', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb' };
            return map[key] || key;
        }

        function getSemitones(from, to) {
            const fromIdx = KEYS.indexOf(normalizeKey(from));
            const toIdx = KEYS.indexOf(normalizeKey(to));
            if (fromIdx === -1 || toIdx === -1) return 0;
            return (toIdx - fromIdx + 12) % 12;
        }

        function transposeChord(chord, semitones) {
            if (semitones === 0) return chord;
            const match = chord.match(/^([A-G][#b]?)(.*)$/);
            if (!match) return chord;
            const [, root, suffix] = match;
            const idx = KEYS.indexOf(normalizeKey(root));
            if (idx === -1) return chord;
            const newIdx = (idx + semitones + 12) % 12;
            return KEYS[newIdx] + suffix;
        }

        function toNashville(chord, key) {
            const degrees = { 0: 'I', 1: '#I', 2: 'II', 3: 'bIII', 4: 'III', 5: 'IV',
                            6: '#IV', 7: 'V', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII' };
            const match = chord.match(/^([A-G][#b]?)(.*)$/);
            if (!match) return chord;
            const [, root, suffix] = match;
            const keyIdx = KEYS.indexOf(normalizeKey(key));
            const chordIdx = KEYS.indexOf(normalizeKey(root));
            if (keyIdx === -1 || chordIdx === -1) return chord;
            const interval = (chordIdx - keyIdx + 12) % 12;
            let degree = degrees[interval] || interval.toString();
            if (suffix.startsWith('m') && !suffix.startsWith('maj')) {
                degree = degree.toLowerCase();
            }
            return degree + suffix.replace(/^m(?!aj)/, '');
        }

        function lineToAscii(line, semitones) {
            const chordRegex = /\\[([^\\]]+)\\]/g;
            const chords = [];
            let match;
            let lastIndex = 0;
            let lyricsOnly = '';

            while ((match = chordRegex.exec(line)) !== null) {
                lyricsOnly += line.substring(lastIndex, match.index);
                let chord = transposeChord(match[1], semitones);
                if (nashvilleMode) {
                    chord = toNashville(chord, currentKey);
                }
                chords.push({ chord, position: lyricsOnly.length });
                lastIndex = match.index + match[0].length;
            }
            lyricsOnly += line.substring(lastIndex);

            let chordLine = '';
            for (const { chord, position } of chords) {
                const minPos = chordLine.length > 0 ? chordLine.length + 1 : 0;
                const targetPos = Math.max(position, minPos);
                while (chordLine.length < targetPos) {
                    chordLine += ' ';
                }
                chordLine += chord;
            }

            return { chordLine: chordLine.trimEnd(), lyricLine: lyricsOnly };
        }

        function escapeHtmlInline(text) {
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function renderContent() {
            const semitones = getSemitones(originalKey, currentKey);
            const NL = String.fromCharCode(10);
            const lines = originalChordpro.split(NL);
            let html = '';
            let inSection = false;
            let currentSectionType = '';
            let currentSectionLabel = '';
            let currentSectionLines = [];
            const seenSections = {};

            function renderSection(sectionLines, hideChords) {
                let sectionHtml = '';
                for (const line of sectionLines) {
                    if (!line.trim()) {
                        sectionHtml += '<div class="line-group"><div class="lyric-line">&nbsp;</div></div>';
                        continue;
                    }
                    const { chordLine, lyricLine } = lineToAscii(line, semitones);
                    sectionHtml += '<div class="line-group">';
                    if (chordLine && !hideChords) {
                        sectionHtml += '<div class="chord-line' + (nashvilleMode ? ' nashville' : '') + '">' +
                                escapeHtmlInline(chordLine) + '</div>';
                    }
                    sectionHtml += '<div class="lyric-line">' + escapeHtmlInline(lyricLine || ' ') + '</div>';
                    sectionHtml += '</div>';
                }
                return sectionHtml;
            }

            function flushSection() {
                if (!currentSectionType) return;
                const contentKey = currentSectionLines.join(NL).trim();
                const label = currentSectionLabel || currentSectionType.charAt(0).toUpperCase() + currentSectionType.slice(1);

                let foundMatch = null;
                if (compactMode || chordMode === 'first') {
                    for (const key in seenSections) {
                        if (seenSections[key].content === contentKey) {
                            foundMatch = seenSections[key];
                            break;
                        }
                    }
                }

                const hideChords = chordMode === 'none' || (chordMode === 'first' && foundMatch);

                if (compactMode && foundMatch) {
                    html += '<div class="repeat-instruction">[Repeat ' + foundMatch.label + ']</div>';
                } else {
                    html += '<div class="section"><div class="section-label">' + label + '</div>';
                    html += renderSection(currentSectionLines, hideChords);
                    html += '</div>';

                    if (!foundMatch) {
                        const uniqueKey = currentSectionType + '_' + Object.keys(seenSections).length;
                        seenSections[uniqueKey] = { content: contentKey, label: label };
                    }
                }

                currentSectionType = '';
                currentSectionLabel = '';
                currentSectionLines = [];
            }

            for (const line of lines) {
                if (line.indexOf('{meta:') === 0) continue;

                if (line.indexOf('{start_of_') === 0) {
                    flushSection();
                    const typeMatch = line.match(/start_of_(verse|chorus|bridge)/);
                    if (typeMatch) {
                        currentSectionType = typeMatch[1];
                        const colonIdx = line.indexOf(':');
                        if (colonIdx > 0) {
                            currentSectionLabel = line.substring(colonIdx + 1, line.length - 1).trim();
                        } else {
                            currentSectionLabel = '';
                        }
                        inSection = true;
                        continue;
                    }
                }

                if (line.indexOf('{end_of_') === 0) {
                    flushSection();
                    inSection = false;
                    continue;
                }

                if (line.charAt(0) === '{' && line.charAt(line.length - 1) === '}') continue;

                if (inSection) {
                    currentSectionLines.push(line);
                } else {
                    if (!line.trim()) {
                        html += '<div class="line-group"><div class="lyric-line">&nbsp;</div></div>';
                        continue;
                    }
                    const { chordLine, lyricLine } = lineToAscii(line, semitones);
                    html += '<div class="line-group">';
                    if (chordLine) {
                        html += '<div class="chord-line' + (nashvilleMode ? ' nashville' : '') + '">' +
                                escapeHtmlInline(chordLine) + '</div>';
                    }
                    html += '<div class="lyric-line">' + escapeHtmlInline(lyricLine || ' ') + '</div>';
                    html += '</div>';
                }
            }

            flushSection();
            document.getElementById('song-content').innerHTML = html;
            document.getElementById('current-key').textContent = currentKey;
        }

        document.getElementById('key-select').addEventListener('change', (e) => {
            currentKey = e.target.value;
            renderContent();
        });

        let currentFontSize = 14;
        const fontSizeInput = document.getElementById('font-size-input');

        function updateFontSize() {
            currentFontSize = Math.max(8, Math.min(32, currentFontSize));
            document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
            fontSizeInput.value = currentFontSize;
        }

        document.getElementById('font-decrease').addEventListener('click', () => {
            currentFontSize -= 2;
            updateFontSize();
        });

        document.getElementById('font-increase').addEventListener('click', () => {
            currentFontSize += 2;
            updateFontSize();
        });

        fontSizeInput.addEventListener('change', (e) => {
            currentFontSize = parseInt(e.target.value, 10) || 14;
            updateFontSize();
        });

        document.getElementById('nashville-toggle').addEventListener('change', (e) => {
            nashvilleMode = e.target.checked;
            renderContent();
        });

        document.getElementById('chord-mode-select').addEventListener('change', (e) => {
            chordMode = e.target.value;
            renderContent();
        });

        document.getElementById('labels-toggle').addEventListener('change', (e) => {
            document.body.classList.toggle('hide-labels', !e.target.checked);
        });

        document.getElementById('columns-toggle').addEventListener('change', (e) => {
            document.body.classList.toggle('two-columns', e.target.checked);
        });

        document.getElementById('compact-toggle').addEventListener('change', (e) => {
            compactMode = e.target.checked;
            renderContent();
        });

        renderContent();
    <\/script>
</body>
</html>`;
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

function handleExport(action) {
    const song = getCurrentSong();
    const chordpro = getCurrentChordpro();
    if (!song || !chordpro) return;

    const title = song.title || 'song';

    switch (action) {
        case 'copy-chordpro':
            navigator.clipboard.writeText(chordpro);
            break;
        case 'copy-text':
            const text = chordpro.replace(/\[[^\]]+\]/g, '').replace(/\{[^}]+\}/g, '');
            navigator.clipboard.writeText(text);
            break;
        case 'download-chordpro':
            downloadFile(`${title}.pro`, chordpro, 'text/plain');
            break;
        case 'download-text':
            const plainText = chordpro.replace(/\[[^\]]+\]/g, '').replace(/\{[^}]+\}/g, '');
            downloadFile(`${title}.txt`, plainText, 'text/plain');
            break;
    }
}

function downloadFile(filename, content, mimeType) {
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

// ============================================
// INITIALIZATION
// ============================================

function init() {
    // Initialize theme
    initTheme();

    // Initialize modules
    initFavorites({
        navFavorites,
        navSearch,
        navFavoritesCount,
        searchStats,
        searchInput,
        resultsDiv,
        renderResults,
        showRandomSongs
    });

    initLists({
        navListsContainer,
        navSearch,
        navFavorites,
        navAddSong,
        searchStats,
        searchInput,
        resultsDiv,
        songView,
        listsContainer,
        customListsContainer,
        favoritesCheckbox,
        listPickerBtn,
        renderResults,
        closeSidebar
    });

    initSongView({
        songView,
        songContent,
        resultsDiv,
        listPickerDropdown,
        versionModal,
        versionModalClose,
        versionModalTitle,
        versionList,
        pushHistoryState,
        showView,
        backBtn
    });

    initSearch({
        searchInput,
        searchStats,
        resultsDiv,
        navFavorites,
        navSearch
    });

    initTagDropdown({
        searchInput,
        tagDropdownBtn,
        tagDropdownContent,
        search,
        parseSearchQuery
    });

    initEditor({
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
    });

    // Setup event listeners

    // Theme toggle
    themeToggle?.addEventListener('click', toggleTheme);

    // Sidebar
    menuBtn?.addEventListener('click', openSidebar);
    sidebarBackdrop?.addEventListener('click', closeSidebar);

    // Home buttons - go home
    const goHome = () => {
        navigateTo('search');
        searchInput.value = '';
        showRandomSongs();
    };

    logoLink?.addEventListener('click', (e) => {
        e.preventDefault();
        goHome();
    });

    homeBtn?.addEventListener('click', goHome);

    // Navigation
    navSearch?.addEventListener('click', () => navigateTo('search'));
    navAddSong?.addEventListener('click', () => navigateTo('add-song'));
    navFavorites?.addEventListener('click', () => navigateTo('favorites'));
    editorBackBtn?.addEventListener('click', () => navigateTo('search'));

    // Account modal
    accountBtn?.addEventListener('click', openAccountModal);
    accountModalClose?.addEventListener('click', closeAccountModal);
    accountModal?.addEventListener('click', (e) => {
        if (e.target === accountModal) closeAccountModal();
    });

    // Lists modal
    manageListsBtn?.addEventListener('click', () => {
        closeSidebar();
        openListsModal();
    });
    listsModalClose?.addEventListener('click', closeListsModal);
    listsModal?.addEventListener('click', (e) => {
        if (e.target === listsModal) closeListsModal();
    });

    // Feedback button and dropdown
    feedbackBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        feedbackBtn?.classList.remove('highlight-pulse');
        toggleFeedbackDropdown();
    });
    navFeedback?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSidebar();
        // Small delay to let sidebar close before showing dropdown
        setTimeout(() => {
            feedbackBtn?.classList.add('highlight-pulse');
            toggleFeedbackDropdown();
            setTimeout(() => {
                feedbackBtn?.classList.remove('highlight-pulse');
            }, 3000);
        }, 150);
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!feedbackBtn?.contains(e.target) && !feedbackDropdown?.contains(e.target)) {
            closeFeedbackDropdown();
        }
    });

    // Feedback option buttons
    feedbackDropdown?.querySelectorAll('.feedback-option[data-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            if (type) handleFeedbackOption(type);
        });
    });

    // Bug report modal
    bugModalClose?.addEventListener('click', closeBugModal);
    bugModal?.addEventListener('click', (e) => {
        if (e.target === bugModal) closeBugModal();
    });
    bugSubmitBtn?.addEventListener('click', submitBugReport);

    // Song correction modal
    correctionModalClose?.addEventListener('click', closeCorrectionModal);
    correctionModal?.addEventListener('click', (e) => {
        if (e.target === correctionModal) closeCorrectionModal();
    });
    correctionEditBtn?.addEventListener('click', () => {
        closeCorrectionModal();
        // Trigger edit mode for current song
        enterEditMode(getCurrentSong());
    });
    correctionFeedbackBtn?.addEventListener('click', () => {
        closeCorrectionModal();
        const song = getCurrentSong();
        openContactModal('Song Correction', song ? `Song: ${song.title} by ${song.artist}\n\n` : '');
    });

    // Contact modal
    contactModalClose?.addEventListener('click', closeContactModal);
    contactModal?.addEventListener('click', (e) => {
        if (e.target === contactModal) closeContactModal();
    });
    contactSubmitBtn?.addEventListener('click', submitContactForm);

    // List picker
    listPickerBtn?.addEventListener('click', () => {
        listPickerDropdown?.classList.toggle('hidden');
        if (!listPickerDropdown?.classList.contains('hidden')) {
            renderListPickerDropdown();
        }
    });

    // Create list from modal
    modalCreateListBtn?.addEventListener('click', () => {
        const name = modalNewListInput?.value.trim();
        if (name) {
            createList(name);
            modalNewListInput.value = '';
            renderListsModal();
        }
    });

    // Print button
    printBtn?.addEventListener('click', openPrintView);

    // Export dropdowns - toggle on button click
    copyBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadDropdown?.classList.add('hidden');
        copyDropdown?.classList.toggle('hidden');
    });
    downloadBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        copyDropdown?.classList.add('hidden');
        downloadDropdown?.classList.toggle('hidden');
    });

    // Export option clicks
    copyDropdown?.querySelectorAll('.export-option[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            handleExport(btn.dataset.action);
            copyDropdown.classList.add('hidden');
        });
    });
    downloadDropdown?.querySelectorAll('.export-option[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            handleExport(btn.dataset.action);
            downloadDropdown.classList.add('hidden');
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!copyBtn?.contains(e.target) && !copyDropdown?.contains(e.target)) {
            copyDropdown?.classList.add('hidden');
        }
        if (!downloadBtn?.contains(e.target) && !downloadDropdown?.contains(e.target)) {
            downloadDropdown?.classList.add('hidden');
        }
    });

    // History navigation
    window.addEventListener('popstate', (e) => {
        handleHistoryNavigation(e.state);
    });

    // Initialize Supabase auth
    if (typeof SupabaseAuth !== 'undefined') {
        SupabaseAuth.init();
        SupabaseAuth.onAuthChange((event, user) => {
            updateAuthUI(user);
        });

        signInBtn?.addEventListener('click', async () => {
            closeAccountModal();
            await SupabaseAuth.signInWithGoogle();
        });

        // Click on user info opens account modal
        userInfo?.addEventListener('click', () => {
            openAccountModal();
        });
    }

    // Load the index
    loadIndex();
}

// Start the app
init();
