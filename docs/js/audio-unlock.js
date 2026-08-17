// iOS/Safari audio unlock. WebKit grants only TRANSIENT user activation for
// Web Audio: the context has to be constructed AND resumed inside the tap's
// own call stack. One `await` first (a CDN script, a soundfont fetch) and the
// context stays 'suspended' forever — its clock frozen near 0, so every
// scheduled note waits for a time that never arrives and playback is silent
// while the UI happily says it's playing. Everything here is therefore
// synchronous by design; nothing in this module may await.
//
// Second, separate iOS quirk: Web Audio lands in the "ambient" audio session,
// which the hardware ring/silent switch mutes. HTML5 <audio> is exempt, so
// playing a silent element (plus opting into the 'playback' session type where
// supported) promotes the session and keeps the switch out of it.

// 0.025s of 8-bit 8kHz silence — 244 bytes, enough to promote the session.
const SILENT_WAV = 'data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

let sessionPrimed = false;
let silentEl = null;

/**
 * Promote the page's audio session so the ringer switch doesn't mute us.
 * Idempotent and synchronous — safe to call from every gesture handler.
 */
export function primeAudioSession() {
    if (sessionPrimed) return;
    sessionPrimed = true;

    // Safari 16.4+ / Chrome: declare intent directly.
    try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {
        // read-only or unsupported value — the silent element below still helps
    }

    if (typeof Audio !== 'function') return;
    try {
        silentEl = new Audio(SILENT_WAV);
        silentEl.setAttribute('playsinline', '');
        silentEl.volume = 0.01;
        silentEl.play()?.catch(() => { /* no activation to spend; harmless */ });
    } catch (e) {
        silentEl = null;
    }
}

/**
 * Resume an AudioContext from inside a user gesture. Fires resume() without
 * awaiting anything first — awaiting is exactly what loses the activation.
 *
 * @param {AudioContext} ctx
 * @returns {AudioContext} the same context, for chaining
 */
export function unlockAudioContext(ctx) {
    if (!ctx) return ctx;
    primeAudioSession();
    if (ctx.state === 'suspended') {
        try {
            ctx.resume()?.catch(err => console.warn('AudioContext resume failed:', err));
        } catch (e) {
            console.warn('AudioContext resume threw:', e);
        }
    }
    return ctx;
}
