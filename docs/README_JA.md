<p align="center">
  <img src="../public/icon.png" width="128" height="128" alt="ScriptPlayer+ アイコン">
</p>

<h1 align="center">ScriptPlayer+</h1>

<p align="center">
  <b>The Handy</b>連携、<b>Intiface / Buttplug / FunOSR</b> のマルチアクシス対応、<b>EroScripts</b>ブラウザログイン、多言語対応のモダンなファンスクリプトビデオプレーヤー
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README_KO.md">한국어</a> · <a href="README_JA.md">日本語</a> · <a href="README_ZH.md">中文</a>
</p>

---

## スクリーンショット

| v0.1.4 プレビュー | デバイス設定 |
|:-:|:-:|
| ![v0.1.4 プレビュー](screenshots/preview_v014.png) | ![デバイス設定](screenshots/device_settings_v014.png) |

| オーディオ再生 + ヒートマップ | オーディオ再生 |
|:-:|:-:|
| ![オーディオ再生 + ヒートマップ](screenshots/VOICE_HM_TL.png) | ![オーディオ再生](screenshots/VOICE_ASMR.png) |

| タイムライン設定 | Windows再生 |
|:-:|:-:|
| ![タイムライン設定](screenshots/Timeline_setting.png) | ![Windows](screenshots/playing_mode1.png) |

| ヒートマップ＆タイムライン | EroScripts検索 |
|:-:|:-:|
| ![ヒートマップ](screenshots/heatmap.png) | ![スクリプト](screenshots/scripts_search.png) |

| 設定 | macOS |
|:-:|:-:|
| ![設定](screenshots/setting.png) | ![macOS](screenshots/macos.png) |

## v0.1.6 の新機能

`v0.1.6` では再生バーから直接調整できる `STR` ストローク範囲コントロール、空白の長いスクリプト区間の自動スキップ、より安定したメディア長の認識、より滑らかな seek / スクラブ動作、そして大きなフォルダのスキャンとディレクトリ走査の安定化を追加しました。

| v0.1.6 プレビュー |
|:-:|
| ![v0.1.6 プレビュー](screenshots/preview_v015_exp1.png) |

- 正式リリースのダウンロード: [ScriptPlayer+ v0.1.6](https://github.com/sioaeko/scriptplayer-plus/releases/tag/v0.1.6)

## 主な機能

- **ビデオ + オーディオプレーヤー** — ローカル動画ファイル（MP4、MKV、AVI、WebM、MOV、WMV）と音声ファイル（MP3、WAV、FLAC、M4A、AAC、OGG、OPUS、WMA）を再生
- **オーディオのアートワーク検出** — 同じフォルダ内のカバー画像を自動で見つけて表示します
- **再生モード** — 連続再生、シャッフル再生、再生速度変更をプレーヤーから直接使えます
- **ファンスクリプト対応** — メディアと同名の `.funscript` ファイルを自動読み込み
- **タイムライン表示** — スクリプトのアクションポイントを速度別の色でリアルタイム表示
- **ヒートマップ** — メディア全体の強度を色で可視化（緑→黄→オレンジ→赤→紫）
- **初期表示の切り替え** — 設定からタイムラインとヒートマップの初期表示を個別にオン / オフできます
- **The Handy連携** — HSSPプロトコルでThe Handyデバイスと同期
  - 自動接続＆接続履歴
  - スクリプト自動アップロード
  - 時間オフセット調整
  - ストローク範囲のカスタマイズ
  - ストローク反転トグル
- **Intiface / Buttplug マルチアクシス対応** — 対応デバイスを接続し、機能ごとの軸マッピングと raw TCode 転送を利用できます
- **FunOSR (COM) 対応** — 互換デバイスへ 1 行 TCode を調整可能な更新レートで直接送信します
- **EroScripts連携** — アプリ内ブラウザログインでファンスクリプトの検索・ダウンロード（APIキー不要）
  - ログインセッションをローカル保持
  - 設定したスクリプト保存フォルダへ直接ダウンロード
- **多言語対応** — English、한국어、日本語、中文
- **ドラッグ＆ドロップ** — 動画または音声ファイルを直接プレーヤーにドロップ
- **フォルダブラウザ** — サブフォルダグループ化とスクリプト検出（緑チェックマーク）
- **キーボードショートカット** — Space、矢印キー、F（フルスクリーン）、M（ミュート）など
- **クロスプラットフォーム** — Windows（スタンドアロン）およびmacOS（GitHub Actions経由）

## インストール

### Windows

1. [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)から最新の Windows x64 ビルドをダウンロード
2. 解凍して`ScriptPlayerPlus.exe`を実行 — インストール不要
3. メインの `v0.1.5` ビルドに The Handy、Intiface / Buttplug、公式 FunOSR サポートを同梱しています

### macOS

1. [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)から最新の macOS ビルドをダウンロード
2. 解凍して`ScriptPlayerPlus.app`をApplicationsフォルダに移動

### ソースからビルド

```bash
git clone https://github.com/sioaeko/scriptplayer-plus.git
cd scriptplayer-plus
npm install
```

**開発モード：**
```bash
npm run electron:dev
```

**Windowsビルド：**
```bash
npm run build:win
```

**macOSビルド**（macOS必要）：
```bash
npm run build:mac
```

## キーボードショートカット

| キー | アクション |
|------|-----------|
| `Space` / `K` | 再生 / 一時停止 |
| `←` / `→` | ±5秒シーク |
| `Shift + ←/→` | ±10秒シーク |
| `↑` / `↓` | 音量 ±5% |
| `F` | フルスクリーン切替 |
| `M` | ミュート切替 |
| `Ctrl + ,` | 設定を開く |

## 技術スタック

- **Electron** — デスクトップアプリケーションフレームワーク
- **React** + **TypeScript** — UIコンポーネント
- **Tailwind CSS** — スタイリング
- **Vite** — ビルドツール
- **Handy API v2** — デバイス通信
- **Discourse API** — EroScripts連携

## ライセンス

PolyForm-Noncommercial-1.0.0

このプロジェクトは、非商用利用のみを認める source-available ソフトウェアとして提供されています。
商用利用には著作権者の別途許可が必要です。

---

<p align="center">
  Electron、React、Tailwind CSSで構築
</p>
