// Document Upload module — upload images/PDFs to create placeholder works

import { generateSlug } from './utils.js';
import { track } from './analytics.js';

const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];
const ACCEPTED_EXTENSIONS = '.jpg,.jpeg,.png,.heic,.webp,.pdf';

// DOM elements (cached on init)
let uploadTitle = null;
let uploadArtist = null;
let uploadKey = null;
let uploadInstrument = null;
let uploadDescription = null;
let dropzone = null;
let fileInput = null;
let fileInfo = null;
let submitBtn = null;
let statusEl = null;
let previewContent = null;
let backBtn = null;

// State
let selectedFile = null;
let convertedPdf = null; // PDF blob after image conversion
let pdfLibPromise = null; // lazy-load promise
let currentRotation = 0; // 0, 90, 180, 270

// State for contribute mode (pre-filled from placeholder)
let targetSlug = null;

function getSubmitterAttribution() {
    const user = window.SupabaseAuth?.getUser?.();
    return user?.user_metadata?.full_name || user?.email || 'Anonymous User';
}

function showStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = 'save-status' + (isError ? ' error' : ' success');
}

function clearStatus() {
    if (!statusEl) return;
    statusEl.textContent = '';
    statusEl.className = 'save-status';
}

function resetForm() {
    if (uploadTitle) uploadTitle.value = '';
    if (uploadArtist) uploadArtist.value = '';
    if (uploadKey) uploadKey.value = '';
    if (uploadInstrument) uploadInstrument.value = '';
    if (uploadDescription) uploadDescription.value = '';
    selectedFile = null;
    convertedPdf = null;
    currentRotation = 0;
    targetSlug = null;
    clearStatus();
    if (submitBtn) submitBtn.disabled = true;
    if (fileInfo) fileInfo.classList.add('hidden');
    if (previewContent) {
        previewContent.innerHTML = '<p class="preview-placeholder">Select a file to see preview...</p>';
    }
}

// ============================================
// PDF-LIB LAZY LOADING
// ============================================

function loadPdfLib() {
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
        script.onload = () => resolve(window.PDFLib);
        script.onerror = () => reject(new Error('Failed to load pdf-lib'));
        document.head.appendChild(script);
    });
    return pdfLibPromise;
}

// ============================================
// IMAGE → PDF CONVERSION
// ============================================

async function convertImageToPdf(imageFile) {
    const PDFLib = await loadPdfLib();
    const pdfDoc = await PDFLib.PDFDocument.create();

    const arrayBuffer = await imageFile.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let image;
    if (imageFile.type === 'image/png') {
        image = await pdfDoc.embedPng(bytes);
    } else {
        // For JPEG, HEIC, WebP — draw to canvas, export as JPEG
        const jpegBytes = await toJpegBytes(imageFile);
        image = await pdfDoc.embedJpg(jpegBytes);
    }

    // Page sized to image, max 8.5"×11" at 72dpi
    const maxW = 612; // 8.5 * 72
    const maxH = 792; // 11 * 72
    let { width, height } = image.scale(1);

    if (width > maxW || height > maxH) {
        const scale = Math.min(maxW / width, maxH / height);
        width *= scale;
        height *= scale;
    }

    const page = pdfDoc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

function toJpegBytes(imageFile) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(imageFile);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(
                (blob) => {
                    URL.revokeObjectURL(url);
                    if (blob) {
                        blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
                    } else {
                        reject(new Error('Canvas to blob failed'));
                    }
                },
                'image/jpeg',
                0.92
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };
        img.src = url;
    });
}

// ============================================
// FILE HANDLING
// ============================================

