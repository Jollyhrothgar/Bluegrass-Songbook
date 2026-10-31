// E2E tests for Song Editor functionality. The Add Song entry point is the
// top-band nav item (opens the add-song picker; Lyrics & Chords lands in the
// editor) or the #add deep link (straight to the editor).
import { test, expect } from './fixtures.js';
import { gotoSearch, navClick } from './helpers.js';
import { CM, setLead, leadText, leadReady, openDisplay } from './helpers/lead-editor.js';

// Open a fresh new-song editor via the top-band flow
async function openAddSongEditor(page) {
    await navClick(page, 'add');
    await expect(page.locator('#add-song-picker')).toBeVisible();
    await page.locator('.picker-card[data-type="chordpro"]').click();
    await expect(page.locator('#editor-panel')).toBeVisible();
}

test.describe('Editor Access', () => {
    test('reloading while editing keeps home content hidden', async ({ page }) => {
        // Force-refresh on an #edit deep link must restore the editor without
        // stacking the landing page (logo, search, collections) above it.
        await page.goto('/#edit/your-cheating-heart');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);
        // edit mode arrives with metadata known: the compact line shows it
        await expect(page.locator('#metadata-summary')).toContainText(/Cheat/i);

        await page.reload();
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#landing-page')).toBeHidden();
        await expect(page.locator('.search-container')).toBeHidden();
    });

    test('top-band Add Song opens picker; Lyrics & Chords lands in the editor', async ({ page }) => {
        await gotoSearch(page);

        await navClick(page, 'add');
        // Picker modal. Two cards since phase 2d retired document upload.
        await expect(page.locator('#add-song-picker')).toBeVisible();
        await expect(page.locator('.picker-card[data-type="upload"]')).toHaveCount(0);
        await expect(page.locator('.picker-card[data-type="chordpro"]')).toBeVisible();
        // 4c: the Tablature card is the picker's route to tabbing a work that
        // has no bounty and no gap in its part list.
        await expect(page.locator('.picker-card[data-type="tablature"]')).toBeVisible();
        await expect(page.locator('.picker-card[data-type="request"]')).toBeVisible();

        await page.locator('.picker-card[data-type="chordpro"]').click();

        // Editor: one empty chart, Lyrics mode by default
        await expect(page.locator('#editor-panel')).toBeVisible();
        await leadReady(page);
        expect(await leadText(page)).toBe('');
        await expect(page.locator('#add-song-picker')).toBeHidden();
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');

        // guidance lives in the empty chart's hint, with a Paste button
        await expect(page.locator('#editor-lead .cl-empty')).toContainText('Type or paste your song');
        await expect(page.locator('#editor-lead .le-paste-btn')).toBeVisible();

        // quiet escape hatch in the empty state (photo upload is gone)
        await expect(page.locator('.ve-link-upload')).toHaveCount(0);
        await expect(page.locator('.le-link-request')).toBeVisible();

        // metadata is deferred to a compact line
        await expect(page.locator('#metadata-summary')).toContainText('Untitled song');
        await expect(page.locator('#metadata-fields')).toBeHidden();
    });

    test('#add deep link goes straight to the editor (no picker)', async ({ page }) => {
        await page.goto('/#add');

        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#add-song-picker')).toBeHidden();
        await leadReady(page);
    });

    test('Tablature card asks which song the tab is for', async ({ page }) => {
        await gotoSearch(page);
        await navClick(page, 'add');
        await page.locator('.picker-card[data-type="tablature"]').click();

        // A tab is always a tab OF something, so the flow needs a target work
        // before the editor is any use (add-song-picker.js startTabFlow).
        await expect(page.locator('.picker-tab-target')).toBeVisible();
        await expect(page.locator('#picker-tab-search')).toBeVisible();
        await expect(page.locator('#picker-tab-instrument')).toBeVisible();

        // Searching the corpus surfaces the work to hang the tab on
        await page.locator('#picker-tab-search').fill('old home place');
        await expect(page.locator('.picker-tab-result').first())
            .toContainText(/old home place/i);

        // A genuine miss says so, and still lets you start without a song
        await page.locator('#picker-tab-search').fill('zzzz not a real song zzzz');
        await expect(page.locator('.picker-tab-empty')).toContainText(/No song by that name/i);
        await expect(page.locator('#picker-tab-new')).toBeVisible();

        // Back returns to the cards
        await page.locator('.picker-tab-back').click();
        await expect(page.locator('.picker-card[data-type="chordpro"]')).toBeVisible();
    });

    test('submit is login-gated: logged out keeps the draft and asks for sign-in', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        // Stub the sign-in redirect so the gate is observable (phase 2a:
        // login is required at SUBMIT time, not to open the editor).
        await page.evaluate(() => {
            window.__signInCalled = 0;
            window.SupabaseAuth.signInWithGoogle = () => { window.__signInCalled++; };
        });

        await page.locator('#metadata-summary').click();
        await page.locator('#editor-title').fill('Gate Test Song');
        await setLead(page, '[G]Some words to sing');

        await page.locator('#editor-submit').click();

        expect(await page.evaluate(() => window.__signInCalled)).toBe(1);
        await expect(page.locator('#editor-status')).toContainText(/Sign in to submit/i);
        await expect(page.locator('#editor-status')).toHaveClass(/error/);
        // "your draft stays here" has to be true, not just claimed
        await expect(page.locator('#editor-panel')).toBeVisible();
        expect(await leadText(page)).toBe('[G]Some words to sing');
        await expect(page.locator('#editor-title')).toHaveValue('Gate Test Song');
    });

    test('editor shows title, artist, and content fields', async ({ page }) => {
        await gotoSearch(page);
        await openAddSongEditor(page);

        // Metadata fields are deferred behind the compact line — expand it
        await page.locator('#metadata-summary').click();
        await expect(page.locator('#editor-title')).toBeVisible();
        await expect(page.locator('#editor-artist')).toBeVisible();
        await leadReady(page);
    });

    test('edit button on song view opens editor with song data', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        // Edit lives in the top band on song pages
        const editBtn = page.locator('#edit-song-btn');
        await expect(editBtn).toBeVisible();
        await editBtn.click();

        await expect(page.locator('#editor-panel')).toBeVisible();
        await expect(page.locator('#editor-title')).not.toHaveValue('');
    });
});

