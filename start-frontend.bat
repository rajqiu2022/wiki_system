@echo off
echo ========================================
echo   Wiki System - Start Frontend
echo ========================================

cd /d %~dp0frontend

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo Starting frontend on http://localhost:3001
npm run dev
