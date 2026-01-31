# Vision Event Engine

A vision-first document extraction engine that uses AI to intelligently extract structured data from images and documents.

## Features

- **Vision AI Integration**: Supports Google Gemini, OpenAI, and local Ollama models
- **Dynamic Extraction**: Automatically identifies and extracts relevant fields as JSON
- **Streaming Responses**: Real-time token streaming with live progress display
- **Modern UI**: Clean, responsive web interface with dark mode

## Quick Start

### Using Docker (Recommended)

```bash
docker-compose up --build
```

Open `http://localhost:3000` in your browser.

### Manual Setup

Requires [Bun](https://bun.sh) runtime.

```bash
bun install
bun run start
```

## Configuration

1. Open the app at `http://localhost:3000`
2. Click the **connection** icon in the sidebar
3. Select your provider (Gemini, OpenAI, or Ollama)
4. Enter your API key
5. Choose a model

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upload` | POST | Upload image/document |
| `/api/parse-sync` | POST | Extract data (streaming) |
| `/api/events` | GET | List saved extractions |
| `/api/health` | POST | Check provider status |

## Tech Stack

- **Runtime**: Bun
- **Frontend**: Vanilla JS, CSS
- **AI Providers**: Gemini, OpenAI, Ollama

## License

Proprietary - All rights reserved.
