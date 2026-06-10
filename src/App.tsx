import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ScriptMatchDialog from './components/ScriptMatchDialog'
import VideoPlayer, { type ScriptDebugInfo } from './components/VideoPlayer'
import Settings, { type SettingsSection } from './components/Settings'
import {
  Funscript,
  FunscriptAction,
  FunscriptBundle,
  MediaType,
  OsrSerialConnectionState,
  OsrSerialPortInfo,
  PlaybackMode,
  ScriptAxisId,
  ScriptMediaMatchCandidate,
  ScriptVariantOption,
  SubtitleCue,
  SubtitleFile,
  VideoFile,
} from './types'
import {
  limitFunscriptMotionSpeed,
  parseFunscript,
  strokesPerMinuteToUnitsPerSecond,
  transformFunscriptActions,
} from './services/funscript'
import { handyService, HandyUploadStatus } from './services/handy'
import {
  ButtplugConnectionState,
  ButtplugDevice,
  buttplugService,
} from './services/buttplug'
import { osrSerialService } from './services/osrSerial'
import {
  AxisActionMap,
  buildButtplugDeviceSignature,
  buildButtplugTransportCommand,
  buildFeatureMappingsForDevice,
  ButtplugFeatureMapping,
  getButtplugFeatureStorageKey,
} from './services/buttplugDeviceControl'
import {
  buildDefaultTCodeCommand,
  buildTCodeCommand,
} from './services/tcode'
import {
  getOsrSerialProfileAxisIds,
  getOsrSerialTCodeAxisOptions,
  normalizeOsrSerialAxisConfigs,
  normalizeOsrSerialProfile,
  OsrSerialAxisConfig,
  OsrSerialAxisConfigMap,
  OsrSerialProfile,
} from './services/osrSerialConfig'
import {
  normalizeScriptBundle,
  SCRIPT_AXIS_IDS,
} from './services/multiaxis'
import { AppSettings, createDefaultAppSettings, loadSettings, saveSettings } from './services/settings'
import {
  remoteAccessoryClient,
  type RemoteAccessoryState,
  type RemoteCommandId,
} from './services/remoteAccessory'
import { buildNoScriptRandomFunscript, fillNoScriptRandomFunscriptGaps } from './services/noScriptStroke'
import {
  findMatchingShortcutAction,
  ShortcutActionId,
  isEditableShortcutTarget,
} from './services/shortcuts'
import {
  DEFAULT_VIDEO_SORT,
  getAdjacentVideoFile,
  getNextPlaybackFile,
  orderVideoFiles,
  VideoSortState,
} from './services/mediaOrder'
import {
  getPlaylistNameFromPath,
  getPlaylistSaveFileName,
  parsePlaylistContent,
  serializePlaylist,
} from './services/playlist'
import { getVideoSubtitleMatchScore, parseSubtitleFile } from './services/subtitles'
import { checkForUpdates, type UpdateCheckResult } from './services/updateChecker'
import { useTranslation } from './i18n'

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv']
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma']
const SCRIPT_EXTS = ['.funscript', '.json', '.csv']
const PLAYBACK_MODE_STORAGE_KEY = 'scriptplayer-playback-mode'
const PLAYBACK_MODE_MIGRATION_KEY = 'scriptplayer-playback-mode-default-v2'
const LOOP_CURRENT_MEDIA_STORAGE_KEY = 'scriptplayer-loop-current-media'
const PLAYBACK_RATE_STORAGE_KEY = 'scriptplayer-playback-rate'
const DEVICE_PROVIDER_STORAGE_KEY = 'scriptplayer-device-provider'
const UPDATE_DISMISSED_STORAGE_KEY = 'scriptplayer-update-dismissed-version'
const BUTTPLUG_SERVER_URL_STORAGE_KEY = 'scriptplayer-buttplug-url'
const BUTTPLUG_DEVICE_INDEX_STORAGE_KEY = 'scriptplayer-buttplug-device-index'
const BUTTPLUG_FEATURE_MAPPINGS_STORAGE_KEY = 'scriptplayer-buttplug-feature-mappings-v1'
const OSR_SERIAL_PORT_PATH_STORAGE_KEY = 'scriptplayer-osr-serial-port-path'
const OSR_SERIAL_UPDATE_RATE_STORAGE_KEY = 'scriptplayer-osr-serial-update-rate'
const OSR_SERIAL_PROFILE_STORAGE_KEY = 'scriptplayer-osr-serial-profile'
const OSR_SERIAL_AXIS_CONFIGS_STORAGE_KEY = 'scriptplayer-osr-serial-axis-configs-v1'
const VIDEO_SORT_FIELD_STORAGE_KEY = 'scriptplayer-video-sort-field'
const VIDEO_SORT_DIRECTION_STORAGE_KEY = 'scriptplayer-video-sort-direction'
const SCRIPT_OFFSET_STORAGE_KEY = 'scriptplayer-script-offsets-v1'
const CURRENT_PLAYLIST_STORAGE_KEY = 'scriptplayer-current-playlist-v1'
const VOLUME_STORAGE_KEY = 'volume'
const SIDEBAR_COLLAPSED_FOLDERS_STORAGE_KEY = 'sidebarCollapsedFolders'
const DEVICE_COMPATIBILITY_PRESET_STORAGE_KEY = 'scriptplayer-device-compatibility-preset-v1'
const RECENT_ISSUE_REPORTS_STORAGE_KEY = 'scriptplayer-recent-issue-reports-v1'
const SCRIPT_OFFSET_MIN_MS = -5000
const SCRIPT_OFFSET_MAX_MS = 5000
const DEFAULT_BUTTPLUG_SERVER_URL = 'ws://127.0.0.1:12345'
const DEFAULT_OSR_SERIAL_BAUD_RATE = 115200
const DEFAULT_OSR_SERIAL_UPDATE_RATE = 50
const CRAFTY_HANDY_SR6_UPDATE_RATE = 30
const CRAFTY_HANDY_SR6_FIRST_COMMAND_GRACE_MS = 750
const OSR_SERIAL_NEUTRAL_BURST_COUNT = 3
const OSR_SERIAL_NEUTRAL_BURST_INTERVAL_MS = 35
const OSR_SERIAL_IDLE_KEEPALIVE_INTERVAL_MS = 2000
const BUTTPLUG_IDLE_KEEPALIVE_INTERVAL_MS = 2500
const HANDY_SEEK_SETTLE_TIMEOUT_MS = 500
const HANDY_AUTOPLAY_REQUEST_BUFFER_MS = 220
const AUTO_SKIP_AFTER_SEEK_SUPPRESS_MS = 1200
const AUTO_SKIP_COOLDOWN_MS = 1000
const AUTO_SKIP_TARGET_EPSILON_MS = 250
type DeviceTestCommand = 'L0' | 'V0' | 'V1' | 'R0' | 'stop'
const AUTO_SKIP_END_LEAD_MS = 350
const AUTO_SKIP_MIN_POSITION_DELTA = 2
const APP_SHORTCUT_ACTIONS: ShortcutActionId[] = ['openSettings', 'openFolder']
const RANDOM_FALLBACK_AXIS_IDS: ScriptAxisId[] = ['L0', 'R0']
const INTIFACE_RESET_STORAGE_KEYS = [
  BUTTPLUG_SERVER_URL_STORAGE_KEY,
  BUTTPLUG_DEVICE_INDEX_STORAGE_KEY,
  BUTTPLUG_FEATURE_MAPPINGS_STORAGE_KEY,
] as const
const APP_RESET_STORAGE_KEYS = [
  PLAYBACK_MODE_STORAGE_KEY,
  PLAYBACK_MODE_MIGRATION_KEY,
  LOOP_CURRENT_MEDIA_STORAGE_KEY,
  PLAYBACK_RATE_STORAGE_KEY,
  DEVICE_PROVIDER_STORAGE_KEY,
  DEVICE_COMPATIBILITY_PRESET_STORAGE_KEY,
  ...INTIFACE_RESET_STORAGE_KEYS,
  OSR_SERIAL_PORT_PATH_STORAGE_KEY,
  OSR_SERIAL_UPDATE_RATE_STORAGE_KEY,
  OSR_SERIAL_PROFILE_STORAGE_KEY,
  OSR_SERIAL_AXIS_CONFIGS_STORAGE_KEY,
  VIDEO_SORT_FIELD_STORAGE_KEY,
  VIDEO_SORT_DIRECTION_STORAGE_KEY,
  SCRIPT_OFFSET_STORAGE_KEY,
  CURRENT_PLAYLIST_STORAGE_KEY,
  VOLUME_STORAGE_KEY,
  SIDEBAR_COLLAPSED_FOLDERS_STORAGE_KEY,
] as const

type DeviceProvider = 'handy' | 'buttplug' | 'serial'
type DeviceCompatibilityPreset = 'auto' | 'lovense-vibration' | 'sr1-bluetooth' | 'sr-safe-pause' | 'tcode-raw' | 'multi-axis-strict'
type StoredButtplugFeatureMapping = ButtplugFeatureMapping

interface PendingScriptMatchState {
  scriptPath: string
  candidates: ScriptMediaMatchCandidate[]
}

interface StoredCurrentPlaylist {
  version: 1
  name: string
  filePath?: string
  files: VideoFile[]
}

interface AutoSkipMotionModel {
  hasActions: boolean
  motionTimes: number[]
}

interface AppFeedback {
  text: string
  tone: 'success' | 'info' | 'error'
}

interface RecentIssueReport {
  capturedAt: string
  text: string
}

function getMediaTypeFromPath(filePath: string): MediaType | null {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '')
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  return null
}

function isScriptFilePath(filePath: string): boolean {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '')
  return SCRIPT_EXTS.includes(ext)
}

function loadRecentIssueReports(): RecentIssueReport[] {
  try {
    const raw = localStorage.getItem(RECENT_ISSUE_REPORTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is RecentIssueReport => (
          item &&
          typeof item === 'object' &&
          typeof item.capturedAt === 'string' &&
          typeof item.text === 'string'
        )).slice(0, 3)
      : []
  } catch {
    return []
  }
}

function saveRecentIssueReport(text: string, capturedAt: string) {
  try {
    const reports = loadRecentIssueReports()
    const nextReports = [
      { capturedAt, text },
      ...reports.filter((report) => report.text !== text),
    ].slice(0, 3)
    localStorage.setItem(RECENT_ISSUE_REPORTS_STORAGE_KEY, JSON.stringify(nextReports))
  } catch {
    // Ignore storage failures
  }
}

function removeStorageKeys(keys: readonly string[]) {
  try {
    for (const key of keys) {
      localStorage.removeItem(key)
    }
  } catch {
    // Ignore storage failures
  }
}

function loadPlaybackMode(): PlaybackMode {
  try {
    const stored = localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY)
    const migrated = localStorage.getItem(PLAYBACK_MODE_MIGRATION_KEY) === '1'

    if (stored === 'sequential' || stored === 'shuffle') {
      return stored
    }

    if (stored === 'none' && migrated) {
      return 'none'
    }

    localStorage.setItem(PLAYBACK_MODE_MIGRATION_KEY, '1')
    return 'sequential'
  } catch {
    // Ignore storage failures
  }

  return 'sequential'
}

function loadPlaybackRate(): number {
  try {
    const stored = Number(localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY))
    if (Number.isFinite(stored) && stored > 0) {
      return stored
    }
  } catch {
    // Ignore storage failures
  }

  return 1
}

function loadLoopCurrentMedia(): boolean {
  try {
    return localStorage.getItem(LOOP_CURRENT_MEDIA_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function loadDeviceProvider(): DeviceProvider {
  try {
    const stored = localStorage.getItem(DEVICE_PROVIDER_STORAGE_KEY)
    if (stored === 'handy' || stored === 'buttplug' || stored === 'serial') {
      return stored
    }
  } catch {
    // Ignore storage failures
  }

  return 'handy'
}

function loadDeviceCompatibilityPreset(): DeviceCompatibilityPreset {
  try {
    const stored = localStorage.getItem(DEVICE_COMPATIBILITY_PRESET_STORAGE_KEY)
    if (
      stored === 'auto'
      || stored === 'lovense-vibration'
      || stored === 'sr1-bluetooth'
      || stored === 'sr-safe-pause'
      || stored === 'tcode-raw'
      || stored === 'multi-axis-strict'
    ) {
      return stored
    }
  } catch {
    // Ignore storage failures
  }

  return 'auto'
}

function loadButtplugServerUrl(): string {
  try {
    return localStorage.getItem(BUTTPLUG_SERVER_URL_STORAGE_KEY) || DEFAULT_BUTTPLUG_SERVER_URL
  } catch {
    return DEFAULT_BUTTPLUG_SERVER_URL
  }
}

function allowsLegacyVibrationFallback(preset: DeviceCompatibilityPreset): boolean {
  return preset !== 'multi-axis-strict'
}

function prefersRawTCode(preset: DeviceCompatibilityPreset): boolean {
  return preset === 'tcode-raw' || preset === 'sr1-bluetooth' || preset === 'sr-safe-pause'
}

function getButtplugIdleKeepAliveIntervalMs(preset: DeviceCompatibilityPreset): number {
  return preset === 'sr1-bluetooth' || preset === 'sr-safe-pause' || preset === 'tcode-raw'
    ? 1500
    : BUTTPLUG_IDLE_KEEPALIVE_INTERVAL_MS
}

function getOsrSerialIdleKeepAliveIntervalMs(preset: DeviceCompatibilityPreset): number {
  return preset === 'sr1-bluetooth' || preset === 'sr-safe-pause'
    ? 1500
    : OSR_SERIAL_IDLE_KEEPALIVE_INTERVAL_MS
}

function getDevicePauseSuppressDurationMs(preset: DeviceCompatibilityPreset): number {
  return preset === 'sr-safe-pause' ? 3500 : 1800
}

function loadButtplugDeviceIndex(): number | null {
  try {
    const raw = localStorage.getItem(BUTTPLUG_DEVICE_INDEX_STORAGE_KEY)
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isInteger(parsed) ? parsed : null
  } catch {
    return null
  }
}

function loadButtplugFeatureMappings(): Record<string, StoredButtplugFeatureMapping> {
  try {
    const raw = localStorage.getItem(BUTTPLUG_FEATURE_MAPPINGS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function loadOsrSerialPortPath(): string {
  try {
    return localStorage.getItem(OSR_SERIAL_PORT_PATH_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function loadOsrSerialUpdateRate(): number {
  try {
    const stored = Number(localStorage.getItem(OSR_SERIAL_UPDATE_RATE_STORAGE_KEY))
    if (Number.isFinite(stored) && stored >= 5 && stored <= 200) {
      return Math.round(stored)
    }
  } catch {
    // Ignore storage failures
  }

  return DEFAULT_OSR_SERIAL_UPDATE_RATE
}

function loadOsrSerialProfile(): OsrSerialProfile {
  try {
    return normalizeOsrSerialProfile(localStorage.getItem(OSR_SERIAL_PROFILE_STORAGE_KEY))
  } catch {
    return 'sr6'
  }
}

function loadOsrSerialAxisConfigs(): OsrSerialAxisConfigMap {
  try {
    const raw = localStorage.getItem(OSR_SERIAL_AXIS_CONFIGS_STORAGE_KEY)
    return normalizeOsrSerialAxisConfigs(raw ? JSON.parse(raw) : null)
  } catch {
    return normalizeOsrSerialAxisConfigs(null)
  }
}

function loadVideoSort(): VideoSortState {
  try {
    const storedField = localStorage.getItem(VIDEO_SORT_FIELD_STORAGE_KEY)
    const storedDirection = localStorage.getItem(VIDEO_SORT_DIRECTION_STORAGE_KEY)

    return {
      field: storedField === 'name' || storedField === 'modified' ? storedField : DEFAULT_VIDEO_SORT.field,
      direction: storedDirection === 'desc' ? 'desc' : DEFAULT_VIDEO_SORT.direction,
    }
  } catch {
    return DEFAULT_VIDEO_SORT
  }
}

function clampScriptOffset(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(SCRIPT_OFFSET_MIN_MS, Math.min(SCRIPT_OFFSET_MAX_MS, Math.round(value)))
}

function loadScriptOffsets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SCRIPT_OFFSET_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    const next: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || typeof value !== 'number') continue
      const offset = clampScriptOffset(value)
      if (offset !== 0) {
        next[key] = offset
      }
    }
    return next
  } catch {
    return {}
  }
}

function saveScriptOffsets(offsets: Record<string, number>) {
  try {
    localStorage.setItem(SCRIPT_OFFSET_STORAGE_KEY, JSON.stringify(offsets))
  } catch {
    // Ignore storage failures
  }
}

function loadStoredCurrentPlaylist(): StoredCurrentPlaylist | null {
  try {
    const raw = localStorage.getItem(CURRENT_PLAYLIST_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !Array.isArray(parsed.files)) {
      return null
    }

    const files = parsed.files.filter(isStoredVideoFile)
    if (files.length === 0) {
      return null
    }

    return {
      version: 1,
      name: typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim()
        : 'ScriptPlayer+ Playlist',
      filePath: typeof parsed.filePath === 'string' ? parsed.filePath : undefined,
      files,
    }
  } catch {
    return null
  }
}

function saveStoredCurrentPlaylist(name: string, filePath: string | undefined, files: VideoFile[]) {
  try {
    if (files.length === 0) {
      localStorage.removeItem(CURRENT_PLAYLIST_STORAGE_KEY)
      return
    }

    const data: StoredCurrentPlaylist = {
      version: 1,
      name: name.trim() || 'ScriptPlayer+ Playlist',
      filePath,
      files,
    }
    localStorage.setItem(CURRENT_PLAYLIST_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Ignore storage failures
  }
}

function clearStoredCurrentPlaylist() {
  try {
    localStorage.removeItem(CURRENT_PLAYLIST_STORAGE_KEY)
  } catch {
    // Ignore storage failures
  }
}

function isStoredVideoFile(value: unknown): value is VideoFile {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<VideoFile>
  return typeof candidate.name === 'string'
    && typeof candidate.path === 'string'
    && (candidate.type === 'video' || candidate.type === 'audio')
    && typeof candidate.hasScript === 'boolean'
    && Array.isArray(candidate.scriptAxes)
    && typeof candidate.hasSubtitles === 'boolean'
}

function normalizeOffsetPathKey(filePath: string): string {
  return window.electronAPI.platform === 'win32' ? filePath.toLowerCase() : filePath
}

function buildScriptOffsetKey(mediaPath: string | null, scriptSource: string | null): string | null {
  if (!mediaPath) {
    return null
  }

  if (scriptSource && !scriptSource.startsWith('generated://')) {
    return `script:${normalizeOffsetPathKey(scriptSource)}`
  }

  return `media:${normalizeOffsetPathKey(mediaPath)}`
}

function getScriptSourceLabel(sourcePath: string | null, currentMediaPath: string | null, manualScriptPath?: string): string {
  if (!sourcePath) {
    return 'none'
  }

  if (sourcePath.startsWith('generated://')) {
    return 'generated'
  }

  if (manualScriptPath && normalizeOffsetPathKey(sourcePath) === normalizeOffsetPathKey(manualScriptPath)) {
    return 'manual'
  }

  if (currentMediaPath && normalizeOffsetPathKey(pathDirnameLike(sourcePath)) === normalizeOffsetPathKey(pathDirnameLike(currentMediaPath))) {
    return 'local'
  }

  return 'scriptFolder'
}

function pathDirnameLike(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : ''
}

function getPlaybackTimeScale(playbackRate: number): number {
  return 1 / (Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1)
}

function getHandySyncTarget(mediaTimeSeconds: number, playbackRate: number, timeOffset: number): {
  startTime: number
  extraServerDelayMs: number
} {
  const targetTime = mediaTimeSeconds * 1000 * getPlaybackTimeScale(playbackRate) + timeOffset
  if (targetTime >= 0) {
    return {
      startTime: Math.round(targetTime),
      extraServerDelayMs: 0,
    }
  }

  return {
    startTime: 0,
    extraServerDelayMs: Math.round(-targetTime),
  }
}

function waitForMediaSeekSettled(media: HTMLMediaElement, timeoutMs = HANDY_SEEK_SETTLE_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve) => {
    let resolved = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const finalize = () => {
      if (resolved) return
      resolved = true
      media.removeEventListener('seeked', handleSeeked)
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      resolve(media.currentTime)
    }

    const handleSeeked = () => {
      finalize()
    }

    requestAnimationFrame(() => {
      if (!media.seeking) {
        finalize()
        return
      }

      media.addEventListener('seeked', handleSeeked, { once: true })
      timeoutId = setTimeout(finalize, timeoutMs)
    })
  })
}

function waitForMediaReady(media: HTMLMediaElement, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    if (media.readyState >= 2) {
      resolve(true)
      return
    }

    let resolved = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const finalize = (ready: boolean) => {
      if (resolved) return
      resolved = true
      media.removeEventListener('loadeddata', handleReady)
      media.removeEventListener('canplay', handleReady)
      media.removeEventListener('canplaythrough', handleReady)
      media.removeEventListener('error', handleError)
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      resolve(ready)
    }

    const handleReady = () => {
      finalize(true)
    }

    const handleError = () => {
      finalize(false)
    }

    media.addEventListener('loadeddata', handleReady, { once: true })
    media.addEventListener('canplay', handleReady, { once: true })
    media.addEventListener('canplaythrough', handleReady, { once: true })
    media.addEventListener('error', handleError, { once: true })
    timeoutId = setTimeout(() => finalize(media.readyState >= 2), timeoutMs)
  })
}

function waitForDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve()
      return
    }
    setTimeout(resolve, ms)
  })
}

