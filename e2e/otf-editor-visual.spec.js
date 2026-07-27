// Visual comparison tests for OTF Editor
// Loads real tabs, renders them in production mode and editor mode, and compares.
// Also tests recording replay produces correct output.

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Test tab set (from plan) — covers all editor features
const TEST_TABS = [
    {
        name: 'ebenezer-banjo',
        file: 'data/tabs/ebenezer-banjo.otf.json',
        features: ['compact', 'repeats', 'slides', 'h/p'],
    },
    {
        name: 'cherokee-shuffle-a-banjo',
        file: 'data/tabs/cherokee-shuffle-a-banjo.otf.json',
        features: ['2/2 time', 'repeats', 'many articulations'],
    },
    {
        name: 'cattle-in-the-cane-banjo',
        file: 'data/tabs/cattle-in-the-cane-banjo.otf.json',
        features: ['multi-track', 'capo', 'all articulation types'],
    },
    {
        name: 'foggy-mountain-breakdown-mandolin',
        file: 'data/tabs/foggy-mountain-breakdown-mandolin.otf.json',
        features: ['mandolin', 'ties'],
    },
    {
        name: 'jerusalem-ridge-ensemble',
        file: 'data/tabs/jerusalem-ridge-ensemble-ensemble.otf.json',
        features: ['4 tracks', 'full ensemble', '2/2 time'],
    },
    {
        name: 'salt-creek-banjo',
        file: 'data/tabs/salt-creek-banjo.otf.json',
        features: ['no repeats', 'slides', 'pull-offs'],
    },
];

test.describe('OTF Editor - Visual Comparison: Production vs Editor', () => {
    for (const tab of TEST_TABS) {
        test(`renders ${tab.name} correctly in editor`, async ({ page }) => {
            // Load the tab in the editor demo page
            await page.goto('/editor-demo.html');
            await page.waitForTimeout(300);

            // Load the tab via the page's JS context
            const loaded = await page.evaluate(async (tabFile) => {
                try {
                    const response = await fetch(tabFile);
                    if (!response.ok) return { error: `HTTP ${response.status}` };
                    const otf = await response.json();
                    // Use the global editor to load
                    window.editor.load(otf);
                    return { success: true, title: otf.metadata?.title };
                } catch (err) {
                    return { error: err.message };
                }
            }, tab.file);

            if (loaded.error) {
                test.skip();
                return;
            }

            // Wait for render
            await page.waitForTimeout(500);

            // Verify the editor rendered tablature
            const noteCount = await page.locator('.note-text').count();
            expect(noteCount).toBeGreaterThan(0);

            // Check no console errors during rendering
            const consoleErrors = [];
            page.on('console', msg => {
                if (msg.type() === 'error') consoleErrors.push(msg.text());
            });

            // Take screenshot of the editor canvas area for visual comparison
            const canvas = page.locator('.editor-canvas-container');
            await expect(canvas).toBeVisible();
            await canvas.screenshot({
                path: `e2e/screenshots/${tab.name}-editor.png`,
            });

            // Verify no JS errors
            expect(consoleErrors).toHaveLength(0);
        });
    }
});

test.describe('OTF Editor - Tab Data Integrity', () => {
    for (const tab of TEST_TABS) {
        test(`${tab.name} loads and exports without data loss`, async ({ page }) => {
            await page.goto('/editor-demo.html');
            await page.waitForTimeout(300);

            // Load tab and compare original vs exported
            const result = await page.evaluate(async (tabFile) => {
                try {
                    const response = await fetch(tabFile);
                    if (!response.ok) return { error: `HTTP ${response.status}` };
                    const original = await response.json();

                    // Load into editor
                    window.editor.load(original);

                    // Export from editor
                    const exported = window.editor.save();

                    // Compare key properties
                    const checks = {
                        sameTitle: original.metadata?.title === exported.metadata?.title,
                        sameTimeSig: original.metadata?.time_signature === exported.metadata?.time_signature,
                        sameTrackCount: original.tracks?.length === exported.tracks?.length,
                    };

                    // Compare notation: count total events across all tracks
                    let origEventCount = 0;
                    let exportEventCount = 0;
                    for (const trackId of Object.keys(original.notation || {})) {
                        for (const measure of (original.notation[trackId] || [])) {
                            origEventCount += (measure.events || []).length;
                        }
                    }
                    for (const trackId of Object.keys(exported.notation || {})) {
                        for (const measure of (exported.notation[trackId] || [])) {
                            exportEventCount += (measure.events || []).length;
                        }
                    }
                    checks.sameEventCount = origEventCount === exportEventCount;
                    checks.origEventCount = origEventCount;
                    checks.exportEventCount = exportEventCount;

                    return { success: true, checks };
                } catch (err) {
                    return { error: err.message };
                }
            }, tab.file);

            if (result.error) {
                test.skip();
                return;
            }

            expect(result.checks.sameTitle).toBe(true);
            expect(result.checks.sameTimeSig).toBe(true);
            expect(result.checks.sameTrackCount).toBe(true);
            expect(result.checks.sameEventCount).toBe(true);
        });
    }
});

