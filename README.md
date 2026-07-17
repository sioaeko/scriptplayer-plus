<p align="center">
  <img src="public/icon.png" width="128" height="128" alt="ScriptPlayer+ icon">
</p>

<h1 align="center">ScriptPlayer+</h1>

<p align="center">
  A cross-platform video and audio player built for <b>local funscript playback</b>, with
  <b>The Handy</b>, <b>FunOSR</b>, and <b>Intiface / Buttplug</b> device support,
  multi-axis tools, an organized media library, and experimental compatibility playback options.
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
- Offers a visual library workspace alongside the collapsible classic file panel
- Detects matching bundled funscripts, supports separate script folders, and can auto-pick unique fallback matches
- Shows a quick script variant panel when multiple matching script bundles are available
- Detects matching external subtitle files and lets you load subtitles manually
- Shows hover video preview inside the file list
- Sorts the library by path, file name, rating, duration, or last modified time
- Separates repeat-current-media, `Auto Next Play`, shuffle playback, and adjustable playback rate
- Supports drag and drop for opening media directly
- Searches audio metadata and work folders for matching cover art and subtitles
- Includes optional volume boost up to `150%` for quiet audio

### Script Visualization And Control

- Real-time scrolling timeline with selectable multi-axis tracks and configurable height
- Full-media heatmap with speed-based color visualization
- Quick `STR` stroke controls in the playback bar
- Range Extender controls with per-media stroke range storage and inverse stroke toggle
- Per-media script offset from `-60s` to `+60s`, with direct decimal-second entry and fine-step buttons
- Optional random fallback stroke generation for media without scripts
- Gap filling, delayed automatic skipping, and sparse-script controls
- Multi-axis bundles using `axes[]` or `channels{}` plus separate per-axis funscript files

### Devices And Script Sources

- `The Handy` API v2 sync with upload, setup, time offset handling, network diagnostics, and a compatibility mode for slower legacy hardware
- `Intiface / Buttplug` multi-axis mapping for linear, rotate, and scalar features
- `FunOSR` serial and Bluetooth COM profiles, adjustable update rate, axis mapping, reconnect handling, and motion smoothing
- Dedicated accessory pairing, automatic reconnect, key mapping, and direct flasher access
- Experimental external viewer launch support for `JAVPlayer`, `JAVPlayerEZ`, `mpv`, `PotPlayer`, `VLC`, and custom executables
- Experimental FFmpeg fallback playback for video that Electron cannot decode directly
- In-app `EroScripts` login, browsing, searching, and downloading
- Session persistence for EroScripts login on the local machine

## What's New In v0.3.0

- Reworked the application around a unified navigation layout and a visual library workspace, while keeping the classic file panel available and collapsible
- Expanded multi-axis parsing and visualization, including bundled `axes[]` / `channels{}` scripts, selectable simultaneous axis tracks, and adjustable timeline height
- Added Range Extender workflows, per-media output ranges, motion smoothing controls, and direct script-offset input up to `±60s`
- Improved Handy upload / HSSP recovery, added legacy Handy compatibility settings, and introduced Handy network latency diagnostics
- Improved FunOSR serial and Bluetooth COM behavior with device profiles, reconnect-safe output, pause / home options, and smoother motion presets
- Added experimental External Viewer Mode for JAVPlayer, JAVPlayerEZ, mpv, PotPlayer, VLC, and custom players
- Added an experimental FFmpeg compatibility engine for media that Chromium cannot decode directly
- Improved audio cover-art and subtitle discovery, added optional `150%` volume boost, and reduced heavy startup work
- Added dedicated accessory automatic reconnect and improved pairing / flasher access
- Added same-version hotfix detection, in-app hotfix notes, and installer handoff
- Fixed playlist script rematching and several script-folder indexing, gap-fill, black-frame warning, and media metadata regressions

## Download

| Platform | Package | Notes |
| --- | --- | --- |
| Windows x64 | [Latest release](https://github.com/sioaeko/scriptplayer-plus/releases/latest) | Installer and portable ZIP |
| macOS x64 / arm64 | [Latest release](https://github.com/sioaeko/scriptplayer-plus/releases/latest) | DMG and ZIP packages |
| Linux x64 | [Latest release](https://github.com/sioaeko/scriptplayer-plus/releases/latest) | AppImage, DEB, and archive packages when available |

## Supported Files

| Type | Formats |
| --- | --- |
| Media | `mp4`, `mkv`, `avi`, `webm`, `mov`, `wmv`, `mp3`, `wav`, `flac`, `m4a`, `aac`, `ogg`, `opus`, `wma` |
| Scripts | `.funscript`, `.json`, `.csv` |
| External subtitles | `.srt`, `.vtt`, `.txt` |

## Current Notes

- Embedded subtitle tracks inside video containers are not parsed yet. Use external subtitle files for now.
- External Viewer Mode launches every supported target, but transport control and synchronization depth vary by player.
- FFmpeg compatibility playback is experimental and requires a working FFmpeg executable to be installed or selected in settings.
- Device output currently uses one active provider at a time; simultaneous Handy + Intiface / FunOSR output is not supported yet.

## Source Availability

ScriptPlayer+ is currently distributed as signed or packaged desktop binaries under its EULA. The public repository is used for releases, update metadata, documentation, and issue tracking; the full application source is not publicly distributed.

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

## Acknowledgments

<p align="center">
  <img src="docs/funosr.png" width="160" alt="FunOSR logo">
</p>

<p align="center">
  FunOSR serial device hardware provided by <b>FunOSR</b> (manufacturer).<br>
  Thank you for supplying test equipment used during development.
</p>

## License

`ScriptPlayer+ End User License Agreement`

ScriptPlayer+ is proprietary software distributed under the terms in [`LICENSE`](LICENSE).
Commercial use, redistribution, modification, and reuse of project media require separate written permission from the copyright holder.
