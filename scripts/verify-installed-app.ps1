[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallLocation,
    [Parameter(Mandatory)][string]$LogDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Start-OwnedProcess([string]$File, [string[]]$Arguments) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $File
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($info)
    if ($null -eq $process) { throw "Unable to start installed tool: $File" }
    return $process
}

function Stop-OwnedProcess($Process) {
    if ($Process -and -not $Process.HasExited) {
        $Process.Kill($true)
        if (-not $Process.WaitForExit(10000)) { throw "Owned process tree did not exit: $($Process.Id)" }
    }
}

$root = Join-Path $LogDirectory ('native-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$fixture = Join-Path $root 'fixture.mp4'
$generator = $null
$server = $null
$app = $null
try {
    # One-second synthetic fixture, matching the existing Rust loopback test.
    $generator = Start-OwnedProcess (Join-Path $InstallLocation 'bin/ffmpeg.exe') @(
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'testsrc=duration=1:size=96x54:rate=10', '-pix_fmt', 'yuv420p', $fixture
    )
    if (-not $generator.WaitForExit(30000) -or $generator.ExitCode -ne 0) { throw 'Installed FFmpeg fixture generation failed or exceeded 30s' }
    $serverScript = Join-Path $PSScriptRoot 'release-fixture-server.mjs'
    $server = Start-OwnedProcess (Join-Path $InstallLocation 'bin/bun.exe') @($serverScript, $root)
    $request = Join-Path $root 'request.json'
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $request -PathType Leaf)) {
        if ($server.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Loopback fixture server did not become ready within 10s' }
        Start-Sleep -Milliseconds 100
    }
    $app = Start-OwnedProcess (Join-Path $InstallLocation 'yt-dlp-cool.exe') @('--release-smoke', $request)
    # Native download watchdog is 180s; its smoke wrapper allows 240s for cleanup.
    if (-not $app.WaitForExit(300000)) { throw 'Installed app smoke exceeded 300s' }
    $reportFile = Join-Path $root 'native-smoke.json'
    if (-not (Test-Path -LiteralPath $reportFile -PathType Leaf)) { throw 'Installed app did not produce a smoke report' }
    $report = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
    Copy-Item -LiteralPath $reportFile -Destination (Join-Path $LogDirectory 'native-smoke.json')
    if ($app.ExitCode -ne 0 -or $report.status -ne 'passed') { throw 'Installed app analysis/download smoke failed; see native-smoke.json' }
    Write-Output 'Installed application native analysis/download: PASS'
} finally {
    # All processes were started by this invocation; never kill by image name.
    $cleanupErrors = @()
    foreach ($process in @($app, $server, $generator)) {
        try { Stop-OwnedProcess $process } catch { $cleanupErrors += $_ }
        if ($process) { $process.Dispose() }
    }
    if ($cleanupErrors.Count) { throw $cleanupErrors[0] }
}
