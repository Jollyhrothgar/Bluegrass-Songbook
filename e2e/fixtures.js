// The `test` every spec imports (instead of @playwright/test's).
//
// It installs the Supabase mock on each test's browser CONTEXT — signed out,
// empty tables — before the test runs, and asserts it stayed clean after.
// Before this, only the specs that called mockSupabase() themselves were off
// the network; the other 35 talked to the PRODUCTION project
// (supabase-auth.js hard-codes it), and since every test starts with empty
// localStorage, each page load was a new row in `visitors` (Oct 2026: a full
// run added ~500 "visitors" to the home page counter).
//
// A spec that needs a signed-in user, seeded tables or a commit answer still
// calls mockSupabase(page, {...}): page routes take precedence over context
// routes, so its mock answers and this one is only the backstop.
//
// A spec that must run with NO routes at all (Playwright turns the HTTP cache
// off while any route is installed — sw-and-prefetch.spec.js) opts out with
// `test.use({ supabaseBackstop: false })`. It still can't reach production:
// playwright.config.js makes *.supabase.co unresolvable for the whole suite.
import { test as base, expect } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock.js';

export const test = base.extend({
    supabaseBackstop: [true, { option: true }],

    context: async ({ context, supabaseBackstop }, use) => {
        if (!supabaseBackstop) return use(context);
        const backstop = await mockSupabase(context, { signedIn: false, blockAudio: false });
        await use(context);
        backstop.assertClean();
    },
});

export { expect };
