// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    chordMenuModel, splitChord, decomposeChord, applyDecoration, applyBass, DECORATIONS,
} from '../lead-editor/chord-menu-model.js';
import { isValidChord } from '../chords.js';
import { createChordMenu } from '../lead-editor/chord-menu.js';
import { inKey, chordFunction, createSusMemory } from '../lead-editor/chord-menu-model.js';

const chords = (row) => row.cells.map((c) => c.chord);
const nums = (row) => row.cells.map((c) => c.numeral);

describe('chord menu: G major', () => {
    it('two rows: flipped above diatonic; the diatonic triads carry numerals', () => {
        const m = chordMenuModel({ key: 'G' });
        expect(m.rows.map((r) => r.id)).toEqual(['flipped', 'diatonic']);
        expect(chords(m.rows[1])).toEqual(['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim']);
        expect(nums(m.rows[1])).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    });
    it('flip rule: same root, flipped quality, same column; the vii° column holds bVII', () => {
        const m = chordMenuModel({ key: 'G' });
        expect(chords(m.rows[0])).toEqual(['Gm', 'A', 'B', 'Cm', 'Dm', 'E', 'F']);
        expect(nums(m.rows[0])).toEqual(['i', 'II', 'III', 'iv', 'v', 'VI', 'bVII']);
        // every flipped cell shares its root with the diatonic cell under it (bVII is the one exception)
        const root = (c) => splitChord(c).root;
        for (let i = 0; i < 6; i++) expect(root(m.rows[0].cells[i].chord)).toBe(root(m.rows[1].cells[i].chord));
    });
    it('has no cells for extensions (no G7, G6, Gsus2, Gdim7 ...)', () => {
        const all = chordMenuModel({ key: 'G' }).rows.flatMap((r) => chords(r));
        expect(all.filter((c) => /7|6|9|sus|add/.test(c))).toEqual([]);
    });
    it('vii° is drawn quieter', () => {
        expect(chordMenuModel({ key: 'G' }).rows[1].cells[6].quiet).toBe(true);
    });
    it('dots the chords the song uses (and has no "also in this song" strip)', () => {
        const m = chordMenuModel({ key: 'G', used: ['G', 'C', 'D', 'D/F#', 'D7'] });
        const used = m.rows.flatMap((r) => r.cells).filter((c) => c.used).map((c) => c.chord);
        expect(used.sort()).toEqual(['C', 'D', 'G']);
        expect(m.also).toBeUndefined();
    });
    it('in key or outside is decided per chord (the helper), not per row; rows are named for assistive tech only', () => {
        const m = chordMenuModel({ key: 'G' });
        expect(m.rows.map((r) => r.label)).toEqual(['Outside', 'In key']);
        expect(m.rows[0].cells.every((c) => c.outside)).toBe(true);     // Gm A B Cm Dm E F: none is in G
        expect(m.rows[1].cells.some((c) => c.outside)).toBe(false);
        // Em: the flipped row holds B (V, with the raised 7th), which IS in key
        const em = chordMenuModel({ key: 'Em' });
        const flipped = em.rows[0].cells.filter((c) => !c.outside).map((c) => c.chord);
        expect(flipped).toEqual(['B']);
    });
    it('the cell under a decorated chord stays selected (Am7 selects Am)', () => {
        const m = chordMenuModel({ key: 'G', current: 'Am7' });
        expect(m.rows[1].cells[1].selected).toBe(true);
    });
});

