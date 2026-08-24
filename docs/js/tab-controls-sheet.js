// Phone layout for the tablature bottom band.
//
// The band holds ~14 control groups (1468px of them). On a phone only the
// performance controls stay on the band — Play, Stop, tempo, loop — and
// everything else moves into a settings sheet behind a ⚙ button.
//
// The controls are MOVED, not rebuilt: every listener is attached once in
// work-view.js against nodes it found under `.tab-controls`, and appendChild
// preserves both the listeners and that ancestry (the sheet lives inside
// `.tab-controls`), so `controls.querySelector('.tab-key-down')` keeps
// working from either side of the breakpoint.

// The one number. It is a BAND width, not a device width: the band is what
// runs out of room, and it can run out on a desktop too (a narrow window, a
// split view, or a test that constrains the container). CSS keys the same
// number off `@container tabband (max-width: 640px)` — see style.css — with
// the viewport media query kept as the fallback for browsers without
// container queries.
export const NARROW_WIDTH = 640;

const PHONE_MQ = `(max-width: ${NARROW_WIDTH}px)`;

// Sheet rows in display order. A row that captures nothing is dropped, so
// works without a reading list / mixer / feel toggle get a shorter sheet.
const SHEET_ROWS = [
    { label: 'Size', selectors: ['.tab-size-group'] },
    { label: 'Key', selectors: ['.qc-key-group', '.tab-capo-indicator'] },
    { label: 'Layout', selectors: ['.tab-repeat-group'] },
    { label: 'Feel', selectors: ['.tab-feel-group'] },
    { label: 'Practice', selectors: ['.tab-metronome-toggle', '.tab-countin-toggle'] },
    { label: 'Tracks', selectors: ['.tab-track-mixer'] },
    { label: 'Tab', selectors: ['.tab-edit-btn'] },
];

let sheetSeq = 0;
let activeSheet = null; // one tab band exists at a time; re-render replaces it

/**
 * Wire the phone settings sheet onto a freshly built `.tab-controls`.
 * No-op visually on desktop: the More button and sheet are only inserted
 * while the media query matches, so the wide DOM is byte-identical to
 * what createTablatureControls returned.
 *
 * The width it decides on is the BAND's own, not the viewport's: an
 * observed `.tab-controls` narrower than {@link NARROW_WIDTH} collapses,
 * whatever the window is doing. That is what lets a test (or a split view,
 * or a narrow desktop window) reach the phone layout by constraining the
 * container, and it is the same question the CSS asks via
 * `@container tabband`. The media query stays as the seed and the fallback:
 * `attachTabControlsSheet` runs while the band is still DETACHED (work-view
 * builds the controls, wires them, then mounts), so there is no width to
 * measure yet on the first pass.
 *
 * @param {HTMLElement} controls  the `.tab-controls` element
 * @param {MediaQueryList} [media]  injectable for tests; supplying it also
 *   turns the container observer OFF, so a test drives one thing only
 * @returns {{destroy: () => void, isOpen: () => boolean, setOpen: (b:boolean) => void, mediaChanged: () => void}}
 */
