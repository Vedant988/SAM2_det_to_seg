import os
import json
import shutil
import tempfile
import random
import cv2
import yaml
from glob import glob
from typing import List, Dict, Any

# Utils to get paths (mirrored from api.py to avoid circular imports/refactors)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")

def get_project_paths(project_name: str):
    safe_name = "".join([c for c in project_name if c.isalnum() or c in (' ', '_', '-', '(', ')', '.')]).strip()
    if not safe_name:
        safe_name = "default_project"
    
    project_dir = os.path.join(DATA_DIR, "projects", safe_name)
    images_dir = os.path.join(project_dir, "images")
    labels_dir = os.path.join(project_dir, "labels")

    if os.path.exists(images_dir) and any(
        f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))
        for f in os.listdir(images_dir)
    ):
        return images_dir, labels_dir

    flat_images_dir = os.path.join(DATA_DIR, "images")
    flat_labels_dir = os.path.join(DATA_DIR, "labels")
    if os.path.exists(flat_images_dir):
        return flat_images_dir, flat_labels_dir

    return images_dir, labels_dir

def normalize_coords_yolo(box: dict, img_w: int, img_h: int):
    # Absolute (Top-Left x, y, w, h) -> Normalized (Center x, Center y, w, h)
    x, y, w, h = box['x'], box['y'], box['width'], box['height']
    
    x_center = x + (w / 2)
    y_center = y + (h / 2)
    
    return [
        x_center / img_w,
        y_center / img_h,
        w / img_w,
        h / img_h
    ]

def normalize_points_yolo(points: List[float], img_w: int, img_h: int):
    # Flattened [x1, y1, x2, y2...] -> Normalized [x1n, y1n, x2n, y2n...]
    normalized = []
    for i in range(0, len(points), 2):
        normalized.append(points[i] / img_w)
        if i + 1 < len(points):
            normalized.append(points[i+1] / img_h)
    return normalized

def get_export_class_id(ann: dict, class_map: Dict[int, str]):
    """
    Export class IDs should be contiguous and label-driven. This protects manual
    annotations where multiple labels may have been saved with class_id=0.
    """
    label = str(ann.get('label') or f"class_{ann.get('class_id', 0)}").strip() or "object"

    for cid, existing_label in class_map.items():
        if existing_label == label:
            return cid

    next_id = 0
    while next_id in class_map:
        next_id += 1

    class_map[next_id] = label
    return next_id

def export_yolo(
    images: List[str], 
    images_dir: str, 
    labels_dir: str, 
    temp_dir: str, 
    task: str, 
    split_ratio: float,
    class_map: Dict[int, str]
):
    # Structure
    # dataset/
    #   train/images, train/labels
    #   valid/images, valid/labels
    #   data.yaml
    
    fs = {
        'train': os.path.join(temp_dir, 'train'),
        'valid': os.path.join(temp_dir, 'valid'),
        'test': os.path.join(temp_dir, 'test')
    }
    
    for split in ['train', 'valid', 'test']:
        os.makedirs(os.path.join(fs[split], 'images'), exist_ok=True)
        os.makedirs(os.path.join(fs[split], 'labels'), exist_ok=True)
        
    # Split
    random.shuffle(images)
    split_idx = int(len(images) * split_ratio)
    train_imgs = images[:split_idx]
    valid_imgs = images[split_idx:]
    
    # Optional: If we want to support 3-way split, we can add logic here.
    # For now, adhering to user request for "Format Structure", leaving test empty is safer than assuming.
    # However, standard YOLO often uses test. 
    # Let's keep Test empty for now unless user asks for 3-way split slider.
    
    splits = [('train', train_imgs), ('valid', valid_imgs)]
    
    for split_name, split_images in splits:
        for img_name in split_images:
            # Source paths
            src_img_path = os.path.join(images_dir, img_name)
            base_name = os.path.splitext(img_name)[0]
            json_path = os.path.join(labels_dir, f"{base_name}.json")
            
            if not os.path.exists(json_path):
                continue
                
            # Read Image for dims
            # Use CV2
            img = cv2.imread(src_img_path)
            if img is None:
                continue
            h, w = img.shape[:2]
            
            # Read Labels
            with open(json_path, 'r') as f:
                annotations = json.load(f)
            
            yolo_lines = []
            for ann in annotations:
                cid = get_export_class_id(ann, class_map)
                
                if task == 'segmentation':
                    # Format: class_id x1 y1 x2 y2 ...
                    if 'points' in ann and ann['points']:
                        norm_points = normalize_points_yolo(ann['points'], w, h)
                        line_content = " ".join([f"{p:.6f}" for p in norm_points])
                        yolo_lines.append(f"{cid} {line_content}")
                    else:
                        pass 
                else:
                    # Detection
                    # Format: class_id xc yc w h
                    coords = normalize_coords_yolo(ann, w, h)
                    line_content = " ".join([f"{c:.6f}" for c in coords])
                    yolo_lines.append(f"{cid} {line_content}")
            
            # Write Label File
            txt_name = f"{base_name}.txt"
            dst_label_path = os.path.join(fs[split_name], 'labels', txt_name)
            with open(dst_label_path, 'w') as f:
                f.write("\n".join(yolo_lines))
                
            # Copy Image
            shutil.copy2(src_img_path, os.path.join(fs[split_name], 'images', img_name))

    # Generate data.yaml
    # Sort classes by ID to ensure list index matches ID
    sorted_ids = sorted(class_map.keys())
    names = [class_map[i] for i in sorted_ids]
    
    yaml_content = {
        'train': os.path.join('train', 'images'),
        'val': os.path.join('valid', 'images'),
        'test': os.path.join('test', 'images'), # Added test path
        'nc': len(names),
        'names': names
    }
    
    with open(os.path.join(temp_dir, 'data.yaml'), 'w') as f:
        yaml.dump(yaml_content, f, default_flow_style=False)

