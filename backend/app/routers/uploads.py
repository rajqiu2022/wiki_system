import os
import uuid
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

# Upload directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if os.path.basename(BASE_DIR) == "backend":
    PROJECT_ROOT = os.path.normpath(os.path.join(BASE_DIR, ".."))
else:
    PROJECT_ROOT = BASE_DIR
UPLOAD_DIR = os.path.join(PROJECT_ROOT, "uploads", "images")

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Allowed image types
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/bmp"}
MAX_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("/image")
async def upload_image(file: UploadFile = File(...)):
    """Upload an image file and return its URL.
    
    Supports paste from clipboard and file selection.
    Returns: { "url": "/api/uploads/images/xxx.png" }
    """
    # Validate content type
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"不支持的图片格式: {file.content_type}")

    # Read file content
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, f"图片大小超过限制（最大 {MAX_SIZE // 1024 // 1024}MB）")

    # Generate unique filename
    ext = _get_extension(file.filename, file.content_type)
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    # Save file
    with open(filepath, "wb") as f:
        f.write(content)

    logger.info("Image uploaded: %s (%d bytes)", filename, len(content))

    return {"url": f"/api/uploads/images/{filename}"}


@router.get("/images/{filename}")
async def get_image(filename: str):
    """Serve an uploaded image file."""
    # Prevent path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(404, "Image not found")

    return FileResponse(filepath)


def _get_extension(filename: str, content_type: str) -> str:
    """Get file extension from filename or content type."""
    if filename and "." in filename:
        return os.path.splitext(filename)[1].lower()

    type_to_ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "image/bmp": ".bmp",
    }
    return type_to_ext.get(content_type, ".png")
