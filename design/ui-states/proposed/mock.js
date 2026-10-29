// Shared bits for the proposed-state mockups: theme from ?theme=, the top
// band, the "proposed" tab, and a tiny ChordPro-ish chart renderer so each
// page can write `[A]It's been ten long [C#7]years` instead of markup.
// A classic script, not a module: the mockups are opened from file://, where
// module scripts are blocked.
(() => {
const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';

const id = document.body.dataset.proposal;
const back = document.body.dataset.back;
document.body.insertAdjacentHTML('afterbegin', `
<div class="proposed-tab">Proposed${id ? ' · ' + id : ''}</div>
<header class="top">
    ${back ? `<span class="phone-only">&larr;</span>` : ''}
    <span class="brand">BB</span>
    <span class="nav">Search</span>
    <span class="nav">Add Song</span>
    <span class="nav">Favorites</span>
    <span class="nav here">Lists</span>
    <span class="spacer"></span>
    <span class="who">MB</span>
</header>`);

// Mirrors chordGlyphHtml() in docs/js/chords.js, the book's chord engraving:
// superscript extensions, ♯ ♭, ° ø + (C#7 -> C♯⁷, Asus4 -> A^sus4, F#m7b5 -> F♯ø⁷,
// D/F# -> D with a smaller /F♯). Copied, not imported: these pages open from
// file://, where module imports are blocked. Display only.
const GLYPH_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const glyphEsc = (s) => String(s).replace(/[&<>"]/g, (c) => GLYPH_ESC[c]);
const accGlyph = (a) => a === '#' ? '<span class="acc">♯</span>'
    : a === 'b' ? '<span class="acc flat">♭</span>' : '';
const extGlyph = (t) => glyphEsc(t === '69' ? '6⁄9' : t)
    .replace(/b(\d)/g, (_, d) => `${accGlyph('b')}${d}`)
    .replace(/#(\d)/g, (_, d) => `${accGlyph('#')}${d}`);
window.chordGlyph = (symbol) => {
    const text = String(symbol ?? '');
    const m = text.match(/^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/);
    if (!m) return glyphEsc(text);
    const [, r, a, qual, bass, bassAcc] = m;
    let q = qual, minor = '', plus = '';
    if (/^m(?!aj)/.test(q)) { minor = 'm'; q = q.slice(1); }
    let sup = q;
    if (minor && sup === '7b5') { minor = ''; sup = 'ø7'; }
    else if (sup === 'dim') sup = '°';
    else if (sup === 'dim7') sup = '°7';
    else if (sup === 'aug') { sup = ''; plus = '+'; }
    const supHtml = extGlyph(sup);
    const inner = `${r}${accGlyph(a)}${minor}${plus}${supHtml ? `<sup>${supHtml}</sup>` : ''}`
        + `${bass ? `<span class="bass">/${bass}${accGlyph(bassAcc)}</span>` : ''}`;
    return inner.includes('<') ? `<span class="cg">${inner}</span>` : inner;
};

const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function renderLine(line) {
    // Split into [chord]lyric segments; a segment with no chord gets a blank
    // chord row so the lyric baselines line up.
    const parts = line.split(/(\[[^\]]+\])/).filter(Boolean);
    const segs = [];
    let chord = '';
    for (const part of parts) {
        if (part.startsWith('[')) {
            if (chord) segs.push([chord, '']);
            chord = part.slice(1, -1);
        } else {
            segs.push([chord, part]);
            chord = '';
        }
    }
    if (chord) segs.push([chord, '']);
    return `<div class="line">${segs.map(([c, t]) =>
        `<span class="seg"><span class="ch">${esc(c)}</span><span>${esc(t) || ' '}</span></span>`).join('')}</div>`;
}

for (const el of document.querySelectorAll('script[type="text/chart"]')) {
    const html = el.textContent.trim().split('\n').map((raw) => {
        const line = raw.trim();
        if (!line) return '';
        if (line.startsWith('#')) return `<div class="sec">${esc(line.slice(1).trim())}</div>`;
        return renderLine(line);
    }).join('');
    const chart = document.createElement('div');
    chart.className = `chart ${el.dataset.class || ''}`;
    chart.innerHTML = html;
    el.replaceWith(chart);
}
})();
