# YOLO-SAM2 Annotator

An AI-assisted image annotation tool combining **YOLOv8** (for object detection) and **SAM2** (Segment Anything Model 2) for precise segmentation. Built with **FastAPI** (Backend) and **React** (Frontend).

## Prerequisites

Before running on a new machine, ensure you have:

1.  **Python 3.10+**
2.  **Node.js 18+** & **npm**
3.  *(Optional)* NVIDIA GPU with CUDA drivers (for faster inference).

---

## 🚀 Installation Guide

### 1. Backend Setup (Termina 1)

Navigate to the root directory and install Python dependencies.

```bash
# Navigate to project root
cd SAM2_det_to_seg

# (Optional) Create a virtual environment
python -m venv venv
# Windows
.\venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
```

> **Note on SAM2:** If you encounter issues installing `sam2` or `hydra-core`, the project contains a manual bypass to load the model without these strict dependencies. Ensure you have `torch`, `torchvision`, and `ultralytics` installed.

### 2. Frontend Setup (Terminal 2)

Navigate to the frontend directory and install Node modules.

```bash
cd frontend
npm install
```

---

## ▶️ Running the Application

You need two terminal windows running simultaneously.

### Terminal 1: Start Backend

```bash
# From project root
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend
```
*Wait until you see "Application startup complete".*

### Terminal 2: Start Frontend

```bash
# From frontend/ directory
npm run dev
```

Open your browser and visit: **http://localhost:5173**

---

## 📂 Project Structure

*   `backend/`: FastAPI server, model logic (`core.py`), and API endpoints (`api.py`).
*   `frontend/`: React application.
*   `data/`: Stores uploaded images and generated labels.
*   `debug_*.py`: Helper scripts for debugging model initialization.

## 🛠️ Troubleshooting

*   **SAM2 Not Loading?**
    *   The project uses a manual loading mechanism in `core.py` to bypass config issues. Ensure `sam2_hiera_large.pt` is present in `backend/app/`.
*   **"Missing neck" Error?**
    *   This has been patched in `core.py`. Ensure you are using the latest version of the code.

## 📦 Portability

To transfer this project:
1.  **Delete** `frontend/node_modules` (it's huge and can be re-installed).
2.  **Delete** `backend/__pycache__`.
3.  **Zip** the remaining files.
4.  On the new machine, follow the **Installation Guide** above.
