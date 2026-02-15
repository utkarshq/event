# Vision Event Engine

A vision-first document extraction engine that uses AI to intelligently extract structured data from images and documents. Supports multiple AI providers including Google Gemini, OpenAI, and local Ollama models, as well as a fast local PaddleOCR mode.

## ✨ Features

- **Multi-Provider AI Support**: Google Gemini, OpenAI GPT-4V, local Ollama, and PaddleOCR
- **Three Extraction Strategies**:
  - **Strategy A**: Full Vision LLM (best accuracy, requires API key)
  - **Strategy B**: Hybrid Pipeline (PaddleOCR + LLM refinement)
  - **Strategy C**: Local OCR Only (fastest, no API required)
- **Streaming Responses**: Real-time token streaming with live progress display
- **Dynamic Schema**: Automatically adapts to extract any structured data
- **Dynamically Optimized for Apple Silicon**: Automatically detects M1/M2/M3 chips to use Metal Performance Shaders (MPS) for up to 5x faster inference.
- **Smart Tier Switching**: Automatically upgrades the OCR engine from "Eco" to "Lite" when VLM models are requested.
- **Modern Web UI**: Clean, responsive interface with dark mode
- **Headless Mode**: Full API access for backend integration
- **SQLite Storage**: Persistent event history with automatic schema evolution

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
docker compose up --build
```

Open http://localhost:3000 in your browser.

### Manual Setup

Requires [Bun](https://bun.sh) runtime (v1.0+).

```bash
# Install dependencies
bun install

# Start in development mode (hot reload)
bun run dev

# Or start in production mode
bun run start
```

### First-Time Setup

The first startup will automatically:
1. Create a Python virtual environment
2. Install PaddleOCR dependencies
3. Download OCR models (~500MB)

This process takes 2-5 minutes on first run.

## 🔧 Configuration

### Web Interface

1. Open http://localhost:3000
2. Click the **settings** icon in the sidebar
3. Select your provider (Gemini, OpenAI, or Ollama)
4. Enter your API key (if required)
5. Choose a model

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `SERVE_STATIC` | `true` | Enable/disable static file serving |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |

## 📡 API Reference

All endpoints return JSON and accept CORS requests.

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upload` | POST | Upload image/document (multipart/form-data) |
| `/api/parse-sync` | POST | Extract data with streaming response |
| `/api/events` | GET | List all saved extractions |
| `/api/health` | POST | Check provider connectivity |

### PaddleOCR Bridge Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/paddle/status` | GET | Get bridge status and tier info |
| `/api/paddle/tier` | POST | Switch active OCR tier |
| `/api/paddle/logs` | GET | Get bridge process logs |

See [INTEGRATION.md](./INTEGRATION.md) for detailed API documentation with examples.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (public/)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Upload UI  │  │  Config UI  │  │  History/Results    │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   Bun HTTP Server (src/)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    Routes   │  │  Providers  │  │   Model Service     │  │
│  │  (api/)     │──│  (Gemini,   │  │   (Bridge Mgmt)     │  │
│  │             │  │  OpenAI,    │  │                     │  │
│  └─────────────┘  │  Paddle)    │  └──────────┬──────────┘  │
│                   └──────┬──────┘             │             │
└──────────────────────────┼────────────────────┼─────────────┘
                           │                    │
                           ▼                    ▼
┌──────────────────────────────────┐  ┌────────────────────────┐
│        External AI APIs          │  │  PaddleOCR Bridge      │
│  (Gemini, OpenAI, Ollama)        │  │  (Python/FastAPI)      │
└──────────────────────────────────┘  │  Port 5000             │
                                      └────────────────────────┘
```

## 📁 Project Structure

```
vision-event-engine/
├── src/
│   ├── server.ts           # Main server entry point
│   ├── db.ts               # SQLite database module
│   ├── prompt.ts           # AI system prompt
│   ├── api/
│   │   └── routes.ts       # API route handlers
│   ├── providers/
│   │   ├── base.provider.ts    # Abstract provider class
│   │   ├── gemini.provider.ts  # Google Gemini
│   │   ├── openai.provider.ts  # OpenAI/Ollama
│   │   └── paddle.provider.ts  # PaddleOCR bridge
│   ├── services/
│   │   ├── model.service.ts    # Bridge lifecycle management
│   │   └── provider.service.ts # Provider orchestration
│   ├── bridge/
│   │   └── paddle_bridge.py    # Python OCR server
│   └── utils/
│       └── ollama.ts           # Ollama utility functions
├── public/
│   ├── index.html          # Main HTML
│   ├── script.js           # Frontend logic
│   ├── style.css           # Main styles
│   └── tiers.css           # Tier selection styles
├── data/                   # SQLite database (auto-created)
├── .paddle_cache/          # OCR model cache (auto-created)
├── Dockerfile              # Production container
├── docker-compose.yml      # Container orchestration
└── package.json            # Node dependencies
```

## 🤝 Contributing

See [DEVELOPMENT.md](./DEVELOPMENT.md) for development setup and guidelines.

## �️ Troubleshooting
- **Upload Hangs**: If uploads don't trigger processing, check for JS errors. The system now has a fallback for VRAM mode to send raw files if compression fails.
- **Paddle Bridge Defaults to Eco**: This is normal on startup. If you request a VLM model, the system will automatically restart the bridge in "Lite" mode.
- **Dependency Issues**: If you see `ImportError: No module named 'einops'`, run `pip install -r requirements.txt` again.

## �📄 License

Proprietary - All rights reserved.
