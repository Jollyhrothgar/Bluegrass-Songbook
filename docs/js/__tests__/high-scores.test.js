// @vitest-environment jsdom
// High Scores (#174) — the contribution leaderboard.
//
// There is deliberately NO alias/anonymization logic to test here: every
// identity decision happens inside the `get_leaderboard()` definer function
// (supabase/migrations/20260816120000_leaderboard.sql), and the RPC hands
// back an already-resolved `display` string with no email or uuid attached.
// These tests cover the presentation contract instead — medal assignment,
// the songs/tabs breakdown, the is_you highlight, and the empty/error states
// — plus the fact that the view renders for a signed-out visitor at all,
// which is what makes the board public.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    medalFor, breakdownText, buildScoreRows, scoreRowHtml, renderHighScoresView,
} from '../high-scores.js';

describe('medalFor', () => {
    it('assigns gold/silver/bronze to the top three', () => {
        expect(medalFor(1)).toBe('gold');
        expect(medalFor(2)).toBe('silver');
        expect(medalFor(3)).toBe('bronze');
    });

    it('gives nothing to fourth place and below', () => {
        expect(medalFor(4)).toBeNull();
        expect(medalFor(97)).toBeNull();
    });

    it('gives nothing for a missing/zero rank', () => {
        expect(medalFor(0)).toBeNull();
        expect(medalFor(undefined)).toBeNull();
    });
});

describe('breakdownText', () => {
    it('joins both halves when both are non-zero', () => {
        expect(breakdownText({ songs: 3, tabs: 2 })).toBe('3 songs · 2 tabs');
    });

    it('singularizes a count of one', () => {
        expect(breakdownText({ songs: 1, tabs: 1 })).toBe('1 song · 1 tab');
    });

    it('drops a zero half rather than printing "0 tabs"', () => {
        expect(breakdownText({ songs: 4, tabs: 0 })).toBe('4 songs');
        expect(breakdownText({ songs: 0, tabs: 4 })).toBe('4 tabs');
    });

    it('is empty when there is nothing to break down', () => {
        expect(breakdownText({ songs: 0, tabs: 0 })).toBe('');
        expect(breakdownText()).toBe('');
    });
});

describe('buildScoreRows', () => {
    it('normalizes an RPC row into a display-ready entry', () => {
        const [row] = buildScoreRows([
            { rank: 1, display: 'Mike', total: 5, songs: 3, tabs: 2, is_you: false },
        ]);
        expect(row).toMatchObject({
            rank: 1, display: 'Mike', total: 5, songs: 3, tabs: 2,
            isYou: false, medal: 'gold', breakdown: '3 songs · 2 tabs',
        });
    });

    it('maps is_you onto isYou, and only for a literal true', () => {
        const rows = buildScoreRows([
            { rank: 1, display: 'A', total: 1, songs: 1, tabs: 0, is_you: true },
            { rank: 2, display: 'B', total: 1, songs: 1, tabs: 0, is_you: false },
            { rank: 3, display: 'C', total: 1, songs: 1, tabs: 0, is_you: null },
        ]);
        expect(rows.map(r => r.isYou)).toEqual([true, false, false]);
    });

    it('preserves the RPC order and its tied ranks', () => {
        const rows = buildScoreRows([
            { rank: 1, display: 'Lonesome Fiddler', total: 4, songs: 4, tabs: 0 },
            { rank: 2, display: 'Salty Drifter', total: 2, songs: 1, tabs: 1 },
            { rank: 2, display: 'Gospel Picker', total: 2, songs: 2, tabs: 0 },
            { rank: 4, display: 'Rusty Hobo', total: 1, songs: 0, tabs: 1 },
        ]);
        expect(rows.map(r => r.display)).toEqual([
            'Lonesome Fiddler', 'Salty Drifter', 'Gospel Picker', 'Rusty Hobo',
        ]);
        // A tie shares a medal; the skipped rank gets none.
        expect(rows.map(r => r.medal)).toEqual(['gold', 'silver', 'silver', null]);
    });

    it('handles missing/undefined input without throwing', () => {
        expect(buildScoreRows(null)).toEqual([]);
        expect(buildScoreRows(undefined)).toEqual([]);
        expect(buildScoreRows([])).toEqual([]);
    });
});

