<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-ascii-dark.png">
    <img src="docs/assets/logo-ascii-light.png" alt="PlayOS" width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/fakem1nk/PlayOS/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/fakem1nk/PlayOS/ci.yml?branch=main&style=for-the-badge&label=build&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNNSAxMi41bDQuNSA0LjVMMTkgNy41Ii8%2BPC9zdmc%2B" alt="Build"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><img src="https://img.shields.io/github/v/release/fakem1nk/PlayOS?style=for-the-badge&label=release&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNNCA5bDgtNSA4IDV2NmwtOCA1LTgtNXoiLz48cGF0aCBkPSJNNCA5bDggNSA4LTVNMTIgMTR2NiIvPjwvc3ZnPg%3D%3D" alt="Release"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases"><img src="https://img.shields.io/github/downloads/fakem1nk/PlayOS/total?style=for-the-badge&label=downloads&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTIgNHYxMU03LjUgMTAuNUwxMiAxNWw0LjUtNC41TTUgMjBoMTQiLz48L3N2Zz4%3D" alt="Downloads"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><img src="https://img.shields.io/badge/Windows-10%20%7C%2011-5EA1FF?style=for-the-badge&label=Windows&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSI0IiB5PSI1IiB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHJ4PSIyIi8%2BPHBhdGggZD0iTTkgMjBoNiIvPjxwYXRoIGQ9Ik0xMC41IDguOHY0LjRsMy44LTIuMnoiIGZpbGw9IiNmZmYiIHN0cm9rZT0ibm9uZSIvPjwvc3ZnPg%3D%3D" alt="Windows 10 | 11"></a>
</p>

<p align="center"><b>English</b> · <a href="README.ru.md">Русский</a></p>

**PlayOS** is an open-source game launcher built to turn a Windows PC into a console: one place for every game you own — PC, Steam, PlayStation&nbsp;2, PlayStation&nbsp;3 and VR — driven entirely by a controller, with an in-game menu, cloud saves and real trophies. The interface speaks English and Russian.

PlayOS is written in TypeScript (Electron, React, Node.js). It talks to Windows through koffi and to the DualSense over HID, plays PlayStation&nbsp;2 and PlayStation&nbsp;3 games through PCSX2 and RPCS3, and runs PC VR games on Meta&nbsp;Quest through OpenComposite.

