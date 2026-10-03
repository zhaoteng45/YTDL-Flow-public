$ErrorActionPreference = "Stop"
$binDir = Join-Path $PSScriptRoot "src-tauri\bin"
$tempDir = Join-Path $PSScriptRoot "temp_updates"

# Tool Paths
$tools = @{
    "yt-dlp"  = @{
        "main" = Join-Path $binDir "yt-dlp-x86_64-pc-windows-msvc.exe"
        "copy" = Join-Path $binDir "yt-dlp.exe"
    }
    "ffmpeg"  = @{
        "main" = Join-Path $binDir "ffmpeg.exe"
        "copy" = $null
    }
    "ffprobe" = @{
        "main" = Join-Path $binDir "ffprobe.exe"
        "copy" = $null
    }
    "bun"     = @{
        "main" = Join-Path $binDir "bun.exe"
        "copy" = $null
    }
}

# Helper to get version
function Get-ToolVersion {
    param($name, $path)
    if (-not (Test-Path $path)) { return "Missing" }
    try {
        if ($name -eq "yt-dlp") {
            return (& $path --version)
        }
        elseif ($name -in "ffmpeg", "ffprobe") {
            $out = & $path -version
            if ($out) { return $out[0] -replace "ffmpeg version ", "" -replace "ffprobe version ", "" -replace " Copyright.*", "" -replace "-essentials.*", "" }
        }
        elseif ($name -eq "bun") {
            $out = & $path --version
            if ($out) { return ("$out").Trim() }
        }
    }
    catch {
        return "Error"
    }
    return "Unknown"
}

# Helper to get remote ffmpeg version
function Get-RemoteFFmpegVersion {
    try {
        $v = Invoke-RestMethod -Uri "https://www.gyan.dev/ffmpeg/builds/release-version"
        return $v.Trim()
    }
    catch {
        Write-Warning "Failed to check remote ffmpeg version: $_"
        return $null
    }
}

# Store results
$results = @{}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   YTDL-Flow Dependency Updater & Tester  " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Pre-Update Check
Write-Host "1. Checking current versions..." -ForegroundColor Yellow
foreach ($name in $tools.Keys) {
    $ver = Get-ToolVersion $name $tools[$name].main
    $results[$name] = @{ "Pre" = $ver; "Post" = ""; "Test" = "Pending"; "Action" = "Checked" }
    Write-Host "   $name : $ver"
}
Write-Host ""

# 2. Update Process
Write-Host "2. Updating tools..." -ForegroundColor Yellow

# yt-dlp
Write-Host "   Updating yt-dlp..." -NoNewline
try {
    $out = & $tools["yt-dlp"].main -U 2>&1
    if ($out -match "is up to date") {
        Write-Host " Up to date" -ForegroundColor Green
        $results["yt-dlp"]["Action"] = "Skipped"
    }
    else {
        Copy-Item $tools["yt-dlp"].main -Destination $tools["yt-dlp"].copy -Force
        Write-Host " Updated" -ForegroundColor Green
        $results["yt-dlp"]["Action"] = "Updated"
    }
}
catch {
    Write-Host " Failed: $_" -ForegroundColor Red
}

# Bun
Write-Host "   Updating bun..." -NoNewline
try {
    if (Test-Path $tools["bun"].main) {
        $ver = & $tools["bun"].main --version
        Write-Host " Ready ($ver)" -ForegroundColor Green
        $results["bun"]["Action"] = "Verified"
    }
}
catch {
    Write-Host " Failed: $_" -ForegroundColor Red
}

# FFmpeg / FFprobe
Write-Host "   Updating ffmpeg/ffprobe..." -NoNewline
try {
    $localFF = $results["ffmpeg"]["Pre"]
    $remoteFF = Get-RemoteFFmpegVersion
    
    if ($remoteFF -and $localFF -eq $remoteFF) {
        Write-Host " Up to date ($localFF)" -ForegroundColor Green
        $results["ffmpeg"]["Action"] = "Skipped"
        $results["ffprobe"]["Action"] = "Skipped"
    }
    else {
        if ($remoteFF) { Write-Host " New version available: $remoteFF (Local: $localFF). Downloading..." -NoNewline }
        else { Write-Host " Version check failed, forcing update..." -NoNewline }

        if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
        New-Item -ItemType Directory -Path $tempDir | Out-Null
        
        $url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
        $zip = Join-Path $tempDir "ffmpeg.zip"
        Invoke-WebRequest -Uri $url -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $tempDir -Force
        
        $extractedBin = Get-ChildItem -Path $tempDir -Recurse -Filter "ffmpeg.exe" | Select-Object -ExpandProperty DirectoryName -First 1
        
        Copy-Item (Join-Path $extractedBin "ffmpeg.exe") -Destination $tools["ffmpeg"].main -Force
        if ($tools["ffmpeg"].copy) {
            Copy-Item (Join-Path $extractedBin "ffmpeg.exe") -Destination $tools["ffmpeg"].copy -Force
        }
        
        Copy-Item (Join-Path $extractedBin "ffprobe.exe") -Destination $tools["ffprobe"].main -Force
        if ($tools["ffprobe"].copy) {
            Copy-Item (Join-Path $extractedBin "ffprobe.exe") -Destination $tools["ffprobe"].copy -Force
        }
        
        Write-Host " Done" -ForegroundColor Green
        $results["ffmpeg"]["Action"] = "Updated"
        $results["ffprobe"]["Action"] = "Updated"
    }
}
catch {
    Write-Host " Failed: $_" -ForegroundColor Red
}
finally {
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
}
Write-Host ""