def export_coco(
    images: List[str], 
    images_dir: str, 
    labels_dir: str, 
    temp_dir: str, 
    task: str, 
    split_ratio: float,
    class_map: Dict[int, str]
):
    # Structure
    # dataset/
    #   train/
    #   valid/
    #   annotations/
    #       instances_train.json
    #       instances_valid.json
    
    os.makedirs(os.path.join(temp_dir, 'train'), exist_ok=True)
    os.makedirs(os.path.join(temp_dir, 'valid'), exist_ok=True)
    os.makedirs(os.path.join(temp_dir, 'annotations'), exist_ok=True)
    
    random.shuffle(images)
    split_idx = int(len(images) * split_ratio)
    splits = [('train', images[:split_idx]), ('valid', images[split_idx:])]
    
    coco_cat_map = {} # Internal ID mapping if needed, but we use class_id from store
    
    # Global counters
    ann_id_counter = 1
    
    for split_name, split_images in splits:
        coco_output = {
            "images": [],
            "annotations": [],
            "categories": [],
            "info": {"description": "Exported from YOLO-SAM2-Annotator"}
        }
        
        # We need to collect categories specific to this export or global?
        # Usually global categories list is best.
        # We'll populate categories at the end based on class_map found.
        
        img_id_counter = 1
        
        for img_name in split_images:
            src_img_path = os.path.join(images_dir, img_name)
            base_name = os.path.splitext(img_name)[0]
            json_path = os.path.join(labels_dir, f"{base_name}.json")
            
            if not os.path.exists(json_path):
                continue
                
            # Read Image
            img = cv2.imread(src_img_path)
            if img is None:
                continue
            h, w = img.shape[:2]
            
            # Copy image
            shutil.copy2(src_img_path, os.path.join(temp_dir, split_name, img_name))
            
            # Image Entry
            image_entry = {
                "id": img_id_counter,
                "file_name": img_name,
                "width": w,
                "height": h
            }
            coco_output["images"].append(image_entry)
            
            # Annotations
            with open(json_path, 'r') as f:
                annotations = json.load(f)
                
            for ann in annotations:
                cid = get_export_class_id(ann, class_map)
                    
                # COCO Bbox: [x_min, y_min, w, h] (Absolute)
                # Our JSON: x, y, width, height (Absolute Top-Left) -> Matches COCO
                bbox = [ann['x'], ann['y'], ann['width'], ann['height']]
                area = ann['width'] * ann['height']
                
                coco_ann = {
                    "id": ann_id_counter,
                    "image_id": img_id_counter,
                    "category_id": cid,
                    "bbox": bbox,
                    "area": area,
                    "iscrowd": 0
                }
                
                if task == 'segmentation' and 'points' in ann and ann['points']:
                    # COCO Segmentation: [[x1, y1, x2, y2, ...]]
                    coco_ann["segmentation"] = [ann['points']]
                elif task == 'segmentation':
                     # Fallback empty or bbox? COCO allows empty segmentation list for "crowd" but iscrowd=0...
                     # We'll leave it out or put empty list
                     coco_ann["segmentation"] = []

                coco_output["annotations"].append(coco_ann)
                ann_id_counter += 1
                
            img_id_counter += 1
            
        # Build Categories
        sorted_ids = sorted(class_map.keys())
        coco_output["categories"] = [
            {"id": i, "name": class_map[i], "supercategory": "none"} 
            for i in sorted_ids
        ]
        
        # Write JSON
        out_json_name = f"instances_{split_name}.json"
        with open(os.path.join(temp_dir, 'annotations', out_json_name), 'w') as f:
            json.dump(coco_output, f, indent=2)

def create_dataset_archive(
    project_name: str, 
    format: str = 'yolo', 
    task: str = 'detection', 
    split_ratio: float = 0.8
) -> str:
    """
    Generates a dataset archive and returns the path to the zip file.
    """
    images_dir, labels_dir = get_project_paths(project_name)
    
    if not os.path.exists(images_dir):
        raise FileNotFoundError(f"Project {project_name} not found")
        
    # Get all images
    images = [f for f in os.listdir(images_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]
    if not images:
        raise ValueError("No images found in project")
        
    # Create Temp Directory
    temp_dir = tempfile.mkdtemp()
    
    # Root folder name inside zip: e.g. detection-dataset-v2-(test)
    folder_name = f"{task}-dataset-{project_name}"
    dataset_root = os.path.join(temp_dir, folder_name)
    os.makedirs(dataset_root, exist_ok=True)
    
    # Pre-scan for class mapping (optional, or build on fly)
    # We will build on fly passing a shared dict
    class_map = {}
    
    try:
        if format.lower() == 'yolo':
            export_yolo(images, images_dir, labels_dir, dataset_root, task, split_ratio, class_map)
        elif format.lower() == 'coco':
            export_coco(images, images_dir, labels_dir, dataset_root, task, split_ratio, class_map)
        else:
            raise ValueError(f"Unsupported format: {format}")
            
        # Zip It
        archive_path = os.path.join(tempfile.gettempdir(), f"{project_name}_{format}_{task}")
        # root_dir=temp_dir, base_dir=folder_name ensures that when unzipped, the folder_name appears as root
        shutil.make_archive(archive_path, 'zip', root_dir=temp_dir, base_dir=folder_name)
        return archive_path + ".zip"
        
    finally:
        # Cleanup temp dir
        shutil.rmtree(temp_dir)