describe('decorations', () => {
    it('are hidden while the box is empty and shown once it holds a chord', () => {
        expect(chordMenuModel({ key: 'G' }).decorations).toEqual([]);
        expect(chordMenuModel({ key: 'G', current: '' }).bass).toBe(null);
        const m = chordMenuModel({ key: 'G', current: 'D' });
        expect(m.decorations.filter((d) => !d.rare).map((d) => d.label)).toEqual(['⁷', 'maj⁷', '⁶', 'sus⁴', 'sus²', 'add⁹', '⁹']);
        expect(m.decorations.filter((d) => d.rare).map((d) => d.id)).toEqual(['69', '11', '13', 'dim', 'm7b5', 'aug']);   // m(maj7) only on a minor chord
    });
    it('sus owns the quality: a sus chord has no major/minor third', () => {
        for (const [chord, id, want] of [['Dm', 'sus2', 'Dsus2'], ['Dm', 'sus4', 'Dsus4'], ['Dm7', 'sus4', 'Dsus4'],
            ['Ddim', 'sus2', 'Dsus2'], ['Daug', 'sus4', 'Dsus4'], ['Dm/F', 'sus2', 'Dsus2/F']]) {
            expect(applyDecoration(chord, id), `${chord}+${id}`).toBe(want);
            expect(isValidChord(want)).toBe(true);
        }
        expect(applyDecoration('Dsus2', 'sus2')).toBe('D');
        expect(chordMenuModel({ key: 'G', current: 'Dm' }).decorations.find((d) => d.id === 'sus2').chord).toBe('Dsus2');
    });
    it('a sus chord is upper case in the function', () => {
        expect(chordFunction('Dsus2', 'A').numeral).toBe('IVsus2');
        expect(chordFunction('Dsus4', 'A').numeral).toBe('IVsus4');
        expect(chordFunction('Dm', 'A').numeral).toBe('iv');
    });
    it('toggling a sus off restores what was there (Dm -> Dsus2 -> Dm), else the plain triad', () => {
        const m = createSusMemory();
        expect(m.pick(10, 'Dm', 'sus2')).toBe('Dsus2');
        expect(m.pick(10, 'Dsus2', 'sus2')).toBe('Dm');
        expect(m.pick(10, 'Dm7', 'sus4')).toBe('Dsus4');
        expect(m.pick(10, 'Dsus4', 'sus2')).toBe('Dsus2');           // switching keeps the memory
        expect(m.pick(10, 'Dsus2', 'sus2')).toBe('Dm7');
        expect(m.pick(10, 'Dm', 'sus2')).toBe('Dsus2');
        expect(m.pick(12, 'Dsus2', 'sus2')).toBe('D');               // another position
        expect(m.pick(10, 'Dm', 'sus2')).toBe('Dsus2');
        expect(m.pick(10, 'Dsus2', '7')).toBe('D7');                 // another decoration forgets it
        expect(m.pick(10, 'D7', '7')).toBe('D');
        expect(m.pick(10, 'Dm', 'sus2')).toBe('Dsus2');
        expect(m.pick(10, 'Dsus2/F', 'sus2')).toBe('D/F');           // the box chord changed meanwhile
        expect(m.pick(10, 'G', 'sus4')).toBe('Gsus4');               // a plain chord: nothing to remember
        expect(m.pick(10, 'Gsus4', 'sus4')).toBe('G');
    });
    it('the main row is 8 cells in order and the second row holds the rest, /bass last', () => {
        const menu = sheetFor({ key: 'G', used: [], moving: false, current: 'Dm' });
        const ids = (sel) => [...menu.el.querySelectorAll(`${sel} .chm-deco`)].map((b) => b.dataset.id);
        expect(ids('.chm-decos:not(.chm-decos2)')).toEqual(['7', 'maj7', '6', 'sus4', 'sus2', 'add9', '9', 'extra']);
        expect(menu.el.querySelector('.chm-decos2')).toBe(null);
        const dots = menu.el.querySelector('.chm-extra');
        expect(dots.getAttribute('aria-expanded')).toBe('false');
        dots.click();
        const dots2 = menu.el.querySelector('.chm-extra');
        expect(dots2.getAttribute('aria-expanded')).toBe('true');
        expect(dots2.classList.contains('on')).toBe(true);
        expect(ids('.chm-decos2')).toEqual(['69', '11', '13', 'dim', 'm7b5', 'aug', 'mmaj7', 'bass']);
        expect(menu.el.querySelector('.chm-decos:not(.chm-decos2) .chm-bass')).toBe(null);
        menu.el.querySelector('.chm-bass').click();
        expect(menu.el.querySelectorAll('[data-bass]')).toHaveLength(12);
        menu.el.querySelector('.chm-extra').click();
        expect(menu.el.querySelector('.chm-decos2')).toBe(null);
        expect(menu.el.querySelector('.chm-bass')).toBe(null);
        menu.destroy();
    });
    it('idle (empty box): the same 8 disabled cells and no second row', () => {
        const menu = sheetFor({ key: 'G', used: [], moving: false, current: '' });
        expect(menu.el.querySelectorAll('.chm-decos.idle .chm-deco')).toHaveLength(8);
        expect([...menu.el.querySelectorAll('.chm-decos.idle .chm-deco')].every((b) => b.disabled)).toBe(true);
        expect(menu.el.querySelector('.chm-decos2')).toBe(null);
        menu.destroy();
    });
    it.each([
        ['Am', '7', 'Am7'], ['D', '7', 'D7'], ['A', 'maj7', 'Amaj7'], ['Dm', '6', 'Dm6'], ['G', 'sus4', 'Gsus4'],
        ['G', '69', 'G69'], ['C', 'add9', 'Cadd9'], ['Em', '9', 'Em9'], ['G', 'sus2', 'Gsus2'], ['F#dim', '7', 'F#dim7'],
    ])('%s + %s -> %s', (chord, id, want) => {
        expect(applyDecoration(chord, id)).toBe(want);
        expect(isValidChord(want)).toBe(true);
    });
    it('one extension at a time: a second replaces the first', () => {
        expect(applyDecoration('G7', 'sus4')).toBe('Gsus4');
        expect(applyDecoration('Am7', 'maj7')).toBe('Ammaj7');
    });
    it('tapping the active one again removes it, back to the plain triad', () => {
        expect(applyDecoration('Am7', '7')).toBe('Am');
        expect(applyDecoration('Gsus4', 'sus4')).toBe('G');
        const on = chordMenuModel({ key: 'G', current: 'Am7' }).decorations.filter((d) => d.on).map((d) => d.id);
        expect(on).toEqual(['7']);
    });
    it('the active decoration offers the chord WITHOUT it (tapping toggles it off)', () => {
        const m = chordMenuModel({ key: 'G', current: 'D7' });
        expect(m.decorations.find((d) => d.id === '7').chord).toBe('D');
        expect(m.decorations.find((d) => d.id === 'sus4').chord).toBe('Dsus4');
    });
    it('the offered chord is what tapping gives', () => {
        const m = chordMenuModel({ key: 'G', current: 'Dm' });
        expect(m.decorations.find((d) => d.id === '6').chord).toBe('Dm6');
    });
    it('/bass keeps the extension and toggles', () => {
        expect(applyBass('Am7', 'G')).toBe('Am7/G');
        expect(applyBass('Am7/G', 'G')).toBe('Am7');
        expect(chordMenuModel({ key: 'G', current: 'D/F#' }).bass).toMatchObject({ on: true, note: 'F#' });
    });
    it('decomposes the plain qualities and keeps the minor of odd ones', () => {
        expect(decomposeChord('Bbmaj7')).toEqual({ root: 'Bb', base: '', ext: 'maj7', bass: '' });
        expect(decomposeChord('Cmaj9')).toEqual({ root: 'C', base: '', ext: '', bass: '' });
        expect(decomposeChord('x')).toBe(null);
    });
});