# 3. Post-Update Check
Write-Host "3. Checking new versions..." -ForegroundColor Yellow
foreach ($name in $tools.Keys) {
    $ver = Get-ToolVersion $name $tools[$name].main
    $results[$name]["Post"] = $ver
    Write-Host "   $name : $ver"
}
Write-Host ""

# 4. Functional Testing
Write-Host "4. Running functional tests..." -ForegroundColor Yellow

# Test yt-dlp
Write-Host "   Testing yt-dlp (simulate)..." -NoNewline
try {
    & $tools["yt-dlp"].main --simulate "https://www.youtube.com/watch?v=jNQXAC9IVRw" 2>&1 | Out-Null
    $results["yt-dlp"]["Test"] = "PASS"
    Write-Host " PASS" -ForegroundColor Green
}
catch {
    $results["yt-dlp"]["Test"] = "FAIL"
    Write-Host " FAIL" -ForegroundColor Red
}

# Test ffmpeg
Write-Host "   Testing ffmpeg (gen video)..." -NoNewline
$testVid = "test_vid.mp4"
try {
    & $tools["ffmpeg"].main -y -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -c:v libx264 $testVid 2>&1 | Out-Null
    if (Test-Path $testVid) {
        $results["ffmpeg"]["Test"] = "PASS"
        Write-Host " PASS" -ForegroundColor Green
    }
    else { throw "File not created" }
}
catch {
    $results["ffmpeg"]["Test"] = "FAIL"
    Write-Host " FAIL" -ForegroundColor Red
}

# Test ffprobe
Write-Host "   Testing ffprobe (analyze)..." -NoNewline
try {
    if (Test-Path $testVid) {
        & $tools["ffprobe"].main $testVid 2>&1 | Out-Null
        $results["ffprobe"]["Test"] = "PASS"
        Write-Host " PASS" -ForegroundColor Green
    }
    else {
        $results["ffprobe"]["Test"] = "SKIP"
        Write-Host " SKIP" -ForegroundColor DarkGray
    }
}
catch {
    $results["ffprobe"]["Test"] = "FAIL"
    Write-Host " FAIL" -ForegroundColor Red
}
if (Test-Path $testVid) { Remove-Item $testVid -Force }

# Test Deno
Write-Host "   Testing bun (eval)..." -NoNewline
try {
    $out = & $tools["bun"].main -e "console.log(1+1)"
    if ($out -match "2") {
        $results["bun"]["Test"] = "PASS"
        Write-Host " PASS" -ForegroundColor Green
    }
    else { throw "Output mismatch" }
}
catch {
    $results["bun"]["Test"] = "FAIL"
    Write-Host " FAIL" -ForegroundColor Red
}
Write-Host ""

# 5. Final Report
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "            UPDATE SUMMARY                " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
"{0,-10} | {1,-10} | {2,-20} | {3,-10}" -f "TOOL", "ACTION", "VERSION", "STATUS"
Write-Host "-------------------------------------------------------------" -ForegroundColor Gray

foreach ($name in $tools.Keys) {
    $r = $results[$name]
    $color = if ($r["Test"] -eq "PASS") { "Green" } else { "Red" }
    
    # Truncate long versions for display
    $ver = if ($r["Post"].Length -gt 20) { $r["Post"].Substring(0, 17) + "..." } else { $r["Post"] }
    
    Write-Host ("{0,-10} | {1,-10} | {2,-20} | " -f $name, $r["Action"], $ver) -NoNewline
    Write-Host ("{0,-10}" -f $r["Test"]) -ForegroundColor $color
}
Write-Host "-------------------------------------------------------------" -ForegroundColor Gray
Write-Host "Done."
