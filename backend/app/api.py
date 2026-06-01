from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Body
from fastapi.responses import JSONResponse, FileResponse
from typing import List
import shutil
import os
import uuid
from .core import get_yolo, get_person_tracker_yolo, get_model_class_id

router = APIRouter()

# Fix path to be absolute/robust
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(BASE_DIR, "data", "images")
LABEL_DIR = os.path.join(BASE_DIR, "data", "labels")
IMAGE_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp', '.bmp')

# Global state to track video frame extraction progress
extraction_progress = {}
tracking_progress = {}
tracking_cancel_requests = set()


def sanitize_project_name(project_name: str):
    safe_name = "".join(c for c in project_name if c.isalnum() or c in (' ', '_', '-', '(', ')', '.')).strip()
    return safe_name or "default_project"


def has_images(images_dir: str):
    return os.path.exists(images_dir) and any(is_valid_image_file(os.path.join(images_dir, f)) for f in os.listdir(images_dir))


def is_valid_image_file(path: str):
    return (
        os.path.isfile(path)
        and path.lower().endswith(IMAGE_EXTENSIONS)
        and os.path.getsize(path) > 0
    )


def get_project_paths(
    project_name: str | None = None,
    create: bool = True,
    fallback_to_flat: bool = False
):
    if project_name:
        project_dir = os.path.join(DATA_DIR, "projects", sanitize_project_name(project_name))
        images_dir = os.path.join(project_dir, "images")
        labels_dir = os.path.join(project_dir, "labels")

        if fallback_to_flat and not has_images(images_dir) and has_images(UPLOAD_DIR):
            images_dir = UPLOAD_DIR
            labels_dir = LABEL_DIR
    else:
        images_dir = UPLOAD_DIR
        labels_dir = LABEL_DIR

    if create:
        os.makedirs(images_dir, exist_ok=True)
        os.makedirs(labels_dir, exist_ok=True)

    return images_dir, labels_dir


def list_image_files(project_name: str | None = None):
    images_dir, _ = get_project_paths(project_name, fallback_to_flat=True)
    if not os.path.exists(images_dir):
        return []
    return sorted(f for f in os.listdir(images_dir) if is_valid_image_file(os.path.join(images_dir, f)))


def normalize_annotation_class_ids(annotation_groups: dict):
    label_to_id = {}

    def clean_label(raw_label):
        label = str(raw_label or "").strip()
        if not label or label == "New Object":
            return "object"
        return label

    normalized_groups = {}
    for filename, annotations in annotation_groups.items():
        if not isinstance(annotations, list):
            normalized_groups[filename] = annotations
            continue

        normalized_annotations = []
        for annotation in annotations:
            if not isinstance(annotation, dict):
                normalized_annotations.append(annotation)
                continue

            label = clean_label(annotation.get("label"))
            if label not in label_to_id:
                label_to_id[label] = len(label_to_id)

            normalized_annotations.append({
                **annotation,
                "label": label,
                "class_id": label_to_id[label]
            })

        normalized_groups[filename] = normalized_annotations

    return normalized_groups


