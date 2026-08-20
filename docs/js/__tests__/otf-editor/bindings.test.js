// The binding table is the single source for keys, help and tooltips.
// These tests are the fence around that claim: a key that isn't an action,
// an action nobody can reach, a browser-reserved chord, or a help overlay
// that advertises something unbound all fail here.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    ACTIONS, PRESETS, DEFAULT_PRESET, RESERVED_CHORDS, GROUP_ORDER,
    FretEntry, canonicalChord, canonicalKeys, eventToKeyString, prettyKeys,
    expandKeys, describe as describeBindings, keyFor, menuKeyFor, allChords, lookup,
    getPreset, setPreset, onPresetChange, resetPreset,
} from '../../otf-editor/bindings.js';
import { OTFEditor } from '../../otf-editor/editor.js';

const PRESET_IDS = Object.keys(PRESETS);

function keyEvent(key, o = {}) {
    return {
        key,
        code: o.code || (/^[0-9]$/.test(key) ? `Digit${key}` : ''),
        ctrlKey: !!o.ctrl, altKey: !!o.alt, shiftKey: !!o.shift, metaKey: !!o.meta,
    };
}

describe('key-string grammar', () => {
    it('canonicalises a bare uppercase letter as Shift', () => {
        expect(canonicalChord('W')).toBe('Shift+W');
        expect(canonicalChord('Shift+w')).toBe('Shift+W');
        expect(canonicalChord('q')).toBe('q');
    });

    it('lets the CASE decide Shift, modifiers or not', () => {
        expect(canonicalChord('Ctrl+z')).toBe('Ctrl+z');
        expect(canonicalChord('Ctrl+Z')).toBe('Ctrl+Shift+Z');
        expect(canonicalChord('Ctrl+Shift+Z')).toBe('Ctrl+Shift+Z');
    });

    it('orders modifiers Ctrl, Alt, Shift', () => {
        expect(canonicalChord('Shift+Alt+Ctrl+ArrowLeft'))
            .toBe('Ctrl+Alt+Shift+ArrowLeft');
    });

    it('accepts friendly aliases and a bare +', () => {
        expect(canonicalChord('Esc')).toBe('Escape');
        expect(canonicalChord('Left')).toBe('ArrowLeft');
        expect(canonicalChord('+')).toBe('+');
        expect(canonicalChord('Ctrl+-')).toBe('Ctrl+-');
    });

    it('canonicalises a whole sequence', () => {
        expect(canonicalKeys('g  g')).toBe('g g');
        expect(canonicalKeys('a ~')).toBe('a ~');
    });

    it('reads the same chord back off a keyboard event', () => {
        expect(eventToKeyString(keyEvent('z', { ctrl: true }))).toBe('Ctrl+z');
        expect(eventToKeyString(keyEvent('Z', { ctrl: true, shift: true })))
            .toBe('Ctrl+Shift+Z');
        expect(eventToKeyString(keyEvent('ArrowLeft', { shift: true })))
            .toBe('Shift+ArrowLeft');
        expect(eventToKeyString(keyEvent(' '))).toBe('Space');
    });

    it('reads a SHIFTED DIGIT off event.code, not the punctuation key', () => {
        // Browsers report `!` for Shift+1; the physical digit is what we bind
        expect(eventToKeyString({ key: '!', code: 'Digit1', shiftKey: true }))
            .toBe('Shift+1');
    });

    it('leaves punctuation alone (shift is already in the character)', () => {
        expect(eventToKeyString(keyEvent('<', { shift: true }))).toBe('<');
        expect(eventToKeyString(keyEvent('?', { shift: true }))).toBe('?');
    });

    it('hands every Cmd chord we do not mirror back to the browser', () => {
        expect(eventToKeyString(keyEvent('f', { meta: true }))).toBeNull();
        expect(eventToKeyString(keyEvent('l', { meta: true }))).toBeNull();
        expect(eventToKeyString(keyEvent('1', { meta: true }))).toBeNull();
        // …but mirrors the seven system idioms onto Ctrl
        expect(eventToKeyString(keyEvent('c', { meta: true }))).toBe('Ctrl+c');
        expect(eventToKeyString(keyEvent('s', { meta: true }))).toBe('Ctrl+s');
    });

    it('expands digit and letter ranges, and leaves a lone dash alone', () => {
        expect(expandKeys('0-9')).toHaveLength(10);
        expect(expandKeys('Shift+0-9')).toContain('Shift+7');
        expect(expandKeys('Ctrl+-')).toEqual(['Ctrl+-']);
        expect(expandKeys('-')).toEqual(['-']);
    });

    it('prints keys for humans', () => {
        expect(prettyKeys('Ctrl+ArrowLeft')).toBe('Ctrl+←');
        expect(prettyKeys('g g')).toBe('gg');
        expect(prettyKeys('a h')).toBe('ah');
        expect(prettyKeys('a ~')).toBe('a ~');
    });
});

