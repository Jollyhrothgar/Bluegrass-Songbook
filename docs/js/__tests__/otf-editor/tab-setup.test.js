// G20b: Score ▸ Tab setup… — the vocabulary (presets, pitches, the form's values)
// and the panel. The rules behind Apply are the facade's: tab-setup-facade.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    TabSetupPopover, TUNING_PRESETS, TIME_SIGNATURES, INSTRUMENT_LABELS,
    presetsFor, presetNameFor, parsePitch, parseTuning, readSetup,
} from '../../otf-editor/tab-setup.js';
import { INSTRUMENT_CONFIGS } from '../../otf-editor/new-otf.js';
import { BANJO_TUNINGS, MANDOLIN_TUNINGS, GUITAR_TUNINGS, detectTuningName } from '../../renderers/tablature.js';
import { pitchToMidi } from '../../otf-editor/pitch.js';

describe('parsePitch', () => {
    it('reads a note name and octave as the file spells it', () => {
        expect(parsePitch('G3')).toBe('G3');
        expect(parsePitch(' g3 ')).toBe('G3');
        expect(parsePitch('F#4')).toBe('F#4');
        expect(parsePitch('f♯4')).toBe('F#4');
    });
    it('turns a flat into the sharp the file uses', () => {
        expect(parsePitch('Bb3')).toBe('A#3');
        expect(parsePitch('Db4')).toBe('C#4');
        expect(parsePitch('Cb4')).toBe('B3');
    });
    it('refuses anything else', () => {
        for (const bad of ['', 'G', '3', 'H4', 'G10', 'G#', 'E#4x', 'G -1', null, undefined]) {
            expect(parsePitch(bad)).toBeNull();
        }
    });
});

describe('parseTuning', () => {
    it('returns the pitches, normalised', () => {
        expect(parseTuning(['d4', 'B3', 'g3', 'D3', 'G4'])).toEqual({ pitches: ['D4', 'B3', 'G3', 'D3', 'G4'] });
    });
    it('names the first string that is not a note', () => {
        expect(parseTuning(['D4', 'B3', 'H3']).error).toBe(
            'String 3: "H3" is not a note. Use a note name and octave, like G3 or F#4.');
    });
    it('names a string a .tef cannot hold', () => {
        expect(parseTuning(['D4', 'C8']).error).toBe('String 2: C8 is out of range. Use a note from C0 to F#6.');
    });
});

describe('tuning presets', () => {
    it('every preset is valid pitches, and the first is the instrument\'s standard', () => {
        for (const [instrument, list] of Object.entries(TUNING_PRESETS)) {
            expect(list[0][1]).toEqual(INSTRUMENT_CONFIGS[instrument].tuning);
            for (const [name, pitches] of list) {
                expect(pitches.every(p => pitchToMidi(p) !== null), `${instrument} ${name}`).toBe(true);
                expect(parseTuning(pitches).error, `${instrument} ${name}`).toBeUndefined();
                // strings run high to low, except a banjo's short fifth
                const midi = pitches.map(pitchToMidi);
                const body = instrument === '5-string-banjo' ? midi.slice(0, 4) : midi;
                expect(body.every((m, i) => i === 0 || m <= body[i - 1]), `${instrument} ${name}`).toBe(true);
            }
        }
    });

    it('every name is one the renderer already prints, or the plain "Standard"', () => {
        const table = {
            '5-string-banjo': BANJO_TUNINGS, mandolin: MANDOLIN_TUNINGS, '6-string-guitar': GUITAR_TUNINGS,
        };
        for (const [instrument, list] of Object.entries(TUNING_PRESETS)) {
            const known = new Set(Object.values(table[instrument] || {}));
            for (const [name] of list) {
                if (!table[instrument] && ['Standard', 'Open G'].includes(name)) continue;
                expect(known.has(name), `${instrument}: ${name}`).toBe(true);
            }
        }
    });

    it('where the renderer\'s letters are the real tuning, the stave header says the same name', () => {
        const agree = [
            ['5-string-banjo', 'Open G'], ['5-string-banjo', 'Double C'], ['5-string-banjo', 'G Modal'],
            ['mandolin', 'Standard'], ['mandolin', 'Cross-key'],
            ['6-string-guitar', 'Standard'], ['6-string-guitar', 'Open G'],
        ];
        for (const [instrument, name] of agree) {
            const preset = presetsFor(instrument).find(p => p.name === name);
            expect(detectTuningName(preset.pitches, instrument).name, `${instrument} ${name}`).toBe(name);
        }
    });

    it('presetNameFor recognises a preset and says null for anything else', () => {
        expect(presetNameFor('5-string-banjo', ['D4', 'B3', 'G3', 'D3', 'G4'])).toBe('Open G');
        expect(presetNameFor('5-string-banjo', ['D4', 'C4', 'G3', 'C3', 'G4'])).toBe('Double C');
        expect(presetNameFor('5-string-banjo', ['D4', 'B3', 'G3', 'D3', 'A4'])).toBeNull();
        expect(presetNameFor('fiddle', ['E5', 'A4', 'D4', 'G3'])).toBeNull();
    });

    it('presetsFor hands out copies', () => {
        presetsFor('mandolin')[0].pitches[0] = 'C1';
        expect(presetsFor('mandolin')[0].pitches[0]).toBe('E5');
    });

    it('the panel\'s instruments are exactly the editor\'s presets', () => {
        expect(Object.keys(INSTRUMENT_LABELS).sort()).toEqual(Object.keys(INSTRUMENT_CONFIGS).sort());
    });
});

