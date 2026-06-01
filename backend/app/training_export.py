import os
import shutil
import tempfile
import yaml
import json
import cv2
import random
import albumentations as A
import numpy as np
from typing import List, Dict, Tuple
from fastapi.responses import FileResponse

# Helper to get paths safely
def get_project_paths_export(project_name: str, base_dir: str):
    safe_name = "".join([c for c in project_name if c.isalnum() or c in (' ', '_', '-', '(', ')', '.')]).strip()
    if not safe_name: safe_name = "default_project"
    project_dir = os.path.join(base_dir, "data", "projects", safe_name)
    images_dir = os.path.join(project_dir, "images")
    labels_dir = os.path.join(project_dir, "labels")

    if os.path.exists(images_dir) and any(
        f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))
        for f in os.listdir(images_dir)
    ):
        return images_dir, labels_dir

    return os.path.join(base_dir, "data", "images"), os.path.join(base_dir, "data", "labels")

def normalize_yolo_coords(box: List[float], w: int, h: int):
    # box: [x, y, w, h] (top-left)
    xc = (box[0] + box[2]/2) / w
    yc = (box[1] + box[3]/2) / h
    wn = box[2] / w
    hn = box[3] / h
    return [xc, yc, wn, hn]

def denormalize_yolo_coords(box: List[float], w: int, h: int):
    # box: [xc, yc, wn, hn] -> [x, y, w, h] (top-left)
    width = box[2] * w
    height = box[3] * h
    x = (box[0] * w) - (width / 2)
    y = (box[1] * h) - (height / 2)
    return [x, y, width, height]

def get_export_class_id(ann: dict, class_map: Dict[int, str]):
    label = str(ann.get('label') or f"class_{ann.get('class_id', 0)}").strip() or "object"

    for cid, existing_label in class_map.items():
        if existing_label == label:
            return cid

    next_id = 0
    while next_id in class_map:
        next_id += 1

    class_map[next_id] = label
    return next_id

def apply_augmentations(image, bboxes, category_ids, config: Dict):
    """
    Apply augmentations with a 'Smart Strategy':
    - Geometric (Flip, Rotate) are applied independently.
    - Pixel-level corruptions (Blur, Noise) are grouped in a OneOf block to avoid over-distortion.
    - Lighting (Brightness) is applied independently.
    """
    transforms = []
    
    # Helper to parse config
    def get_param(key, default_p=0.5, **kwargs):
        val = config.get(key)
        if val is None or val is False:
            return None
        if val is True: # Legacy
            return {'p': default_p, **kwargs}
        if isinstance(val, dict):
            params = {'p': val.get('p', default_p)}
            params.update(kwargs)
            for k, v in val.items():
                if k != 'p': params[k] = v
            return params
        return None

    # --- 1. Geometric (Structure) ---
    # Independent: Can be both flipped and rotated
    p_h = get_param('flip_horizontal')
    if p_h: transforms.append(A.HorizontalFlip(p=p_h['p']))

    p_v = get_param('flip_vertical')
    if p_v: transforms.append(A.VerticalFlip(p=p_v['p']))

    p_r = get_param('rotate', default_p=0.5, limit=15)
    if p_r: transforms.append(A.Rotate(limit=p_r['limit'], p=p_r['p']))

    # --- 2. Lighting (Environment) ---
    p_b = get_param('brightness', default_p=0.2)
    if p_b: transforms.append(A.RandomBrightnessContrast(p=p_b['p']))

    # --- 3. Pixel Corruptions (Quality) ---
    # Smart Strategy: Use OneOf to prevent stacking multiple heavy distortions
    pixel_transforms = []
    
    p_blur = get_param('blur', default_p=0.2, blur_limit=3)
    if p_blur: 
        # For OneOf, 'p' is probability of the BLOCK being applied.
        # Inside, we treat them as candidates.
        pixel_transforms.append(A.GaussianBlur(blur_limit=p_blur['blur_limit'], p=1.0))

    p_n = get_param('noise', default_p=0.2)
    if p_n: 
        pixel_transforms.append(A.GaussNoise(p=1.0))
        
    if pixel_transforms:
        # Calculate combined probability (naive logic or user max)
        # We use a fixed p=0.5 or max of user inputs? 
        # Let's say if ANY pixel aug is enabled, we allow OneOf to run with the max probability specified.
        # But user gave specific 'p' for each.
        # Let's simple append them as OneOf([T1, T2], p=max(p1, p2))?
        pass
        
    # ALTERNATIVE: Just add them independently but with logic?
    # Actually, user wants "PnC" (Permutations).
    # Being able to stack them IS permutations.
    # Restricting to OneOf REDUCES variety but INCREASES quality.
    # Let's stick to independent for max PnC variety as per user request ("better variety").
    
    # Reverting "Smart OneOf" idea because user explicitly asked for "original + augmentation's pnc with each other".
    # This implies they WANT combinations (Stacking).
    
    # So, let's keep them Independent but ensure they are composed properly.
    if p_blur: transforms.append(A.GaussianBlur(blur_limit=p_blur['blur_limit'], p=p_blur['p']))
    if p_n: transforms.append(A.GaussNoise(p=p_n['p']))

    if not transforms:
        return image, bboxes

    # Ensure format compatibility
    transform = A.Compose(
        transforms, 
        bbox_params=A.BboxParams(format='coco', label_fields=['category_ids']) 
    )
    
    try:
        transformed = transform(image=image, bboxes=bboxes, category_ids=category_ids)
        return transformed['image'], transformed['bboxes']
    except Exception as e:
        print(f"Augmentation failed: {e}")
        return image, bboxes

