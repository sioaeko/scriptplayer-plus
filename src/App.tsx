import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import VideoPlayer from './components/VideoPlayer'
import Settings from './components/Settings'
import {
  Funscript,
  FunscriptAction,
  FunscriptBundle,
  FunscriptVariant,
  MediaType,
  OsrSerialConnectionState,
  OsrSerialPortInfo,
  PlaybackMode,
  ScriptAxisId,
  SubtitleCue,
  SubtitleFile,
  VideoFile,
} from './types'
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
const DEFAULT_BUTTPLUG_SERVER_URL = 'ws://127.0.0.1:12345'
const DEFAULT_OSR_SERIAL_BAUD_RATE = 115200
const DEFAULT_OSR_SERIAL_UPDATE_RATE = 50
const HANDY_SEEK_SETTLE_TIMEOUT_MS = 500

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

function getNextPlaybackFile(
  files: VideoFile[],
  currentFile: string | null,
  playbackMode: PlaybackMode
): VideoFile | null {
  if (playbackMode === 'none' || !currentFile || files.length === 0) {
    return null
  }

  const currentIndex = files.findIndex((file) => file.path === currentFile)
  if (currentIndex < 0) {
    return null
  }

  if (playbackMode === 'sequential') {
    return currentIndex < files.length - 1 ? files[currentIndex + 1] : null
  }

  if (files.length === 1) {
    return null
  }

  const candidates = files.filter((file) => file.path !== currentFile)
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null
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
  transform: (axisId: ScriptAxisId, actions: FunscriptAction[]) => FunscriptAction[]
): AxisActionMap {
  const next: AxisActionMap = {}

  if (!scripts) return next

  for (const axisId of SCRIPT_AXIS_IDS) {
    const source = scripts[axisId]
    if (!source) continue
    const actions = Array.isArray(source) ? source : source.actions
    next[axisId] = transform(axisId, actions)
  }

  return next
}

function pickDefaultVariant(variants: FunscriptVariant[], keyword: string): FunscriptVariant | null {
  if (variants.length === 0) return null
  if (keyword.trim()) {
    const lower = keyword.trim().toLowerCase()
    const match = variants.find((v) => {
      const filename = v.path.replace(/\\/g, '/').split('/').pop() ?? ''
      return filename.toLowerCase().includes(lower)
    })
    if (match) return match
  }
  return variants.find((v) => v.isBase) ?? variants[0] ?? null
}

