<p align="center">
  <img src="public/icon.png" width="128" height="128" alt="ScriptPlayer+ icon">
</p>

<h1 align="center">ScriptPlayer+</h1>

<p align="center">
  A modern desktop player for <b>local funscript playback</b>, with a cleaner playback UI,
  <b>The Handy</b> sync, <b>Intiface / Buttplug</b> multi-axis routing, <b>FunOSR serial</b> support,
  in-app <b>EroScripts</b> browsing, and a media library that is actually pleasant to use.
</p>

<p align="center">
  <a href="https://github.com/sioaeko/scriptplayer-plus/releases/latest">
    <img alt="Latest Release" src="https://img.shields.io/github/v/release/sioaeko/scriptplayer-plus?display_name=tag&label=Latest%20Release">
  </a>
  <a href="https://github.com/sioaeko/scriptplayer-plus/releases/latest">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/sioaeko/scriptplayer-plus/total?label=Downloads">
  </a>
  <img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-1f2937">
  <img alt="License" src="https://img.shields.io/badge/License-EULA-111827">
</p>

<p align="center">
  <a href="https://github.com/sioaeko/scriptplayer-plus/releases/latest"><b>Download Latest Release</b></a>
  ·
  <a href="docs/readme-media/overview-demo.mp4"><b>Watch Overview Demo</b></a>
  ·
  <a href="docs/README_KO.md">한국어</a>
  ·
  <a href="docs/README_JA.md">日本語</a>
  ·
  <a href="docs/README_ZH.md">中文</a>
</p>

---

<p align="center">
  <a href="docs/readme-media/overview-demo.mp4">
    <img src="docs/readme-media/overview-demo-hq.gif" alt="ScriptPlayer+ overview demo" width="100%">
  </a>
</p>

<p align="center">
  Click the hero image or the demo cards below to open the short product videos.
</p>

## Why ScriptPlayer+

ScriptPlayer+ is for people who already have local media and scripts and want a player that feels current.
The focus is straightforward: clean playback, clean device control, and an efficient library workflow that does not waste time.

<table>
  <tr>
    <td width="33%">
      <b>Playback-first UI</b><br>
      Fullscreen playback, timeline and heatmap overlays, subtitle support, audio artwork mode, and quick stroke controls without burying everything in menus.
    </td>
    <td width="33%">
      <b>Device support that scales</b><br>
      Use The Handy, Intiface / Buttplug devices, or direct FunOSR serial output from the same app, with per-device routing and multi-axis support.
    </td>
    <td width="33%">
      <b>Library workflow that wastes less time</b><br>
      Folder browsing, script and subtitle detection, hover video preview, sorting, EroScripts search, and manual override tools are all built in.
    </td>
  </tr>
</table>

## Product Tour

<table>
  <tr>
    <td width="33%">
      <a href="docs/readme-media/overview-demo.mp4">
        <img src="docs/readme-media/overview-demo.gif" alt="Overview demo" width="100%">
      </a>
    </td>
    <td width="33%">
      <a href="docs/readme-media/video-preview-demo.mp4">
        <img src="docs/readme-media/video-preview-demo.gif" alt="Video preview demo" width="100%">
      </a>
    </td>
    <td width="33%">
      <a href="docs/readme-media/random-stroke-demo.mp4">
        <img src="docs/readme-media/random-stroke-demo.gif" alt="Random stroke demo" width="100%">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center">
      <b>Overview Demo</b><br>
      Open the main player walkthrough and see the current playback surface, layout, and device flow.
    </td>
    <td align="center">
      <b>Video Preview Demo</b><br>
      See how file-list hover preview works without leaving the browser or opening the file first.
    </td>
    <td align="center">
      <b>Random Stroke Demo</b><br>
      Check the fallback stroke generation workflow for media that does not ship with a script.
    </td>
  </tr>
</table>

## Feature Preview

<table>
  <tr>
    <td width="50%">
      <img src="docs/readme-media/script-variant-panel.png" alt="Script variants panel" width="100%">
    </td>
    <td width="50%">
      <a href="docs/readme-media/pattern-preset-demo.mp4">
        <img src="docs/readme-media/pattern-preset-demo.png" alt="Pattern preset demo" width="100%">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center">
      <b>Script Variants Panel</b><br>
      When a title has multiple matching script bundles, switch between the default script and alternates like <code>Soft</code> directly from the sidebar.
    </td>
    <td align="center">
      <b>Pattern Preset Demo</b><br>
      The refreshed random fallback presets now separate the base tease motion from the stronger tease preset, and the new short clip shows that flow.
    </td>
  </tr>
</table>

