import torch
import os
from sam2.build_sam import build_sam2

def test_load():
    checkpoint_path = r"E:\SAM2_det_to_seg\backend\app\sam2_hiera_large.pt"
    model_cfg = "sam2_hiera_l.yaml"
    device = "cpu"
    
    print(f"Testing SAM2 load: {model_cfg} -> {checkpoint_path}")
    
    try:
        model = build_sam2(model_cfg, checkpoint_path, device=device)
        print("✅ Success! Model loaded.")
        print(f"Model type: {type(model)}")
    except Exception as e:
        print(f"❌ Failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_load()
