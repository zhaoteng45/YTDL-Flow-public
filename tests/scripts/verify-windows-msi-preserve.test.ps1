$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exe='C:\Program Files\YTDL-Flow\yt-dlp-cool.exe'
$before=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
$logDir=Join-Path $repo '.scratch\native-3.0-install-trust'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
& pwsh -NoProfile -File (Join-Path $repo 'scripts\verify-windows-msi-install.ps1') -PreserveInstalledProduct -LogDirectory $logDir *> (Join-Path $logDir 'preserve-cli.log')
$verifyExit=$LASTEXITCODE
if((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $before){throw 'Installed main EXE changed'}
if((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ne '3.0.0'){throw 'Installed version changed'}
if($verifyExit -ne 0){Get-Content (Join-Path $logDir 'preserve-cli.log') -Tail 10;throw "Preserve verifier exit $verifyExit"}
$result=Get-Content (Join-Path $logDir 'result.json') -Raw | ConvertFrom-Json
if($result.status -ne 'PRESERVED_INSTALL_TRUST_PASS'){throw 'Wrong preserved-state result'}
if($null -ne $result.installExit -or $null -ne $result.uninstallExit){throw 'Preserve mode performed lifecycle mutation'}
if($result.verificationScope -ne 'installed-state-only'){throw 'Preserved state masqueraded as lifecycle'}
if($result.installedFiles.Count -ne 7){throw 'Required payload was not verified'}
& pwsh -NoProfile -File (Join-Path $repo 'scripts\verify-windows-msi-install.ps1') -PreserveInstalledProduct -InspectOnly -LogDirectory $logDir *> (Join-Path $logDir 'invalid-mode.log')
if($LASTEXITCODE -eq 0){throw 'Conflicting modes should fail'}
if((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $before){throw 'Invalid mode changed installed EXE'}
# Change only a copied MSI's identity to exercise the absent-registration path.
# This fixture is never installed and stays outside Git-tracked files.
$fixtureDir=Join-Path $repo 'src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi-3.0-preserve-negative'
New-Item -ItemType Directory -Force -Path $fixtureDir | Out-Null
$fixture=Join-Path $fixtureDir 'unregistered.msi'
Copy-Item -LiteralPath (Join-Path $repo 'src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\YTDL-Flow_3.0.0_x64_zh-CN.msi') -Destination $fixture
$installer=New-Object -ComObject WindowsInstaller.Installer
$db=$installer.OpenDatabase($fixture,1)
$unusedCode='{'+[guid]::NewGuid().ToString().ToUpperInvariant()+'}'
$view=$db.OpenView("UPDATE ``Property`` SET ``Value``='$unusedCode' WHERE ``Property``='ProductCode'")
$view.Execute();$view.Close();$db.Commit()
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($db)
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
$negativeLog=Join-Path $logDir 'unregistered'
& pwsh -NoProfile -File (Join-Path $repo 'scripts\verify-windows-msi-install.ps1') -PreserveInstalledProduct -MsiDirectory $fixtureDir -LogDirectory $negativeLog *> (Join-Path $logDir 'unregistered-mode.log')
if($LASTEXITCODE -eq 0){throw 'Unregistered ProductCode should fail'}
$negative=Get-Content (Join-Path $negativeLog 'result.json') -Raw | ConvertFrom-Json
if($negative.status -ne 'failed' -or $negative.error -notmatch 'Expected an installed ProductCode'){throw 'Wrong unregistered-product failure'}
if($null -ne $negative.installExit -or $null -ne $negative.uninstallExit){throw 'Missing registration caused lifecycle mutation'}
if((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $before){throw 'Negative mode changed installed EXE'}
Write-Output 'PASS: preserved install unchanged; conflicting modes and absent registration fail without lifecycle mutation'
