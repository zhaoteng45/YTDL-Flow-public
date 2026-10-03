Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP -or -not $env:GITHUB_ENV) { throw 'Release signing must run in the isolated CI runner' }
if (-not $env:WINDOWS_SIGNING_PFX_BASE64 -or -not $env:WINDOWS_SIGNING_PASSWORD) { throw 'Windows signing certificate credentials are missing' }
$pfx = Join-Path $env:RUNNER_TEMP ('ytdl-signing-' + [Guid]::NewGuid().ToString('N') + '.pfx')
try {
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_SIGNING_PFX_BASE64))
    $password = ConvertTo-SecureString $env:WINDOWS_SIGNING_PASSWORD -AsPlainText -Force
    $certificate = Import-PfxCertificate -FilePath $pfx -CertStoreLocation 'Cert:\CurrentUser\My' -Password $password
    if (-not $certificate.HasPrivateKey -or $certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) { throw 'Windows signing certificate is invalid or expired' }
    if (@($certificate.EnhancedKeyUsageList.ObjectId.Value) -notcontains '1.3.6.1.5.5.7.3.3') { throw 'Certificate is not valid for code signing' }
    $configPath = Join-Path $env:RUNNER_TEMP 'ytdl-signing-config.json'
    @{ bundle = @{ windows = @{ certificateThumbprint = $certificate.Thumbprint; digestAlgorithm = 'sha256'; timestampUrl = 'http://timestamp.digicert.com' } } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding utf8
    "YTDL_SIGN_CONFIG=$configPath" | Add-Content -LiteralPath $env:GITHUB_ENV
    "YTDL_SIGNER_THUMBPRINT=$($certificate.Thumbprint)" | Add-Content -LiteralPath $env:GITHUB_ENV
} finally {
    if (Test-Path -LiteralPath $pfx) { Remove-Item -LiteralPath $pfx -Force }
}
