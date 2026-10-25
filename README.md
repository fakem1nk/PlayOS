<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="PlayOS" width="420">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/fakem1nk/PlayOS/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/fakem1nk/PlayOS/ci.yml?branch=main&style=for-the-badge&label=build&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNNSAxMi41bDQuNSA0LjVMMTkgNy41Ii8%2BPC9zdmc%2B" alt="Build"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><img src="https://img.shields.io/github/v/release/fakem1nk/PlayOS?style=for-the-badge&label=release&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNNCA5bDgtNSA4IDV2NmwtOCA1LTgtNXoiLz48cGF0aCBkPSJNNCA5bDggNSA4LTVNMTIgMTR2NiIvPjwvc3ZnPg%3D%3D" alt="Release"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases"><img src="https://img.shields.io/github/downloads/fakem1nk/PlayOS/total?style=for-the-badge&label=downloads&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTIgNHYxMU03LjUgMTAuNUwxMiAxNWw0LjUtNC41TTUgMjBoMTQiLz48L3N2Zz4%3D" alt="Downloads"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><img src="https://img.shields.io/badge/Windows-10%20%7C%2011-5EA1FF?style=for-the-badge&label=Windows&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSI0IiB5PSI1IiB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHJ4PSIyIi8%2BPHBhdGggZD0iTTkgMjBoNiIvPjxwYXRoIGQ9Ik0xMC41IDguOHY0LjRsMy44LTIuMnoiIGZpbGw9IiNmZmYiIHN0cm9rZT0ibm9uZSIvPjwvc3ZnPg%3D%3D" alt="Windows 10 | 11"></a>
</p>

<p align="center"><b>English</b> · <a href="README.ru.md">Русский</a></p>

**PlayOS** is an open-source game launcher built to turn a Windows PC into a console: one place for every game you own, driven entirely by a controller. PlayOS is written in TypeScript (Electron, React, Node.js); it talks to Windows through koffi and to the DualSense over HID, and plays PlayStation&nbsp;2 and PlayStation&nbsp;3 games through PCSX2 and RPCS3.

<p align="center">
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><b>Download for Windows</b></a>
  &nbsp;·&nbsp;
  <a href="#features">Features</a>
  &nbsp;·&nbsp;
  <a href="docs/FAQ.en.md">F.A.Q</a>
  &nbsp;·&nbsp;
  <a href="docs/BUG_REPORT.md">Bug Report</a>
  &nbsp;·&nbsp;
  <a href="docs/DEVELOPMENT.md">For developers</a>
</p>

<p align="center">
  <img src="docs/assets/preview.jpg" alt="PlayOS home screen" width="100%">
</p>

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/library.svg" width="48" height="48" alt=""><br>
      <b>One library for everything</b><br>
      PC games, Steam, PlayStation&nbsp;2 through PCSX2 and PlayStation&nbsp;3 through RPCS3. Steam games and disc images are found and recognized on their own.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/controller.svg" width="48" height="48" alt=""><br>
      <b>Made for a controller</b><br>
      DualSense, DualShock&nbsp;4, Xbox, 8BitDo, Nintendo and old DirectInput pads. Button hints follow the pad in your hands, and a keyboard works too.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/overlay.svg" width="48" height="48" alt=""><br>
      <b>A menu over any game</b><br>
      The PS or Guide button pauses the game and opens save states with screenshots, volume, audio output, brightness and battery.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/cloud.svg" width="48" height="48" alt=""><br>
      <b>Cloud saves and sync</b><br>
      Saves, library, play time and profile on Yandex Disk, Google Drive or a sync folder. Up to 30 versions of each save are kept, and a fresh install brings everything back.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/trophy.svg" width="48" height="48" alt=""><br>
      <b>Real trophies</b><br>
      RetroAchievements for PS2 and Steam achievements for PC, with notifications right over the game.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/playtime.svg" width="48" height="48" alt=""><br>
      <b>Play time and history</b><br>
      Every session is counted, even through third-party launchers. HowLongToBeat shows how far through the game you are.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/art.svg" width="48" height="48" alt=""><br>
      <b>A living home screen</b><br>
      Covers, backgrounds and logos download on their own. The menu and the DualSense light bar take the color of the game, and the background turns into a trailer.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/tv.svg" width="48" height="48" alt=""><br>
      <b>Ready for the TV</b><br>
      Pick the display for PlayOS and for emulators, scale the interface for the couch, switch between dark and light themes, stream through Moonlight.
    </td>
  </tr>
</table>

## Contributors

<a href="https://github.com/fakem1nk/PlayOS/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=fakem1nk/PlayOS" alt="Contributors">
</a>

Want to help? Start with the [developer guide](docs/DEVELOPMENT.md). Ideas and bug reports are welcome in [Issues](https://github.com/fakem1nk/PlayOS/issues/new/choose).

## License

PlayOS is licensed under the [GPL-3.0](LICENSE) license.

<sub>PlayOS is an independent project and is not affiliated with Sony Interactive Entertainment, Valve or Microsoft. PlayStation, DualSense, Steam and Xbox are trademarks of their respective owners. Game covers in the screenshot belong to their rights holders. Emulators, BIOS files and games are not included.</sub>
