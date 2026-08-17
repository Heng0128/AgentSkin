$ErrorActionPreference = "Continue"

$treeFile = "C:\Users\snowb\.meituan-catpaw\4864504263\projects\C--Users-snowb-Desktop-work-desktop-main\cbd89f82-9747-411f-bc6c-07bec15961a6\tool-results\bt38513kk.txt"
$tree = Get-Content $treeFile -Raw | ConvertFrom-Json
$images = $tree.tree | Where-Object { $_.type -eq 'blob' -and ($_.path -match '\.(jpg|jpeg|png|webp|gif|bmp)$') }
$targetDir = "C:\Users\snowb\Desktop\work\desktop-main\sources\walls-catppuccin-mocha"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$token = gh auth token 2>$null
$headers = @{ Authorization = "token $token"; "User-Agent" = "AgentSkin-Setup" }

$downloaded = 0
$errors = 0

# Clean up partial downloads first
Get-ChildItem $targetDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

foreach ($img in $images) {
    $path = $img.path
    $outFile = Join-Path $targetDir $path
    $url = "https://raw.githubusercontent.com/orangci/walls-catppuccin-mocha/master/$path"
    
    try {
        Invoke-WebRequest -Uri $url -Headers $headers -OutFile $outFile -UseBasicParsing -ErrorAction Stop
        $downloaded++
    } catch {
        $errors++
        Write-Host "ERROR: $path - $($_.Exception.Message)"
    }
    
    if (($downloaded + $errors) % 50 -eq 0) {
        Write-Host "Progress: $downloaded downloaded, $errors errors of $($images.Count)"
    }
}
Write-Host "`nDone! Downloaded: $downloaded, Errors: $errors, Total: $($images.Count)"
