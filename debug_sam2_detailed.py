import torch
import os
from hydra import compose, initialize_config_module, initialize
from hydra.utils import instantiate
from omegaconf import OmegaConf
import sam2

def debug_sam2_loading():
    print("Debugging SAM2 Loading...")
    
    # Check paths
    sam2_path = os.path.dirname(sam2.__file__)
    print(f"SAM2 Package Path: {sam2_path}")
    
    config_dir = os.path.join(sam2_path, "configs", "sam2")
    print(f"Expected Config Dir: {config_dir}")
    
    config_name = "sam2_hiera_l.yaml"
    
    try:
        # Replicating build_sam2 logic manually to inspect
        import sys
        # Hydra needs usage of initialize or initialize_config_dir if not using @hydra.main
        # The library uses 'compose' which usually requires initialization context if not global?
        # sam2.build_sam.build_sam2 uses compose(config_name=config_file, overrides=...)
        # But where does it look for configs? 
        # It relies on hydra's search path.
        
        # Let's try to load the config manually using OmegaConf to see what's in it
        full_config_path = os.path.join(config_dir, config_name)
        if os.path.exists(full_config_path):
             print(f"Found config file at: {full_config_path}")
             cfg = OmegaConf.load(full_config_path)
             print("--- Config Content (First 5 lines) ---")
             print(str(cfg)[:500])
             
             if 'model' in cfg:
                 print("\n--- Model Config ---")
                 print(cfg.model)
                 
                 # Check target
                 if '_target_' in cfg.model:
                     print(f"Target class: {cfg.model._target_}")
                 else:
                     print("❌ MISSING _target_ in model config! This is why instantiate returns a dict.")
             else:
                 print("❌ MISSING 'model' key in config!")
                 
        else:
            print(f"❌ Config file not found at: {full_config_path}")

    except Exception as e:
        print(f"❌ Error during debug: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    debug_sam2_loading()