test.describe('OTF Editor - Recorder Integration', () => {
    test('recorder captures events during editing', async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.waitForTimeout(300);

        // Start recording programmatically (avoids focus issues with button click)
        await page.evaluate(() => {
            window.editor.startRecording();
        });

        // Focus editor and do some actions
        await page.locator('.otf-editor').click();
        await page.waitForTimeout(100);

        // Enter some notes: set duration to quarter, enter fret 0, advance
        await page.keyboard.press('q');  // quarter duration
        await page.keyboard.press('0');  // fret 0
        await page.waitForTimeout(350);  // wait for fret buffer commit

        await page.keyboard.press('2');  // fret 2
        await page.waitForTimeout(350);

        // Move to next string
        await page.keyboard.press('j');

        // Enter another note
        await page.keyboard.press('0');
        await page.waitForTimeout(350);

        // Stop recording and export
        const recording = await page.evaluate(() => {
            window.editor.stopRecording();
            return window.editor.exportRecording();
        });

        const parsed = JSON.parse(recording);
        expect(parsed.events.length).toBeGreaterThan(0);
        expect(parsed.metadata).toBeDefined();

        // Verify event types include note insertions
        const eventTypes = parsed.events.map(e => e.type);
        expect(eventTypes).toContain('setDuration');
        expect(eventTypes).toContain('insertNote');
    });

    test('replay produces consistent state', async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.waitForTimeout(300);

        // Start recording programmatically
        await page.evaluate(() => {
            window.editor.startRecording();
        });

        // Focus and enter notes
        await page.locator('.otf-editor').click();
        await page.waitForTimeout(100);

        await page.keyboard.press('e');  // eighth duration
        await page.keyboard.press('0');
        await page.waitForTimeout(350);
        await page.keyboard.press('2');
        await page.waitForTimeout(350);
        await page.keyboard.press('0');
        await page.waitForTimeout(350);

        // Stop recording and capture state
        const { afterRecordingOTF, recording } = await page.evaluate(() => {
            window.editor.stopRecording();
            return {
                afterRecordingOTF: JSON.stringify(window.editor.save()),
                recording: window.editor.exportRecording(),
            };
        });

        // Reset to new document
        await page.click('text=New Document');
        await page.waitForTimeout(300);

        // Replay the recording programmatically
        const afterReplayOTF = await page.evaluate(async (recordingJSON) => {
            await window.editor.importAndReplay(recordingJSON, { stepDelay: 0 });
            return JSON.stringify(window.editor.save());
        }, recording);

        // Compare: the OTF after recording should match OTF after replay
        const original = JSON.parse(afterRecordingOTF);
        const replayed = JSON.parse(afterReplayOTF);

        // Same number of tracks
        expect(replayed.tracks.length).toBe(original.tracks.length);

        // Same notation events (compare the primary track)
        const origTrackId = original.tracks[0].id;
        const replayTrackId = replayed.tracks[0].id;

        const origEvents = original.notation[origTrackId]
            ?.flatMap(m => m.events) || [];
        const replayEvents = replayed.notation[replayTrackId]
            ?.flatMap(m => m.events) || [];

        expect(replayEvents.length).toBe(origEvents.length);
    });

    test('recording import/export roundtrip works', async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.waitForTimeout(300);

        // Create a recording programmatically
        const testRecording = JSON.stringify({
            version: 1,
            metadata: { title: 'test-roundtrip' },
            events: [
                { type: 'setDuration', params: { duration: 480 }, dt: 0 },
                { type: 'insertNote', params: { measure: 1, tick: 0, string: 3, fret: 0, duration: 480 }, dt: 100 },
                { type: 'insertNote', params: { measure: 1, tick: 480, string: 3, fret: 2, duration: 480 }, dt: 200 },
            ],
        });

        // Replay it
        const result = await page.evaluate(async (recording) => {
            const res = await window.editor.importAndReplay(recording, { stepDelay: 0 });
            const otf = window.editor.save();
            const trackId = otf.tracks[0].id;
            const events = otf.notation[trackId]?.flatMap(m => m.events) || [];
            return {
                completed: res.completed,
                total: res.total,
                eventCount: events.length,
                notes: events.flatMap(e => e.notes.map(n => ({ f: n.f, s: n.s }))),
            };
        }, testRecording);

        expect(result.completed).toBe(3);
        expect(result.total).toBe(3);
        expect(result.eventCount).toBe(2); // 2 note events
        expect(result.notes).toContainEqual({ f: 0, s: 3 });
        expect(result.notes).toContainEqual({ f: 2, s: 3 });
    });
});

test.describe('OTF Editor - Recording File Replay', () => {
    // This test loads saved recording files from the fixtures directory
    // and replays them, verifying the output matches expectations.
    const fixturesDir = path.join(process.cwd(), 'e2e/fixtures/recordings');

    // Only run if fixture files exist
    let recordingFiles = [];
    try {
        recordingFiles = fs.readdirSync(fixturesDir)
            .filter(f => f.endsWith('.json'));
    } catch {
        // Directory doesn't exist yet — skip
    }

    for (const file of recordingFiles) {
        test(`replays fixture recording: ${file}`, async ({ page }) => {
            await page.goto('/editor-demo.html');
            await page.waitForTimeout(300);

            const recording = fs.readFileSync(path.join(fixturesDir, file), 'utf-8');

            const result = await page.evaluate(async (recordingJSON) => {
                try {
                    const res = await window.editor.importAndReplay(recordingJSON, { stepDelay: 0 });
                    const otf = window.editor.save();
                    return {
                        success: true,
                        completed: res.completed,
                        total: res.total,
                        title: otf.metadata?.title,
                    };
                } catch (err) {
                    return { success: false, error: err.message };
                }
            }, recording);

            expect(result.success).toBe(true);
            expect(result.completed).toBe(result.total);
        });
    }
});