describe('readSetup', () => {
    const opening = {
        title: 'T', composer: '', key: 'G', timeSignature: '4/4', tempo: '100',
        instrument: 'mandolin', capo: '0', pitches: ['E5', 'A4', 'D4', 'G3'],
    };
    it('sends only what differs from what the panel opened with', () => {
        expect(readSetup(opening, opening).setup).toEqual({});
        expect(readSetup({ ...opening, timeSignature: '3/4', capo: '2' }, opening).setup)
            .toEqual({ timeSignature: '3/4', track: { capo: 2 } });
        expect(readSetup({ ...opening, pitches: ['E5', 'A4', 'D4', 'A3'] }, opening).setup)
            .toEqual({ track: { tuning: ['E5', 'A4', 'D4', 'A3'] } });
        expect(readSetup({ ...opening, title: 'U', key: '' }, opening).setup).toEqual({ title: 'U', key: '' });
    });
    it('does not check a field that was not touched (a tempo of 300, a capo of 14, a flat)', () => {
        const odd = { ...opening, tempo: '300', capo: '14', pitches: ['E5', 'Bb4', 'D4', 'G3'] };
        expect(readSetup({ ...odd, title: 'Renamed' }, odd).setup).toEqual({ title: 'Renamed' });
        expect(readSetup({ ...odd, timeSignature: '3/4' }, odd).setup).toEqual({ timeSignature: '3/4' });
        const none = { ...opening, tempo: '' };
        expect(readSetup({ ...none, capo: '1' }, none).setup).toEqual({ track: { capo: 1 } });
    });
    it('still holds what the person types to the limits', () => {
        expect(readSetup({ ...opening, tempo: '20' }, opening).error).toBe('The tempo is a whole number from 40 to 280.');
        expect(readSetup({ ...opening, tempo: '300' }, opening).error).toMatch(/tempo/);
        expect(readSetup({ ...opening, tempo: '' }, opening).error).toMatch(/tempo/);
        expect(readSetup({ ...opening, capo: '13' }, opening).error).toBe('The capo is a whole number from 0 to 12.');
        expect(readSetup({ ...opening, capo: '1.5' }, opening).error).toMatch(/capo/);
        expect(readSetup({ ...opening, pitches: ['E5', 'A4', 'X', 'G3'] }, opening).error).toMatch(/^String 3/);
    });
    it('leaves the track out for a drum track', () => {
        const drums = { ...opening, instrument: undefined, capo: undefined, pitches: [] };
        expect(readSetup({ ...drums, tempo: '90' }, drums, { percussion: true }).setup).toEqual({ tempo: 90 });
    });
});

