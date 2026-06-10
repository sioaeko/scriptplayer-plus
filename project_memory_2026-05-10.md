# Project Memory - 2026-05-10

## Current project state

- Workspace: `C:\Users\백지인생\FunPlayer`
- Active branch during release work: `alpha-private`
- Private source remote: `alpha` -> `https://github.com/sioaeko/scriptplayer-plus-alpha.git`
- Public release remote: `origin` -> `https://github.com/sioaeko/scriptplayer-plus.git`
- Public repo is release-facing/source-light. Private `alpha` repo is the source of truth for app source.
- Latest released version: `v0.2.3`
- Release commit: `dae6ce1 Release v0.2.3`
- Public release URL: `https://github.com/sioaeko/scriptplayer-plus/releases/tag/v0.2.3`

## Release result

- Pushed `alpha-private` to `alpha/master`.
- Created and pushed tag `v0.2.3` to alpha.
- Alpha GitHub Actions run `25626708422` completed successfully.
- Public release `v0.2.3` was created and populated from alpha release assets.
- Alpha release notes were updated to match the public release notes.

## Public release assets

- `ScriptPlayerPlus-v0.2.3-win-x64.zip`
- `ScriptPlayerPlus-0.2.3-mac.zip`
- `ScriptPlayerPlus-0.2.3-mac.zip.blockmap`
- `ScriptPlayerPlus-0.2.3-arm64-mac.zip`
- `ScriptPlayerPlus-0.2.3-arm64-mac.zip.blockmap`
- `ScriptPlayerPlus-0.2.3.AppImage`
- `latest-linux.yml`

## v0.2.3 changes

- Fixed playlist/list refresh so rescanning updates existing media entries instead of leaving stale entries.
- Fixed autoplay paths that could be skipped when Handy/no-script conditions interacted with upload/autoplay logic.
- Improved no-motion auto-skip, including long final no-action gaps after the last script action.
- Improved script variant matching for folder-based layouts such as media-name script directories.
- Added subtitle support for `.ass`, `.ssa`, `.smi`, `.sami`, and `.txt` in addition to existing subtitle support.
- Improved subtitle scoring for ASS/SSA and SMI/SAMI candidates.
- Added file right-click actions for opening the containing folder and moving files to trash.
- Made trashing the currently playing file safer by clearing playback/file handles before moving to trash.
- Improved Handy upload failure message for `TypeError: Failed to fetch`; the app now points users toward Handy upload server/network/VPN/firewall/DNS issues.
- Fixed `Show timeline by default` being ignored. The old auto-reveal logic forced TL on whenever a scripted media loaded.
- Added auto FIT option for videos whose ratio nearly matches the player area.
- Added FIT state memory option so users can keep the last FIT state when opening the next video.
- Improved non-fullscreen FIT crop behavior by using a less surprising top-biased placement outside fullscreen.
- Improved auto FIT decision to use actual cover crop ratio and re-check when the visible media area changes.
- Added lightweight update checking against GitHub Releases.
- Added manual update check in Settings > About.
- Increased default window width from `1280` to `1480`.
- Increased minimum window width from `900` to `1280` so the lower-right controls, including FIT/fullscreen, are visible by default.

## Files changed for v0.2.3

- `electron/main.ts`
- `package.json`
- `package-lock.json`
- `src/App.tsx`
- `src/components/Settings.tsx`
- `src/components/Sidebar.tsx`
- `src/components/VideoPlayer.tsx`
- `src/constants/links.ts`
- `src/i18n/locales/en.ts`
- `src/i18n/locales/ja.ts`
- `src/i18n/locales/ko.ts`
- `src/i18n/locales/zh.ts`
- `src/services/handy.ts`
- `src/services/settings.ts`
- `src/services/subtitles.ts`
- `src/services/updateChecker.ts`

## Verification performed

- `tsc --noEmit` passed.
- `git diff --check` passed, with only LF/CRLF warnings.
- `npx vite build` passed earlier in the session.
- `npm run build:win` passed multiple times after changes.
- Built app launched successfully as `release\win-unpacked\ScriptPlayerPlus.exe`.
- Manual/smoke checks confirmed app process/window was responsive.
- Earlier smoke test confirmed media load, playback, funscript detection, subtitle display, and seek controls worked.

