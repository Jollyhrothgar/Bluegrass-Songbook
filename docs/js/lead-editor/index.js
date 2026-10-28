// Lead-sheet editor controller: mounts the CodeMirror view (cm-editor.js) and
// wires everything around it. THREE MODES, one document:
//
//   lyrics    write, paste, mark sections. Chords are drawn but inert.
//   chords    place / change / move / delete chords. The chart is locked (not
//             editable: no keyboard, no text selection); the chord sheet is
//             always shown and always docked (split top/bottom on phones, a sticky
//             side panel on wide desktop; nothing floats).
//   chordpro  the source beside a read-only preview.
//
// The pure rules live in doc-model.js / section-ops.js / chord-menu-model.js
// (unit-tested); pointing in Chords mode is chords-touch.js.

import { createLeadEditor, DRAG_EVENT } from './cm-editor.js';
import { createChordMenu } from './chord-menu.js';
import { createSusMemory } from './chord-menu-model.js';
import { chordAt, declaredKey, currentSongKey, clipDeletion } from './doc-model.js';
import {
    SECTION_TYPES, markSelection, noteSelection, setNoteText, renameSection, setSectionTypeText, duplicateSectionText,
    moveSectionText, unlabelSection, deleteSectionText, diffChange,
    sectionsForClipboard, placeSectionPaste, holdsSections,
} from './section-ops.js';
import { extractChords, isValidChord } from '../chords.js';
import { parseChordPro, renderSectionsHtml } from '../renderers/chordpro.js';
import { convertPastedText } from '../smart-paste.js';
import { showToast } from '../toast.js';
import { seamAtPoint, cursorAtPoint, seamOfChordEl, seamForPos, firstSeam } from './chords-touch.js';
import {
    moveCursor, cursorOf, sameCursor, placeAtCursor, removeAtCursor, carryChord, cursorNear, chordLineCursor,
    GRAB_SLOP_PX, HOLD_MS, HOLD_SLOP_PX, TICK_MS,
} from './chord-motion.js';
import { createGlideDriver } from './glide-driver.js';
import { createLoupe, boxedEl, LOUPE_SCALE } from './loupe.js';
import { fontSizeLevel, FONT_SIZES, setFontSizeLevel } from '../state.js';

export const MODE_STORAGE_KEY = 'bgb-lead-mode';
export const MODES = ['lyrics', 'chords', 'chordpro'];
// The top magnifier is an accessibility aid: OFF unless this device turned it on.
export const MAGNIFIER_KEY = 'bgb-chord-magnifier';
const FONT_LEVEL_MIN = -5, FONT_LEVEL_MAX = 6;    // the song page's Display pill limits (song-controls.js)
// The chord panel's layout. A wide window with a mouse gets ONE sticky panel beside the chart ('side');
// anything else (a phone, a touch screen, a window too narrow for a side panel) gets the SPLIT dock:
// the magnifier fixed at the top, the picker fixed at the bottom. Nothing floats.
const SIDE_QUERY = '(min-width: 1100px) and (pointer: fine)';
const DOCK_MARGIN = 8;         // breathing room between the cursor's line and a docked part
const IDLE_COMMIT_MS = 800;
const RESUME_GRACE_MS = 1500;
const STRIP_SCALE = 1.4;

/** The remembered mode; the first build's `visual` is Lyrics. */
export function loadMode() {
    try {
        const v = localStorage.getItem(MODE_STORAGE_KEY);
        if (v === 'visual') return 'lyrics';
        return MODES.includes(v) ? v : 'lyrics';
    } catch { return 'lyrics'; }
}

export { declaredKey, currentSongKey };

/** The sheet's key: the song's key (declared, else detected), else G. */
export function menuKey(text) {
    return currentSongKey(text).key || 'G';
}

