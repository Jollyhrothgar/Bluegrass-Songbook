// @vitest-environment jsdom
// escapeHtml is not an attribute escape.
//
// utils.js `escapeHtml` builds its result with textContent → innerHTML,
// which escapes & < > and leaves QUOTES alone. That is right for a text
// node and a hole in `attr="${...}"`, where a `"` closes the value and the
// rest of the string is parsed as markup. The track mixer interpolates
// track ids — which come out of user-submitted OTF documents — into both
// positions, so it needs both escapes.
import { describe, it, expect } from 'vitest';

import { escapeAttr, escapeHtml } from '../utils.js';

const HOSTILE = 'x" onfocus="alert(1)" autofocus="';

describe('escapeAttr', () => {
    it('escapes the quotes escapeHtml leaves alone', () => {
        expect(escapeHtml(HOSTILE)).toContain('"');        // the hole
        expect(escapeAttr(HOSTILE)).not.toContain('"');
        expect(escapeAttr(`it's`)).not.toContain(`'`);
    });

    it('still escapes what escapeHtml escapes', () => {
        expect(escapeAttr('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
    });

    it('a hostile track id stays a VALUE in the mixer markup', () => {
        // The exact shape createTablatureControls builds.
        const html = `<label class="track-toggle" title="${escapeAttr(HOSTILE)}">
            <input type="checkbox" class="track-checkbox" data-track-id="${escapeAttr(HOSTILE)}">
            <span class="track-name">${escapeHtml(HOSTILE)}</span></label>`;
        const host = document.createElement('div');
        host.innerHTML = html;

        const input = host.querySelector('input');
        expect(input.getAttribute('data-track-id')).toBe(HOSTILE);
        expect(input.hasAttribute('onfocus')).toBe(false);
        expect(input.hasAttribute('autofocus')).toBe(false);
        expect(host.querySelector('label').getAttribute('title')).toBe(HOSTILE);
        // The label is the id verbatim, escaped only for transport
        expect(host.querySelector('.track-name').textContent).toBe(HOSTILE);
    });

    it('the same id unescaped WOULD have broken out (regression guard)', () => {
        const host = document.createElement('div');
        host.innerHTML = `<input data-track-id="${escapeHtml(HOSTILE)}">`;
        expect(host.querySelector('input').hasAttribute('onfocus')).toBe(true);
    });
});
