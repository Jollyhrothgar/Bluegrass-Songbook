#!/usr/bin/env node
// Screenshot (or open) the states in ./states.js.
//
//   node design/ui-states/capture.js                 # every state, 4 shots each
//   node design/ui-states/capture.js list-view tab-editor
//   node design/ui-states/capture.js --group Lists
//   node design/ui-states/capture.js --open list-view            # a real window
//   node design/ui-states/capture.js --open list-view --phone --dark
//
// Output: design/ui-states/shots/<id>--<phone|desktop>-<light|dark>.png and
// shots/index.html (a gallery). `shots/` is gitignored: it is build output,
// regenerate it whenever the UI changes.
//
// The backend is the e2e Supabase mock, so nothing here talks to production.
// The server is `./scripts/server <port> --exact` on UI_STATES_PORT (default
// 8139); set UI_STATES_PORT to a port you already serve to reuse it.
//
// Needs `./scripts/bootstrap --quick` (site data) and `npm ci` first.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mockSupabase } from '../../e2e/helpers/supabase-mock.js';
import { STATES, THEMES, VIEWPORTS } from './states.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SHOTS = path.join(HERE, 'shots');
const PORT = Number(process.env.UI_STATES_PORT) || 8139;
const BASE = `http://localhost:${PORT}`;

// ── arguments ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
};
const openId = valueOf('--open');
const group = valueOf('--group');
const ids = args.filter((a, i) => !a.startsWith('--') && !['--open', '--group'].includes(args[i - 1]));

function selectStates() {
    if (openId) return STATES.filter(s => s.id === openId);
    let picked = STATES;
    if (group) picked = picked.filter(s => s.group.toLowerCase().startsWith(group.toLowerCase()));
    if (ids.length) picked = picked.filter(s => ids.includes(s.id));
    return picked;
}

// ── server ─────────────────────────────────────────────────────────────

