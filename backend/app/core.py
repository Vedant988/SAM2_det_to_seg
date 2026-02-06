import torch
import os
import json
from ultralytics import YOLO
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

# Global instances
yolo_model = None
sam2_predictor = None
DEVICE = "cpu"
current_yolo_model_path = None

# Config file path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")

def load_config():
    """Load configuration from file."""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    return {
        "yolo_model": "yolov8m.pt",  # Default
        "sam2_model": "sam2_hiera_large.pt",
        "device": "auto"
    }

def save_config(config):
    """Save configuration to file."""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

def init_models(device: str):
    """Initialize models with default config."""
    global DEVICE
    DEVICE = device
    
    config = load_config()
    yolo_path = config.get("yolo_model") or "yolov8m.pt"
    sam2_path = config.get("sam2_model") or "sam2_hiera_large.pt"
    
    load_yolo_model(yolo_path)
    load_sam2_model(sam2_path)

def load_yolo_model(model_path: str):
    """Load a specific YOLO model."""
    global yolo_model, current_yolo_model_path
    
    print(f"Loading YOLO model: {model_path} on {DEVICE}...")
    try:
        yolo_model = YOLO(model_path)
        yolo_model.to(DEVICE)
        current_yolo_model_path = model_path
        print(f"✅ Successfully loaded: {model_path}")
        return True
    except Exception as e:
        print(f"❌ Error loading YOLO model '{model_path}': {e}")
        return False

def load_sam2_model(model_name: str):
    """
    Load SAM2 model manually to bypass Hydra/OmegaConf issues on Windows.
    Hardcoded architecture for sam2_hiera_large.
    """
    global sam2_predictor
    
    checkpoint_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), model_name)
    
    print(f"Loading SAM2 model MANUAL BYPASS: {model_name} on {DEVICE}...")
    
    if not os.path.exists(checkpoint_path):
        print(f"⚠️ SAM2 weights not found at {checkpoint_path}. Skipping SAM2 load.")
        return False

    try:
        # Import necessary classes manually
        from sam2.modeling.sam2_base import SAM2Base
        from sam2.modeling.backbones.image_encoder import ImageEncoder, FpnNeck
        from sam2.modeling.backbones.hieradet import Hiera
        from sam2.modeling.position_encoding import PositionEmbeddingSine
        from sam2.modeling.memory_attention import MemoryAttention, MemoryAttentionLayer
        from sam2.modeling.sam.transformer import RoPEAttention
        from sam2.modeling.memory_encoder import MemoryEncoder, MaskDownSampler, Fuser, CXBlock

        # Define Architecture for Hiera Large (matches sam2_hiera_l.yaml)
        # ----------------------------------------------------------------
        
        # 1. Position Encoding for Neck
        pos_enc_neck = PositionEmbeddingSine(
            num_pos_feats=256,
            normalize=True,
            scale=None,
            temperature=10000
        )
        
        # 2. Neck
        neck = FpnNeck(
            position_encoding=pos_enc_neck,
            d_model=256,
            backbone_channel_list=[1152, 576, 288, 144],
            fpn_top_down_levels=[2, 3],
            fpn_interp_model="nearest"
        )
        
        # 3. Memory Encoder Components
        pos_enc_memory = PositionEmbeddingSine(
            num_pos_feats=64,
            normalize=True,
            scale=None,
            temperature=10000
        )
        
        mask_downsampler = MaskDownSampler(
            kernel_size=3,
            stride=2,
            padding=1
        )
        
        fuser_layer = CXBlock(
            dim=256,
            kernel_size=7,
            padding=3,
            layer_scale_init_value=1e-6,
            use_dwconv=True
        )
        
        fuser = Fuser(
            layer=fuser_layer,
            num_layers=2
        )
        
        memory_encoder = MemoryEncoder(
            out_dim=64,
            position_encoding=pos_enc_memory,
            mask_downsampler=mask_downsampler,
            fuser=fuser
        )

        model = SAM2Base(
            image_encoder=ImageEncoder(
                trunk=Hiera(
                    embed_dim=144,
                    num_heads=2,
                    stages=[2, 6, 36, 4],
                    global_att_blocks=[23, 33, 43],
                    window_pos_embed_bkg_spatial_size=[7, 7],
                    window_spec=[8, 4, 16, 8],
                ),
                neck=neck,
                scalp=1,
            ),
            memory_attention=MemoryAttention(
                d_model=256,
                pos_enc_at_input=True,
                layer=MemoryAttentionLayer(
                    activation="relu",
                    dim_feedforward=2048,
                    dropout=0.1,
                    pos_enc_at_attn=False,
                    self_attention=RoPEAttention(
                        rope_theta=10000.0,
                        feat_sizes=[32, 32],
                        embedding_dim=256,
                        num_heads=1,
                        downsample_rate=1,
                        dropout=0.1,
                    ),
                    d_model=256,
                    pos_enc_at_cross_attn_keys=True,
                    pos_enc_at_cross_attn_queries=False,
                    cross_attention=dict(
                        _target_="sam2.modeling.sam.transformer.RoPEAttention",
                        rope_theta=10000.0,
                        feat_sizes=[32, 32],
                        rope_k_repeat=True,
                        embedding_dim=256,
                        num_heads=1,
                        downsample_rate=1,
                        dropout=0.1,
                        kv_in_dim=64,
                    ),
                ),
                num_layers=4,
            ),
            memory_encoder=memory_encoder,
            # memory_engagement_dim=64, # Removed
        )
        
        # Load Weights manually
        state_dict = torch.load(checkpoint_path, map_location="cpu")
        # Fix for missing "model." prefix if needed (though SAM2 checkpoints usually have "model" key)
        if "model" in state_dict:
            state_dict = state_dict["model"]
            
        model.load_state_dict(state_dict)
        model.to(DEVICE)
        model.eval()

        sam2_predictor = SAM2ImagePredictor(model)
        print(f"✅ Successfully loaded SAM2 (Manual Build): {model_name}")
        return True
    
    except Exception as e:
        print(f"❌ Error loading SAM2 model (Manual): {e}")
        import traceback
        traceback.print_exc()
        return False

def get_yolo():
    return yolo_model

def get_current_model_info():
    """Get information about currently loaded models."""
    return {
        "yolo_model": current_yolo_model_path,
        "device": DEVICE,
        "yolo_loaded": yolo_model is not None,
        "sam2_loaded": sam2_predictor is not None
    }

def get_sam2():
    return sam2_predictor
