@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion

echo ===================================================
echo     YOLO-SAM2 Annotator - Advanced Setup
echo ===================================================
echo.

:: 1. Check/Create Virtual Environment
if not exist "venv" (
    echo [SETUP] Creating Python Virtual Environment...
    echo [INFO] Using 'py -3.11' command. Ensure Python 3.11 is installed.
    py -3.11 -m venv venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create venv. Check Python installation.
        pause
        exit /b 1
    )
    echo [SUCCESS] venv created.
) else (
    echo [SETUP] Virtual environment 'venv' already exists.
)

:: 2. Install Dependencies (GPU/CPU Aware)
echo [SETUP] Activating environment and checking hardware...
call venv\Scripts\activate.bat

echo.
echo [SETUP] Running install_env.py...
python install_env.py
if %errorlevel% neq 0 (
    echo [ERROR] Installation failed. Check console output.
    pause
    exit /b 1
)

:: 3. Check Weights
echo.
echo [SETUP] Verifying model weights...
python check_weights.py
if %errorlevel% neq 0 (
    echo [ERROR] Weights check failed. Please resolve missing files.
    pause
    exit /b 1
)

:: 4. Launch Servers
echo.
echo ===================================================
echo     Launching Services...
echo     1. Backend will open in a NEW window.
echo     2. Frontend will run in THIS window.
echo ===================================================
echo.

echo [LAUNCH] Starting Backend Server (Port 8000)...
start "Backend Server" cmd /k "call venv\Scripts\activate.bat && cd backend && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

echo [LAUNCH] Starting Frontend Server (Port 5173)...
cd frontend

if not exist "node_modules" (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
)

echo [INFO] Running 'npm run dev'...
call npm run dev