test.describe('Editor State Reset', () => {
    test('Add Song after editing a song shows a fresh empty editor', async ({ page }) => {
        // Edit an existing song
        await page.goto('/#edit/your-cheating-heart');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);

        // Home via the brand link, then Add Song (the reported repro)
        await page.locator('#topbar-brand').click();
        await expect(page.locator('#landing-page')).toBeVisible();

        await openAddSongEditor(page);

        // Fresh new-song editor: empty chart, no stale content
        await expect(page.locator('#editor-lead .cl-empty')).toBeVisible();
        await expect(page.locator('#metadata-summary')).toContainText('Untitled song');
        await expect(page.locator('#editor-title')).toHaveValue('');
        expect(await leadText(page)).toBe('');
        await expect(page.locator('#editor-submit')).toHaveText('Submit to Songbook');
    });

    test('an unsaved new-song draft survives leaving and returning to Add Song', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        // Type a draft into the textarea
        await setLead(page, '[G]Working on my draft');

        // Leave for home (the unsaved-draft prompt asks first; leaving keeps
        // the draft in this tab), then come back via Add Song
        await page.locator('#topbar-brand').click();
        await page.locator('#editor-leave-modal [data-choice="discard"]').click();
        await expect(page.locator('#landing-page')).toBeVisible();

        await openAddSongEditor(page);

        expect(await leadText(page)).toBe('[G]Working on my draft');
    });

    test('editing song B after abandoning an edit of song A shows B', async ({ page }) => {
        await page.goto('/#edit/your-cheating-heart');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);

        // Abandon via home, then open another song and edit it
        await page.locator('#topbar-brand').click();
        await expect(page.locator('#landing-page')).toBeVisible();

        await page.goto('/#edit/cold-cold-heart');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cold/i);
        await expect(page.locator('#editor-title')).not.toHaveValue(/Cheat/i);
        expect(await leadText(page)).not.toBe('');
    });
});

