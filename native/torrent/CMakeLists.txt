# PlayOSTorrent.exe — торрент-клиент PlayOS. Сборка: npm run build:torrent (scripts/build-torrent.ps1).
# libtorrent берётся из vcpkg, всё статически (триплет x64-windows-static): один exe без DLL рядом.
cmake_minimum_required(VERSION 3.25)
project(PlayOSTorrent CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

find_package(LibtorrentRasterbar CONFIG REQUIRED)

add_executable(PlayOSTorrent PlayOSTorrent.cpp)
target_link_libraries(PlayOSTorrent PRIVATE LibtorrentRasterbar::torrent-rasterbar)
target_compile_definitions(PlayOSTorrent PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX _WIN32_WINNT=0x0A00)
if(MSVC)
  target_compile_options(PlayOSTorrent PRIVATE /utf-8 /W3)
endif()
