from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
import os
import shutil
from .core import load_yolo_model, load_config, save_config, get_current_model_info

router = APIRouter(prefix="/settings", tags=["settings"])

class ModelConfig(BaseModel):
    yolo_model: Optional[str] = None
    device: Optional[str] = None

@router.get("/config")
async def get_config():
    """Get current configuration."""
    config = load_config()
    model_info = get_current_model_info()
    return {
        "config": config,
        "current": model_info
    }

@router.post("/model/yolo")
async def set_yolo_model(model_path: str):
    """Load a new YOLO model."""
    # Validate the path exists or is a valid ultralytics model name
    if not model_path.endswith('.pt') and not model_path.startswith('yolov'):
        raise HTTPException(status_code=400, detail="Invalid model path. Must be .pt file or ultralytics model name (e.g., yolov8n.pt)")
    
    success = load_yolo_model(model_path)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to load model")
    
    # Save to config
    config = load_config()
    config["yolo_model"] = model_path
    save_config(config)
    
    return {"status": "success", "model": model_path}

@router.get("/models/available")
async def list_available_models():
    """List common YOLO models and scan for local .pt files."""
    # Common ultralytics models
    common_models = [
        {"name": "YOLOv8 Nano", "path": "yolov8n.pt", "size": "6MB", "type": "ultralytics"},
        {"name": "YOLOv8 Small", "path": "yolov8s.pt", "size": "22MB", "type": "ultralytics"},
        {"name": "YOLOv8 Medium", "path": "yolov8m.pt", "size": "52MB", "type": "ultralytics"},
        {"name": "YOLOv8 Large", "path": "yolov8l.pt", "size": "87MB", "type": "ultralytics"},
        {"name": "YOLOv8 XLarge", "path": "yolov8x.pt", "size": "136MB", "type": "ultralytics"},
        {"name": "YOLOv11 Nano", "path": "yolo11n.pt", "size": "5MB", "type": "ultralytics"},
        {"name": "YOLOv11 Small", "path": "yolo11s.pt", "size": "20MB", "type": "ultralytics"},
        {"name": "YOLOv11 Medium", "path": "yolo11m.pt", "size": "48MB", "type": "ultralytics"},
    ]
    
    # Scan for local .pt files in backend directory
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    local_models = []
    
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith('.pt'):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, base_dir)
                local_models.append({
                    "name": file,
                    "path": full_path,
                    "type": "local"
                })
    
    return {
        "common": common_models,
        "local": local_models
    }

@router.post("/models/upload")
async def upload_model(file: UploadFile = File(...)):
    """Upload a custom model (.pt) file."""
    if not file.filename.endswith('.pt'):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .pt files are allowed.")
    
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    file_path = os.path.join(base_dir, file.filename)
    
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
        
    return {"status": "success", "filename": file.filename, "path": file_path}