describe('chord menu: other keys', () => {
    it('transposes both rows to the key', () => {
        const m = chordMenuModel({ key: 'D' });
        expect(chords(m.rows[1])).toEqual(['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim']);
        expect(chords(m.rows[0])).toEqual(['Dm', 'E', 'F#', 'Gm', 'Am', 'B', 'C']);
    });
    it('Em: natural-minor row, flipped row above it', () => {
        const m = chordMenuModel({ key: 'Em' });
        expect(m.minor).toBe(true);
        expect(chords(m.rows[1])).toEqual(['Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D']);
        expect(nums(m.rows[1])).toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
        expect(chords(m.rows[0])).toEqual(['E', 'F#m', 'Gm', 'A', 'B', 'Cm', 'Dm']);
        expect(nums(m.rows[0])).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii']);
    });
    it('Am is Em moved up a fifth below', () => {
        const m = chordMenuModel({ key: 'Am' });
        expect(chords(m.rows[1])[0]).toBe('Am');
        expect(chords(m.rows[0])[4]).toBe('E');
    });
    it('unknown keys fall back to G', () => {
        expect(chordMenuModel({ key: 'nonsense' }).key).toBe('G');
    });
});

describe('helpers', () => {
    it('splitChord', () => {
        expect(splitChord('F#m7/C#')).toEqual({ root: 'F#', quality: 'm7', bass: '/C#' });
        expect(splitChord('x')).toBe(null);
    });
    it('DECORATIONS: seven always visible, seven rarer ones behind the dots', () => {
        expect(DECORATIONS.filter((d) => !d.rare)).toHaveLength(7);
        expect(DECORATIONS.filter((d) => d.rare)).toHaveLength(7);
    });
});

