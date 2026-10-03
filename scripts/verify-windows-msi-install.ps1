[CmdletBinding()]
param(
    [string]$MsiDirectory,
    [string]$RepoRoot,
    [string]$LogDirectory,
    [switch]$InspectOnly,
    [switch]$PreserveInstalledProduct
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($InspectOnly -and $PreserveInstalledProduct) {
    throw 'InspectOnly and PreserveInstalledProduct are mutually exclusive'
}

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
}

if (-not $MsiDirectory) {
    $MsiDirectory = Join-Path $RepoRoot 'src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi'
}
if (-not (Test-Path -LiteralPath $MsiDirectory -PathType Container)) {
    throw "MSI directory does not exist: $MsiDirectory"
}
$MsiDirectory = (Resolve-Path $MsiDirectory).Path

if (-not $LogDirectory) {
    $logBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
    $LogDirectory = Join-Path $logBase 'ytdl-flow-install-trust'
}
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$LogDirectory = (Resolve-Path $LogDirectory).Path

$installLog = Join-Path $LogDirectory 'msi-install.log'
$uninstallLog = Join-Path $LogDirectory 'msi-uninstall.log'
$resultPath = Join-Path $LogDirectory 'result.json'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class YtdlFlowMsiNative {
    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern int MsiQueryProductState(string product);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiGetProductInfo(
        string product,
        string property,
        StringBuilder value,
        ref uint length
    );
}
"@

function Get-MsiProperty {
    param(
        [Parameter(Mandatory)]$Database,
        [Parameter(Mandatory)][string]$Name
    )

    $escaped = $Name.Replace("'", "''")
    $view = $Database.OpenView("SELECT `Value` FROM `Property` WHERE `Property`='$escaped'")
    try {
        [void]$view.Execute()
        $record = $view.Fetch()
        if ($null -eq $record) {
            throw "MSI property is missing: $Name"
        }
        return ([string]$record.StringData(1)).Trim()
    } finally {
        if ($view) {
            try { [void]$view.Close() } catch {}
        }
    }
}

function Get-MsiFileNames {
    param([Parameter(Mandatory)]$Database)

    $names = [System.Collections.Generic.List[string]]::new()
    $view = $Database.OpenView('SELECT `FileName` FROM `File`')
    try {
        [void]$view.Execute()
        while ($true) {
            $record = $view.Fetch()
            if ($null -eq $record) { break }
            $raw = ([string]$record.StringData(1)).Trim()
            if (-not $raw) { continue }
            $longName = if ($raw.Contains('|')) { $raw.Split('|')[-1] } else { $raw }
            $names.Add($longName)
        }
    } finally {
        if ($view) {
            try { [void]$view.Close() } catch {}
        }
    }

    return $names.ToArray()
}

function Get-MsiFileSize {
    param(
        [Parameter(Mandatory)]$Database,
        [Parameter(Mandatory)][string]$Name
    )

    $view = $Database.OpenView('SELECT `FileName`, `FileSize` FROM `File`')
    try {
        [void]$view.Execute()
        while ($true) {
            $record = $view.Fetch()
            if ($null -eq $record) { break }

            $rawName = ([string]$record.StringData(1)).Trim()
            if (-not $rawName) { continue }
            $longName = if ($rawName.Contains('|')) { $rawName.Split('|')[-1] } else { $rawName }
            if ($longName -eq $Name) {
                return [int64]$record.IntegerData(2)
            }
        }
    } finally {
        if ($view) {
            try { [void]$view.Close() } catch {}
        }
    }

    throw "MSI File table is missing required payload size metadata: $Name"
}

function Get-ProductState {
    param([Parameter(Mandatory)][string]$ProductCode)
    return [YtdlFlowMsiNative]::MsiQueryProductState($ProductCode)
}

function Get-InstalledProductInfo {
    param(
        [Parameter(Mandatory)][string]$ProductCode,
        [Parameter(Mandatory)][string]$Property
    )

    $builder = [System.Text.StringBuilder]::new(4096)
    [uint32]$length = 4095
    $rc = [YtdlFlowMsiNative]::MsiGetProductInfo(
        $ProductCode,
        $Property,
        $builder,
        [ref]$length
    )
    if ($rc -ne 0) {
        throw "MsiGetProductInfo($Property) failed for $ProductCode with code $rc"
    }
    return $builder.ToString()
}

