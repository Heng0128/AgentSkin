# SPDX-License-Identifier: MPL-2.0
# Builds AgentSkinUI.dll (the NSIS plugin that hosts the DuiLib UI).
#
# Usage:
#   pwsh ./Build-Plugin.ps1 -PluginOnly     # just the DLL
#   pwsh ./Build-Plugin.ps1                 # DLL + makensis packaging
#
# Prerequisites (already on this machine):
#   - MSVC v142 (VS 2019 BuildTools) - located via vswhere
#   - cmake (scoop)
#   - makensis (NSIS 3.12, installed to Program Files)
param(
  [switch]$PluginOnly
)

$ErrorActionPreference = 'Stop'

$RepoRoot      = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$PluginDir     = Join-Path $RepoRoot 'installer\windows\plugin'
$BuildDir      = Join-Path $RepoRoot 'installer\windows\plugin\build'
$NsisDir       = Join-Path $RepoRoot 'installer\windows\nsis'
$OutDir        = Join-Path $RepoRoot 'installer\windows\build'

# ---- Locate MSVC v142 via vswhere -----------------------------------------
$vsWherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vsWherePath)) {
  throw "vswhere.exe not found at $vsWherePath"
}
$vsInstallPath = & $vsWherePath -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsInstallPath) {
  throw "MSVC v142 (VS 2019) not found via vswhere"
}
Write-Host "Using MSVC from: $vsInstallPath"

# ---- Import VC environment ------------------------------------------------
$vcvarsBat = Join-Path $vsInstallPath 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvarsBat)) {
  throw "vcvars64.bat not found in $vsInstallPath"
}
$tempFile = [System.IO.Path]::GetTempFileName()
cmd /c "`"$vcvarsBat`" && set > `"$tempFile`""
Get-Content $tempFile | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
  }
}
Remove-Item $tempFile -Force

# ---- Clean previous build -------------------------------------------------
# Use a unique build subdirectory per run to avoid Windows Defender locking
# the previous build/ while real-time scanning catches up.
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$RunBuildDir = Join-Path $BuildDir $timestamp
if (-not (Test-Path $RunBuildDir)) {
  New-Item -ItemType Directory -Path $RunBuildDir -Force | Out-Null
}
if (Test-Path $OutDir) {
  Remove-Item $OutDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

# ---- Configure (cmake) ----------------------------------------------------
Write-Host ""
Write-Host "==> Configuring (cmake)..."
Write-Host "    Source: $PluginDir"
Write-Host "    Build:  $RunBuildDir"
Push-Location $PluginDir
try {
  cmake -S . -B $RunBuildDir -G "Visual Studio 16 2019" -A Win32
  if ($LASTEXITCODE -ne 0) { throw "cmake configure failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

# ---- Build (cmake) --------------------------------------------------------
Write-Host ""
Write-Host "==> Building (MinSizeRel)..."
Push-Location $PluginDir
try {
  cmake --build $RunBuildDir --config MinSizeRel
  if ($LASTEXITCODE -ne 0) { throw "cmake build failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

# ---- Copy DLL + skin to bin/ ---------------------------------------------
$builtDll = Join-Path $RunBuildDir 'MinSizeRel\AgentSkinUI.dll'
if (-not (Test-Path $builtDll)) {
  throw "AgentSkinUI.dll not found at $builtDll"
}
$binDir = Join-Path $PluginDir 'bin'
if (-not (Test-Path $binDir)) {
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}
Copy-Item $builtDll $binDir -Force
Write-Host ""
Write-Host "==> Copied AgentSkinUI.dll -> $binDir"

# Also copy the skin directory next to the DLL (for NSIS extraction)
$skinSrc = Join-Path $RunBuildDir 'MinSizeRel\skin'
$skinDst = Join-Path $binDir 'skin'
if (Test-Path $skinSrc) {
  if (Test-Path $skinDst) { Remove-Item $skinDst -Recurse -Force -ErrorAction SilentlyContinue }
  Copy-Item $skinSrc $skinDst -Recurse
  Write-Host "==> Copied skin/ -> $skinDst"
}

if ($PluginOnly) {
  Write-Host ""
  Write-Host "==> PluginOnly mode: skipping makensis"
  Write-Host "==> DONE"
  exit 0
}

# ---- Build NSIS installer -------------------------------------------------
$version = if ($env:VERSION) { $env:VERSION } else { "0.0.0-dev" }
$unpacked = if ($env:UNPACKED) { $env:UNPACKED } else { "..\..\..\out\make\dist\win-unpacked" }

# Resolve UNPACKED: if it's an existing absolute path, use as-is;
# otherwise resolve relative to the NSIS directory (makensis runs
# from there), then repo root.
if (Test-Path $unpacked -PathType Container) {
  $nsisUnpacked = $unpacked
} else {
  $nsisUnpacked = Join-Path $NsisDir $unpacked
  if (-not (Test-Path $nsisUnpacked)) {
    # Try relative to repo root as fallback
    $nsisUnpacked = Join-Path $RepoRoot $unpacked
    if (-not (Test-Path $nsisUnpacked)) {
      throw "win-unpacked directory not found: $unpacked (tried $nsisUnpacked)"
    }
  }
}

$makensis = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'
if (-not (Test-Path $makensis)) {
  $makensis = Join-Path $env:ProgramFiles 'NSIS\makensis.exe'
  if (-not (Test-Path $makensis)) {
    throw "makensis.exe not found in Program Files\NSIS"
  }
}

Write-Host ""
Write-Host "==> Compiling NSIS installer..."
Write-Host "    VERSION  = $version"
Write-Host "    UNPACKED = $nsisUnpacked"
Push-Location $NsisDir
try {
  & $makensis "/DVERSION=$version" "/DUNPACKED=$nsisUnpacked" "AgentSkin.nsi"
  if ($LASTEXITCODE -ne 0) { throw "makensis failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

$setupExe = Join-Path $OutDir "AgentSkin-$version-x86-Setup.exe"
if (-not (Test-Path $setupExe)) {
  throw "Setup executable not produced: $setupExe"
}
$setupSize = (Get-Item $setupExe).Length
Write-Host ""
Write-Host "==> DONE"
Write-Host "    $setupExe ($setupSize bytes)"