function sheetFor(ctx) {
    const menu = createChordMenu({
        getContext: () => ctx, onPick() {}, onRemove() {}, onMove() {}, onClose() {}, onKeyChange() {}, onStep() {},
        onGlide() {}, onAddChordLine() {}, getStrip: () => null,
    });
    document.body.appendChild(menu.el);
    menu.open({ rect: null, asSheet: true });
    return menu;
}

describe('the rarer extensions', () => {
    it.each([
        ['G', '69', 'G69'], ['G', '11', 'G11'], ['G', '13', 'G13'], ['G', 'dim', 'Gdim'], ['Am7', 'dim', 'Adim7'],
        ['G', 'aug', 'Gaug'], ['Am', 'm7b5', 'Am7b5'], ['A', 'm7b5', 'Am7b5'], ['Am', 'mmaj7', 'Ammaj7'], ['Am7', 'mmaj7', 'Ammaj7'],
    ])('%s + %s -> %s', (chord, id, want) => {
        expect(applyDecoration(chord, id)).toBe(want);
        expect(isValidChord(want)).toBe(true);
    });
    it('the active one toggles off, keeping the quality it replaced', () => {
        expect(applyDecoration('Gdim', 'dim')).toBe('G');
        expect(applyDecoration('Am7b5', 'm7b5')).toBe('Am');
        expect(applyDecoration('Ammaj7', 'mmaj7')).toBe('Am');
        expect(applyDecoration('G13', '13')).toBe('G');
    });
    it('m(maj7) is offered on a minor chord only', () => {
        const ids = (c) => chordMenuModel({ key: 'G', current: c }).decorations.map((d) => d.id);
        expect(ids('Am')).toContain('mmaj7');
        expect(ids('D')).not.toContain('mmaj7');
    });
});

describe('More roots: only the roots that are on neither row', () => {
    const roots = (key) => chordMenuModel({ key }).moreRoots.map((r) => r.root);
    it('G major', () => { expect(roots('G')).toEqual(['C#', 'D#', 'G#', 'A#']); });
    it('Bm: the owner\'s example, C D# F G# A#', () => { expect(roots('Bm')).toEqual(['C', 'D#', 'F', 'G#', 'A#']); });
    it('Eb (a flat key is spelled with flats)', () => { expect(roots('Eb')).toEqual(['E', 'Gb', 'A', 'B']); });
    it('each is a major and a minor cell, both outside, with numerals', () => {
        const r = chordMenuModel({ key: 'G' }).moreRoots;
        expect(r[0].major).toMatchObject({ chord: 'C#', numeral: 'bV', outside: true });
        expect(r[0].minor).toMatchObject({ chord: 'C#m', numeral: 'bv', outside: true });
        expect(r.map((x) => x.major.numeral)).toEqual(['bV', 'bVI', 'bII', 'bIII']);
    });
    it('no root appears on the grid and in More roots', () => {
        for (const key of ['G', 'Bm', 'Eb', 'Em', 'F#', 'C']) {
            const m = chordMenuModel({ key });
            const gridRoots = new Set(m.rows.flatMap((row) => row.cells.map((c) => splitChord(c.chord).root)));
            for (const r of m.moreRoots) expect(gridRoots.has(r.root), `${key}: ${r.root}`).toBe(false);
        }
    });
});

describe('bass notes', () => {
    it('twelve, the key\'s own tones in key, the rest outside', () => {
        const b = chordMenuModel({ key: 'G', current: 'D' }).bass;
        expect(b.notes).toHaveLength(12);
        expect(b.notes.filter((n) => n.inKey).map((n) => n.note)).toEqual(['C', 'D', 'E', 'F#', 'G', 'A', 'B']);
    });
    it('F# and Gb are the same bass', () => {
        expect(applyBass('D/F#', 'Gb')).toBe('D');
        expect(chordMenuModel({ key: 'D', current: 'D/F#' }).bass.notes.find((n) => n.on).note).toBe('F#');
    });
});