function Get-PeMachine {
    param([Parameter(Mandatory)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5A4D) {
            throw "Not a PE executable: $Path"
        }
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        if ($peOffset -lt 0 -or $peOffset -gt ($stream.Length - 6)) {
            throw "Invalid PE header offset: $Path"
        }
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) {
            throw "Invalid PE signature: $Path"
        }
        return $reader.ReadUInt16()
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Assert-X64Pe {
    param([Parameter(Mandatory)][string]$Path)

    $machine = Get-PeMachine -Path $Path
    if ($machine -ne 0x8664) {
        throw ('Expected x64 PE (0x8664), got 0x{0:X4}: {1}' -f $machine, $Path)
    }
}

function Assert-SameHash {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Installed
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Build input missing: $Source"
    }
    if (-not (Test-Path -LiteralPath $Installed -PathType Leaf)) {
        throw "Installed payload missing: $Installed"
    }

    $sourceHash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
    $installedHash = (Get-FileHash -LiteralPath $Installed -Algorithm SHA256).Hash
    if ($sourceHash -ne $installedHash) {
        throw "Installed payload hash mismatch: $Installed"
    }
}

function Invoke-MsiExec {
    param(
        [Parameter(Mandatory)][ValidateSet('Install', 'Uninstall')][string]$Action,
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$LogPath
    )

    $msiexec = Join-Path $env:SystemRoot 'System32\msiexec.exe'
    if (-not (Test-Path -LiteralPath $msiexec -PathType Leaf)) {
        throw "msiexec.exe not found: $msiexec"
    }

    $verb = if ($Action -eq 'Install') { '/i' } else { '/x' }
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $msiexec
    $startInfo.UseShellExecute = $false
    foreach ($argument in @(
        $verb,
        $Target,
        '/qn',
        '/norestart',
        'REBOOT=ReallySuppress',
        '/L*v',
        $LogPath
    )) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        throw "Failed to start msiexec.exe for $Action"
    }

    try {
        $process.WaitForExit()
        $exitCode = $process.ExitCode
    } finally {
        $process.Dispose()
    }

    if ($exitCode -ne 0) {
        $exception = [System.InvalidOperationException]::new(
            "$Action MSI failed with exit code $exitCode. Log: $LogPath"
        )
        $exception.Data['ExitCode'] = $exitCode
        throw $exception
    }

    return $exitCode
}

$msiFiles = @(Get-ChildItem -LiteralPath $MsiDirectory -Filter '*.msi' -File)
if ($msiFiles.Count -ne 1) {
    throw "Expected exactly one MSI in $MsiDirectory; found $($msiFiles.Count)"
}
$msiPath = $msiFiles[0].FullName
$msiHash = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash

$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase($msiPath, 0)
$productCode = Get-MsiProperty -Database $database -Name 'ProductCode'
$productVersion = Get-MsiProperty -Database $database -Name 'ProductVersion'
$productName = Get-MsiProperty -Database $database -Name 'ProductName'
$summaryTemplate = ([string]$database.SummaryInformation(0).Property(7)).Trim()
$msiFileNames = @(Get-MsiFileNames -Database $database)
$mainExecutableMsiSize = Get-MsiFileSize -Database $database -Name 'yt-dlp-cool.exe'

$packageJson = Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
$expectedVersion = [string]$packageJson.version
if ($productName -ne 'YTDL-Flow') {
    throw "Unexpected MSI ProductName: $productName"
}
if ($productVersion -ne $expectedVersion) {
    throw "MSI ProductVersion $productVersion does not match package.json $expectedVersion"
}
if ($summaryTemplate -notmatch '(^|;)x64(;|$)') {
    throw "MSI summary template is not x64: $summaryTemplate"
}

$requiredMsiFiles = @(
    'yt-dlp-cool.exe',
    'yt-dlp.exe',
    'ffmpeg.exe',
    'ffprobe.exe',
    'bun.exe',
    'rustypipe-botguard.exe',
    'yt_dlp_get_pot_rustypipe.py'
)
foreach ($name in $requiredMsiFiles) {
    if ($msiFileNames -notcontains $name) {
        throw "MSI File table is missing required payload: $name"
    }
}

$report = [ordered]@{
    status = 'metadata-verified'
    inspectOnly = [bool]$InspectOnly
    preserveInstalledProduct = [bool]$PreserveInstalledProduct
    verificationScope = if ($InspectOnly) { 'metadata-only' } elseif ($PreserveInstalledProduct) { 'installed-state-only' } else { 'full-install-lifecycle' }
    msi = $msiPath
    msiSha256 = $msiHash
    productCode = $productCode
    productVersion = $productVersion
    productName = $productName
    summaryTemplate = $summaryTemplate
    installLocation = $null
    installedFiles = @()
    installExit = $null
    uninstallExit = $null
    error = $null
}

if ($InspectOnly) {
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
    Write-Output "MSI metadata verified (inspect only): $msiPath"
    exit 0
}

$InstallStateUnknown = -1
$InstallStateDefault = 5
$preState = Get-ProductState -ProductCode $productCode
if (-not $PreserveInstalledProduct -and $preState -ne $InstallStateUnknown) {
    throw "ProductCode is already registered in state $preState; refusing to disturb a pre-existing Windows Installer registration: $productCode"
}

