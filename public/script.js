/**
 * EventEngine Core v14.0
 * Handles UI state, persistence, and API interactions.
 */

// --- State Management ---
class Store {
    constructor() {
        this.lsKey = 'ee_config_v1';
        this.state = this.load();

        // Auto-save on any change to specific keys
        this.proxiedState = new Proxy(this.state, {
            set: (target, key, value) => {
                target[key] = value;
                if (['mode', 'openai_key', 'gemini_key', 'openai_url', 'model', 'vram_mode'].includes(key)) {
                    this.save();
                }
                return true;
            }
        });
    }

    load() {
        try {
            const raw = localStorage.getItem(this.lsKey);
            const defaults = {
                mode: 'ollama',
                openai_url: 'https://api.openai.com/v1',
                openai_key: '',
                gemini_key: '',
                gemini_model: 'gemini-2.0-flash',
                model: 'llava',
                vram_mode: false,
                models_cache: []
            };
            return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
        } catch (e) {
            return {};
        }
    }

    save() {
        localStorage.setItem(this.lsKey, JSON.stringify(this.state));
        console.log('[Store] Config persisted to LocalStorage');
    }

    get() { return this.proxiedState; }
}

const store = new Store();
const state = store.get();

// --- UI Controller ---
const ui = {
    init: () => {
        ui.bindEvents();
        ui.renderConfig();
        // Check health on load
        api.checkHealth();
    },

    bindEvents: () => {
        // Dock Navigation
        document.querySelectorAll('.dock-item[data-view]').forEach(item => {
            item.addEventListener('click', () => {
                const viewId = item.dataset.view;
                ui.switchView(viewId);
            });
        });

        // Modals
        document.querySelectorAll('[data-modal]').forEach(trigger => {
            trigger.addEventListener('click', () => {
                const modalId = trigger.dataset.modal;
                document.getElementById(modalId).classList.add('open');
                if (modalId === 'modal-hub') ui.renderConfig(); // Refresh inputs
            });
        });

        document.querySelectorAll('.overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.classList.remove('open');
            });
        });

        // Inputs (Auto-Persist)
        const bindInput = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = state[key] || '';
            el.addEventListener('input', (e) => {
                state[key] = e.target.value; // Triggers Proxy save
            });
        };

        bindInput('cfg-openai-url', 'openai_url');
        bindInput('cfg-openai-key', 'openai_key');
        bindInput('cfg-gemini-key', 'gemini_key');
        bindInput('cfg-model', 'model');

        // Gemini model select
        const geminiModelEl = document.getElementById('cfg-gemini-model');
        if (geminiModelEl) {
            geminiModelEl.value = state.gemini_model || 'gemini-2.0-flash';
            geminiModelEl.addEventListener('change', (e) => {
                state.gemini_model = e.target.value;
            });
        }

        // Checkboxes
        const vramEl = document.getElementById('cfg-vram');
        if (vramEl) {
            vramEl.checked = state.vram_mode;
            vramEl.addEventListener('change', (e) => state.vram_mode = e.target.checked);
        }

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

    switchView: (viewId) => {
        // Update Dock
        document.querySelectorAll('.dock-item').forEach(el => el.classList.remove('active'));
        document.querySelector(`.dock-item[data-view="${viewId}"]`)?.classList.add('active');

        // Update View
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
    },

    renderConfig: () => {
        // Update Tabs
        document.querySelectorAll('.tab[data-mode]').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === state.mode);
        });

        // Show/Hide Sections
        ['ollama', 'openai', 'gemini'].forEach(m => {
            const el = document.getElementById(`cfg-section-${m}`);
            if (el) el.classList.toggle('hidden', state.mode !== m);
        });

        // Populate specific inputs again to be safe
        if (document.getElementById('cfg-openai-key')) document.getElementById('cfg-openai-key').value = state.openai_key;
        if (document.getElementById('cfg-gemini-key')) document.getElementById('cfg-gemini-key').value = state.gemini_key;
        if (document.getElementById('cfg-openai-url')) document.getElementById('cfg-openai-url').value = state.openai_url;
    },

    log: (tag, msg, type = 'info') => {
        const targets = ['sys-logs', 'full-logs'];
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const isCommand = tag === 'INSIGHT' || tag === 'CMD';
        const entryClass = isCommand ? 'log-entry command' : 'log-entry';
        const tagClass = isCommand ? 'log-tag cmd' : `log-tag ${type}`;
        const displayTag = isCommand ? 'CURL' : tag;
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
        if (!anchor) return;

        // Clear previous
        anchor.innerHTML = '';

        Object.entries(data).forEach(([k, v]) => {
            if (typeof v === 'object') return; // Skip complex nested for now
            const div = document.createElement('div');
            div.className = 'card';
            div.innerHTML = `<div class="card-label">${k}</div><div class="card-value">${v}</div>`;
            anchor.appendChild(div);
        });
    }
};