/** The text with `{key: k}` written (replacing the declaration, else a new first line). */
export function withKey(text, k) {
    const re = /^(\s*)\{(?:key:\s*|meta:\s*key\s+)([A-G][#b]?(?:m|min)?)\s*\}/im;
    if (re.test(text)) return text.replace(re, (_, ws) => `${ws}{key: ${k}}`);
    return `{key: ${k}}\n${text}`;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.host        #editor-lead (holds the workspace)
 * @param {HTMLElement[]} o.modeButtons
 * @param {HTMLElement} o.paneToggle  phone Source|Preview toggle
 * @param {object} o.hooks            { onChange(), onHistory({undo, redo}), onPaste({title, artist, converted}), getDisplay(), onKey(k) }
 */
export function mountLeadEditor({ host, hooks = {} }) {
    const sideMq = window.matchMedia ? window.matchMedia(SIDE_QUERY) : { matches: false, addEventListener() {} };
    const layoutNow = () => (sideMq.matches ? 'side' : 'split');
    const workspaceEl = host.closest?.('.editor-workspace') || null;

    host.innerHTML = '';
    const workspace = document.createElement('div');
    workspace.className = 'le-workspace';
    const sourcePane = document.createElement('div');
    sourcePane.className = 'le-source-pane';
    const cmHost = document.createElement('div');
    cmHost.className = 'le-cm';
    sourcePane.appendChild(cmHost);
    const previewPane = document.createElement('div');
    previewPane.className = 'le-preview-pane';
    previewPane.setAttribute('aria-label', 'Preview (read only)');
    const previewBody = document.createElement('div');
    previewBody.className = 'song-body le-preview-body';
    previewPane.appendChild(previewBody);
    workspace.append(sourcePane, previewPane);
    host.appendChild(workspace);

    // The mode the owner last chose on this device. A song OPENED (setText with reset) gets it;
    // a new empty song always opens in Lyrics, because there is nothing to put chords on yet.
    let preferred = loadMode();
    let mode = 'lyrics';
    let showPreview = false;      // phone Source | Preview
    let sel = null;               // selection bar
    // The feature tour (../tour-editor-demo.js) shows the bar for a selection it
    // made without focusing the editor: on a phone, focus raises the keyboard.
    let presenting = false;
    let labelMenu = null;
    let previewTimer = null;
    let moving = false;           // Chords mode: Move is on, the chord travels with the box
    let suppressClickUntil = 0;

    // the empty-sheet hint: a SIBLING overlay of CodeMirror's content (a CodeMirror placeholder
    // is cloned and made inert, which killed the Paste button and the request link)
    const canReadClipboard = () => !!(window.isSecureContext && navigator.clipboard?.readText);
    // A page that cannot read the clipboard (plain http, e.g. the tailnet dev URL) gets NO Paste button: there it could
    // only show a small hint, and a button that does nothing reads as broken. It says how to paste up front instead.
    const pasteButton = canReadClipboard();
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const howToPaste = window.matchMedia?.('(pointer: coarse)').matches ? 'Tap and hold here, then Paste' : `Press ${isMac ? '⌘' : 'Ctrl+'}V to paste`;
    const emptyHint = document.createElement('div');
    emptyHint.className = 'cl-empty le-empty hidden';
    emptyHint.innerHTML = '<strong>Type or paste your song</strong>'
        + '<span>Lyrics, a chord sheet from the web, or ChordPro. A blank line starts a new verse.</span>'
        + '<span class="cl-empty-actions">' + (pasteButton ? '<button type="button" class="le-paste-btn">Paste</button>' : '')
        + (hooks.onSongRequest ? '<a href="#request-song" class="le-link-request">Request a song instead</a>' : '')
        + `</span><span class="le-paste-hint" role="status"${pasteButton ? ' hidden' : ''}>${pasteButton ? 'Press and hold, then Paste' : howToPaste}</span>`;
    sourcePane.appendChild(emptyHint);
    emptyHint.querySelector('.le-paste-btn')?.addEventListener('click', (e) => { e.stopPropagation(); pasteFromClipboard(); });
    emptyHint.querySelector('.le-link-request')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hooks.onSongRequest(); });
    // tapping the words themselves just starts writing (and, where Paste can't be offered, says how to paste)
    emptyHint.addEventListener('click', () => { view.focus(); if (!canReadClipboard()) showPasteHint(); });
    function showPasteHint() { emptyHint.querySelector('.le-paste-hint').hidden = false; }
    function syncEmpty() {
        const empty = view.state.doc.length === 0 && mode === 'lyrics';
        emptyHint.classList.toggle('hidden', !empty);
        if (!empty && pasteButton) emptyHint.querySelector('.le-paste-hint').hidden = true;   // with no button the hint IS the instruction
    }

    // ---- the editor --------------------------------------------------------
    const editor = createLeadEditor({
        parent: cmHost,
        mode: 'visual',
        displayChord: hooks.getDisplay?.(),
        hooks: {
            onChange(u) { schedulePreview(); syncEmpty(); hooks.onChange?.(u); refreshMenu(); },
            onSelection() { updateSelectionBar(); },
            onHistory(h) { hooks.onHistory?.(h); },
            onChordsRemoved(n) { undoToast(`Removed ${n} chord${n === 1 ? '' : 's'}`); },
            onSectionLabel: (section, el) => openLabelMenu(section, el),
            onComment: (_block, el) => openCommentMenu(el),
            onMouseDown: (e, v) => handleMouseDown(e, v),
            onClick: (e, v) => handleClick(e, v),
            onPaste: (e, v) => handlePaste(e, v),
            onCopy: (e, v, cut) => handleCopy(e, cut),
        },
    });
    const view = editor.view;
    syncEmpty();

    // ---- modes -------------------------------------------------------------
    // the book at the reader's font size (the song page sets this inline, in em)
    function applyFont() {
        const size = `${FONT_SIZES[fontSizeLevel] ?? 1}em`;
        view.contentDOM.style.fontSize = mode !== 'chordpro' ? size : '';
        previewBody.style.fontSize = size;
    }
    /** A− / A+ in the editor toolbar: the SAME fontSizeLevel the song page's Display pill steps. */
    function stepFont(delta) {
        const next = fontSizeLevel + delta;
        if (next < FONT_LEVEL_MIN || next > FONT_LEVEL_MAX) return;
        setFontSizeLevel(next);
        applyFont();
        syncFontButtons();
        // the lines changed height: let CodeMirror re-measure, then redraw everything that is positioned from it
        view.requestMeasure();
        requestAnimationFrame(() => {
            refreshMenu();
            const b = editor.getBox();
            if (b && mode === 'chords') scrollBoxIntoView(b.pos, b.newLine);
            syncRing();
        });
    }
    const fontDownBtn = document.getElementById('editor-font-down');
    const fontUpBtn = document.getElementById('editor-font-up');
    const onFontDown = () => stepFont(-1);
    const onFontUp = () => stepFont(1);
    fontDownBtn?.addEventListener('click', onFontDown);
    fontUpBtn?.addEventListener('click', onFontUp);
    function syncFontButtons() {
        if (fontDownBtn) fontDownBtn.disabled = fontSizeLevel <= FONT_LEVEL_MIN;
        if (fontUpBtn) fontUpBtn.disabled = fontSizeLevel >= FONT_LEVEL_MAX;
    }
    function applyMode() {
        applyFont();
        syncFontButtons();
        workspace.className = `le-workspace le-mode-${mode}${showPreview ? ' le-show-preview' : ''}`;
        host.dataset.mode = mode;
        syncEmpty();
        if (mode === 'chordpro') renderPreview();
        hooks.onMode?.(mode, { showPreview });
    }
    /**
     * @param {string} next  'lyrics' | 'chords' | 'chordpro'
     * @param {object} [o]   { persist (default true): remember it on this device; boxAt: a seam to start on }
     */
    function setMode(next, { persist = true, boxAt = null } = {}) {
        if (!MODES.includes(next)) return;
        if (persist) {
            preferred = next;
            try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* storage blocked */ }
        }
        if (next === mode) return;
        if (mode === 'chords') leaveChords();
        mode = next;
        editor.setMode(mode === 'chordpro' ? 'chordpro' : 'visual');
        editor.setEditable(mode !== 'chords');
        showPreview = false;
        applyMode();
        if (mode === 'chords') enterChords(boxAt);
        else view.focus();
    }
    function setShowPreview(on) {
        showPreview = !!on && mode === 'chordpro';
        applyMode();
    }
    function renderPreview() {
        const text = editor.getText();
        const key = menuKey(text);
        const { sections } = parseChordPro(text);
        previewBody.innerHTML = renderSectionsHtml(sections, { key, nashville: false })
            || '<p class="le-preview-empty">Nothing to preview yet.</p>';
    }
    function schedulePreview() {
        if (mode !== 'chordpro') return;
        clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreview, 150);
    }
    function enterChords(boxAt) {
        resetGestures();
        // start where the caret was, else the first lyric line
        let seam = boxAt;
        // where the caret is, unless it is just parked at the end of the document
        const head = view.state.selection.main.head;
        if (seam == null && head < view.state.doc.length) seam = seamForPos(view, head);
        if (seam == null) seam = firstSeam(view);
        view.contentDOM.blur();
        dropChartSelection();
        document.addEventListener('keydown', onDocKey, true);
        if (seam == null) { menu.open({ layout: layoutNow() }); padForSheet(); return; }
        openBox(seam);
    }
    /**
     * The locked chart must hold no DOM selection. The Lyrics caret stays in the DOM after the switch (blur does not clear
     * it), and while it is inside the content CodeMirror re-collapses it on every redraw (`updateSelection`, not focused but
     * not editable either); the browser then scrolls to reveal it: a jump (to the top of the page) the moment the cursor
     * changes line in a glide. Measured on a phone viewport in Chromium; WebKit reveals a collapsed selection too.
     */
    function dropChartSelection() {
        const sel = view.root.getSelection ? view.root.getSelection() : window.getSelection();
        if (sel && sel.rangeCount && view.contentDOM.contains(sel.anchorNode)) sel.removeAllRanges();
    }
    function leaveChords() {
        resetGestures();
        closeBox();
        document.removeEventListener('keydown', onDocKey, true);
    }

    // ---- the chord box -----------------------------------------------------
    let ghost = null;              // { text, timer }
    let lastCommit = null;         // { pos, chord, at }

    let magnifier = false;
    try { magnifier = localStorage.getItem(MAGNIFIER_KEY) === '1'; } catch { /* storage blocked */ }
    const menu = createChordMenu({
        getMagnifier: () => magnifier,
        onMagnifier: (on) => {
            magnifier = on;
            try { localStorage.setItem(MAGNIFIER_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
            refreshMenu();
            const b = editor.getBox();
            if (b) scrollBoxIntoView(b.pos, b.newLine);
            syncRing();
        },
        getContext: () => {
            const text = editor.getText();
            const box = editor.getBox();
            const a = boxChord(text, box);
            return {
                key: menuKey(text),
                used: [...new Set(extractChords(text))],
                current: a?.chord || '',
                moving: moving && !!a,
            };
        },
        onPick: (chord, meta) => placeChord(meta?.decoration ? susChord(chord, meta.decoration) : chord),
        onRemove: () => removeChord(),
        onMove: () => toggleMove(),
        onClose: () => setMode('lyrics'),
        onMode: (m) => setMode(m),
        onUndo: () => { editor.undo(); },
        onRedo: () => { editor.redo(); },
        getHistory: () => editor.history(),
        onStep: (dir) => stepBox(dir),
        onGlide: (moves, phase) => onGlide(moves, phase),
        onAddChordLine: () => addChordLine(),
        getStrip: () => stripClone(),
        onKeyChange: (k) => {
            // the sheet's key DECLARES `{key: k}` (the owner has not decided whether it should transpose)
            const text = editor.getText();
            const next = withKey(text, k);
            editor.change({ changes: diffChange(text, next) }, { userEvent: 'input.key', scroll: false });
            hooks.onKey?.(k);
            refreshMenu();
        },
    });
    document.body.appendChild(menu.el);
    let menuResizeObserver = null;

    /** The cursor's line as the editor draws it (a `.cm-line`, or the pending chord line's widget). */
    function cursorLineEl() {
        const box = editor.getBox();
        if (!box) return null;
        if (box.newLine) return view.contentDOM.querySelector('.cl-newline .cl-line');   // a pending chord line is a widget, not a .cm-line
        let node;
        try { node = view.domAtPos(box.pos).node; } catch { return null; }
        return (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.cm-line') || null;
    }
    /** The current line, enlarged by `scale`, with the box drawn on it (a clone of the editor's own DOM). */
    function stripClone(scale = STRIP_SCALE) {
        const box = editor.getBox();
        const lineEl = cursorLineEl();
        if (!box || !lineEl) return null;
        const clone = lineEl.cloneNode(true);
        clone.removeAttribute('contenteditable');
        clone.querySelectorAll('[data-chord]').forEach((e) => e.removeAttribute('data-chord'));   // the strip is a picture, not a second set of chord buttons
        clone.dataset.key = `${view.state.doc.lineAt(Math.min(box.pos, view.state.doc.length)).from}${box.newLine ? 'n' : ''}`;
        clone.classList.add('chm-strip-cl');
        const cs = getComputedStyle(view.contentDOM);
        const px = parseFloat(cs.fontSize) || 16;
        clone.style.fontSize = `${(px * scale).toFixed(1)}px`;
        clone.style.fontFamily = cs.fontFamily;   // outside the editor the clone would fall back to the page's sans font
        return clone;
    }
    // the loupe: a bubble above a THUMB that glides over the chart (the finger covers the syllable it places a chord on)
    const loupe = createLoupe({
        getLine: () => { const c = stripClone(LOUPE_SCALE); c?.classList.add('le-loupe-cl'); return c; },
        getChartBox: () => { const l = cursorLineEl(); return l && boxedEl(l); },
        topLimit: () => topInset(),
    });

    /**
     * The page-top inset: the app's top band as LAID OUT (offsetHeight), never its transient rect.
     * The band is sticky and slides with a transform (chrome-hidden), and on iOS the visual viewport settles
     * after the keyboard goes away, so `getBoundingClientRect().bottom` measured at the moment of the mode
     * tap could be 0..48 and then stuck. offsetHeight ignores transforms and the viewport.
     */
    function topInset() {
        const t = document.querySelector('.app-topbar');
        return t ? t.offsetHeight : 0;
    }
    /**
     * Dock the panel for the current layout and publish its live geometry as CSS variables on <html>, in
     * the --bottomband-h pattern (shell.js): --chm-top (below the top band), --chm-strip-h (the magnifier),
     * --chm-picker-h (the picker). The chart is padded by the last two, so any line can scroll into the
     * gap between the parts. Idempotent: the ResizeObserver and every update call it.
     */
    function padForSheet() {
        const l = layoutNow();
        menu.setLayout(l);
        const docked = menu.isOpen && mode === 'chords';
        const split = docked && l === 'split';
        const side = docked && l === 'side';
        const parent = side && workspaceEl ? workspaceEl : document.body;
        const moved = menu.el.parentNode !== parent;
        if (moved) parent.appendChild(menu.el);
        workspaceEl?.classList.toggle('chm-has-side', side && !!workspaceEl);
        host.classList.toggle('chm-docked', split);
        if (moved) menu.refreshStrip();   // the strip's width changed with the layout: centre the cursor again
        const rs = document.documentElement.style;
        if (docked) {
            rs.setProperty('--chm-top', `${topInset()}px`);
            if (split) {
                const { strip, body } = menu.parts;
                // magnifier off: the bar is not in the DOM, so its height (and the chart's top padding) is 0
                rs.setProperty('--chm-strip-h', `${menu.magnifier ? Math.ceil(strip.getBoundingClientRect().height) : 0}px`);
                rs.setProperty('--chm-strip-gap', menu.magnifier ? '8px' : '0px');
                rs.setProperty('--chm-picker-h', `${Math.ceil(body.getBoundingClientRect().height)}px`);
            }
        }
        if (!split) { rs.removeProperty('--chm-strip-gap'); rs.removeProperty('--chm-strip-h'); rs.removeProperty('--chm-picker-h'); }
        if (!docked) rs.removeProperty('--chm-top');
    }
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => { if (menu.isOpen) padForSheet(); });
        ro.observe(menu.parts.strip);
        ro.observe(menu.parts.body);
        menuResizeObserver = ro;
    }
    sideMq.addEventListener?.('change', () => padForSheet());
    // keep --chm-top live: the band's own size, the visual viewport (iOS keyboard / address bar), the band's transitions
    const topbarEl = document.querySelector('.app-topbar');
    if (topbarEl) {
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (menu.isOpen) padForSheet(); }).observe(topbarEl);
        topbarEl.addEventListener('transitionend', () => { if (menu.isOpen) padForSheet(); });
    }
    window.visualViewport?.addEventListener('resize', () => { if (menu.isOpen) padForSheet(); });
    window.visualViewport?.addEventListener('scroll', () => { if (menu.isOpen) padForSheet(); });
    let gliding = false;           // a finger / mouse is driving the cursor: redraw only the strip until it lifts
    let glideAbsolute = false;     // ...on the chart itself, 1:1: the page must not scroll under the finger until it lifts
    function refreshMenu() {
        if (!menu.isOpen) return;
        if (gliding) { menu.refreshStrip(); return; }
        menu.update();
        padForSheet();
    }
    /** `scroll: false` when a finger is about to drive the cursor 1:1 (the text must stay put under it; the lift scrolls). */
    function openBox(at, { scroll = true } = {}) {
        const c = typeof at === 'number' ? { pos: at } : at;
        anchorX = null;
        setCursor(c);
        menu.open({ layout: layoutNow() });
        padForSheet();
        if (scroll) scrollBoxIntoView(c.pos, c.newLine);
        syncRing();
    }
    /** The part of the viewport the chart can be read in: below the top band (and the docked magnifier), above the docked picker. */
    function visibleGap() {
        let top = topInset() + DOCK_MARGIN;
        let bottom = window.innerHeight - DOCK_MARGIN;
        if (menu.isOpen && mode === 'chords' && menu.layout === 'split') {
            const { strip, body } = menu.parts;
            if (menu.magnifier) top = Math.max(top, strip.getBoundingClientRect().bottom + DOCK_MARGIN);
            bottom = Math.min(bottom, body.getBoundingClientRect().top - DOCK_MARGIN);
        }
        return { top, bottom };
    }
    /** Keep the cursor's line (its chord row too) inside the visible gap. */
    function scrollBoxIntoView(pos, below = false) {
        const c = view.coordsAtPos(pos);
        if (!c) return;
        const { top, bottom } = visibleGap();
        const px = parseFloat(getComputedStyle(view.contentDOM).fontSize) || 16;
        const lineTop = c.top - px * 1.8;                 // the chord row is drawn above the lyric
        const lineBottom = c.bottom + (below ? 44 : 0);   // a pending chord line is drawn below its line
        if (lineTop < top) window.scrollBy({ top: lineTop - top });
        else if (lineBottom > bottom) window.scrollBy({ top: Math.min(lineBottom - bottom, lineTop - top) });
    }
    function closeBox() {
        resetGestures();
        clearGhost();
        moving = false;
        menu.close();
        padForSheet();
        if (editor.getBox()) editor.setBox(null);
        syncRing();
    }

    // ---- the cursor: where it is, what is on it, how it moves ---------------
    const boxChord = (text, box) => (box && !box.after && !box.newLine ? chordAt(text, box.pos) : null);
    /** The box state for a cursor from chord-motion.js (a virtual cursor writes nothing). */
    function setCursor(c, extra = {}) {
        editor.setBox({ pos: c.pos, active: true, ...(c.after ? { after: 1 } : {}), ...(c.newLine ? { newLine: true } : {}), ...extra });
    }
    /** The box without its typed-entry ghost. */
    const plainBox = (box) => { const { ghost: _g, invalid: _i, ...rest } = box; return rest; };
    let anchorX = null;            // the x a run of line moves keeps
    const tick = () => { try { navigator.vibrate?.(TICK_MS); } catch { /* no haptics */ } };

    // a soft ring that follows the cursor, so a move reads as a glide and not as a jump
    const ring = document.createElement('div');
    ring.className = 'le-cursor-ring hidden';
    document.body.appendChild(ring);
    /** Put the ring on a viewport rect with `transform` (no layout of its own, no transition while dragging). */
    function setRing(r) {
        ring.style.transform = `translate(${Math.round(r.left - 4)}px, ${Math.round(r.top - 3)}px)`;
        ring.style.width = `${Math.max(6, r.right - r.left) + 8}px`;
        ring.style.height = `${r.bottom - r.top + 6}px`;
        ring.classList.remove('hidden');
    }
    function syncRing() {
        if (ring.classList.contains('dragging')) return;        // the glide overlay is drawing it
        const target = mode === 'chords' && editor.getBox()
            ? (view.contentDOM.querySelector('.cl-gap-bar') || view.contentDOM.querySelector('.cl-box-chord .cl-chord-glyph, .cl-slot-pill')) : null;
        if (!target) { ring.classList.add('hidden'); return; }
        const first = ring.classList.contains('hidden');
        ring.classList.toggle('settle', !first);
        setRing(target.getBoundingClientRect());
    }
    /** The in-flight cursor: drawn from the pointermove handler itself, on the hit. */
    const ringOverlay = {
        show(hit) { ring.classList.remove('settle'); ring.classList.add('dragging'); setRing(hit); },
        hide() { ring.classList.remove('dragging'); ring.classList.add('hidden'); },
    };
    const onScrollRing = () => { ring.classList.remove('settle'); syncRing(); };
    window.addEventListener('scroll', onScrollRing, { passive: true });

    const susMemory = createSusMemory();
    /** A decoration's chord; sus remembers the quality it replaced, so tapping it off gives that back. */
    function susChord(picked, id) {
        const box = editor.getBox();
        const a = box && boxChord(editor.getText(), box);
        if (!a) return picked;
        // keyed by line and lyric offset, not by document position: the edit itself moves the latter
        const line = editor.view.state.doc.lineAt(box.pos);
        const at = `${line.number}:${line.text.slice(0, box.pos - line.from).replace(/\[[^\]]*\]/g, '').length}`;
        return susMemory.pick(at, a.chord, id);
    }
    function placeChord(chord) {
        const box = editor.getBox();
        if (!box || !chord) return;
        clearGhost();
        const text = editor.getText();
        const placed = placeAtCursor(text, cursorOf(editor.getBox()), chord);
        editor.change({ changes: placed.change }, { userEvent: 'input.chord', scroll: false });
        if (placed.cursor) setCursor(placed.cursor);   // the next empty slot after the words
        refreshMenu();
        if (placed.cursor) scrollBoxIntoView(placed.cursor.pos);
        syncRing();
    }
    function removeChord() {
        const box = editor.getBox();
        if (!box) return;
        const r = removeAtCursor(editor.getText(), cursorOf(box));
        if (!r) return;
        moving = false;
        editor.change({ changes: r.change }, { userEvent: 'delete.chord', scroll: false });
        if (r.lineRemoved) {
            // the chord line is gone: stand at the end of the line it was under
            const next = cursorNear(editor.getText(), r.change.from);
            if (next) setCursor(next); else editor.setBox({ pos: 0, active: true });
        }
        refreshMenu();
        syncRing();
    }
    function toggleMove() {
        const box = editor.getBox();
        if (!box || !boxChord(editor.getText(), box)) return;
        moving = !moving;
        refreshMenu();
    }

    /** Add chord line: an empty chord row below the cursor's line, same section. Nothing is written until a chord is picked. */
    function addChordLine() {
        const box = editor.getBox();
        if (!box || box.newLine) return;
        const c = chordLineCursor(editor.getText(), box.pos);
        if (!c) return;
        clearGhost();
        moving = false;
        anchorX = null;
        setCursor(c);
        refreshMenu();
        scrollBoxIntoView(c.pos, true);
        syncRing();
    }

    // The arrows (and the keys) step stop by stop (syllable, gap, next word ... slots after the words) / line by line
    function stepBox(dir) {
        const move = { next: { kind: 'stop', dir: 1 }, prev: { kind: 'stop', dir: -1 }, up: { kind: 'line', dir: -1 }, down: { kind: 'line', dir: 1 } }[dir];
        if (move && stepCursor(move)) commitView();
    }
    /**
     * Apply ONE move from chord-motion.js. When Move is on, the chord on the cursor goes along (the cursor
     * hops over other chords, so it never lands on one). `drag` joins the steps into one undo step.
     */
    function stepCursor(move, { drag = false } = {}) {
        const box = editor.getBox();
        if (!box) return false;
        const text = editor.getText();
        const cur = cursorOf(box);
        const xAt = (pos, after) => { const c = view.coordsAtPos(pos, after ? -1 : 1); return c ? c.left : NaN; };
        if (move.kind === 'line') { if (anchorX == null) anchorX = xAt(box.pos, box.after); } else anchorX = null;
        const res = moveCursor(text, cur, move, {
            skip: moving ? (s) => !s.after && !!s.chord && s.pos !== cur.pos : null,
            xOf: (s) => xAt(s.pos, s.after),
            anchorX: Number.isFinite(anchorX) ? anchorX : undefined,
        });
        if (!res.moved) return false;
        clearGhost();
        let next = res.cursor;
        if (moving && !next.newLine) {
            const out = carryChord(text, cur, next);
            if (out && out.text !== text) {
                editor.change({ changes: diffChange(text, out.text) }, { userEvent: drag ? DRAG_EVENT : 'input.chord.move', scroll: false });
                next = out.cursor;
            }
        }
        setCursor(next);
        if (res.crossedSeam) tick();
        return true;
    }
    /** After a move (or a batch of them): redraw what depends on the cursor. */
    function commitView({ light = false } = {}) {
        const box = editor.getBox();
        if (menu.isOpen) {
            if (light) menu.refreshStrip(); else { menu.update(); padForSheet(); }
        }
        // never while a finger drives the cursor 1:1 on the chart: the text would slide under a still finger, the cursor
        // would follow it and scroll again (a runaway scroll). The lift scrolls once (finishGlide -> commitView()).
        if (box && !(light && glideAbsolute)) scrollBoxIntoView(box.pos, box.newLine);
        syncRing();
        if (loupe.visible) loupe.refresh();              // the bubble must show what the chart shows
    }

    // ---- gliding: one virtual point for a long-press on the chart, the held sheet and the strip
    // The point moves in screen space and is hit-tested like a tap (glide-driver.js). The overlay is drawn
    // in the pointermove handler; CodeMirror hears about it at most once per animation frame.
    const driver = createGlideDriver({
        // the ring follows the letter under the point (smooth); the committed hit is always a stop, sticky around the cursor's own
        pick: (x, y, last) => cursorAtPoint(view, x, y, { nearest: true, ring: true, prev: last ? { pos: last.pos, after: last.after } : cursorOf(editor.getBox()) }),
        overlay: ringOverlay,
        bounds: () => {
            const r = view.contentDOM.getBoundingClientRect();
            if (!glideAbsolute) return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            // the 1:1 glide stays on the chart you can SEE: a finger over the picker means the last visible line
            const g = visibleGap();
            return { left: r.left, right: r.right, top: Math.max(r.top, g.top), bottom: Math.min(r.bottom, g.bottom) };
        },
        onCommit: (hit) => applyHit(hit),
    });
    /** Move the cursor to a hit. While Move / a carried chord is on, the chord goes along but never lands on another chord. */
    function applyHit(hit) {
        const box = editor.getBox();
        if (!box) return;
        const text = editor.getText();
        const cur = cursorOf(box);
        const target = hit.after ? { pos: hit.pos, after: 1 } : { pos: hit.pos };
        if (sameCursor(cur, target)) return;
        let next = target;
        if (moving) {
            if (!target.after && chordAt(text, target.pos) && target.pos !== cur.pos) return;   // hop over other chords
            const out = carryChord(text, cur, target);
            if (out && out.text !== text) {
                editor.change({ changes: diffChange(text, out.text) }, { userEvent: DRAG_EVENT, scroll: false });
                next = out.cursor;
            }
        }
        clearGhost();
        setCursor(next);
        tick();                                          // every change of stop
        commitView({ light: true });
    }
    /** The cursor's drawn position (viewport px): the glide starts here. */
    function cursorPoint() {
        const box = editor.getBox();
        if (!box) return null;
        if (box.newLine) {
            const r = view.contentDOM.querySelector('.cl-newline')?.getBoundingClientRect();
            return r ? { x: r.left + 8, y: (r.top + r.bottom) / 2 } : null;
        }
        const n = view.state.doc.length;
        const c = box.after ? view.coordsAtPos(box.pos, -1) : view.coordsAtPos(box.pos, 1);
        const row = box.after || box.pos >= n ? c : (view.coordsAtPos(box.pos + 1, -1) || c);
        if (!c || !row) return null;
        const sameRow = Math.abs(row.top - c.top) < 1;
        const r = sameRow ? c : row;
        const y = (r.top + r.bottom) / 2;
        // the MIDDLE of the cursor's stop: a stop is picked by containing the point (like a tap), so a trackpad started on
        // its left edge would step left at once and right only after a whole stop
        const hit = cursorAtPoint(view, c.left + (box.after ? 2 : 1), y);
        const inStop = hit && hit.pos === box.pos && !!hit.after === !!box.after;
        return { x: inStop ? (hit.left + hit.right) / 2 : c.left + (box.after ? 2 : 1), y };
    }
    /** `absolute`: the chart glide, the point IS the finger (needs no cursor position). Else a trackpad from the cursor. */
    function beginGlide(absolute = false) {
        const p = absolute ? null : cursorPoint();
        if (!absolute && !p) return false;
        anchorX = null;
        gliding = true;
        glideAbsolute = absolute;
        if (absolute) dropChartSelection();              // nothing may scroll the page under the finger
        if (absolute) driver.begin(undefined, undefined, cursorOf(editor.getBox()));
        else driver.begin(p.x, p.y);
        ring.classList.add('dragging');
        return true;
    }
    function finishGlide(t) {
        const was = gliding;
        loupe.hide();
        driver.end(t);                                   // commits what was shown (SETTLE_MS before a lift)
        gliding = false;
        glideAbsolute = false;
        anchorX = null;
        ring.classList.remove('dragging');
        ring.classList.add('settle');
        if (was) commitView();
    }
    function onGlide(d, phase) {
        if (phase === 'start') { beginGlide(); return; }
        if (phase === 'end') { finishGlide(); return; }
        if (driver.active) driver.move(d.dx, d.dy, d.dt);
    }

    // Long-press ANYWHERE on the chart (Chords mode) starts the glide: ~HOLD_MS without moving more than
    // HOLD_SLOP_PX. On empty chart the cursor first jumps to the finger (the tap's hit-test); on a chord it
    // CARRIES that chord. Moving first is a scroll (touch) or nothing (mouse). A press ON the cursor
    // (or, with a mouse, on a chord) drags after GRAB_SLOP_PX with no hold. A short press is the old tap.
    // `press` is the ONE gesture state; resetGestures() clears it, the hold timer, the glide, the ring and
    // the sheet's trackpad: called on up / cancel / lost capture / a new press / mode switches / blur.
    let press = null;
    function resetGestures() {
        if (press) clearTimeout(press.timer);
        const wasGliding = gliding;
        press = null;
        suppressClickUntil = 0;
        if (driver.active) driver.cancel();
        loupe.hide();
        gliding = false;
        glideAbsolute = false;
        if (wasGliding) moving = false;
        ring.classList.remove('dragging');
        menu.cancelGesture?.();
        syncRing();
    }
    function startPressGlide(p) {
        if (press !== p || p.started || mode !== 'chords') return;
        p.started = true;
        clearTimeout(p.timer);
        if (p.chordEl) {
            const seam = seamOfChordEl(view, p.chordEl);
            moving = false;
            if (seam != null) openBox(seam, { scroll: false });
            moving = !!boxChord(editor.getText(), editor.getBox());     // a chord is carried
        } else if (!p.onBox) {
            const hit = cursorAtPoint(view, p.x0, p.y0);                // jump to the finger, like a tap
            moving = false;
            if (hit) openBox(hit.after ? { pos: hit.pos, after: 1 } : { pos: hit.pos }, { scroll: false });
        }
        try { view.dom.setPointerCapture(p.id); } catch { /* the pointer is gone */ }   // a rebuilt widget under the finger cannot drop it
        try { if (p.type !== 'mouse') navigator.vibrate?.(8); } catch { /* no haptics */ }
        if (!beginGlide(true)) { press = null; return; }
        p.x = p.x0; p.y = p.y0;
        if (menu.isOpen) menu.update();
        if (p.type !== 'mouse') loupe.show(p.x0, p.y0);                 // a mouse pointer does not occlude
    }
    view.dom.addEventListener('pointerdown', (e) => {
        if (mode !== 'chords' || e.button > 0) return;
        if (press || gliding) resetGestures();                          // a stale gesture must never swallow a new press
        if (e.target.closest?.('.cl-newline')) return;
        const glyph = e.target.closest?.('.cl-chord-glyph');
        const chordEl = glyph && !glyph.closest('.cl-chord-gap') ? glyph.closest('.cl-chord') : null;
        const onBox = !!e.target.closest?.('.cl-slot-pill, .cl-box-text, .cl-box-chord');
        try { e.target.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
        const p = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: e.timeStamp, started: false, chordEl, onBox, timer: null };
        p.immediate = onBox || (!!chordEl && e.pointerType === 'mouse');
        p.timer = setTimeout(() => startPressGlide(p), HOLD_MS);
        press = p;
    });
    // the finger is "ours" once the hold fires: the page must not scroll under it. The listener sits on the
    // touch's own target (a touch keeps its first target even when CodeMirror rebuilds the widget under it)
    view.dom.addEventListener('touchstart', (e) => {
        if (mode !== 'chords') return;
        const target = e.target;
        const block = (ev) => { if (press?.started) ev.preventDefault(); };
        const off = () => { target.removeEventListener('touchmove', block); target.removeEventListener('touchend', off); target.removeEventListener('touchcancel', off); };
        target.addEventListener('touchmove', block, { passive: false });
        target.addEventListener('touchend', off);
        target.addEventListener('touchcancel', off);
    }, { passive: true, capture: true });
    view.dom.addEventListener('contextmenu', (e) => { if (mode === 'chords' && press) e.preventDefault(); });
    const onPressMove = (e) => {
        const p = press;
        if (!p || e.pointerId !== p.id) return;
        if (e.pointerType === 'mouse' && e.buttons === 0) { endPress(e); return; }   // released outside the window
        if (!p.started) {
            const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
            if (p.immediate && dist > GRAB_SLOP_PX) startPressGlide(p);
            else if (dist > HOLD_SLOP_PX) { clearTimeout(p.timer); press = null; return; }   // a scroll, not a hold
            if (!p.started) return;
        }
        driver.moveTo(e.clientX, e.clientY, e.timeStamp);      // 1:1 with the finger
        if (loupe.visible) loupe.move(e.clientX, e.clientY);
        p.x = e.clientX; p.y = e.clientY; p.t = e.timeStamp;
    };
    function endPress(e) {
        const p = press;
        if (!p || e.pointerId !== p.id) return;
        clearTimeout(p.timer);
        press = null;
        if (!p.started) return;
        moving = false;                                  // let go of the carried chord
        suppressClickUntil = Date.now() + 400;           // the click that follows a drag is not a tap
        finishGlide(p.type === 'mouse' ? undefined : e.timeStamp);   // only a thumb slides as it lifts
    }
    const onLostCapture = (e) => { if (!e.buttons) endPress(e); };
    window.addEventListener('pointermove', onPressMove);
    window.addEventListener('pointerup', endPress);
    window.addEventListener('pointercancel', endPress);
    window.addEventListener('lostpointercapture', onLostCapture, true);
    window.addEventListener('blur', resetGestures);
    const onVisibility = () => { if (document.hidden) resetGestures(); };
    document.addEventListener('visibilitychange', onVisibility);

    // ---- typed chord entry (ghost chip) ------------------------------------
    function showGhost() {
        const box = editor.getBox();
        if (!box) return;
        editor.setBox({ ...box, ghost: ghost?.text || '', invalid: !!ghost && !isValidChord(ghost.text) });
    }
    function clearGhost() {
        if (!ghost) return;
        clearTimeout(ghost.timer);
        ghost = null;
        const box = editor.getBox();
        if (box) editor.setBox(plainBox(box));
    }
    function commitGhost() {
        if (!ghost) return false;
        const text = ghost.text;
        clearTimeout(ghost.timer);
        const valid = isValidChord(text);
        const box = editor.getBox();
        ghost = null;
        if (box) editor.setBox(plainBox(box));
        if (valid) {
            placeChord(text);
            lastCommit = { pos: editor.getBox()?.pos, chord: text, at: Date.now() };
            return true;
        }
        return false;
    }
    function ghostBackspace() {
        ghost.text = ghost.text.slice(0, -1);
        if (!ghost.text) clearGhost(); else { armGhost(); showGhost(); }
    }
    function armGhost() {
        clearTimeout(ghost.timer);
        ghost.timer = setTimeout(() => { if (ghost && isValidChord(ghost.text)) commitGhost(); }, IDLE_COMMIT_MS);
    }
    function typeIntoGhost(ch) {
        const box = editor.getBox();
        if (!ghost) {
            // 'E' then 'b7' within the grace window continues E: Eb7, not a new B7
            const resumable = lastCommit && !box.after && !box.newLine && lastCommit.pos === box.pos
                && Date.now() - lastCommit.at < RESUME_GRACE_MS && !/^[A-G]$/.test(ch);
            if (resumable) {
                ghost = { text: lastCommit.chord + ch, timer: null };
            } else {
                ghost = { text: ch.toUpperCase(), timer: null };
            }
            lastCommit = null;
        } else {
            ghost.text += ch;
        }
        armGhost();
        showGhost();
    }

    function isTypingTarget(t) {
        return !!t?.closest?.('input, select, textarea, [contenteditable="true"]');
    }
    /** Chords mode on a desktop keyboard: the chart is not focusable, so the keys live on the document. */
    function onDocKey(e) {
        if (mode !== 'chords' || !host.getClientRects().length) return;
        if (isTypingTarget(e.target) || e.target?.closest?.('.le-labelmenu, .le-selbar')) return;
        handleKey(e);
    }
    function handleKey(e) {
        const box = editor.getBox();
        if (mode !== 'chords' || !box?.active) return false;
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        const k = e.key;
        if (k === 'Escape') {
            e.preventDefault();
            if (ghost) clearGhost(); else closeBox();
            return true;
        }
        if (k === 'Enter') { e.preventDefault(); if (!commitGhost()) closeBox(); return true; }
        if (k === 'Backspace' || k === 'Delete') {
            e.preventDefault();
            if (ghost) ghostBackspace(); else removeChord();
            return true;
        }
        if (k === ' ' || k === 'Tab') {
            e.preventDefault();
            commitGhost();
            stepBox(e.shiftKey ? 'prev' : 'next');
            return true;
        }
        if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowUp' || k === 'ArrowDown') {
            e.preventDefault();
            commitGhost();
            stepBox({ ArrowRight: 'next', ArrowLeft: 'prev', ArrowUp: 'up', ArrowDown: 'down' }[k]);
            return true;
        }
        if (k.length === 1 && /[A-Ga-g]/.test(k) && !ghost) { e.preventDefault(); typeIntoGhost(k); return true; }
        if (k.length === 1 && ghost && /[A-Za-z0-9#\/+°]/.test(k)) { e.preventDefault(); typeIntoGhost(k); return true; }
        if (k.length === 1 && lastCommit && /[a-z0-9#\/+]/.test(k)) { e.preventDefault(); typeIntoGhost(k); return true; }
        return false;
    }

    // ---- pointer -----------------------------------------------------------
    /** Chords mode: no focus, no text selection. Lyrics mode: the browser's own (a double-click selects a word; only the mode switch enters Chords). */
    function handleMouseDown(e, v) {
        if (mode === 'chords') { e.preventDefault(); return true; }
        return false;
    }
    /** Chords mode: a tap/click puts the box on what it means (a chord it hit, a seam, or the slot after the words). */
    function handleClick(e, v) {
        if (mode !== 'chords') return false;
        if (Date.now() < suppressClickUntil) return true;
        if (e.target.closest?.('.cl-newline')) return true;   // the pending chord line is already the cursor
        const glyph = e.target.closest?.('.cl-chord-glyph');
        let at = null;
        if (glyph) {
            const chordEl = glyph.closest('.cl-chord');
            if (chordEl && !chordEl.classList.contains('cl-chord-gap')) {
                const seam = seamOfChordEl(v, chordEl);
                if (seam != null) at = { pos: seam };
            }
        }
        if (!at) {
            const hit = cursorAtPoint(v, e.clientX, e.clientY);
            if (hit) at = hit.after ? { pos: hit.pos, after: 1 } : { pos: hit.pos };
        }
        if (!at) return true;
        // a tap elsewhere drops a chord being moved (where it already is)
        moving = false;
        if (menu.isOpen) { menu.update(); }
        openBox(at);
        return true;
    }

    // ---- copy / cut / paste -------------------------------------------------
    /**
     * Lyrics mode hides the section markers, so a selection of whole sections
     * never holds them: put them on the clipboard (section-ops.js
     * sectionsForClipboard), or a copied chorus pastes back as a verse. Lines
     * from inside one section stay the browser's own copy.
     */
    function handleCopy(e, cut) {
        if (mode !== 'lyrics' || !e.clipboardData) return false;
        const s = view.state.selection;
        if (s.ranges.length > 1 || s.main.empty) return false;
        const clip = sectionsForClipboard(editor.getText(), s.main.from, s.main.to);
        if (!clip) return false;
        e.preventDefault();
        e.clipboardData.setData('text/plain', clip.text);
        // A user deletion, not a programmatic one, so the protect rules see it:
        // a section wholly inside the range goes label and all, and the blank
        // lines it leaves are tidied (doc-model.js clipDeletion).
        if (cut) view.dispatch({ changes: { from: clip.from, to: clip.to }, userEvent: 'delete.cut', scrollIntoView: true });
        return true;
    }
    function handlePaste(e) {
        const raw = e.clipboardData?.getData('text/plain');
        if (!raw) return false;
        if (!hooks.autoDetect?.()) {
            // Auto-detect off: the text goes in as it is, but sections still
            // land between sections in Lyrics mode, never nested in one.
            if (mode !== 'lyrics' || !holdsSections(raw)) return false;
            e.preventDefault();
            insertConverted({ kind: 'chordpro', text: raw, raw: true });
            return true;
        }
        const res = convertPastedText(raw);
        if (res.kind !== 'chordpro') return false;
        e.preventDefault();
        insertConverted(res);
        return true;
    }
    function insertConverted(res) {
        let sel0 = view.state.selection.main;
        // In Lyrics mode pasted sections land between sections (section-ops.js
        // placeSectionPaste). ChordPro mode shows the markers: a paste goes
        // exactly where the caret is, as typed.
        const sectioned = mode === 'lyrics' && holdsSections(res.text);
        if (sectioned && !sel0.empty) {
            // pasted over a selection: the selection goes first, as a user
            // deletion so the protect rules apply, then the sections land
            view.dispatch({ changes: { from: sel0.from, to: sel0.to }, userEvent: 'delete' });
            sel0 = view.state.selection.main;
        }
        const placed = sectioned && placeSectionPaste(editor.getText(), sel0.from, res.text);
        if (placed) {
            editor.change({
                changes: placed,
                selection: { anchor: placed.from + placed.insert.replace(/\n+$/, '').length },
            }, { userEvent: 'input.paste' });
        } else {
            const empty = view.state.doc.length === 0;
            const head = sel0.from;
            const body = empty ? res.text.replace(/\n+$/, '\n') : res.text;
            editor.change({
                changes: { from: sel0.from, to: sel0.to, insert: body },
                selection: { anchor: head + body.length },
            }, { userEvent: 'input.paste' });
        }
        if (!res.raw) hooks.onPaste?.(res);
    }
    /** The empty-sheet Paste button. Pages may only read the clipboard over HTTPS (or on localhost). */
    async function pasteFromClipboard() {
        if (!canReadClipboard()) { view.focus(); showPasteHint(); return; }
        try {
            const raw = await navigator.clipboard.readText();
            if (!raw) return;
            const res = hooks.autoDetect?.() === false ? { kind: 'plain' } : convertPastedText(raw);
            if (res.kind === 'chordpro') insertConverted(res);
            else {
                const s = view.state.selection.main;
                editor.change({ changes: { from: s.from, to: s.to, insert: raw }, selection: { anchor: s.from + raw.length } }, { userEvent: 'input.paste' });
            }
            view.focus();
        } catch { view.focus(); showPasteHint(); }   // permission refused: the keyboard's own Paste still works
    }

    /**
     * What the user can actually see, in viewport px: below the top band, above the bottom band, the keyboard
     * (the visual viewport) and, in Chords on a phone, above the docked picker. Toasts and the label menu fit in it.
     */
    function visibleArea() {
        const vv = window.visualViewport;
        const band = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottomband-h')) || 0;
        let top = Math.max(topInset(), vv ? vv.offsetTop : 0) + DOCK_MARGIN;
        let bottom = Math.min(vv ? vv.offsetTop + vv.height : window.innerHeight, window.innerHeight - band) - DOCK_MARGIN;
        if (menu.isOpen && mode === 'chords' && menu.layout === 'split') {
            if (menu.magnifier) top = Math.max(top, menu.parts.strip.getBoundingClientRect().bottom + DOCK_MARGIN);
            bottom = Math.min(bottom, menu.parts.body.getBoundingClientRect().top - DOCK_MARGIN);
        }
        return { top, bottom };
    }

    // ---- undo toast --------------------------------------------------------
    let toastEl = null;
    function undoToast(message) {
        toastEl?.remove();
        toastEl = document.createElement('div');
        toastEl.className = 'auth-toast le-toast visible';
        toastEl.setAttribute('role', 'status');
        const span = document.createElement('span');
        span.textContent = `${message} — `;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'le-toast-undo';
        btn.textContent = 'Undo';
        btn.addEventListener('click', () => { editor.undo(); toastEl?.remove(); toastEl = null; view.focus(); });
        toastEl.append(span, btn);
        // stand clear of the docked chord picker (phones): over it, the toast hid the chords you tap next
        toastEl.style.bottom = `${Math.round(window.innerHeight - visibleArea().bottom + 8)}px`;
        document.body.appendChild(toastEl);
        const mine = toastEl;
        setTimeout(() => { mine.remove(); if (toastEl === mine) toastEl = null; }, 5000);
    }

    // ---- sections: selection bar + label menu -------------------------------
    sel = document.createElement('div');
    sel.className = 'le-selbar hidden';
    sel.setAttribute('role', 'toolbar');
    sel.setAttribute('aria-label', 'Make a section');
    for (const type of SECTION_TYPES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.wrap = type;
        b.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        sel.appendChild(b);
    }
    const other = document.createElement('button');
    other.type = 'button';
    other.dataset.wrap = '*';
    other.textContent = 'Other…';
    sel.appendChild(other);
    // a NOTE, not a section: the selected lines become `{comment: ...}` rows, drawn in italics where they stand
    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.dataset.wrap = 'note';
    noteBtn.className = 'le-selbar-note';
    noteBtn.textContent = 'Note';
    noteBtn.title = 'Make the selected lines a note (like "Interlude" or "slow down here")';
    sel.appendChild(noteBtn);
    // keep focus (and the selection) in the editor through a press
    // (not the name field: a tap in it must place the caret, which is what raises the iOS keyboard)
    sel.addEventListener('pointerdown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    sel.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    sel.addEventListener('click', (e) => {
        const b = e.target.closest('[data-wrap]');
        if (!b) return;
        let type = b.dataset.wrap;
        if (type === '*') {
            askType().then((t) => t && wrapSelection(t));
            return;
        }
        if (type === 'note') { makeNote(); return; }
        wrapSelection(type);
    });
    document.body.appendChild(sel);

    /**
     * The "Other…" name field. Resolves with the section type, or null when cancelled. Settles exactly once.
     * Enter, the Add button and a blur with text typed all COMMIT (the keyboard's Go, dismissing the keyboard,
     * and the scroll iOS does when it opens must not silently discard the name); Escape or an empty field cancels.
     */
    function askType() {
        return new Promise((resolve) => {
            sel.classList.add('le-selbar-input');
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Section name (e.g. Solo)';
            input.className = 'le-selbar-field';
            input.enterKeyHint = 'done';
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'le-selbar-add';
            add.textContent = 'Add';
            let finished = false;
            const finish = (commit) => {
                if (finished) return;
                finished = true;
                const v = commit ? (input.value.match(/[a-z]+/i) || [''])[0].toLowerCase() : '';   // read BEFORE removing
                input.removeEventListener('blur', onBlur);                                           // removing a focused input blurs it, synchronously
                input.remove();
                add.remove();
                sel.classList.remove('le-selbar-input');
                resolve(v || null);
            };
            const onBlur = () => setTimeout(() => finish(true), 0);   // lets a tap on Add land first; an empty field cancels
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
                if (ev.key === 'Escape') finish(false);
            });
            input.addEventListener('blur', onBlur);
            add.addEventListener('click', () => finish(true));
            sel.append(input, add);
            input.focus();
        });
    }
    function makeNote() {
        const s = view.state.selection.main;
        const text = editor.getText();
        const res = noteSelection(text, s.from, s.to);
        if (!res) { showToast('Select a line with words on it first.', { variant: 'warning' }); return; }
        editor.change({ changes: diffChange(text, res.text), selection: { anchor: Math.min(res.selStart, res.text.length) } }, { userEvent: 'input.section' });
        if (!presenting) view.focus();
    }
    function wrapSelection(type) {
        const s = view.state.selection.main;
        const text = editor.getText();
        const res = markSelection(text, s.from, s.to, type);
        if (!res) { showToast('Select some lyric lines first.', { variant: 'warning' }); return; }
        editor.change({ changes: diffChange(text, res.text), selection: { anchor: res.selStart } }, { userEvent: 'input.section' });
        if (!presenting) view.focus();
    }
    /**
     * Phones (a coarse pointer) DOCK the bar at the bottom of the visual viewport, above the keyboard: iOS draws its own
     * selection menu (Cut / Copy / Paste) exactly where a floating bar sat, above the selection start, and the system UI
     * always wins (triage 2026-10-27: shown, but covered). Desktop keeps the floating bar beside the selection.
     */
    const dockedBar = () => !!window.matchMedia?.('(pointer: coarse)').matches;
    function placeDockedBar() {
        const vv = window.visualViewport;
        const below = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;   // the keyboard (and its bar)
        sel.style.left = '';
        sel.style.top = '';
        sel.style.setProperty('--le-selbar-bottom', `${Math.round(below + 8)}px`);
    }
    const onViewportForBar = () => { if (!sel.classList.contains('hidden') && sel.classList.contains('le-selbar-docked')) placeDockedBar(); };
    window.visualViewport?.addEventListener('resize', onViewportForBar);
    window.visualViewport?.addEventListener('scroll', onViewportForBar);
    function updateSelectionBar() {
        const s = view.state.selection.main;
        const show = !s.empty && mode !== 'chords' && (view.hasFocus || presenting) && !sel.classList.contains('le-selbar-input');
        if (!show && !sel.classList.contains('le-selbar-input')) { sel.classList.add('hidden'); return; }
        if (!show) return;
        sel.classList.remove('hidden');
        const docked = dockedBar();
        sel.classList.toggle('le-selbar-docked', docked);
        if (docked) { placeDockedBar(); return; }
        const c = view.coordsAtPos(s.from);
        if (!c) return;
        const w = sel.offsetWidth || 320;
        const left = Math.max(8, Math.min(c.left, window.innerWidth - w - 8));
        const above = c.top - 46;
        sel.style.left = `${left}px`;
        sel.style.top = `${above > 60 ? above : c.bottom + 8}px`;
    }
    view.dom.addEventListener('focusout', () => setTimeout(() => {
        if (!sel.matches(':focus-within') && !sel.classList.contains('le-selbar-input')) sel.classList.add('hidden');
    }, 0));
    window.addEventListener('scroll', () => { if (!sel.classList.contains('hidden')) updateSelectionBar(); }, { passive: true });
    window.addEventListener('resize', () => { if (menu.isOpen) padForSheet(); });

    function closeLabelMenu() { labelMenu?.remove(); labelMenu = null; }
    function applyText(next) {
        if (next == null) return;
        const text = editor.getText();
        if (next === text) return;
        editor.change({ changes: diffChange(text, next) }, { userEvent: 'input.section' });
    }
    /**
     * Put the label menu where all of it can be seen: below the label, else above it. On a phone neither side fit (the
     * menu is ~350px; it ran under the bottom band and off the screen), so when the menu does not fit below, the page
     * scrolls the label up to the top of the visible area first; a menu still too tall scrolls inside itself.
     * The scroll happens before the menu listens for pointerdown: a finger scroll would close it.
     */
    function placeLabelMenu(menuEl, anchorEl) {
        const GAP = 6;
        const w = menuEl.offsetWidth;
        const h = menuEl.offsetHeight;
        let { top, bottom } = visibleArea();
        let r = anchorEl.getBoundingClientRect();
        if (r.bottom + GAP + h > bottom || r.top < top) {
            window.scrollBy({ top: r.top - top, behavior: 'instant' });
            ({ top, bottom } = visibleArea());   // the top band may hide on the scroll
            r = anchorEl.getBoundingClientRect();
        }
        const below = bottom - (r.bottom + GAP);
        const above = r.top - GAP - top;
        const room = Math.max(below >= h || below >= above ? below : above, 120);
        menuEl.style.maxHeight = `${Math.round(room)}px`;
        const shown = Math.min(h, room);
        menuEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
        menuEl.style.top = `${Math.round(below >= h || below >= above ? r.bottom + GAP : r.top - GAP - shown)}px`;
    }
    /**
     * The menu of a `{comment}` row (a note: "Interlude" from a pasted chord sheet, or one made with the section bar's
     * Note): Edit its words, or Delete. Before 2026-10-28 such a row could
     * not be removed outside ChordPro mode (it is protected like a tab, and had no menu). The row's line is read from the
     * DOM at the tap (`posAtDOM`): the widget is reused when text above it moves, so its own positions go stale.
     */
    function openCommentMenu(anchorEl) {
        closeLabelMenu();
        if (mode !== 'lyrics') return;
        const line = view.state.doc.lineAt(view.posAtDOM(anchorEl));
        const note = anchorEl.textContent;
        const menuEl = document.createElement('div');
        menuEl.className = 'le-labelmenu le-commentmenu';
        menuEl.setAttribute('role', 'menu');
        // Edit: the note's words, in place (like a section label's Rename)
        const edit = document.createElement('form');
        edit.className = 'le-labelmenu-rename';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = note;
        input.setAttribute('aria-label', 'Note');
        const ok = document.createElement('button');
        ok.type = 'submit';
        ok.textContent = 'Save';
        edit.append(input, ok);
        edit.addEventListener('submit', (e) => {
            e.preventDefault();
            closeLabelMenu();
            const text = editor.getText();
            const next = setNoteText(text, line.from, line.to, input.value);
            if (next != null) editor.change({ changes: diffChange(text, next) }, { userEvent: 'input.section' });
        });
        menuEl.appendChild(edit);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'danger';
        b.textContent = 'Delete note';
        b.setAttribute('role', 'menuitem');
        b.addEventListener('click', () => {
            closeLabelMenu();
            const text = editor.getText();
            const to = Math.min(text.length, line.to + 1);    // the row and its newline: clipDeletion frees the row, tidies the blanks
            editor.change({ changes: clipDeletion(text, line.from, to) }, { userEvent: 'input.section' });
            undoToast(`Deleted \u201c${note}\u201d`);
        });
        menuEl.appendChild(b);
        document.body.appendChild(menuEl);
        placeLabelMenu(menuEl, anchorEl);
        labelMenu = menuEl;
        setTimeout(() => {
            const off = (ev) => { if (!menuEl.contains(ev.target)) { closeLabelMenu(); document.removeEventListener('pointerdown', off, true); } };
            document.addEventListener('pointerdown', off, true);
        }, 0);
    }
    function openLabelMenu(section, anchorEl) {
        closeLabelMenu();
        if (mode !== 'lyrics') return;
        const menuEl = document.createElement('div');
        menuEl.className = 'le-labelmenu';
        menuEl.setAttribute('role', 'menu');
        const line = section.startLine;
        const btn = (label, fn, cls = '') => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = cls;
            b.textContent = label;
            b.setAttribute('role', 'menuitem');
            b.addEventListener('click', () => { closeLabelMenu(); fn(); });
            menuEl.appendChild(b);
            return b;
        };
        const types = document.createElement('div');
        types.className = 'le-labelmenu-types';
        for (const t of SECTION_TYPES) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = t.charAt(0).toUpperCase() + t.slice(1);
            if (t === section.type) b.className = 'on';
            b.addEventListener('click', () => { closeLabelMenu(); applyText(setSectionTypeText(editor.getText(), line, t)); });
            types.appendChild(b);
        }
        menuEl.appendChild(types);
        if (section.explicit) {
            const rename = document.createElement('form');
            rename.className = 'le-labelmenu-rename';
            const input = document.createElement('input');
            input.type = 'text';
            input.value = section.label;
            input.setAttribute('aria-label', 'Section name');
            const ok = document.createElement('button');
            ok.type = 'submit';
            ok.textContent = 'Rename';
            rename.append(input, ok);
            rename.addEventListener('submit', (e) => { e.preventDefault(); closeLabelMenu(); applyText(renameSection(editor.getText(), line, input.value)); });
            menuEl.appendChild(rename);
            btn('Duplicate', () => applyText(duplicateSectionText(editor.getText(), line)));
            btn('Move up', () => applyText(moveSectionText(editor.getText(), line, -1)));
            btn('Move down', () => applyText(moveSectionText(editor.getText(), line, 1)));
            btn('Remove label', () => applyText(unlabelSection(editor.getText(), line)));
        }
        btn('Delete section', () => { applyText(deleteSectionText(editor.getText(), line)); undoToast(`Deleted ${section.label}`); }, 'danger');
        document.body.appendChild(menuEl);
        placeLabelMenu(menuEl, anchorEl);
        labelMenu = menuEl;
        setTimeout(() => {
            const off = (ev) => { if (!menuEl.contains(ev.target)) { closeLabelMenu(); document.removeEventListener('pointerdown', off, true); } };
            document.addEventListener('pointerdown', off, true);
        }, 0);
    }

    applyMode();

    const api = {
        editor,
        get mode() { return mode; },
        setMode,
        setShowPreview,
        get showPreview() { return showPreview; },
        getText: () => editor.getText(),
        setText: (t, o) => {
            if (o?.reset) presenting = false;
            closeBox();
            editor.setText(t, o);
            // a song opened gets the remembered mode; a new empty song always opens in Lyrics
            if (o?.reset) setMode(t.trim() === '' ? 'lyrics' : preferred, { persist: false });
            syncEmpty();
            if (mode === 'chordpro') renderPreview();
        },
        undo: () => { editor.undo(); },
        redo: () => { editor.redo(); },
        setDisplay: (fn) => editor.setDisplay(fn),
        pasteFromClipboard,
        refreshPreview: renderPreview,
        /**
         * For the feature tour's demo (../tour-editor-demo.js), which presses the real buttons (section bar, mode
         * switch, chord cells) and needs only the two things a pointer does that code cannot.
         */
        present: {
            /** Select [from, to) and show the section bar, as a drag over the lines would, without focusing the editor. */
            select(from, to) {
                presenting = true;
                view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
                updateSelectionBar();
            },
            /** Chords mode: put the chord box on `pos`, as a tap on that syllable would. */
            boxAt(pos) { if (mode === 'chords') openBox(pos); },
            end() { presenting = false; updateSelectionBar(); },
        },
        focus: () => view.focus(),
        destroy() { fontDownBtn?.removeEventListener('click', onFontDown); fontUpBtn?.removeEventListener('click', onFontUp); document.removeEventListener('keydown', onDocKey, true); resetGestures(); window.removeEventListener('pointermove', onPressMove); window.removeEventListener('pointerup', endPress); window.removeEventListener('pointercancel', endPress); window.removeEventListener('lostpointercapture', onLostCapture, true); window.removeEventListener('blur', resetGestures); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('scroll', onScrollRing); window.visualViewport?.removeEventListener('resize', onViewportForBar); window.visualViewport?.removeEventListener('scroll', onViewportForBar); ring.remove(); loupe.destroy(); menu.destroy(); menuResizeObserver?.disconnect(); sel.remove(); emptyHint.remove(); closeLabelMenu(); editor.destroy(); },
    };
    host.__lead = api;   // test hook (e2e reads the CodeMirror view through it)
    return api;
}
