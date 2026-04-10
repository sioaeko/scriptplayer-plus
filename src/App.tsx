import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import VideoPlayer from './components/VideoPlayer'
import Settings, { type SettingsSection } from './components/Settings'
import {
  Funscript,
  FunscriptAction,
  FunscriptBundle,
  MediaType,
  OsrSerialConnectionState,
  OsrSerialPortInfo,
  PlaybackMode,
  PlaylistItem,
  ScriptAxisId,
  SubtitleCue,
  SubtitleFile,
  VideoFile,
} from './types'
import { serializeM3U8 } from './services/playlist'
import { parseFunscript, transformFunscriptActions } from './services/funscript'
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
  OSR_SERIAL_AXIS_ORDER,
} from './services/tcode'
import {
  normalizeScriptBundle,
  SCRIPT_AXIS_IDS,
} from './services/multiaxis'
import { AppSettings, loadSettings, saveSettings } from './services/settings'
import { buildNoScriptRandomFunscript } from './services/noScriptStroke'
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
import { getVideoSubtitleMatchScore, parseSubtitleFile } from './services/subtitles'
import { useTranslation } from './i18n'

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv']
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma']
const PLAYBACK_MODE_STORAGE_KEY = 'scriptplayer-playback-mode'
const PLAYBACK_RATE_STORAGE_KEY = 'scriptplayer-playback-rate'
const DEVICE_PROVIDER_STORAGE_KEY = 'scriptplayer-device-provider'
const BUTTPLUG_SERVER_URL_STORAGE_KEY = 'scriptplayer-buttplug-url'
const BUTTPLUG_DEVICE_INDEX_STORAGE_KEY = 'scriptplayer-buttplug-device-index'
const BUTTPLUG_FEATURE_MAPPINGS_STORAGE_KEY = 'scriptplayer-buttplug-feature-mappings-v1'
const OSR_SERIAL_PORT_PATH_STORAGE_KEY = 'scriptplayer-osr-serial-port-path'
const OSR_SERIAL_UPDATE_RATE_STORAGE_KEY = 'scriptplayer-osr-serial-update-rate'
const VIDEO_SORT_FIELD_STORAGE_KEY = 'scriptplayer-video-sort-field'
const VIDEO_SORT_DIRECTION_STORAGE_KEY = 'scriptplayer-video-sort-direction'
const DEFAULT_BUTTPLUG_SERVER_URL = 'ws://127.0.0.1:12345'
const DEFAULT_OSR_SERIAL_BAUD_RATE = 115200
const DEFAULT_OSR_SERIAL_UPDATE_RATE = 50
const HANDY_SEEK_SETTLE_TIMEOUT_MS = 500
const AUTO_SKIP_AFTER_SEEK_SUPPRESS_MS = 1200
const AUTO_SKIP_COOLDOWN_MS = 1000
const AUTO_SKIP_TARGET_EPSILON_MS = 250
const APP_SHORTCUT_ACTIONS: ShortcutActionId[] = ['openSettings', 'openFolder']

type DeviceProvider = 'handy' | 'buttplug' | 'serial'
type StoredButtplugFeatureMapping = ButtplugFeatureMapping

function getMediaTypeFromPath(filePath: string): MediaType | null {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '')
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  return null
}

function loadPlaybackMode(): PlaybackMode {
  try {
    const stored = localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY)
    if (stored === 'sequential' || stored === 'shuffle' || stored === 'none') {
      return stored
    }
  } catch {
    // Ignore storage failures
  }

  return 'none'
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