function getPrimaryAxis(bundle: FunscriptBundle | null): ScriptAxisId | null {
  if (!bundle) return null
  if (bundle.primaryAxis && bundle.scripts[bundle.primaryAxis]) return bundle.primaryAxis
  if (bundle.scripts.L0) return 'L0'
  return (Object.keys(bundle.scripts)[0] as ScriptAxisId | undefined) ?? null
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
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [manualScriptPaths, setManualScriptPaths] = useState<Record<string, string>>({})
  const [manualSubtitleFiles, setManualSubtitleFiles] = useState<Record<string, SubtitleFile>>({})
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(loadPlaybackMode)
  const [playbackRate, setPlaybackRate] = useState<number>(loadPlaybackRate)
  const [autoPlayRequestId, setAutoPlayRequestId] = useState(0)
  const [playlist, setPlaylist] = useState<VideoFile[]>([])
  const [playlistIndex, setPlaylistIndex] = useState<number>(-1)
  const [scriptVariants, setScriptVariants] = useState<FunscriptVariant[]>([])
  const [activeVariantPath, setActiveVariantPath] = useState<string | null>(null)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const handyUploadRequestId = useRef(0)
  const handySyncRunId = useRef(0)
  const buttplugStreamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buttplugStreamRunId = useRef(0)
  const osrSerialStreamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const osrSerialStreamRunId = useRef(0)

  const primaryAxis = useMemo(() => getPrimaryAxis(funscriptBundle), [funscriptBundle])
  const displayAxisActions = useMemo(
    () => buildAxisActionMap(
      funscriptBundle?.scripts,
      (axisId, actions) => transformFunscriptActions(actions, axisId === 'L0'
        ? {
            strokeMin: settings.strokeRangeMin,
            strokeMax: settings.strokeRangeMax,
            invert: settings.invertStroke,
          }
        : {})
    ),
    [funscriptBundle?.scripts, settings.invertStroke, settings.strokeRangeMax, settings.strokeRangeMin]
  )
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
  const displayFiles = useMemo(
    () => files.map((file) => ({
      ...file,
      hasScript: file.hasScript || Boolean(manualScriptPaths[file.path]),
      hasSubtitles: file.hasSubtitles || Boolean(manualSubtitleFiles[file.path]),
    })),
    [files, manualScriptPaths, manualSubtitleFiles]
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

    if (options?.autoplay) {
      setAutoPlayRequestId((prev) => prev + 1)
    }

    setCurrentFile(filePath)
    setCurrentFileType(resolvedType)
    setFunscriptBundle(null)
    setSubtitleCues([])
    setScriptUploadUrl(null)
    setArtworkUrl(null)
    setScriptVariants([])
    setActiveVariantPath(null)

    const [url, nextSubtitleCues, artworkPath, variants] = await Promise.all([
      window.electronAPI.getVideoUrl(filePath),
      loadSubtitleCues(filePath, resolvedType),
      resolvedType === 'audio'
        ? window.electronAPI.findArtwork(filePath)
        : Promise.resolve<string | null>(null),
      window.electronAPI.findFunscriptVariants(filePath, settings.scriptFolder || undefined),
    ])

    const defaultVariant = pickDefaultVariant(variants, settings.defaultVariantPattern)
    const parsedBundle = defaultVariant && !defaultVariant.isBase
      ? parseFunscriptBundleData(await window.electronAPI.readFunscriptBundle(filePath, settings.scriptFolder || undefined, defaultVariant.path))
      : await loadScriptBundle(filePath)

    setVideoUrl(url)
    setSubtitleCues(nextSubtitleCues)
    setFunscriptBundle(parsedBundle)
    setScriptVariants(variants)
    setActiveVariantPath(defaultVariant?.path ?? null)

    if (artworkPath) {
      const nextArtworkUrl = await window.electronAPI.getVideoUrl(artworkPath)
      setArtworkUrl(nextArtworkUrl)
    }
  }, [cancelPendingHandySync, loadScriptBundle, loadSubtitleCues, osrSerialConnected, settings.scriptFolder, stopButtplugPlayback, stopOsrSerialPlayback])

  const handleFileSelect = useCallback(async (file: VideoFile) => {
    await openMediaFile(file.path, file.type)
  }, [openMediaFile])

  const handlePlaylistItemSelect = useCallback(async (file: VideoFile, index: number) => {
    setPlaylistIndex(index)
    await openMediaFile(file.path, file.type)
  }, [openMediaFile])

  const handleAddToPlaylist = useCallback((file: VideoFile) => {
    setPlaylist((prev) => [...prev, file])
  }, [])

  const handleAddFolderToPlaylist = useCallback(() => {
    if (files.length === 0) return
    setPlaylist((prev) => [...prev, ...files])
  }, [files])

  const handleRemoveFromPlaylist = useCallback((index: number) => {
    setPlaylist((prev) => prev.filter((_, i) => i !== index))
    setPlaylistIndex((prev) => {
      if (prev < 0) return prev
      if (prev === index) return -1
      if (prev > index) return prev - 1
      return prev
    })
  }, [])

  const handleClearPlaylist = useCallback(() => {
    setPlaylist([])
    setPlaylistIndex(-1)
  }, [])

  const handleMovePlaylistItem = useCallback((fromIndex: number, direction: 'up' | 'down') => {
    setPlaylist((prev) => {
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1
      if (toIndex < 0 || toIndex >= prev.length) return prev
      const next = [...prev]
      ;[next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]]
      return next
    })
    setPlaylistIndex((prev) => {
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1
      if (prev === fromIndex) return toIndex
      if (prev === toIndex) return fromIndex
      return prev
    })
  }, [])

  const handleSavePlaylist = useCallback(async () => {
    if (playlist.length === 0) return
    const filePath = await window.electronAPI.dialogSavePlaylist()
    if (!filePath) return
    await window.electronAPI.playlistSave(filePath, playlist.map((f) => ({ path: f.path, name: f.name })))
  }, [playlist])

  const handleLoadPlaylist = useCallback(async () => {
    const filePath = await window.electronAPI.dialogOpenPlaylist()
    if (!filePath) return
    const raw = await window.electronAPI.playlistLoad(filePath)
    if (raw.length === 0) return
    const loaded: VideoFile[] = raw.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: getMediaTypeFromPath(entry.path) ?? 'video',
      hasScript: false,
      hasSubtitles: false,
    }))
    setPlaylist(loaded)
    setPlaylistIndex(-1)
  }, [])

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

  const handleVariantSelect = useCallback(async (variant: FunscriptVariant) => {
    if (!currentFile) return
    setActiveVariantPath(variant.path)
    const rawBundle = await window.electronAPI.readFunscriptBundle(currentFile, settings.scriptFolder || undefined, variant.path)
    setFunscriptBundle(parseFunscriptBundleData(rawBundle))
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

  const handleSeek = useCallback(
    async (_time: number) => {
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
    },
    [deviceProvider, osrSerialConnected, scriptUploadUrl, startButtplugPlayback, startOsrSerialPlayback, syncHandyPlaybackToCurrentMedia]
  )

  const handleTimeUpdate = useCallback((_time: number) => {}, [])

  const handleEnded = useCallback(async () => {
    if (playlistIndex >= 0 && playlist.length > 0) {
      if (playlistIndex >= playlist.length - 1) return
      const nextIndex = playlistIndex + 1
      setPlaylistIndex(nextIndex)
      await openMediaFile(playlist[nextIndex].path, playlist[nextIndex].type, { autoplay: true })
      return
    }
    const nextFile = getNextPlaybackFile(files, currentFile, playbackMode)
    if (!nextFile) return
    await openMediaFile(nextFile.path, nextFile.type, { autoplay: true })
  }, [currentFile, files, openMediaFile, playbackMode, playlist, playlistIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
      <TitleBar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          files={displayFiles}
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
          playlist={playlist}
          playlistIndex={playlistIndex}
          onPlaylistItemSelect={handlePlaylistItemSelect}
          onAddToPlaylist={handleAddToPlaylist}
          onAddFolderToPlaylist={handleAddFolderToPlaylist}
          onRemoveFromPlaylist={handleRemoveFromPlaylist}
          onClearPlaylist={handleClearPlaylist}
          onMovePlaylistItem={handleMovePlaylistItem}
          onSavePlaylist={handleSavePlaylist}
          onLoadPlaylist={handleLoadPlaylist}
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
          playbackMode={playbackMode}
          onPlaybackModeChange={setPlaybackMode}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          deviceInfo={deviceInfo}
          defaultShowHeatmap={settings.showHeatmapByDefault}
          defaultShowTimeline={settings.showTimelineByDefault}
          timelineHeight={settings.timelineHeight}
          timelineWindow={settings.timelineWindow}
          speedColors={settings.speedColors}
          subtitleFontSize={settings.subtitleFontSize}
          scriptVariants={scriptVariants}
          activeVariantPath={activeVariantPath}
          onVariantSelect={handleVariantSelect}
        />
      </div>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
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