describe('the table is internally consistent', () => {
    for (const id of PRESET_IDS) {
        describe(`preset: ${id}`, () => {
            const preset = PRESETS[id];

            it('binds only actions that exist', () => {
                for (const [mode, list] of Object.entries(preset.bindings)) {
                    for (const entry of list) {
                        expect(ACTIONS[entry.action], `${mode} ${entry.keys}`)
                            .toBeTruthy();
                    }
                }
            });

            it('binds every action in a mode that action declares', () => {
                for (const [mode, list] of Object.entries(preset.bindings)) {
                    if (mode === 'global') continue;
                    for (const entry of list) {
                        const modes = ACTIONS[entry.action].modes;
                        expect(modes.includes('*') || modes.includes(mode),
                            `${entry.action} bound in ${mode}, declares ${modes}`)
                            .toBe(true);
                    }
                }
            });

            it('never binds a browser- or OS-reserved chord', () => {
                for (const chord of allChords(id)) {
                    for (const part of chord.split(' ')) {
                        expect(RESERVED_CHORDS, `${chord} is reserved`)
                            .not.toContain(part);
                        expect(part).not.toMatch(/Meta/);
                        expect(part).not.toMatch(/^Cmd/);
                    }
                }
            });

            it('has no two bindings fighting over one chord in one list', () => {
                for (const [mode, list] of Object.entries(preset.bindings)) {
                    const seen = new Map();
                    for (const entry of list) {
                        for (const chord of expandKeys(entry.keys)) {
                            expect(seen.has(chord),
                                `${mode}: ${chord} bound to both ` +
                                `${seen.get(chord)} and ${entry.action}`).toBe(false);
                            seen.set(chord, entry.action);
                        }
                    }
                }
            });

            it('never binds a chord that is also a sequence prefix', () => {
                // `a` must not be an action if `a h` exists, or the
                // sequence can never be typed.
                for (const mode of ['normal', 'visual', 'annotation']) {
                    const { exact, prefixes } = lookup(id, mode);
                    for (const prefix of prefixes) {
                        expect(exact.has(prefix),
                            `${mode}: ${prefix} is both an action and a prefix`)
                            .toBe(false);
                    }
                }
            });

            it('puts every action in a known help group', () => {
                for (const { group } of describeBindings(id)) {
                    expect(GROUP_ORDER).toContain(group);
                }
            });

            it('lists its browser/OS exceptions', () => {
                expect(preset.exceptions.length).toBeGreaterThan(0);
            });
        });
    }

    it('reaches every action from at least one preset', () => {
        const bound = new Set();
        for (const id of PRESET_IDS) {
            for (const list of Object.values(PRESETS[id].bindings)) {
                for (const entry of list) bound.add(entry.action);
            }
        }
        const orphans = Object.keys(ACTIONS).filter(a => !bound.has(a));
        expect(orphans).toEqual([]);
    });

    it('defaults to TablEdit', () => {
        expect(DEFAULT_PRESET).toBe('tabledit');
    });
});