async function handleFileSelect(file) {
    clearStatus();

    if (!file) return;

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
        showStatus(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 10MB.`, true);
        return;
    }

    // Validate type
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        showStatus('Unsupported file type. Use JPG, PNG, HEIC, WebP, or PDF.', true);
        return;
    }

    selectedFile = file;
    convertedPdf = null;

    // Show file info
    if (fileInfo) {
        fileInfo.innerHTML = `
            <span class="upload-file-name">${escapeForHtml(file.name)}</span>
            <span class="upload-file-size">(${(file.size / 1024).toFixed(0)} KB)</span>
            <button class="upload-file-remove" title="Remove file">&times;</button>
        `;
        fileInfo.classList.remove('hidden');
        fileInfo.querySelector('.upload-file-remove')?.addEventListener('click', removeFile);
    }

    // Show preview
    if (file.type === 'application/pdf') {
        showPdfPreview(file);
    } else {
        showImagePreview(file);
        // Pre-convert to PDF
        try {
            showStatus('Converting to PDF...');
            convertedPdf = await convertImageToPdf(file);
            clearStatus();
        } catch (err) {
            console.error('PDF conversion error:', err);
            showStatus('Failed to convert image. Try a different file.', true);
            selectedFile = null;
            updateSubmitState();
            return;
        }
    }

    updateSubmitState();
}

function removeFile() {
    selectedFile = null;
    convertedPdf = null;
    currentRotation = 0;
    if (fileInfo) fileInfo.classList.add('hidden');
    if (previewContent) {
        previewContent.innerHTML = '<p class="preview-placeholder">Select a file to see preview...</p>';
    }
    if (fileInput) fileInput.value = '';
    updateSubmitState();
}

function rotationControlsHtml() {
    return `<div class="upload-rotate-controls">
        <button class="upload-rotate-btn" data-dir="ccw" title="Rotate left">&#x21BA;</button>
        <button class="upload-rotate-btn" data-dir="cw" title="Rotate right">&#x21BB;</button>
    </div>`;
}

function wireRotateButtons() {
    if (!previewContent) return;
    previewContent.querySelectorAll('.upload-rotate-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dir = btn.dataset.dir;
            currentRotation = (currentRotation + (dir === 'cw' ? 90 : 270)) % 360;
            // Re-render preview with rotation
            if (selectedFile) {
                if (convertedPdf || selectedFile.type === 'application/pdf') {
                    showPdfPreview(convertedPdf || selectedFile);
                } else {
                    showImagePreview(selectedFile);
                }
            }
        });
    });
}

function showImagePreview(file) {
    if (!previewContent) return;
    const url = URL.createObjectURL(file);
    const rotateStyle = currentRotation ? ` style="transform: rotate(${currentRotation}deg)"` : '';
    previewContent.innerHTML = `${rotationControlsHtml()}
        <img src="${url}" class="upload-preview-image"${rotateStyle} alt="Preview">`;
    wireRotateButtons();
}

function showPdfPreview(fileOrBlob) {
    if (!previewContent) return;
    // For PDFs, apply rotation by rewriting the PDF so the <object> embed shows it correctly
    if (currentRotation) {
        applyPdfRotation(fileOrBlob).then(rotatedBlob => {
            const url = URL.createObjectURL(rotatedBlob);
            previewContent.innerHTML = `${rotationControlsHtml()}
                <object data="${url}" type="application/pdf" class="pdf-embed">
                    <p>PDF preview not available. <a href="${url}" target="_blank">Open PDF</a></p>
                </object>`;
            wireRotateButtons();
        });
    } else {
        const url = URL.createObjectURL(fileOrBlob);
        previewContent.innerHTML = `${rotationControlsHtml()}
            <object data="${url}" type="application/pdf" class="pdf-embed">
                <p>PDF preview not available. <a href="${url}" target="_blank">Open PDF</a></p>
            </object>`;
        wireRotateButtons();
    }
}

async function applyPdfRotation(fileOrBlob) {
    const PDFLib = await loadPdfLib();
    const arrayBuffer = await fileOrBlob.arrayBuffer();
    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    for (const page of pages) {
        const existing = page.getRotation().angle;
        page.setRotation(PDFLib.degrees(existing + currentRotation));
    }
    const bytes = await pdfDoc.save();
    return new Blob([bytes], { type: 'application/pdf' });
}

function updateSubmitState() {
    if (!submitBtn) return;
    const title = uploadTitle?.value?.trim();
    submitBtn.disabled = !title || !selectedFile;
}

function escapeForHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// SUBMISSION
// ============================================

async function submit() {
    const title = uploadTitle?.value?.trim();
    const artist = uploadArtist?.value?.trim() || null;
    const key = uploadKey?.value || null;
    const instrument = uploadInstrument?.value || null;
    const description = uploadDescription?.value?.trim() || null;

    if (!title) {
        showStatus('Title is required.', true);
        uploadTitle?.focus();
        return;
    }

    if (!selectedFile) {
        showStatus('Please select a file.', true);
        return;
    }

    const slug = generateSlug(title, artist);
    const isTrusted = await window.SupabaseAuth?.isTrustedUser?.();
    const isLoggedIn = window.SupabaseAuth?.isLoggedIn?.();

    // Build a label from description + instrument, or fall back to title
    const label = description || title;

    submitBtn.disabled = true;
    showStatus('Submitting...');

    // Use targetSlug from contribute mode if available
    const effectiveSlug = targetSlug || slug;

    try {
        if (isTrusted) {
            await submitAsTrusted(effectiveSlug, title, artist, key, instrument, label);
        } else if (isLoggedIn) {
            await submitAsRegularUser(effectiveSlug, title, artist, key, instrument, label);
        } else {
            // Anonymous users should not reach here (gated by requireLogin)
            showStatus('Please sign in to upload.', true);
            return;
        }
    } catch (err) {
        console.error('Upload submission error:', err);
        showStatus(`Error: ${err.message}`, true);
    } finally {
        submitBtn.disabled = false;
    }
}

async function submitAsTrusted(slug, title, artist, key, instrument, label) {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) throw new Error('Not connected to database');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not logged in — please sign in and try again');

    // Get file as base64, applying rotation if needed
    let pdfBlob = convertedPdf || selectedFile;
    if (currentRotation) {
        pdfBlob = await applyPdfRotation(pdfBlob);
    }
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const base64 = btoa(new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), ''));

    const filename = selectedFile.type === 'application/pdf'
        ? selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        : slug + '.pdf';

    // Insert pending_songs entry (instant visibility)
    const user = window.SupabaseAuth?.getUser?.();
    const pendingEntry = {
        id: slug,
        replaces_id: null,
        title,
        artist,
        composer: null,
        content: '',
        key: key || null,
        mode: null,
        tags: {},
        created_by: user?.id || null,
    };

    const { error } = await supabase
        .from('pending_songs')
        .upsert(pendingEntry, { onConflict: 'id' });

    if (error) throw new Error(error.message);

    // Trigger auto-commit with attachment + create_placeholder
    const commitPayload = {
        id: slug,
        title,
        artist,
        content: null,
        create_placeholder: true,
        key: key || null,
        instrument: instrument || null,
        attachment: { filename, base64, label },
    };

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/auto-commit-song`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(commitPayload),
    });

    if (!resp.ok) {
        const body = await resp.text();
        console.warn('Auto-commit response:', body);
    }

    track('doc_upload_submit', { flow: 'trusted', has_artist: !!artist });

    // Stash PDF blob URL so work-view can display it immediately
    // (the real index won't have document_parts until CI rebuilds)
    if (!window.__pendingDocuments) window.__pendingDocuments = {};
    window.__pendingDocuments[slug] = {
        url: URL.createObjectURL(pdfBlob),
        label: label || title,
    };

    showStatus('Saved!');

    // Refresh and navigate to the new work
    if (window.refreshPendingSongs) await window.refreshPendingSongs();
    setTimeout(() => { window.location.hash = `#work/${slug}`; }, 500);
}

