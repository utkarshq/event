#!/usr/bin/env python3
"""
PaddleOCR Bridge Server

A FastAPI-based HTTP bridge that exposes PaddleOCR functionality as a REST API.
This bridge is spawned by the Node.js backend and communicates via HTTP on port 5000.

Supports three tiers:
- eco: Standard PaddleOCR (fast, lightweight, CPU-friendly)
- lite: PaddleOCR-VL-1.5 with 4-bit quantization
- pro: PaddleOCR-VL-1.5 full precision

Usage:
    python paddle_bridge.py --tier eco
"""

import os
import sys

# =============================================================================
# Environment Configuration
# Force all model downloads to project directory to avoid polluting home
# =============================================================================
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
cache_dir = os.path.join(project_root, ".paddle_cache")
os.environ["PADDLE_HOME"] = os.path.join(cache_dir, "ocr")
os.environ["PADDLEX_HOME"] = os.path.join(cache_dir, "paddlex")
os.environ["HF_HOME"] = os.path.join(cache_dir, "hf")
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

import base64
import argparse
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
from io import BytesIO

# Force unbuffered output for real-time log streaming
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Suppress noisy deprecation warnings
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

# =============================================================================
# CLI Arguments
# =============================================================================
parser = argparse.ArgumentParser(description="PaddleOCR Bridge Server")
parser.add_argument("--tier", type=str, default="eco", choices=["eco", "lite", "pro"],
                    help="Model tier to use (eco=fast OCR, lite=VLM quantized, pro=VLM full)")
args = parser.parse_args()

# =============================================================================
# FastAPI Application
# =============================================================================
app = FastAPI(
    title="PaddleOCR Bridge",
    description="HTTP bridge for PaddleOCR text extraction",
    version="1.0.0"
)

# Global model instances
model = None
tokenizer = None
ocr_engine = None
is_processing = False
MODEL_ID = "PaddlePaddle/PaddleOCR-VL-1.5"

print(f"📡 Initializing Paddle Bridge [Tier: {args.tier}]")


