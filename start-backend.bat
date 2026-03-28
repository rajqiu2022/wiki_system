@echo off
echo ========================================
echo   Wiki System - Start Backend
echo ========================================

cd /d %~dp0backend

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt -q

echo Starting backend server on http://localhost:8001
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
