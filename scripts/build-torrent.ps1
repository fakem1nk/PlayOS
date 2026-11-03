# Сборка resources\PlayOSTorrent.exe (native\torrent). Нужны Visual Studio 2026 с C++ и vcpkg с собранным
#   vcpkg install "libtorrent[core]:x64-windows-static"
# Путь к vcpkg — из VCPKG_ROOT или %USERPROFILE%\vcpkg. Готовый exe лежит в репозитории: CI его не пересобирает
# (Boost и OpenSSL собирались бы около часа).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$vcpkg = if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { Join-Path $env:USERPROFILE 'vcpkg' }
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$build = Join-Path $root 'native\torrent\build'

& $cmake -S (Join-Path $root 'native\torrent') -B $build -A x64 `
  "-DCMAKE_TOOLCHAIN_FILE=$vcpkg\scripts\buildsystems\vcpkg.cmake" -DVCPKG_TARGET_TRIPLET=x64-windows-static
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& $cmake --build $build --config Release
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Copy-Item (Join-Path $build 'Release\PlayOSTorrent.exe') (Join-Path $root 'resources\PlayOSTorrent.exe') -Force
Write-Host 'resources\PlayOSTorrent.exe'