def load_model():
    """
    Initialize the OCR/VLM model based on the selected tier.
    
    - eco: Uses standard PaddleOCR with PP-OCRv4/v5 models
    - lite: Uses VLM with 4-bit quantization (requires bitsandbytes)
    - pro: Uses VLM at full precision
    
    The model is warmed up with a dummy image to ensure fast first requests.
    """
    global model, tokenizer, ocr_engine
    
    try:
        if args.tier == "eco":
            from paddleocr import PaddleOCR
            print("📦 Loading Standard PaddleOCR (Eco - PP-OCRv4 Mobile)...")
            
            # Minimal arguments for broad compatibility
            # enable_mkldnn=False prevents Intel MKL-DNN errors on some CPUs
            ocr_engine = PaddleOCR(
                use_angle_cls=True, 
                lang="en",
                enable_mkldnn=False
            )
            print("✅ OCR Engine initialized.")
            
            # Warmup to ensure first request is fast
            print("🔥 Warming up models...")
            try:
                import numpy as np
                dummy = np.zeros((64, 64, 3), dtype=np.uint8)
                ocr_engine.ocr(dummy)
            except Exception as e:
                print(f"⚠️ Warmup warning (safe to ignore): {e}")
        else:
            # VLM tiers (lite/pro)
            import torch
            from transformers import AutoModel, AutoTokenizer
            
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"📡 Loading VLM {MODEL_ID} ({args.tier}) [Device: {device}]...")
            
            load_args = {"trust_remote_code": True}
            if args.tier == "lite":
                try:
                    from transformers import BitsAndBytesConfig
                    bnb_config = BitsAndBytesConfig(load_in_4bit=True)
                    load_args["quantization_config"] = bnb_config
                    print("✨ Using 4-bit quantization for Lite tier")
                except ImportError:
                    print("⚠️ bitsandbytes not found, falling back to standard precision")
            
            model = AutoModel.from_pretrained(MODEL_ID, **load_args).to(device)
            tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
            model.eval()
            
        print("✅ Ready.")
        
    except Exception as e:
        print(f"❌ Initialization Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


# Initialize model on startup
load_model()


# =============================================================================
# API Models
# =============================================================================
class OCRRequest(BaseModel):
    """Request body for OCR endpoint"""
    image_base64: str


# =============================================================================
# API Endpoints
# =============================================================================
@app.get("/health")
async def health():
    """
    Health check endpoint.
    
    Returns:
        - status: "ok" if model is loaded, "loading" otherwise
        - busy: True if currently processing a request
        - tier: The active model tier
        - model: The model name/ID
    """
    is_ready = ocr_engine is not None or model is not None
    return {
        "status": "ok" if is_ready else "loading",
        "busy": is_processing,
        "tier": args.tier,
        "model": MODEL_ID if args.tier != "eco" else "PP-OCRv4-Mobile"
    }


@app.get("/")
async def root():
    """Root endpoint to prevent 404s on direct access."""
    return {
        "message": "Vision Event Engine OCR Bridge. Please use the main application at port 3000.",
        "docs_url": "/docs"
    }


@app.post("/ocr")
async def perform_ocr(request: OCRRequest):
    """
    Perform OCR on a base64-encoded image.
    
    Args:
        request: OCRRequest containing image_base64
        
    Returns:
        {"result": "extracted text content"}
        
    Raises:
        503: If model not ready
        500: If OCR processing fails
    """
    global is_processing
    is_processing = True
    
    try:
        if args.tier == "eco" and ocr_engine is None:
            raise HTTPException(status_code=503, detail="OCR Engine not ready yet. Please wait.")

        print("📥 Received OCR request")
        
        # Decode and open image
        image_data = base64.b64decode(request.image_base64)
        image_pil = Image.open(BytesIO(image_data)).convert("RGB")
        print(f"📸 Image opened: {image_pil.size}px")

        if args.tier == "eco":
            # Use temporary file for PaddleOCR (required for v3 API)
            temp_path = "/tmp/ocr_temp.jpg"
            image_pil.save(temp_path)
            
            print("🔍 Running PaddleOCR engine...")
            result = ocr_engine.ocr(temp_path)
            print("✅ OCR Engine finished.")
            
            # Clean up temp file
            try:
                os.remove(temp_path)
            except:
                pass
            
            # Parse result based on PaddleOCR version
            text = ""
            if result and len(result) > 0:
                first_result = result[0]
                
                # PaddleOCR v3 format: OCRResult with 'rec_texts' key
                if hasattr(first_result, 'get') or isinstance(first_result, dict):
                    rec_texts = first_result.get('rec_texts', [])
                    text = " ".join(rec_texts)
                    print(f"📄 Using v3 format, found {len(rec_texts)} text blocks")
                    
                # Legacy format: list of [box, (text, score)]
                elif isinstance(first_result, list):
                    for line in first_result:
                        if line and len(line) >= 2:
                            text += line[1][0] + " "
                    print("📄 Using legacy format")
            
            summary = text.strip()
            print(f"📊 Extracted {len(summary)} chars.")
            
            if len(summary) > 200:
                print(f"📝 Content: '{summary[:200]}...'")
            else:
                print(f"📝 Content: '{summary}'")
                
            return {"result": summary}
            
        else:
            # VLM inference
            import torch
            if model is None:
                raise HTTPException(status_code=503, detail="VLM not loaded")
                
            prompt = "Extract all text and structured info from this document."
            print("🧠 Running VLM inference...")
            
            with torch.no_grad():
                res, _ = model.chat(tokenizer, image_pil, prompt, history=None)
                
            print("✅ VLM finished.")
            return {"result": res}
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ OCR Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        is_processing = False


# =============================================================================
# Main Entry Point
# =============================================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5000)
