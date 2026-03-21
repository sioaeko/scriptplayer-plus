<p align="center">
  <img src="public/icon.png" width="128" height="128" alt="ScriptPlayer+ Icon">
</p>

<h1 align="center">ScriptPlayer+</h1>

<p align="center">
  A modern funscript video player with <b>The Handy</b> integration, experimental <b>Intiface / Buttplug / Direct Serial</b> support, <b>EroScripts</b> browser login, and multi-language support.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="docs/README_KO.md">한국어</a> · <a href="docs/README_JA.md">日本語</a> · <a href="docs/README_ZH.md">中文</a>
</p>

---

## Screenshots

| v0.1.4 Preview | Device Settings |
|:-:|:-:|
| ![v0.1.4 Preview](docs/screenshots/preview_v014.png) | ![Device Settings](docs/screenshots/device_settings_v014.png) |

| Audio Playback + Heatmap | Audio Playback |
|:-:|:-:|
| ![Audio Playback + Heatmap](docs/screenshots/VOICE_HM_TL.png) | ![Audio Playback](docs/screenshots/VOICE_ASMR.png) |

| Timeline Settings | Windows Playback |
|:-:|:-:|
| ![Timeline Settings](docs/screenshots/Timeline_setting.png) | ![Windows Playback](docs/screenshots/playing_mode1.png) |

| Heatmap & Timeline | EroScripts Search |
|:-:|:-:|
| ![Heatmap](docs/screenshots/heatmap.png) | ![Scripts](docs/screenshots/scripts_search.png) |

| Settings | macOS |
|:-:|:-:|
| ![Settings](docs/screenshots/setting.png) | ![macOS](docs/screenshots/macos.png) |

## Experimental v0.1.5-exp.4

The `v0.1.5-exp.4` prerelease focuses on TCode-compatible multi-axis devices with `Direct Serial (COM)` support, one-line `L0/L1/L2/R0/R1/R2` output, smoother timeline and heatmap playback updates, and improved Handy re-sync after timeline seeks.

| Experimental v0.1.5 Preview |
|:-:|
| ![Experimental v0.1.5 Preview](docs/screenshots/preview_v015_exp1.png) |

- Download the prerelease: [ScriptPlayer+ v0.1.5-exp.4](https://github.com/sioaeko/scriptplayer-plus/releases/tag/v0.1.5-exp.4)

## What's New In v0.1.4

- **Continuous Playback + Shuffle** — Move through the current folder automatically or pick a random next file when playback ends
- **Playback Speed Control** — Switch between `0.5x` and `2.0x` directly in the player while keeping Handy timing aligned
- **Real Handy Stroke Range Support** — Handy stroke min/max settings now transform the uploaded script instead of only changing the UI
- **Inverse Stroke Mode** — Flip funscript positions before upload for alternate mounting or reversed motion setups

## Features

- **Video + Audio Player** — Play local video files (MP4, MKV, AVI, WebM, MOV, WMV) and audio files (MP3, WAV, FLAC, M4A, AAC, OGG, OPUS, WMA)
- **Artwork Detection For Audio** — Automatically picks matching cover art from the media folder when available
- **Playback Modes** — Continuous playback, shuffle playback, and adjustable playback speed controls
- **Funscript Support** — Automatically loads matching `.funscript` files alongside local media
- **Timeline Visualization** — Real-time scrolling timeline showing script action points with speed-based colors
- **Heatmap** — Full-media intensity heatmap (green → yellow → orange → red → purple)
- **Configurable Default View** — Timeline and heatmap can be enabled or disabled by default from Settings
- **The Handy Integration** — Connect and sync The Handy device via HSSP protocol
  - Auto-connect & connection history
  - Script auto-upload to Handy servers
  - Time offset adjustment
  - Stroke range customization
  - Inverse stroke toggle
- **EroScripts Integration** — Search and download funscripts directly from EroScripts via in-app browser login (no API key needed)
  - Session-based login persisted locally
  - Direct download into the configured script storage folder
- **Multi-Language** — English, 한국어, 日本語, 中文
- **Drag & Drop** — Drop video or audio files directly into the player
- **Folder Browser** — Browse folders with subfolder grouping and script detection (green checkmark)
- **Keyboard Shortcuts** — Space, Arrow keys, F (fullscreen), M (mute), and more
- **Cross-Platform** — Windows (standalone) and macOS (via GitHub Actions)

## Installation

### Windows

1. Download the latest `ScriptPlayerPlus-0.1.4-Windows-x64.zip` from [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)
2. Extract and run `ScriptPlayerPlus.exe` — no installation required
3. For the experimental Direct Serial / Intiface build, download `ScriptPlayerPlus-0.1.5-exp.4-Windows-x64.zip` from [the v0.1.5-exp.4 prerelease](https://github.com/sioaeko/scriptplayer-plus/releases/tag/v0.1.5-exp.4)

### macOS

1. Download `ScriptPlayerPlus-1.0.0-MacOS-Universal.zip` from [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)
2. Extract and move `ScriptPlayerPlus.app` to Applications

### Build from Source

```bash
git clone https://github.com/sioaeko/scriptplayer-plus.git
cd scriptplayer-plus
npm install
```

**Development:**
```bash
npm run electron:dev
```

**Build Windows:**
```bash
npm run build:win
```

**Build macOS** (requires macOS):
```bash
npm run build:mac
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `←` / `→` | Seek ±5s |
| `Shift + ←/→` | Seek ±10s |
| `↑` / `↓` | Volume ±5% |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
| `Ctrl + ,` | Open settings |

## Tech Stack

- **Electron** — Desktop application framework
- **React** + **TypeScript** — UI components
- **Tailwind CSS** — Styling
- **Vite** — Build tool
- **Handy API v2** — Device communication
- **Discourse API** — EroScripts integration

## License

PolyForm-Noncommercial-1.0.0

This project is distributed as source-available software for noncommercial use only.
Commercial use requires separate permission from the copyright holder.

---

<p align="center">
  Built with Electron, React, and Tailwind CSS
</p>
