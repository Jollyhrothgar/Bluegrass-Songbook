// Unified ListPicker component for Bluegrass Songbook
// Used in song view and search results for adding songs to lists

import { userLists, FAVORITES_LIST_ID } from './state.js';
import {
    createList, addSongToList, removeSongFromList,
    isFavorite, toggleFavorite, isSongInAnyList
} from './lists.js';
import { escapeHtml } from './utils.js';

let activePicker = null;

/**
 * Show a list picker positioned relative to a trigger element
 * @param {string} songId - The song to add/remove from lists
 * @param {HTMLElement} triggerEl - The button/element that triggered the picker
 * @param {Object} options - Additional options
 * @param {Function} options.onClose - Callback when picker closes
 * @param {Function} options.onUpdate - Callback when list membership changes
 */
export function showListPicker(songId, triggerEl, options = {}) {
    // Close any existing picker
    closeListPicker();

    const picker = document.createElement('div');
    picker.className = 'list-picker-popup';
    picker.innerHTML = renderPickerContent(songId);

    // Position relative to trigger
    document.body.appendChild(picker);
    positionPicker(picker, triggerEl);

    // Store reference
    activePicker = {
        element: picker,
        songId,
        triggerEl,
        onClose: options.onClose,
        onUpdate: options.onUpdate
    };

    // Set up event handlers
    setupPickerEvents(picker, songId, options);

    // Close when clicking outside
    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
    }, 0);
}

/**
 * Close the active list picker
 */
export function closeListPicker() {
    if (activePicker) {
        activePicker.element.remove();
        if (activePicker.onClose) {
            activePicker.onClose();
        }
        activePicker = null;
    }
    document.removeEventListener('click', handleOutsideClick);
}

/**
 * Check if a picker is currently open
 */
export function isPickerOpen() {
    return activePicker !== null;
}

/**
 * Update the trigger button appearance based on list membership
 */
export function updateTriggerButton(triggerEl, songId) {
    if (!triggerEl || !songId) return;

    const inFavorites = isFavorite(songId);
    const inAnyList = isSongInAnyList(songId);

    triggerEl.classList.toggle('has-lists', inFavorites || inAnyList);
}

// ============================================
// INTERNAL FUNCTIONS
// ============================================

function renderPickerContent(songId) {
    const inFavorites = isFavorite(songId);
    const customLists = userLists.filter(l => l.id !== FAVORITES_LIST_ID);

    return `
        <label class="list-picker-option favorites-option">
            <input type="checkbox" data-type="favorites" ${inFavorites ? 'checked' : ''}>
            <span class="heart-icon">&#9829;</span>
            <span>Favorites</span>
        </label>
        <div class="list-picker-divider"></div>
        <div class="list-picker-lists">
            ${customLists.map(list => `
                <label class="list-picker-option">
                    <input type="checkbox" data-type="list" data-list-id="${list.id}"
                           ${list.songs.includes(songId) ? 'checked' : ''}>
                    <span>&#9776;</span>
                    <span>${escapeHtml(list.name)}</span>
                </label>
            `).join('')}
        </div>
        <button class="list-picker-new-btn" data-action="new-list">+ New List</button>
        <div class="list-picker-form hidden">
            <input type="text" class="list-picker-input" placeholder="List name" maxlength="50">
            <button class="list-picker-add-btn">Add</button>
        </div>
    `;
}

function positionPicker(picker, triggerEl) {
    const rect = triggerEl.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();

    // Default: below and aligned to left edge
    let top = rect.bottom + 4;
    let left = rect.left;

    // If would go off right edge, align to right instead
    if (left + pickerRect.width > window.innerWidth - 10) {
        left = rect.right - pickerRect.width;
    }

    // If would go off bottom, show above
    if (top + pickerRect.height > window.innerHeight - 10) {
        top = rect.top - pickerRect.height - 4;
    }

    picker.style.top = `${top}px`;
    picker.style.left = `${left}px`;
}

function setupPickerEvents(picker, songId, options) {
    // Handle checkbox changes
    picker.addEventListener('change', (e) => {
        if (e.target.type !== 'checkbox') return;

        if (e.target.dataset.type === 'favorites') {
            toggleFavorite(songId);
        } else if (e.target.dataset.type === 'list') {
            const listId = e.target.dataset.listId;
            if (e.target.checked) {
                addSongToList(listId, songId);
            } else {
                removeSongFromList(listId, songId);
            }
        }

        // Update trigger button
        if (activePicker?.triggerEl) {
            updateTriggerButton(activePicker.triggerEl, songId);
        }

        // Callback
        if (options.onUpdate) {
            options.onUpdate(songId);
        }
    });

    // Handle new list button
    const newBtn = picker.querySelector('[data-action="new-list"]');
    const form = picker.querySelector('.list-picker-form');
    const input = picker.querySelector('.list-picker-input');
    const addBtn = picker.querySelector('.list-picker-add-btn');

    newBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        newBtn.classList.add('hidden');
        form?.classList.remove('hidden');
        input?.focus();
    });

    function submitNewList() {
        const name = input?.value.trim();
        if (name) {
            const newList = createList(name);
            if (newList) {
                addSongToList(newList.id, songId);

                // Update trigger button
                if (activePicker?.triggerEl) {
                    updateTriggerButton(activePicker.triggerEl, songId);
                }

                // Callback
                if (options.onUpdate) {
                    options.onUpdate(songId);
                }

                closeListPicker();
            } else {
                // List already exists - flash error
                if (input) {
                    input.style.borderColor = '#e74c3c';
                    setTimeout(() => { input.style.borderColor = ''; }, 1000);
                }
                return;
            }
        }
        // Reset form
        if (input) input.value = '';
        form?.classList.add('hidden');
        newBtn?.classList.remove('hidden');
    }

    addBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        submitNewList();
    });

    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitNewList();
        } else if (e.key === 'Escape') {
            input.value = '';
            form?.classList.add('hidden');
            newBtn?.classList.remove('hidden');
        }
    });

    // Prevent clicks inside picker from closing it
    picker.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

function handleOutsideClick(e) {
    if (activePicker && !activePicker.element.contains(e.target) &&
        !activePicker.triggerEl.contains(e.target)) {
        closeListPicker();
    }
}
