Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { Join-Path $PSScriptRoot '../.scratch/release-ci' }
$root = Join-Path $base ('cargo-about-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$archive = Join-Path $root 'cargo-about.tar.gz'
Invoke-WebRequest -Uri 'https://github.com/EmbarkStudios/cargo-about/releases/download/0.9.2/cargo-about-0.9.2-x86_64-pc-windows-msvc.tar.gz' -OutFile $archive
$expected = '1c03e5890238562497c2d89a3b75b02560af349c1fc3e713d3284f532a5cd748'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'cargo-about checksum mismatch' }
& tar -xf $archive -C $root
if ($LASTEXITCODE -ne 0) { throw 'cargo-about archive extraction failed' }
$tool = Join-Path $root 'cargo-about-0.9.2-x86_64-pc-windows-msvc/cargo-about.exe'
if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'cargo-about executable missing' }
if ($env:GITHUB_ENV) { "CARGO_ABOUT=$tool" | Add-Content -LiteralPath $env:GITHUB_ENV }
$minisignArchive = Join-Path $root 'minisign.zip'
Invoke-WebRequest -Uri 'https://github.com/jedisct1/minisign/releases/download/0.12/minisign-0.12-win64.zip' -OutFile $minisignArchive
if ((Get-FileHash -LiteralPath $minisignArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '37b600344e20c19314b2e82813db2bfdcc408b77b876f7727889dbd46d539479') { throw 'minisign checksum mismatch' }
Expand-Archive -LiteralPath $minisignArchive -DestinationPath $root
$minisign = Join-Path $root 'minisign-win64/x86_64/minisign.exe'
if (-not (Test-Path -LiteralPath $minisign -PathType Leaf)) { throw 'minisign executable missing' }
if ($env:GITHUB_ENV) { "MINISIGN=$minisign" | Add-Content -LiteralPath $env:GITHUB_ENV }
Write-Output $tool