function waitForMediaElement(
  mediaRef: React.MutableRefObject<HTMLMediaElement | null>,
  timeoutMs = 2000
): Promise<HTMLMediaElement | null> {
  return new Promise((resolve) => {
    const existing = mediaRef.current
    if (existing) {
      resolve(existing)
      return
    }

    const startedAt = Date.now()

    const poll = () => {
      if (mediaRef.current) {
        resolve(mediaRef.current)
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null)
        return
      }

      requestAnimationFrame(poll)
    }

    requestAnimationFrame(poll)
  })
}

async function playMediaWithMutedFallback(media: HTMLMediaElement): Promise<boolean> {
  try {
    await media.play()
    return true
  } catch (error) {
    console.warn('[App] media.play() failed, retrying with temporary mute', error)
  }

  const previousMuted = media.muted
  media.muted = true

  try {
    await media.play()
    requestAnimationFrame(() => {
      media.muted = previousMuted
    })
    return true
  } catch (error) {
    console.warn('[App] muted autoplay fallback failed', error)
    media.muted = previousMuted
    return false
  }
}

function parseFunscriptBundleData(raw: unknown): FunscriptBundle | null {
  const normalized = normalizeScriptBundle(raw)
  if (!normalized) return null

  const parsedScripts: Partial<Record<ScriptAxisId, Funscript>> = {}
  for (const axisId of SCRIPT_AXIS_IDS) {
    const script = normalized.scripts[axisId]
    if (!script) continue
    const parsed = parseFunscript(script)
    if (parsed) {
      parsedScripts[axisId] = parsed
    }
  }

  const availableAxes = Object.keys(parsedScripts) as ScriptAxisId[]
  if (availableAxes.length === 0) return null

  const primaryAxis = normalized.primaryAxis && parsedScripts[normalized.primaryAxis]
    ? normalized.primaryAxis
    : (availableAxes.includes('L0') ? 'L0' : availableAxes[0])

  return {
    primaryAxis,
    scripts: parsedScripts,
    sources: normalized.sources,
  }
}

function buildAxisActionMap(
  scripts: Partial<Record<ScriptAxisId, Funscript>> | AxisActionMap | undefined,
  transform: (
    axisId: ScriptAxisId,
    actions: FunscriptAction[],
    source: Funscript | FunscriptAction[]
  ) => FunscriptAction[]
): AxisActionMap {
  const next: AxisActionMap = {}

  if (!scripts) return next

  for (const axisId of SCRIPT_AXIS_IDS) {
    const source = scripts[axisId]
    if (!source) continue
    const actions = Array.isArray(source) ? source : source.actions
    next[axisId] = transform(axisId, actions, source)
  }

  return next
}

function getPrimaryAxis(bundle: FunscriptBundle | null): ScriptAxisId | null {
  if (!bundle) return null
  if (bundle.primaryAxis && bundle.scripts[bundle.primaryAxis]) return bundle.primaryAxis
  if (bundle.scripts.L0) return 'L0'
  return (Object.keys(bundle.scripts)[0] as ScriptAxisId | undefined) ?? null
}

function hasBundleScripts(bundle: FunscriptBundle | null): boolean {
  if (!bundle) return false
  return SCRIPT_AXIS_IDS.some((axisId) => Boolean(bundle.scripts[axisId]))
}

function collectAutoSkipMotionModel(actionMap: AxisActionMap, timeOffsetMs = 0): AutoSkipMotionModel {
  let hasActions = false
  const uniqueMotionTimes = new Set<number>()

  for (const axisId of SCRIPT_AXIS_IDS) {
    const actions = actionMap[axisId]
    if (!actions) continue

    const sortedActions = [...actions]
      .filter((action) => Number.isFinite(action.at) && action.at >= 0 && Number.isFinite(action.pos))
      .sort((a, b) => a.at - b.at)
    if (sortedActions.length > 0) {
      hasActions = true
    }

    let lastMotionPosition: number | null = null
    for (const action of sortedActions) {
      if (
        lastMotionPosition === null
        || Math.abs(action.pos - lastMotionPosition) >= AUTO_SKIP_MIN_POSITION_DELTA
      ) {
        uniqueMotionTimes.add(Math.max(0, action.at - timeOffsetMs))
        lastMotionPosition = action.pos
      }
    }
  }

  return {
    hasActions,
    motionTimes: Array.from(uniqueMotionTimes).sort((a, b) => a - b),
  }
}

function findAutoSkipTargetMs(
  actionTimes: number[],
  currentTimeMs: number,
  minimumGapMs: number,
  leadInMs: number,
  durationMs?: number
): number | null {
  if (actionTimes.length === 0 || minimumGapMs <= 0) {
    return null
  }

  let low = 0
  let high = actionTimes.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (actionTimes[mid] <= currentTimeMs + AUTO_SKIP_TARGET_EPSILON_MS) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  const nextActionTime = actionTimes[low]
  if (!Number.isFinite(nextActionTime)) {
    if (!Number.isFinite(durationMs) || typeof durationMs !== 'number' || durationMs <= 0) {
      return null
    }

    const gapStartTime = actionTimes[actionTimes.length - 1]
    const gapDuration = durationMs - gapStartTime
    if (gapDuration < minimumGapMs) {
      return null
    }

    const targetTime = Math.max(gapStartTime, durationMs - AUTO_SKIP_END_LEAD_MS)
    if (targetTime <= currentTimeMs + AUTO_SKIP_TARGET_EPSILON_MS) {
      return null
    }

    return targetTime
  }

  const gapStartTime = low > 0 ? actionTimes[low - 1] : 0
  const gapDuration = nextActionTime - gapStartTime
  if (gapDuration < minimumGapMs) {
    return null
  }

  const targetTime = Math.max(gapStartTime, nextActionTime - Math.max(0, leadInMs))
  if (targetTime <= currentTimeMs + AUTO_SKIP_TARGET_EPSILON_MS) {
    return null
  }

  return targetTime
}