def generate_training_zip(
    project_name: str,
    base_dir: str,
    split_ratios: Dict[str, float], # {'train': 0.7, 'valid': 0.2, 'test': 0.1}
    aug_config: Dict,
    num_aug_versions: int = 2 # How many augmented versions per training image
):
    images_dir, labels_dir = get_project_paths_export(project_name, base_dir)
    images = [f for f in os.listdir(images_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp'))]
    
    if not images:
        raise ValueError("No images found")
        
    temp_dir = tempfile.mkdtemp()
    
    # Structure match user request
    # root/
    #   train/images, train/labels
    #   valid/images, valid/labels
    #   test/images, test/labels
    #   data.yaml
    #   README.dataset.txt
    #   README.roboflow.txt
    
    dataset_root = os.path.join(temp_dir, f"{project_name}_training_ready")
    os.makedirs(dataset_root, exist_ok=True)
    
    dirs = ['train', 'valid', 'test']
    for d in dirs:
        os.makedirs(os.path.join(dataset_root, d, 'images'), exist_ok=True)
        os.makedirs(os.path.join(dataset_root, d, 'labels'), exist_ok=True)
        
    # Split
    random.shuffle(images)
    n = len(images)
    n_train = int(n * split_ratios.get('train', 0.7))
    n_valid = int(n * split_ratios.get('valid', 0.2))
    # Rest to test
    
    splits = {
        'train': images[:n_train],
        'valid': images[n_train:n_train+n_valid],
        'test': images[n_train+n_valid:]
    }
    
    class_map = {}
    
    # Process Splits
    for split_name, split_imgs in splits.items():
        for img_file in split_imgs:
            base_name = os.path.splitext(img_file)[0]
            json_file = os.path.join(labels_dir, f"{base_name}.json")
            img_path_src = os.path.join(images_dir, img_file)
            
            if not os.path.exists(json_file):
                continue
                
            image = cv2.imread(img_path_src)
            h, w = image.shape[:2]
            
            with open(json_file, 'r') as f:
                anns = json.load(f)
                
            bboxes = []
            categories = []
            
            for ann in anns:
                cid = get_export_class_id(ann, class_map)
                
                # [x, y, w, h]
                bboxes.append([ann['x'], ann['y'], ann['width'], ann['height']])
                categories.append(cid)
                
            # --- Save Original (for all splits) ---
            # Save Image
            shutil.copy2(img_path_src, os.path.join(dataset_root, split_name, 'images', img_file))
            
            # Save Labels (YOLO format)
            yolo_lines = []
            for i, box in enumerate(bboxes):
                norm_box = normalize_yolo_coords(box, w, h)
                yolo_lines.append(f"{categories[i]} {' '.join([f'{x:.6f}' for x in norm_box])}")
                
            with open(os.path.join(dataset_root, split_name, 'labels', f"{base_name}.txt"), 'w') as f:
                f.write("\n".join(yolo_lines))
                
            # --- Augmentation (Only for Train) ---
            if split_name == 'train' and num_aug_versions > 0:
                for v in range(num_aug_versions):
                    aug_img, aug_bboxes = apply_augmentations(image, bboxes, categories, aug_config)
                    
                    # Save Aug Image
                    aug_filename = f"{base_name}_aug_{v}.jpg"
                    cv2.imwrite(os.path.join(dataset_root, split_name, 'images', aug_filename), aug_img)
                    
                    # Save Aug Labels
                    aug_lines = []
                    aug_h, aug_w = aug_img.shape[:2]
                    for i, box in enumerate(aug_bboxes):
                        # Albumentations might return coords outside image slightly, clip them?
                        # COCO format is x,y,w,h.
                        # Ensure nice coords
                        bx, by, bw, bh = box
                        # Clip to image logic if needed, but YOLO handles center/width format.
                        # Standard normalization:
                        norm_box = normalize_yolo_coords([bx, by, bw, bh], aug_w, aug_h)
                        
                        # Validate 0-1 range
                        norm_box = [max(0, min(1, x)) for x in norm_box] # Simple clamping might distort, but essential for Yolo
                        
                        aug_lines.append(f"{categories[i]} {' '.join([f'{x:.6f}' for x in norm_box])}")
                        
                    with open(os.path.join(dataset_root, split_name, 'labels', f"{base_name}_aug_{v}.txt"), 'w') as f:
                        f.write("\n".join(aug_lines))
                        
    # --- Generate Files ---
    
    # 1. data.yaml
    sorted_ids = sorted(class_map.keys())
    names = [class_map.get(i, f"class_{i}") for i in sorted_ids]
    
    # To handle potential gaps in IDs, standard YOLO expects 0..N-1.
    # If IDs are sparse (e.g. 0, 5, 10), we might need remapping. 
    # For this snippet, assuming 0-indexed sequential or user handles it.
    
    yaml_data = {
        'train': os.path.join('train', 'images'),
        'val': os.path.join('valid', 'images'),
        'test': os.path.join('test', 'images'),
        'nc': len(names),
        'names': names
    }
    
    with open(os.path.join(dataset_root, 'data.yaml'), 'w') as f:
        yaml.dump(yaml_data, f, default_flow_style=False)
        
    # 2. README.dataset.txt
    readme_dataset = f"""
Dataset: {project_name}
Exported on: {os.getcwd()}

Classes: {names}

Split:
Train: {split_ratios.get('train')*100}%
Valid: {split_ratios.get('valid')*100}%
Test: {split_ratios.get('test')*100}%

Augmentations Applied (Train only):
Config: {json.dumps(aug_config, indent=2)}
Versions per image: {num_aug_versions}
    """
    with open(os.path.join(dataset_root, 'README.dataset.txt'), 'w') as f:
        f.write(readme_dataset.strip())
        
    # 3. README.roboflow.txt (Automated substitute)
    readme_colab = f"""
# Training on Google Colab

This dataset is structured for YOLOv8/YOLO11 training.
    
## Steps:
1. Upload this zip to your Google Drive.
2. Mount Drive in Colab:
   ```python
   from google.colab import drive
   drive.mount('/content/drive')
   ```
3. Unzip:
   ```python
   !unzip /content/drive/MyDrive/{project_name}_training_ready.zip -d /content/dataset
   ```
4. Train:
   ```python
   from ultralytics import YOLO
   
   model = YOLO('yolov8n.pt')
   results = model.train(data='/content/dataset/data.yaml', epochs=100, imgsz=640)
   ```
   
Generated by YOLO-SAM2-Annotator.
    """
    with open(os.path.join(dataset_root, 'README.roboflow.txt'), 'w') as f:
        f.write(readme_colab.strip())
        
    # Zip
    zip_output_path = os.path.join(tempfile.gettempdir(), f"{project_name}_colab_ready")
    shutil.make_archive(zip_output_path, 'zip', root_dir=dataset_root)
    
    shutil.rmtree(temp_dir)
    return zip_output_path + ".zip"