// ---- the DOM: every chord and every extension exactly once ----
// Stored-XSS guard: the chord in the box comes from the song file, which any contributor
// writes. Every part of it (root, quality, numeral, the slash bass) must reach the DOM as text.
describe('the sheet never renders chord text as markup', () => {
    it.each([
        'D/<img src=x onerror=alert(1)>',
        'G°<img src=x onerror=alert(1)>',
        'Gm"><script>alert(1)</script>',
    ])('%s', (current) => {
        const menu = createChordMenu({
            getContext: () => ({ key: 'G', used: [current], moving: false, current }),
            onPick() {}, onRemove() {}, onMove() {}, onClose() {}, onKeyChange() {}, onStep() {},
            onGlide() {}, onAddChordLine() {}, getStrip: () => null,
        });
        document.body.appendChild(menu.el);
        menu.open({ rect: null, asSheet: true });
        for (const sel of ['.chm-bass', '.chm-extra', '.chm-more']) menu.el.querySelector(sel)?.click();
        expect(menu.el.querySelector('img, script')).toBeNull();
        menu.destroy();
    });
});

describe('the sheet draws each chord and each extension exactly once', () => {
    function sheet(ctx) {
        const menu = createChordMenu({
            getContext: () => ctx, onPick() {}, onRemove() {}, onMove() {}, onClose() {}, onKeyChange() {}, onStep() {},
            onGlide() {}, onAddChordLine() {}, getStrip: () => null,
        });
        document.body.appendChild(menu.el);
        menu.open({ rect: null, asSheet: true });
        return menu;
    }
    const base = { key: 'G', used: ['G', 'C', 'D', 'D/F#', 'D7'], moving: false };
    const dataChords = (el) => [...el.querySelectorAll('[data-chord]')].map((b) => b.dataset.chord);
    const dup = (list) => list.filter((x, i) => list.indexOf(x) !== i);

    it.each([
        ['empty box', { ...base, current: '' }, []],
        ['a chord in the box', { ...base, current: 'D' }, []],
        ['a decorated chord', { ...base, current: 'Am7' }, []],
        ['More roots open', { ...base, current: 'D' }, ['.chm-more']],
        ['rare extensions open', { ...base, current: 'D' }, ['.chm-extra']],
        ['the bass row open', { ...base, current: 'D' }, ['.chm-extra', '.chm-bass']],
        ['everything open', { ...base, current: 'D/F#' }, ['.chm-more', '.chm-extra', '.chm-bass']],
    ])('%s', (_name, ctx, clicks) => {
        const menu = sheet(ctx);
        for (const sel of clicks) menu.el.querySelector(sel).click();
        const chords = dataChords(menu.el);
        expect(dup(chords)).toEqual([]);
        expect(chords.length).toBeGreaterThanOrEqual(14);
        // extensions live only in the decoration row: no cell, root or bass button carries one
        const decoIds = [...menu.el.querySelectorAll('.chm-decos [data-id]')].map((b) => b.dataset.id);
        expect(dup(decoIds)).toEqual([]);
        for (const c of chords) expect(c, c).not.toMatch(/\d|sus|add|maj|aug/);
        const outsideOfRow = [...menu.el.querySelectorAll('.chm-deco')].filter((b) => !b.closest('.chm-decos'));
        expect(outsideOfRow).toEqual([]);
        menu.destroy();
    });
    it('has no "Also in this song" strip and no old More chords grids', () => {
        const menu = sheet({ ...base, current: 'D' });
        menu.el.querySelector('.chm-more').click();
        expect(menu.el.textContent).not.toMatch(/Also in this song|More chords/);
        expect(menu.el.querySelector('.chm-chip, .chm-quals, .chm-qual')).toBe(null);
        expect(menu.el.querySelector('.chm-free input')).not.toBe(null);
        menu.destroy();
    });
    it('outside cells carry the outside class, in-key cells the in-key class', () => {
        const menu = sheet({ ...base, current: 'D' });
        menu.el.querySelector('.chm-more').click();
        expect(menu.el.querySelectorAll('.chm-row-flipped .chm-cell.chm-outside')).toHaveLength(7);   // in the key of D none of Dm E F# Gm Am B C is in key
        expect(menu.el.querySelectorAll('.chm-row-diatonic .chm-cell.chm-inkey')).toHaveLength(7);
        expect(menu.el.querySelectorAll('.chm-row-diatonic .chm-outside')).toHaveLength(0);
        const more = menu.el.querySelectorAll('.chm-row-more .chm-cell');
        expect(more.length).toBe(8);
        for (const c of more) expect(c.classList.contains('chm-outside')).toBe(true);
        // no captions on screen: the difference is the styling; the rows keep their aria-labels
        expect(menu.el.querySelectorAll('.chm-rowlabel')).toHaveLength(0);
        expect(menu.el.textContent).not.toMatch(/Outside|In key/);
        expect(menu.el.querySelector('.chm-row-flipped').getAttribute('aria-label')).toBe('Outside');
        expect(menu.el.querySelector('.chm-row-diatonic').getAttribute('aria-label')).toBe('In key');
        menu.destroy();
    });
    it('the bass row marks the key\'s tones', () => {
        const menu = sheet({ ...base, current: 'D' });
        menu.el.querySelector('.chm-extra').click();
        menu.el.querySelector('.chm-bass').click();
        const notes = [...menu.el.querySelectorAll('[data-bass]')];
        expect(notes).toHaveLength(12);
        expect(notes.filter((b) => b.classList.contains('chm-inkey'))).toHaveLength(7);
        expect(notes.filter((b) => b.classList.contains('chm-outside'))).toHaveLength(5);
        menu.destroy();
    });
    it('the superscript marks are drawn as plain characters in the buttons', () => {
        const menu = sheet({ ...base, current: 'D' });
        const labels = [...menu.el.querySelectorAll('.chm-deco[data-id]')].map((b) => b.textContent);
        expect(labels.join(' ')).toMatch(/\b7\b.*maj7/);
        expect(labels.join('')).not.toMatch(/[⁰-⁹₀-₉]/);
        menu.destroy();
    });
});