## Inside The App

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/device_settings_v014.png" alt="Device settings" width="100%">
    </td>
    <td width="50%">
      <img src="docs/readme-media/keyboard-shortcuts-v018.png" alt="Keyboard shortcuts" width="100%">
    </td>
  </tr>
  <tr>
    <td align="center">
      <b>Device routing and mapping</b><br>
      Configure Handy, Buttplug, and serial behavior in one place instead of splitting setup across multiple tools.
    </td>
    <td align="center">
      <b>Keyboard-first control</b><br>
      Playback, seeking, fullscreen, and navigation are all available from configurable shortcuts.
    </td>
  </tr>
</table>

## Highlights

### Playback And Library

- Plays local video files: `MP4`, `MKV`, `AVI`, `WebM`, `MOV`, `WMV`
- Plays local audio files: `MP3`, `WAV`, `FLAC`, `M4A`, `AAC`, `OGG`, `OPUS`, `WMA`
- Detects matching bundled funscripts, supports separate script folders, and can auto-pick unique fallback matches
- Shows a quick script variant panel when multiple matching script bundles are available
- Detects matching external subtitle files and lets you load subtitles manually
- Shows hover video preview inside the file list
- Sorts the library by path, file name, or last modified time
- Separates repeat-current-media, `Auto Next Play`, shuffle playback, and adjustable playback rate
- Supports drag and drop for opening media directly
- Automatically picks matching cover art for audio playback when available

### Script Visualization And Control

- Real-time scrolling timeline with configurable window size and height
- Full-media heatmap with speed-based color visualization
- Quick `STR` stroke controls in the playback bar
- Stroke range min / max controls and inverse stroke toggle
- Optional random fallback stroke generation for media without scripts
- Automatic skipping for long empty script gaps in sparse scripts
- Multi-axis funscript bundle loading and routing

### Devices And Script Sources

- `The Handy` sync with upload, setup, and time offset handling
- `Intiface / Buttplug` multi-axis mapping for linear, rotate, and scalar features
- `FunOSR` serial / COM output with adjustable update rate
- In-app `EroScripts` login, browsing, searching, and downloading
- Session persistence for EroScripts login on the local machine

## What's New In v0.2.0

- Added stronger script matching with recursive script-folder scanning, script variants, drag-and-drop script matching, and a manual match dialog
- Added per-script / per-media offset controls with configurable keyboard shortcuts
- Added device output smoothing through Motion Speed Limit presets
- Added script debug tools, including current script path, source, axes, offset, copy path, reveal in Explorer, and reload actions
- Added script-folder rescan, Always on Top, folder collapse persistence, and improved same-media script variant handling

## Download

| Platform | Package | Notes |
| --- | --- | --- |
| Windows x64 | [Latest release](https://github.com/sioaeko/scriptplayer-plus/releases/latest) | Portable build, extract and run `ScriptPlayerPlus.exe` |
| macOS x64 / arm64 | [Latest release](https://github.com/sioaeko/scriptplayer-plus/releases/latest) | ZIP package, move `ScriptPlayerPlus.app` to Applications |
| Linux x64 | [Latest release](https://github.com/sioaeko/scriptplayer-plus/releases/latest) | `AppImage` build is published with each tagged release |

## Supported Files

| Type | Formats |
| --- | --- |
| Media | `mp4`, `mkv`, `avi`, `webm`, `mov`, `wmv`, `mp3`, `wav`, `flac`, `m4a`, `aac`, `ogg`, `opus`, `wma` |
| Scripts | `.funscript`, `.json`, `.csv` |
| External subtitles | `.srt`, `.vtt`, `.txt` |

## Current Notes

- Embedded subtitle tracks inside video containers are not parsed yet. Use external subtitle files for now.
- Linux release output currently targets `x64 AppImage`.
- The Japanese and Chinese READMEs under [`docs/`](docs) have not been refreshed to the same level as this main README yet.

## Build From Source

Use Node.js `20.x`. The project pins `20.20.2` in [`.nvmrc`](.nvmrc).

```bash
git clone https://github.com/sioaeko/scriptplayer-plus.git
cd scriptplayer-plus
npm install
```

Run the app in development:

```bash
npm run electron:dev
```

Build for Windows:

```bash
npm run build:win
```

Build for macOS:

```bash
npm run build:mac
```

Build for Linux:

```bash
npm run build:linux
```

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / Pause |
| `Left` / `Right` | Seek `-5s / +5s` |
| `Shift + Left / Right` | Seek `-10s / +10s` |
| `Up` / `Down` | Volume `+5% / -5%` |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
| `Ctrl + ,` | Open settings |

## Tech Stack

- Electron
- React
- TypeScript
- Tailwind CSS
- Vite

## License

`ScriptPlayer+ End User License Agreement`

ScriptPlayer+ is proprietary software distributed under the terms in [`LICENSE`](LICENSE).
Commercial use, redistribution, modification, and reuse of project media require separate written permission from the copyright holder.
