import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { FolderOpen, Film, FileCheck, Search, RefreshCw, Wifi, WifiOff, Folder, ChevronDown, ChevronRight, Clock, X, Zap, Music4, Captions, Copy, ListPlus, Save, Upload, Trash2, Star } from 'lucide-react'
import { OsrSerialPortInfo, ScriptAxisId, ScriptVariantOption, VideoFile } from '../types'
import { ButtplugDevice, ButtplugFeature } from '../services/buttplug'
import { isButtplugFeatureAxisCompatible } from '../services/buttplugDeviceControl'
import { groupVideoFiles, VideoSortState } from '../services/mediaOrder'
import { getScriptAxisDefinition } from '../services/multiaxis'
import { OsrSerialAxisConfig, OsrSerialAxisConfigMap, OsrSerialProfile, OSR_SERIAL_PROFILES } from '../services/osrSerialConfig'
import { OSR_SERIAL_AXIS_ORDER } from '../services/tcode'
import { useTranslation } from '../i18n'
import EroScriptsPanel from './EroScriptsPanel'

type DeviceProvider = 'handy' | 'buttplug' | 'serial'
type DeviceCompatibilityPreset = 'auto' | 'lovense-vibration' | 'sr1-bluetooth' | 'sr-safe-pause' | 'tcode-raw' | 'multi-axis-strict'

const DEVICE_COMPATIBILITY_PRESETS = [
  {
    value: 'auto',
    labelKey: 'device.compatibilityPreset.auto',
    descriptionKey: 'device.compatibilityPreset.autoDesc',
  },
  {
    value: 'lovense-vibration',
    labelKey: 'device.compatibilityPreset.lovenseVibration',
    descriptionKey: 'device.compatibilityPreset.lovenseVibrationDesc',
  },
  {
    value: 'sr1-bluetooth',
    labelKey: 'device.compatibilityPreset.sr1Bluetooth',
    descriptionKey: 'device.compatibilityPreset.sr1BluetoothDesc',
  },
  {
    value: 'sr-safe-pause',
    labelKey: 'device.compatibilityPreset.srSafePause',
    descriptionKey: 'device.compatibilityPreset.srSafePauseDesc',
  },
  {
    value: 'tcode-raw',
    labelKey: 'device.compatibilityPreset.tcodeRaw',
    descriptionKey: 'device.compatibilityPreset.tcodeRawDesc',
  },
  {
    value: 'multi-axis-strict',
    labelKey: 'device.compatibilityPreset.multiAxisStrict',
    descriptionKey: 'device.compatibilityPreset.multiAxisStrictDesc',
  },
] as const satisfies ReadonlyArray<{
  value: DeviceCompatibilityPreset
  labelKey: string
  descriptionKey: string
}>

const LOVENSE_VIBRATION_FALLBACK_AXIS_IDS: ScriptAxisId[] = ['V0', 'V1']

interface InlineOption {
  value: string
  label: string
  description?: string
}

interface InlineOptionMenuProps {
  value: string
  options: InlineOption[]
  onChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}