describe('scoreRowHtml', () => {
    const entry = (over = {}) => buildScoreRows([{
        rank: 1, display: 'Mike', total: 5, songs: 3, tabs: 2, is_you: false, ...over,
    }])[0];

    it('tags the row with its medal class', () => {
        expect(scoreRowHtml(entry({ rank: 1 }))).toContain('high-score-row-gold');
        expect(scoreRowHtml(entry({ rank: 2 }))).toContain('high-score-row-silver');
        expect(scoreRowHtml(entry({ rank: 3 }))).toContain('high-score-row-bronze');
        const plain = scoreRowHtml(entry({ rank: 9 }));
        expect(plain).not.toMatch(/high-score-row-(gold|silver|bronze)/);
    });

    it("highlights and badges the caller's own row", () => {
        const mine = scoreRowHtml(entry({ is_you: true }));
        expect(mine).toContain('high-score-row-you');
        expect(mine).toContain('high-score-you-badge');

        const theirs = scoreRowHtml(entry({ is_you: false }));
        expect(theirs).not.toContain('high-score-row-you');
        expect(theirs).not.toContain('high-score-you-badge');
    });

    it('renders the breakdown, and omits it entirely when empty', () => {
        expect(scoreRowHtml(entry())).toContain('3 songs · 2 tabs');
        expect(scoreRowHtml(entry({ songs: 0, tabs: 0, total: 0 })))
            .not.toContain('high-score-breakdown');
    });

    it('escapes the display string (it is server-supplied, not trusted markup)', () => {
        const html = scoreRowHtml(entry({ display: '<img src=x onerror=1>' }));
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });
});

describe('renderHighScoresView', () => {
    let container;

    const stubRpc = (result) => {
        const rpc = vi.fn(async () => result);
        window.SupabaseAuth = { getUser: () => null, supabase: { rpc } };
        return rpc;
    };

    // The module caches per caller id; flush it between tests by rendering
    // once as a different user, which is exactly what invalidates it in the
    // app. The stub's RPC never settles, so this flush can't land a stale
    // result on top of the next test's fetch.
    const flushCache = () => {
        window.SupabaseAuth = {
            getUser: () => ({ id: `flush-${Math.random()}` }),
            supabase: { rpc: () => new Promise(() => {}) },
        };
        renderHighScoresView(document.createElement('div'));
    };

    const settle = async () => {
        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => setTimeout(r, 0));
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        flushCache();
        vi.unstubAllGlobals();
        delete window.SupabaseAuth;
        document.body.innerHTML = '';
    });

    it('shows the board to a signed-out visitor (the RPC is granted to anon)', async () => {
        const rpc = stubRpc({
            data: [
                { rank: 1, display: 'Mike', total: 5, songs: 3, tabs: 2, is_you: false },
                { rank: 2, display: 'Lonesome Fiddler', total: 2, songs: 2, tabs: 0, is_you: false },
            ],
            error: null,
        });

        renderHighScoresView(container);
        expect(container.textContent).toMatch(/counting up/i);
        await settle();

        expect(rpc).toHaveBeenCalledWith('get_leaderboard');
        expect(container.textContent).toContain('Mike');
        expect(container.textContent).toContain('Lonesome Fiddler');
        // Nobody is "you" when nobody is signed in.
        expect(container.querySelector('.high-score-row-you')).toBeNull();
    });

    it('highlights exactly one row when the RPC marks it as the caller', async () => {
        window.SupabaseAuth = {
            getUser: () => ({ id: 'u1' }),
            supabase: {
                rpc: async () => ({
                    data: [
                        { rank: 1, display: 'Mike', total: 5, songs: 5, tabs: 0, is_you: false },
                        { rank: 2, display: 'alice@example.com', total: 2, songs: 2, tabs: 0, is_you: true },
                    ],
                    error: null,
                }),
            },
        };

        renderHighScoresView(container);
        await settle();

        const mine = container.querySelectorAll('.high-score-row-you');
        expect(mine).toHaveLength(1);
        expect(mine[0].textContent).toContain('alice@example.com');
    });

    it('shows the empty state when nobody has contributed yet', async () => {
        stubRpc({ data: [], error: null });
        renderHighScoresView(container);
        await settle();
        expect(container.textContent).toMatch(/no contributions yet/i);
    });

    it('fails soft when the RPC errors', async () => {
        stubRpc({ data: null, error: { message: 'boom' } });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        renderHighScoresView(container);
        await settle();

        expect(container.textContent).toMatch(/couldn't load the high scores/i);
        expect(container.querySelector('.high-scores-list')).toBeNull();
        warn.mockRestore();
    });

    it('fails soft when Supabase is not initialized at all', async () => {
        window.SupabaseAuth = { getUser: () => null };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        renderHighScoresView(container);
        await settle();

        expect(container.textContent).toMatch(/couldn't load the high scores/i);
        warn.mockRestore();
    });
});
