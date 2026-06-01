import os
import json
import sys

# Define base paths
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
APP_DIR = os.path.join(BACKEND_DIR, "app")
CONFIG_FILE = os.path.join(BACKEND_DIR, "config.json")

def check_file(path, description):
    if not os.path.exists(path):
        print(f"❌ MISSING {description}: {path}")
        return False
    print(f"✅ FOUND {description}: {path}")
    return True

def main():
    print("Checking model weights...")
    all_good = True

    # Defaults
    sam2_name = "sam2_hiera_large.pt"
    yolo_path = "yolov8m.pt"

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                config = json.load(f)
                sam2_name = config.get("sam2_model", sam2_name)
                yolo_path = config.get("yolo_model", yolo_path)
                print(f"ℹ️  Loaded config from: {CONFIG_FILE}")
        except Exception as e:
            print(f"⚠️  Error reading config.json: {e}")
    else:
        print(f"ℹ️  No config.json found at {CONFIG_FILE}. Using defaults.")

    # SAM2 path logic (from backend/app/core.py: relative to backend/app)
    # Check if absolute path is somehow provided (unlikely for SAM2 in this app logic but good to handle)
    if os.path.isabs(sam2_name):
        sam2_full_path = sam2_name
    else:
        sam2_full_path = os.path.join(APP_DIR, sam2_name)
    
    if not check_file(sam2_full_path, "SAM2 Model"):
        all_good = False

    # YOLO path logic
    # If absolute, use as is. If relative, usually relative to backend/ (CWD)
    if not os.path.isabs(yolo_path):
         yolo_full_path = os.path.join(BACKEND_DIR, yolo_path)
         # Fallback check in root if not found in backend (sometimes users put it in root)
         if not os.path.exists(yolo_full_path):
             yolo_root_path = os.path.join(ROOT_DIR, yolo_path)
             if os.path.exists(yolo_root_path):
                 yolo_full_path = yolo_root_path
    else:
         yolo_full_path = yolo_path

    if not check_file(yolo_full_path, "YOLO Model"):
        all_good = False

    if not all_good:
        print("\n❌ CRITICAL: Missing weight files. Please download/place them in the correct locations.")
        sys.exit(1)
    
    print("\n✅ All weights checks passed.")
    sys.exit(0)

if __name__ == "__main__":
    main()
