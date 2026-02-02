/**
 * Vision Event Engine - Frontend Application
 * 
 * Handles UI state, persistence, API interactions, and user experience.
 * @version 1.0.0
 */

// =============================================================================
// State Management
// =============================================================================

class Store {
    constructor() {
        this.lsKey = 'vee_config';
        this.state = this.load();
        this.proxiedState = new Proxy(this.state, {
            set: (target, key, value) => {
                target[key] = value;
                this.save();
                return true;
            }
        });
    }

    load() {
        try {
            const raw = localStorage.getItem(this.lsKey);
            const defaults = {
                strategy: 'A',
                mode: 'gemini',
                gemini_key: '',
                gemini_model: 'gemini-2.0-flash',
                openai_url: 'https://api.openai.com/v1',
                openai_key: '',
                openai_model: 'gpt-4o',
                ollama_url: 'http://localhost:11434',
                ollama_model: 'llama3',
                vram_mode: false,
                paddle_tier: 'eco'
            };
            return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
        } catch {
            return {};
        }
    }

    save() {
        localStorage.setItem(this.lsKey, JSON.stringify(this.state));
    }

    get() { return this.proxiedState; }
}

const store = new Store();
const state = store.get();

// Store last extraction result for export
let lastExtractionResult = null;
let processingStartTime = null;

// Confirmation dialog callback
let confirmCallback = null;

// =============================================================================
// Toast Notifications
// =============================================================================

const toast = {
    show(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            info: 'fa-info-circle'
        };

        const toastEl = document.createElement('div');
        toastEl.className = `toast ${type}`;
        toastEl.innerHTML = `
            <i class="fas ${icons[type]} toast-icon"></i>
            <span class="toast-message">${message}</span>
        `;

        container.appendChild(toastEl);

        // Auto-remove after animation
        setTimeout(() => toastEl.remove(), 3000);
    },

    success(message) { this.show(message, 'success'); },
    error(message) { this.show(message, 'error'); },
    info(message) { this.show(message, 'info'); }
};

// =============================================================================
// Loading State
// =============================================================================

const loading = {
    show(text = 'Processing...', subtext = 'Analyzing document') {
        const anchor = document.getElementById('results-anchor');
        if (anchor) {
            anchor.innerHTML = `
                <div class="empty-state">
                    <div class="loading-spinner" style="width: 32px; height: 32px; border-width: 2px; margin-bottom: 12px;"></div>
                    <div style="font-weight:600; margin-bottom:4px;">${text}</div>
                    <div class="empty-hint" id="loading-subtext">${subtext}</div>
                </div>
            `;
        }
    },

    hide() {
        // No explicit hide needed as renderResult overwrites the container
        // But we can reset to empty state if needed
    },

    update(subtext) {
        const subtextEl = document.getElementById('loading-subtext');
        if (subtextEl) subtextEl.textContent = subtext;
    }
};

// =============================================================================
// Confirmation Dialog
// =============================================================================

function showConfirm(title, message, callback) {
    const dialog = document.getElementById('confirm-dialog');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (dialog) dialog.classList.add('open');

    confirmCallback = callback;
}

function confirmOk() {
    const dialog = document.getElementById('confirm-dialog');
    if (dialog) dialog.classList.remove('open');
    if (confirmCallback) confirmCallback(true);
    confirmCallback = null;
}

function confirmCancel() {
    const dialog = document.getElementById('confirm-dialog');
    if (dialog) dialog.classList.remove('open');
    if (confirmCallback) confirmCallback(false);
    confirmCallback = null;
}

// =============================================================================
// UI Controller
// =============================================================================

