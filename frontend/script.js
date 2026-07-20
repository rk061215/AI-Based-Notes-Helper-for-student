document.addEventListener('DOMContentLoaded', () => {

    // ── DOM references ──
    const inputText       = document.getElementById('inputText');
    const fileInput       = document.getElementById('fileInput');
    const fileLabel       = document.getElementById('fileLabel');
    const clearFileBtn    = document.getElementById('clearFileBtn');
    const generateBtn     = document.getElementById('generateBtn');
    const btnText         = document.querySelector('.btn-text');
    const genLoader       = document.querySelector('#generateBtn .loader');
    const outputContainer = document.getElementById('outputContainer');
    const outputText      = document.getElementById('outputText');
    const errorContainer  = document.getElementById('errorContainer');
    const errorTextEl     = document.getElementById('errorText');
    const saveBtn         = document.getElementById('saveBtn');
    const saveBtnText     = document.querySelector('.save-btn-text');
    const saveLoader      = document.getElementById('saveLoader');
    const searchInput     = document.getElementById('searchInput');
    const searchClearBtn  = document.getElementById('searchClearBtn');

    // ── API URL Configuration ──
    // - If hosted together (e.g. on Render), it uses the same origin.
    // - If running frontend locally (e.g., via http-server on port 3000), it redirects to FastAPI on port 8000.
    // - If deploying frontend on Vercel separately, change this URL to your deployed Render backend URL.
    const API = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
        ? (window.location.port === '3000' ? 'http://127.0.0.1:8000' : window.location.origin)
        : window.location.origin; // Replace with your Render backend URL if deploying frontend to Vercel separately

    // State: track last generated data for the Save button
    let lastInput   = '';
    let lastOutput  = '';
    let lastMode    = 'exam';
    let lastFileUrl = '';

    // ─────────────────────────────────────────────
    //   TOAST — fixed at page-body level, not inside a tab div
    // ─────────────────────────────────────────────
    // Create a single persistent toast element appended to <body>
    const toast = document.createElement('div');
    toast.id    = 'globalToast';
    toast.className = 'toast hidden';
    document.body.appendChild(toast);
    let toastTimer;

    function showToast(msg, type = 'success') {
        toast.textContent = msg;
        toast.className = `toast toast-${type}`;   // visible
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.className = 'toast hidden';
        }, 3000);
    }

    // ─────────────────────────────────────────────
    //   TAB SWITCHING
    // ─────────────────────────────────────────────
    window.switchTab = function(tab) {
        const isGenerate = tab === 'generate';
        document.getElementById('tabGenerate').classList.toggle('hidden', !isGenerate);
        document.getElementById('tabLibrary').classList.toggle('hidden', isGenerate);
        document.getElementById('tabGenerateBtn').classList.toggle('active', isGenerate);
        document.getElementById('tabLibraryBtn').classList.toggle('active', !isGenerate);
        if (!isGenerate) loadNotes();
    };

    // ─────────────────────────────────────────────
    //   FILE INPUT HANDLERS
    // ─────────────────────────────────────────────
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            fileLabel.textContent = `📎 ${fileInput.files[0].name}`;
            clearFileBtn.classList.remove('hidden');
        } else {
            resetFileInput();
        }
    });

    clearFileBtn.addEventListener('click', resetFileInput);

    function resetFileInput() {
        fileInput.value = '';
        fileLabel.textContent = 'Choose PDF or Image';
        clearFileBtn.classList.add('hidden');
    }

    // ─────────────────────────────────────────────
    //   GENERATE NOTES
    // ─────────────────────────────────────────────
    generateBtn.addEventListener('click', async () => {
        const text = inputText.value.trim();
        const mode = document.getElementById('modeSelect').value;
        const file = fileInput.files[0];

        errorContainer.classList.add('hidden');
        outputContainer.classList.add('hidden');
        lastFileUrl = '';

        if (!text && !file) {
            showError('Please paste some text or upload a PDF/image file first.');
            return;
        }

        setGenLoading(true, file ? 'Processing file...' : 'Generating Notes...');

        try {
            const formData = new FormData();
            formData.append('mode', mode);
            if (file) {
                formData.append('file', file);
            } else {
                formData.append('text', text);
            }

            const res = await fetch(`${API}/summarize`, { method: 'POST', body: formData });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.detail || `Server error: ${res.status}`);
            }

            const data = await res.json();
            lastInput   = data.input_text || text;
            lastOutput  = data.notes;
            lastMode    = mode;
            lastFileUrl = data.file_url || '';

            renderOutput(data.notes);

        } catch (err) {
            showError(err.message === 'Failed to fetch'
                ? 'Cannot connect to backend. Make sure Uvicorn is running on http://127.0.0.1:8000.'
                : err.message);
        } finally {
            setGenLoading(false);
        }
    });

    function setGenLoading(on, label = 'Generate Notes') {
        generateBtn.disabled = on;
        btnText.textContent = on ? label : 'Generate Notes';
        genLoader.classList.toggle('hidden', !on);
    }

    function renderOutput(md) {
        outputText.innerHTML = typeof marked !== 'undefined'
            ? marked.parse(md)
            : md.replace(/\n/g, '<br>');
        outputContainer.classList.remove('hidden');
        setTimeout(() => outputContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }

    // ─────────────────────────────────────────────
    //   SAVE NOTE
    // ─────────────────────────────────────────────
    saveBtn.addEventListener('click', async () => {
        if (!lastOutput) return;

        saveBtn.disabled = true;
        saveBtnText.textContent = 'Saving...';
        saveLoader.classList.remove('hidden');

        try {
            const res = await fetch(`${API}/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: '',
                    input_text: lastInput,
                    output_text: lastOutput,
                    mode: lastMode,
                    file_url: lastFileUrl,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.detail || 'Failed to save note.');
            }

            showToast('✅ Note saved successfully!', 'success');

        } catch (err) {
            showError(err.message);
        } finally {
            saveBtn.disabled = false;
            saveBtnText.textContent = '💾 Save Note';
            saveLoader.classList.add('hidden');
        }
    });

    // ─────────────────────────────────────────────
    //   LOAD & RENDER NOTES LIBRARY
    // ─────────────────────────────────────────────
    async function loadNotes(query = '') {
        const notesList    = document.getElementById('notesList');
        const notesLoading = document.getElementById('notesLoading');
        const emptyState   = document.getElementById('emptyState');

        notesList.innerHTML = '';
        notesLoading.classList.remove('hidden');
        emptyState.classList.add('hidden');

        try {
            const url = query
                ? `${API}/search?q=${encodeURIComponent(query)}`
                : `${API}/notes`;

            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to load notes.');
            const notes = await res.json();

            notesLoading.classList.add('hidden');

            if (notes.length === 0) {
                emptyState.classList.remove('hidden');
                return;
            }

            renderNotes(notes);

        } catch (err) {
            notesLoading.classList.add('hidden');
            document.getElementById('notesList').innerHTML =
                `<p class="error-inline">⚠️ ${err.message}</p>`;
        }
    }

    // Build note cards using DOM API (safe — no template-literal escaping issues)
    function renderNotes(notes) {
        const notesList = document.getElementById('notesList');
        notesList.innerHTML = '';

        notes.forEach(note => {
            const card = document.createElement('div');
            card.className = 'note-card';
            card.dataset.id = note.id;

            // ── Header ──
            const header = document.createElement('div');
            header.className = 'note-card-header';

            const titleEl = document.createElement('span');
            titleEl.className = 'note-title';
            titleEl.textContent = note.title || 'Untitled Note';

            // Delete icon button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'note-delete-btn';
            deleteBtn.title = 'Delete note';
            deleteBtn.innerHTML = '🗑';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDelete(note.id, card);
            });

            header.append(titleEl, deleteBtn);

            // ── Meta ──
            const meta = document.createElement('div');
            meta.className = 'note-meta';

            const badge = document.createElement('span');
            badge.className = `note-mode-badge ${note.mode}`;
            badge.textContent = note.mode === 'exam' ? '📖 Exam' : '📅 Daily';

            const dateEl = document.createElement('span');
            dateEl.className = 'note-date';
            dateEl.textContent = formatDate(note.created_at);

            meta.append(badge, dateEl);

            // ── Preview ──
            const preview = document.createElement('div');
            preview.className = 'note-preview';
            preview.textContent = stripMarkdown(note.output_text).slice(0, 120) + '...';

            // ── Actions ──
            const actions = document.createElement('div');
            actions.className = 'note-actions';

            const viewBtn = document.createElement('button');
            viewBtn.className = 'note-action-btn view-btn';
            viewBtn.textContent = '👁 View Notes';
            viewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openModal(note);
            });
            actions.appendChild(viewBtn);

            if (note.file_url) {
                const fileBtn = document.createElement('button');
                fileBtn.className = 'note-action-btn file-btn';
                fileBtn.textContent = '📄 View Original File';
                fileBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.open(note.file_url, '_blank');
                });
                actions.appendChild(fileBtn);
            }

            // ── Inline delete confirmation bar (hidden by default) ──
            const confirmBar = document.createElement('div');
            confirmBar.className = 'confirm-bar hidden';
            confirmBar.innerHTML = `
                <span>Delete this note?</span>
                <button class="confirm-yes-btn">Yes, Delete</button>
                <button class="confirm-no-btn">Cancel</button>
            `;
            confirmBar.querySelector('.confirm-yes-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteNote(note.id, card);
            });
            confirmBar.querySelector('.confirm-no-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                confirmBar.classList.add('hidden');
            });

            card.append(header, meta, preview, actions, confirmBar);
            card.addEventListener('click', () => openModal(note));

            notesList.appendChild(card);
        });
    }

    // Show the inline confirmation bar instead of using window.confirm()
    function confirmDelete(id, card) {
        const bar = card.querySelector('.confirm-bar');
        bar.classList.toggle('hidden');
    }

    // ─────────────────────────────────────────────
    //   DELETE NOTE
    // ─────────────────────────────────────────────
    async function deleteNote(id, cardElement) {
        try {
            const res = await fetch(`${API}/note/${id}`, { method: 'DELETE' });

            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.detail || 'Failed to delete note.');
            }

            // Animate removal and remove from DOM
            cardElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            cardElement.style.opacity = '0';
            cardElement.style.transform = 'translateX(20px)';
            setTimeout(() => {
                cardElement.remove();
                if (document.querySelectorAll('.note-card').length === 0) {
                    document.getElementById('emptyState').classList.remove('hidden');
                }
            }, 300);

            showToast('🗑 Note deleted.', 'delete');

        } catch (err) {
            showToast(`❌ Error: ${err.message}`, 'error');
        }
    }

    // ─────────────────────────────────────────────
    //   NOTE DETAIL MODAL
    // ─────────────────────────────────────────────
    function openModal(note) {
        document.getElementById('modalTitle').textContent = note.title || 'Untitled Note';
        document.getElementById('modalMeta').innerHTML = `
            <span class="note-mode-badge ${note.mode}">${note.mode === 'exam' ? '📖 Exam Notes' : '📅 Daily Study'}</span>
            <span class="note-date">${formatDate(note.created_at)}</span>
            ${note.file_url ? `<a href="${note.file_url}" target="_blank" class="modal-file-link">📄 View Original File</a>` : ''}
        `;
        const body = document.getElementById('modalBody');
        body.innerHTML = typeof marked !== 'undefined'
            ? marked.parse(note.output_text)
            : note.output_text.replace(/\n/g, '<br>');
        document.getElementById('noteModal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    window.closeModal = function() {
        document.getElementById('noteModal').classList.add('hidden');
        document.body.style.overflow = '';
    };

    document.getElementById('noteModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('noteModal')) closeModal();
    });

    // ─────────────────────────────────────────────
    //   SEARCH (debounced)
    // ─────────────────────────────────────────────
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim();
        searchClearBtn.classList.toggle('hidden', !q);
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => loadNotes(q), 400);
    });

    window.clearSearch = function() {
        searchInput.value = '';
        searchClearBtn.classList.add('hidden');
        loadNotes();
    };

    // ─────────────────────────────────────────────
    //   UTILITY FUNCTIONS
    // ─────────────────────────────────────────────

    function showError(msg) {
        errorTextEl.textContent = msg;
        errorContainer.classList.remove('hidden');
    }

    function formatDate(iso) {
        if (!iso) return '';
        return new Date(iso).toLocaleDateString('en-IN', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    }

    function stripMarkdown(text) {
        return String(text)
            .replace(/#{1,6}\s?/g, '')
            .replace(/\*\*|__|\*|_|~~/g, '')
            .replace(/`/g, '')
            .replace(/\n/g, ' ')
            .trim();
    }

});
