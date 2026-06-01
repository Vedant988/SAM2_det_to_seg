from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import torch
import os

from .core import init_models
from .api import router
from .settings import router as settings_router

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State
DEVICE = "cpu"

@app.on_event("startup")
async def startup_event():
    global DEVICE
    if torch.cuda.is_available():
        DEVICE = "cuda"
        print("✅ GPU Detected: Running on CUDA")
    else:
        DEVICE = "cpu"
        print("⚠️ GPU Not Detected: Running on CPU")
    
    # Initialize Models
    init_models(DEVICE)
    
    # Ensure directories exist
    # Use absolute paths
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(base_dir, "data")
    images_dir = os.path.join(data_dir, "images")
    labels_dir = os.path.join(data_dir, "labels")
    videos_dir = os.path.join(data_dir, "videos")
    
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)
    os.makedirs(videos_dir, exist_ok=True)

# Mount static files using absolute path
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
images_dir = os.path.join(base_dir, "data", "images")
if os.path.exists(images_dir):
    app.mount("/images_static", StaticFiles(directory=images_dir), name="images")
else:
    print(f"⚠️ Warning: Images directory not found at {images_dir}")

app.include_router(router)
app.include_router(settings_router)



@app.get("/")
def read_root():
    return {"message": "YOLO-SAM2-Annotator Backend is running", "device": DEVICE}
