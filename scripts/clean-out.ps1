# SPDX-License-Identifier: MPL-2.0
#
# clean-out.ps1 — Robustly clean electron-vite + electron-builder output dirs.
#
# Windows Defender real-time scanning locks large files (app.asar ~100MB,
# AgentSkin.exe ~200MB) for several seconds after they are written. The plain
# `rd /s /q` used by build.bat fails silently when Defender holds these
# handles, leaving stale files behind. electron-builder then writes new files
# on top of the old ones, causing "duplicate products" to accumulate.
#
# This script retries deletion with backoff and falls back to the Win32
# long-path API (\\?\ prefix) which bypasses MAX_PATH and can delete files
# that PowerShell's Remove-Item cannot.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\clean-out.ps1 [-LogPath logs\build-xxx.log]

param(
    [string]$LogPath
)

$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot

# Static targets — always cleaned (electron-vite output + legacy dirs)
$staticTargets = @(
    'out\main',
    'out\preload',
    'out\renderer',
    'out\AgentSkin-win32-x64'
)

# Versioned output dirs (out\make\v*) — keep only the latest, remove the rest.
# The latest is kept so a re-run of build.bat with the same version can reuse
# the dir (electron-builder overwrites cleanly within the same version).
$makeDir = Join-Path $projectRoot 'out\make'
$versionedTargets = @()
if (Test-Path -LiteralPath $makeDir) {
    $versionDirs = Get-ChildItem $makeDir -Directory -Filter 'v*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    if ($versionDirs.Count -gt 1) {
        # Keep the first (latest), clean the rest
        $versionedTargets = $versionDirs | Select-Object -Skip 1 | ForEach-Object { $_.FullName }
    }
}

# Also clean non-versioned stale dirs under out\make (dist, electron-builder)
$staleMakeTargets = @()
if (Test-Path -LiteralPath $makeDir) {
    $staleMakeTargets = Get-ChildItem $makeDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike 'v*' } |
        ForEach-Object { $_.FullName }
}

$targets = @()
$targets += $staticTargets | ForEach-Object { Join-Path $projectRoot $_ }
$targets += $versionedTargets
$targets += $staleMakeTargets

function Write-Log {
    param([string]$Msg)
    if ($LogPath) {
        $full = [System.IO.Path]::GetFullPath($LogPath)
        Add-Content -LiteralPath $full -Value $Msg -ErrorAction SilentlyContinue
    }
    Write-Host $Msg
}

# Force-delete a directory tree using the Win32 long-path API.
# Returns $true on success, $false on failure.
function Remove-DirForce {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    $full = (Resolve-Path -LiteralPath $Path).Path
    $long = "\\?\$full"
    try {
        [System.IO.Directory]::Delete($long, $true)
        return $true
    } catch {
        return $false
    }
}

$maxAttempts = 6
$delaySec = 2

foreach ($rel in $targets) {
    $abs = Join-Path $projectRoot $rel
    if (-not (Test-Path -LiteralPath $abs)) {
        Write-Log "  [skip] $rel (not exists)"
        continue
    }

    $deleted = $false
    for ($i = 1; $i -le $maxAttempts; $i++) {
        # Try normal Remove-Item first
        try {
            Remove-Item -LiteralPath $abs -Recurse -Force -ErrorAction Stop
            $deleted = $true
            break
        } catch {
            # Fallback to long-path API
            if (Remove-DirForce -Path $abs) {
                $deleted = $true
                break
            }
        }

        if ($i -lt $maxAttempts) {
            Write-Log "  [retry $i/$maxAttempts] $rel locked, waiting ${delaySec}s..."
            Start-Sleep -Seconds $delaySec
        }
    }

    if ($deleted) {
        Write-Log "  [ok] $rel removed"
    } else {
        # Final fallback: rename to a trash dir so the build can proceed into
        # a clean path. The renamed dir will be cleaned up on the next run
        # (or manually after Defender releases the handle).
        $stamp = Get-Date -Format 'HHmmss'
        $trash = "$abs._trash_$stamp"
        try {
            Rename-Item -LiteralPath $abs -NewName $trash -ErrorAction Stop
            Write-Log "  [quarantine] $rel -> $(Split-Path -Leaf $trash) (Defender holds handle; will be removed later)"
        } catch {
            Write-Log "  [WARN] $rel could not be removed or quarantined — build may mix old+new files"
        }
    }
}

Write-Log "  [done] clean complete"
exit 0
