@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AgentSkin Dev Workspace

REM === Node.js Path Setup ===
set "PATH=C:\Windows\System32;C:\Windows\System32\WindowsPowerShell\v1.0;%PATH%"

node -v >nul 2>&1
if errorlevel 1 (
  if exist "%PROGRAMFILES%\nodejs\node.exe" (
    set "PATH=%PROGRAMFILES%\nodejs;%PATH%"
  ) else if exist "%PROGRAMFILES(x86)%\nodejs\node.exe" (
    set "PATH=%PROGRAMFILES(x86)\nodejs;%PATH%"
  ) else (
    echo [ERROR] Node.js not found.
    pause & exit /b 1
  )
)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VER=%%v"

set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

REM electron-builder.yml 中 directories.output 引用此环境变量。
REM 未设置时输出目录回退到默认位置，导致版本化路径 out\make\v%VER%\ 与
REM 验证/启动路径不匹配，总是安装旧版本。
set "ELECTRON_BUILDER_OUT_DIR=out\make\v%VER%"

:MENU
cls
echo.
echo   ========================================
echo     AgentSkin Dev Workspace v%VER%
echo   ========================================
echo.
echo     [1] Dev Mode       Start dev server
echo     [2] Build          Clean + Build + Package
echo     [3] Rebuild Dev    Clean + Restart dev
echo     [4] Clean Only     Remove build artifacts
echo     [0] Exit
echo.
echo   Node: 
node -v
echo   Path: %CD%
echo.

set "CHOICE="
set /p "CHOICE=  Select [0-4]: "

if "%CHOICE%"=="1" goto :dev
if "%CHOICE%"=="2" goto :build
if "%CHOICE%"=="3" goto :rebuild_dev
if "%CHOICE%"=="4" goto :clean
if "%CHOICE%"=="0" exit /b 0

echo [WARN] Invalid choice.
timeout /t 2 /nobreak >nul
goto :MENU

:dev
call :kill_running
echo.
echo   --- Starting Dev Mode ---

echo   Cleaning stale artifacts ...
if exist "out" rmdir /s /q "out" 2>nul
if exist "dist" rmdir /s /q "dist" 2>nul
if exist ".vite" rmdir /s /q ".vite" 2>nul
if exist "node_modules\.vite" rmdir /s /q "node_modules\.vite" 2>nul
del /f /q ".tsbuildinfo" 2>nul
echo   Done.

echo.
echo   Running pre-dev typecheck...
call npx tsc --noEmit
if errorlevel 1 (
  echo.
  echo   [WARN] TypeCheck failed. Cleaning and retrying...
  if exist "out" rmdir /s /q "out" 2>nul
  if exist ".vite" rmdir /s /q ".vite" 2>nul
  if exist "node_modules\.vite" rmdir /s /q "node_modules\.vite" 2>nul
  del /f /q ".tsbuildinfo" 2>nul
  call npx tsc --noEmit
  if errorlevel 1 (
    echo   [ERROR] TypeCheck still failing.
    goto :pause_end
  )
)
echo   TypeCheck OK.

echo.
echo   Dev server: http://localhost:5173/
echo   Press Ctrl+C to stop
echo.
call npx electron-vite dev
echo.
echo   [dev stopped]
goto :pause_end

:build
call :kill_running
cls
echo.
echo   ========================================
echo     AgentSkin Build v%VER%
echo   ========================================
echo.

echo   [1/5] Cleaning...
call :do_clean
echo          Done.

echo   [2/5] electron-vite build...
call npx electron-vite build
if errorlevel 1 (echo   [FAIL] ^& goto :pause_end)
echo          Done.

echo   [3/5] Cleaning old v%VER%...
if exist "out\make\v%VER%" rmdir /s /q "out\make\v%VER%" 2>nul
echo          Done.

echo   [4/5] Packaging...
set "EB_RETRY=0"
:eb_retry
call npx electron-builder --win --x64 --publish never >nul 2>&1
if errorlevel 1 (
  if exist "out\make\v%VER%\AgentSkin-%VER%-x64-Setup.exe" (
    echo     [OK]
  ) else if !EB_RETRY! LSS 1 (
    set /a EB_RETRY+=1
    echo     [retry...
    timeout /t 3 /nobreak >nul
    if exist "out\make\v%VER%" rmdir /s /q "out\make\v%VER%" 2>nul
    goto :eb_retry
  ) else (
    echo   [FAIL] ^& goto :pause_end
  )
) else (
  echo          Done.
)

echo   [5/5] Verifying...
set "INST_EXE=out\make\v%VER%\AgentSkin-%VER%-x64-Setup.exe"
if not exist "%INST_EXE%" (echo   [ERROR] Not found ^& goto :pause_end)
for %%S in ("%INST_EXE%") do (set /A "SIZE_MB=%%~zS/1048576")
echo          Size: !SIZE_MB! MB

echo.
echo   ========================================
echo     BUILD OK v%VER%
echo   ========================================
echo.

set "LAUNCH="
set /p "LAUNCH=  Launch installer? [y/N]: "
if /i "%LAUNCH%"=="y" (start "" "%INST_EXE%")
goto :pause_end

:rebuild_dev
call :kill_running
echo.
echo   -- Rebuild Dev ---
echo   Cleaning...
if exist "out" rmdir /s /q "out" 2>nul
if exist "dist" rmdir /s /q "dist" 2>nul
if exist ".vite" rmdir /s /q ".vite" 2>nul
del /f /q ".tsbuildinfo" 2>nul
echo   Done.

echo   TypeCheck...
call npx tsc --noEmit
if errorlevel 1 (echo   [FAIL] ^& goto :pause_end)
echo   OK.

echo   Starting dev...
call npx electron-vite dev
goto :pause_end

:clean
call :do_clean
echo   Cleaned.
goto :pause_end

:do_clean
if exist "out" rmdir /s /q "out" 2>nul
if exist "dist" rmdir /s /q "dist" 2>nul
if exist ".vite" rmdir /s /q ".vite" 2>nul
del /f /q ".tsbuildinfo" 2>nul
for /d %%D in (out_make_trash_*) do rmdir /s /q "%%D" 2>nul
for /d %%D in (tmp-check*) do rmdir /s /q "%%D" 2>nul
if exist "extracted-icons" rmdir /s /q "extracted-icons" 2>nul
if exist ".build-tmp" rmdir /s /q ".build-tmp" 2>nul
exit /b 0

:kill_running
echo   Stopping processes...
REM Kill packaged app (AgentSkin.exe) + all child helpers (not /T — protects user agents)
for /f "tokens=2 delims==." %%P in ('wmic process where "Name='AgentSkin.exe'" get ProcessId /value ^| findstr /R "^ProcessId="') do taskkill /F /PID %%P >nul 2>&1
REM Kill dev electron processes from this project (match executable path under project node_modules)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.ExecutablePath -like '%~dp0node_modules*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
REM Kill orphaned vite/electron-vite node processes from this project.
REM BUG FIX: previous filter checked ExecutablePath (i.e. node.exe path, which is in
REM e.g. Program Files\nodejs\ — never matched 'desktop-main'). Use CommandLine instead,
REM which contains the full argv with electron-vite/dev paths for project-local servers.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '%~dp0*' -and ($_.CommandLine -like '*electron-vite*' -or $_.CommandLine -like '*node_modules*vite*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
REM Wait for handles to be released (Defender can delay file deletion)
timeout /t 1 /nobreak >nul
exit /b 0

:pause_end
echo.
pause
goto :MENU