const portOpen = () => new Promise((resolve) => {
    const socket = net.connect(PORT, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
});

// scripts/server is a shell script that starts Python: kill the whole process
// group, or the Python child keeps the port after we exit.
function stopServer(server) {
    if (!server?.pid) return;
    try { process.kill(-server.pid); } catch { /* already gone */ }
}

async function startServer() {
    if (await portOpen()) {
        if (!process.env.UI_STATES_PORT) {
            throw new Error(`Port ${PORT} is already in use. Stop that server, or set UI_STATES_PORT=${PORT} to say it is yours.`);
        }
        return null;
    }
    const server = spawn('./scripts/server', [String(PORT), '--exact'], { cwd: REPO, stdio: 'ignore', detached: true });
    for (let i = 0; i < 100; i++) {
        if (await portOpen()) return server;
        await new Promise(r => setTimeout(r, 100));
    }
    stopServer(server);
    throw new Error(`The dev server did not come up on ${PORT}.`);
}

// ── one state ──────────────────────────────────────────────────────────

const targetUrl = (state) => state.proposed
    ? pathToFileURL(path.join(HERE, state.url)).href
    : BASE + state.url;

async function openState(browser, state, viewportName, theme) {
    const context = await browser.newContext({
        ...VIEWPORTS[viewportName],
        colorScheme: theme,
        reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const phone = viewportName === 'phone';

    if (state.proposed) {
        await page.goto(`${targetUrl(state)}?theme=${theme}`);
        await page.evaluate(() => document.fonts.ready);
        return { context, page };
    }

    await mockSupabase(page, { signedIn: false, ...(state.mock || {}) });
    // Seed once: an init script runs on every navigation, and a state that
    // reloads must keep what the app wrote since.
    await page.addInitScript(([entries, themeName]) => {
        if (localStorage.getItem('ui-state-seeded')) return;
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
        localStorage.setItem('theme', themeName);
        localStorage.setItem('ui-state-seeded', '1');
    }, [state.seed || {}, theme]);

    await page.goto(targetUrl(state));
    await page.locator(state.ready).first().waitFor({ timeout: 30000 });
    if (state.setup) await state.setup(page, { phone });
    await page.evaluate(() => document.fonts.ready);
    // Late arrivals: the Supabase overlay grace period, lazy images, the
    // archive merge. Long enough to settle, short enough to run 150 times.
    await page.waitForTimeout(1200);
    return { context, page };
}

// ── gallery ────────────────────────────────────────────────────────────

const shotName = (state, viewportName, theme) => `${state.id}--${viewportName}-${theme}.png`;

function galleryHtml(states, failures) {
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const groups = [...new Set(states.map(s => s.group))];
    const section = (name) => {
        const cards = states.filter(s => s.group === name).map((s) => {
            const shots = Object.keys(VIEWPORTS).flatMap(v => THEMES.map((t) => {
                const file = shotName(s, v, t);
                if (failures.has(file)) return `<figure class="${v} missing"><figcaption>${v} · ${t}: not captured</figcaption></figure>`;
                return `<figure class="${v}"><a href="${file}"><img loading="lazy" src="${file}" alt="${esc(s.title)}, ${v}, ${t}"></a><figcaption>${v} · ${t}</figcaption></figure>`;
            })).join('');
            const where = s.proposed ? `mockup: ${esc(s.url)}` : esc(s.url);
            return `<article id="${s.id}"><h3>${esc(s.title)}${s.proposed ? ' <em>proposed</em>' : ''}</h3>
<p><code>${s.id}</code> · <code>${where}</code> · ${esc((s.workshop || []).join(', '))}</p>
<div class="shots">${shots}</div></article>`;
        }).join('\n');
        return `<section><h2>${esc(name)}</h2>${cards}</section>`;
    };
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bluegrass Book UI states</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f4f4f2;color:#1b1b1b}
h1{margin:0 0 4px}h2{margin:40px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
h3{margin:28px 0 2px}h3 em{font:600 11px system-ui;text-transform:uppercase;letter-spacing:.06em;background:#e7d9a8;padding:2px 6px;border-radius:3px;vertical-align:middle}
p{margin:0 0 10px;color:#555}code{font-size:13px}
.shots{display:flex;gap:16px;align-items:flex-start;overflow-x:auto;padding-bottom:8px}
figure{margin:0;flex:none}figure.phone{width:195px}figure.desktop{width:560px}
figure img{width:100%;display:block;border:1px solid #bbb;border-radius:4px}
figure.missing{border:1px dashed #b55;border-radius:4px;padding:24px 8px;color:#b55}
figcaption{font-size:12px;color:#666;margin-top:4px}
nav a{margin-right:12px}
</style></head><body>
<h1>Bluegrass Book UI states</h1>
<p>Generated by <code>design/ui-states/capture.js</code>. Click a shot for full size. See README.md for how to open a state live.</p>
<nav>${groups.map(g => `<a href="#g-${esc(g)}">${esc(g)}</a>`).join('')}</nav>
${groups.map(g => `<div id="g-${esc(g)}">${section(g)}</div>`).join('\n')}
</body></html>`;
}

// ── main ───────────────────────────────────────────────────────────────

async function main() {
    const states = selectStates();
    if (!states.length) {
        console.error(`No such state. Known ids:\n  ${STATES.map(s => s.id).join('\n  ')}`);
        process.exit(1);
    }
    const needsServer = states.some(s => !s.proposed);
    const server = needsServer ? await startServer() : null;
    const stop = () => stopServer(server);
    process.on('exit', stop);

    if (openId) {
        const browser = await chromium.launch({ headless: false });
        const { page } = await openState(browser, states[0], flag('--phone') ? 'phone' : 'desktop', flag('--dark') ? 'dark' : 'light');
        console.log(`Open: ${states[0].title}\n  ${page.url()}\nClose the window to finish.`);
        await new Promise(resolve => browser.on('disconnected', resolve));
        stop();
        return;
    }

    await mkdir(SHOTS, { recursive: true });
    const browser = await chromium.launch();
    const failures = new Map();
    for (const state of states) {
        for (const viewportName of Object.keys(VIEWPORTS)) {
            for (const theme of THEMES) {
                const file = shotName(state, viewportName, theme);
                let context;
                try {
                    const opened = await openState(browser, state, viewportName, theme);
                    context = opened.context;
                    await opened.page.screenshot({ path: path.join(SHOTS, file) });
                    console.log(`ok    ${file}`);
                } catch (e) {
                    failures.set(file, e.message.split('\n')[0]);
                    console.log(`FAIL  ${file}: ${e.message.split('\n')[0]}`);
                } finally {
                    await context?.close();
                }
            }
        }
    }
    await browser.close();
    stop();

    // The gallery always lists every state, so a partial run does not drop
    // the rest from the page (their files are still on disk from before).
    await writeFile(path.join(SHOTS, 'index.html'), galleryHtml(STATES, failures));
    console.log(`\n${states.length} state(s), ${failures.size} failed shot(s). Gallery: ${path.relative(REPO, path.join(SHOTS, 'index.html'))}`);
    if (failures.size) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