describe('inKey: every chord tone in the key\'s scale', () => {
    it.each([
        ['G', 'D7', true], ['G', 'Cmaj7', true], ['G', 'G7', false], ['G', 'A7', false], ['G', 'Am7', true], ['G', 'F#dim', true],
        ['G', 'Gm', false], ['G', 'D/F#', true], ['G', 'D/Bb', false], ['G', 'Dsus4', true], ['G', 'Gsus2', true],
        ['Em', 'B7', true], ['Em', 'B', true], ['Em', 'Bm', true], ['Em', 'E', false], ['Em', 'Am7', true],
        ['Bb', 'F7', true], ['Bb', 'Gm', true], ['Bb', 'G', false], ['Bb', 'Bb7', false], ['Bb', 'Ebmaj7', true],
        ['Eb', 'Bb7', true], ['Eb', 'Ab', true], ['Eb', 'Eb7', false], ['Eb', 'F7', false], ['Eb', 'Cm7', true],
    ])('%s: %s -> %s', (key, chord, want) => {
        expect(inKey(chord, key)).toBe(want);
    });
    it('says no to what it cannot read', () => { expect(inKey('x', 'G')).toBe(false); });
});

describe('the extension buttons are styled by whether the RESULT is in key', () => {
    const inK = (key, current) => Object.fromEntries(chordMenuModel({ key, current }).decorations.map((d) => [d.id, d.inKey]));
    it('G in G major: maj7 is solid, 7 is outlined', () => {
        const d = inK('G', 'G');
        expect(d.maj7).toBe(true);
        expect(d['7']).toBe(false);
    });
    it('D in G major: 7 is solid', () => { expect(inK('G', 'D')['7']).toBe(true); });
    it('the active extension is judged on the chord as it stands', () => {
        expect(inK('G', 'G7')['7']).toBe(false);
        expect(inK('G', 'Gmaj7').maj7).toBe(true);
    });
});