test.describe('Editor Content Input', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
    });

    test('can enter title and it shows on the compact metadata line', async ({ page }) => {
        await page.locator('#metadata-summary').click();
        const titleInput = page.locator('#editor-title');
        await titleInput.fill('Test Song Title');
        await expect(titleInput).toHaveValue('Test Song Title');
        await expect(page.locator('#metadata-summary')).toContainText('Test Song Title');
    });

    test('can enter artist', async ({ page }) => {
        await page.locator('#metadata-summary').click();
        const artistInput = page.locator('#editor-artist');
        await artistInput.fill('Test Artist');
        await expect(artistInput).toHaveValue('Test Artist');
    });

    test('can enter song content', async ({ page }) => {
        const testContent = '[G]Amazing [C]Grace how [G]sweet the sound';
        await setLead(page, testContent);
        expect(await leadText(page)).toBe(testContent);
    });
});

test.describe('Editor Lyrics mode', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
    });

    test('the chart draws what was typed, with chords as the book draws them', async ({ page }) => {
        await setLead(page, '[G]Test [C]line with [D]chords');
        await expect(page.locator('#editor-lead .cl-line .cl-segment')).toHaveCount(3);
        await expect(page.locator('#editor-lead .cl-chord').first()).toHaveText('G');
        // the [G] brackets are not on screen
        await expect(page.locator(CM)).not.toContainText('[G]');
    });

    test('chords render as the book\'s chord labels', async ({ page }) => {
        await setLead(page, '[G]Amazing [C]Grace');
        await expect(page.locator('#editor-lead .cl-chord')).toHaveCount(2);
        await expect(page.locator('#editor-lead .cl-chord').nth(1)).toHaveText('C');
    });
});

