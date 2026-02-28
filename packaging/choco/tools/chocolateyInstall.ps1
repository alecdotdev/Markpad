$ErrorActionPreference = 'Stop'
$toolsDir   = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
Install-BinFile -Name 'markpad' -Path "$toolsDir\Markpad.exe"
Install-ChocolateyShortcut -ShortcutFilePath "$( [Environment]::GetFolderPath('Desktop') )\Markpad.lnk" -TargetPath "$toolsDir\Markpad.exe"
Install-ChocolateyShortcut -ShortcutFilePath "$( [Environment]::GetFolderPath('Programs') )\Markpad.lnk" -TargetPath "$toolsDir\Markpad.exe"
