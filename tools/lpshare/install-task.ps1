$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe).Source
$script = Join-Path $PSScriptRoot 'src\cli.ts'
$tsx = Join-Path $PSScriptRoot 'node_modules\tsx\dist\loader.mjs'
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $node -Argument "--import `"$tsx`" `"$script`" tick" -WorkingDirectory $PSScriptRoot
# A frequent inexpensive check catches missed runs. The database enforces calendar biweeks.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'AlphaCity LP Share' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host 'Task installed for this Windows user. Keep the computer awake, online, and signed in. Live mode and schedule must be enabled separately.'
