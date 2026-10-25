# For developers

**English** · [Русский](DEVELOPMENT.ru.md) · [← README](../README.md)

PlayOS is an Electron app written in TypeScript. Everything that talks to the system lives in the main process: WinAPI through [koffi](https://koffi.dev), the DualSense over HID, and a small C# helper for volume and brightness. The interface is React 19 with [Motion](https://motion.dev).

## Getting started

You need Windows 10 or 11, [Node.js 24](https://nodejs.org) and Git.

```bash
git clone https://github.com/fakem1nk/PlayOS.git
cd PlayOS
npm install
npm run dev
```

`npm run dev` opens PlayOS with hot reload. To work on the interface without Windows-specific parts, `npm run web` serves it in a browser at `http://localhost:5199` with demo data.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm run web` | The interface in a browser with demo data |
| `npm run typecheck` | Type check the whole project |
| `npm run build` | Build into `out/` |
| `npm run dist:setup` | Build the installer into `release/` |
| `npm run build:helper` | Compile `native/SystemHelper.cs` into `resources/PlayOSHelper.exe` |

The web preview understands a few URL flags: `?lang=en`, `?theme=light`, `?welcome` (first-launch setup), `?update` (a fake update), and `#overlay` for the in-game menu.

## Cloud keys

Yandex Disk and Google Drive need OAuth client keys. They aren't in the repository: release builds get them from GitHub secrets. For local work, create a `.env` file in the project root:

```ini
MAIN_VITE_YANDEX_CLIENT_ID=...
MAIN_VITE_YANDEX_CLIENT_SECRET=...
MAIN_VITE_GOOGLE_CLIENT_ID=...
MAIN_VITE_GOOGLE_CLIENT_SECRET=...
```

Without it, only the sync folder provider is shown, and everything else works as usual. Register your own apps at [oauth.yandex.ru](https://oauth.yandex.ru) (Yandex Disk app folder access) and in the [Google Cloud console](https://console.cloud.google.com) (a “TVs and limited input devices” client with the `drive.file` scope).

## How it's built

```
src/
├── main/                 Electron process: everything that talks to the system
│   ├── index.ts          Windows, overlay, IPC, startup
│   ├── launcher.ts       Launching games, tracking play time by process
│   ├── store.ts          Library and settings (library.json)
│   ├── steam.ts          Finding installed Steam games
│   ├── pcsx2.ts, pine.ts PCSX2 config and save states over PINE
│   ├── achievements.ts   RetroAchievements and Steam achievements
│   ├── media.ts          Finding and downloading art
│   ├── details.ts        Descriptions, HowLongToBeat, trailers
│   ├── gamepad.ts, hid.ts, win32.ts   XInput, DualSense over HID, WinAPI
│   ├── dsx.ts            DualSense light bar through DSX
│   ├── system.ts         Volume, audio outputs, brightness
│   ├── cloud/            Cloud saves and sync (see below)
│   ├── updater.ts        Updates from GitHub releases
│   ├── backup.ts         .playos backup files
│   └── log.ts            Log and error report
├── preload/              The window.pcs bridge between the interface and the system
├── renderer/src/         React interface: one bundle, two windows
│   ├── App.tsx           Launcher window
│   ├── OverlayApp.tsx    In-game menu window (#overlay)
│   ├── components/       Screens and controls
│   └── lib/              Input, spatial navigation, sounds, themes, demo API
└── shared/               Types and translations
native/SystemHelper.cs    Windows helper for volume and brightness
scripts/                  Installer, release and build helpers
```

**Cloud sync** (`src/main/cloud/`). Every upload is an immutable snapshot; each PC writes only its own small head file, so two PCs never overwrite each other. Sync is a three-way comparison of the local state, the last synced state and the cloud. When both sides changed, the user chooses. Paths are stored with portable tokens (`%GAME%`, `%PCSX2%`, `%APPDATA%`…) so a save restores into the right place on another PC. PC save locations come from the [Ludusavi manifest](https://github.com/mtkennerly/ludusavi-manifest).

### Conventions

- **Sizes** are in `rem`, where `1rem` is 1/108 of the screen height. A layout drawn at 1920×1080 looks the same on a monitor and a 4K TV.
- **Navigation** is spatial: anything with `data-nav` is reachable by D-pad (`lib/nav.ts`). Every new screen must work with a controller alone.
- **Translations.** Strings are wrapped in `t('…')` with the Russian text as the key; English lives in `src/shared/i18n-en.ts`. Every new string needs an entry there. In the browser preview, `window.__i18nMissing()` lists what's missing.
- **No new dependencies** without a good reason. Sounds are synthesized in WebAudio, the QR code, ZIP and YAML readers are our own.
- **Comments and UI text** are in Russian, files use LF line endings.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep one topic per pull request.
3. Run `npm run typecheck` before pushing. CI runs it together with the build.
4. For interface changes, attach a screenshot or a short video, ideally in both themes.
5. Describe what changed and how you checked it.

By contributing you agree that your code is released under the [GPL-3.0](../LICENSE) license.

## Releases

Bump `version` in `package.json`, add notes to `scripts/notes/<version>.md`, then push a tag:

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions builds the installer and creates a draft release with the notes as its text. A maintainer reviews it and publishes. Installed copies pick up the update on their own.