const ui = {
    init: () => {
        ui.bindEvents();
        ui.bindKeyboardShortcuts();
        ui.bindDragDrop();
        ui.renderConfig();
        ui.pollPaddle();
        ui.pollLogs();
    },

    bindEvents: () => {
        // View navigation
        document.querySelectorAll('.dock-item[data-view]').forEach(item => {
            item.addEventListener('click', () => ui.switchView(item.dataset.view));
        });

        // Modal triggers
        document.querySelectorAll('[data-modal]').forEach(trigger => {
            trigger.addEventListener('click', () => {
                const modalId = trigger.dataset.modal;
                document.getElementById(modalId).classList.add('open');
                if (modalId === 'modal-hub') {
                    ui.renderConfig();
                    ui.checkPaddleStatus();
                }
            });
        });

        // Modal close on backdrop click
        document.querySelectorAll('.overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.classList.remove('open');
            });
        });

        // Strategy Selection
        document.querySelectorAll('.strategy-card').forEach(card => {
            card.addEventListener('click', () => {
                state.strategy = card.dataset.strategy;
                ui.renderConfig();
            });
        });

        // Bind all text inputs
        const bindInput = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = state[key] || '';
            el.addEventListener('input', (e) => state[key] = e.target.value);
        };

        bindInput('cfg-gemini-key', 'gemini_key');
        bindInput('cfg-gemini-model', 'gemini_model');
        bindInput('cfg-openai-url', 'openai_url');
        bindInput('cfg-openai-key', 'openai_key');
        bindInput('cfg-openai-model', 'openai_model');
        bindInput('cfg-ollama-url', 'ollama_url');
        bindInput('cfg-model', 'ollama_model');

        // Mode Tabs
        document.querySelectorAll('.tab[data-mode]').forEach(tab => {
            tab.addEventListener('click', () => {
                state.mode = tab.dataset.mode;
                ui.renderConfig();
            });
        });

        // File Input
        const fileIn = document.getElementById('file-upload');
        if (fileIn) {
            fileIn.addEventListener('change', (e) => {
                if (e.target.files.length) api.upload(e.target.files[0]);
            });
        }
    },

    bindKeyboardShortcuts: () => {
        document.addEventListener('keydown', (e) => {
            // Escape closes modals
            if (e.key === 'Escape') {
                document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
                return;
            }

            // Only handle shortcuts with Ctrl/Cmd
            if (!e.ctrlKey && !e.metaKey) return;

            switch (e.key.toLowerCase()) {
                case 'u':
                    e.preventDefault();
                    document.getElementById('file-upload')?.click();
                    break;
                case ',':
                    e.preventDefault();
                    document.getElementById('modal-hub')?.classList.add('open');
                    ui.renderConfig();
                    ui.checkPaddleStatus();
                    break;
                case 'l':
                    e.preventDefault();
                    document.getElementById('modal-logs')?.classList.add('open');
                    break;
                case 'h':
                    if (e.shiftKey) {
                        e.preventDefault();
                        ui.switchView('history');
                    }
                    break;
            }
        });
    },

    bindDragDrop: () => {
        const dropZone = document.getElementById('drop-zone');
        if (!dropZone) return;

        ['dragenter', 'dragover'].forEach(event => {
            dropZone.addEventListener(event, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(event => {
            dropZone.addEventListener(event, (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
            });
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                api.upload(files[0]);
            }
        });

        // Also handle drops on the whole document
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('image/')) {
                api.upload(files[0]);
            }
        });
    },

    switchView: (viewId) => {
        document.querySelectorAll('.dock-item').forEach(el => el.classList.remove('active'));
        document.querySelector(`.dock-item[data-view="${viewId}"]`)?.classList.add('active');
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');

        if (viewId === 'history') {
            api.fetchEvents();
        }
    },

    renderConfig: () => {
        // Strategy Cards
        document.querySelectorAll('.strategy-card').forEach(card => {
            card.classList.toggle('active', card.dataset.strategy === state.strategy);
        });

        // Hide LLM settings if Strategy C (Paddle Only) is selected
        const llmSection = document.getElementById('llm-config-section');
        if (llmSection) llmSection.classList.toggle('hidden', state.strategy === 'C');

        document.querySelectorAll('.tab[data-mode]').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === state.mode);
        });

        ['ollama', 'openai', 'gemini'].forEach(m => {
            const el = document.getElementById(`cfg-section-${m}`);
            if (el) el.classList.toggle('hidden', state.mode !== m);
        });

        // Dim Local Tier Hub if Strategy A is selected
        const tierHub = document.getElementById('localTierHub');
        if (tierHub) {
            tierHub.style.opacity = state.strategy === 'A' ? '0.4' : '1';
            tierHub.style.pointerEvents = state.strategy === 'A' ? 'none' : 'auto';
        }

        // Sync input values
        const syncInput = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.value = state[key] || '';
        };

        syncInput('cfg-gemini-key', 'gemini_key');
        syncInput('cfg-gemini-model', 'gemini_model');
        syncInput('cfg-openai-url', 'openai_url');
        syncInput('cfg-openai-key', 'openai_key');
        syncInput('cfg-openai-model', 'openai_model');
        syncInput('cfg-ollama-url', 'ollama_url');
        syncInput('cfg-model', 'ollama_model');
    },

    checkPaddleStatus: async () => {
        try {
            const res = await fetch('/api/paddle/status');
            const data = await res.json();

            state.paddle_tier = data.activeTier || 'eco';

            ['eco', 'lite', 'pro'].forEach(t => {
                const card = document.getElementById(`tier-${t}`);
                const status = document.getElementById(`status-${t}`);
                const btn = card?.querySelector('button');

                if (!card || !status) return;

                const isActive = state.paddle_tier === t;
                card.classList.toggle('active', isActive);

                if (state[`installing_${t}`]) {
                    status.innerText = 'Status: INSTALLING...';
                    status.style.color = 'var(--warning)';
                    if (btn) {
                        btn.innerText = 'Installing...';
                        btn.disabled = true;
                    }
                } else if (data.tiers[t]?.installed) {
                    status.innerText = (data.running && isActive) ? 'Status: RUNNING' : 'Status: READY';
                    status.style.color = 'var(--success)';
                    if (btn) {
                        btn.innerText = isActive ? 'Active' : 'Switch';
                        btn.disabled = false;
                    }
                } else {
                    status.innerText = 'Status: NOT INSTALLED';
                    status.style.color = 'var(--text-faint)';
                    if (btn) {
                        btn.innerText = 'Install';
                        btn.disabled = false;
                    }
                }
            });

            // Update Global Status Indicator
            const globalText = document.getElementById('system-status-text');
            const globalDot = document.getElementById('system-status-dot');

            if (globalText && globalDot) {
                if (data.running) {
                    globalText.innerText = 'SYSTEM ONLINE';
                    globalText.style.color = 'var(--success)';
                    globalDot.classList.add('online');
                } else {
                    globalText.innerText = 'SYSTEM OFFLINE';
                    globalText.style.color = 'var(--text-muted)';
                    globalDot.classList.remove('online');
                }
            }
        } catch { }
    },

    pollPaddle: () => {
        ui.checkPaddleStatus();
        setInterval(ui.checkPaddleStatus, 5000);
    },

    pollLogs: async () => {
        setInterval(async () => {
            try {
                const res = await fetch('/api/paddle/logs');
                const { logs } = await res.json();
                logs.forEach(msg => {
                    const isErr = msg.includes('[PADDLE_ERR]');
                    ui.log(isErr ? 'ERR' : 'EXEC', msg.replace('[PADDLE_ERR] ', ''), isErr ? 'err' : 'sys');
                });
            } catch { }
        }, 1000);
    },

    log: (tag, msg, type = 'info') => {
        const targets = ['sys-logs', 'full-logs'];
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });

        const isCommand = tag === 'CURL' || tag === 'INSIGHT' || tag === 'CMD';
        const isExec = tag === 'EXEC';
        const isNet = tag === 'NET';
        const isErr = tag === 'ERR';

        let entryClass = 'log-entry';
        let tagClass = `log-tag ${type}`;
        let displayTag = tag;

        if (isCommand) {
            entryClass = 'log-entry command';
            tagClass = 'log-tag cmd';
            displayTag = 'CURL';
        } else if (isExec) {
            entryClass = 'log-entry exec';
            tagClass = 'log-tag exec';
            displayTag = 'EXEC';
        } else if (isNet) {
            tagClass = 'log-tag net';
        } else if (isErr) {
            entryClass = 'log-entry err';
            tagClass = 'log-tag err';
        }

        const html = `<div class="${entryClass}"><span class="log-time">[${time}]</span><span class="${tagClass}">${displayTag}</span><span class="log-msg">${msg}</span></div>`;

        targets.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const div = document.createElement('div');
                div.innerHTML = html;
                if (div.firstChild) el.appendChild(div.firstChild);
                el.scrollTop = el.scrollHeight;
            }
        });
    },

    renderResult: (data) => {
        const anchor = document.getElementById('results-anchor');
        const actions = document.getElementById('result-actions');
        if (!anchor) return;

        anchor.innerHTML = '';
        lastExtractionResult = data;

        // Show export actions
        if (actions) actions.style.display = 'flex';

        Object.entries(data).forEach(([k, v]) => {
            if (typeof v === 'object') return;
            const div = document.createElement('div');
            div.className = 'card';
            div.innerHTML = `<div class="card-label">${k}</div><div class="card-value">${v}</div>`;
            anchor.appendChild(div);
        });

        // Show processing time
        if (processingStartTime) {
            const elapsed = ((Date.now() - processingStartTime) / 1000).toFixed(1);
            const timeEl = document.getElementById('processing-time');
            if (timeEl) timeEl.textContent = `Processed in ${elapsed}s`;
        }
    },

    renderHistory: (events) => {
        const list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '';

        if (!events || events.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="grid-column: span 3;">
                    <i class="fas fa-folder-open"></i>
                    <div>No Records Found</div>
                    <div class="empty-hint">Extracted documents will appear here</div>
                </div>
            `;
            return;
        }

        events.forEach(event => {
            const date = new Date(event.created_at).toLocaleString();
            const card = document.createElement('div');
            card.className = 'history-card';

            const title = event.title || event.event_name || event.merchant || "Untitled Event";

            card.innerHTML = `
                <button class="delete-btn" onclick="deleteEvent('${event.id}', event)" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
                <div class="date">${date}</div>
                <div class="title">${title}</div>
                <div class="meta">
                    <div class="meta-item"><i class="fas fa-tag"></i> ${event.id.slice(0, 8)}</div>
                    ${event.amount ? `<div class="meta-item"><i class="fas fa-dollar-sign"></i> ${event.amount}</div>` : ''}
                </div>
            `;

            card.onclick = (e) => {
                if (e.target.closest('.delete-btn')) return;
                ui.switchView('ingest');
                ui.renderResult(event);
            };

            list.appendChild(card);
        });
    }
};

// =============================================================================
// Utility Functions
// =============================================================================

const tools = {
    compressImage: (file, maxWidth, quality) => {
        return new Promise((resolve, reject) => {
            const tm = setTimeout(() => reject(new Error("Compression Timeout")), 5000);

            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    if (width > maxWidth) {
                        height = (maxWidth / width) * height;
                        width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const result = canvas.toDataURL('image/jpeg', quality).split(',')[1];
                    clearTimeout(tm);
                    resolve(result);
                };
                img.onerror = (e) => { clearTimeout(tm); reject(e); };
            };
            reader.onerror = (e) => { clearTimeout(tm); reject(e); };
        });
    }
};

// =============================================================================
// API Layer
// =============================================================================

const api = {
    upload: async (file) => {
        ui.switchView('ingest');
        processingStartTime = Date.now();

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.querySelector('#media-preview img');
            if (img) img.src = e.target.result;
        };
        reader.readAsDataURL(file);

        // Clear previous results
        const anchor = document.getElementById('results-anchor');
        if (anchor) {
            anchor.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-spinner fa-spin"></i>
                    <div>Processing...</div>
                    <div class="empty-hint">Extracting data from your document</div>
                </div>
            `;
        }

        // Compress image
        let compressedBase64 = null;
        if (file.type.startsWith('image/') && !state.vram_mode) {
            loading.show('Preparing...', 'Compressing image');
            try {
                compressedBase64 = await tools.compressImage(file, 2048, 0.8);
            } catch { }
        }

        loading.show('Processing...', 'Uploading to server');

        const fd = new FormData();
        fd.append('file', file);

        try {
            ui.log('EXEC', `[UPLOAD] ${file.name} (${Math.round(file.size / 1024)}KB)`, 'sys');
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            loading.update('Analyzing with AI...');
            await api.reason(data.text, compressedBase64);

            loading.hide();
            toast.success('Extraction complete!');

        } catch (e) {
            loading.hide();
            toast.error(`Upload failed: ${e.message}`);
            ui.log('ERR', e.message, 'err');
        }
    },

    reason: async (text, base64Image) => {
        let provider_url, api_key, model;

        if (state.mode === 'gemini') {
            provider_url = 'https://generativelanguage.googleapis.com';
            api_key = state.gemini_key;
            model = state.gemini_model || 'gemini-2.0-flash';
        } else if (state.mode === 'openai') {
            provider_url = state.openai_url || 'https://api.openai.com/v1';
            api_key = state.openai_key;
            model = state.openai_model || 'gpt-4o';
        } else {
            provider_url = state.ollama_url || 'http://localhost:11434';
            api_key = '';
            model = state.ollama_model || 'llama3';
        }

        if (state.strategy === 'C') {
            model = 'PaddleOCR-VL-1.5';
        }

        ui.log('EXEC', `[PIPELINE] Strategy: ${state.strategy} | Model: ${model}`, 'sys');

        try {
            const payload = {
                ocr_text: text,
                base64_image: base64Image || undefined,
                model,
                today_date: new Date().toISOString(),
                api_key,
                provider_url,
                strategy: state.strategy
            };

            const res = await fetch('/api/parse-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let finalJson = {};

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.type === 'log') {
                            ui.log(msg.tag || 'SYS', msg.message, 'sys');
                            loading.update(msg.message.substring(0, 50) + '...');
                        }
                        if (msg.type === 'error') {
                            ui.log('ERR', msg.message, 'err');
                            toast.error(msg.message);
                        }
                        if (msg.type === 'final') {
                            finalJson = msg.event;
                            ui.renderResult(finalJson);
                        }
                    } catch { }
                }
            }

        } catch (e) {
            ui.log('ERR', `Request failed: ${e.message}`, 'err');
            toast.error(`Extraction failed: ${e.message}`);
        }
    },

    fetchEvents: async () => {
        try {
            ui.log('EXEC', '[DB] Fetching records...', 'sys');
            const res = await fetch('/api/events');
            const events = await res.json();
            ui.renderHistory(events);
        } catch (e) {
            ui.log('ERR', `Failed to fetch history: ${e.message}`, 'err');
        }
    },

    deleteEvent: async (id) => {
        try {
            const res = await fetch(`/api/events/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Event deleted');
                api.fetchEvents();
            } else {
                throw new Error('Delete failed');
            }
        } catch (e) {
            toast.error(e.message);
        }
    }
};

// =============================================================================
// Export Functions
// =============================================================================

function exportJSON() {
    if (!lastExtractionResult) {
        toast.info('No data to export');
        return;
    }
    const blob = new Blob([JSON.stringify(lastExtractionResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extraction-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('JSON exported');
}

function exportCSV() {
    if (!lastExtractionResult) {
        toast.info('No data to export');
        return;
    }
    const keys = Object.keys(lastExtractionResult).filter(k => typeof lastExtractionResult[k] !== 'object');
    const values = keys.map(k => `"${String(lastExtractionResult[k]).replace(/"/g, '""')}"`);
    const csv = keys.join(',') + '\n' + values.join(',');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extraction-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
}