$releaseDirectory = Split-Path (Split-Path $MsiDirectory -Parent) -Parent
$sourcePayload = @(
    [ordered]@{ relative = 'yt-dlp-cool.exe'; source = (Join-Path $releaseDirectory 'yt-dlp-cool.exe'); pe = $true },
    [ordered]@{ relative = 'yt-dlp.exe'; source = (Join-Path $RepoRoot 'src-tauri\bin\yt-dlp-x86_64-pc-windows-msvc.exe'); pe = $true },
    [ordered]@{ relative = 'bin\ffmpeg.exe'; source = (Join-Path $RepoRoot 'src-tauri\bin\ffmpeg.exe'); pe = $true },
    [ordered]@{ relative = 'bin\ffprobe.exe'; source = (Join-Path $RepoRoot 'src-tauri\bin\ffprobe.exe'); pe = $true },
    [ordered]@{ relative = 'bin\bun.exe'; source = (Join-Path $RepoRoot 'src-tauri\bin\bun.exe'); pe = $true },
    [ordered]@{ relative = 'bin\rustypipe-botguard.exe'; source = (Join-Path $RepoRoot 'src-tauri\bin\rustypipe-botguard.exe'); pe = $true },
    [ordered]@{ relative = 'plugins\rustypipe\yt_dlp_plugins\extractor\yt_dlp_get_pot_rustypipe.py'; source = (Join-Path $RepoRoot 'src-tauri\plugins\rustypipe\yt_dlp_plugins\extractor\yt_dlp_get_pot_rustypipe.py'); pe = $false }
)
foreach ($item in $sourcePayload) {
    if (-not (Test-Path -LiteralPath $item.source -PathType Leaf)) {
        throw "Expected build/package input is missing: $($item.source)"
    }
}