describe('describe() / keyFor()', () => {
    it('groups the bindings for the help overlay', () => {
        const groups = describeBindings('tabledit');
        expect(groups.length).toBeGreaterThan(4);
        const notes = groups.find(g => g.group === 'Notes');
        expect(notes.items.map(i => i.action)).toContain('note.fret');
    });

    it('hides alias bindings from the help', () => {
        const flat = describeBindings('tabledit').flatMap(g => g.items);
        const stringDown = flat.find(i => i.action === 'nav.stringDown');
        expect(stringDown.keys).toContain('↓');
        expect(stringDown.keys).not.toContain('j'); // the vim alias
    });

    it('answers with the preset-specific key for a menu item', () => {
        expect(keyFor('effect.tie', 'tabledit')).toBe('l');
        expect(keyFor('effect.tie', 'vim')).toBe('a ~');
        expect(keyFor('duration.auto', 'tabledit')).toBe('=');
        expect(keyFor('measure.repeatPrevious', 'tabledit')).toBe('r');
        expect(keyFor('measure.repeatPrevious', 'vim')).toBe('R');
    });

    it('returns null for an action the preset does not bind', () => {
        expect(keyFor('nope.not.a.thing', 'tabledit')).toBeNull();
    });
});

// A menu is read from wherever the user is STANDING, so a key bound in
// another mode is not the key they would press — `t` on Note ▸ Fingering
// is ANNOTATION's thumb, while NORMAL's `t` opens the placed-text
// popover and `m` writes a dead note (QA D3).
describe('menuKeyFor() — a key is only honest in its own mode', () => {
    it('prints a same-mode key bare, exactly as keyFor does', () => {
        expect(menuKeyFor('effect.clear', 'tabledit', 'normal')).toBe('n');
        expect(menuKeyFor('duration.auto', 'tabledit', 'normal')).toBe('=');
    });

    it('prints a global key bare in every mode', () => {
        for (const mode of ['normal', 'visual', 'annotation']) {
            expect(menuKeyFor('edit.undo', 'tabledit', mode)).toBe('Ctrl+z');
        }
    });

    it('qualifies an other-mode key with the way into that mode', () => {
        expect(menuKeyFor('finger.thumb', 'tabledit', 'normal')).toBe('A, t');
        expect(menuKeyFor('finger.middle', 'tabledit', 'normal')).toBe('A, m');
        // …and drops the qualifier once you are standing there
        expect(menuKeyFor('finger.thumb', 'tabledit', 'annotation')).toBe('t');
    });

    it('every chord it prints is a chord the preset really binds', () => {
        const bound = new Set();
        for (const list of Object.values(PRESETS.tabledit.bindings)) {
            for (const entry of list) bound.add(prettyKeys(entry.keys));
        }
        for (const action of Object.keys(ACTIONS)) {
            const printed = menuKeyFor(action, 'tabledit', 'normal');
            if (!printed) continue;
            for (const chord of printed.split(', ')) {
                expect(bound.has(chord), `${action} → ${chord}`).toBe(true);
            }
        }
    });

    it('vim binds fingering in NORMAL, so nothing is qualified there', () => {
        expect(menuKeyFor('finger.thumb', 'vim', 'normal')).toBe(prettyKeys('a t'));
    });

    it('still falls back to a hidden alias that is pressable HERE', () => {
        // vim advertises no Cut at all — `Ctrl+X` is its only binding,
        // and it is a hidden muscle-memory alias in NORMAL.
        expect(menuKeyFor('clip.cut', 'vim', 'normal')).toBe('Ctrl+x');
    });

    it('returns null for an action the preset does not bind', () => {
        expect(menuKeyFor('nope.not.a.thing', 'tabledit', 'normal')).toBeNull();
    });
});