describe('TabSetupPopover', () => {
    let container, panel, onClose, session;
    const $ = (sel) => panel.element.querySelector(sel);
    const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const pick = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
    const pitches = () => [...panel.element.querySelectorAll('.tab-setup-pitch')].map(e => e.value);
    const keyEvent = (key) => new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

    const banjoSession = (over = {}) => ({
        meta: { title: 'Cripple Creek', composer: 'Trad.', key: 'A', timeSignature: '4/4', tempo: 110, changes: [] },
        track: {
            id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'], capo: 0,
            percussion: false, noteCount: 12,
        },
        apply: vi.fn(() => ({})),
        ...over,
    });

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        document.body.appendChild(container);
        onClose = vi.fn();
        panel = new TabSetupPopover({ onClose });
        panel.init(container);
        session = banjoSession();
    });
    afterEach(() => panel.destroy());

    it('shows the whole tab and the current track, named', () => {
        panel.open(session);
        expect($('.tab-setup-title').value).toBe('Cripple Creek');
        expect($('.tab-setup-composer').value).toBe('Trad.');
        expect($('.tab-setup-key').value).toBe('A');
        expect($('.tab-setup-time').value).toBe('4/4');
        expect($('.tab-setup-tempo').value).toBe('110');
        expect($('.tab-setup-track legend').textContent).toBe('Track: banjo');
        expect($('.tab-setup-instrument').value).toBe('5-string-banjo');
        expect($('.tab-setup-tuning').value).toBe('Open G');
        expect(pitches()).toEqual(['D4', 'B3', 'G3', 'D3', 'G4']);
        expect($('.tab-setup-capo').value).toBe('0');
        expect(panel.element.getAttribute('role')).toBe('dialog');
    });

    it('offers the time signatures, and a file\'s own odd one too', () => {
        panel.open(session);
        expect([...panel.element.querySelectorAll('.tab-setup-time option')].map(o => o.value)).toEqual(TIME_SIGNATURES);
        panel.open(banjoSession({ meta: { ...session.meta, timeSignature: '5/4' } }));
        expect($('.tab-setup-time').value).toBe('5/4');
        expect($('.tab-setup-time option').value).toBe('5/4');
    });

    it('says the notes keep their frets, only when the track has notes', () => {
        panel.open(session);
        expect($('.tab-setup-keeps').textContent).toMatch(/keeps its string and fret/);
        panel.open(banjoSession({ track: { ...session.track, noteCount: 0 } }));
        expect($('.tab-setup-keeps')).toBeNull();
    });

    it('says which measures keep their own time signature', () => {
        panel.open(banjoSession({ meta: { ...session.meta, changes: [9, 17] } }));
        expect($('.tab-setup-changes').textContent).toBe(
            'The time signature changes at measures 9, 17 stay as they are.');
        panel.open(banjoSession({ meta: { ...session.meta, changes: [3] } }));
        expect($('.tab-setup-changes').textContent).toContain('at measure 3 stay');
    });

    it('Apply hands the form over, and closes when it worked', () => {
        panel.open(session);
        type($('.tab-setup-title'), 'Cripple Creek (slow)');
        pick($('.tab-setup-time'), '3/4');
        type($('.tab-setup-capo'), '2');
        pick($('.tab-setup-tuning'), 'Double C');
        expect(pitches()).toEqual(['D4', 'C4', 'G3', 'C3', 'G4']);
        $('.apply-btn').click();
        expect(session.apply).toHaveBeenCalledWith({
            title: 'Cripple Creek (slow)', timeSignature: '3/4',
            track: { tuning: ['D4', 'C4', 'G3', 'C3', 'G4'], capo: 2 },
        });
        expect(panel.opened).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a refusal stays in the panel as a sentence, and the panel stays open', () => {
        const sentence = 'This tuning has 4 strings, but 2 notes are on string 5; the first is in measure 2. Move or delete them first.';
        session.apply = vi.fn(() => ({ error: sentence }));
        panel.open(session);
        type($('.tab-setup-capo'), '1');
        $('.apply-btn').click();
        expect($('.tab-setup-error').textContent).toBe(sentence);
        expect(panel.opened).toBe(true);
        type($('.tab-setup-title'), 'x');                       // typing again clears it
        expect($('.tab-setup-error').textContent).toBe('');
    });

    it('a pitch that is not a note is a sentence and nothing is applied', () => {
        panel.open(session);
        type(panel.element.querySelectorAll('.tab-setup-pitch')[2], 'Q9');
        $('.apply-btn').click();
        expect($('.tab-setup-error').textContent).toMatch(/^String 3: "Q9" is not a note/);
        expect(session.apply).not.toHaveBeenCalled();
    });

    it('typing in a pitch box turns the tuning to Custom, and back to a name when it matches', () => {
        panel.open(session);
        const second = () => panel.element.querySelectorAll('.tab-setup-pitch')[1];
        type(second(), 'A3');
        expect($('.tab-setup-tuning').value).toBe('custom');
        expect($('.tab-setup-tuning').selectedOptions[0].textContent).toBe('Custom');
        type(second(), 'B3');
        expect($('.tab-setup-tuning').value).toBe('Open G');
    });

    it('a flat or lower-case pitch is accepted and written the way the file spells it', () => {
        panel.open(session);
        type(panel.element.querySelectorAll('.tab-setup-pitch')[1], 'bb3');
        $('.apply-btn').click();
        expect(session.apply.mock.calls[0][0].track).toEqual({ tuning: ['D4', 'A#3', 'G3', 'D3', 'G4'] });
    });

    it('choosing another instrument brings its standard tuning; choosing the old one back restores the tuning', () => {
        panel.open(session);
        pick($('.tab-setup-instrument'), 'mandolin');
        expect([...panel.element.querySelectorAll('.tab-setup-tuning option')].map(o => o.textContent))
            .toEqual(['Standard', 'Cross-key', 'DADA', 'Custom']);
        expect(pitches()).toEqual(['E5', 'A4', 'D4', 'G3']);
        pick($('.tab-setup-instrument'), '5-string-banjo');
        expect(pitches()).toEqual(['D4', 'B3', 'G3', 'D3', 'G4']);
        expect($('.tab-setup-tuning').value).toBe('Open G');
    });

    it('a tuning no preset names opens as Custom, with its strings in the boxes', () => {
        panel.open(banjoSession({ track: { ...session.track, tuning: ['D4', 'A3', 'F#3', 'A3', 'E4'] } }));
        expect($('.tab-setup-tuning').value).toBe('custom');
        expect(pitches()).toEqual(['D4', 'A3', 'F#3', 'A3', 'E4']);
    });

    it('an instrument the editor has no preset for is kept, listed, and offers only Custom', () => {
        const fiddle = banjoSession({ track: { ...session.track, instrument: 'fiddle', tuning: ['E5', 'A4', 'D4', 'G3'] } });
        panel.open(fiddle);
        expect($('.tab-setup-instrument').value).toBe('fiddle');
        expect($('.tab-setup-tuning').value).toBe('custom');
        pick($('.tab-setup-instrument'), 'mandolin');
        $('.apply-btn').click();
        expect(fiddle.apply.mock.calls[0][0].track).toMatchObject({ instrument: 'mandolin' });
    });

    it('a drum track has no instrument, tuning or capo to set', () => {
        const drums = banjoSession({ track: { id: 'percussion', instrument: 'percussion', tuning: [], capo: 0, percussion: true, noteCount: 3 } });
        panel.open(drums);
        expect($('.tab-setup-tuning')).toBeNull();
        expect($('.tab-setup-track').textContent).toContain('A drum track has no instrument, tuning or capo.');
        type($('.tab-setup-tempo'), '90');
        $('.apply-btn').click();
        expect(drums.apply).toHaveBeenCalledTimes(1);
        expect(drums.apply.mock.calls[0][0]).toEqual({ tempo: 90 });
    });

    it('Enter applies, Escape closes, and the keys do not reach the editor', () => {
        panel.open(session);
        const outer = vi.fn();
        container.addEventListener('keydown', outer);
        type($('.tab-setup-title'), 'Changed');
        $('.tab-setup-title').dispatchEvent(keyEvent('Enter'));
        expect(session.apply).toHaveBeenCalled();
        panel.open(session);
        $('.tab-setup-title').dispatchEvent(keyEvent('x'));
        panel.element.dispatchEvent(keyEvent('Escape'));
        expect(panel.opened).toBe(false);
        expect(outer).not.toHaveBeenCalled();
    });

    it('an Apply with nothing changed closes and applies nothing', () => {
        panel.open(session);
        $('.apply-btn').click();
        expect(session.apply).not.toHaveBeenCalled();
        expect(panel.opened).toBe(false);
    });

    it('a file the form would refuse (tempo 300, capo 14) still takes a change to something else', () => {
        const odd = banjoSession({
            meta: { ...session.meta, tempo: 300 },
            track: { ...session.track, capo: 14 },
        });
        panel.open(odd);
        type($('.tab-setup-title'), 'Renamed');
        $('.apply-btn').click();
        expect(odd.apply).toHaveBeenCalledWith({ title: 'Renamed' });
        panel.open(odd);
        type($('.tab-setup-tempo'), '400');            // a value the person types is held to the limit
        $('.apply-btn').click();
        expect($('.tab-setup-error').textContent).toMatch(/tempo/);
    });

    it('Cancel closes without applying', () => {
        panel.open(session);
        $('.cancel-btn').click();
        expect(session.apply).not.toHaveBeenCalled();
        expect(panel.opened).toBe(false);
    });

    it('is a bottom sheet at phone width (the rule is in the sheet\'s CSS)', () => {
        panel.init(container);   // a second init must not add the style twice
        const css = document.querySelectorAll('style[data-otf-tab-setup]');
        expect(css).toHaveLength(1);
        expect(css[0].textContent).toMatch(/@media \(max-width: 640px\)[\s\S]*align-items: flex-end/);
    });

    it('escapes what the file says (a title is not markup)', () => {
        panel.open(banjoSession({ meta: { ...session.meta, title: '"><img src=x onerror=alert(1)>' } }));
        expect(panel.element.querySelector('img')).toBeNull();
        expect($('.tab-setup-title').value).toBe('"><img src=x onerror=alert(1)>');
    });
});