async function submitAsRegularUser(slug, title, artist, key, instrument, label) {
    const supabase = window.SupabaseAuth?.supabase;
    if (!supabase) throw new Error('Not connected to database');

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not logged in — please sign in and try again');

    let pdfBlob = convertedPdf || selectedFile;
    if (currentRotation) {
        pdfBlob = await applyPdfRotation(pdfBlob);
    }
    const filename = selectedFile.type === 'application/pdf'
        ? selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        : slug + '.pdf';

    // Upload to doc-staging bucket
    const storagePath = `${session.user.id}/${slug}/${filename}`;
    const { error: uploadError } = await supabase.storage
        .from('doc-staging')
        .upload(storagePath, pdfBlob, { contentType: 'application/pdf' });

    if (uploadError) throw new Error(uploadError.message);

    // Insert staging metadata
    const { error: dbError } = await supabase
        .from('doc_staging')
        .insert({
            user_id: session.user.id,
            work_id: slug,
            storage_path: storagePath,
            label,
            file_size: pdfBlob.size,
        });

    if (dbError) throw new Error(dbError.message);

    // Create GitHub issue for review
    await fetch(`${SUPABASE_URL}/functions/v1/create-song-request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
            songTitle: title,
            artist: artist || undefined,
            details: `Document upload (PDF/image) by logged-in user.${instrument ? ` Instrument: ${instrument}.` : ''}${label !== title ? ` Description: ${label}.` : ''} File staged at: ${storagePath}`,
            submittedBy: getSubmitterAttribution(),
        }),
    });

    track('doc_upload_submit', { flow: 'regular', has_artist: !!artist });
    showStatus('Submitted for review! You\'ll see it once approved.');

    setTimeout(resetForm, 2000);
}

// ============================================
// INITIALIZATION
// ============================================

export function initDocUpload() {
    uploadTitle = document.getElementById('upload-title');
    uploadArtist = document.getElementById('upload-artist');
    uploadKey = document.getElementById('upload-key');
    uploadInstrument = document.getElementById('upload-instrument');
    uploadDescription = document.getElementById('upload-description');
    dropzone = document.getElementById('upload-dropzone');
    fileInput = document.getElementById('upload-file-input');
    fileInfo = document.getElementById('upload-file-info');
    submitBtn = document.getElementById('upload-submit');
    statusEl = document.getElementById('upload-status');
    previewContent = document.getElementById('upload-preview-content');
    backBtn = document.getElementById('upload-back-btn');

    if (!dropzone) return;

    // Title input updates submit state
    uploadTitle?.addEventListener('input', updateSubmitState);

    // File input
    fileInput?.addEventListener('change', (e) => {
        if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
    });

    // Click to open file picker
    dropzone.addEventListener('click', () => fileInput?.click());

    // Drag and drop
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dropzone-active');
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dropzone-active');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dropzone-active');
        if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0]);
    });

    // Submit
    submitBtn?.addEventListener('click', submit);
}

/**
 * Pre-fill the upload form from placeholder context (contribute mode).
 */
export function prefillDocUpload(ctx) {
    if (ctx.title && uploadTitle) uploadTitle.value = ctx.title;
    if (ctx.artist && uploadArtist) uploadArtist.value = ctx.artist;
    if (ctx.key && uploadKey) uploadKey.value = ctx.key;
    if (ctx.targetSlug) targetSlug = ctx.targetSlug;
    updateSubmitState();
}

export function resetDocUpload() {
    resetForm();
}