# This branch never invokes msiexec and exits before the lifecycle try/finally.
# Errors therefore cannot uninstall a pre-existing product.
if ($PreserveInstalledProduct) {
    try {
        if ($preState -ne $InstallStateDefault) {
            throw "Expected an installed ProductCode in state 5, got $preState"
        }
        $registryRows = @(Get-ChildItem 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
            Get-ItemProperty -ErrorAction SilentlyContinue | Where-Object { $nameProperty = $_.PSObject.Properties['DisplayName']; $nameProperty -and $nameProperty.Value -eq $productName })
        if ($registryRows.Count -ne 1 -or $registryRows[0].PSChildName -ne $productCode -or $registryRows[0].DisplayVersion -ne $productVersion) {
            throw 'Installed registry identity/version does not match this MSI uniquely'
        }
        $installLocation = (Get-InstalledProductInfo -ProductCode $productCode -Property 'InstallLocation').Trim()
        if (-not $installLocation -or -not $registryRows[0].InstallLocation) { throw 'Installed location missing' }
        $installLocation = [IO.Path]::GetFullPath($installLocation).TrimEnd('\')
        if ($installLocation -ne [IO.Path]::GetFullPath($registryRows[0].InstallLocation).TrimEnd('\')) { throw 'Registry/MSI install location mismatch' }
        if (-not (Test-Path -LiteralPath $installLocation -PathType Container)) { throw 'Installed directory missing' }
        if ($installLocation.StartsWith($RepoRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installed directory points into source checkout' }
        $report.installLocation = $installLocation
        foreach ($item in $sourcePayload) {
            $installedPath = Join-Path $installLocation $item.relative
            if (-not (Test-Path -LiteralPath $installedPath -PathType Leaf)) { throw "Installed payload missing: $($item.relative)" }
            if ($item.relative -eq 'yt-dlp-cool.exe') {
                $installedExe = Get-Item -LiteralPath $installedPath
                if ($installedExe.Length -ne $mainExecutableMsiSize) { throw 'Installed main executable size differs from MSI' }
                if ($installedExe.VersionInfo.ProductVersion -ne $productVersion -or $installedExe.VersionInfo.FileVersion -ne $productVersion) { throw 'Installed main executable version differs from MSI' }
                # Tauri patches only this known marker in its packaged main EXE.
                $buildBytes = [IO.File]::ReadAllBytes($item.source)
                $marker = '__TAURI_BUNDLE_TYPE_VAR_UNK'
                $offset = [Text.Encoding]::ASCII.GetString($buildBytes).IndexOf($marker, [StringComparison]::Ordinal)
                if ($offset -ge 0) { [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_MSI').CopyTo($buildBytes, $offset) }
                $buildHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($buildBytes))
                if ($buildHash -ne (Get-FileHash -LiteralPath $installedPath -Algorithm SHA256).Hash) { throw 'Installed main executable hash differs beyond the Tauri bundle marker' }
            } else {
                Assert-SameHash -Source $item.source -Installed $installedPath
            }
            if ($item.pe) { Assert-X64Pe -Path $installedPath }
            $report.installedFiles += [ordered]@{ relative = $item.relative; sha256 = (Get-FileHash -LiteralPath $installedPath -Algorithm SHA256).Hash; x64 = $item.pe }
        }
        $report.status = 'PRESERVED_INSTALL_TRUST_PASS'
    } catch {
        $report.status = 'failed'
        $report.error = $_.Exception.Message
        throw
    } finally {
        $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
    }
    Write-Output 'PRESERVED_INSTALL_TRUST_PASS (installed-state only; no reinstall/uninstall)'
    Write-Output "Report=$resultPath"
    exit 0
}

$installAttempted = $false
$primaryError = $null
$cleanupError = $null
$installedPaths = [System.Collections.Generic.List[string]]::new()
$installLocation = $null

try {
    $installAttempted = $true
    $report.installExit = Invoke-MsiExec -Action Install -Target $msiPath -LogPath $installLog

    if ((Get-ProductState -ProductCode $productCode) -ne $InstallStateDefault) {
        throw "MSI returned success but ProductCode is not registered as installed: $productCode"
    }

    $installLocation = (Get-InstalledProductInfo -ProductCode $productCode -Property 'InstallLocation').Trim()
    if (-not $installLocation) {
        throw "Installed product did not expose InstallLocation"
    }
    $installLocation = [System.IO.Path]::GetFullPath($installLocation)
    $repoPrefix = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
    if ($installLocation.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "InstallLocation unexpectedly points into the source checkout: $installLocation"
    }
    $report.installLocation = $installLocation

    foreach ($item in $sourcePayload) {
        $installedPath = Join-Path $installLocation $item.relative
        $installedPaths.Add($installedPath)

        if ($item.relative -eq 'yt-dlp-cool.exe') {
            if (-not (Test-Path -LiteralPath $installedPath -PathType Leaf)) {
                throw "Installed payload missing: $installedPath"
            }
            $installedSize = (Get-Item -LiteralPath $installedPath).Length
            if ($installedSize -ne $mainExecutableMsiSize) {
                throw "Installed main executable size $installedSize does not match MSI FileSize $mainExecutableMsiSize"
            }
        } else {
            Assert-SameHash -Source $item.source -Installed $installedPath
        }

        if ($item.pe) {
            Assert-X64Pe -Path $installedPath
        }
        $report.installedFiles += [ordered]@{
            relative = $item.relative
            path = $installedPath
            sha256 = (Get-FileHash -LiteralPath $installedPath -Algorithm SHA256).Hash
        }
    }

    $report.status = 'install-verified'
} catch {
    $primaryError = $_
    if ($_.Exception.Data.Contains('ExitCode')) {
        $report.installExit = [int]$_.Exception.Data['ExitCode']
    }
    $report.status = 'failed'
    $report.error = $_.Exception.Message
} finally {
    if ($installAttempted -and (Get-ProductState -ProductCode $productCode) -ne $InstallStateUnknown) {
        try {
            $report.uninstallExit = Invoke-MsiExec -Action Uninstall -Target $productCode -LogPath $uninstallLog

            $postUninstallState = Get-ProductState -ProductCode $productCode
            if ($postUninstallState -ne $InstallStateUnknown) {
                throw "ProductCode remains registered after uninstall in state ${postUninstallState}: $productCode"
            }

            foreach ($path in $installedPaths) {
                if (Test-Path -LiteralPath $path) {
                    throw "Installed payload remains after uninstall: $path"
                }
            }

            if ($installLocation -and (Test-Path -LiteralPath $installLocation -PathType Container)) {
                $residual = @(Get-ChildItem -LiteralPath $installLocation -Force -Recurse -ErrorAction SilentlyContinue)
                if ($residual.Count -gt 0) {
                    throw "Product install directory still contains residual payload after uninstall: $installLocation"
                }
            }

            if (-not $primaryError) {
                $report.status = 'passed'
            }
        } catch {
            $cleanupError = $_
            if ($_.Exception.Data.Contains('ExitCode')) {
                $report.uninstallExit = [int]$_.Exception.Data['ExitCode']
            }
            if (-not $report.error) {
                $report.error = $_.Exception.Message
            } else {
                $report.error = $report.error + ' | Cleanup: ' + $_.Exception.Message
            }
            $report.status = 'failed'
        }
    }

    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
}

if ($primaryError) {
    throw $primaryError
}
if ($cleanupError) {
    throw $cleanupError
}
if ($report.status -ne 'passed') {
    throw "Install-trust verifier did not reach PASS. Report: $resultPath"
}

Write-Output "Windows MSI install trust PASS"
Write-Output "ProductCode=$productCode"
Write-Output "InstallLocation=$installLocation"
Write-Output "Report=$resultPath"
