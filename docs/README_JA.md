<p align="center">
  <img src="../public/icon.png" width="128" height="128" alt="ScriptPlayer+ アイコン">
</p>

<h1 align="center">ScriptPlayer+</h1>

<p align="center">
  <b>The Handy</b>連携、<b>Intiface / Buttplug / FunOSR</b> のマルチアクシス対応、<b>EroScripts</b>ブラウザログイン、多言語対応のモダンなファンスクリプトビデオプレーヤー
</p>

<p align="center">
  <a href="https://www.patreon.com/cw/sioaeko0">
    <img alt="PatreonでScriptPlayer+を支援" src="https://img.shields.io/badge/Patreon-Support%20Development-FF424D?logo=patreon&logoColor=white">
  </a>
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

## v0.3.0 の主な変更

- 統合ナビゲーションとビジュアルライブラリを中心にUIを再構成し、従来のファイルパネルは折りたたんで併用できるようにしました。
- `axes[]` / `channels{}` 統合マルチアクシススクリプト、複数軸の同時タイムライン、タイムライン高さ調整を追加・改善しました。
- Range Extender、メディア別出力範囲、モーションスムージング、数値を直接入力できる `±60秒` のスクリプトオフセットを追加しました。
- Handy HSSPの復旧と自動再生を安定化し、旧型Handy互換モードとネットワーク遅延診断を追加しました。
- FunOSRのシリアル / Bluetooth COMプロファイル、再接続、停止 / ホーム動作、スムーズな出力プリセットを改善しました。
- JAVPlayer、JAVPlayerEZ、mpv、PotPlayer、VLC、カスタム実行ファイル向けの実験的External Viewer Modeを追加しました。
- Chromiumで直接再生できない動画向けに、実験的FFmpeg互換再生を追加しました。
- オーディオのカバー / 字幕検出、最大`150%`の音量ブースト、専用アクセサリの自動再接続を追加・改善しました。
- 同一バージョンのホットフィックス検出、変更内容の表示、アプリ内インストーラ起動を追加しました。

## 主な機能

- **ビデオ + オーディオプレーヤー** — ローカル動画ファイル（MP4、MKV、AVI、WebM、MOV、WMV）と音声ファイル（MP3、WAV、FLAC、M4A、AAC、OGG、OPUS、WMA）を再生
- **ビジュアルライブラリ** — サムネイル、評価、再生時間、並べ替えと折りたたみ可能なファイルパネルを提供します
- **オーディオのアートワーク検出** — メタデータと作品フォルダからカバー画像や外部字幕を探します
- **再生モード** — 連続再生、シャッフル再生、再生速度変更をプレーヤーから直接使えます
- **ファンスクリプト対応** — メディアと同名の `.funscript` ファイルを自動読み込み
- **タイムライン表示** — 複数のスクリプト軸を選択し、高さを調整してリアルタイム表示
- **ヒートマップ** — メディア全体の強度を色で可視化（緑→黄→オレンジ→赤→紫）
- **初期表示の切り替え** — 設定からタイムラインとヒートマップの初期表示を個別にオン / オフできます
- **The Handy連携** — HSSPプロトコルでThe Handyデバイスと同期
  - 自動接続＆接続履歴
  - スクリプト自動アップロード
  - 時間オフセット調整
  - ストローク範囲のカスタマイズ
  - ストローク反転トグル
- **スクリプト補正** — Range Extender、モーションスムージング、メディア別 `±60秒` オフセット、ギャップ補完 / 自動スキップ
- **Intiface / Buttplug マルチアクシス対応** — 対応デバイスを接続し、機能ごとの軸マッピングと raw TCode 転送を利用できます
- **FunOSR対応** — シリアル / Bluetooth COMプロファイル、軸マッピング、再接続、更新レート、スムージング
- **外部プレーヤー / FFmpeg** — 対応プレーヤーの起動連携と実験的互換再生
- **EroScripts連携** — アプリ内ブラウザログインでファンスクリプトの検索・ダウンロード（APIキー不要）
  - ログインセッションをローカル保持
  - 設定したスクリプト保存フォルダへ直接ダウンロード
- **多言語対応** — English、한국어、日本語、中文
- **ドラッグ＆ドロップ** — 動画または音声ファイルを直接プレーヤーにドロップ
- **フォルダブラウザ** — サブフォルダグループ化とスクリプト検出（緑チェックマーク）
- **キーボードショートカット** — Space、矢印キー、F（フルスクリーン）、M（ミュート）など
- **クロスプラットフォーム** — Windows、macOS、Linux

## インストール

### Windows

1. [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)から最新の Windows x64 ビルドをダウンロード
2. インストーラを実行するか、ポータブルZIPを展開して`ScriptPlayerPlus.exe`を実行

### macOS

1. [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)から最新の macOS ビルドをダウンロード
2. DMGまたはZIPから`ScriptPlayerPlus.app`をApplicationsフォルダに移動

### Linux

リリースで提供されるAppImage、DEB、またはアーカイブを利用してください。

## 現在の注意事項

- 動画コンテナ内の埋め込み字幕はまだ解析しません。外部字幕ファイルを使用してください。
- External Viewer Modeの制御 / 同期レベルはプレーヤーごとに異なります。
- FFmpeg互換再生は実験機能で、FFmpeg実行ファイルが必要です。

## ソース公開範囲

ScriptPlayer+は現在EULAに基づくデスクトップバイナリとして配布しています。公開リポジトリはリリース、更新メタデータ、ドキュメント、Issue管理に使用し、アプリケーションの全ソースコードは公開していません。

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

ScriptPlayer+ End User License Agreement

ScriptPlayer+ は [`LICENSE`](../LICENSE) に記載された EULA の条件で配布されるプロプライエタリソフトウェアです。
商用利用、再配布、変更、プロジェクトメディアの再利用には、著作権者の別途書面による許可が必要です。

---

<p align="center">
  Electron、React、Tailwind CSSで構築
</p>
