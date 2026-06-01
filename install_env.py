import sys
import subprocess
import os

def check_git():
    """Check if git is installed."""
    try:
        subprocess.check_call(["git", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def run_pip(args, allow_error=False):
    """Run pip install command using the current python interpreter."""
    cmd = [sys.executable, "-m", "pip", "install"] + args
    print(f"Executing: {' '.join(cmd)}")
    try:
        subprocess.check_call(cmd)
        return True
    except subprocess.CalledProcessError:
        if allow_error:
            return False
        raise

def check_system_has_gpu():
    """Check if the system has an NVIDIA GPU using nvidia-smi."""
    try:
        subprocess.check_call("nvidia-smi", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def check_current_torch_status(expect_gpu):
    """
    Check if torch is installed and if it matches the expected hardware accelerator.
    Returns: 'ok', 'missing', or 'mismatch'
    """
    try:
        import torch
        print(f"✅ Found installed PyTorch version: {torch.__version__}")
        
        cuda_available = torch.cuda.is_available()
        if expect_gpu and not cuda_available:
            print("⚠️  System has GPU but installed PyTorch is CPU-only.")
            return "mismatch"
        
        if not expect_gpu and cuda_available:
            print("ℹ️  System has no GPU but installed PyTorch has CUDA support (safe but large).")
            return "ok"
            
        return "ok"
    except ImportError:
        return "missing"

def check_sam2_installed():
    """Check if sam2 library is installed and importable."""
    try:
        # Try importing specific SAM2 modules to ensure full installation
        import sam2
        # Also try importing a submodule to be sure
        from sam2.build_sam import build_sam2
        print("✅ SAM2 library found and importable.")
        return True
    except ImportError as e:
        print(f"⚠️  SAM2 library missing or incomplete: {e}")
        return False
    except Exception as e:
        print(f"⚠️  Error checking SAM2: {e}")
        return False

def main():
    print("---------------------------------------------------")
    print("       YOLO-SAM2 Environment Setup (Smart Installer)")
    print("---------------------------------------------------")
    
    # Check Python version
    print(f"Running on Python: {sys.version.split()[0]}")
    if sys.prefix == sys.base_prefix:
        print("⚠️  WARNING: Not running in a virtual environment. Installing packages globally!")

    # 1. Detect Hardware
    has_gpu = check_system_has_gpu()
    if has_gpu:
        print("🚀 GPU Detected (NVIDIA). Target: CUDA enabled PyTorch.")
    else:
        print("💻 No NVIDIA GPU detected. Target: CPU-only PyTorch.")

    # 2. Check/Install PyTorch
    api_status = check_current_torch_status(has_gpu)
    
    if api_status in ["missing", "mismatch"]:
        if api_status == "mismatch":
            print("🔄 Uninstalling incompatible PyTorch versions...")
            subprocess.check_call([sys.executable, "-m", "pip", "uninstall", "-y", "torch", "torchvision", "torchaudio"])
        
        if has_gpu:
            print("📦 Installing PyTorch with CUDA 12.1...")
            # Using stable index for CUDA 12.1
            run_pip(["torch", "torchvision", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu121"])
        else:
            print("📦 Installing PyTorch (CPU)...")
            run_pip(["torch", "torchvision", "torchaudio"])
    else:
        print("✅ PyTorch is correctly configured.")

    # 3. Ensure critical build tools
    print("📦 ensuring setuptools & wheel...")
    run_pip(["setuptools", "wheel"], allow_error=True)

    # 4. Check/Install SAM2
    if not check_sam2_installed():
        if not check_git():
            print("❌ CRITICAL ERROR: Git is not installed or not in PATH.")
            print("   The SAM2 library requires Git to be installed.")
            print("   Please install Git from https://git-scm.com/downloads and restart.")
            sys.exit(1)
            
        print("📦 Installing SAM2 from GitHub...")
        print("   (This may take a few minutes as it clones the repository)")
        try:
            # Install hydra-core explicitly first as it sometimes helps
            run_pip(["hydra-core>=1.3.2", "iopath>=0.1.10"])
            
            # Install SAM2
            # We use --no-build-isolation to use the installed PyTorch
            run_pip(["git+https://github.com/facebookresearch/sam2.git"])
            
            if check_sam2_installed():
                print("✅ SAM2 successfully installed.")
            else:
                print("❌ SAM2 installation appeared to succeed but import failed.")
                sys.exit(1)
        except subprocess.CalledProcessError:
            print("❌ Failed to install SAM2.")
            print("   Common causes on Windows:")
            print("   1. Missing C++ Build Tools (Install Visual Studio Build Tools with C++ workload)")
            print("   2. Network issues cloning GitHub repo")
            sys.exit(1)

    # 5. Install other requirements
    print("📦 Installing/Verifying backend dependencies...")
    requirements_path = os.path.join("backend", "requirements.txt")
    if os.path.exists(requirements_path):
        run_pip(["-r", requirements_path])
    else:
        print(f"⚠️  Warning: {requirements_path} not found.")

    print("\n✅ Environment setup complete.")

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(f"❌ Installation process failed with error code {e.returncode}.")
        sys.exit(e.returncode)
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
