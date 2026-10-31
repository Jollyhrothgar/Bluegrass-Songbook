// The song page's reading dock (G19b): the controls that sit in the bottom
// band (`#app-bottomband`) while a lyric sheet, a chord chart or ABC notation
// is on screen, and the View sheet behind its View control.
//
//   Key: A  ·  Aa − +  ·  Lyrics | Chart  ·  Display
//
// This module draws and decides; it owns no page state. work-view.js says
// what the song has (parts, versions) and what each choice does; song-view.js
// asks it for the dock when it renders. `viewModel` is the pure part: which
// choices this song offers, and whether they fit in a segmented control or
// need the View sheet.

import { escapeHtml } from './utils.js';

// ---------------------------------------------------------------------------
// The View model
// ---------------------------------------------------------------------------

/**
 * What View offers for a song, as plain data.
 *
 *   parts    the page's parts: {type: 'lead-sheet' | 'chord-chart' | 'tablature' | 'document', partId, label}
 *   active   the part on screen
 *   hybrid   the lead sheet holds both chords and ABC notation
 *   abcShown (hybrid) the notation is showing, not the chords
 *   wide     there is room for the chart beside the lyrics
 *   beside   (wide) the reader chose Lyrics + Chart rather than Lyrics
 *   versions the song has more than one version
 *   tracks   (a tab) [{id, label, on}] the staves it can show, All included
 *
 * A tab part carries `takes`: [{index, who, source, pinned, on}], the
 * arrangements of that instrument (work-view.js builds them).
 *
 * -> {kind, choices, tabs, tracks, versions}
 *   kind     'none' (nothing to choose), 'segmented' (Lyrics | Chart, two or
 *            three choices and nothing else) or 'sheet' (View ▾)
 *   choices  [{id, label, on}] ids: lyrics, both, chart, chords, notation
 *   tabs     [{id: partId, label, on, takes}] the other parts (tabs, documents)
 *   tracks   the same list, only when the tab has more than one
 */
export function viewModel({ parts = [], active = null, hybrid = false, abcShown = false,
    wide = false, beside = true, versions = false, tracks = [] } = {}) {
    const lead = parts.find(p => p.type === 'lead-sheet');
    const chart = parts.find(p => p.type === 'chord-chart');
    const onLead = !!lead && active === lead;
    const onChart = !!chart && active === chart;
    const choices = [];
    if (lead && hybrid) {
        choices.push({ id: 'chords', label: 'Chords', on: onLead && !abcShown });
        choices.push({ id: 'notation', label: 'Notation', on: onLead && abcShown });
    } else if (lead) {
        const both = wide && !!chart;
        choices.push({ id: 'lyrics', label: lead.label || 'Lyrics', on: onLead && !(both && beside) });
        if (both) choices.push({ id: 'both', label: 'Lyrics + Chart', on: onLead && beside });
    }
    if (chart) choices.push({ id: 'chart', label: chart.label || 'Chart', on: onChart });

    const tabs = parts
        .filter(p => p.type === 'tablature' || p.type === 'document')
        .map(p => ({ id: p.partId, label: p.label || p.type, on: p === active, takes: p.takes || [] }));
    const staves = tracks.length > 1 ? tracks : [];

    let kind = 'none';
    if (versions || choices.length + tabs.length > 1 || tabs.some(t => t.takes.length > 1) || staves.length) {
        kind = !versions && !tabs.length && !hybrid && !staves.length && choices.length > 1 ? 'segmented' : 'sheet';
    }
    return { kind, choices, tabs, tracks: staves, versions: !!versions };
}

// ---------------------------------------------------------------------------
// Dock pieces
// ---------------------------------------------------------------------------

/** A dock button. `caret` adds the ▾ that says "this opens something". */
export function dockButton({ id, label, caret = false, title = '', labelHtml = null }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dock-btn';
    if (id) btn.id = id;
    if (title) btn.title = title;
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = (labelHtml ?? escapeHtml(label)) + (caret ? ' <span class="dock-caret" aria-hidden="true">▾</span>' : '');
    return btn;
}

