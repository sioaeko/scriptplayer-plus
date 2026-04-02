<p align="center">
  <img src="../public/icon.png" width="128" height="128" alt="ScriptPlayer+ 아이콘">
</p>

<h1 align="center">ScriptPlayer+</h1>

<p align="center">
  <b>The Handy</b> 연동, <b>Intiface / Buttplug / FunOSR</b> 다축 지원, <b>EroScripts</b> 브라우저 로그인, 다국어 지원을 갖춘 모던 펀스크립트 비디오 플레이어
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README_KO.md">한국어</a> · <a href="README_JA.md">日本語</a> · <a href="README_ZH.md">中文</a>
</p>

---

## 스크린샷

| v0.1.4 미리보기 | 디바이스 설정 |
|:-:|:-:|
| ![v0.1.4 미리보기](screenshots/preview_v014.png) | ![디바이스 설정](screenshots/device_settings_v014.png) |

| 오디오 재생 + 히트맵 | 오디오 재생 |
|:-:|:-:|
| ![오디오 재생 + 히트맵](screenshots/VOICE_HM_TL.png) | ![오디오 재생](screenshots/VOICE_ASMR.png) |

| 타임라인 설정 | Windows 재생 |
|:-:|:-:|
| ![타임라인 설정](screenshots/Timeline_setting.png) | ![Windows](screenshots/playing_mode1.png) |

| 히트맵 & 타임라인 | EroScripts 검색 |
|:-:|:-:|
| ![히트맵](screenshots/heatmap.png) | ![스크립트](screenshots/scripts_search.png) |

| 설정 (한국어) | macOS |
|:-:|:-:|
| ![설정](screenshots/setting_kor.png) | ![macOS](screenshots/macos.png) |

## v0.1.6에서 추가된 내용

`v0.1.6`은 재생바에서 바로 조절하는 `STR` 스트로크 범위 컨트롤, 비어 있는 스크립트 구간 자동 스킵, 더 안정적인 미디어 길이 인식, 더 부드러운 seek / 스크럽 동작, 그리고 대형 폴더 스캔 및 디렉터리 순회 안정화까지 포함합니다.

| v0.1.6 미리보기 |
|:-:|
| ![v0.1.6 미리보기](screenshots/preview_v015_exp1.png) |

- 정식 릴리스 다운로드: [ScriptPlayer+ v0.1.6](https://github.com/sioaeko/scriptplayer-plus/releases/tag/v0.1.6)

## 주요 기능

- **비디오 + 오디오 플레이어** — 로컬 영상 파일(MP4, MKV, AVI, WebM, MOV, WMV)과 오디오 파일(MP3, WAV, FLAC, M4A, AAC, OGG, OPUS, WMA)을 재생합니다
- **오디오 커버 아트 감지** — 같은 폴더에 있는 앨범 아트 / 커버 이미지를 자동으로 찾아 표시합니다
- **재생 모드** — 연속 재생, 랜덤 재생, 배속 조절을 플레이어에서 바로 사용할 수 있습니다
- **펀스크립트 지원** — 미디어와 같은 이름의 `.funscript` 파일을 자동으로 로드합니다
- **타임라인 시각화** — 스크립트 액션 포인트를 속도별 색상으로 실시간 표시
- **히트맵** — 전체 미디어의 강도를 색상으로 한눈에 확인합니다 (초록 → 노랑 → 주황 → 빨강 → 보라)
- **기본 표시 설정 가능** — 설정에서 타임라인과 히트맵의 기본 표시 여부를 각각 지정할 수 있습니다
- **The Handy 연동** — HSSP 프로토콜로 The Handy 디바이스와 동기화
  - 자동 연결 & 연결 기록
  - 스크립트 자동 업로드
  - 시간 오프셋 조정
  - 스트로크 범위 커스터마이징
  - 스트로크 반전 토글
- **Intiface / Buttplug 다축 지원** — 지원 장치를 연결하고 기능별 축 매핑 후 raw TCode 전송까지 사용할 수 있습니다
- **FunOSR (COM) 지원** — 호환 장치로 한 줄 TCode를 조절 가능한 주기로 직접 전송합니다
- **EroScripts 연동** — 앱 내 브라우저 로그인으로 펀스크립트 검색 및 다운로드 (API 키 불필요)
  - 로그인 세션 로컬 유지
  - 설정된 스크립트 저장 폴더로 직접 다운로드
- **다국어 지원** — English, 한국어, 日本語, 中文
- **드래그 & 드롭** — 영상 또는 오디오 파일을 플레이어에 바로 드롭
- **폴더 브라우저** — 하위 폴더 그룹핑 및 스크립트 유무 표시 (초록 체크마크)
- **키보드 단축키** — Space, 방향키, F (전체화면), M (음소거) 등
- **크로스 플랫폼** — Windows (스탠드얼론), macOS (GitHub Actions), Linux x64 (소스 빌드)

## 설치

### Windows

1. [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)에서 최신 Windows x64 빌드 다운로드
2. 압축 해제 후 `ScriptPlayerPlus.exe` 실행 — 설치 불필요
3. 메인 `v0.1.6` 빌드에 The Handy, Intiface / Buttplug, 공식 FunOSR 지원이 모두 포함됩니다

### macOS

1. [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)에서 최신 macOS 빌드 다운로드
2. 압축 해제 후 `ScriptPlayerPlus.app`을 Applications 폴더로 이동

### Linux

Linux x64 빌드는 소스에서 만들 수 있습니다. 현재 Linux 패키지 타깃은 `AppImage`와 `linux-unpacked`입니다.

### 소스에서 빌드

```bash
git clone https://github.com/sioaeko/scriptplayer-plus.git
cd scriptplayer-plus
npm install
```

**개발 모드:**
```bash
npm run electron:dev
```

**Windows 빌드:**
```bash
npm run build:win
```

**macOS 빌드** (macOS 필요):
```bash
npm run build:mac
```

**Linux 빌드:**
```bash
npm run build:linux
```

## 키보드 단축키

| 키 | 기능 |
|-----|------|
| `Space` / `K` | 재생 / 일시정지 |
| `←` / `→` | ±5초 이동 |
| `Shift + ←/→` | ±10초 이동 |
| `↑` / `↓` | 볼륨 ±5% |
| `F` | 전체화면 전환 |
| `M` | 음소거 전환 |
| `Ctrl + ,` | 설정 열기 |

## 기술 스택

- **Electron** — 데스크톱 애플리케이션 프레임워크
- **React** + **TypeScript** — UI 컴포넌트
- **Tailwind CSS** — 스타일링
- **Vite** — 빌드 도구
- **Handy API v2** — 디바이스 통신
- **Discourse API** — EroScripts 연동

## 라이선스

PolyForm-Noncommercial-1.0.0

이 프로젝트는 비상업적 사용만 허용하는 source-available 소프트웨어로 배포됩니다.
상업적 사용은 저작권자의 별도 허가가 필요합니다.

---

<p align="center">
  Electron, React, Tailwind CSS로 제작
</p>