test.describe('Paste just works (no click first)', () => {
    const SHEET = 'G       C       G\nAmazing grace how sweet the sound\nD       G\nThat saved a wretch like me';
    async function openWithClipboard(page, context, text) {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await leadReady(page);
        await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    }

    test('a new song opens with the caret in the sheet, and ⌘V straight away pastes the song', async ({ page, context }) => {
        await openWithClipboard(page, context, SHEET);
        expect(await page.evaluate(() => !!document.activeElement?.closest('#editor-lead .cm-content'))).toBe(true);
        await page.keyboard.press('ControlOrMeta+V');
        await expect.poll(() => leadText(page)).toContain('[G]Amazing');
    });

    test('⌘V pastes into the song even when focus is somewhere else on the page', async ({ page, context }) => {
        await openWithClipboard(page, context, SHEET);
        await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#metadata-summary')?.focus(); });
        await page.keyboard.press('ControlOrMeta+V');
        await expect.poll(() => leadText(page)).toContain('[D]That');
        expect(await page.evaluate(() => !!document.activeElement?.closest('#editor-lead .cm-content'))).toBe(true);
    });

    test('a chord sheet with Windows line endings (\\r\\n, as Ultimate Guitar copies) pastes whole', async ({ page, context }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await openWithClipboard(page, context, SHEET.replace(/\n/g, '\r\n'));
        await page.keyboard.press('ControlOrMeta+V');
        await expect.poll(() => leadText(page)).toContain('[D]That');
        expect(await leadText(page)).not.toMatch(/\r/);
        expect(errors).toEqual([]);
    });

    test('plain text with Windows line endings pastes whole too', async ({ page, context }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await openWithClipboard(page, context, 'Just some words\r\nand a second line');
        await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#metadata-summary')?.focus(); });
        await page.keyboard.press('ControlOrMeta+V');
        await expect.poll(() => leadText(page)).toBe('Just some words\nand a second line');
        expect(errors).toEqual([]);
    });

    test('a paste into the title field stays in the title', async ({ page, context }) => {
        await openWithClipboard(page, context, 'Amazing Grace');
        await page.locator('#metadata-summary').click();
        await page.locator('#editor-title').focus();
        await page.keyboard.press('ControlOrMeta+V');
        await expect(page.locator('#editor-title')).toHaveValue('Amazing Grace');
        expect(await leadText(page)).toBe('');
    });

    test('⌘V in Chords mode goes back to Lyrics and pastes', async ({ page, context }) => {
        await openWithClipboard(page, context, SHEET);
        await setLead(page, 'Some words here');
        await page.locator('#editor-mode-chords').click();
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ControlOrMeta+V');
        await expect.poll(() => leadText(page)).toContain('[G]Amazing');
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('Pasted played sections ([Intro], [Interlude], ...)', () => {
    test('arrive as real sections with visible chord lines, which the section menu can delete', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await leadReady(page);
        const sheet = '[Verse 1]\nG                B7\nIt\'s been ten long years\n\n[Interlude]\nG B7 C G\nG    D\n\n[Verse 2]\nG\nI fell in love';
        await page.locator(CM).click();
        await page.evaluate((text) => {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            document.querySelector('#editor-lead .cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, sheet);
        await expect.poll(() => leadText(page)).toContain('{start_of_interlude: Interlude}');
        const label = page.locator('#editor-lead .section-label', { hasText: 'Interlude' });
        await expect(label).toBeVisible();
        await expect(page.locator('#editor-lead .cm-line', { hasText: 'B7' }).first()).toBeVisible();   // its chords show
        expect(await page.locator('#editor-lead .cl-chord').allTextContents()).toEqual(expect.arrayContaining(['G', 'B7', 'C', 'D']));
        await label.click();
        await page.locator('.le-labelmenu').getByRole('menuitem', { name: 'Delete section' }).click();
        expect(await leadText(page)).not.toContain('Interlude');
        expect(await leadText(page)).toContain('I fell in love');
    });
});

test.describe('ChordPro Conversion', () => {
    test('paste with chord-above-lyrics format converts to ChordPro', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        // Simulate chord-above-lyrics format (typical from guitar sites)
        const chordAboveLyrics = `G       C       G
Amazing grace how sweet the sound
D       G
That saved a wretch like me`;

        // a real paste: Lyrics mode runs the smart-paste converter on it
        await page.locator(CM).click();
        await page.evaluate(async (text) => {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            document.querySelector('#editor-lead .cm-content').dispatchEvent(
                new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, chordAboveLyrics);
        await expect(page.locator('#editor-lead .cl-chord').first()).toBeVisible();
        const content = await leadText(page);
        expect(content).toContain('[G]Amazing');
        expect(content).toContain('[D]');
    });
});

test.describe('Editor Navigation', () => {
    test('back button returns to previous view', async ({ page }) => {
        await gotoSearch(page);
        await openAddSongEditor(page);

        await page.locator('#topbar-back').click();

        await expect(page.locator('.search-container')).toBeVisible();
    });

    test('opening editor from song returns to that song after ←', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const editBtn = page.locator('#edit-song-btn');
        await expect(editBtn).toBeVisible();
        await editBtn.click();

        await expect(page.locator('#editor-panel')).toBeVisible();

        await page.locator('#topbar-back').click();

        // ← goes back to the song it was opened from, not to search
        await expect(page.locator('#song-view:not(.hidden)')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#editor-panel')).toBeHidden();
    });
});

test.describe('Editor Hints', () => {
    test('hints button shows ChordPro help', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        await page.locator('#chordpro-hints-btn').click();

        const hintsPanel = page.locator('#chordpro-hints-panel');
        await expect(hintsPanel).toBeVisible();

        const hintsText = await hintsPanel.textContent();
        expect(hintsText?.toLowerCase()).toMatch(/chord|verse|chorus/i);
    });
});

test.describe('Editor Copy Function', () => {
    test('copy button copies content to clipboard', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        await setLead(page, '[G]Test song content');

        await page.locator('#editor-copy').click();

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toContain('Test song content');
    });
});

test.describe('Editor Nashville Mode', () => {
    test('Nashville toggle changes chord display in preview', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        await setLead(page, '{key: G}\n[G]Test [C]line [D]here');
        await page.waitForTimeout(300);

        await openDisplay(page);                                   // the band's Display pill
        const toggle = page.locator('#editor-nashville');
        await expect(toggle).toBeVisible();
        await toggle.click();
        await page.waitForTimeout(300);

        // Chord labels show Nashville numbers (I, IV, V); the text keeps its chords
        await expect(page.locator('#editor-lead .cl-chord').first()).toHaveText(/^(I|IV|V)$/);
        expect(await leadText(page)).toContain('[G]Test');
    });
});

test.describe('Editor Validation', () => {
    test('submit button requires title', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        // Enter content but no title
        await setLead(page, '[G]Some content here');

        const submitBtn = page.locator('#editor-submit');
        await expect(submitBtn).toBeVisible();
        await submitBtn.click();

        // Friendly nudge: fields expand, title gets focus, notice mentions the title
        await expect(page.locator('#metadata-fields')).toBeVisible();
        await expect(page.locator('#editor-title')).toBeFocused();
        const statusText = await page.locator('#editor-status').textContent();
        expect(statusText?.toLowerCase()).toContain('title');
    });
});
