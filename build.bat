@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ============================================================================
REM  AgentSkin one-click build script (pure ASCII - avoids cmd.exe UTF-8 bug)
REM
REM  Usage:
REM    build.bat              bump patch (default)
REM    build.bat minor        bump minor
REM    build.bat major        bump major
REM    build.bat --set 3.0.0  set explicit version
REM    build.bat --no-bump    keep current version
REM    build.bat --fast       skip NSIS installer, output unpacked dir only
REM                           (combine: build.bat --no-bump --fast)
REM
REM  Flow:
REM    1. Bump version (strategy from arg1)
REM    2. Kill running AgentSkin + clean out/
REM    3. TypeScript typecheck
REM    4. electron-vite build (main+preload+renderer)
REM    5. electron-builder (NSIS installer, or --dir in fast mode) + verify
REM
REM  Log : logs\build-<timestamp>.log
REM  Out : out\make\v<ver>\AgentSkin-<ver>-x64-Setup.exe
REM ============================================================================

cd /d "%~dp0"
title AgentSkin Build

echo.
echo  ========================================
echo    AgentSkin Build
echo  ========================================
echo.

REM --- sanity check ---
if not exist "package.json" goto :wrongdir
if not exist "scripts\bump-version.mjs" goto :wrongdir

REM --- Node.js: prefer nvm v22 (electron-builder needs Node 16+) ---
REM Avoid nested if-blocks with goto -- cmd.exe misparses them.
if exist "%LOCALAPPDATA%\nvm\v22.18.0\node.exe" set "PATH=%LOCALAPPDATA%\nvm\v22.18.0;%PATH%"
node -v >nul 2>&1
if errorlevel 1 (
  echo   [ERROR] Node.js not found - install via nvm or add to PATH
  goto :fail
)
for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo   Node.js: %NODEVER%

REM --- Full PowerShell path (avoids '-File' not recognized when PATH is odd) ---
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

REM --- log file ---
if not exist logs mkdir logs
for /f "usebackq delims=" %%t in (`node -e "var d=new Date();function p(n){return(n<10?'0':'')+n}console.log(''+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()))"`) do set "STAMP=%%t"
set "LOG=logs\build-%STAMP%.log"
> "%LOG%" echo ==== AgentSkin build %STAMP% ====
echo   Log: %LOG%

REM --- China mirrors for Electron downloads ---
set "MSYS_NO_PATHCONV=1"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_CUSTOM_DIR={{ version }}"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

REM --- parse arguments: --fast can appear in any position ---
set "FAST="
if "%~1"=="--fast" set "FAST=1"
if "%~2"=="--fast" set "FAST=1"
if "%~3"=="--fast" set "FAST=1"
set "BUMP_ARG=%~1"
if "!BUMP_ARG!"=="--fast" set "BUMP_ARG=%~2"
if "!BUMP_ARG!"=="" set "BUMP_ARG=patch"

REM --- record current version so :fail can roll back ---
for /f "usebackq delims=" %%v in (`node -e "console.log(require('./package.json').version)"`) do set "OLDVER=%%v"

REM ============ [1/5] Bump version ============
call :step "Bump version (!BUMP_ARG!)" 1 5 0
set "NEWVER="
if "!BUMP_ARG!"=="--no-bump" (
  for /f "usebackq delims=" %%v in (`node -e "console.log(require('./package.json').version)"`) do set "NEWVER=%%v"
) else if "!BUMP_ARG!"=="--set" (
  for /f "usebackq delims=" %%v in (`node scripts\bump-version.mjs --set "%~2"`) do set "NEWVER=%%v"
) else (
  for /f "usebackq delims=" %%v in (`node scripts\bump-version.mjs !BUMP_ARG!`) do set "NEWVER=%%v"
)
if "!NEWVER!"=="" goto :fail
>>"%LOG%" echo [step1] version -^> !NEWVER! (strategy: !BUMP_ARG!, was: !OLDVER!)
echo   version: !NEWVER!

