param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$secure = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
