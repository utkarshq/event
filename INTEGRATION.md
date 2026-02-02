# API Integration Guide

This guide covers integrating Vision Event Engine's REST API into your applications.

## Overview

Vision Event Engine exposes a RESTful API for document extraction. All endpoints accept JSON (unless otherwise noted) and return JSON responses. CORS is enabled for all origins.

**Base URL:** `http://localhost:3000`

## Authentication

The API itself does not require authentication. However, you must provide API keys for third-party AI providers (Gemini, OpenAI) when using those services.

## Endpoints

### Upload Document

Upload an image or document for text extraction.

```http
POST /api/upload
Content-Type: multipart/form-data
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | Image file (JPEG, PNG, WebP) |

**cURL Example:**

```bash
curl -X POST http://localhost:3000/api/upload \
  -F "file=@./receipt.jpg"
```

**Response:**

```json
{
  "text": ""
}
```

> Note: The upload endpoint returns immediately. Actual extraction happens via `/api/parse-sync`.

---

### Extract Data (Streaming)

Perform AI-powered extraction with real-time streaming.

```http
POST /api/parse-sync
Content-Type: application/json
```

**Request Body:**

```json
{
  "ocr_text": "",
  "base64_image": "<base64-encoded-image>",
  "model": "gemini-2.0-flash",
  "api_key": "your-api-key",
  "provider_url": "https://generativelanguage.googleapis.com",
  "strategy": "A",
  "today_date": "2024-01-15"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `base64_image` | string | Yes | Base64-encoded image |
| `strategy` | string | No | `A` (Full LLM), `B` (Hybrid), `C` (OCR only) |
| `model` | string | No | Model name (e.g., `gemini-2.0-flash`) |
| `api_key` | string | No* | Required for Gemini/OpenAI |
| `provider_url` | string | No | API base URL |
| `ocr_text` | string | No | Pre-extracted OCR text |
| `today_date` | string | No | Context date (ISO format) |

**Strategies:**

| Strategy | Description | Requires API Key |
|----------|-------------|------------------|
| `A` | Full Vision LLM - sends image directly to AI | Yes |
| `B` | Hybrid - OCR first, then LLM refinement | Yes |
| `C` | Local OCR Only - uses PaddleOCR | No |

**cURL Example (Strategy A - Gemini):**

```bash
curl -X POST http://localhost:3000/api/parse-sync \
  -H "Content-Type: application/json" \
  -d '{
    "base64_image": "'$(base64 -w0 receipt.jpg)'",
    "strategy": "A",
    "model": "gemini-2.0-flash",
    "api_key": "YOUR_GEMINI_API_KEY",
    "provider_url": "https://generativelanguage.googleapis.com"
  }'
```

**cURL Example (Strategy C - Local OCR):**

```bash
curl -X POST http://localhost:3000/api/parse-sync \
  -H "Content-Type: application/json" \
  -d '{
    "base64_image": "'$(base64 -w0 receipt.jpg)'",
    "strategy": "C",
    "model": "PaddleOCR-VL-1.5"
  }'
```

**Response (Streaming NDJSON):**

```jsonl
{"type":"log","tag":"EXEC","message":"[INIT] Provider: GEMINI | Model: gemini-2.0-flash"}
{"type":"log","tag":"EXEC","message":"[HTTP] POST https://..."}
{"type":"log","tag":"SYNTH","message":"{\"title\":\"Grocery Receipt\""}
{"type":"log","tag":"SYNTH","message":",\"amount\":42.50"}
{"type":"log","tag":"EXEC","message":"[COMPLETE] Latency: 1234ms"}
{"type":"final","event":{"title":"Grocery Receipt","amount":42.50,"items":[...]}}
```

**Message Types:**

| Type | Description |
|------|-------------|
| `log` | Progress message (tag: EXEC, SYNTH, NET) |
| `error` | Error message |
| `final` | Complete extraction result |

---

### List Events

Retrieve all saved extractions.

```http
GET /api/events
```

**cURL Example:**

```bash
curl http://localhost:3000/api/events
```

**Response:**

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Grocery Receipt",
    "amount": "42.50",
    "created_at": "2024-01-15 14:32:10"
  }
]
```

---

### Check Provider Health

Test connectivity to an AI provider.

```http
POST /api/health
Content-Type: application/json
```

**Request Body:**

```json
{
  "baseUrl": "https://generativelanguage.googleapis.com",
  "apiKey": "your-api-key",
  "model": "gemini-2.0-flash"
}
```

**Response:**

```json
{
  "status": "online"
}
```

---

### Get OCR Bridge Status

Check the status of the PaddleOCR bridge.

```http
GET /api/paddle/status
```

**Response:**

```json
{
  "installed": true,
  "running": true,
  "activeTier": "eco",
  "tiers": {
    "eco": { "installed": true },
    "lite": { "installed": false },
    "pro": { "installed": false }
  }
}
```

---

### Switch OCR Tier

Change the active PaddleOCR tier.

```http
POST /api/paddle/tier
Content-Type: application/json
```

**Request Body:**

```json
{
  "tier": "eco"
}
```

**Tiers:**

| Tier | Description |
|------|-------------|
| `eco` | Fast CPU-based OCR (default) |
| `lite` | VLM with 4-bit quantization |
| `pro` | Full-precision VLM |

---

## Integration Examples

### Python

```python
import requests
import base64