REM ============ engine is now vendored at src/engine (no probe sync needed) ============

REM ============ [2/5] Kill AgentSkin + clean ============
call :step "Kill AgentSkin + clean" 2 5 5
taskkill /F /IM AgentSkin.exe >>"%LOG%" 2>&1
taskkill /F /IM electron.exe >>"%LOG%" 2>&1
REM Clean electron-vite build output + electron-builder output + legacy forge
REM output. Uses a PowerShell script with retry + long-path fallback because
REM plain `rd /s /q` fails silently when Windows Defender locks app.asar
REM during real-time scanning, leaving stale files that mix with new build
REM output and cause "duplicate products" to accumulate.
"%PS%" -NoProfile -ExecutionPolicy Bypass -File scripts\clean-out.ps1 -LogPath "%LOG%"
echo   done

REM ============ [3/5] TypeScript typecheck ============
call :step "TypeScript typecheck" 3 5 10
node node_modules\typescript\bin\tsc --noEmit >>"%LOG%" 2>&1
if errorlevel 1 (
  echo   [ERROR] typecheck failed - see log
  goto :fail
)
echo   pass

REM ============ [4/5] electron-vite build ============
call :step "electron-vite build" 4 5 15
echo   streaming output (also in log)...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File scripts\run-step.ps1 -LogPath "%LOG%" -Command "npm run build"
if !errorlevel! neq 0 goto :fail

REM ============ [5/5] electron-builder + verify ============
set "OUT_DIR=out\make\v!NEWVER!"
set "ELECTRON_BUILDER_OUT_DIR=!OUT_DIR!"
REM Clean stale win-unpacked from a previous --fast build (same version).
REM Without this, electron-builder hits EBUSY on locked files (icudtl.dat).
if exist "!OUT_DIR!\win-unpacked" (
  echo   cleaning stale win-unpacked ...
  rd /s /q "!OUT_DIR!\win-unpacked" 2>nul
)

if not defined FAST goto :full_mode

REM --- FAST MODE: unpacked dir only, no NSIS / signing / blockmap ---
call :step "electron-builder --dir (fast)" 5 5 60
echo   streaming output (also in log)...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File scripts\run-step.ps1 -LogPath "%LOG%" -Command "npx electron-builder --config electron-builder.yml --config.win.sign=false --win --x64 --dir --publish never"
ping -n 3 127.0.0.1 >nul
set "APP_EXE=!OUT_DIR!\win-unpacked\AgentSkin.exe"
if not exist "!APP_EXE!" (
  echo   [ERROR] AgentSkin.exe not found: !APP_EXE!
  dir "!OUT_DIR!" 2>nul
  goto :fail
)
for %%F in ("!APP_EXE!") do set /a "INST_MB=%%~zF/1048576"
>>"%LOG%" echo [step5] OK fast: app=!APP_EXE!
call :step "BUILD OK (fast)" 5 5 100
echo.
echo  ========================================
echo    BUILD OK ^(fast -- no installer^)
echo    version : !NEWVER!
echo    app     : %CD%\!APP_EXE!
echo    log     : %CD%\%LOG%
echo  ========================================
echo.
pause
exit /b 0

:full_mode
REM --- FULL MODE: NSIS installer ---
call :step "electron-builder NSIS installer" 5 5 60
echo   streaming output (also in log)...
REM Step 4 already ran `electron-vite build`, so here we call electron-builder
REM directly instead of `npm run package` (which re-runs electron-vite build).
REM ELECTRON_BUILDER_OUT_DIR gives each build a fresh versioned output dir
REM (out/make/v{version}/) so we never need to clean stale win-unpacked/ --
REM that cleanup fails when Defender locks app.asar, causing old+new mix.
REM --- [5a] Generate NSIS skin assets (BMPs + brand.nsh) and verify ---
echo   generating NSIS skin assets (icons:nsis) + verify ...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File scripts\run-step.ps1 -LogPath "%LOG%" -Command "npm run icons:nsis"
if !errorlevel! neq 0 goto :fail
node scripts/verify-nsis-assets.mjs
if !errorlevel! neq 0 goto :fail

