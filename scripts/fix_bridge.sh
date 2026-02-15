#!/bin/bash
set -e

echo "🛠️  Fixing Bridge Dependencies..."

# Check if we are in a virtual environment
if [[ "$VIRTUAL_ENV" == "" ]]; then
    # Try to activate if it exists locally
    if [ -d ".venv" ]; then
        echo "Activate .venv..."
        source .venv/bin/activate
    else
        echo "❌ No virtual environment found! Are you in the project root?"
        exit 1
    fi
fi

echo "📦 Uninstalling conflicting packages..."
pip uninstall -y fastapi uvicorn pydantic pydantic-core annotated-doc paddleocr

echo "📦 Reinstalling core bridge dependencies..."
# Force reinstall to ensure clean state
pip install --force-reinstall fastapi uvicorn "pydantic>=2.0" "annotated-types"

echo "📦 Reinstalling PaddleOCR..."
pip install paddleocr

echo "✅ Dependency fix complete!"
echo "Please restart the server with: bun run dev"
