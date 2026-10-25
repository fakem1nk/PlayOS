# FAQ and troubleshooting

**English** · [Русский](FAQ.md) · [← README](../README.md)

Common problems and what to do about them. Didn't find yours? [Open an issue](https://github.com/fakem1nk/PlayOS/issues/new/choose) and attach a report: Settings → System → “Save error report”.

- [Installation](#installation)
- [Games](#games)
- [Emulators](#emulators)
- [Controller and overlay](#controller-and-overlay)
- [Trophies](#trophies)
- [Controls](#controls)
- [Cloud saves](#cloud-saves)
- [Updates and data](#updates-and-data)

---

## Installation

### How do I install PlayOS

Download `PlayOS-Setup-<version>.exe` from the [releases page](https://github.com/fakem1nk/PlayOS/releases/latest) and run it. On first launch a short setup helps you pick the language, connect the cloud, add games and choose the display. After that PlayOS updates itself: a new version downloads in the background and installs when you quit.

You need Windows 10 or 11, 64-bit. For PS2 and PS3 games install PCSX2 and RPCS3; for the DualSense light bar, DSX. Everything else is optional.

### Windows says “Windows protected your PC”

That's the SmartScreen filter. It warns about every program without a paid code-signing certificate, and PlayOS doesn't have one yet. That doesn't make it a virus: the source code is open, and the installer is built from it automatically on GitHub.

Click **“More info”**, then **“Run anyway”**. The warning only appears during installation.

### My antivirus flags PlayOS

PlayOS watches game processes, catches the PS button over other windows and pauses games. Some antivirus programs find that suspicious. Add the PlayOS folder to the exclusions and [let us know](https://github.com/fakem1nk/PlayOS/issues/new/choose) which antivirus flagged it.

### How do I change the language

Settings → Profile → “Language · Язык”. The window reloads; your library and settings stay put. PlayOS starts in English; you can switch to Russian on the first step of the setup.

---

## Games

### A game won't start

1. **Is the file still there?** If the game was moved or uninstalled, open its options (△) → “Edit” and choose the file again.
2. **Is it a Steam game?** It launches through the Steam client, which must be installed and signed in.
3. **Does the game need administrator rights?** PlayOS runs without them, and Windows may refuse to start such a game. Tick “Run this program as an administrator” on the game's EXE (Properties → Compatibility), or run PlayOS as administrator.
4. **Is your antivirus in the way?** Check whether it blocked the launch.

PlayOS shows the error text in a notification — send it along with the report if nothing helps.

### Play time isn't tracked, or the session ends right away

This happens when the EXE you picked is a launcher: it starts the game and closes itself. Open the game's options → “Edit” → “Game process” and enter the name of the game's own process, for example `Game-Win64-Shipping.exe`. You can find it in Task Manager while the game is running.

### No cover was found

In the game editor, press “Find cover and background online” and try the English title without a subtitle. For games without a PC version, SteamGridDB works best — add a free key in Settings → Library.

### The game description is in another language

PlayOS takes the description from Steam in the interface language, or from Wikipedia if Steam has none. Older games may not be translated on Steam. Descriptions reload after you change the language.

---

## Emulators

### “PCSX2 emulator not found” or “RPCS3 emulator not found”

Set the path in Settings → Emulators: `pcsx2-qt.exe` for PS2, `rpcs3.exe` for PS3. PlayOS only launches emulators; they aren't included. Download them from [pcsx2.net](https://pcsx2.net) and [rpcs3.net](https://rpcs3.net).

### “PCSX2 data folder not found”

PCSX2 creates it on first launch. Run PCSX2 once yourself, close it, and save states will work.

### PS2 save states don't work

Turn on **PINE** in Settings → Emulators: the overlay then saves to the right slot without switching windows. PCSX2 must be closed while you do this — it overwrites its settings when it quits.

### A PS3 game opens in the RPCS3 window

Add `--no-gui` to the RPCS3 arguments (Settings → Emulators). RPCS3 save states must be enabled in the emulator itself.

---

## Controller and overlay

### The PS button doesn't open the in-game menu

- **Steam or Xbox Game Bar grabs the button.** In Steam: Settings → Controller → turn off the Guide button for Steam. In Windows: Settings → Gaming → Xbox Game Bar → turn off opening it with the controller button.
- **The controller is in DirectInput mode.** PlayOS catches the PS button, Guide and holding Select + Start over a game on Xbox-compatible controllers (XInput), DualSense and DualShock 4. For others, press **Ctrl + Alt + H**, or switch the controller to XInput mode if it has one.

### Buttons are mixed up or the controller doesn't respond

Older USB gamepads and 8BitDo in DirectInput mode report buttons in their own order. Open Settings → Controller → **“Map controller buttons”** and press the buttons as prompted — it takes a minute. The stick and D-pad work even without it.

If your 8BitDo has a mode switch, the **X** (XInput) mode is easier — then nothing needs mapping.

### The button icons are wrong

Settings → Controller → “Button icons”. In “Auto” mode PlayOS shows the icons of the connected controller, or keys if you're using the keyboard.

### The DualSense light bar doesn't work

The light bar is driven by [DSX](https://store.steampowered.com/app/1812620/DSX/):

1. Start DSX and make sure it sees the controller.
2. Turn on the UDP server (port 6969) in the DSX mod settings.
3. In PlayOS: Settings → Controller → “Test light bar”. The bar should flash red, green, blue and white.

If the test says “DSX isn't answering”, DSX isn't running or UDP is off. If it “doesn't see a controller”, reconnect the DualSense.

---

## Trophies

### PS2 trophies don't show up

You need your RetroAchievements user name and **Web API Key**: retroachievements.org → Settings → Keys. Enter them in Settings → Trophies and press “Test connection”. If the image is modified, RetroAchievements may not recognize it — pick the game manually in the trophy list.

### Steam achievements don't show up

You need a Steam Web API key ([steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey), free) and your profile. In your Steam privacy settings, make “Game details” public — otherwise Steam doesn't return achievements.

Steam only returns achievements for games on your account. For a game that isn't on it, PlayOS reads unlocked achievements from the files of the Steam emulator next to the game (RUNE, CODEX, Goldberg, EMPRESS, OnlineFix and others) and takes names and icons from Steam. Without a Web API key you'll see the internal achievement names instead.

### PS3 trophies

Not available yet: RetroAchievements doesn't support PS3.

---

## Controls

| | PlayStation | Xbox | Nintendo, 8BitDo | Keyboard |
| --- | :---: | :---: | :---: | :---: |
| Play, select | ✕ | A | B | Enter |
| Back | ○ | B | A | Esc |
| Game options | △ | Y | X | M |
| Add game | ▢ | X | Y | F |
| Tabs | L1 / R1 | LB / RB | L / R | Q / E |
| Library filters | L2 / R2 | LT / RT | ZL / ZR | Z / C |
| In-game menu | PS | Guide | — | Ctrl + Alt + H |

Buttons mixed up? Settings → Controller → “Map controller buttons”.

---

## Cloud saves

### How do I turn on cloud saves

Settings → Cloud. Choose Yandex Disk or Google Drive, scan the QR code with your phone and enter the code shown on screen, or pick a sync folder (OneDrive, Dropbox, Syncthing). Then choose what to sync: profile, library, saves.

When you sign in on a new PC or after a reinstall, PlayOS offers to bring back your profile, library and play time from the cloud, and you choose what to restore.

### Which games are synced

PS2 memory cards, PS3 saves and PC games. Saves of PC games are found through the Ludusavi database and the game's Steam AppID. Games launched through Steam are skipped: Steam Cloud already keeps them.

### The saves of my game aren't found

Game options → “Edit” → “Save folder” → “Choose”, and point it at the folder where the game keeps its saves. The same screen turns cloud saves off for a single game.

### PlayOS asks which save to keep

The save changed on two PCs since the last sync. PlayOS shows both versions with their date and PC, and you pick one. The other one isn't lost: older versions are listed on the game page under the cloud status. The number of versions kept is set in Settings → Cloud, from 1 to 30.

### Where are the files in the cloud

On Yandex Disk in “Applications/PlayOS”, on Google Drive in the “PlayOS” folder, in a sync folder in its “PlayOS” subfolder. Covers aren't uploaded: PlayOS downloads them again on the new PC.

---

## Updates and data

### Updates don't arrive

Stable versions arrive on their own. Early test versions only arrive if Settings → System → **“Join the beta”** is on. To check by hand: Settings → System → “Check for updates”.

### Where is my data

In `%APPDATA%\PlayOS`: library, settings, trophies, art and the log. Open it from Settings → System → “Data folder”. It stays when you uninstall PlayOS.

### How do I move everything to another PC

Settings → System → “Back up your data” — a `.playos` file appears on your desktop. On the new PC, install PlayOS and choose “Restore from backup”. The file contains your API keys, so don't share it publicly.

### PlayOS doesn't start at all

The log is at `%APPDATA%\PlayOS\logs\playos.log`. Attach it to an [issue on GitHub](https://github.com/fakem1nk/PlayOS/issues/new/choose).