// --- Tools ---
const tools = {
    compressImage: (file, maxWidth, quality) => {
        return new Promise((resolve, reject) => {
            console.log('[Tools] Starting compression...');
            const tm = setTimeout(() => {
                console.warn('[Tools] Compression timed out');
                reject(new Error("Compression Timeout"));
            }, 5000); // 5s timeout

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
                    console.log('[Tools] Compression complete');
                    clearTimeout(tm);
                    resolve(result);
                };
                img.onerror = (e) => { clearTimeout(tm); reject(e); };
            };
            reader.onerror = (e) => { clearTimeout(tm); reject(e); };
        });
    }
};

// --- API Client ---
const api = {
    checkHealth: async () => {
        ui.log('SYS', 'Checking connection status...', 'sys');
        // Mock health check for now or implement real one
        // In real app, fetch('/api/health')
    },

    upload: async (file) => {
        ui.switchView('ingest');
        ui.log('IO', `Reading file: ${file.name}...`, 'sys');

        // Preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.querySelector('#media-preview img');
            if (img) img.src = e.target.result;
        };
        reader.readAsDataURL(file);

        // Basic Client-Side Compression
        let compressedBase64 = null;
        if (file.type.startsWith('image/') && !state.vram_mode) {
            ui.log('SYS', 'Optimizing visual buffer...', 'sys');
            try {
                compressedBase64 = await tools.compressImage(file, 2048, 0.8);
            } catch (e) {
                console.error(e);
            }
        }

        const fd = new FormData();
        fd.append('file', file);

        try {
            ui.log('NET', 'Uploading to Core...', 'net');
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            ui.log('OCR', `Text extracted: ${data.text.length} chars`, 'success');

            // Start Reasoning with Visual Context
            api.reason(data.text, compressedBase64);

        } catch (e) {
            ui.log('ERR', e.message, 'err');
        }
    },

    reason: async (text, base64Image) => {
        ui.log('AI', 'Initializing Reasoning Engine...', 'sys');
        ui.log('KER', 'Loading Cognitive Matrix...', 'sys');
        ui.log('NET', 'Establishing High-Bandwidth Link...', 'net');

        try {
            const payload = {
                ocr_text: text,
                base64_image: base64Image || undefined,
                model: state.mode === 'gemini' ? (state.gemini_model || 'gemini-2.0-flash') : state.model,
                today_date: new Date().toISOString(),
                // Add keys based on mode
                api_key: state.mode === 'openai' ? state.openai_key : (state.mode === 'gemini' ? state.gemini_key : ''),
                provider_url: state.mode === 'gemini'
                    ? 'https://generativelanguage.googleapis.com'
                    : (state.mode === 'openai' ? state.openai_url : 'http://localhost:11434')
            };

            const res = await fetch('/api/parse-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // Handle Stream...
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
                        if (msg.type === 'log') ui.log(msg.tag || 'AI', msg.message, 'sys');
                        if (msg.type === 'error') {
                            ui.log('ERR', msg.message, 'err');
                            alert(`Error: ${msg.message}`);
                        }
                        if (msg.type === 'final') {
                            finalJson = msg.event;
                            ui.renderResult(finalJson);
                        }
                    } catch (e) { }
                }
            }

        } catch (e) {
            ui.log('ERR', `Reasoning Failed: ${e.message}`, 'err');
        }
    }
};

// Start
document.addEventListener('DOMContentLoaded', ui.init);
