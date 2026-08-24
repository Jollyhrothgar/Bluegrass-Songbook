// "This song already has tabs for that instrument" — said BEFORE the
// editor opens, not after the work is done.
//
// Contract principle 4: the offramp is a CHOICE OFFERED EARLY, never a
// rejection discovered later. Once upon a time a contributor could target
// foggy-mountain-breakdown with a banjo tab, spend an hour arranging it,
// hit Submit, and only then meet a 409 from the server. The corpus has
// carried same-instrument siblings for months (foggy alone has eight banjo
// takes), so "already exists" was never a reason to refuse — only a reason
// to ask which of three things the contributor meant:
//
//   (a) look at what's there,
//   (b) add theirs alongside as another version, or
//   (c) improve one of the existing tabs (the tab-correction path).
//
// This module is the shared, mostly-pure middle: given an index row and an
// instrument it answers "what's already here?", and it builds the one panel
// that both the add-song picker and the work page show. No state, no
// fetches — `tablature_parts` is already on every index row.

import { getInstrumentTags } from '../tags.js';
import { escapeHtml, slugify, tabLabel } from '../utils.js';

/**
 * Does an existing tablature part count as "a tab for this instrument"?
 *
 * Instrument families come from getInstrumentTags — THE source of
 * instrument identity everywhere else in the app (`tag:banjo` search, the
 * Instrument facet, the result-card badges). A part stored as
 * `5-string-banjo` answers to `banjo` there, so it answers to `banjo`
 * here; anything else would tell a contributor that a banjo tab doesn't
 * exist while search says it does.
 */
export function partMatchesInstrument(part, instrument) {
    if (!instrument) return true;             // no instrument asked → all tabs count
    const want = String(instrument).toLowerCase();
    return getInstrumentTags({ tablature_parts: [part] }).includes(want);
}

/**
 * The tabs a work already has for an instrument (all of them when the
 * instrument is unknown — the "+ Add a tab" button doesn't ask first).
 */
export function existingTabsFor(song, instrument) {
    return (song?.tablature_parts || [])
        .filter(part => partMatchesInstrument(part, instrument));
}

/**
 * The `#work/{id}/{partId}` segment the work page will give this
 * instrument's tab pill. Mirrors buildPartsFromIndex: one pill per
 * instrument, labelled by the default-first arrangement's own label.
 */
export function tabPartIdFor(song, instrument) {
    const tabs = existingTabsFor(song, instrument);
    if (!tabs.length) return null;
    const primary = tabs.find(t => t.default === true) || tabs[0];
    return slugify(primary.label || tabLabel(primary.instrument)) || null;
}

/** How one existing take reads in the list: "Banjo — schlange (Expert)". */
export function tabDisplayName(part) {
    const bits = [tabLabel(part?.instrument).replace(/ Tab$/, '')];
    if (part?.author) bits.push(part.author);
    const name = bits.filter(Boolean).join(' — ');
    return part?.difficulty ? `${name} (${part.difficulty})` : name;
}

/**
 * Headline for the panel: what's there, in the contributor's words —
 * "Foggy Mountain Breakdown already has 8 banjo tabs".
 */
export function existingTabsHeadline(title, count, instrument) {
    const kind = instrument ? `${instrument} ` : '';
    return `${title || 'This song'} already has ${count} ${kind}tab${count === 1 ? '' : 's'}`;
}

/**
 * The whole entry-time decision, as data.
 *
 * `proceed` means nothing is in the way — the caller opens the editor
 * exactly as before. `existing` means show the panel and let the
 * contributor choose; it is never a refusal, and choice (b) leads to the
 * same editor with the same target.
 */
export function tabEntryPlan(song, instrument, { title = null } = {}) {
    const tabs = song ? existingTabsFor(song, instrument) : [];
    if (!tabs.length) return { kind: 'proceed', tabs: [], count: 0 };
    return {
        kind: 'existing',
        workId: song.id,
        title: title || song.title || song.id,
        instrument: instrument || '',
        tabs,
        count: tabs.length,
        partId: tabPartIdFor(song, instrument),
        headline: existingTabsHeadline(title || song.title || song.id,
            tabs.length, instrument),
    };
}

/**
 * Build the three-choice panel.
 *
 * Callers supply the routing, because "view" and "improve" mean different
 * navigation on the work page (already there) than in the picker (has to
 * get there first). Returns a detached element — the caller decides where
 * it lands.
 */
export function renderExistingTabsPanel(plan, {
    onAdd, onImprove, onView, onBack = null, onImport = null,
    addLabel = 'Add mine as another version',
    importLabel = 'Import .tef…',
} = {}) {
    const panel = document.createElement('div');
    panel.className = 'tab-existing-panel';
    panel.innerHTML = `
        <div class="tab-existing-head">${escapeHtml(plan.headline)}</div>
        <p class="tab-existing-sub">Nothing is in your way — takes live side by side,
            and readers pick between them. Have a look first, add yours alongside,
            or improve one that's already here.</p>
        <ul class="tab-existing-list">
            ${plan.tabs.map((tab, i) => `
                <li class="tab-existing-item">
                    <button type="button" class="tab-existing-view" data-idx="${i}"
                        >${escapeHtml(tabDisplayName(tab))}</button>
                    <button type="button" class="tab-existing-improve" data-idx="${i}"
                        >Improve this one</button>
                </li>`).join('')}
        </ul>
        <div class="tab-existing-actions">
            <button type="button" class="tab-existing-add">${escapeHtml(addLabel)}</button>
            ${onImport ? `<button type="button" class="tab-existing-import"
                >${escapeHtml(importLabel)}</button>` : ''}
            ${onBack ? '<button type="button" class="tab-existing-back">Back</button>' : ''}
        </div>`;

    const tabAt = (btn) => plan.tabs[Number(btn.dataset.idx)];
    panel.querySelectorAll('.tab-existing-view').forEach(btn =>
        btn.addEventListener('click', () => onView?.(tabAt(btn), plan)));
    panel.querySelectorAll('.tab-existing-improve').forEach(btn =>
        btn.addEventListener('click', () => onImprove?.(tabAt(btn), plan)));
    panel.querySelector('.tab-existing-add')
        ?.addEventListener('click', () => onAdd?.(plan));
    panel.querySelector('.tab-existing-import')
        ?.addEventListener('click', () => onImport?.(plan));
    panel.querySelector('.tab-existing-back')
        ?.addEventListener('click', () => onBack?.(plan));
    return panel;
}