describe('what a chord does in the key', () => {
    const f = (chord, key = 'G') => chordFunction(chord, key);
    it.each([
        ['G7', 'I7', 'V7/IV'], ['A7', 'II7', 'V7/V'], ['B7', 'III7', 'V7/vi'], ['E7', 'VI7', 'V7/ii'],
    ])('%s -> %s (%s)', (chord, numeral, secondary) => {
        expect(f(chord)).toMatchObject({ numeral, secondary, text: `${numeral} (${secondary})` });
    });
    it('plain diatonic chords show just the numeral', () => {
        expect(f('D7')).toMatchObject({ numeral: 'V7', secondary: null, text: 'V7' });
        expect(f('Am')).toMatchObject({ text: 'ii' });
        expect(f('C')).toMatchObject({ text: 'IV' });
        expect(f('G').text).toBe('I');
    });
    it('a major chord a fifth above a diatonic target is a secondary dominant too', () => {
        expect(f('A').text).toBe('II (V/V)');
    });
    it('outside chords with no diatonic target are just numerals', () => {
        expect(f('F').text).toBe('bVII');
        expect(f('C7').secondary).toBe(null);
    });
    it('minor keys: B7 is the plain V7; A7 is V7/VII', () => {
        expect(chordFunction('B7', 'Em')).toMatchObject({ numeral: 'V7', secondary: null });
        expect(chordFunction('A7', 'Em')).toMatchObject({ numeral: 'IV7', secondary: 'V7/VII' });
        expect(chordFunction('Am', 'Em').text).toBe('iv');
    });
    it('works in flat keys', () => {
        expect(chordFunction('Bb7', 'Eb')).toMatchObject({ numeral: 'V7', secondary: null });
        expect(chordFunction('Eb7', 'Eb').text).toBe('I7 (V7/IV)');
    });
    it('the model carries it for the chord in the box, and nothing for an empty box', () => {
        expect(chordMenuModel({ key: 'G', current: 'A7' }).func.text).toBe('II7 (V7/V)');
        expect(chordMenuModel({ key: 'G', current: '' }).func).toBe(null);
    });
});

describe('the sheet header shows the function once', () => {
    it('A7 in G: "A⁷ · II⁷ (V⁷/V)", drawn with glyphs, and only in the header', () => {
        const menu = createChordMenu({
            getContext: () => ({ key: 'G', used: [], current: 'A7', moving: false }),
            onPick() {}, onRemove() {}, onMove() {}, onClose() {}, onKeyChange() {}, onStep() {}, onGlide() {}, getStrip: () => null,
        });
        document.body.appendChild(menu.el);
        menu.open({ rect: null, asSheet: true });
        const fn = menu.el.querySelectorAll('.chm-func');
        expect(fn).toHaveLength(1);
        expect(fn[0].closest('.chm-head')).not.toBe(null);
        expect(fn[0].textContent.replace(/\s+/g, ' ')).toBe('A7 · II7 (V7/V)');
        expect(fn[0].querySelectorAll('sup').length).toBeGreaterThanOrEqual(3);
        menu.destroy();
    });
    it('the on-screen text never repeats it: no function without a chord in the box', () => {
        const menu = createChordMenu({
            getContext: () => ({ key: 'G', used: [], current: '', moving: false }),
            onPick() {}, onRemove() {}, onMove() {}, onClose() {}, onKeyChange() {}, onStep() {}, onGlide() {}, getStrip: () => null,
        });
        document.body.appendChild(menu.el);
        menu.open({ rect: null, asSheet: true });
        expect(menu.el.querySelector('.chm-func')).toBe(null);
        menu.destroy();
    });
});

describe('the ↵ chord line key replaces "+ Add chord line"', () => {
    it('is one labelled key in the footer and fires onAddChordLine', () => {
        let n = 0;
        const menu = createChordMenu({
            getContext: () => ({ key: 'G', used: [], moving: false, current: '' }),
            onPick() {}, onRemove() {}, onMove() {}, onClose() {}, onKeyChange() {}, onStep() {},
            onGlide() {}, onAddChordLine: () => { n++; }, getStrip: () => null,
        });
        document.body.appendChild(menu.el);
        menu.open({ rect: null, asSheet: true });
        const keys = menu.el.querySelectorAll('.chm-enter');
        expect(keys).toHaveLength(1);
        expect(keys[0].textContent).toBe('↵ Chord line');
        expect(keys[0].getAttribute('aria-label')).toBeTruthy();
        expect(menu.el.textContent).not.toMatch(/Add chord line/);
        keys[0].click();
        expect(n).toBe(1);
        menu.destroy();
    });
});