/**
 * "Aa − +". One Size for whatever is on screen: the text, or the notation.
 * `canStep(dir)` says whether a step that way is allowed; `step(dir)` takes it.
 */
export function sizeControl({ id = 'dock-size', canStep, step }) {
    const el = document.createElement('span');
    el.className = 'dock-size';
    el.id = id;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Size');
    el.innerHTML = `<span class="dock-size-aa" aria-hidden="true">Aa</span>`
        + `<button type="button" class="dock-size-btn" data-size="-1" aria-label="Smaller" title="Smaller">−</button>`
        + `<button type="button" class="dock-size-btn" data-size="1" aria-label="Larger" title="Larger">+</button>`;
    const buttons = [...el.querySelectorAll('[data-size]')];
    const sync = () => buttons.forEach(b => { b.disabled = !canStep(Number(b.dataset.size)); });
    buttons.forEach(b => b.addEventListener('click', () => {
        const dir = Number(b.dataset.size);
        if (canStep(dir)) step(dir);
        sync();
    }));
    sync();
    return el;
}

/**
 * "Tempo − 120 +": the dock's tempo stepper, for ABC notation and for a tab.
 * Each of `display`, `down` and `up` is {id?, className?} for that part, so
 * the page that owns the number can find its elements.
 */
export function tempoControl({ n, display = {}, down = {}, up = {} }) {
    const el = document.createElement('span');
    el.className = 'dock-tempo';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Tempo');
    const attrs = ({ id, className }, base) => `${id ? ` id="${id}"` : ''} class="${base}${className ? ` ${className}` : ''}"`;
    el.innerHTML = `<span class="dock-tempo-label">Tempo</span>`
        + `<button type="button"${attrs(down, 'dock-size-btn')} aria-label="Slower" title="Decrease tempo">−</button>`
        + `<span${attrs(display, 'dock-tempo-n')}>${n}</span>`
        + `<button type="button"${attrs(up, 'dock-size-btn')} aria-label="Faster" title="Increase tempo">+</button>`;
    return el;
}

/**
 * The View control for a model: a segmented control, a "View ▾" button, or
 * nothing. `onPick(id)` takes a segment; `onOpen(button)` opens the sheet.
 */
export function viewControl(model, { onPick, onOpen }) {
    if (model.kind === 'segmented') {
        const el = document.createElement('div');
        el.className = 'dock-seg';
        el.id = 'dock-view';
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', 'View');
        for (const c of model.choices) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'dock-seg-btn' + (c.on ? ' on' : '');
            b.dataset.view = c.id;
            b.setAttribute('aria-pressed', String(c.on));
            b.textContent = c.label;
            b.addEventListener('click', () => { if (!c.on) onPick(c.id); });
            el.appendChild(b);
        }
        return el;
    }
    if (model.kind === 'sheet') {
        const btn = dockButton({ id: 'dock-view-btn', label: 'View', caret: true, title: 'View: parts, versions and tabs' });
        btn.addEventListener('click', (e) => { e.stopPropagation(); onOpen(btn); });
        return btn;
    }
    return null;
}

/** The dock: whatever is given, in a row, in the bottom band's one container. */
export function readingDock(...pieces) {
    const el = document.createElement('div');
    el.className = 'reading-dock';
    el.append(...pieces.filter(Boolean));
    return el;
}

// ---------------------------------------------------------------------------
// The View sheet
// ---------------------------------------------------------------------------

function row(label, on, attrs = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dock-row' + (on ? ' on' : '');
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(!!on));
    for (const [k, v] of Object.entries(attrs)) b.dataset[k] = v;
    b.innerHTML = `<span class="dock-row-label">${escapeHtml(label)}</span>`
        + (on ? '<span class="dock-row-check" aria-hidden="true">✓</span>' : '');
    return b;
}

function heading(text) {
    const h = document.createElement('div');
    h.className = 'dock-sheet-heading';
    h.textContent = text;
    return h;
}