function InlineOptionMenu({ value, options, onChange, ariaLabel, disabled = false, className = '' }: InlineOptionMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center justify-between gap-2 rounded border border-surface-100/30 bg-surface-300 px-3 py-2 text-left text-xs text-text-primary outline-none transition-colors hover:border-accent/35 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'border-accent/45' : ''
        }`}
      >
        <span className="min-w-0 truncate">{selectedOption?.label ?? value}</span>
        <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-[90] mt-1 max-h-64 overflow-y-auto rounded-lg border border-surface-100/35 bg-surface-300 p-1 shadow-2xl"
        >
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={`w-full rounded px-2.5 py-2 text-left transition-colors ${
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-surface-200/70 hover:text-text-primary'
                }`}
              >
                <div className="truncate text-xs font-medium">{option.label}</div>
                {option.description && (
                  <div className={`mt-0.5 line-clamp-2 text-[10px] ${active ? 'text-accent/75' : 'text-text-muted'}`}>
                    {option.description}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface HandyHistoryEntry {
  key: string
  label: string
  lastUsed: number
}

const COLLAPSED_FOLDERS_STORAGE_KEY = 'sidebarCollapsedFolders'

function loadHandyHistory(): HandyHistoryEntry[] {
  try {
    const raw = localStorage.getItem('handyHistory')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveHandyHistory(history: HandyHistoryEntry[]) {
  localStorage.setItem('handyHistory', JSON.stringify(history.slice(0, 5)))
}

function loadInitialHandyKey(): string {
  try {
    const storedKey = localStorage.getItem('handyKey')
    if (storedKey) return storedKey
  } catch {
    // Ignore storage failures
  }

  return loadHandyHistory()[0]?.key || ''
}

function addToHandyHistory(key: string) {
  const history = loadHandyHistory()
  const existing = history.find(h => h.key === key)
  const label = existing?.label || `Handy ${key.slice(0, 4)}...`
  const updated = [
    { key, label, lastUsed: Date.now() },
    ...history.filter(h => h.key !== key),
  ].slice(0, 5)
  saveHandyHistory(updated)
  return updated
}

function getAutoConnect(): boolean {
  return localStorage.getItem('handyAutoConnect') === 'true'
}

function setAutoConnect(v: boolean) {
  localStorage.setItem('handyAutoConnect', v ? 'true' : 'false')
}

function loadCollapsedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0))
  } catch {
    return new Set()
  }
}

function saveCollapsedFolders(folders: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_FOLDERS_STORAGE_KEY, JSON.stringify(Array.from(folders)))
  } catch {
    // Ignore storage failures
  }
}

interface SidebarProps {
  files: VideoFile[]
  currentFile: string | null
  onFileSelect: (file: VideoFile) => void
  onOpenFolder: () => void
  playlistMode: boolean
  playlistName: string
  playlistFilePath?: string
  onAddMediaFiles: () => void | Promise<void>
  onOpenPlaylist: () => void | Promise<void>
  onSavePlaylist: () => void | Promise<void>
  onClearPlaylist: () => void | Promise<void>
  onRemovePlaylistFile: (file: VideoFile) => void | Promise<void>
  onOpenFileLocation: (file: VideoFile) => void | Promise<void>
  onTrashFile: (file: VideoFile) => void | Promise<void>
  onManualScriptSelect: (file: VideoFile) => void | Promise<void>
  onManualSubtitleSelect: (file: VideoFile) => void | Promise<void>
  onClearManualScript: (file: VideoFile) => void | Promise<void>
  onClearManualSubtitle: (file: VideoFile) => void | Promise<void>
  scriptVariants: ScriptVariantOption[]
  currentScriptSource: string | null
  scriptVariantOverrideActive: boolean
  onScriptVariantSelect: (scriptPath: string) => void | Promise<void>
  onScriptVariantReset: () => void | Promise<void>
  onCurrentScriptReload: (scriptPath: string) => void | Promise<void>
  manualScriptPaths: Set<string>
  manualSubtitlePaths: Set<string>
  deviceProvider: DeviceProvider
  onDeviceProviderChange: (provider: DeviceProvider) => void
  deviceCompatibilityPreset: DeviceCompatibilityPreset
  onDeviceCompatibilityPresetChange: (preset: DeviceCompatibilityPreset) => void
  onCopyDeviceDiagnostics: () => void | Promise<void>
  onCopyIssueReport: () => void | Promise<void>
  onCopyLastIssueReport: () => void | Promise<void>
  handyConnected: boolean
  onHandyConnect: (key: string) => void | Promise<void>
  onHandyDisconnect: () => void | Promise<void>
  osrSerialConnected: boolean
  osrSerialConnecting: boolean
  osrSerialPorts: OsrSerialPortInfo[]
  selectedOsrSerialPortPath: string
  onOsrSerialPortSelect: (portPath: string) => void
  onOsrSerialRefresh: () => void | Promise<void>
  onOsrSerialConnect: (portPath: string) => void | Promise<void>
  onOsrSerialDisconnect: () => void | Promise<void>
  osrSerialError?: string | null
  osrSerialUpdateRate: number
  onOsrSerialUpdateRateChange: (rate: number) => void
  osrSerialProfile: OsrSerialProfile
  onOsrSerialProfileChange: (profile: OsrSerialProfile) => void
  osrSerialAxisConfigs: OsrSerialAxisConfigMap
  osrSerialActiveAxes: ScriptAxisId[]
  onOsrSerialAxisConfigChange: (axisId: ScriptAxisId, patch: Partial<OsrSerialAxisConfig>) => void
  buttplugConnected: boolean
  buttplugConnecting: boolean
  buttplugDevices: ButtplugDevice[]
  buttplugServerUrl: string
  onButtplugServerUrlChange: (url: string) => void
  onButtplugConnect: (url: string) => void | Promise<void>
  onButtplugDisconnect: () => void | Promise<void>
  buttplugScanning: boolean
  onButtplugScan: () => void | Promise<void>
  selectedButtplugDeviceIndex: number | null
  onButtplugDeviceSelect: (deviceIndex: number | null) => void
  buttplugError?: string | null
  buttplugFeatures: ButtplugFeature[]
  buttplugFeatureMappings: Record<string, { axisId: ScriptAxisId | ''; invert: boolean }>
  onButtplugFeatureMappingChange: (featureId: string, next: { axisId: ScriptAxisId | ''; invert: boolean }) => void
  buttplugAvailableAxes: ScriptAxisId[]
  scriptFolder?: string
  onRescanScriptFolder: () => void | Promise<void>
  scriptFolderRescanning?: boolean
  videoSort: VideoSortState
  onVideoSortChange: (sort: VideoSortState) => void
  onFileRatingChange: (file: VideoFile, rating: number) => void
}

interface FileContextMenuState {
  file: VideoFile
  x: number
  y: number
}

interface HoverPreviewState {
  file: VideoFile
  x: number
  y: number
  url: string | null
}

const HOVER_PREVIEW_DELAY_MS = 220
const HOVER_PREVIEW_WIDTH_PX = 240
const HOVER_PREVIEW_HEIGHT_PX = 152
const HOVER_PREVIEW_VIEWPORT_MARGIN_PX = 16

function getHoverPreviewPosition(targetRect: DOMRect) {
  const preferredX = targetRect.right + 12
  const fallbackX = targetRect.left - HOVER_PREVIEW_WIDTH_PX - 12
  const maxX = window.innerWidth - HOVER_PREVIEW_WIDTH_PX - HOVER_PREVIEW_VIEWPORT_MARGIN_PX
  const x = preferredX <= maxX
    ? preferredX
    : Math.max(HOVER_PREVIEW_VIEWPORT_MARGIN_PX, fallbackX)
  const preferredY = targetRect.top + (targetRect.height / 2) - (HOVER_PREVIEW_HEIGHT_PX / 2)
  const y = Math.max(
    HOVER_PREVIEW_VIEWPORT_MARGIN_PX,
    Math.min(
      preferredY,
      window.innerHeight - HOVER_PREVIEW_HEIGHT_PX - HOVER_PREVIEW_VIEWPORT_MARGIN_PX
    )
  )
  return { x, y }
}

function getHoverPreviewStartTime(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  const target = Math.max(durationSeconds * 0.18, 1.5)
  return Math.min(target, Math.max(durationSeconds - 1, 0))
}

export default function Sidebar({
  files,
  currentFile,
  onFileSelect,
  onOpenFolder,
  playlistMode,
  playlistName,
  playlistFilePath,
  onAddMediaFiles,
  onOpenPlaylist,
  onSavePlaylist,
  onClearPlaylist,
  onRemovePlaylistFile,
  onOpenFileLocation,
  onTrashFile,
  onManualScriptSelect,
  onManualSubtitleSelect,
  onClearManualScript,
  onClearManualSubtitle,
  scriptVariants,
  currentScriptSource,
  scriptVariantOverrideActive,
  onScriptVariantSelect,
  onScriptVariantReset,
  onCurrentScriptReload,
  manualScriptPaths,
  manualSubtitlePaths,
  deviceProvider,
  onDeviceProviderChange,
  deviceCompatibilityPreset,
  onDeviceCompatibilityPresetChange,
  onCopyDeviceDiagnostics,
  onCopyIssueReport,
  onCopyLastIssueReport,
  handyConnected,
  onHandyConnect,
  onHandyDisconnect,
  osrSerialConnected,
  osrSerialConnecting,
  osrSerialPorts,
  selectedOsrSerialPortPath,
  onOsrSerialPortSelect,
  onOsrSerialRefresh,
  onOsrSerialConnect,
  onOsrSerialDisconnect,
  osrSerialError,
  osrSerialUpdateRate,
  onOsrSerialUpdateRateChange,
  osrSerialProfile,
  onOsrSerialProfileChange,
  osrSerialAxisConfigs,
  osrSerialActiveAxes,
  onOsrSerialAxisConfigChange,
  buttplugConnected,
  buttplugConnecting,
  buttplugDevices,
  buttplugServerUrl,
  onButtplugServerUrlChange,
  onButtplugConnect,
  onButtplugDisconnect,
  buttplugScanning,
  onButtplugScan,
  selectedButtplugDeviceIndex,
  onButtplugDeviceSelect,
  buttplugError,
  buttplugFeatures,
  buttplugFeatureMappings,
  onButtplugFeatureMappingChange,
  buttplugAvailableAxes,
  scriptFolder,
  onRescanScriptFolder,
  scriptFolderRescanning = false,
  videoSort,
  onVideoSortChange,
  onFileRatingChange,
}: SidebarProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'files' | 'search' | 'device'>('files')
  const [filter, setFilter] = useState('')
  const [multiAxisOnly, setMultiAxisOnly] = useState(false)
  const [ratedOnly, setRatedOnly] = useState(false)
  const [handyKey, setHandyKey] = useState(loadInitialHandyKey)
  const [connecting, setConnecting] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(loadCollapsedFolders)
  const [handyHistory, setHandyHistory] = useState<HandyHistoryEntry[]>(loadHandyHistory)
  const [autoConnect, setAutoConnectState] = useState(getAutoConnect)
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const [copiedScriptPath, setCopiedScriptPath] = useState<string | null>(null)
  const [scriptMatchReportCopied, setScriptMatchReportCopied] = useState(false)
  const autoConnectAttempted = useRef(false)
  const hoverPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedScriptPathTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedScriptMatchReportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverPreviewRequestId = useRef(0)
  const hoverPreviewUrlCache = useRef(new Map<string, string>())

  const filteredFiles = files.filter((file) => {
    const matchesText = (file.relativePath || file.name).toLowerCase().includes(filter.toLowerCase())
    const matchesAxes = !multiAxisOnly || file.scriptAxes.length > 1
    const matchesRating = !ratedOnly || (file.rating || 0) > 0
    return matchesText && matchesAxes && matchesRating
  })

  const folderGroups = useMemo(() => groupVideoFiles(filteredFiles, videoSort), [filteredFiles, videoSort])
  const availableFolderKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const file of files) {
      const relativePath = file.relativePath || file.name
      const lastSlash = relativePath.lastIndexOf('/')
      if (lastSlash <= 0) continue
      keys.add(relativePath.substring(0, lastSlash))
    }
    return keys
  }, [files])
  const orderedVisibleFiles = useMemo(
    () => folderGroups.flatMap((group) => group.files),
    [folderGroups]
  )
  const currentScriptPath = isRealScriptSource(currentScriptSource) ? currentScriptSource : null
  const scriptMatchModeLabel = currentScriptSource?.startsWith('generated://')
    ? t('sidebar.scriptMatchModeGenerated')
    : scriptVariantOverrideActive
      ? t('sidebar.scriptMatchModeManual')
      : currentScriptPath
        ? t('sidebar.scriptMatchModeAuto')
        : t('sidebar.scriptMatchModeNone')
  const showScriptVariantPanel = Boolean(currentFile) && (
    scriptVariants.length > 0 ||
    scriptVariantOverrideActive ||
    Boolean(currentScriptPath) ||
    Boolean(scriptFolder)
  )
  const hasSubfolders = folderGroups.length > 1 || (folderGroups.length === 1 && folderGroups[0].folder !== '')
  const hasRefreshableFiles = files.length > 0
  const activeDeviceConnected = deviceProvider === 'handy'
    ? handyConnected
    : (deviceProvider === 'serial' ? osrSerialConnected : buttplugConnected)
  const selectedDeviceCompatibilityPreset = useMemo(
    () => DEVICE_COMPATIBILITY_PRESETS.find((preset) => preset.value === deviceCompatibilityPreset) ?? DEVICE_COMPATIBILITY_PRESETS[0],
    [deviceCompatibilityPreset]
  )
  const selectedButtplugDevice = useMemo(
    () => buttplugDevices.find((device) => device.index === selectedButtplugDeviceIndex) ?? null,
    [buttplugDevices, selectedButtplugDeviceIndex]
  )
  const selectedOsrSerialPort = useMemo(
    () => osrSerialPorts.find((port) => port.path === selectedOsrSerialPortPath) ?? null,
    [osrSerialPorts, selectedOsrSerialPortPath]
  )
  const selectedOsrSerialPortValue = useMemo(
    () => (osrSerialPorts.some((port) => port.path === selectedOsrSerialPortPath) ? selectedOsrSerialPortPath : ''),
    [osrSerialPorts, selectedOsrSerialPortPath]
  )
  const osrSerialActiveAxisSet = useMemo(
    () => new Set(osrSerialActiveAxes),
    [osrSerialActiveAxes]
  )
  const availableAxisOptions = useMemo(
    () => buttplugAvailableAxes.map((axisId) => ({
      id: axisId,
      label: `${axisId} ${getScriptAxisDefinition(axisId).description}`,
    })),
    [buttplugAvailableAxes]
  )

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  const handleConnect = async (key?: string) => {
    const k = (key || handyKey).trim()
    if (!k) return
    try {
      setConnecting(true)
      setHandyKey(k)
      localStorage.setItem('handyKey', k)
      await onHandyConnect(k)
      const updated = addToHandyHistory(k)
      setHandyHistory(updated)
    } finally {
      setConnecting(false)
    }
  }

  const handleRemoveHistory = (key: string) => {
    const updated = handyHistory.filter(h => h.key !== key)
    saveHandyHistory(updated)
    setHandyHistory(updated)
  }

  const handleAutoConnectToggle = () => {
    const next = !autoConnect
    setAutoConnectState(next)
    setAutoConnect(next)
  }

  const handleSortFieldChange = (field: VideoSortState['field']) => {
    if (field === videoSort.field) return
    onVideoSortChange({
      ...videoSort,
      field,
      direction: field === 'rating' ? 'desc' : videoSort.direction,
    })
  }

  const handleSortDirectionToggle = () => {
    onVideoSortChange({
      ...videoSort,
      direction: videoSort.direction === 'asc' ? 'desc' : 'asc',
    })
  }

  const copyScriptPath = useCallback(async (scriptPath: string) => {
    const ok = await window.electronAPI.writeClipboardText(scriptPath)
    if (!ok) return

    setCopiedScriptPath(scriptPath)
    if (copiedScriptPathTimer.current) clearTimeout(copiedScriptPathTimer.current)
    copiedScriptPathTimer.current = setTimeout(() => {
      copiedScriptPathTimer.current = null
      setCopiedScriptPath(null)
    }, 1200)
  }, [])

  const copyScriptMatchReport = useCallback(async () => {
    const currentListEntry = currentFile
      ? files.find((file) => file.path === currentFile) ?? null
      : null
    const lines = [
      'ScriptPlayer+ script match report',
      `Captured: ${new Date().toISOString()}`,
      `Current media: ${currentFile ? `${getFileName(currentFile)} (path redacted)` : 'none'}`,
      `Current list entry: ${currentListEntry ? 'found' : 'not found'}`,
      `List script icon: ${currentListEntry?.hasScript ? 'yes' : 'no'}`,
      `List auto script path: ${currentListEntry?.autoScriptPath ? 'yes (path redacted)' : 'no'}`,
      `List script axes: ${currentListEntry?.scriptAxes.join(', ') || 'none'}`,
      `Mode: ${scriptMatchModeLabel}`,
      `Active script: ${currentScriptPath ? `${getFileName(currentScriptPath)} (path redacted)` : 'none'}`,
      `Manual override: ${scriptVariantOverrideActive ? 'yes' : 'no'}`,
      `Script folder: ${scriptFolder ? 'configured (path redacted)' : 'none'}`,
      `Visible files: ${orderedVisibleFiles.length} / ${files.length}`,
      `Text filter: ${filter ? 'active' : 'empty'}`,
      `Multi-axis filter: ${multiAxisOnly ? 'on' : 'off'}`,
      `Rated-only filter: ${ratedOnly ? 'on' : 'off'}`,
      `Variants: ${scriptVariants.length}`,
      ...(
        scriptVariants.length > 0
          ? scriptVariants.map((variant, index) => {
              return [
                `${index + 1}. ${getFileName(variant.path)} (path redacted)`,
                `source=${variant.source}`,
                `axes=${variant.axes.join('/') || 'none'}`,
                `default=${variant.isDefault ? 'yes' : 'no'}`,
                `active=${currentScriptSource === variant.path ? 'yes' : 'no'}`,
              ].join(' | ')
            })
          : ['No variants found.']
      ),
    ]
    const ok = await window.electronAPI.writeClipboardText(lines.join('\n'))
    if (!ok) return

    setScriptMatchReportCopied(true)
    if (copiedScriptMatchReportTimer.current) clearTimeout(copiedScriptMatchReportTimer.current)
    copiedScriptMatchReportTimer.current = setTimeout(() => {
      copiedScriptMatchReportTimer.current = null
      setScriptMatchReportCopied(false)
    }, 1400)
  }, [currentFile, currentScriptPath, currentScriptSource, files, filter, multiAxisOnly, orderedVisibleFiles.length, ratedOnly, scriptFolder, scriptMatchModeLabel, scriptVariantOverrideActive, scriptVariants])

  const openScriptFolder = useCallback(async (scriptPath: string) => {
    await window.electronAPI.showItemInFolder(scriptPath)
  }, [])

  const clearHoverPreviewTimer = useCallback(() => {
    if (!hoverPreviewTimer.current) return
    clearTimeout(hoverPreviewTimer.current)
    hoverPreviewTimer.current = null
  }, [])

  const hideHoverPreview = useCallback(() => {
    clearHoverPreviewTimer()
    hoverPreviewRequestId.current += 1
    setHoverPreview(null)
  }, [clearHoverPreviewTimer])

  const scheduleHoverPreview = useCallback((file: VideoFile, targetRect: DOMRect) => {
    clearHoverPreviewTimer()
    hoverPreviewRequestId.current += 1
    const requestId = hoverPreviewRequestId.current

    if (file.type === 'audio' || file.path === currentFile) {
      setHoverPreview(null)
      return
    }

    const position = getHoverPreviewPosition(targetRect)
    const cachedUrl = hoverPreviewUrlCache.current.get(file.path) ?? null

    setHoverPreview(null)

    hoverPreviewTimer.current = setTimeout(() => {
      setHoverPreview({
        file,
        x: position.x,
        y: position.y,
        url: cachedUrl,
      })

      if (cachedUrl) return

      void window.electronAPI.getVideoUrl(file.path)
        .then((url) => {
          hoverPreviewUrlCache.current.set(file.path, url)
          if (hoverPreviewRequestId.current !== requestId) return
          setHoverPreview((current) => (
            current && current.file.path === file.path
              ? { ...current, url }
              : current
          ))
        })
        .catch(() => {
          if (hoverPreviewRequestId.current !== requestId) return
          setHoverPreview(null)
        })
    }, HOVER_PREVIEW_DELAY_MS)
  }, [clearHoverPreviewTimer, currentFile])

  useEffect(() => {
    saveCollapsedFolders(collapsedFolders)
  }, [collapsedFolders])

  useEffect(() => {
    setCollapsedFolders((prev) => {
      const next = new Set(Array.from(prev).filter((folder) => availableFolderKeys.has(folder)))
      return next.size === prev.size ? prev : next
    })
  }, [availableFolderKeys])

  useEffect(() => {
    if (deviceProvider !== 'handy') {
      autoConnectAttempted.current = false
    }
  }, [deviceProvider])

  useEffect(() => {
    if (handyKey || handyHistory.length === 0) {
      return
    }

    const fallbackKey = handyHistory[0]?.key || ''
    if (!fallbackKey) {
      return
    }

    setHandyKey(fallbackKey)
    try {
      localStorage.setItem('handyKey', fallbackKey)
    } catch {
      // Ignore storage failures
    }
  }, [handyHistory, handyKey])

  useEffect(() => {
    if (
      deviceProvider !== 'handy'
      || !autoConnect
      || handyConnected
      || handyHistory.length === 0
      || autoConnectAttempted.current
    ) {
      return
    }

    autoConnectAttempted.current = true
    void handleConnect(handyHistory[0].key)
  }, [autoConnect, deviceProvider, handyConnected, handyHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!contextMenu) return

    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('blur', closeMenu)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('blur', closeMenu)
    }
  }, [contextMenu])

  useEffect(() => {
    if (tab !== 'files') {
      hideHoverPreview()
    }
  }, [tab, hideHoverPreview])

  useEffect(() => clearHoverPreviewTimer, [clearHoverPreviewTimer])

  useEffect(() => () => {
    if (copiedScriptPathTimer.current) {
      clearTimeout(copiedScriptPathTimer.current)
    }
    if (copiedScriptMatchReportTimer.current) {
      clearTimeout(copiedScriptMatchReportTimer.current)
    }
  }, [])

  const tabs = [
    { id: 'files' as const, icon: Film, label: t('sidebar.files') },
    { id: 'search' as const, icon: Search, label: t('sidebar.scripts') },
    { id: 'device' as const, icon: activeDeviceConnected ? Wifi : WifiOff, label: t('sidebar.device') },
  ]

  const handleFileContextMenu = (event: React.MouseEvent<HTMLButtonElement>, file: VideoFile) => {
    event.preventDefault()
    event.stopPropagation()
    hideHoverPreview()
    setContextMenu({
      file,
      x: event.clientX,
      y: event.clientY,
    })
  }

  const handleFileSelect = (file: VideoFile) => {
    hideHoverPreview()
    onFileSelect(file)
  }

  const renderFileItem = (file: VideoFile) => (
    <button
      key={file.path}
      onClick={() => handleFileSelect(file)}
      onMouseEnter={(event) => scheduleHoverPreview(file, event.currentTarget.getBoundingClientRect())}
      onMouseLeave={hideHoverPreview}
      onContextMenu={(event) => handleFileContextMenu(event, file)}
      className={`w-full text-left px-3 py-2 rounded-md text-xs flex items-start gap-2 transition-colors mb-0.5 ${
        currentFile === file.path
          ? 'bg-accent/15 text-accent'
          : 'text-text-secondary hover:bg-surface-100/30 hover:text-text-primary'
      }`}
    >
      {file.type === 'audio'
        ? <Music4 size={14} className="flex-shrink-0 mt-0.5" />
        : <Film size={14} className="flex-shrink-0 mt-0.5" />}
      <span className="flex-1 min-w-0 leading-relaxed">
        <span className="block break-all">{file.name}</span>
        {file.relativePath && file.relativePath !== file.name && (
          <span className="mt-0.5 block truncate text-[10px] text-text-muted">
            {file.relativePath}
          </span>
        )}
      </span>
      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
        {(file.rating || 0) > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onFileRatingChange(file, (file.rating || 0) >= 5 ? 0 : (file.rating || 0) + 1)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              onFileRatingChange(file, (file.rating || 0) >= 5 ? 0 : (file.rating || 0) + 1)
            }}
            className="inline-flex cursor-pointer items-center gap-0.5 rounded border border-amber-300/25 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 transition-colors hover:border-amber-300/45 hover:bg-amber-400/15"
            title={t('sidebar.fileRating', { rating: String(file.rating || 0) })}
          >
            <Star size={11} className="fill-amber-300 text-amber-300" />
            {file.rating}
          </span>
        )}
        {file.hasSubtitles && <Captions size={14} className="text-sky-400" />}
        {file.hasScript && <FileCheck size={14} className="text-green-400" />}
      </div>
    </button>
  )

  return (
    <div className="w-72 flex-shrink-0 bg-surface-200 border-r border-surface-100/30 flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-surface-100/30">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2.5 flex flex-col items-center gap-1 text-[10px] transition-colors ${
              tab === id
                ? 'text-accent border-b-2 border-accent bg-surface-100/20'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'files' && (
          <>
            <div className="p-2 flex gap-2">
              <button
                onClick={onOpenFolder}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded bg-accent/10 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/20"
              >
                <FolderOpen size={14} className="flex-shrink-0" />
                <span className="truncate">{t('sidebar.openFolder')}</span>
              </button>
              <button
                type="button"
                onClick={() => void onAddMediaFiles()}
                className="flex h-[30px] w-[34px] flex-shrink-0 items-center justify-center rounded border border-surface-100/30 bg-surface-300 text-text-secondary transition-colors hover:border-accent/35 hover:text-accent"
                title={t('sidebar.addMediaFiles')}
                aria-label={t('sidebar.addMediaFiles')}
              >
                <ListPlus size={14} />
              </button>
              <button
                type="button"
                onClick={() => void onOpenPlaylist()}
                className="flex h-[30px] w-[34px] flex-shrink-0 items-center justify-center rounded border border-surface-100/30 bg-surface-300 text-text-secondary transition-colors hover:border-accent/35 hover:text-accent"
                title={t('sidebar.openPlaylist')}
                aria-label={t('sidebar.openPlaylist')}
              >
                <Upload size={14} />
              </button>
              <button
                type="button"
                onClick={() => void onSavePlaylist()}
                disabled={files.length === 0}
                className="flex h-[30px] w-[34px] flex-shrink-0 items-center justify-center rounded border border-surface-100/30 bg-surface-300 text-text-secondary transition-colors hover:border-accent/35 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                title={t('sidebar.savePlaylist')}
                aria-label={t('sidebar.savePlaylist')}
              >
                <Save size={14} />
              </button>
              <button
                type="button"
                onClick={() => void onRescanScriptFolder()}
                disabled={!hasRefreshableFiles || scriptFolderRescanning}
                className="flex h-[30px] w-[34px] flex-shrink-0 items-center justify-center rounded border border-surface-100/30 bg-surface-300 text-text-secondary transition-colors hover:border-accent/35 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                title={t('sidebar.rescanScriptFolder')}
                aria-label={t('sidebar.rescanScriptFolder')}
              >
                <RefreshCw size={14} className={scriptFolderRescanning ? 'animate-spin' : ''} />
              </button>
            </div>
            {playlistMode && (
              <div className="px-2 pb-2">
                <div
                  className="flex items-center gap-2 rounded border border-accent/25 bg-accent/10 px-2.5 py-2"
                  title={playlistFilePath || playlistName || t('sidebar.unsavedPlaylist')}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-medium uppercase tracking-wider text-accent/80">
                      {t('sidebar.playlist')}
                    </div>
                    <div className="truncate text-xs text-text-primary">
                      {playlistName || t('sidebar.unsavedPlaylist')}
                    </div>
                    <div className="truncate text-[10px] text-text-muted">
                      {t('sidebar.playlistItemCount', { count: String(files.length) })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onClearPlaylist()}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-surface-100/30 text-text-muted transition-colors hover:border-red-400/40 hover:text-red-300"
                    title={t('sidebar.clearPlaylist')}
                    aria-label={t('sidebar.clearPlaylist')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
            <div className="px-2 pb-2">
              <input
                type="text"
                placeholder={t('sidebar.filterFiles')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none placeholder:text-text-muted"
              />
            </div>
            <div className="px-2 pb-2">
              <button
                onClick={() => setMultiAxisOnly((value) => !value)}
                className={`w-full rounded border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors ${
                  multiAxisOnly
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-surface-100/30 bg-surface-300 text-text-secondary hover:text-text-primary'
                }`}
                type="button"
              >
                {t('sidebar.multiAxisOnly')}
              </button>
            </div>
            <div className="px-2 pb-2">
              <button
                onClick={() => setRatedOnly((value) => !value)}
                className={`w-full rounded border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors ${
                  ratedOnly
                    ? 'border-amber-300/45 bg-amber-400/10 text-amber-200'
                    : 'border-surface-100/30 bg-surface-300 text-text-secondary hover:text-text-primary'
                }`}
                type="button"
              >
                {t('sidebar.ratedOnly')}
              </button>
            </div>
            <div className="px-2 pb-2 flex gap-2">
              <InlineOptionMenu
                value={videoSort.field}
                onChange={(value) => handleSortFieldChange(value as VideoSortState['field'])}
                ariaLabel={t('sidebar.sortBy')}
                className="flex-1"
                options={[
                  { value: 'path', label: t('sidebar.sortByPath') },
                  { value: 'name', label: t('sidebar.sortByName') },
                  { value: 'modified', label: t('sidebar.sortByModified') },
                  { value: 'rating', label: t('sidebar.sortByRating') },
                ]}
              />
              <button
                onClick={handleSortDirectionToggle}
                className="min-w-[56px] px-2.5 py-1.5 rounded border border-surface-100/30 bg-surface-300 text-[10px] text-text-secondary transition-colors hover:text-text-primary"
                title={videoSort.direction === 'asc' ? t('sidebar.sortAscending') : t('sidebar.sortDescending')}
                aria-label={videoSort.direction === 'asc' ? t('sidebar.sortAscending') : t('sidebar.sortDescending')}
              >
                {videoSort.direction === 'asc' ? t('sidebar.sortAscShort') : t('sidebar.sortDescShort')}
              </button>
            </div>
            {showScriptVariantPanel && (
              <div className="px-2 pb-2">
                <div className="rounded border border-surface-100/30 bg-surface-300/60 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
                      {t('sidebar.scriptVariants')}
                    </div>
                    <div className="flex items-center gap-1">
                      {currentScriptPath && (
                        <>
                          <button
                            type="button"
                            onClick={() => void copyScriptPath(currentScriptPath)}
                            className="flex h-6 w-6 items-center justify-center rounded border border-surface-100/30 text-text-muted transition-colors hover:border-accent/35 hover:text-accent"
                            title={copiedScriptPath === currentScriptPath ? t('sidebar.scriptPathCopied') : t('sidebar.copyScriptPath')}
                            aria-label={copiedScriptPath === currentScriptPath ? t('sidebar.scriptPathCopied') : t('sidebar.copyScriptPath')}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void openScriptFolder(currentScriptPath)}
                            className="flex h-6 w-6 items-center justify-center rounded border border-surface-100/30 text-text-muted transition-colors hover:border-accent/35 hover:text-accent"
                            title={t('sidebar.openScriptFolder')}
                            aria-label={t('sidebar.openScriptFolder')}
                          >
                            <FolderOpen size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onCurrentScriptReload(currentScriptPath)}
                            className="flex h-6 w-6 items-center justify-center rounded border border-surface-100/30 text-text-muted transition-colors hover:border-accent/35 hover:text-accent"
                            title={t('sidebar.reloadCurrentScript')}
                            aria-label={t('sidebar.reloadCurrentScript')}
                          >
                            <RefreshCw size={12} />
                          </button>
                        </>
                      )}
                      {scriptVariantOverrideActive && (
                      <button
                        onClick={() => void onScriptVariantReset()}
                        className="rounded border border-surface-100/30 px-2 py-1 text-[10px] text-text-secondary transition-colors hover:text-text-primary"
                      >
                        {t('sidebar.useAutoScript')}
                      </button>
                      )}
                    </div>
                  </div>
                  {currentScriptPath && (
                    <div
                      className="mb-2 truncate rounded border border-surface-100/20 bg-surface-200/40 px-2 py-1.5 font-mono text-[10px] text-text-muted"
                      title={currentScriptPath}
                    >
                      {getFileName(currentScriptPath)}
                    </div>
                  )}
                  <div className="mb-2 rounded border border-surface-100/20 bg-surface-200/30 px-2 py-1.5 text-[10px] text-text-muted">
                    <div className="mb-1 font-medium uppercase tracking-wider text-text-secondary">
                      {t('sidebar.scriptMatchDebug')}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span>{t('sidebar.scriptMatchMode')}</span>
                        <span className="truncate text-text-secondary">{scriptMatchModeLabel}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t('sidebar.scriptMatchActive')}</span>
                        <span className="truncate text-text-secondary">
                          {currentScriptPath ? getFileName(currentScriptPath) : t('sidebar.scriptMatchNone')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t('sidebar.scriptMatchVariantsFound')}</span>
                        <span className="text-text-secondary">{scriptVariants.length}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t('sidebar.scriptMatchFolder')}</span>
                        <span className="text-text-secondary">
                          {scriptFolder ? t('sidebar.configured') : t('sidebar.notConfigured')}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyScriptMatchReport()}
                      className="mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded border border-surface-100/25 bg-surface-100/15 px-2 text-[10px] text-text-secondary transition-colors hover:border-accent/35 hover:text-accent"
                    >
                      <Copy size={11} />
                      {scriptMatchReportCopied ? t('sidebar.scriptMatchReportCopied') : t('sidebar.copyScriptMatchReport')}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {scriptVariants.length === 0 ? (
                      <div className="rounded border border-amber-300/20 bg-amber-400/10 px-2.5 py-2 text-[10px] text-amber-100/80">
                        <div className="font-medium text-amber-100">
                          {t('sidebar.scriptMatchNoVariants')}
                        </div>
                        <div className="mt-1 leading-relaxed text-amber-100/62">
                          {t('sidebar.scriptMatchNoVariantsHint')}
                        </div>
                      </div>
                    ) : scriptVariants.map((variant) => {
                      const active = currentScriptSource === variant.path
                      const meta = [
                        variant.source === 'local'
                          ? t('sidebar.scriptSourceLocal')
                          : t('sidebar.scriptSourceFolder'),
                        variant.axes.join(' / '),
                      ].join(' · ')

                      return (
                        <button
                          key={variant.path}
                          onClick={() => void onScriptVariantSelect(variant.path)}
                          className={`w-full rounded border px-2.5 py-2 text-left transition-colors ${
                            active
                              ? 'border-accent/40 bg-accent/10 text-accent'
                              : 'border-surface-100/30 bg-surface-200/40 text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          <div className="truncate text-xs font-medium">
                            {variant.isDefault ? t('sidebar.scriptDefaultVariant') : variant.label}
                          </div>
                          <div className={`truncate text-[10px] ${active ? 'text-accent/80' : 'text-text-muted'}`}>
                            {meta}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-1" onScroll={hideHoverPreview}>
              {filteredFiles.length === 0 ? (
                <div className="text-text-muted text-xs text-center py-8">
                  {files.length === 0 ? t('sidebar.noFiles') : t('sidebar.noMatch')}
                </div>
              ) : hasSubfolders ? (
                folderGroups.map((group) => {
                  const isCollapsed = collapsedFolders.has(group.folder)
                  const folderName = group.folder || '/'
                  return (
                    <div key={group.folder} className="mb-1">
                      <button
                        onClick={() => toggleFolder(group.folder)}
                        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-[10px] text-text-muted transition-colors hover:text-text-secondary"
                      >
                        <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
                          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        </span>
                        <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
                          <Folder size={12} className="text-accent/50" />
                        </span>
                        <span className="truncate font-medium">{folderName}</span>
                        <span className="ml-auto flex-shrink-0 text-text-muted/50">{group.files.length}</span>
                      </button>
                      {!isCollapsed && (
                        <div className="ml-2">
                          {group.files.map(renderFileItem)}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                orderedVisibleFiles.map(renderFileItem)
              )}
            </div>
          </>
        )}

        {tab === 'search' && (
          <EroScriptsPanel
            currentVideoName={currentFile ? getFileName(currentFile) : null}
            scriptFolder={scriptFolder}
          />
        )}

        {tab === 'device' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4">
            <div>
              <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                {t('device.provider')}
              </label>
              <InlineOptionMenu
                value={deviceProvider}
                onChange={(value) => onDeviceProviderChange(value as DeviceProvider)}
                ariaLabel={t('device.provider')}
                options={[
                  { value: 'handy', label: t('device.providerHandy') },
                  { value: 'serial', label: t('device.providerSerial') },
                  { value: 'buttplug', label: t('device.providerIntiface') },
                ]}
              />
            </div>

            <div className="rounded border border-surface-100/25 bg-surface-300/45 p-2.5 space-y-2">
              <label className="text-[10px] text-text-muted uppercase tracking-wider block">
                {t('device.compatibilityPreset')}
              </label>
              <InlineOptionMenu
                value={deviceCompatibilityPreset}
                onChange={(value) => onDeviceCompatibilityPresetChange(value as DeviceCompatibilityPreset)}
                ariaLabel={t('device.compatibilityPreset')}
                options={DEVICE_COMPATIBILITY_PRESETS.map((preset) => ({
                  value: preset.value,
                  label: t(preset.labelKey),
                  description: t(preset.descriptionKey),
                }))}
              />
              <p className="text-[10px] text-text-muted leading-relaxed">
                {t(selectedDeviceCompatibilityPreset.descriptionKey)}
              </p>
              <button
                type="button"
                onClick={onCopyDeviceDiagnostics}
                className="w-full py-2 text-xs bg-surface-100/20 text-text-secondary hover:bg-surface-100/30 rounded transition-colors flex items-center justify-center gap-2"
              >
                <Copy size={12} />
                {t('device.copyDiagnostics')}
              </button>
              <button
                type="button"
                onClick={onCopyIssueReport}
                className="w-full py-2 text-xs bg-accent/10 text-accent hover:bg-accent/15 rounded transition-colors flex items-center justify-center gap-2"
              >
                <Copy size={12} />
                {t('device.copyIssueReport')}
              </button>
              <button
                type="button"
                onClick={onCopyLastIssueReport}
                className="w-full py-2 text-xs bg-surface-100/15 text-text-muted hover:bg-surface-100/25 hover:text-text-secondary rounded transition-colors flex items-center justify-center gap-2"
              >
                <Clock size={12} />
                {t('device.copyLastIssueReport')}
              </button>
            </div>

            {deviceProvider === 'handy' ? (
              <>
                <div>
                  <h3 className="text-xs font-medium text-text-primary mb-2">{t('device.theHandy')}</h3>
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        handyConnected ? 'bg-green-400' : 'bg-text-muted'
                      }`}
                    />
                    <span className="text-xs text-text-secondary">
                      {handyConnected ? t('device.connected') : t('device.disconnected')}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                    {t('device.connectionKey')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('device.enterKey')}
                    value={handyKey}
                    onChange={(e) => setHandyKey(e.target.value)}
                    className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none placeholder:text-text-muted font-mono"
                  />
                </div>
                {handyConnected ? (
                  <button
                    onClick={onHandyDisconnect}
                    className="w-full py-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                  >
                    {t('device.disconnect')}
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect()}
                    disabled={connecting || !handyKey.trim()}
                    className="w-full py-2 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {connecting ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" />
                        {t('device.connecting')}
                      </>
                    ) : (
                      t('device.connect')
                    )}
                  </button>
                )}

                <button
                  onClick={handleAutoConnectToggle}
                  className={`w-full py-2 text-xs rounded transition-colors flex items-center justify-center gap-2 ${
                    autoConnect
                      ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                      : 'bg-surface-100/20 text-text-muted hover:bg-surface-100/30'
                  }`}
                >
                  <Zap size={12} />
                  {autoConnect ? t('device.autoConnectOn') : t('device.autoConnectOff')}
                </button>

                {handyHistory.length > 0 && !handyConnected && (
                  <div>
                    <label className="text-[10px] text-text-muted uppercase tracking-wider flex items-center gap-1 mb-1.5">
                      <Clock size={10} />
                      {t('device.recentKeys')}
                    </label>
                    <div className="space-y-1">
                      {handyHistory.map((entry) => (
                        <div key={entry.key} className="flex items-center gap-1">
                          <button
                            onClick={() => handleConnect(entry.key)}
                            disabled={connecting}
                            className="flex-1 text-left px-2 py-1.5 text-xs font-mono text-text-secondary bg-surface-300 hover:bg-surface-100/30 rounded transition-colors truncate disabled:opacity-40"
                          >
                            {entry.key}
                          </button>
                          <button
                            onClick={() => handleRemoveHistory(entry.key)}
                            className="p-1 text-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-text-muted leading-relaxed">
                  {t('device.getKey')}
                </p>
              </>
            ) : deviceProvider === 'serial' ? (
              <>
                <div>
                  <h3 className="text-xs font-medium text-text-primary mb-2">{t('device.serial')}</h3>
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        osrSerialConnected ? 'bg-green-400' : 'bg-text-muted'
                      }`}
                    />
                    <span className="text-xs text-text-secondary">
                      {osrSerialConnected ? t('device.connected') : t('device.disconnected')}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                      {t('device.serialPort')}
                    </label>
                    <select
                      value={selectedOsrSerialPortValue}
                      onChange={(event) => onOsrSerialPortSelect(event.target.value)}
                      className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none"
                    >
                      {osrSerialPorts.length === 0 ? (
                        <option value="">{t('device.noSerialPorts')}</option>
                      ) : (
                        osrSerialPorts.map((port) => (
                          <option key={port.path} value={port.path}>
                            {port.displayName}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <button
                    onClick={onOsrSerialRefresh}
                    className="self-end px-3 py-2 text-xs bg-surface-100/20 text-text-secondary hover:bg-surface-100/30 rounded transition-colors flex items-center gap-2"
                  >
                    <RefreshCw size={12} />
                    {t('device.refresh')}
                  </button>
                </div>

                <div>
                  <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                    {t('device.updateRate')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={5}
                      max={200}
                      step={1}
                      value={osrSerialUpdateRate}
                      onChange={(event) => onOsrSerialUpdateRateChange(Number(event.target.value))}
                      className="flex-1"
                    />
                    <input
                      type="number"
                      min={5}
                      max={200}
                      step={1}
                      value={osrSerialUpdateRate}
                      onChange={(event) => onOsrSerialUpdateRateChange(Number(event.target.value))}
                      className="w-20 bg-surface-300 text-text-primary text-xs px-2 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none"
                    />
                    <span className="text-[10px] text-text-muted">Hz</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                    {t('device.serialProfile')}
                  </label>
                  <select
                    value={osrSerialProfile}
                    onChange={(event) => onOsrSerialProfileChange(event.target.value as OsrSerialProfile)}
                    className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none"
                  >
                    {OSR_SERIAL_PROFILES.map((profile) => (
                      <option key={profile} value={profile}>
                        {t(`device.serialProfile.${profile}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] text-text-muted uppercase tracking-wider">
                    {t('device.serialAxisTuning')}
                  </div>
                  {OSR_SERIAL_AXIS_ORDER.map((axisId) => {
                    const axis = getScriptAxisDefinition(axisId)
                    const config = osrSerialAxisConfigs[axisId] || {
                      enabled: true,
                      invert: false,
                      min: 0,
                      max: 100,
                    }
                    const active = osrSerialActiveAxisSet.has(axisId)
                    const customProfile = osrSerialProfile === 'custom'

                    return (
                      <div
                        key={axisId}
                        className={`rounded border border-surface-100/30 bg-surface-300/60 p-2 transition-opacity ${
                          active ? '' : 'opacity-45'
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label className="flex min-w-0 items-center gap-2 text-xs text-text-secondary">
                            <input
                              type="checkbox"
                              checked={active}
                              disabled={!customProfile}
                              onChange={(event) => onOsrSerialAxisConfigChange(axisId, { enabled: event.target.checked })}
                            />
                            <span className="truncate">
                              {axis.label} {axis.description}
                            </span>
                          </label>
                          <label className="flex items-center gap-1 text-[10px] text-text-muted">
                            <input
                              type="checkbox"
                              checked={config.invert}
                              disabled={!active}
                              onChange={(event) => onOsrSerialAxisConfigChange(axisId, { invert: event.target.checked })}
                            />
                            {t('device.invertAxis')}
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[10px] text-text-muted">
                            {t('device.axisMin')}
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={config.min}
                              disabled={!active}
                              onChange={(event) => onOsrSerialAxisConfigChange(axisId, { min: Number(event.target.value) })}
                              className="mt-1 w-full rounded border border-surface-100/30 bg-surface-200 px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50 disabled:opacity-50"
                            />
                          </label>
                          <label className="text-[10px] text-text-muted">
                            {t('device.axisMax')}
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={config.max}
                              disabled={!active}
                              onChange={(event) => onOsrSerialAxisConfigChange(axisId, { max: Number(event.target.value) })}
                              className="mt-1 w-full rounded border border-surface-100/30 bg-surface-200 px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50 disabled:opacity-50"
                            />
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {selectedOsrSerialPort && (
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    {[
                      selectedOsrSerialPort.manufacturer,
                      selectedOsrSerialPort.serialNumber,
                      selectedOsrSerialPort.vendorId && selectedOsrSerialPort.productId
                        ? `${selectedOsrSerialPort.vendorId}:${selectedOsrSerialPort.productId}`
                        : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}

                {osrSerialConnected ? (
                  <button
                    onClick={onOsrSerialDisconnect}
                    className="w-full py-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                  >
                    {t('device.disconnect')}
                  </button>
                ) : (
                  <button
                    onClick={() => onOsrSerialConnect(selectedOsrSerialPortValue)}
                    disabled={osrSerialConnecting || !selectedOsrSerialPortValue}
                    className="w-full py-2 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {osrSerialConnecting ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" />
                        {t('device.connecting')}
                      </>
                    ) : (
                      t('device.connect')
                    )}
                  </button>
                )}

                {osrSerialError && (
                  <p className="text-[10px] text-red-400 leading-relaxed">
                    {osrSerialError}
                  </p>
                )}

                <p className="text-[10px] text-text-muted leading-relaxed">
                  {t('device.serialHint')}
                </p>
              </>
            ) : (
              <>
                <div>
                  <h3 className="text-xs font-medium text-text-primary mb-2">{t('device.intiface')}</h3>
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        buttplugConnected ? 'bg-green-400' : 'bg-text-muted'
                      }`}
                    />
                    <span className="text-xs text-text-secondary">
                      {buttplugConnected ? t('device.connected') : t('device.disconnected')}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                    {t('device.intifaceServer')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('device.enterIntifaceServer')}
                    value={buttplugServerUrl}
                    onChange={(event) => onButtplugServerUrlChange(event.target.value)}
                    className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none placeholder:text-text-muted font-mono"
                  />
                </div>
                {buttplugConnected ? (
                  <button
                    onClick={onButtplugDisconnect}
                    className="w-full py-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                  >
                    {t('device.disconnect')}
                  </button>
                ) : (
                  <button
                    onClick={() => onButtplugConnect(buttplugServerUrl)}
                    disabled={buttplugConnecting || !buttplugServerUrl.trim()}
                    className="w-full py-2 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {buttplugConnecting ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" />
                        {t('device.connecting')}
                      </>
                    ) : (
                      t('device.connect')
                    )}
                  </button>
                )}

                <button
                  onClick={onButtplugScan}
                  disabled={!buttplugConnected || buttplugScanning}
                  className="w-full py-2 text-xs bg-surface-100/20 text-text-secondary hover:bg-surface-100/30 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {buttplugScanning ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      {t('device.scanning')}
                    </>
                  ) : (
                    t('device.scan')
                  )}
                </button>

                <div>
                  <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                    {t('device.linearDevice')}
                  </label>
                  <select
                    value={selectedButtplugDevice ? selectedButtplugDevice.index.toString() : ''}
                    onChange={(event) => onButtplugDeviceSelect(event.target.value ? Number(event.target.value) : null)}
                    disabled={!buttplugConnected || buttplugDevices.length === 0}
                    className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none disabled:opacity-40"
                  >
                    {buttplugDevices.length === 0 ? (
                      <option value="">{t('device.noLinearDevices')}</option>
                    ) : (
                      buttplugDevices.map((device) => (
                        <option key={device.index} value={device.index}>
                          {`${device.displayName} (${device.features.length})`}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {selectedButtplugDevice && (
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    {selectedButtplugDevice.features.map((feature) => feature.descriptor).join(', ')}
                  </p>
                )}

                {selectedButtplugDevice && buttplugFeatures.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-[10px] text-text-muted uppercase tracking-wider block">
                      {t('device.axisMapping')}
                    </label>
                    {buttplugFeatures.map((feature) => {
                      const mapping = buttplugFeatureMappings[feature.id] || { axisId: '', invert: false }
                      const mappedAxisId = mapping.axisId && isButtplugFeatureAxisCompatible(feature, mapping.axisId)
                        ? mapping.axisId
                        : ''
                      const axisOptionById = new Map(availableAxisOptions.map((axis) => [axis.id, axis]))
                      const compatibleAxisIds = new Set<ScriptAxisId>()
                      availableAxisOptions.forEach((axis) => {
                        if (isButtplugFeatureAxisCompatible(feature, axis.id)) {
                          compatibleAxisIds.add(axis.id)
                        }
                      })
                      if (mappedAxisId) {
                        compatibleAxisIds.add(mappedAxisId)
                      }
                      if (
                        deviceCompatibilityPreset === 'lovense-vibration' &&
                        feature.type === 'scalar' &&
                        `${feature.descriptor} ${feature.actuatorType ?? ''}`.toLowerCase().includes('vib')
                      ) {
                        LOVENSE_VIBRATION_FALLBACK_AXIS_IDS.forEach((axisId) => {
                          if (isButtplugFeatureAxisCompatible(feature, axisId)) {
                            compatibleAxisIds.add(axisId)
                          }
                        })
                      }
                      const compatibleAxisOptions = Array.from(compatibleAxisIds).map((axisId) => (
                        axisOptionById.get(axisId) ?? {
                          id: axisId,
                          label: `${axisId} ${getScriptAxisDefinition(axisId).description}`,
                        }
                      ))

                      return (
                        <div key={feature.id} className="rounded border border-surface-100/30 bg-surface-300/60 p-2 space-y-2">
                          <div className="text-[10px] text-text-secondary">
                            {feature.descriptor}
                          </div>
                          <div className="flex gap-2">
                            <select
                              value={mappedAxisId}
                              onChange={(event) => onButtplugFeatureMappingChange(feature.id, {
                                ...mapping,
                                axisId: event.target.value as ScriptAxisId | '',
                              })}
                              className="flex-1 bg-surface-300 text-text-primary text-xs px-2 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none"
                            >
                              <option value="">{t('device.unmapped')}</option>
                              {compatibleAxisOptions.map((axis) => (
                                <option key={axis.id} value={axis.id}>
                                  {axis.label}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => onButtplugFeatureMappingChange(feature.id, {
                                ...mapping,
                                invert: !mapping.invert,
                              })}
                              disabled={!mappedAxisId}
                              className={`px-2 py-1.5 rounded text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                mappedAxisId && mapping.invert
                                  ? 'bg-accent/15 text-accent'
                                  : 'bg-surface-100/20 text-text-muted hover:bg-surface-100/30 disabled:hover:bg-surface-100/20'
                              }`}
                            >
                              {t('device.invertAxis')}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {buttplugError && (
                  <p className="text-[10px] text-red-400 leading-relaxed">
                    {buttplugError}
                  </p>
                )}

                <p className="text-[10px] text-text-muted leading-relaxed">
                  {t('device.intifaceHint')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {hoverPreview && (
        <div
          className="pointer-events-none fixed z-40"
          style={{
            left: hoverPreview.x,
            top: hoverPreview.y,
            width: HOVER_PREVIEW_WIDTH_PX,
            height: HOVER_PREVIEW_HEIGHT_PX,
          }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-xl border border-surface-100/40 bg-black/95 shadow-2xl">
            {hoverPreview.url ? (
              <video
                key={hoverPreview.file.path}
                src={hoverPreview.url}
                muted
                autoPlay
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
                onLoadedMetadata={(event) => {
                  const previewVideo = event.currentTarget
                  previewVideo.currentTime = getHoverPreviewStartTime(previewVideo.duration)
                  void previewVideo.play().catch(() => {})
                }}
                onEnded={(event) => {
                  const previewVideo = event.currentTarget
                  previewVideo.currentTime = getHoverPreviewStartTime(previewVideo.duration)
                  void previewVideo.play().catch(() => {})
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-black/80 text-text-muted">
                <RefreshCw size={18} className="animate-spin" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2 pt-5">
              <div className="truncate text-[11px] font-medium text-white">
                {hoverPreview.file.name}
              </div>
              <div className="truncate text-[10px] text-white/60">
                {hoverPreview.file.relativePath || hoverPreview.file.path}
              </div>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-48 overflow-hidden rounded-lg border border-surface-100/40 bg-surface-200 shadow-2xl"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 220),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 360)),
          }}
        >
          <div className="border-b border-surface-100/30 px-3 py-2">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
              {t('sidebar.setRating')}
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((rating) => {
                const active = (contextMenu.file.rating || 0) >= rating
                return (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => {
                      const currentRating = contextMenu.file.rating || 0
                      onFileRatingChange(contextMenu.file, currentRating === rating ? 0 : rating)
                      setContextMenu(null)
                    }}
                    className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                      active
                        ? 'text-amber-300 hover:bg-amber-400/10'
                        : 'text-text-muted hover:bg-surface-100/30 hover:text-amber-200'
                    }`}
                    title={t('sidebar.fileRating', { rating: String(rating) })}
                  >
                    <Star size={14} className={active ? 'fill-amber-300' : ''} />
                  </button>
                )
              })}
              {(contextMenu.file.rating || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onFileRatingChange(contextMenu.file, 0)
                    setContextMenu(null)
                  }}
                  className="ml-1 rounded px-1.5 py-1 text-[10px] text-text-muted transition-colors hover:bg-surface-100/30 hover:text-text-primary"
                >
                  {t('sidebar.clearRating')}
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setContextMenu(null)
              onManualScriptSelect(contextMenu.file)
            }}
            className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
          >
            {t('sidebar.selectScript')}
          </button>
          <button
            onClick={() => {
              setContextMenu(null)
              onManualSubtitleSelect(contextMenu.file)
            }}
            className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
          >
            {t('sidebar.selectSubtitle')}
          </button>
          <button
            onClick={() => {
              setContextMenu(null)
              onOpenFileLocation(contextMenu.file)
            }}
            className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
          >
            {t('sidebar.openFileLocation')}
          </button>
          {manualScriptPaths.has(contextMenu.file.path) && (
            <button
              onClick={() => {
                setContextMenu(null)
                onClearManualScript(contextMenu.file)
              }}
              className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
            >
              {t('sidebar.clearManualScript')}
            </button>
          )}
          {manualSubtitlePaths.has(contextMenu.file.path) && (
            <button
              onClick={() => {
                setContextMenu(null)
                onClearManualSubtitle(contextMenu.file)
              }}
              className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
            >
              {t('sidebar.clearManualSubtitle')}
            </button>
          )}
          {playlistMode && (
            <button
              onClick={() => {
                setContextMenu(null)
                onRemovePlaylistFile(contextMenu.file)
              }}
              className="w-full px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10 transition-colors"
            >
              {t('sidebar.removeFromPlaylist')}
            </button>
          )}
          <button
            onClick={() => {
              setContextMenu(null)
              onTrashFile(contextMenu.file)
            }}
            className="w-full px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10 transition-colors"
          >
            {t('sidebar.trashFile')}
          </button>
        </div>
      )}
    </div>
  )
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || ''
}

function isRealScriptSource(sourcePath: string | null): sourcePath is string {
  return Boolean(sourcePath && !sourcePath.startsWith('generated://'))
}
