# Vision Event Engine - Production Dockerfile
# Multi-stage build for minimal image size

# =============================================================================
# Stage 1: Install Python dependencies for PaddleOCR
# =============================================================================
FROM python:3.12-slim AS python-deps

WORKDIR /deps

# Install system dependencies for PaddlePaddle
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment and install OCR dependencies
RUN python -m venv /deps/venv
ENV PATH="/deps/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    paddlepaddle \
    paddleocr \
    fastapi \
    uvicorn \
    pydantic        pillow \
    transformers==4.57.6 \
    sentencepiece

# =============================================================================
# Stage 2: Production runtime
# =============================================================================
FROM python:3.12-slim

# Copy Bun from official image
COPY --from=oven/bun:latest /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Install Python and minimal runtime dependencies
# Install minimal runtime dependencies (Python is already included)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create bun user/group
RUN groupadd -r bun && useradd -r -g bun -d /home/bun -m bun

# Copy Python virtual environment from builder stage
COPY --from=python-deps /deps/venv /app/.venv

# Copy package files and install Node dependencies
COPY package.json bun.lock ./
RUN bun install --production

# Copy application source
COPY src ./src
COPY public ./public

# Create data directory for SQLite
RUN mkdir -p data && chown -R bun:bun data

# Environment configuration
ENV NODE_ENV=production
ENV SERVE_STATIC=true
ENV PORT=3000

# Switch to non-root user for security
USER bun

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/paddle/status || exit 1

# Start the application
CMD ["bun", "src/server.ts"]
