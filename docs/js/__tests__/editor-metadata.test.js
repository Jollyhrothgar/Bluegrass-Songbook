// @vitest-environment jsdom
// Deferred metadata: the compact "Title — Artist" line above the editor.
// Fields stay collapsed until tapped; the line text derives from the inputs.
import { describe, it, expect, beforeEach } from 'vitest';
import { initEditor, deriveMetadataSummary } from '../editor.js';

describe('deriveMetadataSummary', () => {
    it('shows the naming nudge when nothing is known', () => {
        expect(deriveMetadataSummary('', '')).toBe('Untitled song — tap to name');
        expect(deriveMetadataSummary(null, undefined)).toBe('Untitled song — tap to name');
        expect(deriveMetadataSummary('   ', ' ')).toBe('Untitled song — tap to name');
    });

    it('shows "Title — Artist" once both are known', () => {
        expect(deriveMetadataSummary('Blue Moon of Kentucky', 'Bill Monroe'))
            .toBe('Blue Moon of Kentucky — Bill Monroe');
    });

    it('shows just the title when there is no artist', () => {
        expect(deriveMetadataSummary('Shady Grove', '')).toBe('Shady Grove');
    });

    it('keeps the untitled nudge visible when only the artist is known', () => {
        expect(deriveMetadataSummary('', 'Doc Watson')).toBe('Untitled song — Doc Watson');
    });

    it('trims whitespace', () => {
        expect(deriveMetadataSummary('  Salt Creek  ', '  ')).toBe('Salt Creek');
    });
});

describe('metadata line wiring', () => {
    let refs;

    function buildDom() {
        document.body.innerHTML = `
            <div id="editor-panel">
                <div class="editor-topbar">
                    <button id="metadata-summary" class="metadata-summary" type="button" aria-expanded="false"></button>
                </div>
                <div id="metadata-fields" class="metadata-fields hidden">
                    <input type="text" id="editor-title">
                    <input type="text" id="editor-artist">
                </div>
                <div class="editor-workspace">
                    <textarea id="editor-content"></textarea>
                    <div id="editor-preview-container"></div>
                </div>
            </div>
        `;
        return {
            editorTitle: document.getElementById('editor-title'),
            editorArtist: document.getElementById('editor-artist'),
            editorContent: document.getElementById('editor-content'),
            editorPreviewContainer: document.getElementById('editor-preview-container'),
            metadataSummary: document.getElementById('metadata-summary'),
            metadataFields: document.getElementById('metadata-fields')
        };
    }

    beforeEach(() => {
        refs = buildDom();
        initEditor(refs);
    });

    it('starts collapsed with the untitled nudge', () => {
        expect(refs.metadataFields.classList.contains('hidden')).toBe(true);
        expect(refs.metadataSummary.textContent).toBe('Untitled song — tap to name');
        expect(refs.metadataSummary.classList.contains('metadata-summary-unnamed')).toBe(true);
    });

    it('tapping the line expands the fields and focuses the title', () => {
        refs.metadataSummary.click();
        expect(refs.metadataFields.classList.contains('hidden')).toBe(false);
        expect(refs.metadataSummary.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(refs.editorTitle);
        // tapping again collapses
        refs.metadataSummary.click();
        expect(refs.metadataFields.classList.contains('hidden')).toBe(true);
        expect(refs.metadataSummary.getAttribute('aria-expanded')).toBe('false');
    });

    it('typing in the fields updates the compact line', () => {
        refs.metadataSummary.click();
        refs.editorTitle.value = 'Nine Pound Hammer';
        refs.editorTitle.dispatchEvent(new Event('input'));
        expect(refs.metadataSummary.textContent).toBe('Nine Pound Hammer');
        expect(refs.metadataSummary.classList.contains('metadata-summary-unnamed')).toBe(false);
        refs.editorArtist.value = 'Merle Travis';
        refs.editorArtist.dispatchEvent(new Event('input'));
        expect(refs.metadataSummary.textContent).toBe('Nine Pound Hammer — Merle Travis');
    });

    it('user content is rendered via textContent (no HTML injection)', () => {
        refs.editorTitle.value = '<img src=x onerror=alert(1)>';
        refs.editorTitle.dispatchEvent(new Event('input'));
        expect(refs.metadataSummary.querySelector('img')).toBeNull();
        expect(refs.metadataSummary.textContent).toContain('<img');
    });
});
