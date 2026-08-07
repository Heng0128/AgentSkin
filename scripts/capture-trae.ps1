Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class NativeWin {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$matchTitles = @("TraeWork", "TRAE", "trae")
foreach ($p in Get-Process) {
    try {
        $title = $p.MainWindowTitle
        if ($title -eq "" -or $title -eq $null) { continue }
        $matched = $false
        foreach ($m in $matchTitles) {
            if ($title.Contains($m)) { $matched = $true; break }
        }
        if (-not $matched) { continue }

        $hwnd = $p.MainWindowHandle
        $rc = New-Object NativeWin+RECT
        [NativeWin]::GetWindowRect($hwnd, [ref]$rc) | Out-Null
        $w = $rc.Right - $rc.Left
        $h = $rc.Bottom - $rc.Top
        if ($w -le 0 -or $h -le 0) { Write-Output "SKIP ${p.Id} ${w}x${h}"; continue }
        try { [NativeWin]::SetForegroundWindow($hwnd) | Out-Null } catch {}
        Sleep -Milliseconds 300

        $bitmap = New-Object System.Drawing.Bitmap($w, $h)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($rc.Left, $rc.Top, 0, 0, $bitmap.Size)
        $outfile = "C:\Users\snowb\Desktop\work\desktop-main\assets\probe-shots\trae.png"
        $bitmap.Save($outfile, [System.Drawing.Imaging.ImageFormat]::Png)
        $graphics.Dispose()
        $bitmap.Dispose()
        Write-Output "OK ${w}x${h} title=$title"
        exit 0
    } catch {
        Write-Output "ERR $($p.Id): $_"
    }
}
Write-Output "NO_WINDOW"