"%PS%" -NoProfile -ExecutionPolicy Bypass -File scripts\run-step.ps1 -LogPath "%LOG%" -Command "npx electron-builder --config electron-builder.yml --win --x64 --publish never"
REM NOTE: Do NOT fail on errorlevel alone. TRAE Sandbox sometimes blocks
REM Windows Recent-file access AFTER electron-builder has finished, returning
REM exit code 1 even though the installer was built successfully. We verify
REM by checking the installer file itself (size > 50MB) instead.

REM --- verify by output file, not exit code ---
REM Wait for NTFS/Defender to release the file, then check with one retry.
ping -n 4 127.0.0.1 >nul
set "INSTALLER_EXE=!OUT_DIR!\AgentSkin-!NEWVER!-x64-Setup.exe"
if not exist "!INSTALLER_EXE!" (
  echo   [retry] installer not visible yet, waiting 3s...
  ping -n 4 127.0.0.1 >nul
)
if not exist "!INSTALLER_EXE!" (
  echo   [ERROR] NSIS installer not found: !INSTALLER_EXE!
  echo   [diag] output directory listing:
  dir "!OUT_DIR!" 2>nul
  goto :fail
)
for %%F in ("!INSTALLER_EXE!") do set /a "INST_MB=%%~zF/1048576"
if !INST_MB! LSS 50 (
  echo   [ERROR] Installer too small (!INST_MB! MB ^< 50 MB) -- build likely incomplete
  goto :fail
)
>>"%LOG%" echo [step5] OK: installer=!INSTALLER_EXE! (!INST_MB! MB)
call :step "BUILD OK" 5 5 100

echo.
echo  ========================================
echo    BUILD OK
echo    version  : !NEWVER!
echo    installer: %CD%\!INSTALLER_EXE!
echo    size     : !INST_MB! MB
echo    log      : %CD%\%LOG%
echo  ========================================
echo.
pause
exit /b 0

:wrongdir
echo.
echo   [ERROR] Run from AgentSkin project root
echo           (folder with package.json and scripts\)
echo.
pause
exit /b 1

:fail
echo.
echo  ========================================
echo    BUILD FAILED
echo  ========================================
echo   log: %LOG%
echo   last 25 lines:
echo   ----------------------------------------
if exist "%LOG%" "%PS%" -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 25"
echo   ----------------------------------------
REM Roll back version bump so failed builds don't accumulate version numbers.
REM Only rolls back when OLDVER is captured AND a bump actually happened
REM (NEWVER differs from OLDVER and BUMP_ARG is not --no-bump).
REM Skip rollback if the installer was actually built (false-negative guard).
set "SKIP_ROLLBACK="
if defined NEWVER if defined OUT_DIR (
  if exist "!OUT_DIR!\AgentSkin-!NEWVER!-x64-Setup.exe" set "SKIP_ROLLBACK=1"
)
if defined SKIP_ROLLBACK (
  echo   [NOTE] Installer exists -- skipping version rollback
) else (
  if defined OLDVER if defined NEWVER if not "!BUMP_ARG!"=="--no-bump" if not "!NEWVER!"=="!OLDVER!" (
    node scripts\bump-version.mjs --set "!OLDVER!" >nul 2>&1
    echo   [ROLLBACK] version reverted !NEWVER! -^> !OLDVER!
  )
)
echo.
pause
exit /b 1

REM ============================================================================
REM  subroutines
REM ============================================================================

REM --- progress header: %~1 label  %~2 step  %~3 total  %~4 pct ---
:step
set /a "FILL=%~4*30/100"
set "BAR="
for /l %%i in (1,1,30) do (
  if %%i leq !FILL! (set "BAR=!BAR!#") else (set "BAR=!BAR!-")
)
echo.
echo   [!BAR!] %~4%%  [%~2/%~3] %~1
title AgentSkin Build - %~4%% - %~1
exit /b 0
