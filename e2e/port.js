// The port E2E serves this worktree on. Paseo runs several worktrees at once,
// so each gets its own port, derived from the worktree's path: two worktrees
// can run E2E side by side, and a rerun in one worktree reuses its port. The
// range (20000-29999) is outside the 8080-8090 dev range, so a test never
// lands on a dev server by mistake.
//
// PW_PORT=<port> overrides it and also means "I'm running the server on that
// port myself" (playwright.config.js turns on reuseExistingServer).
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function portForPath(path) {
    let h = 0;
    for (const ch of path) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
    return 20000 + (h % 10000);
}

export const E2E_PORT = Number(process.env.PW_PORT) || portForPath(root);
