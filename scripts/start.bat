@echo off
chcp 65001 >nul 2>&1
cd /d C:\Users\snowb\Desktop\work\desktop-main

echo ============================================
echo   AgentSkin - Build ^& Start
echo ============================================
echo.

echo [1/2] Running npm run build ...
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See above for details.
    pause
    exit /b 1
)
echo.
echo [OK] Build succeeded.
echo.

echo [2/2] Running npm start ...
echo          (Press Ctrl+C to stop)
echo.
call npm start
