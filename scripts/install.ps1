param([string]$Target = 'E:\PlayOS')
# Устанавливает (или обновляет) PlayOS в папку: копирует собранное приложение и ставит ярлык на рабочий стол.
# Ярлык в «Пуске» PlayOS создаёт сам при первом запуске. Данные (библиотека, арт) живут в %APPDATA%\PlayOS.
$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot '..\release\win-unpacked'
if (-not (Test-Path (Join-Path $src 'PlayOS.exe'))) { throw 'Build first: npm run dist' }

# Запущенный PlayOS (обновление) или старый PCStation держат файлы и папку данных
$running = Get-Process -Name PlayOS, PCStation -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 1200
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
robocopy $src $Target /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy code $LASTEXITCODE)" }

$exe = Join-Path $Target 'PlayOS.exe'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'PlayOS.lnk'))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $Target
$lnk.IconLocation = "$exe,0"
$lnk.Description = 'PlayOS'
$lnk.Save()

"Installed to $Target"