export default function App() {
  const { locale, setLocale, t } = useTranslation()
  const initialStoredPlaylist = useMemo(loadStoredCurrentPlaylist, [])
  const [files, setFiles] = useState<VideoFile[]>(() => initialStoredPlaylist?.files ?? [])
  const [playlistMode, setPlaylistMode] = useState(() => Boolean(initialStoredPlaylist))
  const [playlistName, setPlaylistName] = useState(() => initialStoredPlaylist?.name ?? '')
  const [playlistFilePath, setPlaylistFilePath] = useState<string | undefined>(() => initialStoredPlaylist?.filePath)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [shufflePlaybackHistory, setShufflePlaybackHistory] = useState<string[]>([])
  const [shufflePlaybackFuture, setShufflePlaybackFuture] = useState<string[]>([])
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [currentFileType, setCurrentFileType] = useState<MediaType | null>(null)
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null)
  const [funscriptBundle, setFunscriptBundle] = useState<FunscriptBundle | null>(null)
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([])
  const [deviceProvider, setDeviceProvider] = useState<DeviceProvider>(loadDeviceProvider)
  const [deviceCompatibilityPreset, setDeviceCompatibilityPreset] = useState<DeviceCompatibilityPreset>(loadDeviceCompatibilityPreset)
  const [handyConnected, setHandyConnected] = useState(false)
  const [scriptUploadUrl, setScriptUploadUrl] = useState<string | null>(null)
  const [handyUploadStatus, setHandyUploadStatus] = useState<HandyUploadStatus>('idle')
  const [handyUploadError, setHandyUploadError] = useState<string | null>(null)
  const [handyAutoPlayStatusText, setHandyAutoPlayStatusText] = useState<string | null>(null)
  const [handyAutoPlayStatusTone, setHandyAutoPlayStatusTone] = useState<'busy' | 'error' | null>(null)
  const [buttplugConnectionState, setButtplugConnectionState] = useState<ButtplugConnectionState>('disconnected')
  const [buttplugError, setButtplugError] = useState<string | null>(null)
  const [buttplugDevices, setButtplugDevices] = useState<ButtplugDevice[]>([])
  const [buttplugScanning, setButtplugScanning] = useState(false)
  const [buttplugServerUrl, setButtplugServerUrlState] = useState<string>(loadButtplugServerUrl)
  const [selectedButtplugDeviceIndex, setSelectedButtplugDeviceIndexState] = useState<number | null>(loadButtplugDeviceIndex)
  const [buttplugFeatureMappingStore, setButtplugFeatureMappingStore] = useState<Record<string, StoredButtplugFeatureMapping>>(loadButtplugFeatureMappings)
  const [osrSerialConnectionState, setOsrSerialConnectionState] = useState<OsrSerialConnectionState>('disconnected')
  const [osrSerialError, setOsrSerialError] = useState<string | null>(null)
  const [osrSerialPorts, setOsrSerialPorts] = useState<OsrSerialPortInfo[]>([])
  const [selectedOsrSerialPortPath, setSelectedOsrSerialPortPathState] = useState<string>(loadOsrSerialPortPath)
  const [osrSerialUpdateRate, setOsrSerialUpdateRateState] = useState<number>(loadOsrSerialUpdateRate)
  const [osrSerialProfile, setOsrSerialProfile] = useState<OsrSerialProfile>(loadOsrSerialProfile)
  const [osrSerialAxisConfigs, setOsrSerialAxisConfigs] = useState<OsrSerialAxisConfigMap>(loadOsrSerialAxisConfigs)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [manualScriptPaths, setManualScriptPaths] = useState<Record<string, string>>({})
  const [scriptOffsets, setScriptOffsets] = useState<Record<string, number>>(loadScriptOffsets)
  const [scriptMatchDialog, setScriptMatchDialog] = useState<PendingScriptMatchState | null>(null)
  const [scriptVariants, setScriptVariants] = useState<ScriptVariantOption[]>([])
  const [scriptFolderRescanning, setScriptFolderRescanning] = useState(false)
  const [manualSubtitleFiles, setManualSubtitleFiles] = useState<Record<string, SubtitleFile>>({})
  const [mediaDurationSeconds, setMediaDurationSeconds] = useState(0)
  const [mediaSessionKey, setMediaSessionKey] = useState(0)
  const [appFeedback, setAppFeedback] = useState<AppFeedback | null>(null)
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(loadPlaybackMode)
  const [loopCurrentMedia, setLoopCurrentMedia] = useState<boolean>(loadLoopCurrentMedia)
  const [playbackRate, setPlaybackRate] = useState<number>(loadPlaybackRate)
  const [videoSort, setVideoSort] = useState<VideoSortState>(loadVideoSort)
  const [autoPlayRequestId, setAutoPlayRequestId] = useState(0)
  const [pendingAutoPlayAfterHandyUpload, setPendingAutoPlayAfterHandyUpload] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<UpdateCheckResult | null>(null)
  const [remoteAccessoryState, setRemoteAccessoryState] = useState<RemoteAccessoryState>(() => remoteAccessoryClient.getState())
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const currentFileRef = useRef<string | null>(null)
  const shufflePlaybackHistoryRef = useRef<string[]>([])
  const shufflePlaybackFutureRef = useRef<string[]>([])
  const currentFolderPathRef = useRef<string | null>(null)
  const manualScriptPathsRef = useRef<Record<string, string>>(manualScriptPaths)
  const scriptFolderRef = useRef<string>(settings.scriptFolder)
  const pendingAutoPlayAfterHandyUploadRef = useRef(false)
  const skipNextHandyPlaySyncRef = useRef(false)
  const osrSerialFirstCommandReadyAtRef = useRef(0)
  const handyUploadRequestId = useRef(0)
  const handyAutoPlayRunId = useRef(0)
  const handyAutoPlaySyncInProgressRef = useRef(false)
  const handySyncRunId = useRef(0)
  const openMediaRequestId = useRef(0)
  const folderLoadRequestId = useRef(0)
  const buttplugStreamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buttplugStreamRunId = useRef(0)
  const osrSerialStreamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buttplugIdleKeepAliveTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const osrSerialIdleKeepAliveTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const appFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const osrSerialStreamRunId = useRef(0)

  useEffect(() => remoteAccessoryClient.subscribe(setRemoteAccessoryState), [])

  const devicePauseSuppressUntilRef = useRef(0)

  const commitShufflePlaybackStacks = useCallback((history: string[], future: string[]) => {
    shufflePlaybackHistoryRef.current = history
    shufflePlaybackFutureRef.current = future
    setShufflePlaybackHistory(history)
    setShufflePlaybackFuture(future)
  }, [])

  const resetShufflePlaybackStacks = useCallback(() => {
    commitShufflePlaybackStacks([], [])
  }, [commitShufflePlaybackStacks])

  const appendShufflePlaybackHistory = useCallback((history: string[], filePath: string | null) => {
    if (!filePath) return history
    if (history[history.length - 1] === filePath) return history
    return [...history, filePath]
  }, [])
  const autoSkipSuppressedUntilRef = useRef(0)
  const autoSkipCooldownUntilRef = useRef(0)

  useEffect(() => {
    const controller = new AbortController()

    void checkForUpdates({ signal: controller.signal })
      .then((result) => {
        if (!result.updateAvailable) return

        const dismissedVersion = localStorage.getItem(UPDATE_DISMISSED_STORAGE_KEY)
        if (dismissedVersion === result.latestVersion) return

        setAvailableUpdate(result)
      })
      .catch((error) => {
        if ((error as Error)?.name !== 'AbortError') {
          console.warn('[Update] check failed', error)
        }
      })

    return () => {
      controller.abort()
    }
  }, [])

  const openAvailableUpdate = useCallback(() => {
    if (!availableUpdate) return
    void window.electronAPI?.openExternal?.(availableUpdate.releaseUrl)
  }, [availableUpdate])

  const dismissAvailableUpdate = useCallback(() => {
    if (availableUpdate) {
      localStorage.setItem(UPDATE_DISMISSED_STORAGE_KEY, availableUpdate.latestVersion)
    }

    setAvailableUpdate(null)
  }, [availableUpdate])

  const effectiveFunscriptBundle = useMemo(() => {
    const mediaDurationMs = mediaDurationSeconds * 1000
    const randomStrokeOptions = {
      minStrokesPerMinute: settings.noScriptRandomMinSpeed,
      maxStrokesPerMinute: settings.noScriptRandomMaxSpeed,
      preset: settings.noScriptRandomPreset,
      pattern: settings.noScriptRandomPattern,
    }

    if (funscriptBundle) {
      if (
        !currentFile
        || (!settings.noScriptRandomStrokeEnabled && !settings.noScriptRandomFillGapsEnabled)
        || !Number.isFinite(mediaDurationSeconds)
        || mediaDurationSeconds <= 0
      ) {
        return funscriptBundle
      }

      const scripts = { ...funscriptBundle.scripts }
      const sources = { ...funscriptBundle.sources }
      let changed = false

      for (const axisId of RANDOM_FALLBACK_AXIS_IDS) {
        const existingScript = scripts[axisId]
        if (existingScript) {
          if (settings.noScriptRandomFillGapsEnabled) {
            const filledActions = fillNoScriptRandomFunscriptGaps(
              existingScript.actions,
              mediaDurationMs,
              `${currentFile}|${axisId}|fill-gaps`,
              {
                ...randomStrokeOptions,
                minimumGapMs: settings.noScriptRandomFillGapMinDuration * 1000,
              }
            )
            if (filledActions) {
              scripts[axisId] = {
                ...existingScript,
                actions: filledActions,
              }
              changed = true
            }
          }

          continue
        }

        if (!settings.noScriptRandomStrokeEnabled) continue

        const script = buildNoScriptRandomFunscript(
          mediaDurationMs,
          `${currentFile}|${axisId}`,
          randomStrokeOptions
        )
        if (!script) continue

        scripts[axisId] = script
        sources[axisId] = `generated://random-no-script-${axisId.toLowerCase()}`
        changed = true
      }

      if (!changed) {
        return funscriptBundle
      }

      return {
        primaryAxis: funscriptBundle.primaryAxis && scripts[funscriptBundle.primaryAxis]
          ? funscriptBundle.primaryAxis
          : (scripts.L0 ? 'L0' as const : RANDOM_FALLBACK_AXIS_IDS.find((axisId) => scripts[axisId]) ?? null),
        scripts,
        sources,
      }
    }

    if (
      !currentFile
      || !settings.noScriptRandomStrokeEnabled
      || !Number.isFinite(mediaDurationSeconds)
      || mediaDurationSeconds <= 0
    ) {
      return null
    }

    const scripts: Partial<Record<ScriptAxisId, Funscript>> = {}
    const sources: Partial<Record<ScriptAxisId, string>> = {}

    for (const axisId of RANDOM_FALLBACK_AXIS_IDS) {
      const script = buildNoScriptRandomFunscript(
        mediaDurationMs,
        `${currentFile}|${axisId}`,
        randomStrokeOptions
      )
      if (!script) continue

      scripts[axisId] = script
      sources[axisId] = `generated://random-no-script-${axisId.toLowerCase()}`
    }

    if (!RANDOM_FALLBACK_AXIS_IDS.some((axisId) => scripts[axisId])) {
      return null
    }

    return {
      primaryAxis: 'L0' as const,
      scripts,
      sources,
    }
  }, [
    currentFile,
    funscriptBundle,
    mediaDurationSeconds,
    settings.noScriptRandomFillGapMinDuration,
    settings.noScriptRandomFillGapsEnabled,
    settings.noScriptRandomMaxSpeed,
    settings.noScriptRandomMinSpeed,
    settings.noScriptRandomPattern,
    settings.noScriptRandomPreset,
    settings.noScriptRandomStrokeEnabled,
  ])
  const primaryAxis = useMemo(() => getPrimaryAxis(effectiveFunscriptBundle), [effectiveFunscriptBundle])
  const autoSkipAxisActions = useMemo(
    () => buildAxisActionMap(
      funscriptBundle?.scripts,
      (axisId, actions, source) => {
        const scriptInverted = !Array.isArray(source) && Boolean(source.inverted)

        return transformFunscriptActions(actions, axisId === 'L0'
          ? {
              strokeMin: settings.strokeRangeMin,
              strokeMax: settings.strokeRangeMax,
              invert: scriptInverted !== settings.invertStroke,
            }
          : {
              invert: scriptInverted,
            })
      }
    ),
    [funscriptBundle?.scripts, settings.invertStroke, settings.strokeRangeMax, settings.strokeRangeMin]
  )
  const displayAxisActions = useMemo(
    () => buildAxisActionMap(
      effectiveFunscriptBundle?.scripts,
      (axisId, actions, source) => {
        const scriptInverted = !Array.isArray(source) && Boolean(source.inverted)

        return transformFunscriptActions(actions, axisId === 'L0'
          ? {
              strokeMin: settings.strokeRangeMin,
              strokeMax: settings.strokeRangeMax,
              invert: scriptInverted !== settings.invertStroke,
            }
          : {
              invert: scriptInverted,
            })
      }
    ),
    [effectiveFunscriptBundle?.scripts, settings.invertStroke, settings.strokeRangeMax, settings.strokeRangeMin]
  )
  const runtimeAxisActions = useMemo(
    () => buildAxisActionMap(displayAxisActions, (_axisId, actions) => {
      const scaledActions = transformFunscriptActions(actions, { timeScale: getPlaybackTimeScale(playbackRate) })
      if (!settings.motionSpeedLimitEnabled) {
        return scaledActions
      }

      return limitFunscriptMotionSpeed(
        scaledActions,
        strokesPerMinuteToUnitsPerSecond(settings.motionSpeedLimit)
      )
    }),
    [displayAxisActions, playbackRate, settings.motionSpeedLimit, settings.motionSpeedLimitEnabled]
  )
  const displayActions = useMemo(
    () => (primaryAxis ? displayAxisActions[primaryAxis] ?? [] : []),
    [displayAxisActions, primaryAxis]
  )
  const primaryScriptSource = useMemo(
    () => (primaryAxis ? effectiveFunscriptBundle?.sources[primaryAxis] ?? null : null),
    [effectiveFunscriptBundle, primaryAxis]
  )
  const scriptOffsetKey = useMemo(
    () => buildScriptOffsetKey(currentFile, primaryScriptSource),
    [currentFile, primaryScriptSource]
  )
  const scriptOffset = useMemo(
    () => scriptOffsetKey ? scriptOffsets[scriptOffsetKey] ?? 0 : 0,
    [scriptOffsetKey, scriptOffsets]
  )
  const effectiveDeviceTimeOffset = (settings.timeOffset || 0) + scriptOffset
  const handyActions = useMemo(() => {
    if (runtimeAxisActions.L0 && runtimeAxisActions.L0.length > 0) {
      return runtimeAxisActions.L0
    }
    return primaryAxis ? runtimeAxisActions[primaryAxis] ?? [] : []
  }, [primaryAxis, runtimeAxisActions])
  const waitingForGeneratedHandyScript = useMemo(() => (
    settings.noScriptRandomStrokeEnabled
    && !funscriptBundle
    && Boolean(currentFile)
    && (!Number.isFinite(mediaDurationSeconds) || mediaDurationSeconds <= 0)
  ), [
    currentFile,
    funscriptBundle,
    mediaDurationSeconds,
    settings.noScriptRandomStrokeEnabled,
  ])
  const availableScriptAxes = useMemo(
    () => SCRIPT_AXIS_IDS.filter((axisId) => Boolean(displayAxisActions[axisId]?.length)),
    [displayAxisActions]
  )
  const scriptDebugInfo = useMemo<ScriptDebugInfo | null>(() => {
    if (!settings.showScriptDebugInfo || !currentFile) {
      return null
    }

    const manualScriptPath = manualScriptPaths[currentFile]
    return {
      enabled: true,
      sourcePath: primaryScriptSource,
      sourceLabel: getScriptSourceLabel(primaryScriptSource, currentFile, manualScriptPath),
      axes: availableScriptAxes,
      offsetMs: scriptOffset,
      offsetScope: scriptOffsetKey?.startsWith('script:')
        ? t('player.scriptDebugScriptScope')
        : t('player.scriptDebugMediaScope'),
    }
  }, [
    availableScriptAxes,
    currentFile,
    manualScriptPaths,
    primaryScriptSource,
    scriptOffset,
    scriptOffsetKey,
    settings.showScriptDebugInfo,
    t,
  ])
  const autoSkipMotionModel = useMemo(
    () => collectAutoSkipMotionModel(autoSkipAxisActions, effectiveDeviceTimeOffset),
    [autoSkipAxisActions, effectiveDeviceTimeOffset]
  )
  const displayFiles = useMemo(
    () => files.map((file) => ({
      ...file,
      hasScript: file.hasScript || Boolean(manualScriptPaths[file.path]),
      hasSubtitles: file.hasSubtitles || Boolean(manualSubtitleFiles[file.path]),
    })),
    [files, manualScriptPaths, manualSubtitleFiles]
  )
  const orderedFiles = useMemo(
    () => orderVideoFiles(displayFiles, videoSort),
    [displayFiles, videoSort]
  )
  const fileEntryByPath = useMemo(
    () => new Map(orderedFiles.map((file) => [file.path, file])),
    [orderedFiles]
  )
  const previousSequentialFile = useMemo(
    () => getAdjacentVideoFile(orderedFiles, currentFile, 'previous'),
    [currentFile, orderedFiles]
  )
  const nextSequentialFile = useMemo(
    () => getAdjacentVideoFile(orderedFiles, currentFile, 'next'),
    [currentFile, orderedFiles]
  )
  const canGoToPreviousFile = playbackMode === 'shuffle'
    ? shufflePlaybackHistory.some((filePath) => fileEntryByPath.has(filePath))
    : Boolean(previousSequentialFile)
  const canGoToNextFile = playbackMode === 'shuffle'
    ? Boolean(currentFile) && orderedFiles.length > 1
    : Boolean(nextSequentialFile)
  const getRandomShufflePlaybackFile = useCallback((currentPath: string, history: string[]) => {
    const historyPaths = new Set(history)
    const preferredCandidates = orderedFiles.filter((file) => file.path !== currentPath && !historyPaths.has(file.path))
    const candidates = preferredCandidates.length > 0
      ? preferredCandidates
      : orderedFiles.filter((file) => file.path !== currentPath)

    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null
  }, [orderedFiles])
  const currentSidebarFile = useMemo(
    () => orderedFiles.find((file) => file.path === currentFile) ?? null,
    [currentFile, orderedFiles]
  )
  const buttplugConnected = buttplugConnectionState === 'connected'
  const osrSerialConnected = osrSerialConnectionState === 'connected'
  const selectedButtplugDevice = useMemo(
    () => buttplugDevices.find((device) => device.index === selectedButtplugDeviceIndex) ?? null,
    [buttplugDevices, selectedButtplugDeviceIndex]
  )
  const selectedOsrSerialPort = useMemo(
    () => osrSerialPorts.find((port) => port.path === selectedOsrSerialPortPath) ?? null,
    [osrSerialPorts, selectedOsrSerialPortPath]
  )
  const selectedButtplugFeatureMappings = useMemo(
    () => buildFeatureMappingsForDevice(selectedButtplugDevice, buttplugFeatureMappingStore),
    [buttplugFeatureMappingStore, selectedButtplugDevice]
  )
  const availableOsrSerialAxes = useMemo(
    () => getOsrSerialProfileAxisIds(osrSerialProfile, osrSerialAxisConfigs),
    [osrSerialAxisConfigs, osrSerialProfile]
  )
  const osrSerialScriptAxes = useMemo(
    () => availableOsrSerialAxes.filter((axisId) => Boolean(displayAxisActions[axisId]?.length)),
    [availableOsrSerialAxes, displayAxisActions]
  )
  const osrSerialAxisOutputOptions = useMemo(
    () => getOsrSerialTCodeAxisOptions(osrSerialAxisConfigs),
    [osrSerialAxisConfigs]
  )
  const osrSerialTCodeCommandOptions = useMemo(() => (
    osrSerialProfile === 'craftyHandySr6'
      ? {
        commandJoiner: '',
        intervalMs: Math.max(5, Math.round(1000 / CRAFTY_HANDY_SR6_UPDATE_RATE)),
      }
      : {}
  ), [osrSerialProfile])

  useEffect(() => {
    currentFileRef.current = currentFile
  }, [currentFile])

  useEffect(() => {
    const availablePaths = new Set(orderedFiles.map((file) => file.path))
    const nextHistory = shufflePlaybackHistoryRef.current.filter((filePath) => availablePaths.has(filePath))
    const nextFuture = shufflePlaybackFutureRef.current.filter((filePath) => availablePaths.has(filePath))
    const historyChanged = nextHistory.length !== shufflePlaybackHistoryRef.current.length
    const futureChanged = nextFuture.length !== shufflePlaybackFutureRef.current.length

    if (historyChanged || futureChanged) {
      commitShufflePlaybackStacks(nextHistory, nextFuture)
    }
  }, [commitShufflePlaybackStacks, orderedFiles])

  useEffect(() => {
    manualScriptPathsRef.current = manualScriptPaths
  }, [manualScriptPaths])

  useEffect(() => {
    scriptFolderRef.current = settings.scriptFolder
  }, [settings.scriptFolder])

  useEffect(() => {
    pendingAutoPlayAfterHandyUploadRef.current = pendingAutoPlayAfterHandyUpload
  }, [pendingAutoPlayAfterHandyUpload])

  const resetHandyAutoPlayState = useCallback(() => {
    handyAutoPlayRunId.current += 1
    pendingAutoPlayAfterHandyUploadRef.current = false
    setPendingAutoPlayAfterHandyUpload(false)
    setHandyAutoPlayStatusText(null)
    setHandyAutoPlayStatusTone(null)
    skipNextHandyPlaySyncRef.current = false
  }, [])

  useEffect(() => {
    handyService.onStatusChange = (status, error) => {
      setHandyUploadStatus(status)
      setHandyUploadError(error)
    }
    return () => {
      handyService.onStatusChange = null
    }
  }, [])

  useEffect(() => {
    buttplugService.onConnectionChange = (state, error) => {
      setButtplugConnectionState(state)
      setButtplugError(error)
    }
    buttplugService.onDevicesChange = (devices) => {
      setButtplugDevices(devices)
    }
    buttplugService.onScanChange = (scanning) => {
      setButtplugScanning(scanning)
    }

    return () => {
      buttplugService.onConnectionChange = null
      buttplugService.onDevicesChange = null
      buttplugService.onScanChange = null
    }
  }, [])

  useEffect(() => {
    if (!pendingAutoPlayAfterHandyUpload) {
      return
    }

    if (deviceProvider !== 'handy' || !handyConnected) {
      setPendingAutoPlayAfterHandyUpload(false)
      return
    }

    if (handyUploadStatus === 'error') {
      setPendingAutoPlayAfterHandyUpload(false)
    }
  }, [
    deviceProvider,
    handyConnected,
    handyUploadStatus,
    pendingAutoPlayAfterHandyUpload,
  ])

  useEffect(() => {
    osrSerialService.onStateChange = (state) => {
      setOsrSerialConnectionState(state.connectionState)
      setOsrSerialError(state.error)
      if (state.connectedPortPath) {
        setSelectedOsrSerialPortPathState(state.connectedPortPath)
      }
    }
    osrSerialService.onPortsChange = (ports) => {
      setOsrSerialPorts(ports)
    }

    void osrSerialService.initialize().then(() => {
      setOsrSerialConnectionState(osrSerialService.connectionState)
      setOsrSerialError(osrSerialService.error)
      if (osrSerialService.connectedPortPath) {
        setSelectedOsrSerialPortPathState(osrSerialService.connectedPortPath)
      }
      return osrSerialService.refreshPorts()
    })

    return () => {
      osrSerialService.onStateChange = null
      osrSerialService.onPortsChange = null
    }
  }, [])

  useEffect(() => {
    if (settings.language !== locale) {
      setLocale(settings.language)
    }
  }, [locale, setLocale, settings.language])

  useEffect(() => {
    window.electronAPI.setZoomFactor(settings.uiScale / 100)
  }, [settings.uiScale])

  useEffect(() => {
    void window.electronAPI.setAlwaysOnTop(settings.alwaysOnTop)
  }, [settings.alwaysOnTop])

  useEffect(() => {
    try {
      localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, playbackMode)
      localStorage.setItem(PLAYBACK_MODE_MIGRATION_KEY, '1')
    } catch {
      // Ignore storage failures
    }
  }, [playbackMode])

  useEffect(() => {
    try {
      localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, playbackRate.toString())
    } catch {
      // Ignore storage failures
    }
  }, [playbackRate])

  useEffect(() => {
    try {
      localStorage.setItem(LOOP_CURRENT_MEDIA_STORAGE_KEY, loopCurrentMedia ? 'true' : 'false')
    } catch {
      // Ignore storage failures
    }
  }, [loopCurrentMedia])

  useEffect(() => {
    try {
      localStorage.setItem(VIDEO_SORT_FIELD_STORAGE_KEY, videoSort.field)
      localStorage.setItem(VIDEO_SORT_DIRECTION_STORAGE_KEY, videoSort.direction)
    } catch {
      // Ignore storage failures
    }
  }, [videoSort.direction, videoSort.field])

  useEffect(() => {
    try {
      localStorage.setItem(DEVICE_PROVIDER_STORAGE_KEY, deviceProvider)
    } catch {
      // Ignore storage failures
    }
  }, [deviceProvider])

  useEffect(() => {
    try {
      localStorage.setItem(DEVICE_COMPATIBILITY_PRESET_STORAGE_KEY, deviceCompatibilityPreset)
    } catch {
      // Ignore storage failures
    }
  }, [deviceCompatibilityPreset])

  useEffect(() => {
    try {
      localStorage.setItem(OSR_SERIAL_PROFILE_STORAGE_KEY, osrSerialProfile)
    } catch {
      // Ignore storage failures
    }
  }, [osrSerialProfile])

  useEffect(() => {
    try {
      localStorage.setItem(OSR_SERIAL_AXIS_CONFIGS_STORAGE_KEY, JSON.stringify(osrSerialAxisConfigs))
    } catch {
      // Ignore storage failures
    }
  }, [osrSerialAxisConfigs])

  useEffect(() => {
    try {
      localStorage.setItem(BUTTPLUG_FEATURE_MAPPINGS_STORAGE_KEY, JSON.stringify(buttplugFeatureMappingStore))
    } catch {
      // Ignore storage failures
    }
  }, [buttplugFeatureMappingStore])

  useEffect(() => {
    if (!playlistMode) {
      return
    }

    saveStoredCurrentPlaylist(playlistName, playlistFilePath, files)
  }, [files, playlistFilePath, playlistMode, playlistName])

  const handleSettingsChange = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
  }, [])

  const closeScriptMatchDialog = useCallback(() => {
    setScriptMatchDialog(null)
  }, [])

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  const openSettingsSection = useCallback((section: SettingsSection) => {
    setScriptMatchDialog(null)
    setSettingsSection(section)
    setSettingsOpen(true)
  }, [])

  const handleQuickStrokeRangeChange = useCallback((min: number, max: number) => {
    patchSettings({
      strokeRangeMin: Math.min(min, max),
      strokeRangeMax: Math.max(min, max),
    })
  }, [patchSettings])

  const handleQuickInvertStrokeChange = useCallback((invert: boolean) => {
    patchSettings({ invertStroke: invert })
  }, [patchSettings])

  const handleScriptOffsetChange = useCallback((offsetMs: number) => {
    if (!scriptOffsetKey) {
      return
    }

    const nextOffset = clampScriptOffset(offsetMs)
    setScriptOffsets((prev) => {
      const next = { ...prev }
      if (nextOffset === 0) {
        delete next[scriptOffsetKey]
      } else {
        next[scriptOffsetKey] = nextOffset
      }
      saveScriptOffsets(next)
      return next
    })
  }, [scriptOffsetKey])

  const handleAutoNextPlayChange = useCallback((enabled: boolean) => {
    setPlaybackMode((current) => {
      if (!enabled) {
        return 'none'
      }

      return current === 'shuffle' ? 'shuffle' : 'sequential'
    })
  }, [])

  const setButtplugServerUrl = useCallback((url: string) => {
    setButtplugServerUrlState(url)
    try {
      localStorage.setItem(BUTTPLUG_SERVER_URL_STORAGE_KEY, url)
    } catch {
      // Ignore storage failures
    }
  }, [])

  const setSelectedOsrSerialPortPath = useCallback((portPath: string) => {
    setSelectedOsrSerialPortPathState(portPath)
    try {
      localStorage.setItem(OSR_SERIAL_PORT_PATH_STORAGE_KEY, portPath)
    } catch {
      // Ignore storage failures
    }
  }, [])

  const setOsrSerialUpdateRate = useCallback((rate: number) => {
    const normalizedRate = Math.max(5, Math.min(200, Math.round(rate || DEFAULT_OSR_SERIAL_UPDATE_RATE)))
    setOsrSerialUpdateRateState(normalizedRate)
    try {
      localStorage.setItem(OSR_SERIAL_UPDATE_RATE_STORAGE_KEY, normalizedRate.toString())
    } catch {
      // Ignore storage failures
    }
  }, [])

  const handleOsrSerialProfileChange = useCallback((profile: OsrSerialProfile) => {
    const normalizedProfile = normalizeOsrSerialProfile(profile)
    setOsrSerialProfile(normalizedProfile)
    if (normalizedProfile === 'craftyHandySr6') {
      setOsrSerialUpdateRate(CRAFTY_HANDY_SR6_UPDATE_RATE)
    }
  }, [setOsrSerialUpdateRate])

  const waitForOsrSerialFirstCommandReady = useCallback(async () => {
    if (osrSerialProfile !== 'craftyHandySr6') return
    const delayMs = osrSerialFirstCommandReadyAtRef.current - Date.now()
    if (delayMs > 0) {
      await waitForDelay(delayMs)
    }
  }, [osrSerialProfile])

  const handleOsrSerialAxisConfigChange = useCallback((axisId: ScriptAxisId, patch: Partial<OsrSerialAxisConfig>) => {
    setOsrSerialAxisConfigs((current) => normalizeOsrSerialAxisConfigs({
      ...current,
      [axisId]: {
        ...current[axisId],
        ...patch,
      },
    }))
  }, [])

  const setSelectedButtplugDeviceIndex = useCallback((deviceIndex: number | null) => {
    setSelectedButtplugDeviceIndexState(deviceIndex)
    try {
      if (deviceIndex === null) {
        localStorage.removeItem(BUTTPLUG_DEVICE_INDEX_STORAGE_KEY)
      } else {
        localStorage.setItem(BUTTPLUG_DEVICE_INDEX_STORAGE_KEY, deviceIndex.toString())
      }
    } catch {
      // Ignore storage failures
    }
  }, [])

  const setSelectedButtplugFeatureMapping = useCallback((featureId: string, next: StoredButtplugFeatureMapping) => {
    if (!selectedButtplugDevice) return
    const deviceSignature = buildButtplugDeviceSignature(selectedButtplugDevice)
    const storageKey = getButtplugFeatureStorageKey(deviceSignature, featureId)

    setButtplugFeatureMappingStore((prev) => ({
      ...prev,
      [storageKey]: next,
    }))
  }, [selectedButtplugDevice])

  const clearButtplugStreamTimer = useCallback(() => {
    if (!buttplugStreamTimer.current) return
    clearTimeout(buttplugStreamTimer.current)
    buttplugStreamTimer.current = null
  }, [])

  const clearOsrSerialStreamTimer = useCallback(() => {
    if (!osrSerialStreamTimer.current) return
    clearTimeout(osrSerialStreamTimer.current)
    osrSerialStreamTimer.current = null
  }, [])

  const showAppFeedback = useCallback((feedback: AppFeedback) => {
    setAppFeedback(feedback)
    if (appFeedbackTimer.current) {
      clearTimeout(appFeedbackTimer.current)
    }
    appFeedbackTimer.current = setTimeout(() => {
      appFeedbackTimer.current = null
      setAppFeedback(null)
    }, feedback.tone === 'error' ? 4200 : 2600)
  }, [])

  useEffect(() => {
    return window.electronAPI?.onMainProcessError?.((error) => {
      showAppFeedback({
        tone: error.recoverable ? 'error' : 'info',
        text: error.recoverable
          ? `Device I/O recovered: ${error.message}`
          : `Main process warning: ${error.message}`,
      })
    })
  }, [showAppFeedback])

  const stopButtplugPlayback = useCallback(
    async (options?: { stopDevice?: boolean }) => {
      buttplugStreamRunId.current += 1
      clearButtplugStreamTimer()

      if (!options?.stopDevice || !buttplugService.isConnected) return

      if (selectedButtplugDeviceIndex !== null) {
        await buttplugService.stopDevice(selectedButtplugDeviceIndex)
      } else {
        await buttplugService.stopAllDevices()
      }
    },
    [clearButtplugStreamTimer, selectedButtplugDeviceIndex]
  )

  const sendButtplugDeviceTest = useCallback(async (axisId: ScriptAxisId): Promise<boolean> => {
    if (!selectedButtplugDevice || !buttplugConnected) return false

    const actionMap: AxisActionMap = {
      [axisId]: [
        { at: 0, pos: axisId.startsWith('R') ? 40 : 18 },
        { at: 220, pos: axisId.startsWith('R') ? 78 : 86 },
      ],
    }
    const command = buildButtplugTransportCommand(
      selectedButtplugDevice,
      selectedButtplugFeatureMappings,
      actionMap,
      0,
      220,
      300,
      {
        legacyVibrationFallback: allowsLegacyVibrationFallback(deviceCompatibilityPreset),
        preferRawTCode: prefersRawTCode(deviceCompatibilityPreset),
      }
    )

    return buttplugService.sendDeviceFrame(selectedButtplugDevice.index, command.frame, { rawTCode: command.rawTCode })
  }, [buttplugConnected, deviceCompatibilityPreset, selectedButtplugDevice, selectedButtplugFeatureMappings])

  const sendOsrSerialDeviceTest = useCallback(async (axisId: ScriptAxisId): Promise<boolean> => {
    if (!osrSerialConnected || !availableOsrSerialAxes.includes(axisId)) return false

    const actionMap: AxisActionMap = {
      [axisId]: [
        { at: 0, pos: axisId.startsWith('R') ? 40 : 18 },
        { at: 220, pos: axisId.startsWith('R') ? 78 : 86 },
      ],
    }
    const command = buildTCodeCommand(actionMap, 220, {
      axisIds: [axisId],
      axisOutputOptions: osrSerialAxisOutputOptions,
      ...osrSerialTCodeCommandOptions,
    })

    await waitForOsrSerialFirstCommandReady()
    return command ? osrSerialService.writeCommand(command) : false
  }, [availableOsrSerialAxes, osrSerialAxisOutputOptions, osrSerialConnected, osrSerialTCodeCommandOptions, waitForOsrSerialFirstCommandReady])

  const startButtplugPlayback = useCallback(async () => {
    const media = mediaRef.current
    if (
      !media
      || media.paused
      || deviceProvider !== 'buttplug'
      || !buttplugConnected
      || !selectedButtplugDevice
      || availableScriptAxes.length === 0
    ) {
      return
    }

    const runId = ++buttplugStreamRunId.current
    clearButtplugStreamTimer()

    const tick = async () => {
      if (runId !== buttplugStreamRunId.current) return

      const currentMedia = mediaRef.current
      if (!currentMedia || currentMedia.paused) return

      const intervalMs = buttplugService.getRecommendedCommandInterval(selectedButtplugDevice.index)
      const effectivePlaybackRate = currentMedia.playbackRate > 0 ? currentMedia.playbackRate : playbackRate
      const currentTimeMs = currentMedia.currentTime * 1000 + effectiveDeviceTimeOffset
      const targetTimeMs = currentTimeMs + intervalMs * effectivePlaybackRate
      const command = buildButtplugTransportCommand(
        selectedButtplugDevice,
        selectedButtplugFeatureMappings,
        runtimeAxisActions,
        currentTimeMs,
        targetTimeMs,
        intervalMs,
        {
          legacyVibrationFallback: allowsLegacyVibrationFallback(deviceCompatibilityPreset),
          preferRawTCode: prefersRawTCode(deviceCompatibilityPreset),
        }
      )

      const sent = await buttplugService.sendDeviceFrame(selectedButtplugDevice.index, command.frame, { rawTCode: command.rawTCode })
      if (!sent) {
        void buttplugService.refreshDevices()
      }

      if (runId !== buttplugStreamRunId.current) return
      buttplugStreamTimer.current = setTimeout(() => {
        void tick()
      }, intervalMs)
    }

    await tick()
  }, [
    availableScriptAxes.length,
    buttplugConnected,
    clearButtplugStreamTimer,
    deviceCompatibilityPreset,
    deviceProvider,
    playbackRate,
    runtimeAxisActions,
    selectedButtplugDevice,
    selectedButtplugFeatureMappings,
    effectiveDeviceTimeOffset,
  ])

  const stopOsrSerialPlayback = useCallback(async (options?: { homeDevice?: boolean }) => {
    osrSerialStreamRunId.current += 1
    clearOsrSerialStreamTimer()

    if (!options?.homeDevice || !osrSerialConnected) {
      return
    }

    const neutralCommand = buildDefaultTCodeCommand(availableOsrSerialAxes, {
      axisOutputOptions: osrSerialAxisOutputOptions,
      ...osrSerialTCodeCommandOptions,
    })
    if (!neutralCommand) {
      return
    }

    await waitForOsrSerialFirstCommandReady()
    for (let i = 0; i < OSR_SERIAL_NEUTRAL_BURST_COUNT; i += 1) {
      await osrSerialService.writeCommand(neutralCommand)
      if (i < OSR_SERIAL_NEUTRAL_BURST_COUNT - 1) {
        await waitForDelay(OSR_SERIAL_NEUTRAL_BURST_INTERVAL_MS)
      }
    }
  }, [availableOsrSerialAxes, clearOsrSerialStreamTimer, osrSerialAxisOutputOptions, osrSerialConnected, osrSerialTCodeCommandOptions, waitForOsrSerialFirstCommandReady])

  const startOsrSerialPlayback = useCallback(async () => {
    const media = mediaRef.current
    if (
      !media
      || media.paused
      || deviceProvider !== 'serial'
      || !osrSerialConnected
      || osrSerialScriptAxes.length === 0
    ) {
      return
    }

    const runId = ++osrSerialStreamRunId.current
    clearOsrSerialStreamTimer()
    const intervalMs = Math.max(5, Math.round(1000 / Math.max(1, osrSerialUpdateRate)))
    let nextTickAt = performance.now()

    const scheduleNextTick = () => {
      if (runId !== osrSerialStreamRunId.current) return

      const now = performance.now()
      nextTickAt += intervalMs
      if (nextTickAt < now - intervalMs) {
        nextTickAt = now + intervalMs
      }

      osrSerialStreamTimer.current = setTimeout(() => {
        tick()
      }, Math.max(0, nextTickAt - now))
    }

    const tick = () => {
      if (runId !== osrSerialStreamRunId.current) return

      const currentMedia = mediaRef.current
      if (!currentMedia || currentMedia.paused) return

      const effectivePlaybackRate = currentMedia.playbackRate > 0 ? currentMedia.playbackRate : playbackRate
      const currentTimeMs = currentMedia.currentTime * 1000 + effectiveDeviceTimeOffset
      const targetTimeMs = currentTimeMs + intervalMs * effectivePlaybackRate
      const command = buildTCodeCommand(runtimeAxisActions, targetTimeMs, {
        axisIds: availableOsrSerialAxes,
        axisOutputOptions: osrSerialAxisOutputOptions,
        ...osrSerialTCodeCommandOptions,
        intervalMs: osrSerialProfile === 'craftyHandySr6' ? intervalMs : osrSerialTCodeCommandOptions.intervalMs,
      })

      if (command) {
        void osrSerialService.writeCommand(command).catch(() => {
          // Serial state updates already surface write failures.
        })
      }

      scheduleNextTick()
    }

    await waitForOsrSerialFirstCommandReady()
    tick()
  }, [
    availableOsrSerialAxes,
    clearOsrSerialStreamTimer,
    deviceProvider,
    osrSerialConnected,
    osrSerialAxisOutputOptions,
    osrSerialProfile,
    osrSerialTCodeCommandOptions,
    osrSerialUpdateRate,
    osrSerialScriptAxes.length,
    playbackRate,
    runtimeAxisActions,
    effectiveDeviceTimeOffset,
    waitForOsrSerialFirstCommandReady,
  ])

  const loadSubtitleCues = useCallback(async (mediaPath: string, mediaType: MediaType) => {
    const manualSubtitle = manualSubtitleFiles[mediaPath]
    if (manualSubtitle) {
      return parseSubtitleFile(manualSubtitle.content, manualSubtitle.path)
    }

    const subtitleFiles = await window.electronAPI.readSubtitles(mediaPath)
    return selectSubtitleCues(mediaPath, mediaType, subtitleFiles)
  }, [manualSubtitleFiles])

  const loadParsedScriptBundle = useCallback(async (mediaPath: string, preferredScriptPath?: string) => {
    const rawBundle = await window.electronAPI.readFunscriptBundle(mediaPath, settings.scriptFolder, preferredScriptPath)
    return parseFunscriptBundleData(rawBundle)
  }, [settings.scriptFolder])

  const loadScriptBundle = useCallback(async (mediaPath: string, autoScriptPath?: string) => {
    const preferredScriptPath = manualScriptPaths[mediaPath] ?? autoScriptPath
    return loadParsedScriptBundle(mediaPath, preferredScriptPath)
  }, [loadParsedScriptBundle, manualScriptPaths])

  const loadScriptVariants = useCallback(async (mediaPath: string) => {
    return window.electronAPI.listScriptVariants(mediaPath, settings.scriptFolder)
  }, [settings.scriptFolder])

  const refreshCurrentScriptBundle = useCallback(async (mediaPath: string, preferredScriptPath?: string) => {
    const parsedBundle = await loadParsedScriptBundle(mediaPath, preferredScriptPath)
    if (currentFileRef.current === mediaPath) {
      setFunscriptBundle(parsedBundle)
    }
  }, [loadParsedScriptBundle])

  const handleAiScriptGenerated = useCallback(async (script: unknown, modelLabel: string) => {
    const mediaPath = currentFileRef.current
    if (!mediaPath) {
      return null
    }

    const result = await window.electronAPI.saveGeneratedFunscript(
      mediaPath,
      JSON.stringify(script, null, 2),
      'ai-motion'
    )
    if (!result.ok || !result.path) {
      throw new Error(result.error || 'Failed to save generated script.')
    }

    setManualScriptPaths((prev) => ({
      ...prev,
      [mediaPath]: result.path!,
    }))

    const parsedBundle = await loadParsedScriptBundle(mediaPath, result.path)
    if (currentFileRef.current === mediaPath) {
      setFunscriptBundle(parsedBundle)
      const variants = await loadScriptVariants(mediaPath)
      if (currentFileRef.current === mediaPath) {
        setScriptVariants(variants)
      }
    }

    console.info(`[AI Script] Generated with ${modelLabel}: ${result.path}`)
    return result.path
  }, [loadParsedScriptBundle, loadScriptVariants])

  const cancelPendingHandySync = useCallback(() => {
    handySyncRunId.current += 1
  }, [])

  const syncHandyPlayback = useCallback(async (mediaTimeSeconds: number) => {
    if (!handyService.isConnected || !scriptUploadUrl) return
    const { startTime, extraServerDelayMs } = getHandySyncTarget(mediaTimeSeconds, playbackRate, effectiveDeviceTimeOffset)
    await handyService.hsspPlay(handyService.getServerTime() + extraServerDelayMs, startTime)
  }, [effectiveDeviceTimeOffset, playbackRate, scriptUploadUrl])

  const syncHandyAndPlayMedia = useCallback(async () => {
    const runId = handyAutoPlayRunId.current
    const media = await waitForMediaElement(mediaRef)
    handyAutoPlaySyncInProgressRef.current = true

    try {
      if (!media || !handyService.isConnected) {
        setHandyAutoPlayStatusText('Autoplay cancelled')
        setHandyAutoPlayStatusTone('error')
        return false
      }

      setHandyAutoPlayStatusText('Waiting for media...')
      setHandyAutoPlayStatusTone('busy')
      const mediaReady = await waitForMediaReady(media)
      if (runId !== handyAutoPlayRunId.current) {
        return false
      }
      if (!mediaReady) {
        setHandyAutoPlayStatusText('Media not ready')
        setHandyAutoPlayStatusTone('error')
        return false
      }

      const { startTime, extraServerDelayMs } = getHandySyncTarget(media.currentTime, playbackRate, effectiveDeviceTimeOffset)
      const autoplayLeadMs = handyService.getRecommendedPlayLeadMs(HANDY_AUTOPLAY_REQUEST_BUFFER_MS)
      const targetLocalStartAt = Date.now() + autoplayLeadMs

      setHandyAutoPlayStatusText('Syncing Handy...')
      setHandyAutoPlayStatusTone('busy')
      skipNextHandyPlaySyncRef.current = true
      const handySyncPromise = handyService.hsspPlay(
        handyService.getServerTime() + extraServerDelayMs,
        startTime,
        { leadMs: autoplayLeadMs }
      )

      const delayMs = Math.max(0, targetLocalStartAt - Date.now())
      if (delayMs > 0) {
        setHandyAutoPlayStatusText('Starting video...')
        await waitForDelay(delayMs)
      }
      if (runId !== handyAutoPlayRunId.current) {
        skipNextHandyPlaySyncRef.current = false
        if (!media.paused) {
          media.pause()
        }
        return false
      }

      const started = await playMediaWithMutedFallback(media)
      if (runId !== handyAutoPlayRunId.current) {
        skipNextHandyPlaySyncRef.current = false
        if (!media.paused) {
          media.pause()
        }
        return false
      }
      if (!started) {
        skipNextHandyPlaySyncRef.current = false
        await handyService.hsspStop()
        setHandyAutoPlayStatusText('Video play failed')
        setHandyAutoPlayStatusTone('error')
        return false
      }

      const synced = await handySyncPromise
      if (runId !== handyAutoPlayRunId.current) {
        skipNextHandyPlaySyncRef.current = false
        if (!media.paused) {
          media.pause()
        }
        return false
      }
      if (!synced) {
        skipNextHandyPlaySyncRef.current = false
        if (!media.paused) {
          media.pause()
        }
        setHandyAutoPlayStatusText('HSSP sync failed')
        setHandyAutoPlayStatusTone('error')
        return false
      }

      setHandyAutoPlayStatusText('Video playing')
      setHandyAutoPlayStatusTone('busy')
      setTimeout(() => {
        setHandyAutoPlayStatusText((current) => current === 'Video playing' ? null : current)
        setHandyAutoPlayStatusTone((current) => current === 'busy' ? null : current)
      }, 2000)
      return true
    } finally {
      handyAutoPlaySyncInProgressRef.current = false
    }
  }, [effectiveDeviceTimeOffset, playbackRate])

  const syncHandyPlaybackToCurrentMedia = useCallback(async (options?: { stopFirst?: boolean }) => {
    const media = mediaRef.current
    if (!media || media.paused || !handyService.isConnected || !scriptUploadUrl) return

    const runId = ++handySyncRunId.current

    if (options?.stopFirst) {
      await handyService.hsspStop()
      if (runId !== handySyncRunId.current) return
    }

    const settledTime = await waitForMediaSeekSettled(media)
    if (runId !== handySyncRunId.current) return

    await syncHandyPlayback(settledTime)
  }, [scriptUploadUrl, syncHandyPlayback])

  const mergeFilesByPath = useCallback((currentFiles: VideoFile[], incomingFiles: VideoFile[]) => {
    const merged = [...currentFiles]
    const indexByPath = new Map(
      currentFiles.map((file, index) => [normalizeOffsetPathKey(file.path), index])
    )

    for (const file of incomingFiles) {
      const key = normalizeOffsetPathKey(file.path)
      const existingIndex = indexByPath.get(key)
      if (existingIndex !== undefined) {
        merged[existingIndex] = file
        continue
      }

      indexByPath.set(key, merged.length)
      merged.push(file)
    }

    return merged
  }, [])

  const loadFolderFiles = useCallback(async (folderPath: string): Promise<VideoFile[] | null> => {
    const requestId = ++folderLoadRequestId.current
    const mediaFiles = await window.electronAPI.readDir(folderPath, scriptFolderRef.current || undefined)
    if (requestId !== folderLoadRequestId.current) {
      return null
    }
    currentFolderPathRef.current = folderPath
    setPlaylistMode(false)
    setPlaylistName('')
    setPlaylistFilePath(undefined)
    clearStoredCurrentPlaylist()
    setFiles(mediaFiles)
    return mediaFiles
  }, [])

  const handleOpenFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.openFolder()
    if (!folderPath) return
    await loadFolderFiles(folderPath)
  }, [loadFolderFiles])

  const handleAddMediaFiles = useCallback(async () => {
    const selectedPaths = await window.electronAPI.openMediaFiles()
    if (selectedPaths.length === 0) return

    const mediaFiles = await window.electronAPI.inspectMediaFiles(selectedPaths, scriptFolderRef.current || undefined)
    if (mediaFiles.length === 0) return

    currentFolderPathRef.current = null
    setPlaylistMode(true)
    setPlaylistFilePath(undefined)
    setPlaylistName((current) => current || t('sidebar.unsavedPlaylist'))
    setFiles((current) => mergeFilesByPath(current, mediaFiles))
  }, [mergeFilesByPath, t])

  const handleOpenPlaylistFile = useCallback(async () => {
    const playlistFile = await window.electronAPI.openPlaylistFile()
    if (!playlistFile) return

    const parsedPlaylist = parsePlaylistContent(playlistFile.content, playlistFile.path)
    if (parsedPlaylist.paths.length === 0) return

    const mediaFiles = await window.electronAPI.inspectMediaFiles(parsedPlaylist.paths, scriptFolderRef.current || undefined)
    if (mediaFiles.length === 0) return

    currentFolderPathRef.current = null
    setPlaylistMode(true)
    setPlaylistName(parsedPlaylist.name || getPlaylistNameFromPath(playlistFile.path))
    setPlaylistFilePath(playlistFile.path)
    setFiles(mediaFiles)
  }, [])

  const handleSavePlaylistFile = useCallback(async () => {
    if (files.length === 0) return

    const name = playlistName || t('sidebar.unsavedPlaylist')
    const savedPath = await window.electronAPI.savePlaylistFile(
      getPlaylistSaveFileName(name),
      serializePlaylist(name, orderedFiles)
    )
    if (!savedPath) return

    setPlaylistMode(true)
    setPlaylistName(getPlaylistNameFromPath(savedPath))
    setPlaylistFilePath(savedPath)
  }, [files.length, orderedFiles, playlistName, t])

  const handleClearPlaylist = useCallback(() => {
    currentFolderPathRef.current = null
    setPlaylistMode(true)
    setPlaylistName(t('sidebar.unsavedPlaylist'))
    setPlaylistFilePath(undefined)
    setFiles([])
    clearStoredCurrentPlaylist()
  }, [t])

  const handleRemovePlaylistFile = useCallback((file: VideoFile) => {
    setFiles((current) => current.filter((entry) => normalizeOffsetPathKey(entry.path) !== normalizeOffsetPathKey(file.path)))
  }, [])

  const handleOpenFileLocation = useCallback(async (file: VideoFile) => {
    const ok = await window.electronAPI.showItemInFolder(file.path)
    showAppFeedback({
      tone: ok ? 'success' : 'error',
      text: ok
        ? t('sidebar.fileLocationOpened', { name: file.name || getFileName(file.path) })
        : t('sidebar.fileLocationOpenFailed'),
    })
  }, [showAppFeedback, t])

  const handleTrashFile = useCallback(async (file: VideoFile) => {
    const name = file.name || getFileName(file.path)
    if (!window.confirm(t('sidebar.trashFileConfirm', { name }))) {
      return
    }

    const targetKey = normalizeOffsetPathKey(file.path)
    const currentKey = currentFileRef.current ? normalizeOffsetPathKey(currentFileRef.current) : ''
    const currentStateKey = currentFile ? normalizeOffsetPathKey(currentFile) : ''
    const deletingCurrentFile = currentKey === targetKey || currentStateKey === targetKey

    if (deletingCurrentFile) {
      openMediaRequestId.current += 1

      try {
        mediaRef.current?.pause()
        mediaRef.current?.removeAttribute('src')
        mediaRef.current?.load()
      } catch {
        // Best effort: clearing React state below will also detach the media URL.
      }

      cancelPendingHandySync()
      handyService.cancelPendingRequests()
      if (deviceProvider === 'handy') {
        void handyService.hsspStop()
      } else if (deviceProvider === 'buttplug') {
        void stopButtplugPlayback({ stopDevice: true })
      } else if (deviceProvider === 'serial') {
        void stopOsrSerialPlayback({ homeDevice: true })
      }
      resetHandyAutoPlayState()
      setScriptMatchDialog(null)
      setCurrentFile(null)
      setCurrentFileType(null)
      setVideoUrl(null)
      setArtworkUrl(null)
      setFunscriptBundle(null)
      setSubtitleCues([])
      setScriptUploadUrl(null)
      setHandyUploadStatus('idle')
      setHandyUploadError(null)
      setScriptVariants([])
      setMediaDurationSeconds(0)
      setMediaSessionKey((key) => key + 1)
    }

    const ok = await window.electronAPI.trashItem(file.path)
    if (!ok) {
      showAppFeedback({ tone: 'error', text: t('sidebar.fileMoveToTrashFailed') })
      return
    }

    setFiles((current) => current.filter((entry) => normalizeOffsetPathKey(entry.path) !== targetKey))
    setManualScriptPaths((prev) => {
      const next = { ...prev }
      delete next[file.path]
      return next
    })
    setManualSubtitleFiles((prev) => {
      const next = { ...prev }
      delete next[file.path]
      return next
    })

    showAppFeedback({
      tone: 'success',
      text: t('sidebar.fileMovedToTrash', { name }),
    })
  }, [
    cancelPendingHandySync,
    currentFile,
    deviceProvider,
    resetHandyAutoPlayState,
    showAppFeedback,
    stopButtplugPlayback,
    stopOsrSerialPlayback,
    t,
  ])

  const handleRescanScriptFolder = useCallback(async () => {
    if (scriptFolderRescanning) {
      return
    }

    setScriptFolderRescanning(true)
    try {
      const folderPath = currentFolderPathRef.current
      const mediaPath = currentFileRef.current
      let refreshedFiles: VideoFile[] | null = null

      if (folderPath) {
        refreshedFiles = await loadFolderFiles(folderPath)
      } else if (files.length > 0) {
        refreshedFiles = await window.electronAPI.inspectMediaFiles(
          files.map((file) => file.path),
          scriptFolderRef.current || undefined
        )
        setFiles((current) => mergeFilesByPath(current, refreshedFiles ?? []))
      }

      if (!mediaPath) {
        return
      }

      const mediaPathKey = normalizeOffsetPathKey(mediaPath)
      const refreshedFile = refreshedFiles?.find((file) => normalizeOffsetPathKey(file.path) === mediaPathKey)
      const preferredScriptPath = manualScriptPathsRef.current[mediaPath] ?? refreshedFile?.autoScriptPath

      await refreshCurrentScriptBundle(mediaPath, preferredScriptPath)
      const nextScriptVariants = await loadScriptVariants(mediaPath)
      if (currentFileRef.current === mediaPath) {
        setScriptVariants(nextScriptVariants)
      }
    } finally {
      setScriptFolderRescanning(false)
    }
  }, [
    files,
    loadFolderFiles,
    loadScriptVariants,
    mergeFilesByPath,
    refreshCurrentScriptBundle,
    scriptFolderRescanning,
  ])

  const openMediaFile = useCallback(async (
    filePath: string,
    fileType?: MediaType,
    options?: { autoplay?: boolean; preferredScriptPath?: string }
  ) => {
    const requestId = ++openMediaRequestId.current
    const resolvedType = fileType ?? getMediaTypeFromPath(filePath)
    if (!resolvedType) return
    const shouldAutoplay = Boolean(options?.autoplay)

    if (handyService.isConnected) {
      cancelPendingHandySync()
      handyService.cancelPendingRequests()
      await handyService.hsspStop()
    }

    if (buttplugService.isConnected) {
      await stopButtplugPlayback({ stopDevice: true })
    }

    if (osrSerialConnected) {
      await stopOsrSerialPlayback({ homeDevice: true })
    }

    const currentMedia = mediaRef.current
    if (currentMedia && !currentMedia.paused) {
      currentMedia.pause()
    }

    autoSkipSuppressedUntilRef.current = 0
    autoSkipCooldownUntilRef.current = 0
    resetHandyAutoPlayState()
    setScriptMatchDialog(null)
    setCurrentFile(filePath)
    setCurrentFileType(resolvedType)
    setMediaDurationSeconds(0)
    setFunscriptBundle(null)
    setSubtitleCues([])
    setScriptUploadUrl(null)
    setScriptVariants([])
    setArtworkUrl(null)

    const [url, nextSubtitleCues, initialParsedBundle, nextScriptVariants, artworkPath] = await Promise.all([
      window.electronAPI.getVideoUrl(filePath),
      loadSubtitleCues(filePath, resolvedType),
      loadScriptBundle(filePath, options?.preferredScriptPath),
      loadScriptVariants(filePath).catch(() => []),
      resolvedType === 'audio'
        ? window.electronAPI.findArtwork(filePath)
        : Promise.resolve<string | null>(null),
    ])

    let parsedBundle = initialParsedBundle
    if (
      !hasBundleScripts(parsedBundle)
      && !manualScriptPathsRef.current[filePath]
      && nextScriptVariants.length > 0
    ) {
      const fallbackVariant = nextScriptVariants.find((variant) => variant.isDefault) ?? nextScriptVariants[0]
      if (fallbackVariant?.path) {
        const fallbackBundle = await loadParsedScriptBundle(filePath, fallbackVariant.path)
        if (hasBundleScripts(fallbackBundle)) {
          parsedBundle = fallbackBundle
        }
      }
    }

    if (requestId !== openMediaRequestId.current) {
      return
    }

    if (currentFileRef.current === filePath) {
      setMediaSessionKey((prev) => prev + 1)
    }
    setVideoUrl(url)
    setSubtitleCues(nextSubtitleCues)
    setFunscriptBundle(parsedBundle)
    setScriptVariants(nextScriptVariants)
    if (shouldAutoplay) {
      const handyAutoplayRequiresUpload = deviceProvider === 'handy'
        && handyConnected
        && settings.handyAutoPlayAfterSync

      if (handyAutoplayRequiresUpload) {
        if (!hasBundleScripts(parsedBundle) && !settings.noScriptRandomStrokeEnabled) {
          setHandyAutoPlayStatusText('Waiting for script...')
          setHandyAutoPlayStatusTone('busy')
        }
        setPendingAutoPlayAfterHandyUpload(true)
      } else {
        setAutoPlayRequestId((prev) => prev + 1)
      }
    }

    if (artworkPath) {
      const nextArtworkUrl = await window.electronAPI.getVideoUrl(artworkPath)
      if (requestId !== openMediaRequestId.current) {
        return
      }
      setArtworkUrl(nextArtworkUrl)
    }
  }, [
    cancelPendingHandySync,
    deviceProvider,
    handyConnected,
    loadParsedScriptBundle,
    loadScriptBundle,
    loadScriptVariants,
    loadSubtitleCues,
    osrSerialConnected,
    resetHandyAutoPlayState,
    settings.handyAutoPlayAfterSync,
    stopButtplugPlayback,
    stopOsrSerialPlayback,
  ])

  const applyDroppedScriptToMedia = useCallback(async (
    scriptPath: string,
    matchedMediaPath: string,
    shouldAutoplay: boolean
  ) => {
    const matchedMediaType = getMediaTypeFromPath(matchedMediaPath)
    if (!matchedMediaType) {
      return false
    }

    setManualScriptPaths((prev) => ({ ...prev, [matchedMediaPath]: scriptPath }))
    if (matchedMediaPath === currentFileRef.current) {
      await refreshCurrentScriptBundle(matchedMediaPath, scriptPath)
      void loadScriptVariants(matchedMediaPath)
        .then((nextScriptVariants) => {
          if (currentFileRef.current !== matchedMediaPath) {
            return
          }

          setScriptVariants(nextScriptVariants)
        })
        .catch(() => {})
      return true
    }

    await openMediaFile(matchedMediaPath, matchedMediaType, {
      autoplay: shouldAutoplay,
      preferredScriptPath: scriptPath,
    })
    return true
  }, [loadScriptVariants, openMediaFile, refreshCurrentScriptBundle])

  const handleScriptMatchDialogSelect = useCallback(async (mediaPath: string) => {
    const pendingMatch = scriptMatchDialog
    if (!pendingMatch) {
      return
    }

    closeScriptMatchDialog()
    const shouldAutoplay = settings.handyAutoPlayAfterSync && deviceProvider === 'handy' && handyConnected
    await applyDroppedScriptToMedia(pendingMatch.scriptPath, mediaPath, shouldAutoplay)
  }, [
    applyDroppedScriptToMedia,
    closeScriptMatchDialog,
    deviceProvider,
    handyConnected,
    scriptMatchDialog,
    settings.handyAutoPlayAfterSync,
  ])

  const handleFileSelect = useCallback(async (file: VideoFile) => {
    resetShufflePlaybackStacks()
    await openMediaFile(file.path, file.type, {
      autoplay: settings.handyAutoPlayAfterSync && deviceProvider === 'handy' && handyConnected,
      preferredScriptPath: file.autoScriptPath,
    })
  }, [deviceProvider, handyConnected, openMediaFile, resetShufflePlaybackStacks, settings.handyAutoPlayAfterSync])

  const handleNextFile = useCallback(async (options?: { autoplay?: boolean }) => {
    const shouldAutoplay = options?.autoplay ?? Boolean(mediaRef.current && !mediaRef.current.paused)

    if (playbackMode === 'shuffle') {
      const activeFilePath = currentFileRef.current
      if (!activeFilePath || orderedFiles.length <= 1) return

      const history = shufflePlaybackHistoryRef.current
      let future = shufflePlaybackFutureRef.current
      let nextFile: VideoFile | null = null
      const futurePath = future[future.length - 1]

      if (futurePath && futurePath !== activeFilePath) {
        const futureFile = fileEntryByPath.get(futurePath)
        if (futureFile) {
          nextFile = futureFile
          future = future.slice(0, -1)
        } else {
          future = future.filter((filePath) => fileEntryByPath.has(filePath))
        }
      }

      const nextHistory = appendShufflePlaybackHistory(history, activeFilePath)
      if (!nextFile) {
        nextFile = getRandomShufflePlaybackFile(activeFilePath, nextHistory)
        future = []
      }
      if (!nextFile) return

      await openMediaFile(nextFile.path, nextFile.type, {
        autoplay: shouldAutoplay,
        preferredScriptPath: nextFile.autoScriptPath,
      })
      commitShufflePlaybackStacks(nextHistory, future)
      return
    }

    const nextFile = getAdjacentVideoFile(orderedFiles, currentFile, 'next')
    if (!nextFile) return

    await openMediaFile(nextFile.path, nextFile.type, {
      autoplay: shouldAutoplay,
      preferredScriptPath: nextFile.autoScriptPath,
    })
  }, [
    appendShufflePlaybackHistory,
    commitShufflePlaybackStacks,
    currentFile,
    fileEntryByPath,
    getRandomShufflePlaybackFile,
    openMediaFile,
    orderedFiles,
    playbackMode,
  ])

  const handlePreviousFile = useCallback(async (options?: { autoplay?: boolean }) => {
    const shouldAutoplay = options?.autoplay ?? Boolean(mediaRef.current && !mediaRef.current.paused)

    if (playbackMode === 'shuffle') {
      const activeFilePath = currentFileRef.current
      let nextHistory = shufflePlaybackHistoryRef.current
      if (!activeFilePath || nextHistory.length === 0) return

      let previousFile: VideoFile | null = null
      while (!previousFile && nextHistory.length > 0) {
        const previousPath = nextHistory[nextHistory.length - 1]
        nextHistory = nextHistory.slice(0, -1)
        if (previousPath !== activeFilePath) {
          previousFile = fileEntryByPath.get(previousPath) ?? null
        }
      }

      if (!previousFile) {
        commitShufflePlaybackStacks(nextHistory, shufflePlaybackFutureRef.current)
        return
      }

      const nextFuture = [
        ...shufflePlaybackFutureRef.current.filter((filePath) => filePath !== activeFilePath),
        activeFilePath,
      ]

      await openMediaFile(previousFile.path, previousFile.type, {
        autoplay: shouldAutoplay,
        preferredScriptPath: previousFile.autoScriptPath,
      })
      commitShufflePlaybackStacks(nextHistory, nextFuture)
      return
    }

    const previousFile = getAdjacentVideoFile(orderedFiles, currentFile, 'previous')
    if (!previousFile) return

    await openMediaFile(previousFile.path, previousFile.type, {
      autoplay: shouldAutoplay,
      preferredScriptPath: previousFile.autoScriptPath,
    })
  }, [
    commitShufflePlaybackStacks,
    currentFile,
    fileEntryByPath,
    openMediaFile,
    orderedFiles,
    playbackMode,
  ])

  useEffect(() => {
    remoteAccessoryClient.setCommandHandler(async (command: RemoteCommandId) => {
      const media = mediaRef.current
      const seekBy = (deltaSeconds: number) => {
        if (!media) return
        const duration = Number.isFinite(media.duration) ? media.duration : Number.POSITIVE_INFINITY
        media.currentTime = Math.max(0, Math.min(duration, media.currentTime + deltaSeconds))
      }
      const changeVolume = (delta: number) => {
        if (!media) return
        media.volume = Math.max(0, Math.min(1, media.volume + delta))
      }
      const changeScriptOffset = (deltaMs: number) => {
        const mediaPath = currentFileRef.current
        if (!mediaPath) return
        setScriptOffsets((prev) => ({
          ...prev,
          [mediaPath]: Math.max(-5000, Math.min(5000, (prev[mediaPath] ?? 0) + deltaMs)),
        }))
      }

      switch (command) {
        case 'play_pause':
          if (!media) return
          if (media.paused) {
            await media.play().catch(() => undefined)
          } else {
            media.pause()
          }
          break
        case 'next_video':
          await handleNextFile()
          break
        case 'previous_video':
          await handlePreviousFile()
          break
        case 'seek_forward_5s':
          seekBy(5)
          break
        case 'seek_backward_5s':
          seekBy(-5)
          break
        case 'seek_forward_10s':
          seekBy(10)
          break
        case 'seek_backward_10s':
          seekBy(-10)
          break
        case 'volume_up':
          changeVolume(0.08)
          break
        case 'volume_down':
          changeVolume(-0.08)
          break
        case 'toggle_mute':
          if (media) media.muted = !media.muted
          break
        case 'toggle_fullscreen':
          if (document.fullscreenElement) {
            await document.exitFullscreen().catch(() => undefined)
          } else {
            await document.documentElement.requestFullscreen().catch(() => undefined)
          }
          break
        case 'toggle_fit_fill':
          window.dispatchEvent(new CustomEvent('scriptplayer:remote-command', { detail: { command } }))
          break
        case 'script_offset_plus_50':
          changeScriptOffset(50)
          break
        case 'script_offset_minus_50':
          changeScriptOffset(-50)
          break
        case 'reset_script_offset': {
          const mediaPath = currentFileRef.current
          if (!mediaPath) return
          setScriptOffsets((prev) => {
            const next = { ...prev }
            delete next[mediaPath]
            return next
          })
          break
        }
        case 'toggle_loop':
          setLoopCurrentMedia((prev) => !prev)
          break
        case 'toggle_shuffle':
          setPlaybackMode((prev) => (prev === 'shuffle' ? 'none' : 'shuffle'))
          break
        case 'open_settings':
          setSettingsSection('remote')
          setSettingsOpen(true)
          break
        case 'device_stop':
          media?.pause()
          break
      }
    })

    return () => {
      remoteAccessoryClient.setCommandHandler(null)
    }
  }, [handleNextFile, handlePreviousFile])

  useEffect(() => {
    if (!remoteAccessoryState.connected || !remoteAccessoryState.paired) {
      return
    }

    const tick = () => {
      const media = mediaRef.current
      void remoteAccessoryClient.sendPlaybackState({
        playing: Boolean(media && !media.paused && !media.ended),
        title: currentFile ? getFileName(currentFile) : 'ScriptPlayer+',
        positionMs: media && Number.isFinite(media.currentTime) ? media.currentTime * 1000 : 0,
        durationMs: Number.isFinite(mediaDurationSeconds) ? mediaDurationSeconds * 1000 : 0,
      })
    }

    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [
    currentFile,
    mediaDurationSeconds,
    remoteAccessoryState.connected,
    remoteAccessoryState.paired,
  ])

  useEffect(() => {
    if (!remoteAccessoryState.connected || !remoteAccessoryState.paired) {
      return
    }

    const media = mediaRef.current
    if (!currentFile || currentFileType !== 'video' || !videoUrl || !(media instanceof HTMLVideoElement)) {
      void remoteAccessoryClient.clearThumbnail()
      return
    }

    let cancelled = false
    const thumbnailId = `${currentFile}:${mediaSessionKey}`

    const sendThumbnail = async () => {
      await waitForMediaReady(media, 4000).catch(() => false)
      if (cancelled) return
      await remoteAccessoryClient.sendVideoThumbnail(media, thumbnailId)
    }

    const timer = window.setTimeout(() => {
      void sendThumbnail()
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    currentFile,
    currentFileType,
    mediaSessionKey,
    remoteAccessoryState.connected,
    remoteAccessoryState.paired,
    videoUrl,
  ])

  const handleManualScriptSelect = useCallback(async (file: VideoFile) => {
    const scriptPath = await window.electronAPI.openScriptFile()
    if (!scriptPath) return

    setManualScriptPaths((prev) => ({ ...prev, [file.path]: scriptPath }))

    if (currentFile === file.path) {
      await refreshCurrentScriptBundle(file.path, scriptPath)
    }
  }, [currentFile, refreshCurrentScriptBundle])

  const handleManualSubtitleSelect = useCallback(async (file: VideoFile) => {
    const subtitlePath = await window.electronAPI.openSubtitleFile()
    if (!subtitlePath) return

    const subtitleFile = await window.electronAPI.readSubtitleFile(subtitlePath)
    if (!subtitleFile) return
    const cues = parseSubtitleFile(subtitleFile.content, subtitleFile.path)
    if (cues.length === 0) return

    setManualSubtitleFiles((prev) => ({ ...prev, [file.path]: subtitleFile }))

    if (currentFile === file.path) {
      setSubtitleCues(cues)
    }
  }, [currentFile])

  const handleClearManualScript = useCallback(async (file: VideoFile) => {
    setManualScriptPaths((prev) => {
      const next = { ...prev }
      delete next[file.path]
      return next
    })

    if (currentFile === file.path) {
      await refreshCurrentScriptBundle(file.path, file.autoScriptPath)
    }
  }, [currentFile, refreshCurrentScriptBundle])

  const handleQuickScriptVariantSelect = useCallback(async (scriptPath: string) => {
    const mediaPath = currentFileRef.current
    if (!mediaPath) return

    setManualScriptPaths((prev) => ({ ...prev, [mediaPath]: scriptPath }))
    await refreshCurrentScriptBundle(mediaPath, scriptPath)
  }, [refreshCurrentScriptBundle])

  const handleQuickScriptVariantReset = useCallback(async () => {
    const file = currentSidebarFile
    if (!file) return

    setManualScriptPaths((prev) => {
      const next = { ...prev }
      delete next[file.path]
      return next
    })

    await refreshCurrentScriptBundle(file.path, file.autoScriptPath)
  }, [currentSidebarFile, refreshCurrentScriptBundle])

  const handleCurrentScriptReload = useCallback(async (scriptPath: string) => {
    const mediaPath = currentFileRef.current
    if (!mediaPath || !scriptPath || scriptPath.startsWith('generated://')) {
      return
    }

    await refreshCurrentScriptBundle(mediaPath, scriptPath)
    const nextScriptVariants = await loadScriptVariants(mediaPath)
    if (currentFileRef.current === mediaPath) {
      setScriptVariants(nextScriptVariants)
    }
  }, [loadScriptVariants, refreshCurrentScriptBundle])

  const handleClearManualSubtitle = useCallback(async (file: VideoFile) => {
    setManualSubtitleFiles((prev) => {
      const next = { ...prev }
      delete next[file.path]
      return next
    })

    if (currentFile === file.path) {
      const subtitleFiles = await window.electronAPI.readSubtitles(file.path)
      setSubtitleCues(selectSubtitleCues(file.path, file.type, subtitleFiles))
    }
  }, [currentFile])

  const handleHandyConnect = async (key: string) => {
    const connected = await handyService.connect(key)
    setHandyConnected(connected)
  }

  const handleHandyDisconnect = async () => {
    cancelPendingHandySync()
    resetHandyAutoPlayState()
    handyService.cancelPendingRequests()
    await handyService.hsspStop()
    handyService.disconnect()
    setHandyConnected(false)
    setScriptUploadUrl(null)
  }

  const handleButtplugConnect = async (url: string) => {
    const trimmedUrl = url.trim()
    setButtplugServerUrl(trimmedUrl)
    await buttplugService.connect(trimmedUrl)
  }

  const handleButtplugDisconnect = async () => {
    await stopButtplugPlayback({ stopDevice: true })
    await buttplugService.disconnect()
  }

  const handleButtplugScan = async () => {
    await buttplugService.startScanning()
    await buttplugService.refreshDevices()
  }

  const handleOsrSerialRefresh = async () => {
    await osrSerialService.refreshPorts()
  }

  const handleOsrSerialConnect = async (portPath: string) => {
    const trimmedPath = portPath.trim()
    setSelectedOsrSerialPortPath(trimmedPath)
    if (!trimmedPath) {
      setOsrSerialError('Select a serial port.')
      setOsrSerialConnectionState('error')
      return
    }

    const connected = await osrSerialService.connect(trimmedPath, DEFAULT_OSR_SERIAL_BAUD_RATE)
    if (connected && osrSerialProfile === 'craftyHandySr6') {
      osrSerialFirstCommandReadyAtRef.current = Date.now() + CRAFTY_HANDY_SR6_FIRST_COMMAND_GRACE_MS
    }
  }

  const handleOsrSerialDisconnect = async () => {
    await stopOsrSerialPlayback({ homeDevice: true })
    await osrSerialService.disconnect()
  }

  const handleResetIntifaceSettings = useCallback(async () => {
    try {
      await stopButtplugPlayback({ stopDevice: true })
    } catch {
      // Continue resetting local settings even if the device stop command fails.
    }

    try {
      if (buttplugService.isConnected) {
        await buttplugService.disconnect()
      }
    } catch {
      // Connection state callbacks will settle if disconnect fails.
    }

    removeStorageKeys(INTIFACE_RESET_STORAGE_KEYS)
    setButtplugServerUrlState(DEFAULT_BUTTPLUG_SERVER_URL)
    setSelectedButtplugDeviceIndexState(null)
    setButtplugFeatureMappingStore({})
    setButtplugDevices([])
    setButtplugError(null)
    setButtplugScanning(false)
    clearButtplugStreamTimer()
  }, [clearButtplugStreamTimer, stopButtplugPlayback])

  const handleResetAllSettings = useCallback(async () => {
    const defaultAppSettings = createDefaultAppSettings()

    try {
      await handleResetIntifaceSettings()
    } catch {
      // Keep the rest of the reset available even if Intiface cleanup fails.
    }

    try {
      await stopOsrSerialPlayback({ homeDevice: true })
    } catch {
      // Continue resetting local settings even if homing fails.
    }

    try {
      if (osrSerialService.connected) {
        await osrSerialService.disconnect()
      }
    } catch {
      // Ignore disconnect failures during reset.
    }

    removeStorageKeys(APP_RESET_STORAGE_KEYS)
    setDeviceCompatibilityPreset('auto')
    saveSettings(defaultAppSettings)
    saveScriptOffsets({})
    clearStoredCurrentPlaylist()

    setSettings(defaultAppSettings)
    setPlaybackMode('sequential')
    setLoopCurrentMedia(false)
    setPlaybackRate(1)
    setVideoSort(DEFAULT_VIDEO_SORT)
    setDeviceProvider('handy')
    setSelectedOsrSerialPortPathState('')
    setOsrSerialUpdateRateState(DEFAULT_OSR_SERIAL_UPDATE_RATE)
    setOsrSerialProfile('sr6')
    setOsrSerialAxisConfigs(normalizeOsrSerialAxisConfigs({}))
    setOsrSerialPorts([])
    setOsrSerialError(null)
    setOsrSerialConnectionState('disconnected')
    setScriptOffsets({})
    setManualScriptPaths({})
    setManualSubtitleFiles({})
    setScriptVariants([])
    setScriptMatchDialog(null)
    setFunscriptBundle(null)
    setSubtitleCues([])
    setScriptUploadUrl(null)
    setHandyUploadStatus('idle')
    setHandyUploadError(null)
    resetHandyAutoPlayState()
    clearOsrSerialStreamTimer()

    setCurrentFile(null)
    setCurrentFileType(null)
    setVideoUrl(null)
    setArtworkUrl(null)
    setMediaDurationSeconds(0)
    setMediaSessionKey((key) => key + 1)
    setFiles([])
    setPlaylistMode(false)
    setPlaylistName('')
    setPlaylistFilePath(undefined)
    currentFolderPathRef.current = null
  }, [
    clearOsrSerialStreamTimer,
    handleResetIntifaceSettings,
    resetHandyAutoPlayState,
    stopOsrSerialPlayback,
  ])

  const handlePlay = useCallback(async () => {
    const media = mediaRef.current
    if (!media) return
    if (deviceProvider === 'handy') {
      if (skipNextHandyPlaySyncRef.current) {
        skipNextHandyPlaySyncRef.current = false
        return
      }
      await syncHandyPlaybackToCurrentMedia()
      return
    }

    if (deviceProvider === 'buttplug') {
      await startButtplugPlayback()
      return
    }

    if (deviceProvider === 'serial') {
      await startOsrSerialPlayback()
    }
  }, [deviceProvider, startButtplugPlayback, startOsrSerialPlayback, syncHandyPlaybackToCurrentMedia])

  const handlePause = useCallback(async () => {
    devicePauseSuppressUntilRef.current = Date.now() + getDevicePauseSuppressDurationMs(deviceCompatibilityPreset)

    if (deviceProvider === 'handy' && handyService.isConnected) {
      cancelPendingHandySync()
      resetHandyAutoPlayState()
      await handyService.hsspStop()
      return
    }

    if (deviceProvider === 'buttplug' && buttplugService.isConnected) {
      await stopButtplugPlayback({ stopDevice: true })
      return
    }

    if (deviceProvider === 'serial' && osrSerialConnected) {
      await stopOsrSerialPlayback({ homeDevice: false })
    }
  }, [cancelPendingHandySync, deviceCompatibilityPreset, deviceProvider, osrSerialConnected, resetHandyAutoPlayState, stopButtplugPlayback, stopOsrSerialPlayback])

  const syncDevicesAfterSeek = useCallback(async () => {
    if (deviceProvider === 'handy' && handyService.isConnected && scriptUploadUrl) {
      const media = mediaRef.current
      if (media && !media.paused) {
        await syncHandyPlaybackToCurrentMedia({ stopFirst: true })
      }
      return
    }

    if (deviceProvider === 'buttplug' && buttplugService.isConnected) {
      const media = mediaRef.current
      if (media && !media.paused) {
        await startButtplugPlayback()
      }
      return
    }

    if (deviceProvider === 'serial' && osrSerialConnected) {
      const media = mediaRef.current
      if (media && !media.paused) {
        await startOsrSerialPlayback()
      }
    }
  }, [deviceProvider, osrSerialConnected, scriptUploadUrl, startButtplugPlayback, startOsrSerialPlayback, syncHandyPlaybackToCurrentMedia])

  const performAutoSkip = useCallback(async (targetTimeSeconds: number) => {
    const media = mediaRef.current
    if (!media || media.paused) return

    autoSkipCooldownUntilRef.current = Date.now() + AUTO_SKIP_COOLDOWN_MS
    media.currentTime = targetTimeSeconds
    await syncDevicesAfterSeek()
  }, [syncDevicesAfterSeek])

  const handleSeek = useCallback(
    async (_time: number) => {
      autoSkipSuppressedUntilRef.current = Date.now() + AUTO_SKIP_AFTER_SEEK_SUPPRESS_MS
      await syncDevicesAfterSeek()
    },
    [syncDevicesAfterSeek]
  )

  useEffect(() => {
    if (buttplugIdleKeepAliveTimer.current) {
      clearInterval(buttplugIdleKeepAliveTimer.current)
      buttplugIdleKeepAliveTimer.current = null
    }

    if (deviceProvider !== 'buttplug' || !buttplugConnected || !selectedButtplugDevice) {
      return
    }

    const deviceIndex = selectedButtplugDevice.index
    const hasRawTCodeEndpoint = selectedButtplugDevice.rawWriteEndpoints.length > 0
    const tick = () => {
      const media = mediaRef.current
      if (media && !media.paused) return
      if (media && media.paused && Date.now() < devicePauseSuppressUntilRef.current) return

      if (hasRawTCodeEndpoint) {
        const axisIds = availableScriptAxes.length > 0 ? availableScriptAxes : ['L0' as ScriptAxisId]
        const currentTimeMs = media ? media.currentTime * 1000 + effectiveDeviceTimeOffset : 0
        const command = buildTCodeCommand(runtimeAxisActions, currentTimeMs, { axisIds })
          ?? buildDefaultTCodeCommand(axisIds)
        if (command) {
          void buttplugService.sendRawCommand(deviceIndex, command)
        }
        return
      }

      void buttplugService.stopDevice(deviceIndex)
    }

    tick()
    buttplugIdleKeepAliveTimer.current = setInterval(
      tick,
      getButtplugIdleKeepAliveIntervalMs(deviceCompatibilityPreset)
    )

    return () => {
      if (buttplugIdleKeepAliveTimer.current) {
        clearInterval(buttplugIdleKeepAliveTimer.current)
        buttplugIdleKeepAliveTimer.current = null
      }
    }
  }, [
    availableScriptAxes,
    buttplugConnected,
    deviceCompatibilityPreset,
    deviceProvider,
    effectiveDeviceTimeOffset,
    runtimeAxisActions,
    selectedButtplugDevice,
  ])

  useEffect(() => {
    if (osrSerialIdleKeepAliveTimer.current) {
      clearInterval(osrSerialIdleKeepAliveTimer.current)
      osrSerialIdleKeepAliveTimer.current = null
    }

    if (deviceProvider !== 'serial' || !osrSerialConnected) {
      return
    }

    const tick = () => {
      const media = mediaRef.current
      if (media && !media.paused) return
      if (media && media.paused && Date.now() < devicePauseSuppressUntilRef.current) return

      const currentTimeMs = media ? media.currentTime * 1000 + effectiveDeviceTimeOffset : 0
      const command = buildTCodeCommand(runtimeAxisActions, currentTimeMs, {
        axisIds: availableOsrSerialAxes,
        axisOutputOptions: osrSerialAxisOutputOptions,
        ...osrSerialTCodeCommandOptions,
      }) ?? buildDefaultTCodeCommand(availableOsrSerialAxes, {
        axisOutputOptions: osrSerialAxisOutputOptions,
        ...osrSerialTCodeCommandOptions,
      })
      if (command) {
        void waitForOsrSerialFirstCommandReady().then(() => {
          void osrSerialService.writeCommand(command)
        })
        return
      }
    }

    tick()
    osrSerialIdleKeepAliveTimer.current = setInterval(
      tick,
      getOsrSerialIdleKeepAliveIntervalMs(deviceCompatibilityPreset)
    )

    return () => {
      if (osrSerialIdleKeepAliveTimer.current) {
        clearInterval(osrSerialIdleKeepAliveTimer.current)
        osrSerialIdleKeepAliveTimer.current = null
      }
    }
  }, [
    availableOsrSerialAxes,
    deviceCompatibilityPreset,
    deviceProvider,
    effectiveDeviceTimeOffset,
    osrSerialAxisOutputOptions,
    osrSerialConnected,
    osrSerialTCodeCommandOptions,
    runtimeAxisActions,
    waitForOsrSerialFirstCommandReady,
  ])

  const handleTimeUpdate = useCallback((time: number) => {
    const media = mediaRef.current
    if (
      !media
      || media.paused
      || media.seeking
      || handyAutoPlaySyncInProgressRef.current
      || !settings.autoSkipScriptGaps
      || !autoSkipMotionModel.hasActions
      || autoSkipMotionModel.motionTimes.length === 0
    ) {
      return
    }

    const now = Date.now()
    if (now < autoSkipSuppressedUntilRef.current || now < autoSkipCooldownUntilRef.current) {
      return
    }

    const targetTimeMs = findAutoSkipTargetMs(
      autoSkipMotionModel.motionTimes,
      time * 1000,
      settings.autoSkipGapMinDuration * 1000,
      settings.autoSkipGapLeadIn * 1000,
      Number.isFinite(media.duration) ? media.duration * 1000 : undefined
    )
    if (targetTimeMs === null) {
      return
    }

    if (Number.isFinite(media.duration) && targetTimeMs >= media.duration * 1000 - AUTO_SKIP_TARGET_EPSILON_MS) {
      return
    }

    void performAutoSkip(targetTimeMs / 1000)
  }, [
    autoSkipMotionModel,
    performAutoSkip,
    settings.autoSkipGapLeadIn,
    settings.autoSkipGapMinDuration,
    settings.autoSkipScriptGaps,
  ])

  const handleEnded = useCallback(async () => {
    if (playbackMode === 'shuffle') {
      const activeFilePath = currentFileRef.current
      if (!activeFilePath || orderedFiles.length <= 1) return

      const nextHistory = appendShufflePlaybackHistory(shufflePlaybackHistoryRef.current, activeFilePath)
      const nextFile = getRandomShufflePlaybackFile(activeFilePath, nextHistory)
      if (!nextFile) return

      await openMediaFile(nextFile.path, nextFile.type, {
        autoplay: true,
        preferredScriptPath: nextFile.autoScriptPath,
      })
      commitShufflePlaybackStacks(nextHistory, [])
      return
    }

    const nextFile = getNextPlaybackFile(orderedFiles, currentFile, playbackMode)
    if (!nextFile) return
    await openMediaFile(nextFile.path, nextFile.type, {
      autoplay: true,
      preferredScriptPath: nextFile.autoScriptPath,
    })
  }, [
    appendShufflePlaybackHistory,
    commitShufflePlaybackStacks,
    currentFile,
    getRandomShufflePlaybackFile,
    openMediaFile,
    orderedFiles,
    playbackMode,
  ])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (scriptMatchDialog && e.key === 'Escape') {
        e.preventDefault()
        closeScriptMatchDialog()
        return
      }

      if (isEditableShortcutTarget(e.target)) return
      if (scriptMatchDialog) return

      const action = findMatchingShortcutAction(e, settings.keyboardShortcuts, APP_SHORTCUT_ACTIONS)
      if (!action) return

      e.preventDefault()

      if (action === 'openSettings') {
        if (settingsOpen) {
          setSettingsOpen(false)
          return
        }

        openSettingsSection('general')
        return
      }

      if (settingsOpen) {
        return
      }

      if (action === 'openFolder') {
        void handleOpenFolder()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeScriptMatchDialog, handleOpenFolder, openSettingsSection, scriptMatchDialog, settings.keyboardShortcuts, settingsOpen])

  useEffect(() => {
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      const droppedFiles = e.dataTransfer?.files
      if (!droppedFiles || droppedFiles.length === 0) return

      const file = droppedFiles[0]
      const path = window.electronAPI.getDroppedFilePath(file) || (file as any).path as string
      if (!path) return

      const shouldAutoplay = settings.handyAutoPlayAfterSync && deviceProvider === 'handy' && handyConnected
      const droppedPaths = Array.from(droppedFiles)
        .map((entry) => window.electronAPI.getDroppedFilePath(entry) || (entry as any).path as string)
        .filter((value): value is string => Boolean(value))
      const droppedMediaPaths = droppedPaths.filter((value) => Boolean(getMediaTypeFromPath(value)))

      if (droppedMediaPaths.length > 1) {
        const mediaFiles = await window.electronAPI.inspectMediaFiles(droppedMediaPaths, scriptFolderRef.current || undefined)
        if (mediaFiles.length > 0) {
          currentFolderPathRef.current = null
          setPlaylistMode(true)
          setPlaylistFilePath(undefined)
          setPlaylistName((current) => current || t('sidebar.unsavedPlaylist'))
          setFiles((current) => mergeFilesByPath(current, mediaFiles))
          showAppFeedback({
            tone: 'success',
            text: t('drop.mediaAdded', { count: mediaFiles.length.toString() }),
          })
        }
        return
      }

      const mediaType = getMediaTypeFromPath(path)
      if (mediaType) {
        setScriptMatchDialog(null)
        await openMediaFile(path, mediaType, { autoplay: shouldAutoplay })
        return
      }

      if (!isScriptFilePath(path)) return

      const candidateMediaPaths = Array.from(new Set([
        ...files.map((entry) => entry.path),
        currentFileRef.current,
      ].filter((value): value is string => Boolean(value))))
      const matchedMediaPath = await window.electronAPI.findMediaForScript(
        path,
        candidateMediaPaths,
        currentFileRef.current || undefined
      )
      if (matchedMediaPath) {
        setScriptMatchDialog(null)
        await applyDroppedScriptToMedia(path, matchedMediaPath, shouldAutoplay)
        showAppFeedback({
          tone: 'success',
          text: matchedMediaPath === currentFileRef.current
            ? t('drop.scriptAppliedCurrent')
            : t('drop.scriptAppliedToMedia', { name: getFileName(matchedMediaPath) }),
        })
        return
      }

      const matchCandidates = await window.electronAPI.listMediaMatchesForScript(
        path,
        candidateMediaPaths,
        currentFileRef.current || undefined
      )
      if (matchCandidates.length === 1) {
        setScriptMatchDialog(null)
        await applyDroppedScriptToMedia(path, matchCandidates[0].path, shouldAutoplay)
        showAppFeedback({
          tone: 'success',
          text: matchCandidates[0].path === currentFileRef.current
            ? t('drop.scriptAppliedCurrent')
            : t('drop.scriptAppliedToMedia', { name: getFileName(matchCandidates[0].path) }),
        })
        return
      }

      if (matchCandidates.length > 1) {
        setScriptMatchDialog({
          scriptPath: path,
          candidates: matchCandidates.slice(0, 6),
        })
        showAppFeedback({
          tone: 'info',
          text: t('drop.scriptChooseMedia'),
        })
        return
      }

      showAppFeedback({
        tone: 'error',
        text: t('drop.scriptNoMatch'),
      })
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
    }

    window.addEventListener('drop', handleDrop)
    window.addEventListener('dragover', handleDragOver)
    return () => {
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('dragover', handleDragOver)
    }
  }, [
    applyDroppedScriptToMedia,
    deviceProvider,
    files,
    handyConnected,
    mergeFilesByPath,
    openMediaFile,
    settings.handyAutoPlayAfterSync,
    showAppFeedback,
    t,
  ])

  useEffect(() => {
    if (playlistMode) {
      return
    }

    if (settings.defaultVideoFolder) {
      void loadFolderFiles(settings.defaultVideoFolder)
    }
  }, [loadFolderFiles, playlistMode, settings.defaultVideoFolder])

  useEffect(() => {
    if (playlistMode) {
      return
    }

    const currentFolderPath = currentFolderPathRef.current
    if (!currentFolderPath) {
      return
    }

    void loadFolderFiles(currentFolderPath)
  }, [loadFolderFiles, playlistMode, settings.scriptFolder])

  useEffect(() => {
    const mediaPath = currentFileRef.current
    if (!mediaPath) {
      return
    }

    const preferredScriptPath = manualScriptPathsRef.current[mediaPath]
    let cancelled = false

    void refreshCurrentScriptBundle(mediaPath, preferredScriptPath)
    void loadScriptVariants(mediaPath)
      .then((nextScriptVariants) => {
        if (cancelled || currentFileRef.current !== mediaPath) {
          return
        }

        setScriptVariants(nextScriptVariants)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [loadScriptVariants, refreshCurrentScriptBundle, settings.scriptFolder])

  useEffect(() => {
    if (deviceProvider !== 'handy' || !handyConnected) {
      if (handyService.isConnected) {
        cancelPendingHandySync()
        resetHandyAutoPlayState()
        handyService.cancelPendingRequests()
        void handyService.hsspStop()
      }
      setScriptUploadUrl(null)
      return
    }

    if (handyActions.length === 0) {
      if (!waitingForGeneratedHandyScript) {
        if (handyService.isConnected) {
          cancelPendingHandySync()
          resetHandyAutoPlayState()
          handyService.cancelPendingRequests()
          void handyService.hsspStop()
        }
      }
      setScriptUploadUrl(null)
      return
    }

    let cancelled = false
    const requestId = ++handyUploadRequestId.current

    setScriptUploadUrl(null)

    const runUpload = async () => {
      cancelPendingHandySync()
      handyService.cancelPendingRequests()
      await handyService.hsspStop()
      const url = await handyService.uploadAndSetup(handyActions)
      if (cancelled || requestId !== handyUploadRequestId.current) {
        return
      }

      setScriptUploadUrl(url)
    }

    void runUpload()

    return () => {
      cancelled = true
    }
  }, [
    cancelPendingHandySync,
    deviceProvider,
    effectiveDeviceTimeOffset,
    handyActions,
    handyConnected,
    resetHandyAutoPlayState,
    waitingForGeneratedHandyScript,
  ])

  useEffect(() => {
    if (
      !pendingAutoPlayAfterHandyUpload
      || deviceProvider !== 'handy'
      || !handyConnected
      || !settings.handyAutoPlayAfterSync
      || !scriptUploadUrl
      || handyUploadStatus !== 'ready'
    ) {
      return
    }

    let cancelled = false
    const runId = ++handyAutoPlayRunId.current

    const runAutoPlay = async () => {
      const started = await syncHandyAndPlayMedia()
      if (cancelled || runId !== handyAutoPlayRunId.current) {
        return
      }

      if (started) {
        pendingAutoPlayAfterHandyUploadRef.current = false
        setPendingAutoPlayAfterHandyUpload(false)
      }
    }

    void runAutoPlay()

    return () => {
      cancelled = true
    }
  }, [
    deviceProvider,
    handyConnected,
    handyUploadStatus,
    pendingAutoPlayAfterHandyUpload,
    scriptUploadUrl,
    settings.handyAutoPlayAfterSync,
    syncHandyAndPlayMedia,
  ])

  useEffect(() => {
    if (deviceProvider !== 'handy' || !handyConnected || !scriptUploadUrl) return
    const media = mediaRef.current
    if (!media || media.paused) return
    void syncHandyPlaybackToCurrentMedia()
  }, [deviceProvider, handyConnected, scriptUploadUrl, syncHandyPlaybackToCurrentMedia])

  const scriptMatchDialogItems = useMemo(() => {
    if (!scriptMatchDialog) {
      return []
    }

    return scriptMatchDialog.candidates.map((candidate) => {
      const matchingFile = fileEntryByPath.get(candidate.path)
      const subtitle = matchingFile?.relativePath && matchingFile.relativePath !== matchingFile.name
        ? matchingFile.relativePath
        : candidate.path
      const badge = candidate.path === currentFile
        ? t('scriptMatch.currentMedia')
        : (candidate.sourcePriority >= 2 ? t('scriptMatch.sameFolder') : t('scriptMatch.library'))

      return {
        path: candidate.path,
        title: getFileName(candidate.path),
        subtitle,
        badge,
      }
    })
  }, [currentFile, fileEntryByPath, scriptMatchDialog, t])

  useEffect(() => {
    if (buttplugDevices.length === 0) {
      return
    }

    if (selectedButtplugDeviceIndex !== null && buttplugDevices.some((device) => device.index === selectedButtplugDeviceIndex)) {
      return
    }

    setSelectedButtplugDeviceIndex(buttplugDevices[0].index)
  }, [buttplugDevices, selectedButtplugDeviceIndex, setSelectedButtplugDeviceIndex])

  useEffect(() => {
    if (osrSerialPorts.length === 0) {
      if (selectedOsrSerialPortPath) {
        setSelectedOsrSerialPortPath('')
      }
      return
    }

    if (selectedOsrSerialPortPath && osrSerialPorts.some((port) => port.path === selectedOsrSerialPortPath)) {
      return
    }

    setSelectedOsrSerialPortPath(osrSerialPorts[0].path)
  }, [osrSerialPorts, selectedOsrSerialPortPath, setSelectedOsrSerialPortPath])

  useEffect(() => {
    if (deviceProvider === 'serial') {
      void osrSerialService.refreshPorts()
    }
  }, [deviceProvider])

  useEffect(() => {
    if (deviceProvider === 'handy') {
      void stopButtplugPlayback({ stopDevice: true }).then(() => {
        if (buttplugService.isConnected) {
          void buttplugService.disconnect()
        }
      })
      void stopOsrSerialPlayback({ homeDevice: osrSerialConnected }).then(() => {
        if (osrSerialConnected) {
          void osrSerialService.disconnect()
        }
      })
      return
    }

    if (deviceProvider === 'buttplug') {
      if (handyService.isConnected) {
        cancelPendingHandySync()
        resetHandyAutoPlayState()
        handyService.cancelPendingRequests()
        void handyService.hsspStop().finally(() => {
          handyService.disconnect()
          setHandyConnected(false)
          setScriptUploadUrl(null)
        })
      }
      void stopOsrSerialPlayback({ homeDevice: osrSerialConnected }).then(() => {
        if (osrSerialConnected) {
          void osrSerialService.disconnect()
        }
      })
      return
    }

    if (deviceProvider === 'serial') {
      void stopButtplugPlayback({ stopDevice: true }).then(() => {
        if (buttplugService.isConnected) {
          void buttplugService.disconnect()
        }
      })
      if (handyService.isConnected) {
        cancelPendingHandySync()
        resetHandyAutoPlayState()
        handyService.cancelPendingRequests()
        void handyService.hsspStop().finally(() => {
          handyService.disconnect()
          setHandyConnected(false)
          setScriptUploadUrl(null)
        })
      }
    }
  }, [cancelPendingHandySync, deviceProvider, osrSerialConnected, resetHandyAutoPlayState, stopButtplugPlayback, stopOsrSerialPlayback])

  useEffect(() => {
    if (
      deviceProvider !== 'buttplug'
      || !buttplugConnected
      || !selectedButtplugDevice
      || availableScriptAxes.length === 0
    ) {
      void stopButtplugPlayback({ stopDevice: true })
      return
    }

    const media = mediaRef.current
    if (!media || media.paused) return
    void startButtplugPlayback()
  }, [
    availableScriptAxes.length,
    buttplugConnected,
    deviceProvider,
    selectedButtplugDevice,
    selectedButtplugFeatureMappings,
    startButtplugPlayback,
    stopButtplugPlayback,
  ])

  useEffect(() => {
    if (
      deviceProvider !== 'serial'
      || !osrSerialConnected
      || osrSerialScriptAxes.length === 0
    ) {
      void stopOsrSerialPlayback({ homeDevice: osrSerialConnected })
      return
    }

    const media = mediaRef.current
    if (!media || media.paused) return
    void startOsrSerialPlayback()
  }, [
    deviceProvider,
    osrSerialConnected,
    osrSerialUpdateRate,
    osrSerialScriptAxes.length,
    startOsrSerialPlayback,
    stopOsrSerialPlayback,
  ])

  useEffect(() => {
    return () => {
      buttplugStreamRunId.current += 1
      if (buttplugStreamTimer.current) {
        clearTimeout(buttplugStreamTimer.current)
        buttplugStreamTimer.current = null
      }

      osrSerialStreamRunId.current += 1
      if (osrSerialStreamTimer.current) {
        clearTimeout(osrSerialStreamTimer.current)
        osrSerialStreamTimer.current = null
      }
      if (appFeedbackTimer.current) {
        clearTimeout(appFeedbackTimer.current)
        appFeedbackTimer.current = null
      }

      void buttplugService.disconnect()
      void osrSerialService.disconnect()
    }
  }, [])

  const handleCopyDeviceDiagnostics = useCallback(async () => {
    const media = mediaRef.current
    const currentFileLabel = currentFile ? `${getFileName(currentFile)} (path redacted)` : 'none'
    const scriptFolderLabel = settings.scriptFolder ? 'configured (path redacted)' : 'none'
    const intifaceUrlLabel = buttplugServerUrl ? 'configured (redacted)' : 'none'
    const serialPortLabel = selectedOsrSerialPortPath ? 'selected (path redacted)' : 'none'
    const scriptSourceLabel = primaryScriptSource
      ? primaryScriptSource.startsWith('generated://')
        ? primaryScriptSource
        : `${getFileName(primaryScriptSource)} (path redacted)`
      : 'none'
    const generatedScriptActive = primaryScriptSource?.startsWith('generated://') ?? false
    const scriptVariantLines = scriptVariants.length > 0
      ? scriptVariants.map((variant, index) => {
          return [
            `${index + 1}. ${getFileName(variant.path)} (path redacted)`,
            `source=${variant.source}`,
            `axes=${variant.axes.join('/') || 'none'}`,
            `default=${variant.isDefault ? 'yes' : 'no'}`,
            `active=${primaryScriptSource === variant.path ? 'yes' : 'no'}`,
          ].join(' | ')
        })
      : ['none']
    const selectedButtplugFeatureSummary = selectedButtplugDevice
      ? [
          `linear=${selectedButtplugDevice.features.filter((feature) => String(feature.type).toLowerCase() === 'linear').length}`,
          `rotate=${selectedButtplugDevice.features.filter((feature) => String(feature.type).toLowerCase() === 'rotate').length}`,
          `scalar=${selectedButtplugDevice.features.filter((feature) => String(feature.type).toLowerCase() === 'scalar').length}`,
          `rawWrite=${selectedButtplugDevice.rawWriteEndpoints.length > 0 ? 'yes' : 'no'}`,
        ].join(' | ')
      : 'none'
    const buttplugMappingLines = selectedButtplugDevice
      ? selectedButtplugDevice.features.map((feature) => {
          const mapping = selectedButtplugFeatureMappings[feature.id]
          return [
            feature.id,
            feature.descriptor,
            `type=${feature.type}`,
            `actuator=${feature.actuatorType || 'unknown'}`,
            `axis=${mapping?.axisId || 'none'}`,
            `invert=${mapping?.invert ? 'yes' : 'no'}`,
          ].join(' | ')
        })
      : []
    const lines = [
      'ScriptPlayer+ Device Diagnostics',
      `Captured: ${new Date().toISOString()}`,
      '',
      '[Playback]',
      `Current file: ${currentFileLabel}`,
      `Media type: ${currentFileType || 'none'}`,
      `Playing: ${media ? (!media.paused).toString() : 'no media element'}`,
      `Current time: ${media ? media.currentTime.toFixed(3) : 'n/a'}`,
      `Duration: ${Number.isFinite(mediaDurationSeconds) ? mediaDurationSeconds.toFixed(3) : 'n/a'}`,
      `Playback rate: ${playbackRate}`,
      '',
      '[Script]',
      `Primary axis: ${primaryAxis || 'none'}`,
      `Available axes: ${availableScriptAxes.join(', ') || 'none'}`,
      `Runtime axes: ${SCRIPT_AXIS_IDS.filter((axisId) => Boolean(runtimeAxisActions[axisId]?.length)).join(', ') || 'none'}`,
      `Script source: ${scriptSourceLabel}`,
      `Script folder: ${scriptFolderLabel}`,
      `Manual script overrides: ${manualScriptPaths.size}`,
      `Script variants: ${scriptVariants.length}`,
      `Generated fallback active: ${generatedScriptActive ? 'yes' : 'no'}`,
      `No-script random generation: ${settings.noScriptRandomStrokeEnabled}`,
      `Random gap fill: ${settings.noScriptRandomFillGapsEnabled}`,
      `Script offset: ${scriptOffset}ms`,
      '',
      '[Script Variants]',
      ...scriptVariantLines,
      '',
      '[Auto Skip]',
      `Enabled: ${settings.autoSkipScriptGaps}`,
      `Minimum gap: ${settings.autoSkipGapMinDuration}s`,
      `Lead-in: ${settings.autoSkipGapLeadIn}s`,
      `Motion points: ${autoSkipMotionModel.motionTimes.length}`,
      '',
      '[Device]',
      `Provider: ${deviceProvider}`,
      `Compatibility preset: ${deviceCompatibilityPreset}`,
      `Handy connected: ${handyConnected}`,
      `Handy upload status: ${handyUploadStatus}`,
      `Handy upload error: ${handyUploadError || 'none'}`,
      `Intiface state: ${buttplugConnectionState}`,
      `Intiface error: ${buttplugError || 'none'}`,
      `Intiface URL: ${intifaceUrlLabel}`,
      `Selected Intiface device: ${selectedButtplugDevice ? `${selectedButtplugDevice.displayName} (#${selectedButtplugDevice.index})` : 'none'}`,
      `Selected Intiface features: ${selectedButtplugFeatureSummary}`,
      `Raw endpoints: ${selectedButtplugDevice?.rawWriteEndpoints.join(', ') || 'none'}`,
      `Serial state: ${osrSerialConnectionState}`,
      `Serial error: ${osrSerialError || 'none'}`,
      `Serial port: ${serialPortLabel}`,
      `Serial baud: ${osrSerialService.baudRate || DEFAULT_OSR_SERIAL_BAUD_RATE}`,
      `Serial update rate: ${osrSerialUpdateRate}Hz`,
      `Serial profile: ${osrSerialProfile}`,
      `Serial active axes: ${availableOsrSerialAxes.join(', ') || 'none'}`,
      '',
      '[Intiface Feature Mapping]',
      ...(buttplugMappingLines.length > 0 ? buttplugMappingLines : ['none']),
    ]

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      showAppFeedback({ tone: 'success', text: 'Device diagnostics copied.' })
    } catch {
      showAppFeedback({ tone: 'error', text: 'Failed to copy device diagnostics.' })
    }
  }, [
    autoSkipMotionModel.motionTimes.length,
    availableOsrSerialAxes,
    availableScriptAxes,
    buttplugConnectionState,
    buttplugError,
    buttplugServerUrl,
    currentFile,
    currentFileType,
    deviceCompatibilityPreset,
    deviceProvider,
    handyConnected,
    handyUploadError,
    handyUploadStatus,
    manualScriptPaths,
    mediaDurationSeconds,
    osrSerialConnectionState,
    osrSerialError,
    osrSerialProfile,
    osrSerialUpdateRate,
    playbackRate,
    primaryAxis,
    primaryScriptSource,
    runtimeAxisActions,
    scriptOffset,
    scriptVariants,
    selectedButtplugDevice,
    selectedButtplugFeatureMappings,
    selectedOsrSerialPortPath,
    settings.autoSkipGapLeadIn,
    settings.autoSkipGapMinDuration,
    settings.autoSkipScriptGaps,
    settings.noScriptRandomFillGapsEnabled,
    settings.noScriptRandomStrokeEnabled,
    settings.scriptFolder,
    showAppFeedback,
  ])

  const handleCopyIssueReport = useCallback(async () => {
    const media = mediaRef.current
    const capturedAt = new Date().toISOString()
    const video = media instanceof HTMLVideoElement ? media : null
    const mediaError = media?.error
      ? `${media.error.code}${media.error.message ? ` ${media.error.message}` : ''}`
      : 'none'
    const activeScriptVariant = scriptVariants.find((variant) => variant.path === primaryScriptSource) ?? null
    const scriptSourceLabel = primaryScriptSource
      ? primaryScriptSource.startsWith('generated://')
        ? primaryScriptSource
        : `${getFileName(primaryScriptSource)} (path redacted)`
      : 'none'
    const currentFileLabel = currentFile ? `${getFileName(currentFile)} (path redacted)` : 'none'
    const issueReportLines = [
      'ScriptPlayer+ issue report',
      `Captured: ${capturedAt}`,
      '',
      '[App]',
      `Version hint: ${navigator.userAgent.match(/scriptplayer-plus\/([^ ]+)/)?.[1] || 'unknown'}`,
      `Platform: ${window.electronAPI?.platform || navigator.platform}`,
      `Electron: ${window.electronAPI?.versions?.electron || 'unknown'}`,
      `Chrome: ${window.electronAPI?.versions?.chrome || 'unknown'}`,
      '',
      '[Playback]',
      `Current file: ${currentFileLabel}`,
      `Media type: ${currentFileType || 'none'}`,
      `Video compatibility mode: ${settings.videoCompatibilityMode}`,
      `Playing: ${media ? (!media.paused).toString() : 'no media element'}`,
      `Time: ${media && Number.isFinite(media.currentTime) ? media.currentTime.toFixed(3) : 'n/a'}`,
      `Duration: ${Number.isFinite(mediaDurationSeconds) ? mediaDurationSeconds.toFixed(3) : 'n/a'}`,
      `Playback rate: ${playbackRate}`,
      `Ready/network state: ${media ? `${media.readyState}/${media.networkState}` : 'n/a'}`,
      `Media error: ${mediaError}`,
      `Video size: ${video ? `${video.videoWidth}x${video.videoHeight}` : 'n/a'}`,
      '',
      '[Script Matching]',
      `Script source: ${scriptSourceLabel}`,
      `Manual override: ${currentFile && manualScriptPaths[currentFile] ? 'yes' : 'no'}`,
      `Script folder: ${settings.scriptFolder ? 'configured (path redacted)' : 'none'}`,
      `Active variant: ${activeScriptVariant ? `${activeScriptVariant.label} (${activeScriptVariant.source})` : 'none'}`,
      `Script variants: ${scriptVariants.length}`,
      `Available axes: ${availableScriptAxes.join(', ') || 'none'}`,
      `Runtime axes: ${SCRIPT_AXIS_IDS.filter((axisId) => Boolean(runtimeAxisActions[axisId]?.length)).join(', ') || 'none'}`,
      `Actions: ${primaryAxis ? runtimeAxisActions[primaryAxis]?.length ?? 0 : 0}`,
      `Script offset: ${scriptOffset}ms`,
      '',
      '[Auto Skip / Generated Script]',
      `Auto skip: ${settings.autoSkipScriptGaps}`,
      `Auto skip min gap: ${settings.autoSkipGapMinDuration}s`,
      `Auto skip lead-in: ${settings.autoSkipGapLeadIn}s`,
      `Motion points: ${autoSkipMotionModel.motionTimes.length}`,
      `No-script random generation: ${settings.noScriptRandomStrokeEnabled}`,
      `Random gap fill: ${settings.noScriptRandomFillGapsEnabled}`,
      '',
      '[Device]',
      `Provider: ${deviceProvider}`,
      `Compatibility preset: ${deviceCompatibilityPreset}`,
      `Handy connected: ${handyConnected}`,
      `Handy upload status: ${handyUploadStatus}`,
      `Intiface state: ${buttplugConnectionState}`,
      `Selected Intiface device: ${selectedButtplugDevice ? `${selectedButtplugDevice.displayName} (#${selectedButtplugDevice.index})` : 'none'}`,
      `Intiface features: ${selectedButtplugDevice ? selectedButtplugDevice.features.length : 0}`,
      `Raw endpoints: ${selectedButtplugDevice?.rawWriteEndpoints.join(', ') || 'none'}`,
      `Serial state: ${osrSerialConnectionState}`,
      `Serial port: ${selectedOsrSerialPortPath ? 'selected (path redacted)' : 'none'}`,
      `Serial update rate: ${osrSerialUpdateRate}Hz`,
      `Serial profile: ${osrSerialProfile}`,
      `Serial active axes: ${availableOsrSerialAxes.join(', ') || 'none'}`,
    ]

    try {
      const text = issueReportLines.join('\n')
      if (window.electronAPI?.writeClipboardText) {
        await window.electronAPI.writeClipboardText(text)
      } else {
        await navigator.clipboard.writeText(text)
      }
      saveRecentIssueReport(text, capturedAt)
      showAppFeedback({ tone: 'success', text: t('device.issueReportCopied') })
    } catch {
      showAppFeedback({ tone: 'error', text: t('device.issueReportCopyFailed') })
    }
  }, [
    autoSkipMotionModel.motionTimes.length,
    availableOsrSerialAxes,
    availableScriptAxes,
    buttplugConnectionState,
    currentFile,
    currentFileType,
    deviceCompatibilityPreset,
    deviceProvider,
    handyConnected,
    handyUploadStatus,
    manualScriptPaths,
    mediaDurationSeconds,
    osrSerialConnectionState,
    osrSerialProfile,
    osrSerialUpdateRate,
    playbackRate,
    primaryAxis,
    primaryScriptSource,
    runtimeAxisActions,
    scriptOffset,
    scriptVariants,
    selectedButtplugDevice,
    selectedOsrSerialPortPath,
    settings.autoSkipGapLeadIn,
    settings.autoSkipGapMinDuration,
    settings.autoSkipScriptGaps,
    settings.noScriptRandomFillGapsEnabled,
    settings.noScriptRandomStrokeEnabled,
    settings.scriptFolder,
    settings.videoCompatibilityMode,
    showAppFeedback,
    t,
  ])

  const handleCopyLastIssueReport = useCallback(async () => {
    const lastReport = loadRecentIssueReports()[0]
    if (!lastReport) {
      showAppFeedback({ tone: 'info', text: t('device.noRecentIssueReport') })
      return
    }

    try {
      if (window.electronAPI?.writeClipboardText) {
        await window.electronAPI.writeClipboardText(lastReport.text)
      } else {
        await navigator.clipboard.writeText(lastReport.text)
      }
      showAppFeedback({ tone: 'success', text: t('device.lastIssueReportCopied') })
    } catch {
      showAppFeedback({ tone: 'error', text: t('device.issueReportCopyFailed') })
    }
  }, [showAppFeedback, t])

  const handleTryVideoCompatibilityMode = useCallback(async () => {
    const nextMode: AppSettings['videoCompatibilityMode'] = 'disable-gpu-video-decode'
    patchSettings({ videoCompatibilityMode: nextMode })
    try {
      await window.electronAPI?.setRuntimePreferences?.({ videoCompatibilityMode: nextMode })
    } catch {
      // The setting is still saved; runtime preference failures are non-fatal.
    }
    showAppFeedback({ tone: 'success', text: t('player.videoCompatibilityApplied') })
  }, [patchSettings, showAppFeedback, t])

  const handleDeviceTestCommand = useCallback(async (command: DeviceTestCommand) => {
    try {
      if (command === 'stop') {
        if (deviceProvider === 'buttplug') {
          await stopButtplugPlayback({ stopDevice: true })
        } else if (deviceProvider === 'serial') {
          await stopOsrSerialPlayback({ homeDevice: true })
        } else if (deviceProvider === 'handy') {
          await handyService.hsspStop()
        }
        showAppFeedback({ tone: 'success', text: 'Device stop command sent.' })
        return
      }

      const axisId = command as ScriptAxisId
      let ok = false

      if (deviceProvider === 'buttplug') {
        await stopButtplugPlayback({ stopDevice: false })
        ok = await sendButtplugDeviceTest(axisId)
      } else if (deviceProvider === 'serial') {
        await stopOsrSerialPlayback({ homeDevice: false })
        ok = await sendOsrSerialDeviceTest(axisId)
      }

      showAppFeedback({
        tone: ok ? 'success' : 'error',
        text: ok ? `${command} test command sent.` : `${command} test is not available for the current device.`,
      })
    } catch (error) {
      showAppFeedback({
        tone: 'error',
        text: error instanceof Error && error.message ? error.message : 'Device test failed.',
      })
    }
  }, [
    deviceProvider,
    sendButtplugDeviceTest,
    sendOsrSerialDeviceTest,
    showAppFeedback,
    stopButtplugPlayback,
    stopOsrSerialPlayback,
  ])

  const deviceInfo = useMemo(() => {
    if (deviceProvider === 'handy') {
      const uploadState = handyAutoPlayStatusText
        ? { text: handyAutoPlayStatusText, tone: handyAutoPlayStatusTone ?? 'busy' as const }
        : getHandyOverlayStatus(handyUploadStatus, handyUploadError)
      return {
        connected: handyConnected,
        label: 'Handy',
        detail: handyConnected && handyService.ping !== null ? `${handyService.ping}ms` : null,
        statusText: uploadState?.text ?? null,
        statusTone: uploadState?.tone ?? null,
      }
    }

    if (deviceProvider === 'serial') {
      return {
        connected: osrSerialConnected,
        label: selectedOsrSerialPort ? selectedOsrSerialPort.path : 'FunOSR',
        detail: `${DEFAULT_OSR_SERIAL_BAUD_RATE} baud / ${osrSerialUpdateRate}Hz`,
        statusText: osrSerialError || (!selectedOsrSerialPort && osrSerialPorts.length > 0 ? 'Select a serial port.' : null),
        statusTone: osrSerialError ? 'error' as const : null,
      }
    }

    return {
      connected: buttplugConnected,
      label: selectedButtplugDevice ? selectedButtplugDevice.displayName : 'Intiface',
      detail: selectedButtplugDevice
        ? `${selectedButtplugDevice.linearFeatures.length}/${selectedButtplugDevice.rotateFeatures.length}/${selectedButtplugDevice.scalarFeatures.length}`
        : buttplugServerUrl,
      statusText: buttplugError
        || (buttplugScanning
          ? 'Scanning for devices...'
          : (!selectedButtplugDevice && buttplugConnected ? 'Select a Buttplug device.' : null)),
      statusTone: buttplugError ? 'error' as const : (buttplugScanning ? 'busy' as const : null),
    }
  }, [
    buttplugConnected,
    buttplugError,
    buttplugScanning,
    buttplugServerUrl,
    deviceProvider,
    handyConnected,
    handyAutoPlayStatusText,
    handyAutoPlayStatusTone,
    handyUploadError,
    handyUploadStatus,
    osrSerialConnected,
    osrSerialError,
    osrSerialPorts.length,
    osrSerialUpdateRate,
    selectedButtplugDevice,
    selectedOsrSerialPort,
  ])

  return (
    <div className="h-screen flex flex-col bg-surface-300">
      {appFeedback && (
        <div className="pointer-events-none fixed left-1/2 top-12 z-[70] -translate-x-1/2 px-3">
          <div
            className={`rounded-lg border px-3 py-2 text-xs shadow-[0_14px_44px_rgba(0,0,0,0.38)] backdrop-blur-md animate-fade-in ${
              appFeedback.tone === 'error'
                ? 'border-red-400/35 bg-red-500/12 text-red-100'
                : appFeedback.tone === 'success'
                  ? 'border-green-400/30 bg-green-500/12 text-green-100'
                  : 'border-accent/30 bg-accent/12 text-text-primary'
            }`}
          >
            {appFeedback.text}
          </div>
        </div>
      )}
      {availableUpdate?.updateAvailable && (
        <div className="fixed right-4 top-14 z-[65] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-accent/30 bg-surface-200/95 p-3 text-xs text-text-primary shadow-[0_18px_48px_rgba(0,0,0,0.45)] backdrop-blur-md animate-fade-in">
          <div className="font-semibold">
            {t('update.availableTitle', { version: availableUpdate.latestVersion })}
          </div>
          <div className="mt-1 leading-relaxed text-text-muted">
            {t('update.availableDesc')}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={dismissAvailableUpdate}
              className="rounded border border-surface-100/30 px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:border-surface-100/60 hover:text-text-primary"
            >
              {t('update.dismiss')}
            </button>
            <button
              type="button"
              onClick={openAvailableUpdate}
              className="rounded border border-accent/35 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:border-accent/60 hover:bg-accent/15"
            >
              {t('update.openRelease')}
            </button>
          </div>
        </div>
      )}
      <TitleBar onOpenSettings={() => openSettingsSection('general')} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          files={orderedFiles}
          currentFile={currentFile}
          onFileSelect={handleFileSelect}
          onOpenFolder={handleOpenFolder}
          playlistMode={playlistMode}
          playlistName={playlistName}
          playlistFilePath={playlistFilePath}
          onAddMediaFiles={handleAddMediaFiles}
          onOpenPlaylist={handleOpenPlaylistFile}
          onSavePlaylist={handleSavePlaylistFile}
          onClearPlaylist={handleClearPlaylist}
          onRemovePlaylistFile={handleRemovePlaylistFile}
          onOpenFileLocation={handleOpenFileLocation}
          onTrashFile={handleTrashFile}
          onManualScriptSelect={handleManualScriptSelect}
          onManualSubtitleSelect={handleManualSubtitleSelect}
          onClearManualScript={handleClearManualScript}
          onClearManualSubtitle={handleClearManualSubtitle}
          scriptVariants={scriptVariants}
          currentScriptSource={primaryScriptSource}
          scriptVariantOverrideActive={Boolean(currentFile && manualScriptPaths[currentFile])}
          onScriptVariantSelect={handleQuickScriptVariantSelect}
          onScriptVariantReset={handleQuickScriptVariantReset}
          onCurrentScriptReload={handleCurrentScriptReload}
          manualScriptPaths={new Set(Object.keys(manualScriptPaths))}
          manualSubtitlePaths={new Set(Object.keys(manualSubtitleFiles))}
          deviceProvider={deviceProvider}
          onDeviceProviderChange={setDeviceProvider}
          deviceCompatibilityPreset={deviceCompatibilityPreset}
          onDeviceCompatibilityPresetChange={setDeviceCompatibilityPreset}
          onCopyDeviceDiagnostics={handleCopyDeviceDiagnostics}
          onCopyIssueReport={handleCopyIssueReport}
          onCopyLastIssueReport={handleCopyLastIssueReport}
          handyConnected={handyConnected}
          onHandyConnect={handleHandyConnect}
          onHandyDisconnect={handleHandyDisconnect}
          osrSerialConnected={osrSerialConnected}
          osrSerialConnecting={osrSerialConnectionState === 'connecting'}
          osrSerialPorts={osrSerialPorts}
          selectedOsrSerialPortPath={selectedOsrSerialPortPath}
          onOsrSerialPortSelect={setSelectedOsrSerialPortPath}
          onOsrSerialRefresh={handleOsrSerialRefresh}
          onOsrSerialConnect={handleOsrSerialConnect}
          onOsrSerialDisconnect={handleOsrSerialDisconnect}
          osrSerialError={osrSerialError}
          osrSerialUpdateRate={osrSerialUpdateRate}
          onOsrSerialUpdateRateChange={setOsrSerialUpdateRate}
          osrSerialProfile={osrSerialProfile}
          onOsrSerialProfileChange={handleOsrSerialProfileChange}
          osrSerialAxisConfigs={osrSerialAxisConfigs}
          osrSerialActiveAxes={availableOsrSerialAxes}
          onOsrSerialAxisConfigChange={handleOsrSerialAxisConfigChange}
          buttplugConnected={buttplugConnected}
          buttplugConnecting={buttplugConnectionState === 'connecting'}
          buttplugDevices={buttplugDevices}
          buttplugServerUrl={buttplugServerUrl}
          onButtplugServerUrlChange={setButtplugServerUrl}
          onButtplugConnect={handleButtplugConnect}
          onButtplugDisconnect={handleButtplugDisconnect}
          buttplugScanning={buttplugScanning}
          onButtplugScan={handleButtplugScan}
          selectedButtplugDeviceIndex={selectedButtplugDeviceIndex}
          onButtplugDeviceSelect={setSelectedButtplugDeviceIndex}
          buttplugError={buttplugError}
          buttplugFeatures={selectedButtplugDevice?.features ?? []}
          buttplugFeatureMappings={selectedButtplugFeatureMappings}
          onButtplugFeatureMappingChange={setSelectedButtplugFeatureMapping}
          buttplugAvailableAxes={availableScriptAxes}
          scriptFolder={settings.scriptFolder}
          onRescanScriptFolder={handleRescanScriptFolder}
          scriptFolderRescanning={scriptFolderRescanning}
          videoSort={videoSort}
          onVideoSortChange={setVideoSort}
        />
        <VideoPlayer
          mediaSessionKey={mediaSessionKey}
          videoUrl={videoUrl}
          currentFilePath={currentFile}
          mediaType={currentFileType}
          currentFileName={currentFile ? getFileName(currentFile) : null}
          artworkUrl={artworkUrl}
          actions={displayActions}
          scriptSource={primaryScriptSource}
          scriptDebugInfo={scriptDebugInfo}
          scriptFolder={settings.scriptFolder}
          scriptVariants={scriptVariants}
          scriptVariantOverrideActive={Boolean(currentFile && manualScriptPaths[currentFile])}
          onScriptVariantSelect={handleQuickScriptVariantSelect}
          onScriptVariantReset={handleQuickScriptVariantReset}
          onManualScriptSelect={currentSidebarFile ? () => handleManualScriptSelect(currentSidebarFile) : undefined}
          subtitleCues={subtitleCues}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onEnded={handleEnded}
          mediaRef={mediaRef}
          playlistFiles={orderedFiles}
          onPlaylistFileSelect={handleFileSelect}
          autoPlayRequestId={autoPlayRequestId}
          canGoToPreviousFile={canGoToPreviousFile}
          onPreviousFile={handlePreviousFile}
          canGoToNextFile={canGoToNextFile}
          onNextFile={handleNextFile}
          playbackMode={playbackMode}
          onPlaybackModeChange={setPlaybackMode}
          loopCurrentMedia={loopCurrentMedia}
          onLoopCurrentMediaChange={setLoopCurrentMedia}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          onDurationChange={setMediaDurationSeconds}
          shortcutBindings={settings.keyboardShortcuts}
          shortcutsEnabled={!settingsOpen && !scriptMatchDialog}
          deviceInfo={deviceInfo}
          strokeRangeMin={settings.strokeRangeMin}
          strokeRangeMax={settings.strokeRangeMax}
          invertStroke={settings.invertStroke}
          onStrokeRangeChange={handleQuickStrokeRangeChange}
          onInvertStrokeChange={handleQuickInvertStrokeChange}
          scriptOffset={scriptOffset}
          onScriptOffsetChange={scriptOffsetKey ? handleScriptOffsetChange : undefined}
          onReloadScriptSource={handleCurrentScriptReload}
          onOpenDeviceSettings={() => openSettingsSection('device')}
          defaultShowHeatmap={settings.showHeatmapByDefault}
          defaultShowTimeline={settings.showTimelineByDefault}
          autoFitVideoByAspect={settings.autoFitVideoByAspect}
          rememberVideoFit={settings.rememberVideoFit}
          videoCompatibilityMode={settings.videoCompatibilityMode}
          onTryVideoCompatibilityMode={handleTryVideoCompatibilityMode}
          onAiScriptGenerated={handleAiScriptGenerated}
          timelineHeight={settings.timelineHeight}
          timelineWindow={settings.timelineWindow}
          speedColors={settings.speedColors}
          subtitleFontSize={settings.subtitleFontSize}
        />
      </div>

      <ScriptMatchDialog
        open={Boolean(scriptMatchDialog)}
        scriptName={scriptMatchDialog ? getFileName(scriptMatchDialog.scriptPath) : null}
        items={scriptMatchDialogItems}
        onSelect={handleScriptMatchDialogSelect}
        onClose={closeScriptMatchDialog}
      />

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        autoNextPlayEnabled={playbackMode !== 'none'}
        onAutoNextPlayChange={handleAutoNextPlayChange}
        onResetIntifaceSettings={handleResetIntifaceSettings}
        onResetAllSettings={handleResetAllSettings}
        onDeviceTestCommand={handleDeviceTestCommand}
        remoteAccessoryState={remoteAccessoryState}
        onRemoteAccessoryConnect={() => remoteAccessoryClient.connect()}
        onRemoteAccessoryDisconnect={() => remoteAccessoryClient.disconnect()}
        onRemoteAccessoryPair={(code) => remoteAccessoryClient.pair(code)}
        onRemoteAccessoryForget={() => remoteAccessoryClient.forget()}
        onRemoteAccessoryMappingChange={(button, action, command) => remoteAccessoryClient.updateMapping(button, action, command)}
        initialSection={settingsSection}
      />
    </div>
  )
}

function getHandyOverlayStatus(
  uploadStatus: HandyUploadStatus,
  uploadError: string | null
): { text: string; tone: 'busy' | 'error' } | null {
  switch (uploadStatus) {
    case 'uploading':
      return { text: 'Uploading script...', tone: 'busy' }
    case 'setting-up':
      return { text: 'Setting up HSSP...', tone: 'busy' }
    case 'error':
      return { text: uploadError || 'Script upload failed', tone: 'error' }
    default:
      return null
  }
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || ''
}

function selectSubtitleCues(mediaPath: string, mediaType: MediaType, subtitleFiles: SubtitleFile[]): SubtitleCue[] {
  if (mediaType === 'audio') {
    for (const subtitleFile of subtitleFiles) {
      const cues = parseSubtitleFile(subtitleFile.content, subtitleFile.path)
      if (cues.length > 0) {
        return cues
      }
    }

    return []
  }

  let bestMatch: { score: number; cues: SubtitleCue[] } | null = null

  for (const subtitleFile of subtitleFiles) {
    const cues = parseSubtitleFile(subtitleFile.content, subtitleFile.path)
    if (cues.length === 0) continue

    const score = getVideoSubtitleMatchScore(mediaPath, subtitleFile)
    if (score < 0) continue
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { score, cues }
    }
  }

  return bestMatch?.cues ?? []
}