function loadButtplugServerUrl(): string {
  try {
    return localStorage.getItem(BUTTPLUG_SERVER_URL_STORAGE_KEY) || DEFAULT_BUTTPLUG_SERVER_URL
  } catch {
    return DEFAULT_BUTTPLUG_SERVER_URL
  }
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

function getPlaybackTimeScale(playbackRate: number): number {
  return 1 / (Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1)
}

function getHandyStartTime(mediaTimeSeconds: number, playbackRate: number, timeOffset: number): number {
  const baseTime = mediaTimeSeconds * 1000 * getPlaybackTimeScale(playbackRate)
  return Math.max(0, Math.round(baseTime + timeOffset))
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

function collectSortedActionTimes(actionMap: AxisActionMap): number[] {
  const uniqueTimes = new Set<number>()

  for (const axisId of SCRIPT_AXIS_IDS) {
    const actions = actionMap[axisId]
    if (!actions) continue

    for (const action of actions) {
      if (Number.isFinite(action.at) && action.at >= 0) {
        uniqueTimes.add(action.at)
      }
    }
  }

  return Array.from(uniqueTimes).sort((a, b) => a - b)
}

function findAutoSkipTargetMs(
  actionTimes: number[],
  currentTimeMs: number,
  minimumGapMs: number,
  leadInMs: number
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
    return null
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
  const { locale, setLocale } = useTranslation()
  const [files, setFiles] = useState<VideoFile[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [currentFileType, setCurrentFileType] = useState<MediaType | null>(null)
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null)
  const [funscriptBundle, setFunscriptBundle] = useState<FunscriptBundle | null>(null)
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([])
  const [deviceProvider, setDeviceProvider] = useState<DeviceProvider>(loadDeviceProvider)
  const [handyConnected, setHandyConnected] = useState(false)
  const [scriptUploadUrl, setScriptUploadUrl] = useState<string | null>(null)
  const [handyUploadStatus, setHandyUploadStatus] = useState<HandyUploadStatus>('idle')
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [manualScriptPaths, setManualScriptPaths] = useState<Record<string, string>>({})
  const [selectedAxisId, setSelectedAxisId] = useState<ScriptAxisId | null>(null)
  const [availableFunscriptVariants, setAvailableFunscriptVariants] = useState<Array<{ path: string; label: string }>>([])
  const [selectedVariantPath, setSelectedVariantPath] = useState<string | null>(null)
  const [manualSubtitleFiles, setManualSubtitleFiles] = useState<Record<string, SubtitleFile>>({})
  const [mediaDurationSeconds, setMediaDurationSeconds] = useState(0)
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(loadPlaybackMode)
  const [playbackRate, setPlaybackRate] = useState<number>(loadPlaybackRate)
  const [videoSort, setVideoSort] = useState<VideoSortState>(loadVideoSort)
  const [autoPlayRequestId, setAutoPlayRequestId] = useState(0)
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([])
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const handyUploadRequestId = useRef(0)
  const handySyncRunId = useRef(0)
  const openMediaRequestId = useRef(0)
  const buttplugStreamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buttplugStreamRunId = useRef(0)
  const osrSerialStreamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const osrSerialStreamRunId = useRef(0)
  const autoSkipSuppressedUntilRef = useRef(0)
  const autoSkipCooldownUntilRef = useRef(0)

  const effectiveFunscriptBundle = useMemo(() => {
    if (funscriptBundle) {
      return funscriptBundle
    }

    if (
      !currentFile
      || !settings.noScriptRandomStrokeEnabled
      || !Number.isFinite(mediaDurationSeconds)
      || mediaDurationSeconds <= 0
    ) {
      return null
    }

    const script = buildNoScriptRandomFunscript(
      mediaDurationSeconds * 1000,
      currentFile,
      {
        minStrokesPerMinute: settings.noScriptRandomMinSpeed,
        maxStrokesPerMinute: settings.noScriptRandomMaxSpeed,
        preset: settings.noScriptRandomPreset,
        pattern: settings.noScriptRandomPattern,
      }
    )
    if (!script) {
      return null
    }

    return {
      primaryAxis: 'L0' as const,
      scripts: { L0: script },
      sources: { L0: 'generated://random-no-script' },
    }
  }, [
    currentFile,
    funscriptBundle,
    mediaDurationSeconds,
    settings.noScriptRandomMaxSpeed,
    settings.noScriptRandomMinSpeed,
    settings.noScriptRandomPattern,
    settings.noScriptRandomPreset,
    settings.noScriptRandomStrokeEnabled,
  ])
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
  const primaryAxis = useMemo(() => {
    if (selectedAxisId && displayAxisActions[selectedAxisId]?.length) return selectedAxisId
    return getPrimaryAxis(effectiveFunscriptBundle)
  }, [selectedAxisId, effectiveFunscriptBundle, displayAxisActions])
  const runtimeAxisActions = useMemo(
    () => buildAxisActionMap(displayAxisActions, (_axisId, actions) =>
      transformFunscriptActions(actions, { timeScale: getPlaybackTimeScale(playbackRate) })
    ),
    [displayAxisActions, playbackRate]
  )
  const displayActions = useMemo(
    () => (primaryAxis ? displayAxisActions[primaryAxis] ?? [] : []),
    [displayAxisActions, primaryAxis]
  )
  const handyActions = useMemo(() => {
    if (runtimeAxisActions.L0 && runtimeAxisActions.L0.length > 0) {
      return runtimeAxisActions.L0
    }
    return primaryAxis ? runtimeAxisActions[primaryAxis] ?? [] : []
  }, [primaryAxis, runtimeAxisActions])
  const availableScriptAxes = useMemo(
    () => SCRIPT_AXIS_IDS.filter((axisId) => Boolean(displayAxisActions[axisId]?.length)),
    [displayAxisActions]
  )
  const activeVariantPath = useMemo(() => {
    if (selectedVariantPath) return selectedVariantPath
    if (!effectiveFunscriptBundle || !primaryAxis) return availableFunscriptVariants[0]?.path ?? null
    return effectiveFunscriptBundle.sources[primaryAxis] ?? availableFunscriptVariants[0]?.path ?? null
  }, [selectedVariantPath, effectiveFunscriptBundle, primaryAxis, availableFunscriptVariants])
  const allScriptActionTimes = useMemo(
    () => collectSortedActionTimes(displayAxisActions),
    [displayAxisActions]
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
  const previousSequentialFile = useMemo(
    () => getAdjacentVideoFile(orderedFiles, currentFile, 'previous'),
    [currentFile, orderedFiles]
  )
  const nextSequentialFile = useMemo(
    () => getAdjacentVideoFile(orderedFiles, currentFile, 'next'),
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
    () => OSR_SERIAL_AXIS_ORDER.filter((axisId) => Boolean(displayAxisActions[axisId]?.length)),
    [displayAxisActions]
  )

  useEffect(() => {
    handyService.onStatusChange = (status) => {
      setHandyUploadStatus(status)
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
    try {
      localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, playbackMode)
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
      localStorage.setItem(BUTTPLUG_FEATURE_MAPPINGS_STORAGE_KEY, JSON.stringify(buttplugFeatureMappingStore))
    } catch {
      // Ignore storage failures
    }
  }, [buttplugFeatureMappingStore])

  const handleSettingsChange = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
  }, [])

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  const openSettingsSection = useCallback((section: SettingsSection) => {
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
      const currentTimeMs = currentMedia.currentTime * 1000 + (settings.timeOffset || 0)
      const targetTimeMs = currentTimeMs + intervalMs * effectivePlaybackRate
      const command = buildButtplugTransportCommand(
        selectedButtplugDevice,
        selectedButtplugFeatureMappings,
        runtimeAxisActions,
        currentTimeMs,
        targetTimeMs,
        intervalMs
      )

      await buttplugService.sendDeviceFrame(selectedButtplugDevice.index, command.frame, { rawTCode: command.rawTCode })

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
    deviceProvider,
    playbackRate,
    runtimeAxisActions,
    selectedButtplugDevice,
    selectedButtplugFeatureMappings,
    settings.timeOffset,
  ])

  const stopOsrSerialPlayback = useCallback(async (options?: { homeDevice?: boolean }) => {
    osrSerialStreamRunId.current += 1
    clearOsrSerialStreamTimer()

    if (!options?.homeDevice || !osrSerialConnected) {
      return
    }

    const neutralCommand = buildDefaultTCodeCommand(OSR_SERIAL_AXIS_ORDER)
    if (neutralCommand) {
      await osrSerialService.writeCommand(neutralCommand)
    }
  }, [clearOsrSerialStreamTimer, osrSerialConnected])

  const startOsrSerialPlayback = useCallback(async () => {
    const media = mediaRef.current
    if (
      !media
      || media.paused
      || deviceProvider !== 'serial'
      || !osrSerialConnected
      || availableOsrSerialAxes.length === 0
    ) {
      return
    }

    const runId = ++osrSerialStreamRunId.current
    clearOsrSerialStreamTimer()

    const tick = async () => {
      if (runId !== osrSerialStreamRunId.current) return

      const currentMedia = mediaRef.current
      if (!currentMedia || currentMedia.paused) return

      const intervalMs = Math.max(5, Math.round(1000 / Math.max(1, osrSerialUpdateRate)))
      const effectivePlaybackRate = currentMedia.playbackRate > 0 ? currentMedia.playbackRate : playbackRate
      const currentTimeMs = currentMedia.currentTime * 1000 + (settings.timeOffset || 0)
      const targetTimeMs = currentTimeMs + intervalMs * effectivePlaybackRate
      const command = buildTCodeCommand(runtimeAxisActions, targetTimeMs, {
        axisIds: OSR_SERIAL_AXIS_ORDER,
      })

      if (command) {
        await osrSerialService.writeCommand(command)
      }

      if (runId !== osrSerialStreamRunId.current) return
      osrSerialStreamTimer.current = setTimeout(() => {
        void tick()
      }, intervalMs)
    }

    await tick()
  }, [
    availableOsrSerialAxes.length,
    clearOsrSerialStreamTimer,
    deviceProvider,
    osrSerialConnected,
    osrSerialUpdateRate,
    playbackRate,
    runtimeAxisActions,
    settings.timeOffset,
  ])

  const loadSubtitleCues = useCallback(async (mediaPath: string, mediaType: MediaType) => {
    const manualSubtitle = manualSubtitleFiles[mediaPath]
    if (manualSubtitle) {
      return parseSubtitleFile(manualSubtitle.content, manualSubtitle.path)
    }

    const subtitleFiles = await window.electronAPI.readSubtitles(mediaPath)
    return selectSubtitleCues(mediaPath, mediaType, subtitleFiles)
  }, [manualSubtitleFiles])

  const loadScriptBundle = useCallback(async (mediaPath: string) => {
    const manualScriptPath = manualScriptPaths[mediaPath]
    const rawBundle = await window.electronAPI.readFunscriptBundle(mediaPath, settings.scriptFolder, manualScriptPath)
    return parseFunscriptBundleData(rawBundle)
  }, [manualScriptPaths, settings.scriptFolder])

  const cancelPendingHandySync = useCallback(() => {
    handySyncRunId.current += 1
  }, [])

  const syncHandyPlayback = useCallback(async (mediaTimeSeconds: number) => {
    if (!handyService.isConnected || !scriptUploadUrl) return
    const startTime = getHandyStartTime(mediaTimeSeconds, playbackRate, settings.timeOffset || 0)
    await handyService.hsspPlay(handyService.getServerTime(), startTime)
  }, [playbackRate, scriptUploadUrl, settings.timeOffset])

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

  const handleOpenFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.openFolder()
    if (!folderPath) return
    const mediaFiles = await window.electronAPI.readDir(folderPath)
    setFiles(mediaFiles)
  }, [])

  const openMediaFile = useCallback(async (
    filePath: string,
    fileType?: MediaType,
    options?: { autoplay?: boolean }
  ) => {
    const requestId = ++openMediaRequestId.current
    const resolvedType = fileType ?? getMediaTypeFromPath(filePath)
    if (!resolvedType) return

    if (handyService.isConnected) {
      cancelPendingHandySync()
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
    setCurrentFile(filePath)
    setCurrentFileType(resolvedType)
    setMediaDurationSeconds(0)
    setFunscriptBundle(null)
    setSelectedAxisId(null)
    setSelectedVariantPath(null)
    setAvailableFunscriptVariants([])
    setSubtitleCues([])
    setScriptUploadUrl(null)
    setArtworkUrl(null)

    const [url, nextSubtitleCues, parsedBundle, artworkPath, variants] = await Promise.all([
      window.electronAPI.getVideoUrl(filePath),
      loadSubtitleCues(filePath, resolvedType),
      loadScriptBundle(filePath),
      resolvedType === 'audio'
        ? window.electronAPI.findArtwork(filePath)
        : Promise.resolve<string | null>(null),
      window.electronAPI.listFunscriptVariants(filePath, settings.scriptFolder),
    ])

    if (requestId !== openMediaRequestId.current) {
      return
    }

    setVideoUrl(url)
    setSubtitleCues(nextSubtitleCues)
    setFunscriptBundle(parsedBundle)
    setAvailableFunscriptVariants(variants)
    if (options?.autoplay) {
      setAutoPlayRequestId((prev) => prev + 1)
    }

    if (artworkPath) {
      const nextArtworkUrl = await window.electronAPI.getVideoUrl(artworkPath)
      if (requestId !== openMediaRequestId.current) {
        return
      }
      setArtworkUrl(nextArtworkUrl)
    }
  }, [cancelPendingHandySync, loadScriptBundle, loadSubtitleCues, osrSerialConnected, settings.scriptFolder, stopButtplugPlayback, stopOsrSerialPlayback])

  const handleFunscriptVariantChange = useCallback(async (variantPath: string) => {
    if (!currentFile) return
    setSelectedVariantPath(variantPath)
    setSelectedAxisId(null)
    const rawBundle = await window.electronAPI.readFunscriptBundle(currentFile, settings.scriptFolder, variantPath)
    setFunscriptBundle(parseFunscriptBundleData(rawBundle))
  }, [currentFile, settings.scriptFolder])

  const handleFileSelect = useCallback(async (file: VideoFile) => {
    await openMediaFile(file.path, file.type)
  }, [openMediaFile])

  const handlePlaylistItemPlay = useCallback(async (filePath: string) => {
    const type = getMediaTypeFromPath(filePath)
    if (!type) return
    await openMediaFile(filePath, type, { autoplay: true })
  }, [openMediaFile])

  const handlePlaylistImportFromFiles = useCallback(() => {
    if (files.length === 0) return
    const items: PlaylistItem[] = files.map((f) => ({
      path: f.path,
      title: f.name.replace(/\.[^.]+$/, ''),
      duration: -1,
    }))
    setPlaylist((prev) => {
      const existingPaths = new Set(prev.map((i) => i.path))
      return [...prev, ...items.filter((i) => !existingPaths.has(i.path))]
    })
  }, [files])

  const handlePlaylistImportFromFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.openFolder()
    if (!folderPath) return
    const mediaFiles = await window.electronAPI.readDir(folderPath)
    const items: PlaylistItem[] = mediaFiles.map((f) => ({
      path: f.path,
      title: f.name.replace(/\.[^.]+$/, ''),
      duration: -1,
    }))
    setPlaylist((prev) => {
      const existingPaths = new Set(prev.map((i) => i.path))
      return [...prev, ...items.filter((i) => !existingPaths.has(i.path))]
    })
  }, [])

  const handlePlaylistLoad = useCallback(async () => {
    const items = await window.electronAPI.playlistOpen()
    if (items) setPlaylist(items)
  }, [])

  const handlePlaylistSave = useCallback(async () => {
    if (playlist.length === 0) return
    const savePath = await window.electronAPI.playlistSaveDialog('playlist.m3u8')
    if (!savePath) return
    const content = serializeM3U8(playlist)
    await window.electronAPI.playlistWrite(savePath, content)
  }, [playlist])

  const handlePlaylistClear = useCallback(() => {
    setPlaylist([])
  }, [])

  const handlePlaylistRemoveItem = useCallback((index: number) => {
    setPlaylist((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleNextFile = useCallback(async (options?: { autoplay?: boolean }) => {
    const nextFile = getAdjacentVideoFile(orderedFiles, currentFile, 'next')
    if (!nextFile) return

    const shouldAutoplay = options?.autoplay ?? Boolean(mediaRef.current && !mediaRef.current.paused)
    await openMediaFile(nextFile.path, nextFile.type, { autoplay: shouldAutoplay })
  }, [currentFile, openMediaFile, orderedFiles])

  const handlePreviousFile = useCallback(async (options?: { autoplay?: boolean }) => {
    const previousFile = getAdjacentVideoFile(orderedFiles, currentFile, 'previous')
    if (!previousFile) return

    const shouldAutoplay = options?.autoplay ?? Boolean(mediaRef.current && !mediaRef.current.paused)
    await openMediaFile(previousFile.path, previousFile.type, { autoplay: shouldAutoplay })
  }, [currentFile, openMediaFile, orderedFiles])

  const handleManualScriptSelect = useCallback(async (file: VideoFile) => {
    const scriptPath = await window.electronAPI.openScriptFile()
    if (!scriptPath) return

    setManualScriptPaths((prev) => ({ ...prev, [file.path]: scriptPath }))

    if (currentFile === file.path) {
      const rawBundle = await window.electronAPI.readFunscriptBundle(file.path, settings.scriptFolder, scriptPath)
      setFunscriptBundle(parseFunscriptBundleData(rawBundle))
    }
  }, [currentFile, settings.scriptFolder])

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
      const rawBundle = await window.electronAPI.readFunscriptBundle(file.path, settings.scriptFolder)
      setFunscriptBundle(parseFunscriptBundleData(rawBundle))
    }
  }, [currentFile, settings.scriptFolder])

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

    await osrSerialService.connect(trimmedPath, DEFAULT_OSR_SERIAL_BAUD_RATE)
  }

  const handleOsrSerialDisconnect = async () => {
    await stopOsrSerialPlayback({ homeDevice: true })
    await osrSerialService.disconnect()
  }

  const handlePlay = useCallback(async () => {
    const media = mediaRef.current
    if (!media) return
    if (deviceProvider === 'handy') {
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
    if (deviceProvider === 'handy' && handyService.isConnected) {
      cancelPendingHandySync()
      await handyService.hsspStop()
      return
    }

    if (deviceProvider === 'buttplug' && buttplugService.isConnected) {
      await stopButtplugPlayback({ stopDevice: true })
      return
    }

    if (deviceProvider === 'serial' && osrSerialConnected) {
      await stopOsrSerialPlayback({ homeDevice: true })
    }
  }, [cancelPendingHandySync, deviceProvider, osrSerialConnected, stopButtplugPlayback, stopOsrSerialPlayback])

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

  const handleTimeUpdate = useCallback((time: number) => {
    const media = mediaRef.current
    if (
      !media
      || media.paused
      || media.seeking
      || !settings.autoSkipScriptGaps
      || allScriptActionTimes.length === 0
    ) {
      return
    }

    const now = Date.now()
    if (now < autoSkipSuppressedUntilRef.current || now < autoSkipCooldownUntilRef.current) {
      return
    }

    const targetTimeMs = findAutoSkipTargetMs(
      allScriptActionTimes,
      time * 1000,
      settings.autoSkipGapMinDuration * 1000,
      settings.autoSkipGapLeadIn * 1000
    )
    if (targetTimeMs === null) {
      return
    }

    if (Number.isFinite(media.duration) && targetTimeMs >= media.duration * 1000 - AUTO_SKIP_TARGET_EPSILON_MS) {
      return
    }

    void performAutoSkip(targetTimeMs / 1000)
  }, [
    allScriptActionTimes,
    performAutoSkip,
    settings.autoSkipGapLeadIn,
    settings.autoSkipGapMinDuration,
    settings.autoSkipScriptGaps,
  ])

  const handleEnded = useCallback(async () => {
    if (playlist.length > 0 && currentFile) {
      const idx = playlist.findIndex((item) => item.path === currentFile)
      if (idx !== -1) {
        const nextItem = playlist[idx + 1]
        if (!nextItem) return
        const type = getMediaTypeFromPath(nextItem.path)
        if (!type) return
        await openMediaFile(nextItem.path, type, { autoplay: true })
        return
      }
    }
    const nextFile = getNextPlaybackFile(orderedFiles, currentFile, playbackMode)
    if (!nextFile) return
    await openMediaFile(nextFile.path, nextFile.type, { autoplay: true })
  }, [currentFile, openMediaFile, orderedFiles, playbackMode, playlist])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableShortcutTarget(e.target)) return

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
  }, [handleOpenFolder, openSettingsSection, settings.keyboardShortcuts, settingsOpen])

  useEffect(() => {
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      const droppedFiles = e.dataTransfer?.files
      if (!droppedFiles || droppedFiles.length === 0) return

      const file = droppedFiles[0]
      const mediaType = getMediaTypeFromPath(file.name)
      if (!mediaType) return

      const path = window.electronAPI.getDroppedFilePath(file) || (file as any).path as string
      if (path) {
        await openMediaFile(path, mediaType)
      }
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
  }, [openMediaFile])

  useEffect(() => {
    if (settings.defaultVideoFolder) {
      window.electronAPI.readDir(settings.defaultVideoFolder).then(setFiles)
    }
  }, [settings.defaultVideoFolder])

  useEffect(() => {
    if (deviceProvider !== 'handy' || !handyConnected || handyActions.length === 0) {
      if (handyService.isConnected) {
        cancelPendingHandySync()
        void handyService.hsspStop()
      }
      setScriptUploadUrl(null)
      return
    }

    let cancelled = false
    const requestId = ++handyUploadRequestId.current

    setScriptUploadUrl(null)

    const runUpload = async () => {
      cancelPendingHandySync()
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
  }, [deviceProvider, handyActions, handyConnected])

  useEffect(() => {
    if (deviceProvider !== 'handy' || !handyConnected || !scriptUploadUrl) return
    const media = mediaRef.current
    if (!media || media.paused) return
    void syncHandyPlaybackToCurrentMedia()
  }, [deviceProvider, handyConnected, scriptUploadUrl, syncHandyPlaybackToCurrentMedia])

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
        void handyService.hsspStop().finally(() => {
          handyService.disconnect()
          setHandyConnected(false)
          setScriptUploadUrl(null)
        })
      }
    }
  }, [cancelPendingHandySync, deviceProvider, osrSerialConnected, stopButtplugPlayback, stopOsrSerialPlayback])

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
      || availableOsrSerialAxes.length === 0
    ) {
      void stopOsrSerialPlayback({ homeDevice: osrSerialConnected })
      return
    }

    const media = mediaRef.current
    if (!media || media.paused) return
    void startOsrSerialPlayback()
  }, [
    availableOsrSerialAxes.length,
    deviceProvider,
    osrSerialConnected,
    osrSerialUpdateRate,
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

      void buttplugService.disconnect()
      void osrSerialService.disconnect()
    }
  }, [])

  const deviceInfo = useMemo(() => {
    if (deviceProvider === 'handy') {
      const uploadState = getHandyOverlayStatus(handyUploadStatus)
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
      <TitleBar onOpenSettings={() => openSettingsSection('general')} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          files={orderedFiles}
          currentFile={currentFile}
          onFileSelect={handleFileSelect}
          onOpenFolder={handleOpenFolder}
          onManualScriptSelect={handleManualScriptSelect}
          onManualSubtitleSelect={handleManualSubtitleSelect}
          onClearManualScript={handleClearManualScript}
          onClearManualSubtitle={handleClearManualSubtitle}
          manualScriptPaths={new Set(Object.keys(manualScriptPaths))}
          manualSubtitlePaths={new Set(Object.keys(manualSubtitleFiles))}
          deviceProvider={deviceProvider}
          onDeviceProviderChange={setDeviceProvider}
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
          videoSort={videoSort}
          onVideoSortChange={setVideoSort}
          playlist={playlist}
          onPlaylistItemPlay={handlePlaylistItemPlay}
          onPlaylistImportFromFiles={handlePlaylistImportFromFiles}
          onPlaylistImportFromFolder={handlePlaylistImportFromFolder}
          onPlaylistLoad={handlePlaylistLoad}
          onPlaylistSave={handlePlaylistSave}
          onPlaylistClear={handlePlaylistClear}
          onPlaylistRemoveItem={handlePlaylistRemoveItem}
        />
        <VideoPlayer
          videoUrl={videoUrl}
          mediaType={currentFileType}
          currentFileName={currentFile ? getFileName(currentFile) : null}
          artworkUrl={artworkUrl}
          actions={displayActions}
          subtitleCues={subtitleCues}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onEnded={handleEnded}
          mediaRef={mediaRef}
          autoPlayRequestId={autoPlayRequestId}
          canGoToPreviousFile={Boolean(previousSequentialFile)}
          onPreviousFile={handlePreviousFile}
          canGoToNextFile={Boolean(nextSequentialFile)}
          onNextFile={handleNextFile}
          playbackMode={playbackMode}
          onPlaybackModeChange={setPlaybackMode}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          onDurationChange={setMediaDurationSeconds}
          shortcutBindings={settings.keyboardShortcuts}
          shortcutsEnabled={!settingsOpen}
          deviceInfo={deviceInfo}
          strokeRangeMin={settings.strokeRangeMin}
          strokeRangeMax={settings.strokeRangeMax}
          invertStroke={settings.invertStroke}
          onStrokeRangeChange={handleQuickStrokeRangeChange}
          onInvertStrokeChange={handleQuickInvertStrokeChange}
          onOpenDeviceSettings={() => openSettingsSection('device')}
          defaultShowHeatmap={settings.showHeatmapByDefault}
          defaultShowTimeline={settings.showTimelineByDefault}
          timelineHeight={settings.timelineHeight}
          timelineWindow={settings.timelineWindow}
          speedColors={settings.speedColors}
          subtitleFontSize={settings.subtitleFontSize}
          funscriptVariants={availableFunscriptVariants}
          selectedVariantPath={activeVariantPath}
          onFunscriptVariantChange={handleFunscriptVariantChange}
        />
      </div>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        initialSection={settingsSection}
      />
    </div>
  )
}

function getHandyOverlayStatus(uploadStatus: HandyUploadStatus): { text: string; tone: 'busy' | 'error' } | null {
  switch (uploadStatus) {
    case 'uploading':
      return { text: 'Uploading script...', tone: 'busy' }
    case 'setting-up':
      return { text: 'Setting up HSSP...', tone: 'busy' }
    case 'error':
      return { text: 'Script upload failed', tone: 'error' }
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
