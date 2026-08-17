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

const PHONE_MQ = '(max-width: 640px)';

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
 * @param {HTMLElement} controls  the `.tab-controls` element
 * @param {MediaQueryList} [media]  injectable for tests
 * @returns {{destroy: () => void, isOpen: () => boolean, setOpen: (b:boolean) => void, mediaChanged: () => void}}
 */
export function attachTabControlsSheet(controls, media) {
    activeSheet?.destroy();

    const mq = media || (typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(PHONE_MQ)
        : { matches: false, addEventListener() {}, removeEventListener() {} });

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

    const apply = () => (mq.matches ? moveIntoSheet() : moveIntoBand());

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