/**
 * Fill the View sheet: the choices, then Versions (filled by `renderVersions`
 * into a container: it carries the vote buttons and the Canonical / viewing
 * badges), then Tabs, then Tracks (a multi-track tab). A tab with several
 * takes drills into them (`›`): the sheet's title turns into a back button
 * (`title` is the sheet's heading element) and the rows are the takes, the
 * editor's pick starred and the one showing ticked.
 *
 * `onPick(id)` / `onPickTab(partId)` / `onPickTake(partId, index)` /
 * `onPickTrack(id)` act and close.
 */
// "Banjo Tab" is the part's label; under the Tabs heading the word is redundant
const instrumentName = (label) => String(label).replace(/\s+tab$/i, '');

export function fillViewSheet(content, model, { onPick, onPickTab, onPickTake, onPickTrack, renderVersions, title = null }) {
    const heading0 = title?.textContent;
    const list = () => {
        const el = document.createElement('div');
        el.className = 'dock-list';
        return el;
    };

    const showTakes = (tab) => {
        content.textContent = '';
        if (title) {
            title.innerHTML = '<button type="button" class="dock-back" aria-label="Back to View">‹</button> '
                + `<span class="dock-title-text">${escapeHtml(instrumentName(tab.label))} tabs</span> `
                + `<span class="dock-count">${tab.takes.length} takes</span>`;
            title.querySelector('.dock-back').addEventListener('click', showTop);
            title.querySelector('.dock-back').focus();
        }
        const takes = list();
        for (const t of tab.takes) {
            const r = row('', t.on, { take: t.index });
            r.classList.add('dock-take');
            r.innerHTML = `<span class="dock-pin" aria-label="${t.pinned ? 'Editor\'s pick' : ''}">${t.pinned ? '★' : ''}</span>`
                + `<span class="dock-take-text"><span class="dock-take-who">${escapeHtml(t.who)}</span>`
                + (t.source ? ` <span class="dock-take-src">${escapeHtml(t.source)}</span>` : '') + '</span>'
                + (t.on ? '<span class="dock-row-check" aria-hidden="true">✓</span>' : '');
            r.addEventListener('click', () => onPickTake(tab.id, t.index));
            takes.appendChild(r);
        }
        content.appendChild(takes);
    };

    function showTop() {
        content.textContent = '';
        if (title && heading0 != null) title.textContent = heading0;
        if (model.choices.length) {
            const choices = list();
            for (const c of model.choices) {
                const r = row(c.label, c.on, { view: c.id });
                r.addEventListener('click', () => onPick(c.id));
                choices.appendChild(r);
            }
            content.appendChild(choices);
        }
        if (model.versions) {
            content.appendChild(heading('Versions'));
            const host = document.createElement('div');
            host.className = 'dock-versions';
            content.appendChild(host);
            renderVersions(host);
        }
        if (model.tabs.length) {
            content.appendChild(heading('Tabs'));
            const tabs = list();
            for (const t of model.tabs) {
                const drills = (t.takes?.length || 0) > 1;
                const r = row(instrumentName(t.label), t.on, { part: t.id });
                if (drills) {
                    r.querySelector('.dock-row-label').insertAdjacentHTML('afterend',
                        `<span class="dock-count">${t.takes.length}</span>`);
                    r.insertAdjacentHTML('beforeend', '<span class="dock-chev" aria-hidden="true">›</span>');
                }
                r.addEventListener('click', () => (drills ? showTakes(t) : onPickTab(t.id)));
                tabs.appendChild(r);
            }
            content.appendChild(tabs);
        }
        if (model.tracks?.length) {
            content.appendChild(heading('Tracks'));
            const tracks = list();
            for (const t of model.tracks) {
                const r = row(t.label, t.on, { track: t.id });
                r.addEventListener('click', () => onPickTrack(t.id));
                tracks.appendChild(r);
            }
            content.appendChild(tracks);
        }
    }
    showTop();
}