@router.post("/upload")
async def upload_images(
    files: List[UploadFile] = File(...),
    project_name: str | None = Query(None)
):
    images_dir, _ = get_project_paths(project_name)
    uploaded_files = []
    try:
        for file in files:
            filename = os.path.basename(file.filename)
            file_path = os.path.join(images_dir, filename)
            
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            uploaded_files.append({"filename": filename, "path": file_path})
            
        return {"uploaded": uploaded_files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/detect")
async def detect_objects(filename: str, project_name: str | None = Query(None)):
    yolo = get_yolo()
    if not yolo:
        raise HTTPException(status_code=503, detail="YOLO model not loaded")
        
    images_dir, _ = get_project_paths(project_name, fallback_to_flat=True)
    image_path = os.path.join(images_dir, filename)
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
async def detect_batch(project_name: str | None = Query(None)):
    """Run YOLO detection on all images in the upload directory."""
    yolo = get_yolo()
    if not yolo:
        raise HTTPException(status_code=503, detail="YOLO model not loaded")
    
    images_dir, _ = get_project_paths(project_name, fallback_to_flat=True)
    if not os.path.exists(images_dir):
        return {"results": {}}
    
    files = list_image_files(project_name)
    results = {}
    
    for filename in files:
        image_path = os.path.join(images_dir, filename)
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
async def list_images(project_name: str | None = Query(None)):
    return list_image_files(project_name)


@router.get("/image_file/{filename}")
async def get_image_file(filename: str, project_name: str | None = Query(None)):
    images_dir, _ = get_project_paths(project_name, fallback_to_flat=True)
    image_path = os.path.join(images_dir, os.path.basename(filename))
    if not is_valid_image_file(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(image_path)

@router.post("/save")
async def save_annotations(filename: str, annotations: List[dict], project_name: str | None = Query(None)):
    # annotations expected to be a dict or list. 
    # If dict wrapper: {"boxes": [...], "masks": [...]}
    _, label_dir = get_project_paths(project_name, fallback_to_flat=True)
    base_name = os.path.splitext(filename)[0]
    json_path = os.path.join(label_dir, f"{base_name}.json")
    
    import json
    try:
        normalized = normalize_annotation_class_ids({filename: annotations}).get(filename, annotations)
        with open(json_path, "w") as f:
            json.dump(normalized, f, indent=2)
        return {"status": "saved", "path": json_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/save_batch")
async def save_batch_annotations(data: dict, project_name: str | None = Query(None)):
    _, labels_dir = get_project_paths(project_name, fallback_to_flat=True)
    import json

    saved_count = 0
    errors = []

    try:
        data = normalize_annotation_class_ids(data)
        for filename, annotations in data.items():
            base_name = os.path.splitext(filename)[0]
            json_path = os.path.join(labels_dir, f"{base_name}.json")
            try:
                with open(json_path, "w") as f:
                    json.dump(annotations, f, indent=2)
                saved_count += 1
            except Exception as e:
                errors.append(f"{filename}: {str(e)}")

        return {"status": "success", "saved": saved_count, "errors": errors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download_dataset")
async def download_dataset(
    project_name: str = Query("active_workspace"),
    format: str = Query("yolo", regex="^(yolo|coco)$"),
    task: str = Query("detection", regex="^(detection|segmentation)$"),
    split_ratio: float = Query(0.8, ge=0.1, le=0.9)
):
    from .dataset_export import create_dataset_archive
    from starlette.background import BackgroundTask

    def cleanup(path):
        if os.path.exists(path):
            os.remove(path)

    try:
        zip_path = create_dataset_archive(project_name, format, task, split_ratio)
        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=f"{project_name}_{format}_{task}.zip",
            background=BackgroundTask(cleanup, zip_path)
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found or empty")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/segment")
async def segment_objects(filename: str, boxes: list[dict], project_name: str | None = Query(None)):
    """
    Run SAM2 segmentation on the given image using bounding box prompts.
    """
    from .core import get_sam2
    import cv2
    import numpy as np
    
    predictor = get_sam2()
    if not predictor:
        raise HTTPException(status_code=503, detail="SAM2 model not loaded")
        
    images_dir, _ = get_project_paths(project_name, fallback_to_flat=True)
    image_path = os.path.join(images_dir, filename)
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


@router.post("/track")
def track_annotations(payload: dict):
    """Track current-frame bounding boxes into future extracted frames."""
    import cv2
    import numpy as np
    import time

    start_filename = payload.get("start_filename")
    boxes = payload.get("boxes", [])
    frame_count = int(payload.get("frame_count") or 0)
    project_name = payload.get("project_name")
    task_id = payload.get("task_id") or str(uuid.uuid4())
    started_at = time.time()
    try:
        max_motion_pixels = float(payload.get("max_motion_pixels") or 22)
    except (TypeError, ValueError):
        max_motion_pixels = 22
    max_motion_pixels = max(2.0, min(max_motion_pixels, 60.0))

    if not start_filename:
        raise HTTPException(status_code=400, detail="start_filename is required")

    if not boxes:
        raise HTTPException(status_code=400, detail="At least one bounding box is required")

    images_dir, _ = get_project_paths(project_name, fallback_to_flat=True)
    files = list_image_files(project_name)
    if start_filename not in files:
        raise HTTPException(status_code=404, detail="Start frame not found")

    start_index = files.index(start_filename)
    remaining = len(files) - start_index - 1
    frames_to_track = remaining if frame_count <= 0 else min(frame_count, remaining)

    if frames_to_track <= 0:
        return {"results": {}, "tracked_frames": 0}

    def update_tracking_progress(current, total, status, message="", filename=None, methods=None):
        elapsed_seconds = max(time.time() - started_at, 0)
        frames_per_second = current / elapsed_seconds if current > 0 and elapsed_seconds > 0 else 0
        remaining_frames = max(total - current, 0)
        eta_seconds = remaining_frames / frames_per_second if frames_per_second > 0 else None

        tracking_progress[task_id] = {
            "task_id": task_id,
            "current": current,
            "total": total,
            "percent": round((current / total) * 100, 1) if total else 0,
            "status": status,
            "message": message,
            "filename": filename,
            "methods_used": sorted(methods or []),
            "elapsed_seconds": elapsed_seconds,
            "eta_seconds": eta_seconds,
            "frames_per_second": frames_per_second
        }

    update_tracking_progress(
        0,
        frames_to_track,
        "starting",
        "Loading lightweight person tracker..."
    )

    yolo = get_person_tracker_yolo()
    person_class_id = get_model_class_id(yolo, "person") if yolo is not None else None

    update_tracking_progress(
        0,
        frames_to_track,
        "starting",
        (
            f"Person tracker ready for {frames_to_track} frame(s)..."
            if person_class_id is not None
            else "Person tracker unavailable, using optical-flow fallback..."
        )
    )

    yolo_names = getattr(yolo, "names", {}) or {}
    if isinstance(yolo_names, list):
        yolo_names = {idx: name for idx, name in enumerate(yolo_names)}

    name_to_id = {str(name).lower(): int(class_id) for class_id, name in yolo_names.items()}
    if person_class_id is not None:
        name_to_id["person"] = person_class_id
    human_labels = {"customer", "staff", "person", "people", "human", "worker", "employee"}

    def clamp_box(box, width, height):
        x = int(round(float(box.get("x", 0))))
        y = int(round(float(box.get("y", 0))))
        w = int(round(float(box.get("width", 0))))
        h = int(round(float(box.get("height", 0))))

        x = max(0, min(x, width - 1))
        y = max(0, min(y, height - 1))
        w = max(2, min(w, width - x))
        h = max(2, min(h, height - y))

        return x, y, w, h

    def center_distance(first, second):
        ax, ay, aw, ah = first
        bx, by, bw, bh = second
        acx, acy = ax + aw / 2, ay + ah / 2
        bcx, bcy = bx + bw / 2, by + bh / 2
        return ((acx - bcx) ** 2 + (acy - bcy) ** 2) ** 0.5

    def predict_box(state):
        return (
            state["x"] + state.get("vx", 0.0),
            state["y"] + state.get("vy", 0.0),
            state["w"],
            state["h"]
        )

    def constrain_box_motion(state, proposed_box, frame_width, frame_height, allow_reacquire=False, align_to_detection=False):
        px, py, pw, ph = proposed_box
        current_cx = state["x"] + state["w"] / 2
        current_cy = state["y"] + state["h"] / 2
        proposed_cx = px + pw / 2
        proposed_cy = py + ph / 2
        dx = proposed_cx - current_cx
        dy = proposed_cy - current_cy
        distance = (dx ** 2 + dy ** 2) ** 0.5
        motion_limit = max_motion_pixels
        if allow_reacquire:
            motion_limit = min(max_motion_pixels * 2, max_motion_pixels * (1.25 + state.get("missed", 0) * 0.35))
        elif state.get("missed", 0) > 0:
            motion_limit = min(max_motion_pixels * 1.75, max_motion_pixels * (1 + state.get("missed", 0) * 0.25))

        if distance > motion_limit:
            ratio = motion_limit / distance
            proposed_cx = current_cx + dx * ratio
            proposed_cy = current_cy + dy * ratio

        if align_to_detection:
            size_blend = 0.82
            pw = (state["w"] * (1 - size_blend)) + (pw * size_blend)
            ph = (state["h"] * (1 - size_blend)) + (ph * size_blend)
        else:
            max_width_delta = max(2.0, state["w"] * 0.025)
            max_height_delta = max(2.0, state["h"] * 0.025)
            pw = state["w"] + max(-max_width_delta, min(max_width_delta, pw - state["w"]))
            ph = state["h"] + max(-max_height_delta, min(max_height_delta, ph - state["h"]))

        return clamp_box(
            {
                "x": proposed_cx - pw / 2,
                "y": proposed_cy - ph / 2,
                "width": pw,
                "height": ph
            },
            frame_width,
            frame_height
        )

    def make_annotation(source_box, x, y, w, h, score):
        return {
            "id": str(uuid.uuid4()),
            "x": float(x),
            "y": float(y),
            "width": float(w),
            "height": float(h),
            "label": source_box.get("label", "Tracked Object"),
            "class_id": source_box.get("class_id", 0),
            "confidence": float(score),
            "tracked": True,
            "source_id": source_box.get("source_id") or source_box.get("id")
        }

    def xyxy_to_xywh(xyxy):
        x1, y1, x2, y2 = [float(value) for value in xyxy]
        return x1, y1, max(2.0, x2 - x1), max(2.0, y2 - y1)

    def box_iou(first, second):
        ax1, ay1, aw, ah = first
        bx1, by1, bw, bh = second
        ax2, ay2 = ax1 + aw, ay1 + ah
        bx2, by2 = bx1 + bw, by1 + bh

        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        intersection = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        union = aw * ah + bw * bh - intersection
        return intersection / union if union > 0 else 0.0

    def crop_histogram(frame_bgr, box):
        if frame_bgr is None:
            return None

        height, width = frame_bgr.shape[:2]
        x, y, w, h = clamp_box(
            {"x": box[0], "y": box[1], "width": box[2], "height": box[3]},
            width,
            height
        )
        crop = frame_bgr[y:y + h, x:x + w]
        if crop.size == 0:
            return None

        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [24, 24], [0, 180, 0, 256])
        cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
        return hist

    def histogram_similarity(first, second):
        if first is None or second is None:
            return 0.0
        score = cv2.compareHist(first, second, cv2.HISTCMP_CORREL)
        return max(0.0, min(1.0, (score + 1.0) / 2.0))

    def match_score(first, second):
        ax, ay, aw, ah = first
        bx, by, bw, bh = second
        center_a = (ax + aw / 2, ay + ah / 2)
        center_b = (bx + bw / 2, by + bh / 2)
        center_distance = ((center_a[0] - center_b[0]) ** 2 + (center_a[1] - center_b[1]) ** 2) ** 0.5
        distance_scale = max(aw, ah, bw, bh, 1.0)
        center_score = max(0.0, 1.0 - (center_distance / (distance_scale * 2.5)))
        size_ratio = min(aw * ah, bw * bh) / max(aw * ah, bw * bh, 1.0)
        return (box_iou(first, second) * 2.0) + center_score + (size_ratio * 0.5)

    def compatible_class_ids(source_box):
        label = str(source_box.get("label", "")).strip().lower()
        candidates = set()

        if label in name_to_id:
            candidates.add(name_to_id[label])

        if label in human_labels and "person" in name_to_id:
            candidates.add(name_to_id["person"])

        source_class_id = source_box.get("class_id")
        if label not in human_labels:
            try:
                source_class_id = int(source_class_id)
                if source_class_id in yolo_names:
                    candidates.add(source_class_id)
            except (TypeError, ValueError):
                pass

        return candidates

    def extract_detections(model_result):
        detections = []
        if not model_result:
            return detections

        result = model_result[0]
        result_boxes = getattr(result, "boxes", None)
        if result_boxes is None or result_boxes.xyxy is None:
            return detections

        xyxy_values = result_boxes.xyxy.cpu().numpy().tolist()
        cls_values = result_boxes.cls.cpu().numpy().tolist() if result_boxes.cls is not None else [0] * len(xyxy_values)
        conf_values = result_boxes.conf.cpu().numpy().tolist() if result_boxes.conf is not None else [1.0] * len(xyxy_values)
        track_ids = (
            result_boxes.id.cpu().numpy().tolist()
            if getattr(result_boxes, "id", None) is not None
            else [None] * len(xyxy_values)
        )

        for xyxy, class_id, confidence, track_id in zip(xyxy_values, cls_values, conf_values, track_ids):
            x, y, w, h = xyxy_to_xywh(xyxy)
            class_id = int(class_id)
            detections.append({
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "bbox": (x, y, w, h),
                "class_id": class_id,
                "label": yolo_names.get(class_id, "object"),
                "confidence": float(confidence),
                "track_id": int(track_id) if track_id is not None else None
            })

        return detections

    def pick_detection(state, detections, used_indexes, current_frame_bgr=None):
        compatible_ids = state["compatible_class_ids"]
        previous_box = (state["x"], state["y"], state["w"], state["h"])
        predicted_box = predict_box(state)
        missed = state.get("missed", 0)
        search_radius = min(
            140.0,
            max(max_motion_pixels * 1.75, max(state["w"], state["h"]) * 0.28)
            + (missed * max_motion_pixels * 0.75)
        )

        best_index = None
        best_detection = None
        best_score = -1.0

        for index, detection in enumerate(detections):
            if index in used_indexes:
                continue
            if compatible_ids and detection["class_id"] not in compatible_ids:
                continue

            distance = center_distance(predicted_box, detection["bbox"])
            appearance_score = histogram_similarity(
                state.get("appearance_hist"),
                crop_histogram(current_frame_bgr, detection["bbox"])
            )
            previous_centroid_distance = center_distance(previous_box, detection["bbox"])
            nearest_centroid_distance = min(distance, previous_centroid_distance)
            can_reacquire_far = (
                missed >= 2
                and appearance_score >= 0.72
                and nearest_centroid_distance <= search_radius * 1.7
            )
            if nearest_centroid_distance > search_radius and not can_reacquire_far:
                continue

            centroid_score = max(0.0, 1.0 - (nearest_centroid_distance / max(search_radius, 1.0)))
            track_id_bonus = 0.2 if state.get("track_id") is not None and detection.get("track_id") == state.get("track_id") else 0.0
            score = (
                match_score(predicted_box, detection["bbox"])
                + detection["confidence"] * 0.25
                + centroid_score * 3.2
                + appearance_score * 0.8
                + track_id_bonus
            )
            if score > best_score:
                best_index = index
                best_detection = {
                    **detection,
                    "appearance_score": appearance_score,
                    "centroid_distance": previous_centroid_distance,
                    "allow_reacquire": can_reacquire_far
                }
                best_score = score

        if best_detection is None or best_score < 0.65:
            return None, None

        return best_index, best_detection

    def run_template_fallback(state, frame_gray, frame_width, frame_height):
        template = state["template"]
        template_h, template_w = template.shape[:2]
        search_margin = int(max(template_w, template_h) * 1.75) + 32

        search_x1 = max(0, state["x"] - search_margin)
        search_y1 = max(0, state["y"] - search_margin)
        search_x2 = min(frame_width, state["x"] + state["w"] + search_margin)
        search_y2 = min(frame_height, state["y"] + state["h"] + search_margin)
        search_area = frame_gray[search_y1:search_y2, search_x1:search_x2]

        if search_area.shape[0] < template_h or search_area.shape[1] < template_w:
            return state["x"], state["y"], state["w"], state["h"], state["score"]

        match = cv2.matchTemplate(search_area, template, cv2.TM_CCOEFF_NORMED)
        _, max_value, _, max_location = cv2.minMaxLoc(match)
        x = search_x1 + max_location[0]
        y = search_y1 + max_location[1]
        x, y, w, h = clamp_box({"x": x, "y": y, "width": state["w"], "height": state["h"]}, frame_width, frame_height)
        return x, y, w, h, max(0.0, float(max_value))

    def read_grayscale_frame(path):
        if not is_valid_image_file(path):
            return None
        try:
            return cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        except cv2.error as exc:
            print(f"Skipping unreadable frame {path}: {exc}")
            return None

    def read_color_frame(path):
        if not is_valid_image_file(path):
            return None
        try:
            return cv2.imread(path, cv2.IMREAD_COLOR)
        except cv2.error as exc:
            print(f"Skipping unreadable color frame {path}: {exc}")
            return None

    def init_flow_points(frame_gray, x, y, w, h):
        x, y, w, h = clamp_box({"x": x, "y": y, "width": w, "height": h}, frame_gray.shape[1], frame_gray.shape[0])
        roi = frame_gray[y:y + h, x:x + w]
        if roi.size == 0:
            return None

        points = cv2.goodFeaturesToTrack(
            roi,
            maxCorners=80,
            qualityLevel=0.01,
            minDistance=4,
            blockSize=5
        )
        if points is None:
            return None

        points[:, 0, 0] += x
        points[:, 0, 1] += y
        return points.astype(np.float32)

    def run_optical_flow(state, previous_frame_gray, current_frame_gray, frame_width, frame_height):
        old_points = state.get("flow_points")
        if old_points is None or len(old_points) < 4:
            old_points = init_flow_points(
                previous_frame_gray,
                state["x"],
                state["y"],
                state["w"],
                state["h"]
            )

        if old_points is None or len(old_points) < 4:
            return None

        new_points, status, _ = cv2.calcOpticalFlowPyrLK(
            previous_frame_gray,
            current_frame_gray,
            old_points,
            None,
            winSize=(21, 21),
            maxLevel=3,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03)
        )
        if new_points is None or status is None:
            return None

        good_old = old_points[status.flatten() == 1].reshape(-1, 2)
        good_new = new_points[status.flatten() == 1].reshape(-1, 2)
        if len(good_new) < 4:
            return None

        movement = good_new - good_old
        dx, dy = np.median(movement, axis=0)

        old_span = np.ptp(good_old, axis=0)
        new_span = np.ptp(good_new, axis=0)
        valid_scale = old_span > 2
        scale_values = np.divide(
            new_span[valid_scale],
            old_span[valid_scale],
            out=np.ones_like(new_span[valid_scale]),
            where=old_span[valid_scale] != 0
        )
        scale = float(np.median(scale_values)) if len(scale_values) > 0 else 1.0
        scale = max(0.85, min(1.15, scale))

        new_w = state["w"] * scale
        new_h = state["h"] * scale
        new_x = state["x"] + float(dx) - ((new_w - state["w"]) / 2)
        new_y = state["y"] + float(dy) - ((new_h - state["h"]) / 2)
        x, y, w, h = clamp_box(
            {"x": new_x, "y": new_y, "width": new_w, "height": new_h},
            frame_width,
            frame_height
        )

        state["flow_points"] = good_new.reshape(-1, 1, 2).astype(np.float32)
        return x, y, w, h, min(1.0, len(good_new) / max(len(old_points), 1))

    class_filter = set()
    for box in boxes:
        class_filter.update(compatible_class_ids(box))

    tracker_available = yolo is not None and person_class_id is not None
    tracker_failed = False

    def run_detector(frame_path, persist):
        nonlocal tracker_failed
        if yolo is None:
            return [], "template"

        kwargs = {"verbose": False, "conf": 0.15, "iou": 0.5}
        if person_class_id is not None:
            kwargs["classes"] = [person_class_id]
        elif class_filter:
            kwargs["classes"] = sorted(class_filter)

        if not tracker_failed:
            try:
                return extract_detections(
                    yolo.track(frame_path, persist=persist, tracker="botsort.yaml", **kwargs)
                ), "botsort"
            except Exception as exc:
                tracker_failed = True
                print(f"BoT-SORT tracking failed, falling back to YOLO detection matching: {exc}")

        try:
            return extract_detections(yolo(frame_path, **kwargs)), "detector"
        except Exception as exc:
            print(f"YOLO detector tracking fallback failed, using template matching only: {exc}")
            return [], "template"

    start_path = os.path.join(images_dir, start_filename)
    previous_gray = read_grayscale_frame(start_path)
    previous_color = read_color_frame(start_path)
    if previous_gray is None:
        raise HTTPException(status_code=500, detail="Failed to read start frame")

    frame_height, frame_width = previous_gray.shape[:2]
    tracked_states = []
    start_detections, tracker_method = run_detector(start_path, persist=False)
    used_start_detections = set()

    for box in boxes:
        x, y, w, h = clamp_box(box, frame_width, frame_height)
        template = previous_gray[y:y + h, x:x + w].copy()
        if template.size == 0:
            continue

        state = {
            "source_box": box,
            "x": x,
            "y": y,
            "w": w,
            "h": h,
            "template": template,
            "score": float(box.get("confidence", 1.0)),
            "track_id": None,
            "compatible_class_ids": compatible_class_ids(box),
            "flow_points": init_flow_points(previous_gray, x, y, w, h),
            "appearance_hist": crop_histogram(previous_color, (x, y, w, h)),
            "vx": 0.0,
            "vy": 0.0,
            "missed": 0
        }
        detection_index, detection = pick_detection(state, start_detections, used_start_detections, previous_color)
        if detection is not None:
            used_start_detections.add(detection_index)
            state["track_id"] = detection.get("track_id")

        tracked_states.append({
            **state
        })

    if not tracked_states:
        raise HTTPException(status_code=400, detail="No valid bounding boxes to track")

    results = {}
    used_methods = set()
    was_cancelled = False

    for filename in files[start_index + 1:start_index + 1 + frames_to_track]:
        if task_id in tracking_cancel_requests:
            was_cancelled = True
            update_tracking_progress(
                len(results),
                frames_to_track,
                "cancelled",
                f"Tracking stopped at {len(results)} of {frames_to_track} frame(s)",
                methods=used_methods
            )
            break

        frame_path = os.path.join(images_dir, filename)
        current_gray = read_grayscale_frame(frame_path)
        if current_gray is None:
            update_tracking_progress(
                len(results),
                frames_to_track,
                "tracking",
                f"Skipping unreadable frame {filename}",
                filename=filename,
                methods=used_methods
            )
            continue

        frame_height, frame_width = current_gray.shape[:2]
        current_color = read_color_frame(frame_path)
        detections, tracker_method = run_detector(frame_path, persist=True)
        used_detections = set()
        frame_annotations = []

        for state in tracked_states:
            previous_box = (state["x"], state["y"], state["w"], state["h"])
            detection_index, detection = pick_detection(state, detections, used_detections, current_color)
            if detection is not None:
                used_methods.add(tracker_method)
                if detection.get("allow_reacquire", False):
                    used_methods.add("reacquire")
                used_detections.add(detection_index)
                proposed_box = clamp_box(
                    {"x": detection["x"], "y": detection["y"], "width": detection["w"], "height": detection["h"]},
                    frame_width,
                    frame_height
                )
                state["x"], state["y"], state["w"], state["h"] = constrain_box_motion(
                    state,
                    proposed_box,
                    frame_width,
                    frame_height,
                    allow_reacquire=detection.get("allow_reacquire", False),
                    align_to_detection=True
                )
                state["score"] = detection["confidence"]
                state["missed"] = 0
                if detection.get("track_id") is not None:
                    state["track_id"] = detection["track_id"]
                state["flow_points"] = init_flow_points(
                    current_gray,
                    state["x"],
                    state["y"],
                    state["w"],
                    state["h"]
                )
                detection_hist = crop_histogram(current_color, (state["x"], state["y"], state["w"], state["h"]))
                if detection_hist is not None and detection.get("appearance_score", 0) >= 0.35:
                    state["appearance_hist"] = detection_hist
            else:
                state["missed"] = state.get("missed", 0) + 1
                flow_result = run_optical_flow(state, previous_gray, current_gray, frame_width, frame_height)
                if flow_result is not None:
                    used_methods.add("optical_flow")
                    proposed_x, proposed_y, proposed_w, proposed_h, state["score"] = flow_result
                    state["x"], state["y"], state["w"], state["h"] = constrain_box_motion(
                        state,
                        (proposed_x, proposed_y, proposed_w, proposed_h),
                        frame_width,
                        frame_height
                    )
                else:
                    used_methods.add("template")
                    proposed_x, proposed_y, proposed_w, proposed_h, state["score"] = run_template_fallback(
                        state,
                        current_gray,
                        frame_width,
                        frame_height
                    )
                    state["x"], state["y"], state["w"], state["h"] = constrain_box_motion(
                        state,
                        (proposed_x, proposed_y, proposed_w, proposed_h),
                        frame_width,
                        frame_height
                    )

            x, y, w, h = state["x"], state["y"], state["w"], state["h"]
            state["vx"] = (x - previous_box[0]) * 0.7 + state.get("vx", 0.0) * 0.3
            state["vy"] = (y - previous_box[1]) * 0.7 + state.get("vy", 0.0) * 0.3
            next_template = current_gray[y:y + h, x:x + w]
            if next_template.size > 0:
                state["template"] = next_template.copy()
            if state.get("flow_points") is None or len(state["flow_points"]) < 8:
                state["flow_points"] = init_flow_points(current_gray, x, y, w, h)

            frame_annotations.append(make_annotation(state["source_box"], x, y, w, h, state["score"]))

        results[filename] = frame_annotations
        previous_gray = current_gray
        previous_color = current_color
        update_tracking_progress(
            len(results),
            frames_to_track,
            "tracking",
            f"Tracked {len(results)} of {frames_to_track} frame(s)",
            filename=filename,
            methods=used_methods
        )

    if was_cancelled:
        tracking_cancel_requests.discard(task_id)
    else:
        update_tracking_progress(
            len(results),
            frames_to_track,
            "completed",
            f"Tracking complete: {len(results)} frame(s)",
            methods=used_methods
        )

    return {
        "task_id": task_id,
        "results": results,
        "tracked_frames": len(results),
        "cancelled": was_cancelled,
        "tracker": "detector" if tracker_failed else ("botsort" if tracker_available else "template"),
        "methods_used": sorted(used_methods),
        "max_motion_pixels": max_motion_pixels,
        "tracker_model": getattr(yolo, "ckpt_path", None) or getattr(yolo, "model_name", None)
    }


@router.get("/track/progress/{task_id}")
async def get_tracking_progress(task_id: str):
    return tracking_progress.get(task_id, {
        "task_id": task_id,
        "current": 0,
        "total": 0,
        "percent": 0,
        "status": "unknown",
        "message": "Tracking task not found",
        "methods_used": []
    })


@router.post("/track/cancel/{task_id}")
async def cancel_tracking(task_id: str):
    tracking_cancel_requests.add(task_id)
    current = tracking_progress.get(task_id, {})
    tracking_progress[task_id] = {
        **current,
        "task_id": task_id,
        "status": "cancelling",
        "message": "Stopping tracker after the current frame..."
    }
    return {"status": "cancelling", "task_id": task_id}

@router.delete("/images/{filename}")
async def delete_image(filename: str, project_name: str | None = Query(None)):
    images_dir, label_dir = get_project_paths(project_name, fallback_to_flat=True)
    image_path = os.path.join(images_dir, filename)
    
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
        
    try:
        os.remove(image_path)
        
        # Also remove annotation file if exists
        base_name = os.path.splitext(filename)[0]
        json_path = os.path.join(label_dir, f"{base_name}.json")
        if os.path.exists(json_path):
            os.remove(json_path)
            
        return {"status": "deleted", "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/project_data")
async def get_project_data(project_name: str = Query("active_workspace")):
    images_dir, labels_dir = get_project_paths(project_name, fallback_to_flat=True)
    images = list_image_files(project_name)
    annotations = {}

    if os.path.exists(labels_dir):
        import json
        for label_file in os.listdir(labels_dir):
            if not label_file.endswith(".json"):
                continue

            base_name = os.path.splitext(label_file)[0]
            matching_image = next((img for img in images if os.path.splitext(img)[0] == base_name), None)
            if not matching_image:
                continue

            try:
                with open(os.path.join(labels_dir, label_file), "r") as f:
                    annotations[matching_image] = json.load(f)
            except Exception as e:
                print(f"Failed to load {label_file}: {e}")

    return {"images": images, "annotations": annotations}


@router.get("/projects")
async def list_projects():
    projects_dir = os.path.join(DATA_DIR, "projects")
    if not os.path.exists(projects_dir):
        return []

    projects = []
    try:
        for entry in os.scandir(projects_dir):
            if not entry.is_dir():
                continue

            img_dir = os.path.join(entry.path, "images")
            lbl_dir = os.path.join(entry.path, "labels")
            image_count = len([
                f for f in os.listdir(img_dir)
                if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))
            ]) if os.path.exists(img_dir) else 0
            annotation_count = len([
                f for f in os.listdir(lbl_dir)
                if f.endswith(".json")
            ]) if os.path.exists(lbl_dir) else 0

            projects.append({
                "id": entry.name,
                "name": entry.name,
                "path": entry.path,
                "created": os.path.getctime(entry.path) * 1000,
                "lastEdited": os.path.getmtime(entry.path) * 1000,
                "imageCount": image_count,
                "annotationCount": annotation_count,
                "model": "YOLO-SAM2"
            })
    except Exception as e:
        print(f"Error listing projects: {e}")
        return []

    projects.sort(key=lambda x: x["lastEdited"], reverse=True)
    return projects