describe('the help overlay is generated from the table', () => {
    for (const id of PRESET_IDS) {
        it(`advertises only bound keys (${id})`, () => {
            const html = OTFEditor.prototype._helpHtml(id);
            const host = document.createElement('div');
            host.innerHTML = html;

            const advertised = new Set(
                describeBindings(id).flatMap(g => g.items).flatMap(i => i.keys));
            const shown = [...host.querySelectorAll('kbd')].map(k => k.textContent);

            expect(shown.length).toBeGreaterThan(20);
            for (const key of shown) {
                expect(advertised, `<kbd>${key}</kbd> is not in the table`)
                    .toContain(key);
            }
        });

        it(`prints the browser/OS exceptions without <kbd> (${id})`, () => {
            const host = document.createElement('div');
            host.innerHTML = OTFEditor.prototype._helpHtml(id);
            const notes = host.querySelector('.editor-help-notes');
            expect(notes.querySelectorAll('kbd')).toHaveLength(0);
            expect(notes.textContent).toMatch(/Ctrl\+T|browser/i);
        });
    }

    it('offers a preset switcher with the active one checked', () => {
        const host = document.createElement('div');
        host.innerHTML = OTFEditor.prototype._helpHtml('vim');
        const radios = [...host.querySelectorAll('input[name="otf-preset"]')];
        expect(radios.map(r => r.value).sort()).toEqual(['tabledit', 'vim']);
        expect(radios.find(r => r.checked).value).toBe('vim');
    });
});

describe('FretEntry — the one fret-entry algorithm', () => {
    let fret;
    beforeEach(() => { fret = new FretEntry({ maxFret: 24, refineMs: Infinity }); });

    it('a lone digit is the fret', () => {
        expect(fret.digit(7)).toMatchObject({ kind: 'insert', fret: 7 });
    });

    it('opens a refine window only when the digit can prefix a real fret', () => {
        expect(fret.digit(1).refinable).toBe(true);
        expect(fret.digit(2).refinable).toBe(true);
        expect(fret.digit(3).refinable).toBe(false);
        expect(fret.digit(0).refinable).toBe(false);
    });

    it('a second digit refines the first in place', () => {
        const first = fret.digit(1);
        fret.remember({ fret: first.fret, measure: 1, tick: 0, string: 3 });
        const second = fret.digit(2);
        expect(second.kind).toBe('refine');
        expect(second.fret).toBe(12);
        expect(second.seed.tick).toBe(0);
    });

    it('starts fresh when the combination is past the neck', () => {
        fret.remember({ fret: 3 });
        expect(fret.digit(3)).toMatchObject({ kind: 'insert', fret: 3 });
    });

    it('f + two digits is one fret', () => {
        fret.armHighFret();
        expect(fret.isHighFret).toBe(true);
        expect(fret.digit(1)).toMatchObject({ kind: 'pending' });
        expect(fret.digit(5)).toMatchObject({ kind: 'insert', fret: 15 });
        expect(fret.isHighFret).toBe(false);
    });

    it('clamps a high fret to the neck', () => {
        fret.armHighFret();
        fret.digit(9);
        expect(fret.digit(9).fret).toBe(24);
    });

    it('times the window out when asked to', () => {
        vi.useFakeTimers();
        const timed = new FretEntry({ maxFret: 24, refineMs: 300 });
        timed.remember({ fret: 1 });
        vi.advanceTimersByTime(350);
        expect(timed.digit(2)).toMatchObject({ kind: 'insert', fret: 2 });
        vi.useRealTimers();
    });
});

describe('the active preset', () => {
    afterEach(() => resetPreset());

    it('defaults to tabledit', () => {
        resetPreset();
        expect(getPreset()).toBe('tabledit');
    });

    it('persists the choice and notifies listeners', () => {
        const seen = [];
        const off = onPresetChange(id => seen.push(id));
        setPreset('vim');
        expect(getPreset()).toBe('vim');
        expect(seen).toEqual(['vim']);
        expect(globalThis.localStorage.getItem('otf-editor.preset')).toBe('vim');
        off();
        setPreset('tabledit');
        expect(seen).toEqual(['vim']); // unsubscribed
    });

    it('ignores an unknown preset', () => {
        setPreset('emacs');
        expect(getPreset()).toBe('tabledit');
    });
});
