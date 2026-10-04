[CmdletBinding()]
param([Parameter(Mandatory)][string]$MsiPath, [Parameter(Mandatory)][string]$ReportPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $env:YTDL_SIGNER_THUMBPRINT -or -not $env:MINISIGN) { throw 'Signature verifier is not configured' }
$auth = Get-AuthenticodeSignature -LiteralPath $MsiPath
if ($auth.Status -ne 'Valid' -or $auth.SignerCertificate.Thumbprint -ne $env:YTDL_SIGNER_THUMBPRINT) { throw 'Installer Authenticode signature is invalid or belongs to another signer' }
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$publicKeyText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($config.plugins.updater.pubkey))
$keyLines = @($publicKeyText.Trim() -split '\r?\n')
if ($keyLines.Count -ne 2 -or $keyLines[1] -notmatch '^RW[A-Za-z0-9+/=]+$') { throw 'Updater public key format is invalid' }
$signaturePath = $MsiPath + '.sig'
$signatureText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([IO.File]::ReadAllText($signaturePath).Trim()))
$decodedPath = Join-Path $env:RUNNER_TEMP ('ytdl-' + [Guid]::NewGuid().ToString('N') + '.minisig')
try {
    [IO.File]::WriteAllText($decodedPath, $signatureText)
    & $env:MINISIGN -Vm $MsiPath -P $keyLines[1] -x $decodedPath
    if ($LASTEXITCODE -ne 0) { throw 'Updater signature does not match the application public key and installer' }
} finally {
    if (Test-Path -LiteralPath $decodedPath) { Remove-Item -LiteralPath $decodedPath }
}
@{ status = 'passed'; msiSha256 = (Get-FileHash -LiteralPath $MsiPath -Algorithm SHA256).Hash.ToLowerInvariant(); updaterSignatureSha256 = (Get-FileHash -LiteralPath $signaturePath -Algorithm SHA256).Hash.ToLowerInvariant(); authenticodeVerified = $true; updaterVerified = $true } |
    ConvertTo-Json | Set-Content -LiteralPath $ReportPath -Encoding utf8