@router.delete("/projects/{project_name}")
async def delete_project(project_name: str):
    safe_name = sanitize_project_name(project_name)
    project_dir = os.path.abspath(os.path.join(DATA_DIR, "projects", safe_name))
    projects_root = os.path.abspath(os.path.join(DATA_DIR, "projects"))

    if not project_dir.startswith(projects_root):
        raise HTTPException(status_code=403, detail="Invalid project path")

    if not os.path.exists(project_dir):
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        shutil.rmtree(project_dir)
        return {"status": "deleted", "project": safe_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/train_export_advanced")
async def export_training_data_advanced(
    project_name: str = Query("active_workspace"),
    split_train: float = Query(0.7),
    split_valid: float = Query(0.2),
    split_test: float = Query(0.1),
    aug_count: int = Query(2),
    config: dict = Body(...)
):
    from .training_export import generate_training_zip
    from starlette.background import BackgroundTask

    splits = {"train": split_train, "valid": split_valid, "test": split_test}
    if abs(sum(splits.values()) - 1.0) > 0.01:
        raise HTTPException(status_code=400, detail="Split ratios must sum to 1.0")

    def cleanup(path):
        if os.path.exists(path):
            os.remove(path)

    try:
        zip_path = generate_training_zip(
            project_name=project_name,
            base_dir=BASE_DIR,
            split_ratios=splits,
            aug_config=config,
            num_aug_versions=aug_count
        )

        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=f"{project_name}_colab_ready.zip",
            background=BackgroundTask(cleanup, zip_path)
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preview_augmentation")
async def preview_augmentation(
    project_name: str = Query("active_workspace"),
    config: dict = Body(...)
):
    import base64
    import cv2
    import json
    import random
    from .training_export import apply_augmentations

    images_dir, labels_dir = get_project_paths(project_name, fallback_to_flat=True)
    images = list_image_files(project_name)
    if not images:
        raise HTTPException(status_code=404, detail="No images in project")

    filename = random.choice(images)
    img_path = os.path.join(images_dir, filename)
    image = cv2.imread(img_path)
    if image is None:
        raise HTTPException(status_code=500, detail="Failed to read image")

    base_name = os.path.splitext(filename)[0]
    json_path = os.path.join(labels_dir, f"{base_name}.json")
    bboxes = []
    category_ids = []

    if os.path.exists(json_path):
        with open(json_path, "r") as f:
            for ann in json.load(f):
                bboxes.append([ann["x"], ann["y"], ann["width"], ann["height"]])
                category_ids.append(ann.get("class_id", 0))

    aug_img, aug_bboxes = apply_augmentations(image, bboxes, category_ids, config)

    def draw_boxes(img, boxes):
        vis = img.copy()
        for box in boxes:
            x, y, w, h = map(int, box)
            cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 255, 0), 2)
        return vis

    def encode_img(img):
        _, buffer = cv2.imencode(".jpg", img)
        return base64.b64encode(buffer).decode("utf-8")

    return {
        "filename": filename,
        "original": encode_img(draw_boxes(image, bboxes)),
        "augmented": encode_img(draw_boxes(aug_img, aug_bboxes))
    }


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
def extract_video_frames(
    video_id: str,
    frame_step: int = 1,
    project_name: str | None = Query(None)
):
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
        images_dir, labels_dir = get_project_paths(project_name)
        
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
        failed_frames = []
        expected_extract_count = (total_frames + frame_step - 1) // frame_step if total_frames > 0 else 0
        started_at = time.time()

        def cleanup_file(path):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass

        def write_frame_atomic(frame, out_path):
            temp_path = f"{out_path}.tmp.png"
            cleanup_file(temp_path)

            try:
                ok = cv2.imwrite(temp_path, frame, [cv2.IMWRITE_PNG_COMPRESSION, 3])
            except cv2.error as exc:
                cleanup_file(temp_path)
                return False, str(exc)

            if not ok:
                cleanup_file(temp_path)
                return False, "cv2.imwrite returned false"

            if not os.path.exists(temp_path) or os.path.getsize(temp_path) <= 0:
                cleanup_file(temp_path)
                return False, "empty frame file"

            try:
                verified = cv2.imread(temp_path, cv2.IMREAD_UNCHANGED)
            except cv2.error as exc:
                cleanup_file(temp_path)
                return False, str(exc)

            if verified is None or verified.size == 0:
                cleanup_file(temp_path)
                return False, "frame verification failed"

            os.replace(temp_path, out_path)
            return True, None

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
                "failed": len(failed_frames),
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
                ok, error = write_frame_atomic(frame, out_path)
                if ok:
                    extracted_filenames.append(frame_name)
                    extracted_count += 1
                else:
                    cleanup_file(out_path)
                    failed_frames.append({
                        "frame": frame_idx,
                        "filename": frame_name,
                        "error": error
                    })
                
            # Update extraction progress tracker
            if frame_idx % 5 == 0 or frame_idx == total_frames - 1:
                extraction_progress[video_id] = build_progress(frame_idx + 1, "extracting")
                
            frame_idx += 1
            
        cap.release()
        
        # 3. Clean up the video file to conserve space
        if os.path.exists(video_path):
            os.remove(video_path)
            
        final_status = "completed_with_errors" if failed_frames else "completed"
        extraction_progress[video_id] = build_progress(total_frames, final_status)
        
        return {
            "status": "success",
            "extraction_status": final_status,
            "extracted_count": extracted_count,
            "failed_count": len(failed_frames),
            "failed_frames": failed_frames[:50],
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

