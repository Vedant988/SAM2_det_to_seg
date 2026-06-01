from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from typing import List
import shutil
import os
import uuid
from .core import get_yolo

router = APIRouter()

# Fix path to be absolute/robust
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, "data", "images")

# Global state to track video frame extraction progress
extraction_progress = {}


@router.post("/upload")
async def upload_images(files: List[UploadFile] = File(...)):
    uploaded_files = []
    try:
        for file in files:
            filename = os.path.basename(file.filename)
            file_path = os.path.join(UPLOAD_DIR, filename)
            
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            uploaded_files.append({"filename": filename, "path": file_path})
            
        return {"uploaded": uploaded_files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/detect")
async def detect_objects(filename: str):
    yolo = get_yolo()
    if not yolo:
        raise HTTPException(status_code=503, detail="YOLO model not loaded")
        
    image_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
        
    # Run Inference
    results = yolo(image_path)
    
    # Process results
    detections = []
    for r in results:
        boxes = r.boxes
        for box in boxes:
            b = box.xywh[0].tolist() # x_center, y_center, w, h
            c = int(box.cls)
            conf = float(box.conf)
            label = yolo.names[c]
            
            # Convert to [x, y, w, h] (top-left) for Konva
            # xywh in YOLO is center x, center y. Konva needs top-left x, top-left y.
            x_center, y_center, w, h = b
            x = x_center - (w / 2)
            y = y_center - (h / 2)
            
            detections.append({
                "id": str(uuid.uuid4()),
                "x": x,
                "y": y,
                "width": w,
                "height": h,
                "label": label,
                "class_id": c,
                "confidence": conf
            })
            
    return {"detections": detections}

@router.post("/detect_batch")
async def detect_batch():
    """Run YOLO detection on all images in the upload directory."""
    yolo = get_yolo()
    if not yolo:
        raise HTTPException(status_code=503, detail="YOLO model not loaded")
    
    if not os.path.exists(UPLOAD_DIR):
        return {"results": {}}
    
    files = [f for f in os.listdir(UPLOAD_DIR) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]
    results = {}
    
    for filename in files:
        image_path = os.path.join(UPLOAD_DIR, filename)
        try:
            # Run Inference
            yolo_results = yolo(image_path)
            
            # Process results
            detections = []
            for r in yolo_results:
                boxes = r.boxes
                for box in boxes:
                    b = box.xywh[0].tolist()
                    c = int(box.cls)
                    conf = float(box.conf)
                    label = yolo.names[c]
                    
                    x_center, y_center, w, h = b
                    x = x_center - (w / 2)
                    y = y_center - (h / 2)
                    
                    detections.append({
                        "id": str(uuid.uuid4()),
                        "x": x,
                        "y": y,
                        "width": w,
                        "height": h,
                        "label": label,
                        "class_id": c,
                        "confidence": conf
                    })
            
            results[filename] = {"detections": detections, "status": "success"}
        except Exception as e:
            results[filename] = {"detections": [], "status": "error", "error": str(e)}
    
    return {"results": results}

@router.get("/images")
async def list_images():
    if not os.path.exists(UPLOAD_DIR):
        return []
    files = [f for f in os.listdir(UPLOAD_DIR) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]
    return sorted(files)

@router.post("/save")
async def save_annotations(filename: str, annotations: List[dict]):
    # annotations expected to be a dict or list. 
    # If dict wrapper: {"boxes": [...], "masks": [...]}
    label_dir = "data/labels"
    base_name = os.path.splitext(filename)[0]
    json_path = os.path.join(label_dir, f"{base_name}.json")
    
    import json
    try:
        with open(json_path, "w") as f:
            json.dump(annotations, f, indent=2)
        return {"status": "saved", "path": json_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/segment")
async def segment_objects(filename: str, boxes: list[dict]):
    """
    Run SAM2 segmentation on the given image using bounding box prompts.
    """
    from .core import get_sam2
    import cv2
    import numpy as np
    
    predictor = get_sam2()
    if not predictor:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")
        
    image_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
        
    try:
        # 1. Read Image
        image = cv2.imread(image_path)
        if image is None:
            raise HTTPException(status_code=500, detail="Failed to read image")
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # 2. Set Image (Compute Embeddings)
        predictor.set_image(image)
        
        generated_masks = []
        
        # 3. Predict for each box
        # SAM2 can take batch inputs, but for simplicity/robustness in this iteration, loop is safer
        # Optimization: Pass all boxes as a single batch if performance is an issue later.
        
        for box in boxes:
            # box is {x, y, width, height, id...} (Konva format: top-left x,y)
            # SAM2 expects [x_min, y_min, x_max, y_max]
            
            x_min = box['x']
            y_min = box['y']
            x_max = box['x'] + box['width']
            y_max = box['y'] + box['height']
            
            input_box = np.array([x_min, y_min, x_max, y_max])
            
            # predict(point_coords, point_labels, box=...)
            masks, scores, logits = predictor.predict(
                point_coords=None,
                point_labels=None,
                box=input_box,
                multimask_output=False # We only want the best mask
            )
            
            # masks shape: (1, H, W) -> logical mask
            best_mask = masks[0]
            
            # 4. Convert Mask to Polygon (for Konva)
            # Find contours
            # mask needs to be uint8 for cv2.findContours
            mask_uint8 = (best_mask * 255).astype(np.uint8)
            contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            # Convert contours to flat list [x1, y1, x2, y2, ...]
            # Take the largest contour if multiple
            if contours:
                largest_contour = max(contours, key=cv2.contourArea)
                # Ensure reasonable number of points (approximate) to reduce frontend load
                epsilon = 0.002 * cv2.arcLength(largest_contour, True)
                approx = cv2.approxPolyDP(largest_contour, epsilon, True)
                
                points = approx.flatten().tolist()
                
                generated_masks.append({
                    "id": box.get('id'), # Link back to the detection
                    "points": points,
                    "box_id": box.get('id')
                })
                
        return {"message": "Segmentation complete", "masks": generated_masks}
        
    except Exception as e:
        print(f"Segmentation error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/images/{filename}")
async def delete_image(filename: str):
    image_path = os.path.join(UPLOAD_DIR, filename)
    
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
        
    try:
        os.remove(image_path)
        
        # Also remove annotation file if exists
        label_dir = os.path.join(BASE_DIR, "data", "labels")
        base_name = os.path.splitext(filename)[0]
        json_path = os.path.join(label_dir, f"{base_name}.json")
        if os.path.exists(json_path):
            os.remove(json_path)
            
        return {"status": "deleted", "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video/analyze")
async def analyze_video(file: UploadFile = File(...)):
    import cv2
    
    # 1. Create data/videos directory if not exists
    videos_dir = os.path.join(BASE_DIR, "data", "videos")
    os.makedirs(videos_dir, exist_ok=True)
    
    # 2. Save file temporarily
    file_ext = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    video_path = os.path.join(videos_dir, unique_filename)
    
    try:
        with open(video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # 3. Read video metadata with OpenCV
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            # Cleanup and error out
            if os.path.exists(video_path):
                os.remove(video_path)
            raise HTTPException(status_code=400, detail="Failed to open video file. Invalid or unsupported format.")
            
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        cap.release()
        
        # Avoid division by zero
        duration = total_frames / fps if fps > 0 else 0
        
        # Initialize progress tracker
        extraction_progress[unique_filename] = {
            "current": 0,
            "total": total_frames,
            "status": "analyzed"
        }
        
        return {
            "video_id": unique_filename,
            "filename": file.filename,
            "total_frames": total_frames,
            "fps": fps,
            "duration": duration,
            "width": width,
            "height": height
        }
    except Exception as e:
        if os.path.exists(video_path):
            os.remove(video_path)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video/extract")
def extract_video_frames(video_id: str, frame_step: int = 1):
    import cv2
    import time
    
    videos_dir = os.path.join(BASE_DIR, "data", "videos")
    video_path = os.path.join(videos_dir, video_id)
    
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video file not found")
        
    if frame_step < 1:
        raise HTTPException(status_code=400, detail="Frame step must be at least 1")
        
    try:
        # 1. Clear current images and labels to ensure a clean workspace
        images_dir = os.path.join(BASE_DIR, "data", "images")
        labels_dir = os.path.join(BASE_DIR, "data", "labels")
        
        if os.path.exists(images_dir):
            for f in os.listdir(images_dir):
                fp = os.path.join(images_dir, f)
                if os.path.isfile(fp):
                    os.remove(fp)
                    
        if os.path.exists(labels_dir):
            for f in os.listdir(labels_dir):
                fp = os.path.join(labels_dir, f)
                if os.path.isfile(fp):
                    os.remove(fp)
                    
        # 2. Extract frames
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            extraction_progress[video_id] = {
                "current": 0,
                "total": 0,
                "status": "failed"
            }
            raise HTTPException(status_code=400, detail="Failed to open video file")
            
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_idx = 0
        extracted_count = 0
        extracted_filenames = []
        expected_extract_count = (total_frames + frame_step - 1) // frame_step if total_frames > 0 else 0
        started_at = time.time()

        def build_progress(current_frame, status):
            elapsed_seconds = max(time.time() - started_at, 0)
            processed_frames = max(current_frame, 0)
            frames_per_second = processed_frames / elapsed_seconds if elapsed_seconds > 0 else 0
            remaining_frames = max(total_frames - processed_frames, 0)
            eta_seconds = remaining_frames / frames_per_second if frames_per_second > 0 else None

            return {
                "current": min(processed_frames, total_frames),
                "total": total_frames,
                "status": status,
                "extracted": extracted_count,
                "expected_extract_count": expected_extract_count,
                "elapsed_seconds": elapsed_seconds,
                "eta_seconds": eta_seconds,
                "frames_per_second": frames_per_second
            }
        
        extraction_progress[video_id] = build_progress(0, "extracting")
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            if frame_idx % frame_step == 0:
                frame_name = f"frame_{frame_idx:06d}.png"
                out_path = os.path.join(images_dir, frame_name)
                cv2.imwrite(out_path, frame)
                extracted_filenames.append(frame_name)
                extracted_count += 1
                
            # Update extraction progress tracker
            if frame_idx % 5 == 0 or frame_idx == total_frames - 1:
                extraction_progress[video_id] = build_progress(frame_idx + 1, "extracting")
                
            frame_idx += 1
            
        cap.release()
        
        # 3. Clean up the video file to conserve space
        if os.path.exists(video_path):
            os.remove(video_path)
            
        extraction_progress[video_id] = build_progress(total_frames, "completed")
        
        return {
            "status": "success",
            "extracted_count": extracted_count,
            "filenames": extracted_filenames
        }
    except Exception as e:
        extraction_progress[video_id] = {
            "current": 0,
            "total": 0,
            "status": "failed"
        }
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/video/extract/progress/{video_id}")
async def get_extraction_progress(video_id: str):
    """Retrieve extraction progress for a specific video."""
    return extraction_progress.get(video_id, {"current": 0, "total": 0, "status": "unknown"})

