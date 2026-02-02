# Development Guide

This guide covers setting up a development environment for Vision Event Engine.

## Prerequisites

- **Bun** v1.0+ ([install](https://bun.sh))
- **Python** 3.10+ (for PaddleOCR bridge)
- **Node.js** 18+ (optional, for some tools)

## Quick Start

```bash
# Clone and install
git clone <repository-url>
cd vision-event-engine
bun install

# Start development server with hot reload
bun run dev
```

The server will start at http://localhost:3000.

## Project Structure

### Backend (`src/`)

| File/Directory | Purpose |
|----------------|---------|
| `server.ts` | Main entry point, Bun HTTP server |
| `db.ts` | SQLite database with dynamic schema |
| `prompt.ts` | AI system prompt for extraction |
| `api/routes.ts` | HTTP route handlers |
| `providers/` | AI provider implementations |
| `services/` | Business logic services |
| `bridge/` | Python OCR bridge |
| `utils/` | Utility functions |

### Frontend (`public/`)

| File | Purpose |
|------|---------|
| `index.html` | Single-page application |
| `script.js` | Frontend logic and API client |
| `style.css` | Main styles and components |
| `tiers.css` | OCR tier selection styles |

## Environment Setup

### Python Virtual Environment

The OCR bridge requires a Python virtual environment. It's created automatically on first run, but you can set it up manually:

```bash
# Create virtual environment
python3 -m venv .venv

# Activate (Linux/macOS)
source .venv/bin/activate

# Install dependencies
pip install paddlepaddle paddleocr fastapi uvicorn pydantic pillow

# For VLM tiers (optional)
pip install transformers torch einops accelerate bitsandbytes
```

### Environment Variables

Create a `.env` file (optional):

```env
PORT=3000
SERVE_STATIC=true
OLLAMA_HOST=http://localhost:11434
```

## Development Scripts

```bash
# Development server with hot reload
bun run dev

# Production server
bun run start

# Type checking (if using TypeScript IDE)
bunx tsc --noEmit
```

## Testing the API

### Health Check

```bash
curl http://localhost:3000/api/paddle/status
```

### OCR Test

```bash
# Upload and extract text from an image
curl -X POST http://localhost:3000/api/upload \
  -F "file=@/path/to/image.jpg"
```

### Direct Bridge Test

```bash
# Base64 encode an image and test the bridge directly
curl -X POST http://localhost:5000/ocr \
  -H "Content-Type: application/json" \
  -d '{"image_base64": "'$(base64 -w0 image.jpg)'"}'
```

## Adding a New Provider

1. Create a new file in `src/providers/`:

```typescript
// src/providers/my.provider.ts
import { BaseProvider, type ExtractionRequest } from "./base.provider";

export class MyProvider extends BaseProvider {
    name = "MyProvider";
    
    async checkHealth(): Promise<boolean> {
        // Implement health check
    }
    
    async streamExtraction(request: ExtractionRequest): Promise<ReadableStream<Uint8Array>> {
        // Implement extraction
    }
}
```

2. Register it in `src/services/provider.service.ts`:

```typescript
static getProvider(config: ProviderConfig): BaseProvider {
    if (config.baseUrl.includes("myprovider.com")) {
        return new MyProvider(config);
    }
    // ... existing providers
}
```

## Database Schema

The database uses dynamic schema evolution. Core columns:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | UUID primary key |
| `title` | TEXT | Event title |
| `created_at` | DATETIME | Timestamp |
| `*` | TEXT | Dynamic columns from extraction |

To reset the database:

```bash
rm -rf data/events.sqlite
```

## Debugging

### Bridge Logs

View PaddleOCR bridge logs:

```bash
curl http://localhost:3000/api/paddle/logs
```

### Enable Verbose Logging

Add to the top of `server.ts`:

```typescript
process.env.DEBUG = "*";
```

### Common Issues

**Bridge won't start:**
```bash
# Kill any stuck processes
fuser -k 5000/tcp
# Restart the server
bun run dev
```

**Database permission errors:**
```bash
# Check ownership
ls -la data/
# Fix permissions
sudo chown -R $USER:$USER data/
```

**OCR returns empty text:**
- Ensure the image has clear, readable text
- Check if PaddleOCR models are downloaded (`.paddle_cache/`)
- Try a different OCR tier

## Code Style

- TypeScript for backend
- ES6+ modules
- JSDoc comments for public APIs
- 4-space indentation

## Building for Production

```bash
# The Bun binary includes everything needed
bun run start

# Or use Docker
docker compose up --build
```

## Useful Commands

```bash
# Check installed Bun version
bun --version

# Update dependencies
bun update

# Clean install
rm -rf node_modules bun.lock && bun install

# Clean OCR cache
rm -rf .paddle_cache .venv

# Reset everything
rm -rf node_modules bun.lock .venv .paddle_cache data/
```