## Feedback/issues handled in this cycle

- Feedback `feedback-moxyfr5x`: `타임라인 기본표시 on/off 미작동`
- Root cause: `VideoPlayer.tsx` reset timeline from setting, then another effect forced timeline on when actions existed.
- Resolution: removed the forced timeline auto-reveal behavior.
- Additional suggestion from same feedback: auto FIT when video ratio matches player area.
- Resolution: added `autoFitVideoByAspect` setting.
- Additional FIT feedback: non-fullscreen FIT cuts off top, and FIT should be remembered for next video.
- Resolution: added `rememberVideoFit`, separated manual FIT from auto FIT, and adjusted non-fullscreen FIT placement/crop behavior.

## Defender / ClickFix note

- During attempted UI automation, a long inline PowerShell here-string piped into `node -` triggered Microsoft Defender ClickFix-style detection.
- The script was intended to connect only to local Electron remote debugging at `127.0.0.1:9223` and inspect/drive the app UI.
- No external payload download, credential stealing code, Defender setting modification, persistence, or registry/startup changes were intended.
- Defender showed the resource as the inline PowerShell command and `ActionSuccess: True`.
- The temporary test file `tmp\fit-smoke-test.js` was removed.
- The app was relaunched without remote debugging.
- Going forward, avoid long PowerShell inline scripts, here-strings piped to Node, and `node -` automation patterns because they resemble ClickFix/stealer execution chains.
- Prefer normal `tsc`, `build:win`, app launch, and manual UI verification unless the user explicitly approves safer automation.

## Current local leftovers

- The following local untracked files/directories were intentionally not included in the release commit:
- `scriptplayer-check.png`
- `scriptplayer-window.png`
- `tmp/`

## Useful commands/paths

- Build Windows package: `cmd /c npm run build:win`
- Launch built app: `release\win-unpacked\ScriptPlayerPlus.exe`
- Check alpha runs with temporary `GH_TOKEN` from Git Credential Manager if `gh` is not logged in.
- Do not use PowerShell inline automation that pipes large scripts into Node.

## Suggested next steps

- If continuing development, start from `alpha-private` and sync against `alpha/master`.
- If users report FIT crop/layout problems again, inspect `src/components/VideoPlayer.tsx` around FIT state, `getVideoClassName`, and `shouldAutoFitVideoByAspect`.
- If users report update checks, inspect `src/services/updateChecker.ts` and `src/constants/links.ts`.
- If users report timeline default behavior, inspect `defaultShowTimeline` flow in `src/App.tsx`, `src/components/Settings.tsx`, and `src/components/VideoPlayer.tsx`.

## Release/community post writing style

- Preserve the user's existing posting style.
- Do not use overly formal release-note wording.
- Do not start posts with "늦은" unless the user explicitly asks for that context.
- Korean post style: short opening, casual dev-update wording, emoji section headers, roomy spacing, concise explanatory lines, and arrow summary lines.
- Preferred Korean opening:
- `ScriptPlayer+ vX.X.X 업데이트 올렸습니다.`
- Then explain the release focus in one or two short paragraphs.
- Use sections like `🧭 타임라인 기본 표시 수정`, `🎬 FIT 관련 개선`, `💬 자막 호환성 확장`.
- End important sections with `👉 ...` summary lines.
- End with:
- `🔗 링크`
- `GitHub: https://github.com/sioaeko/scriptplayer-plus`
- `Release: https://github.com/sioaeko/scriptplayer-plus/releases/tag/vX.X.X`
- `Feedback : https://sioaeko.github.io/scriptplayer-plus-feedback/index.html`
- English Patreon/ES style should mirror the same structure with title format like `ScriptPlayer+ vX.X.X Release - Feature A / Feature B / Fixes`.
- English opening can be `vX.X.X drop`, then a short feedback-focused release summary.
