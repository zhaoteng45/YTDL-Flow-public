[CmdletBinding()]
param([string]$PackageVersion)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP) { throw 'Release installer builds require an isolated CI runner' }
$configPath = Join-Path $env:RUNNER_TEMP ('ytdl-build-' + [Guid]::NewGuid().ToString('N') + '.json')
& bun (Join-Path $PSScriptRoot 'create-release-build-config.mjs') $configPath $PackageVersion
if ($LASTEXITCODE -ne 0) { throw 'Release build configuration failed' }
& bun run tauri:build --target x86_64-pc-windows-msvc --bundles msi --config $configPath
if ($LASTEXITCODE -ne 0) { throw 'Release installer build failed' }
