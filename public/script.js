/**
 * Vision Event Engine
 * Handles UI state, persistence, and API interactions.
 */

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
                mode: 'gemini',
                gemini_key: '',
                gemini_model: 'gemini-2.5-flash',
                openai_url: 'https://api.openai.com/v1',
                openai_key: '',
                openai_model: 'gpt-4o',
                ollama_url: 'http://localhost:11434',
                ollama_model: 'llama3',
                vram_mode: false
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

const ui = {
    init: () => {
        ui.bindEvents();
        ui.renderConfig();
    },

    bindEvents: () => {
        document.querySelectorAll('.dock-item[data-view]').forEach(item => {
            item.addEventListener('click', () => ui.switchView(item.dataset.view));
        });

        document.querySelectorAll('[data-modal]').forEach(trigger => {
            trigger.addEventListener('click', () => {
                const modalId = trigger.dataset.modal;
                document.getElementById(modalId).classList.add('open');
                if (modalId === 'modal-hub') ui.renderConfig();
            });
        });

        document.querySelectorAll('.overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.classList.remove('open');
            });
        });

        // Bind all text inputs
        const bindInput = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = state[key] || '';
            el.addEventListener('input', (e) => state[key] = e.target.value);
        };

        // Gemini
        bindInput('cfg-gemini-key', 'gemini_key');
        bindInput('cfg-gemini-model', 'gemini_model');

        // OpenAI
        bindInput('cfg-openai-url', 'openai_url');
        bindInput('cfg-openai-key', 'openai_key');
        bindInput('cfg-openai-model', 'openai_model');

        // Ollama
        bindInput('cfg-ollama-url', 'ollama_url');
        bindInput('cfg-model', 'ollama_model');

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
        document.querySelectorAll('.dock-item').forEach(el => el.classList.remove('active'));
        document.querySelector(`.dock-item[data-view="${viewId}"]`)?.classList.add('active');
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');

        if (viewId === 'history') {
            api.fetchEvents();
        }
    },

    renderConfig: () => {
        document.querySelectorAll('.tab[data-mode]').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === state.mode);
        });

        ['ollama', 'openai', 'gemini'].forEach(m => {
            const el = document.getElementById(`cfg-section-${m}`);
            if (el) el.classList.toggle('hidden', state.mode !== m);
        });

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

    log: (tag, msg, type = 'info') => {
        const targets = ['sys-logs', 'full-logs'];
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });

        const isCommand = tag === 'CURL' || tag === 'INSIGHT' || tag === 'CMD';
        const isExec = tag === 'EXEC';

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
        if (!anchor) return;
        anchor.innerHTML = '';

        Object.entries(data).forEach(([k, v]) => {
            if (typeof v === 'object') return;
            const div = document.createElement('div');
            div.className = 'card';
            div.innerHTML = `<div class="card-label">${k}</div><div class="card-value">${v}</div>`;
            anchor.appendChild(div);
        });
    },

    renderHistory: (events) => {
        const list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '';

        if (!events || events.length === 0) {
            list.innerHTML = '<div style="grid-column: span 3; text-align: center; padding: 100px; color: var(--text-muted);">No historical records found.</div>';
            return;
        }

        events.forEach(event => {
            const date = new Date(event.created_at).toLocaleString();
            const card = document.createElement('div');
            card.className = 'history-card';

            // Try to find a good title from the event data
            const title = event.title || event.event_name || event.merchant || "Untitled Event";

            card.innerHTML = `
                <div class="date">${date}</div>
                <div class="title">${title}</div>
                <div class="meta">
                    <div class="meta-item"><i class="fas fa-tag"></i> ${event.id.slice(0, 8)}</div>
                    ${event.amount ? `<div class="meta-item"><i class="fas fa-dollar-sign"></i> ${event.amount}</div>` : ''}
                </div>
            `;

            card.onclick = () => {
                ui.switchView('ingest');
                ui.renderResult(event);
                const img = document.querySelector('#media-preview img');
                if (img) img.src = ''; // Clear preview as we don't store images in DB yet
            };

            list.appendChild(card);
        });
    }
};

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

const api = {
    upload: async (file) => {
        ui.switchView('ingest');

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.querySelector('#media-preview img');
            if (img) img.src = e.target.result;
        };
        reader.readAsDataURL(file);

        let compressedBase64 = null;
        if (file.type.startsWith('image/') && !state.vram_mode) {
            ui.log('EXEC', `[COMPRESS] Resizing image...`, 'sys');
            try {
                compressedBase64 = await tools.compressImage(file, 2048, 0.8);
            } catch { /* ignore */ }
        }

        const fd = new FormData();
        fd.append('file', file);

        try {
            ui.log('EXEC', `[UPLOAD] POST /api/upload | ${file.name} (${Math.round(file.size / 1024)}KB)`, 'sys');
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            api.reason(data.text, compressedBase64);

        } catch (e) {
            ui.log('ERR', e.message, 'err');
        }
    },

    reason: async (text, base64Image) => {
        // Build config based on selected mode
        let provider_url, api_key, model;

        if (state.mode === 'gemini') {
            provider_url = 'https://generativelanguage.googleapis.com';
            api_key = state.gemini_key;
            model = state.gemini_model || 'gemini-2.5-flash';
        } else if (state.mode === 'openai') {
            provider_url = state.openai_url || 'https://api.openai.com/v1';
            api_key = state.openai_key;
            model = state.openai_model || 'gpt-4o';
        } else {
            provider_url = state.ollama_url || 'http://localhost:11434';
            api_key = '';
            model = state.ollama_model || 'llama3';
        }

        ui.log('EXEC', `[REQUEST] POST /api/parse-sync | provider=${state.mode} model=${model}`, 'sys');

        try {
            const payload = {
                ocr_text: text,
                base64_image: base64Image || undefined,
                model,
                today_date: new Date().toISOString(),
                api_key,
                provider_url
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
                        if (msg.type === 'log') ui.log(msg.tag || 'SYS', msg.message, 'sys');
                        if (msg.type === 'error') {
                            ui.log('ERR', msg.message, 'err');
                            alert(`Error: ${msg.message}`);
                        }
                        if (msg.type === 'final') {
                            finalJson = msg.event;
                            ui.renderResult(finalJson);
                        }
                    } catch { /* ignore parse errors */ }
                }
            }

        } catch (e) {
            ui.log('ERR', `Request failed: ${e.message}`, 'err');
        }
    },

    fetchEvents: async () => {
        try {
            ui.log('EXEC', '[DB] Fetching historical records...', 'sys');
            const res = await fetch('/api/events');
            const events = await res.json();
            ui.renderHistory(events);
        } catch (e) {
            ui.log('ERR', `Failed to fetch history: ${e.message}`, 'err');
        }
    }
};

document.addEventListener('DOMContentLoaded', ui.init);
