# How to report a bug

**English** · [Русский](BUG_REPORT.ru.md) · [← README](../README.md)

A good report gets a bug fixed in one pass. A vague one turns into a week of questions. This page shows what to collect and how to write it up so the problem can be reproduced on another PC.

## Before you report

1. **Update PlayOS.** Settings → System → “Check for updates”. The bug may already be fixed.
2. **Check the [FAQ](FAQ.en.md).** It covers the common cases: a game won't start, the emulator isn't found, the PS button doesn't open the menu, the light bar doesn't work, cloud saves aren't found.
3. **Search the [open issues](https://github.com/fakem1nk/PlayOS/issues).** If your bug is already there, add your details to it instead of opening a new one. A 👍 on the first post helps us see how many people are affected.

## What to collect

- **PlayOS version.** Settings → System → “System info”.
- **Error report.** Settings → System → “Save error report”. A `PlayOS-report-….txt` file with the log and system info is saved to the `reports` folder in PlayOS data (`%APPDATA%\PlayOS\reports`), and the folder opens on its own. It doesn't contain API keys or cloud tokens.
- **If PlayOS doesn't start at all**, attach the log instead: `%APPDATA%\PlayOS\logs\playos.log`.
- **A screenshot or a short video**, if the problem is visual or hard to describe.

## How to write it

Open a [new bug report](https://github.com/fakem1nk/PlayOS/issues/new?template=bug_report.yml) and fill in the form.

- **Title.** What breaks and where, in a few words: “PS2 game freezes after closing the in-game menu”, not “Bug” or “Doesn't work”.
- **Steps to reproduce.** Numbered, starting from launching PlayOS. Anyone should be able to follow them and see the same thing.
- **Expected and actual result.** What you thought would happen and what happened instead.
- **One problem per report.** Two bugs in one issue get fixed slower than two issues.

### Details that matter

| Area | Add this |
| --- | --- |
| PS2 games | PCSX2 version, the game and its serial (e.g. SLUS-20946) |
| PS3 games | RPCS3 version, the game and its ID (e.g. BCUS98114) |
| PC games | Where the game comes from (Steam, another launcher, a standalone EXE) |
| Controller | Model, connection (USB, Bluetooth) and whether DSX or Steam Input is running |
| In-game overlay | Whether the game runs fullscreen or windowed |
| Cloud saves | Provider (Yandex Disk, Google Drive, folder), how many PCs, the status shown on the game page |
| Display | Resolution, scaling, number of monitors, TV or monitor |

## Example

> **Title:** Save conflict dialog appears on every launch of God of War II
>
> **Version:** 1.0.0 · **Area:** Cloud saves · **Provider:** Google Drive, two PCs
>
> **Steps:**
> 1. Play God of War II (PS2) on PC A, save, quit.
> 2. Wait for “Synced” on the game page.
> 3. Launch the same game on PC B.
>
> **Expected:** PC B downloads the save from PC A.
> **Actual:** PlayOS asks which save to keep, and asks again on every next launch, even after choosing.
>
> Attached: `PlayOS-report-2026-10-25.txt` from both PCs.

## What not to include

- **API keys, passwords, tokens.** The error report leaves them out. Don't paste them by hand.
- **The `.playos` backup file.** It contains your API keys.
- **Links to game images or BIOS files.** Issues with them will be closed.

## Ideas, not bugs

Feature requests have their own [template](https://github.com/fakem1nk/PlayOS/issues/new?template=feature_request.yml). Please keep the discussion respectful: see the [code of conduct](../CODE_OF_CONDUCT.md).
