<p align="center">
  <img src="../public/icon.png" width="128" height="128" alt="ScriptPlayer+ 아이콘">
</p>

<h1 align="center">ScriptPlayer+</h1>

<p align="center">
  <b>The Handy</b> 연동, <b>EroScripts</b> 브라우저 로그인, 다국어 지원을 갖춘 모던 펀스크립트 비디오 플레이어
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README_KO.md">한국어</a> · <a href="README_JA.md">日本語</a> · <a href="README_ZH.md">中文</a>
</p>

---

## 스크린샷

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

## v0.1.3에서 추가된 내용

- **전체화면 영상 채우기 개선** — 전체화면 재생 시 영상이 화면을 더 꽉 채우도록 표시 방식을 조정했습니다
- **전체화면 컨트롤 자동 숨김** — 재생 중에는 재생바와 스크립트 오버레이가 서서히 사라져 영상 영역을 온전히 사용할 수 있습니다
- **확장된 자막 탐지** — 미디어 폴더와 자막/스크립트 하위 폴더의 `.vtt`, `.srt`, 타임스탬프형 `.txt` 자막을 자동으로 찾아 표시합니다
- **버전 표시 동기화** — 타이틀바와 설정 화면의 버전 배지가 앱 패키지 버전과 항상 같도록 정리했습니다

## 주요 기능

- **비디오 + 오디오 플레이어** — 로컬 영상 파일(MP4, MKV, AVI, WebM, MOV, WMV)과 오디오 파일(MP3, WAV, FLAC, M4A, AAC, OGG, OPUS, WMA)을 재생합니다
- **오디오 커버 아트 감지** — 같은 폴더에 있는 앨범 아트 / 커버 이미지를 자동으로 찾아 표시합니다
- **펀스크립트 지원** — 미디어와 같은 이름의 `.funscript` 파일을 자동으로 로드합니다
- **타임라인 시각화** — 스크립트 액션 포인트를 속도별 색상으로 실시간 표시
- **히트맵** — 전체 미디어의 강도를 색상으로 한눈에 확인합니다 (초록 → 노랑 → 주황 → 빨강 → 보라)
- **기본 표시 설정 가능** — 설정에서 타임라인과 히트맵의 기본 표시 여부를 각각 지정할 수 있습니다
- **The Handy 연동** — HSSP 프로토콜로 The Handy 디바이스와 동기화
  - 자동 연결 & 연결 기록
  - 스크립트 자동 업로드
  - 시간 오프셋 조정
  - 스트로크 범위 커스터마이징
- **EroScripts 연동** — 앱 내 브라우저 로그인으로 펀스크립트 검색 및 다운로드 (API 키 불필요)
  - 로그인 세션 로컬 유지
  - 설정된 스크립트 저장 폴더로 직접 다운로드
- **다국어 지원** — English, 한국어, 日本語, 中文
- **드래그 & 드롭** — 영상 또는 오디오 파일을 플레이어에 바로 드롭
- **폴더 브라우저** — 하위 폴더 그룹핑 및 스크립트 유무 표시 (초록 체크마크)
- **키보드 단축키** — Space, 방향키, F (전체화면), M (음소거) 등
- **크로스 플랫폼** — Windows (스탠드얼론) 및 macOS (GitHub Actions)

## 설치

### Windows

1. [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)에서 최신 `ScriptPlayerPlus-0.1.3-Windows-x64.zip` 다운로드
2. 압축 해제 후 `ScriptPlayerPlus.exe` 실행 — 설치 불필요

### macOS

1. [Releases](https://github.com/sioaeko/scriptplayer-plus/releases)에서 최신 macOS 빌드 다운로드
2. 압축 해제 후 `ScriptPlayerPlus.app`을 Applications 폴더로 이동

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

MIT

---

<p align="center">
  Electron, React, Tailwind CSS로 제작
</p>
