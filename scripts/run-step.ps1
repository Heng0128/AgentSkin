# SPDX-License-Identifier: MPL-2.0
#
# run-step.ps1 — Execute a command, streaming its output to both the
# console and a log file. Returns the command's exit code.
#
# Used by build.bat for steps that produce large amounts of output
# (electron-forge package, electron-builder NSIS) so the user sees
# progress in real time while everything is captured to the build log.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-step.ps1 `
#     -LogPath "logs\build-xxx.log" `
#     -Command "npm run package"

param(
    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [Parameter(Mandatory = $true)]
    [string]$Command
)

# Resolve the log path to an absolute path so cmd /c inherits the correct
# working directory without relying on PowerShell's CWD.
$fullLogPath = [System.IO.Path]::GetFullPath($LogPath)

# StreamWriter in append mode with UTF-8 encoding (no BOM). Using a single
# open writer avoids the per-line overhead of Add-Content / Out-File.
$writer = New-Object System.IO.StreamWriter($fullLogPath, $true, (New-Object System.Text.UTF8Encoding $false))
try {
    # Execute via cmd /c so npm scripts and PATH-based tools resolve the
    # same way they would in a plain batch context. 2>&1 merges stderr
    # into stdout so both streams are logged.
    cmd /c $Command 2>&1 | ForEach-Object {
        Write-Host $_
        $writer.WriteLine($_)
    }
    $exitCode = $LASTEXITCODE
} finally {
    $writer.Flush()
    $writer.Close()
}

exit $exitCode
