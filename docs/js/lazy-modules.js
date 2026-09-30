// Modules that are fetched on demand (import() from the boot graph) and so
// are NOT in the page's first load. sw-strategy.js precaches this list.
//
// Why it exists: the service worker's runtime cache only keeps what the page
// has actually requested. Boot modules are requested on every online load, so
// they are always there for offline use. A lazy module (the song editor, the
// tab renderer and player, the drafts list, ...) is requested only when its
// route or action first runs — a reader who went offline before ever opening
// #drafts would find it missing, and #drafts is the PWA's offline surface.
//
// Keep it in sync by adding/removing a line when a module becomes (or stops
// being) lazy. __tests__/lazy-modules.test.js derives the truth from the
// source and fails with the exact difference, so this cannot rot silently.
//
// Paths are relative to docs/ like the rest of PRECACHE_URLS.

export const LAZY_MODULE_URLS = [
    './js/audio-unlock.js',
    './js/bounty-view.js',
    './js/chord-explorer/theory.js',
    './js/dedup-check.js',
    './js/drafts-view.js',
    './js/editor.js',
    './js/high-scores.js',
    './js/list-export.js',
    './js/my-submissions.js',
    './js/otf-editor/actions.js',
    './js/otf-editor/bindings.js',
    './js/otf-editor/context-menu.js',
    './js/otf-editor/cursor.js',
    './js/otf-editor/editor.js',
    './js/otf-editor/facade.js',
    './js/otf-editor/keyboard.js',
    './js/otf-editor/menu-bar.js',
    './js/otf-editor/pitch.js',
    './js/otf-editor/popover.js',
    './js/otf-editor/recorder.js',
    './js/otf-editor/state.js',
    './js/otf-editor/toolbar.js',
    './js/otf-editor/work-edit.js',
    './js/renderers/tab-hit-test.js',
    './js/renderers/tab-player.js',
    './js/renderers/tablature.js',
    './js/review-queue.js',
    './js/smart-paste.js',
    './js/tab-controls-sheet.js',
    './js/tab-edit-band.js',
    './js/tab-playback-interactions.js',
    './js/tef-import/index.js',
    './js/tef-import/otf.js',
    './js/tef-import/reader.js',
    './js/title-match.js',
    './js/visual-editor/autoscroll.js',
    './js/visual-editor/drag-reorder.js',
    './js/visual-editor/line-view.js',
    './js/visual-editor/model.js',
    './js/visual-editor/palette.js',
    './js/visual-editor/popover-position.js',
    './js/visual-editor/preview.js',
    './js/visual-editor/syllables.js',
    './js/visual-editor/wrap-section.js',
    './js/zip.js',
];
