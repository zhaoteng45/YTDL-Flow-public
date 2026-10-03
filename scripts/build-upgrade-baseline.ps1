# This tests Windows Installer upgrade mechanics with the same source and an
# older package version. It does not claim migration from a historical release.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP) { throw 'Synthetic baseline builds require an isolated CI runner' }
$current = [version](Get-Content package.json -Raw | ConvertFrom-Json).version
if ($current.Build -gt 0) { $older = '{0}.{1}.{2}' -f $current.Major,$current.Minor,($current.Build - 1) }
elseif ($current.Minor -gt 0) { $older = '{0}.{1}.0' -f $current.Major,($current.Minor - 1) }
elseif ($current.Major -gt 0) { $older = '{0}.0.0' -f ($current.Major - 1) }
else { throw 'No older synthetic MSI version is available' }
& (Join-Path $PSScriptRoot 'build-release-installer.ps1') -PackageVersion $older
$msiRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi'))
$files = @(Get-ChildItem -LiteralPath $msiRoot -Filter '*.msi' -File)
if ($files.Count -ne 1 -or -not $files[0].FullName.StartsWith($msiRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Expected exactly one baseline MSI in the build directory' }
$destination = Join-Path $env:RUNNER_TEMP 'ytdl-upgrade-baseline.msi'
if (Test-Path -LiteralPath $destination) { throw 'Baseline destination already exists' }
Move-Item -LiteralPath $files[0].FullName -Destination $destination
Write-Output "Synthetic upgrade baseline version: $older"
