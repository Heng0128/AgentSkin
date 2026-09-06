@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AgentSkin Build

echo.
echo  ========================================
echo    AgentSkin Build
echo  ========================================
echo.

REM --- Node.js (system first, NVM fallbacks, version check >= 22) ---
REM Project engines: node >=22 (see package.json). We try the system PATH
REM node first, then every v22.x.* install under the standard NVM_HOME.
REM The previous hard-coded path (%NVM_HOME%\v22.18.0) broke when users had
REM any other 22.x patch level ??? the engine contract is on MAJOR.MINOR, not
REM an exact build. System32 is forced in PATH because stripped environments
REM (e.g. Task Scheduler launches) sometimes omit it, breaking spawn of
REM powershell.exe by electron-builder's node-module-collector.
set "PATH=C:\Windows\System32;C:\Windows\System32\WindowsPowerShell\v1.0;%PATH%"

set "NVM_DIR=%LOCALAPPDATA%\nvm"
set "NODE_FOUND=0"
set "REQ_MAJOR=22"
set "REQ_MINOR=0"

REM (1) Try whatever `node` is already on PATH first (dev machines, CI).
REM Use `node -p` to get clean version without the leading 'v' that breaks parsing.
for /f "tokens=1,2,3 delims=." %%A in ('node -p "process.versions.node" 2^>nul') do (
  set "SYS_MAJOR=%%A"
  set "SYS_MINOR=%%B"
  set "SYS_PATCH=%%C"
)
if defined SYS_MAJOR (
  if !SYS_MAJOR! GEQ !REQ_MAJOR! (
    if !SYS_MAJOR! GTR !REQ_MAJOR! (
      set "NODE_FOUND=1"
    ) else (
      if !SYS_MINOR! GEQ !REQ_MINOR! set "NODE_FOUND=1"
    )
  )
)

REM (2) If PATH node was absent or too old, scan %NVM_DIR%\v22.* for the
REM highest matching install (true SemVer, not string-order). Wildcard enumeration
REM in a FOR /D loop picks up ANY 22.x patch instead of pinning 22.18.0.
if "!NODE_FOUND!"=="0" (
  if exist "!NVM_DIR!" (
    set "BEST_NODE_DIR="
    set "BEST_MINOR=-1"
    set "BEST_PATCH=-1"
    
    for /d %%D in ("!NVM_DIR!\v22.*") do (
      if exist "%%D\node.exe" (
        for /f "tokens=1,2,3 delims=." %%A in ('"%%D\node.exe" -p "process.versions.node" 2^>nul') do (
          set "CAND_MINOR=%%B"
          set "CAND_PATCH=%%C"
          set "UPDATE=0"
          if !CAND_MINOR! GTR !BEST_MINOR! set "UPDATE=1"
          if !CAND_MINOR! EQU !BEST_MINOR! (
            if !CAND_PATCH! GTR !BEST_PATCH! set "UPDATE=1"
          )
          if !UPDATE! EQU 1 (
            set "BEST_MINOR=!CAND_MINOR!"
            set "BEST_PATCH=!CAND_PATCH!"
            set "BEST_NODE_DIR=%%D"
          )
        )
      )
    )
    
    if defined BEST_NODE_DIR (
      echo   [node] found NVM install !BEST_NODE_DIR!
      set "PATH=!BEST_NODE_DIR!;!PATH!"
      set "NODE_FOUND=1"
    )
  )
)
:node_done

REM (3) Final validation ??? after (1) and (2) we MUST have a valid node.
node -v >nul 2>&1 || (
  echo.
  echo   [ERROR] Node.js ^>=v!REQ_MAJOR!.!REQ_MINOR!.x not found.
  echo           Install it from https://nodejs.org or via:
  echo             nvm install !REQ_MAJOR!.!REQ_MINOR! ^&^& nvm use !REQ_MAJOR!.!REQ_MINOR!
  echo.
  pause & exit /b 1
)

REM --- Read version from package.json (fixed, no auto-bump) ---
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VER=%%v"
if "!VER!"=="" (echo   [ERROR] Cannot read version from package.json & pause & exit /b 1)
echo   [1/7] version: !VER!

REM --- China mirrors ---
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
REM Versioned output dir: each build gets a fresh out\make\v{version}\ so
REM stale win-unpacked/ from the previous build never mixes with the new one
REM (Windows Defender locks app.asar during real-time scanning, preventing
REM cleanup of a shared output dir).
REM Note: Ensure your package.json or electron-builder.yml has:
REM   "build": { "directories": { "output": "${ELECTRON_BUILDER_OUT_DIR}" } }
set "ELECTRON_BUILDER_OUT_DIR=out\make\v!VER!"

