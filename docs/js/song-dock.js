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
 *
 * -> {kind, choices, tabs, versions}
 *   kind     'none' (nothing to choose), 'segmented' (Lyrics | Chart, two or
 *            three choices and nothing else) or 'sheet' (View ▾)
 *   choices  [{id, label, on}] ids: lyrics, both, chart, chords, notation
 *   tabs     [{id: partId, label, on}] the other parts (tabs, documents)
 */
export function viewModel({ parts = [], active = null, hybrid = false, abcShown = false,
    wide = false, beside = true, versions = false } = {}) {
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
        .map(p => ({ id: p.partId, label: p.label || p.type, on: p === active }));

    let kind = 'none';
    if (versions || choices.length + tabs.length > 1) {
        kind = !versions && !tabs.length && !hybrid && choices.length > 1 ? 'segmented' : 'sheet';
    }
    return { kind, choices, tabs, versions: !!versions };
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
 * badges), then Tabs. `onPick(id)` / `onPickTab(partId)` act and close.
 */
export function fillViewSheet(content, model, { onPick, onPickTab, renderVersions }) {
    content.textContent = '';
    if (model.choices.length) {
        const list = document.createElement('div');
        list.className = 'dock-list';
        for (const c of model.choices) {
            const r = row(c.label, c.on, { view: c.id });
            r.addEventListener('click', () => onPick(c.id));
            list.appendChild(r);
        }
        content.appendChild(list);
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
        const list = document.createElement('div');
        list.className = 'dock-list';
        for (const t of model.tabs) {
            const r = row(t.label, t.on, { part: t.id });
            r.addEventListener('click', () => onPickTab(t.id));
            list.appendChild(r);
        }
        content.appendChild(list);
    }
}
