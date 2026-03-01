$ErrorActionPreference = 'Stop'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
Uninstall-BinFile -Name 'markpad'
Remove-Item "$( [Environment]::GetFolderPath('Desktop') )\Markpad.lnk" -ErrorAction SilentlyContinue
Remove-Item "$( [Environment]::GetFolderPath('Programs') )\Markpad.lnk" -ErrorAction SilentlyContinue
