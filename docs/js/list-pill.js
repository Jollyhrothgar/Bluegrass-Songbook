// The set-list pill (G19c): "‹ 2 of 9 ›" at the left of the song page's
// bottom dock, when the song was opened from a list. It replaces the old
// second fixed bar (#song-nav-bar). Prev and next step through the list, the
// middle goes back to it, and ← / → on the keyboard do the same as ‹ and ›.
//
// Pure decisions live here (`listPillModel`, `isStepKey`), as does the one
// DOM piece. The page owns what stepping does: song-view.js navigatePrev /
// navigateNext and goToList.

/**
 * What the pill shows for a list context (state.js `listContext`), or null
 * when there is no pill: no list, an empty one, or a position outside it
 * (the list view itself sets currentIndex -1).
 *
 * @returns {null | {index, total, label, listName, hasPrev, hasNext}}
 */
export function listPillModel(ctx) {
    const total = ctx?.songIds?.length || 0;
    const index = ctx?.currentIndex;
    if (!ctx?.listId || !total || !Number.isInteger(index) || index < 0 || index >= total) return null;
    return {
        index,
        total,
        label: `${index + 1} of ${total}`,
        listName: ctx.listName || '',
        hasPrev: index > 0,
        hasNext: index < total - 1,
    };
}

/** Where a typed key belongs to something else: a field, an editor, a dialog. */
const NOT_FOR_STEPPING = [
    'input', 'textarea', 'select', '[contenteditable]', '[role="dialog"]',
    '.cm-editor',                                   // the lyrics editor's CodeMirror
    '.otf-editor', '.editor-canvas-container',      // the tab editor and its canvas
    '#editor-panel',                                // the lyrics & chords editor
].join(',');

/**
 * Should this keydown step through the list? ← and → on their own, from
 * anywhere that is not typing: not in a field, an editor or an open sheet,
 * not with a modifier (Alt+← is the browser's Back) and not once something
 * else has taken the key.
 *
 * @param {KeyboardEvent} e
 * @returns {'prev' | 'next' | null}
 */
export function isStepKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return null;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
    // The tab editor is open: with focus off its canvas, a stray arrow must not leave unsaved work
    if (document.body.classList.contains('tab-editing')) return null;
    const target = e.target;
    if (target?.isContentEditable) return null;
    if (target?.closest?.(NOT_FOR_STEPPING)) return null;
    return e.key === 'ArrowLeft' ? 'prev' : 'next';
}

/**
 * The pill's DOM: three buttons in one capsule. The middle one is the way
 * back to the list, so it names the list in its tooltip.
 */
export function buildListPill(model, { onPrev, onNext, onList }) {
    const el = document.createElement('span');
    el.className = 'list-pill';
    el.id = 'list-pill';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', model.listName ? `In ${model.listName}` : 'In this list');
    const part = (cls, text, label, title, handler, disabled = false) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `list-pill-btn ${cls}`;
        b.textContent = text;
        b.setAttribute('aria-label', label);
        b.title = title;
        b.disabled = disabled;
        b.addEventListener('click', handler);
        return b;
    };
    el.append(
        part('list-prev', '‹', 'Previous song', 'Previous song (←)', onPrev, !model.hasPrev),
        part('list-pos', model.label, `Song ${model.label}: back to ${model.listName || 'the list'}`,
            model.listName ? `Back to ${model.listName}` : 'Back to the list', onList),
        part('list-next', '›', 'Next song', 'Next song (→)', onNext, !model.hasNext),
    );
    return el;
}
