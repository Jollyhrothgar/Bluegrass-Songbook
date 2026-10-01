// A11: the editor's static copy must say what the server actually does.
//  - Submissions are live at once (pending_songs is merged into the corpus for
//    everyone; there is no review step), so the banner must not promise one.
//  - pending_songs.notes is written to the WORK's own `notes` when an edit
//    lands on the primary chart (scripts/lib/process_pending.py), so a
//    free-text "Edit Comment" cannot be sent without overwriting the song's
//    description. The field was collected and dropped; it is gone.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const editorSource = readFileSync(resolve(here, '../editor.js'), 'utf8');

describe('editor copy (A11)', () => {
    it('does not promise a review that does not exist', () => {
        expect(html).not.toMatch(/reviewed before/i);
        expect(html).toMatch(/go live as soon as you submit/i);
    });

    it('has no Edit Comment field that is collected and never sent', () => {
        expect(html).not.toContain('id="editor-comment"');
        expect(html).not.toContain('id="edit-comment-row"');
        expect(editorSource).not.toMatch(/editorComment|editCommentRow/);
    });
});