REM --- Kill running app ---
REM AgentSkin spawns agent apps (TRAE/QoderWork/WorkBuddy/Doubao/Codex/ZCode)
REM via child_process with --remote-debugging-port=0. On Windows a detached
REM spawn still leaves the child's ParentProcessId pointing at AgentSkin
REM (verified), so `taskkill /F /IM AgentSkin.exe /T` — the /T recurses into
REM the process tree — kills every agent AgentSkin launched for theming, even
REM agents the user is actively working in. That is a destructive surprise for
REM the user, so we kill AgentSkin precisely and never recurse into agents:
REM
REM   1. Packaged builds: main process + helpers all carry the AgentSkin.exe
REM      image name (electron-builder renames electron.exe). Kill by PID from
REM      wmic — matches every AgentSkin.exe process (main + renderer/GPU
REM      helpers) but NEVER an agent, whose image name differs.
REM   2. Dev builds: the dev instance runs as electron.exe. Killing by that
REM      generic image name would also kill every other Electron app on the
REM      machine, so we restrict to the electron.exe whose executable lives
REM      under this project's node_modules (CommandLine check via PowerShell).
REM
REM No /T anywhere: /T follows the parent→child tree, which is exactly what
REM kills user agents. Killing the main PID covers its own helpers (they are
REM children) without touching sibling processes.
REM
REM If AgentSkin.exe refuses to die, run this script as Administrator.
for /f "tokens=2 delims==." %%P in ('wmic process where "Name='AgentSkin.exe'" get ProcessId /value ^| findstr /R "^ProcessId="') do taskkill /F /PID %%P >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.ExecutablePath -like '%~dp0node_modules*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

REM --- Step 2: electron-vite build ---
echo   [2/7] electron-vite build ...
call npx electron-vite build
if !errorlevel! neq 0 (echo   FAIL & pause & exit /b 1)

REM --- Step 2.5: 清理当前版本旧残留，避免干扰新构建 ---
echo   [2.5] cleaning old v!VER! artifacts ...
if exist "out\make\v!VER!" rmdir /s /q "out\make\v!VER!" 2>nul

REM --- Step 3: electron-builder pack (NSIS installer) ---
REM electron-builder directly builds the NSIS installer (target: nsis in yml).
REM electron.exe rename may occasionally fail under Defender scanning;
REM detect and retry once.
echo   [3/7] electron-builder pack (NSIS) ...
set "EB_RETRY=0"

:eb_pack_retry
call npx electron-builder --win --x64 --publish never
if !errorlevel! neq 0 (
  REM Retry judgment: installer .exe already generated -> real success
  if exist "out\make\v!VER!\AgentSkin-!VER!-x64-Setup.exe" (
    echo     OK: installer present — treating as success.
  ) else if !EB_RETRY! LSS 1 (
    set /a EB_RETRY+=1
    echo     WARN: electron-builder failed ^(!EB_RETRY!/2^), retrying after cleanup...
    timeout /t 3 /nobreak >nul
    if exist "out\make\v!VER!" rmdir /s /q "out\make\v!VER!" 2>nul
    goto :eb_pack_retry
  ) else (
    echo   FAIL: electron-builder exited with code !errorlevel! after retries & pause & exit /b 1
  )
)

REM --- Step 4: (removed — DuiLib payload generation no longer needed) ---
REM --- Step 5: (removed — DuiLib plugin + NSIS compilation no longer needed) ---

REM --- Step 6: verify ---
echo   [6/7] verify ...
set "INST_EXE=out\make\v!VER!\AgentSkin-!VER!-x64-Setup.exe"
if not exist "!INST_EXE!" (
  echo   [ERROR] Installer not found: !INST_EXE!
  dir /b "out\make\v!VER!\" 2>nul
  pause & exit /b 1
)
REM Verify size >= 10MB (per project constraint: build success = file exists and size >= 10MB)
for %%S in ("!INST_EXE!") do set "INST_SIZE=%%~zS"
if !INST_SIZE! LSS 10485760 (
  echo   [ERROR] Installer too small: !INST_SIZE! bytes ^(expected >= 10MB^)
  pause & exit /b 1
)
set "FOUND=!INST_EXE!"

REM --- Step 7: cleanup (DISABLED: retain all artifacts, do NOT delete) ---
echo   [7/7] cleanup skipped (no files deleted) ...

REM 7a: win-unpacked retained for payload inspection / crash debugging
if exist "out\make\v!VER!\win-unpacked" (
  echo     kept out\make\v!VER!\win-unpacked
)
echo     kept out\make\v!VER!\builder-debug.yml
echo     kept out\make\v!VER!\builder-effective-config.yaml

REM 7b: electron-vite build outputs retained
if exist "out\main" echo     kept out\main
if exist "out\preload" echo     kept out\preload
if exist "out\renderer" echo     kept out\renderer

REM 7c: stale version dirs retained
echo     kept all out\make\v* dirs
echo  ========================================
echo    BUILD OK  v!VER!
echo    installer: !FOUND!
echo    size: !INST_SIZE! bytes
echo  ========================================
echo.

REM --- Step 8: auto-launch the installer (GUI wizard) ---
echo   [8] launching installer ...
start "" "!INST_EXE!"
pause
