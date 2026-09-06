# SPDX-License-Identifier: MPL-2.0
#
# install.ps1 — One-click installer for AgentSkin (Windows).
#
# Downloads the latest GitHub Release NSIS installer and runs it silently,
# creating Start Menu shortcuts.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
#   # or from web:
#   iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/agentskin-desktop/agentskin/main/scripts/install.ps1'))
#
# Parameters:
#   -GithubRepo   GitHub repo (default: agentskin-desktop/agentskin)
#   -InstallDir   Install directory (default: $env:USERPROFILE\.agentskin)
#   -Version      Pin a specific version (e.g. v1.0.0); "latest" for newest
#   -Silent       Run the NSIS installer silently (no user prompts)

param(
    [string]$GithubRepo = 'agentskin-desktop/agentskin',
    [string]$InstallDir = "$env:USERPROFILE\.agentskin",
    [string]$Version = 'latest',
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 0

# ---------------------------------------------------------------------------
# Color output helpers
# ---------------------------------------------------------------------------
function Write-Info    { param($Msg) Write-Host "[INFO]  $Msg" -ForegroundColor Cyan }
function Write-Ok      { param($Msg) Write-Host "[OK]    $Msg" -ForegroundColor Green }
function Write-Warn    { param($Msg) Write-Host "[WARN]  $Msg" -ForegroundColor Yellow }
function Write-Err     { param($Msg) Write-Host "[ERROR] $Msg" -ForegroundColor Red }
function Write-Step    { param($Msg) Write-Host "[STEP]  $Msg" -ForegroundColor White }

# ---------------------------------------------------------------------------
# Platform check: PowerShell >= 5.1
# ---------------------------------------------------------------------------
function Test-PowerShellVersion {
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Write-Err "PowerShell 5.1 or later is required. Current version: $($PSVersionTable.PSVersion)"
        Write-Err "Upgrade PowerShell: https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows"
        exit 1
    }
    if ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -lt 1) {
        Write-Err "PowerShell 5.1 or later is required. Current version: $($PSVersionTable.PSVersion)"
        exit 1
    }
    Write-Ok "PowerShell $($PSVersionTable.PSVersion) detected"
}

# ---------------------------------------------------------------------------
# Dependency check: Node.js >= 22
# ---------------------------------------------------------------------------
function Test-NodeVersion {
    $nodeMinMajor = 22
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue

    if ($nodeCmd) {
        $nodeVersion = & node -v
        $nodeMajor = [int]($nodeVersion -replace 'v(\d+).*','$1')

        if ($nodeMajor -ge $nodeMinMajor) {
            Write-Ok "Node.js $nodeVersion detected (>= $nodeMinMajor)"
            return
        }
        Write-Warn "Node.js $nodeVersion is below the required v$nodeMinMajor"
    } else {
        Write-Warn "Node.js not found in PATH"
    }

    Write-Err "AgentSkin requires Node.js >= $nodeMinMajor"
    Write-Err ""
    Write-Err "Install options:"
    Write-Err "  - Official:  https://nodejs.org/"
    Write-Err "  - winget:    winget install OpenJS.NodeJS.LTS"
    Write-Err "  - choco:     choco install nodejs-lts"
    Write-Err "  - fnm:       fnm install $nodeMinMajor"
    exit 1
}

# ---------------------------------------------------------------------------
# Detect Windows architecture
# ---------------------------------------------------------------------------
function Get-WindowsArch {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        'X64'   { return 'x64' }
        'Arm64' { return 'arm64' }
        default {
            Write-Err "Unsupported Windows architecture: $arch (only x64 is currently built)"
            exit 1
        }
    }
}

# ---------------------------------------------------------------------------
# Fetch latest release version from GitHub API
# ---------------------------------------------------------------------------
function Get-LatestVersion {
    $apiUrl = "https://api.github.com/repos/${GithubRepo}/releases/latest"

    Write-Step "Fetching latest release from ${GithubRepo}..."

    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Method Get -Headers @{
            'Accept' = 'application/vnd.github+json'
            'User-Agent' = 'agentskin-installer'
        } -TimeoutSec 30

        if ($response.tag_name) {
            Write-Ok "Latest release: $($response.tag_name)"
            return $response.tag_name
        }
    } catch {
        # Fallback: try parsing from releases page
    }

    Write-Err "Could not determine latest release version."
    Write-Err "Check that the repository exists: https://github.com/${GithubRepo}/releases"
    exit 1
}