# Read and encode image
with open("document.jpg", "rb") as f:
    image_b64 = base64.b64encode(f.read()).decode()

# Extract with local OCR (no API key needed)
response = requests.post(
    "http://localhost:3000/api/parse-sync",
    json={
        "base64_image": image_b64,
        "strategy": "C",
        "model": "PaddleOCR-VL-1.5"
    },
    stream=True
)

# Process streaming response
for line in response.iter_lines():
    if line:
        data = json.loads(line)
        if data["type"] == "final":
            print("Extracted:", data["event"])
```

### JavaScript/Node.js

```javascript
const fs = require('fs');

async function extractDocument(imagePath) {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const response = await fetch('http://localhost:3000/api/parse-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            base64_image: base64Image,
            strategy: 'C',
            model: 'PaddleOCR-VL-1.5'
        })
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            const data = JSON.parse(line);
            if (data.type === 'final') {
                return data.event;
            }
        }
    }
}
```

### Go

```go
package main

import (
    "bytes"
    "encoding/base64"
    "encoding/json"
    "io/ioutil"
    "net/http"
)

func extractDocument(imagePath string) (map[string]interface{}, error) {
    // Read and encode image
    imageData, _ := ioutil.ReadFile(imagePath)
    base64Image := base64.StdEncoding.EncodeToString(imageData)
    
    // Prepare request
    payload := map[string]string{
        "base64_image": base64Image,
        "strategy":     "C",
        "model":        "PaddleOCR-VL-1.5",
    }
    body, _ := json.Marshal(payload)
    
    // Send request
    resp, _ := http.Post(
        "http://localhost:3000/api/parse-sync",
        "application/json",
        bytes.NewReader(body),
    )
    defer resp.Body.Close()
    
    // Parse streaming response (simplified)
    // ... handle NDJSON stream
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad request (invalid parameters) |
| 404 | Not found |
| 500 | Server error |
| 503 | Service unavailable (bridge not ready) |

### Error Response Format

```json
{
  "error": "Error description",
  "message": "Detailed error message"
}
```

---

## Rate Limits

The API does not enforce rate limits. However, consider:

- **PaddleOCR Bridge**: Processes one image at a time. Concurrent requests queue.
- **AI Providers**: Subject to their own rate limits (Gemini, OpenAI).

---

## Best Practices

1. **Use Strategy C for bulk processing** - No API costs, fast processing
2. **Stream responses** - Don't wait for full response; process chunks
3. **Handle errors gracefully** - Check for `type: "error"` in stream
4. **Compress images** - Reduce base64 payload size
5. **Set timeouts** - OCR can take 10-30 seconds for complex documents
