// OTF Editor - Public API
// Export all public classes and utilities

// Main editor class
export { OTFEditor } from './editor.js';

// State management
export {
    EditorState,
    EditorMode,
    CursorPosition,
    SelectionRange,
    DURATIONS,
    DURATION_NAMES,
    TICKS_PER_BEAT,
} from './state.js';

// Components (for advanced customization)
export { EditorCursor } from './cursor.js';
export { KeyboardHandler } from './keyboard.js';
export { EditorToolbar } from './toolbar.js';
export { NoteEntryPopover } from './popover.js';

// Recorder
export { EditEventRecorder, dispatchEditorEvent } from './recorder.js';

// Actions and utilities
export {
    createEmptyOTF,
    addMeasures,
    trimEmptyMeasures,
    quantize,
    transpose,
    shiftNotes,
    copyRange,
    pasteRange,
    deleteRange,
    insertRoll,
    validateOTF,
    cleanupOTF,
    downloadOTF,
} from './actions.js';

// Convenience function to create editor
export async function createEditor(container, options = {}) {
    const { OTFEditor } = await import('./editor.js');
    return new OTFEditor({
        container,
        ...options,
    });
}

// Version
export const VERSION = '1.0.0';