# ---------------------------------------------------------------------------
# Resolve the version to install
# ---------------------------------------------------------------------------
function Resolve-Version {
    if ($Version -eq 'latest') {
        return Get-LatestVersion
    }
    Write-Info "Using pinned version: $Version"
    return $Version
}

# ---------------------------------------------------------------------------
# Download the release asset
# ---------------------------------------------------------------------------
function Save-ReleaseAsset {
    param([string]$InstallVersion)

    $arch = Get-WindowsArch
    $assetName = "AgentSkin-${InstallVersion}-${arch}-Setup.exe"
    $downloadUrl = "https://github.com/${GithubRepo}/releases/download/${InstallVersion}/${assetName}"

    Write-Step "Downloading AgentSkin ${InstallVersion} (${arch})..."
    Write-Info "URL: $downloadUrl"

    $tmpDir = Join-Path $env:TEMP "agentskin-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $tmpFile = Join-Path $tmpDir $assetName

    try {
        # Use System.Net.WebClient for progress reporting
        $webClient = New-Object System.Net.WebClient
        $webClient.Headers.Add('User-Agent', 'agentskin-installer')

        # Register event for download progress
        $lastProgress = 0
        Register-ObjectEvent -InputObject $webClient -EventName DownloadProgressChanged -Action {
            $progress = $EventArgs.ProgressPercentage
            if ($progress - $lastProgress -ge 10 -or $progress -eq 100) {
                Write-Progress -Activity "Downloading AgentSkin" -Status "${progress}%" -PercentComplete $progress
                $script:lastProgress = $progress
            }
        } | Out-Null

        $webClient.DownloadFileAsync($downloadUrl, $tmpFile)
        Write-Progress -Activity "Downloading AgentSkin" -Status "Downloading..." -PercentComplete 0

        # Wait for async download
        while ($webClient.IsBusy) {
            Start-Sleep -Milliseconds 100
        }

        Write-Progress -Activity "Downloading AgentSkin" -Status "Complete" -PercentCompleted 100

        if (-not (Test-Path $tmpFile)) {
            throw "Downloaded file not found"
        }

        $fileSize = (Get-Item $tmpFile).Length
        if ($fileSize -lt 1MB) {
            throw "Downloaded file is too small (${fileSize} bytes) — likely a 404 page"
        }

        $sizeMB = [math]::Round($fileSize / 1MB, 1)
        Write-Ok "Downloaded: $assetName (${sizeMB} MB)"

        return $tmpFile
    }
    catch {
        # Try x64 fallback if arm64 failed
        if ($arch -eq 'arm64') {
            Write-Warn "${arch} installer not found, trying x64..."
            $assetName = "AgentSkin-${InstallVersion}-x64-Setup.exe"
            $downloadUrl = "https://github.com/${GithubRepo}/releases/download/${InstallVersion}/${assetName}"
            $tmpFile = Join-Path $tmpDir $assetName

            try {
                Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpFile -UseBasicParsing -TimeoutSec 300 -Headers @{
                    'User-Agent' = 'agentskin-installer'
                }
                if ((Get-Item $tmpFile).Length -lt 1MB) {
                    throw "Downloaded file too small"
                }
                $sizeMB = [math]::Round((Get-Item $tmpFile).Length / 1MB, 1)
                Write-Ok "Downloaded: $assetName (${sizeMB} MB)"
                return $tmpFile
            } catch {
                throw
            }
        }
        throw
    }
    finally {
        Get-EventSubscriber | Where-Object { $_.SourceObject -is [System.Net.WebClient] } | Unregister-Event -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Run the NSIS installer
# ---------------------------------------------------------------------------
function Install-Release {
    param([string]$InstallerPath)

    Write-Step "Running installer..."

    # The NSIS installer from electron-builder creates Start Menu and Desktop
    # shortcuts by default (createStartMenuShortcut: true, createDesktopShortcut: true).
    # We run it with /S for silent mode if requested.

    $nsisArgs = @()
    if ($Silent) {
        $nsisArgs += '/S'
        $nsisArgs += "/D=$InstallDir"
    }

    Write-Info "Installer: $InstallerPath"
    if ($Silent) {
        Write-Info "Mode: Silent (/S)"
    } else {
        Write-Info "Mode: Interactive (user-guided)"
    }

    $process = Start-Process -FilePath $InstallerPath -ArgumentList $nsisArgs -Wait -PassThru

    if ($process.ExitCode -ne 0) {
        Write-Err "Installer exited with code $($process.ExitCode)"
        exit $process.ExitCode
    }

    Write-Ok "Installation complete"
}

# ---------------------------------------------------------------------------
# Create Start Menu shortcut (backup if NSIS didn't create it)
# ---------------------------------------------------------------------------
function New-StartMenuShortcut {
    $startMenuPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\AgentSkin.lnk'

    # Only create if it doesn't exist (NSIS usually handles this)
    if (Test-Path $startMenuPath) {
        Write-Ok "Start Menu shortcut already exists"
        return
    }

    # Try to find the installed executable
    $searchPaths = @(
        $InstallDir,
        "$env:LOCALAPPDATA\Programs\AgentSkin",
        "$env:PROGRAMFILES\AgentSkin"
    )

    $exePath = $null
    foreach ($p in $searchPaths) {
        $candidate = Join-Path $p 'AgentSkin.exe'
        if (Test-Path $candidate) {
            $exePath = $candidate
            break
        }
    }

    if (-not $exePath) {
        Write-Warn "Could not locate AgentSkin.exe for Start Menu shortcut"
        return
    }

    $ws = New-Object -ComObject WScript.Shell
    $shortcut = $ws.CreateShortcut($startMenuPath)
    $shortcut.TargetPath = $exePath
    $shortcut.WorkingDirectory = Split-Path $exePath
    $shortcut.Description = 'AI Agent Visual Customization Engine'
    $shortcut.Save()

    Write-Ok "Start Menu shortcut created: $startMenuPath"
}

# ---------------------------------------------------------------------------
# Print success banner
# ---------------------------------------------------------------------------
function Write-SuccessBanner {
    param([string]$InstallVersion)

    Write-Host ''
    Write-Host '  ╔══════════════════════════════════════════════════╗' -ForegroundColor Green
    Write-Host '  ║         AgentSkin installed successfully!        ║' -ForegroundColor Green
    Write-Host '  ╚══════════════════════════════════════════════════╝' -ForegroundColor Green
    Write-Host ''
    Write-Info "Version:    $InstallVersion"
    Write-Info "Location:   $InstallDir"
    Write-Host ''
    Write-Info "Launch:     Start Menu -> AgentSkin"
    Write-Host ''
    Write-Info "Uninstall:  Settings -> Apps -> AgentSkin -> Uninstall"
    Write-Host ''
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
function Remove-TempFiles {
    Get-ChildItem $env:TEMP -Filter 'agentskin-install-*' -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.CreationTime -lt (Get-Date).AddHours(-1) } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
function Main {
    Write-Host ''
    Write-Host '  AgentSkin One-Click Installer (Windows)' -ForegroundColor White
    Write-Host '  ───────────────────────────────────────' -ForegroundColor White
    Write-Host ''

    # Pre-flight checks
    Test-PowerShellVersion
    Test-NodeVersion

    # Resolve version
    $installVersion = Resolve-Version

    # Download
    $installerPath = Save-ReleaseAsset -InstallVersion $installVersion

    try {
        # Install
        Install-Release -InstallerPath $installerPath

        # Post-install
        New-StartMenuShortcut

        # Success
        Write-SuccessBanner -InstallVersion $installVersion
    }
    catch {
        Write-Err $_.Exception.Message
        $script:ExitCode = 1
    }
    finally {
        # Clean up temp installer
        if ($installerPath -and (Test-Path (Split-Path $installerPath))) {
            Remove-Item (Split-Path $installerPath) -Recurse -Force -ErrorAction SilentlyContinue
        }
        Remove-TempFiles
    }

    exit $script:ExitCode
}

Main
