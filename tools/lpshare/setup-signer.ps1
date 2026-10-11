$ErrorActionPreference = 'Stop'
$data = Join-Path $env:LOCALAPPDATA 'AlphaCity\LPShare'
New-Item -ItemType Directory -Force -Path $data | Out-Null
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $data /inheritance:r /grant:r "${account}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict data directory permissions' }
$secret = Read-Host 'Position owner private key (suiprivkey…, hidden; never paste into chat)' -AsSecureString
$secret | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $data 'signer.dpapi')
Write-Host 'Signer encrypted for this Windows user. Live execution remains disabled.'
