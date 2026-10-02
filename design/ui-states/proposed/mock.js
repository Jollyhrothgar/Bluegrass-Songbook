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