function copyToClipboard() {
    if (!lastExtractionResult) {
        toast.info('No data to copy');
        return;
    }
    navigator.clipboard.writeText(JSON.stringify(lastExtractionResult, null, 2))
        .then(() => toast.success('Copied to clipboard'))
        .catch(() => toast.error('Failed to copy'));
}

// =============================================================================
// Global Functions
// =============================================================================

function saveAndClose() {
    toast.success('Configuration saved');
    document.getElementById('modal-hub')?.classList.remove('open');
}

function clearLogs() {
    document.getElementById('full-logs').innerHTML = 'Logs cleared.';
    document.getElementById('sys-logs').innerHTML = '';
    toast.info('Logs cleared');
}

function deleteEvent(id, event) {
    event.stopPropagation();
    showConfirm('Delete Event', 'Are you sure you want to delete this event? This cannot be undone.', (confirmed) => {
        if (confirmed) api.deleteEvent(id);
    });
}

window.setTier = async (tier) => {
    state.paddle_tier = tier;
    ui.log('SYS', `Switching to: ${tier.toUpperCase()}`, 'sys');
    try {
        await fetch('/api/paddle/tier', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier })
        });
        ui.checkPaddleStatus();
        toast.success(`Switched to ${tier.toUpperCase()} tier`);
    } catch (e) {
        toast.error(`Failed to switch tier: ${e.message}`);
    }
};

window.installTier = async (tier, event) => {
    if (event) event.stopPropagation();

    const resStatus = await fetch('/api/paddle/status');
    const statusData = await resStatus.json();
    if (statusData.tiers[tier]?.installed) {
        return window.setTier(tier);
    }

    state[`installing_${tier}`] = true;
    ui.checkPaddleStatus();
    toast.info(`Installing ${tier.toUpperCase()} tier...`);

    try {
        await fetch('/api/paddle/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier })
        });

        setTimeout(() => {
            state[`installing_${tier}`] = false;
            ui.checkPaddleStatus();
        }, 10000);
    } catch (e) {
        state[`installing_${tier}`] = false;
        toast.error(`Installation failed: ${e.message}`);
        ui.checkPaddleStatus();
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', ui.init);
