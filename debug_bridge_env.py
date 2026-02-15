import sys
print(f"Python executable: {sys.executable}")
print(f"Python version: {sys.version}")

try:
    import pydantic
    print(f"Pydantic version: {getattr(pydantic, 'VERSION', getattr(pydantic, '__version__', 'unknown'))}")
    print(f"Pydantic file: {pydantic.__file__}")
    from pydantic import BaseModel
    print("✅ Successfully imported BaseModel from pydantic")
except ImportError as e:
    print(f"❌ Failed to import BaseModel from pydantic: {e}")
except Exception as e:
    print(f"❌ Error importing pydantic: {e}")

try:
    import fastapi
    print(f"FastAPI version: {fastapi.__version__}")
    print("✅ Successfully imported fastapi")
except ImportError as e:
    print(f"❌ Failed to import fastapi: {e}")

try:
    print("Attempting to import paddleocr (may verify conflict)...")
    import paddleocr
    print("✅ Successfully imported paddleocr")
except Exception as e:
    print(f"⚠️ Error importing paddleocr: {e}")