<p align="center">
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><b>Download for Windows</b></a>
  &nbsp;·&nbsp;
  <a href="#features">Features</a>
  &nbsp;·&nbsp;
  <a href="#getting-started">Getting started</a>
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
      PC games, Steam, PlayStation&nbsp;2 through PCSX2, PlayStation&nbsp;3 through RPCS3 and VR games. Steam games, PS2 disc images and the RPCS3 game list are imported in one go; for any other game, pick its folder and PlayOS finds the EXE. Search from the controller, your own collections, sorting, and uninstalling games right from PlayOS.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/controller.svg" width="48" height="48" alt=""><br>
      <b>Made for a controller</b><br>
      DualSense, DualShock&nbsp;4, Xbox, 8BitDo, Nintendo and old DirectInput pads, with a button mapper for the unusual ones. Button hints follow the pad in your hands and what is selected. An on-screen keyboard, menu vibration and right-stick scrolling are built in, and the mouse and keyboard share one focus with the controller.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/overlay.svg" width="48" height="48" alt=""><br>
      <b>A menu over any game</b><br>
      The PS or Guide button, Select&nbsp;+&nbsp;Start or Ctrl&nbsp;+&nbsp;Alt&nbsp;+&nbsp;H pauses the game and opens quick saves with screenshots, session time, volume, audio output, brightness and controller battery. PCSX2 saves go straight to the right slot over PINE. The menu can be turned off for a single game.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/vr.svg" width="48" height="48" alt=""><br>
      <b>VR games</b><br>
      Mark any PC game as a VR game and play it on a Meta&nbsp;Quest over Link or Air&nbsp;Link. PlayOS downloads the VR component and prepares it before every launch, keeps sharpness, hands, vibration and a compatibility mode for each game, and shows the headset and controller battery in the top bar.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/cloud.svg" width="48" height="48" alt=""><br>
      <b>Cloud saves and sync</b><br>
      Saves, library, play time and profile on Yandex Disk, Google Drive or in a sync folder. PC saves are found through the Ludusavi database, up to 30 versions of each save are kept, and on a new PC everything comes back. Prefer a file? A single <code>.playos</code> backup moves it all.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/trophy.svg" width="48" height="48" alt=""><br>
      <b>Real trophies</b><br>
      RetroAchievements for PS2 and Steam achievements for PC, including games running through Steam emulators. A notification pops up the moment a trophy unlocks, and the trophy list keeps a screenshot of that moment. PlayOS walks you through getting every key.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/playtime.svg" width="48" height="48" alt=""><br>
      <b>Play time and history</b><br>
      Every session is counted, even through third-party launchers. The game page shows the session history, two weeks of activity and HowLongToBeat; the profile shows your most played games, recent trophies and PlayOS's own trophies.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/art.svg" width="48" height="48" alt=""><br>
      <b>A living home screen</b><br>
      Covers, backgrounds and logos come from Steam, SteamGridDB and Wikipedia on their own. The menu and the DualSense light bar take the color of the game, the background turns into a silent trailer, and a screensaver with a clock looks after OLED screens.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/tv.svg" width="48" height="48" alt=""><br>
      <b>Ready for the TV</b><br>
      Pick the display for PlayOS and for emulators, scale the interface for the couch, choose a dark, light or system theme. Start PlayOS with Windows, stream through Moonlight, or keep it in the tray and bring it back with the PS button.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/bell.svg" width="48" height="48" alt=""><br>
      <b>Stays out of the way</b><br>
      While you play, PlayOS unloads its interface and runs in Windows efficiency mode. Errors, trophies and updates wait in the Notification Center. Updates download in the background with a short list of changes in your language; beta versions are opt-in.
    </td>
  </tr>
</table>

## Getting started

1. Download `PlayOS-Setup-<version>.exe` from the [latest release](https://github.com/fakem1nk/PlayOS/releases/latest) and run it. If Windows SmartScreen stops it, click “More info” → “Run anyway” ([why](docs/FAQ.en.md#windows-says-windows-protected-your-pc)).
2. A short first setup asks for your name and language, connects the cloud, finds your games, points to the emulators and picks the display and volume. Any step can be skipped and changed later in Settings.
3. That's it: from now on PlayOS updates itself.

| To play | You need |
| --- | --- |
| PC and Steam games | Windows 10 or 11, 64-bit |
| PlayStation&nbsp;2 games | [PCSX2](https://pcsx2.net), your BIOS and disc images |
| PlayStation&nbsp;3 games | [RPCS3](https://rpcs3.net) and the PS3 firmware |
| VR games | Meta&nbsp;Quest and the Meta Horizon Link app |
| With the DualSense light bar | [DSX](https://store.steampowered.com/app/1812620/DSX/) |
| With trophies and art for almost any game | Free RetroAchievements, Steam Web API and SteamGridDB keys (optional) |

Controls, emulator settings and common problems are in the [F.A.Q](docs/FAQ.en.md).

## Contributors

<a href="https://github.com/fakem1nk/PlayOS/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=fakem1nk/PlayOS" alt="Contributors">
</a>

Want to help? Start with the [developer guide](docs/DEVELOPMENT.md). Ideas and bug reports are welcome in [Issues](https://github.com/fakem1nk/PlayOS/issues/new/choose).

## License

PlayOS is licensed under the [GPL-3.0](LICENSE) license.

<sub>PlayOS is an independent project and is not affiliated with Sony Interactive Entertainment, Valve, Microsoft or Meta. PlayStation, DualSense, Steam, Xbox and Meta&nbsp;Quest are trademarks of their respective owners. Game covers in the screenshot belong to their rights holders. Emulators, BIOS files and games are not included.</sub>