export function attachTabControlsSheet(controls, media) {
    activeSheet?.destroy();

    const mq = media || (typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(PHONE_MQ)
        : { matches: false, addEventListener() {}, removeEventListener() {} });

    // 0 means "never measured" — fall back to the viewport until the band
    // is on the page and has a width of its own.
    let bandWidth = 0;
    const narrowNow = () => (bandWidth > 0 ? bandWidth <= NARROW_WIDTH : mq.matches);

    // Snapshot before anything moves — restoring is "re-append in this order".
    const bandOrder = [...controls.children];

    const sheetId = `tab-settings-sheet-${++sheetSeq}`;

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'tab-more-btn qc-toggle-btn';
    moreBtn.textContent = '⚙';
    moreBtn.title = 'More tab settings';
    moreBtn.setAttribute('aria-label', 'More tab settings');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-controls', sheetId);

    const sheet = document.createElement('div');
    sheet.id = sheetId;
    sheet.className = 'tab-settings-sheet hidden';
    sheet.setAttribute('role', 'group');
    sheet.setAttribute('aria-label', 'Tab settings');

    const rows = SHEET_ROWS.map(({ label, selectors }) => {
        const row = document.createElement('div');
        row.className = 'tab-sheet-row hidden';
        const labelEl = document.createElement('span');
        labelEl.className = 'tab-sheet-label';
        labelEl.textContent = label;
        const items = document.createElement('div');
        items.className = 'tab-sheet-items';
        row.append(labelEl, items);
        sheet.appendChild(row);
        return { row, items, selectors };
    });

    let inSheet = false;

    const setOpen = (open) => {
        sheet.classList.toggle('hidden', !open);
        moreBtn.classList.toggle('active', open);
        moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    const isOpen = () => !sheet.classList.contains('hidden');

    const moveIntoSheet = () => {
        if (inSheet) return;
        controls.append(moreBtn, sheet);
        for (const { row, items, selectors } of rows) {
            for (const sel of selectors) {
                // :scope > — only band-level children move; nested matches
                // (a .qc-btn inside a group) travel with their parent.
                for (const node of controls.querySelectorAll(`:scope > ${sel}`)) {
                    items.appendChild(node);
                }
            }
            row.classList.toggle('hidden', items.children.length === 0);
        }
        inSheet = true;
    };

    const moveIntoBand = () => {
        if (!inSheet) return;
        setOpen(false);
        for (const node of bandOrder) controls.appendChild(node);
        moreBtn.remove();
        sheet.remove();
        inSheet = false;
    };

    const apply = () => {
        const narrow = narrowNow();
        // The class is what the CSS keys off in browsers WITHOUT container
        // queries, and what a test can assert without measuring anything.
        controls.classList.toggle('is-narrow-band', narrow);
        return narrow ? moveIntoSheet() : moveIntoBand();
    };

    // Watch the band, not the window. Moving controls into the sheet does
    // not change the band's width (it is `width: 100%` inside the bottom
    // band, and `container-type: inline-size` makes that explicit), so this
    // cannot oscillate — and `moveIntoSheet` / `moveIntoBand` are no-ops
    // when the answer hasn't changed anyway.
    let observer = null;
    if (!media && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect?.width || controls.clientWidth || 0;
            if (width === bandWidth) return;
            bandWidth = width;
            apply();
        });
        observer.observe(controls);
    }

    // A re-render swaps in a new `.tab-controls`; the orphaned one's global
    // listeners have to go with it. (createTablatureControls attaches before
    // setBottomBand mounts, so "not connected yet" is not "detached".)
    let everMounted = false;
    const detachedTeardown = () => {
        if (controls.isConnected) { everMounted = true; return false; }
        if (!everMounted) return false;
        destroy();
        return true;
    };

    const onDocClick = (e) => {
        if (detachedTeardown() || !isOpen()) return;
        if (!sheet.contains(e.target) && !moreBtn.contains(e.target)) setOpen(false);
    };

    const onKeyDown = (e) => {
        if (detachedTeardown()) return;
        if (e.key === 'Escape' && isOpen()) setOpen(false);
    };

    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!isOpen());
    });

    // Edit tears the band down and mounts the editor bar — don't leave a
    // sheet floating over it.
    sheet.addEventListener('click', (e) => {
        if (e.target.closest('.tab-edit-btn')) setOpen(false);
    });

    function destroy() {
        observer?.disconnect();
        observer = null;
        mq.removeEventListener?.('change', apply);
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKeyDown);
        if (activeSheet?.controls === controls) activeSheet = null;
    }

    mq.addEventListener?.('change', apply);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    apply();

    activeSheet = { controls, destroy, isOpen, setOpen, mediaChanged: apply };
    return activeSheet;
}
