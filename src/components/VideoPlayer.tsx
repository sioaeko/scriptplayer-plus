import { useRef, useEffect, useCallback, useState } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Shuffle,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  BarChart3,
  Activity,
  Captions,
  AlertCircle,
  Loader2,
  Music4,
  SlidersHorizontal,
  Clock3,
  RotateCcw,
  RefreshCw,
  Copy,
  FolderOpen,
  Trash2,
} from 'lucide-react'
import { Funscript, FunscriptAction, MediaType, PlaybackMode, ScriptVariantOption, SubtitleCue, VideoFile } from '../types'
import { useTranslation } from '../i18n'
import { getActiveSubtitleText } from '../services/subtitles'
import {
  findMatchingShortcutAction,
  isEditableShortcutTarget,
  ShortcutActionId,
  ShortcutBindings,
} from '../services/shortcuts'
import ScriptTimeline from './ScriptTimeline'
import ScriptHeatmap from './ScriptHeatmap'
import {
  buildVideoMotionFunscript,
  VIDEO_MOTION_SCRIPT_MODELS,
  type VideoMotionScriptModelId,
} from '../services/videoMotionScript'

interface DeviceOverlayInfo {
  connected: boolean
  label: string
  detail?: string | null
  statusText?: string | null
  statusTone?: 'busy' | 'error' | null
}

type FullscreenDrawerTab = 'files' | 'scripts' | 'device'

export interface ScriptDebugInfo {
  enabled: boolean
  sourcePath: string | null
  sourceLabel: string
  axes: string[]
  offsetMs: number
  offsetScope: string
}

const PLAYER_SHORTCUT_ACTIONS: ShortcutActionId[] = [
  'playPause',
  'seekBackward',
  'seekForward',
  'seekBackwardLarge',
  'seekForwardLarge',
  'previousVideo',
  'nextVideo',
  'goToStart',
  'goToEnd',
  'setSegmentRepeatStart',
  'setSegmentRepeatEnd',
  'openSegmentRepeatEditor',
  'volumeUp',
  'volumeDown',
  'toggleMute',
  'toggleFullscreen',
  'decreaseStrokeRange',
  'increaseStrokeRange',
  'decreaseScriptOffset',
  'increaseScriptOffset',
  'resetScriptOffset',
]

interface VideoPlayerProps {
  mediaSessionKey: number
  videoUrl: string | null
  currentFilePath?: string | null
  mediaType: MediaType | null
  currentFileName: string | null
  artworkUrl: string | null
  actions: FunscriptAction[]
  scriptSource?: string | null
  scriptDebugInfo?: ScriptDebugInfo | null
  scriptFolder?: string
  scriptVariants?: ScriptVariantOption[]
  scriptVariantOverrideActive?: boolean
  onScriptVariantSelect?: (scriptPath: string) => void | Promise<void>
  onScriptVariantReset?: () => void | Promise<void>
  onManualScriptSelect?: () => void | Promise<void>
  subtitleCues: SubtitleCue[]
  onTimeUpdate: (time: number) => void
  onPlay: () => void | Promise<void>
  onPause: () => void | Promise<void>
  onSeek: (time: number) => void | Promise<void>
  onEnded: () => void | Promise<void>
  mediaRef: React.MutableRefObject<HTMLMediaElement | null>
  playlistFiles?: VideoFile[]
  onPlaylistFileSelect?: (file: VideoFile) => void | Promise<void>
  autoPlayRequestId: number
  canGoToPreviousFile?: boolean
  onPreviousFile?: () => void | Promise<void>
  canGoToNextFile?: boolean
  onNextFile?: () => void | Promise<void>
  playbackMode: PlaybackMode
  onPlaybackModeChange: (mode: PlaybackMode) => void
  loopCurrentMedia: boolean
  onLoopCurrentMediaChange: (enabled: boolean) => void
  playbackRate: number
  onPlaybackRateChange: (rate: number) => void
  onDurationChange?: (duration: number) => void
  shortcutBindings: ShortcutBindings
  shortcutsEnabled?: boolean
  deviceInfo?: DeviceOverlayInfo | null
  strokeRangeMin?: number
  strokeRangeMax?: number
  invertStroke?: boolean
  onStrokeRangeChange?: (min: number, max: number) => void
  onInvertStrokeChange?: (invert: boolean) => void
  scriptOffset?: number
  onScriptOffsetChange?: (offsetMs: number) => void
  onReloadScriptSource?: (scriptPath: string) => void | Promise<void>
  onOpenDeviceSettings?: () => void
  defaultShowHeatmap?: boolean
  defaultShowTimeline?: boolean
  autoFitVideoByAspect?: boolean
  rememberVideoFit?: boolean
  videoCompatibilityMode?: string
  onTryVideoCompatibilityMode?: () => void | Promise<void>
  onAiScriptGenerated?: (script: Funscript, modelLabel: string) => Promise<string | null>
  timelineHeight?: number
  timelineWindow?: number
  speedColors?: boolean
  subtitleFontSize?: number
}

const PLAYBACK_RATE_MIN = 0.5
const PLAYBACK_RATE_MAX = 2
const PLAYBACK_RATE_STEP = 0.1
const PLAYBACK_RATE_PRESETS = [0.75, 1, 1.25, 1.5] as const
const STROKE_RANGE_SHORTCUT_SPAN_STEP = 10
const SCRIPT_OFFSET_MIN_MS = -5000
const SCRIPT_OFFSET_MAX_MS = 5000
const SCRIPT_OFFSET_SMALL_STEP_MS = 50
const SCRIPT_OFFSET_LARGE_STEP_MS = 250
const TOP_NAV_TRIGGER_HEIGHT_PX = 84
const SEGMENT_REPEAT_STORAGE_KEY = 'scriptplayer-segment-repeats-v1'
const SEGMENT_REPEAT_FILE_MIGRATION_KEY = 'scriptplayer-segment-repeats-file-migrated-v1'
const SEGMENT_REPEAT_FILE_VERSION = 1
const SEGMENT_REPEAT_MIN_DURATION_SECONDS = 0.25
const PROGRESS_THUMBNAIL_WIDTH_PX = 176
const FULLSCREEN_FILE_DRAWER_FALLBACK_WIDTH_PX = 360
const FULLSCREEN_FILE_DRAWER_TRIGGER_PX = 56

interface SegmentRepeatItem {
  id: string
  start: number
  end: number
}

interface SegmentRepeatState {
  draftStart: number | null
  draftEnd: number | null
  enabled: boolean
  activeId: string | null
  segments: SegmentRepeatItem[]
}

interface StoredSegmentRepeatItem {
  id?: string
  start?: number
  end?: number
}

interface StoredSegmentRepeat {
  start?: number
  end?: number
  draftStart?: number
  draftEnd?: number
  enabled?: boolean
  activeId?: string | null
  segments?: StoredSegmentRepeatItem[]
}

interface StoredSegmentRepeatFile {
  version?: number
  updatedAt?: string
  segmentsByMedia?: Record<string, StoredSegmentRepeat>
}

interface ProgressThumbnailState {
  time: number
  leftPercent: number
}

const EMPTY_SEGMENT_REPEAT: SegmentRepeatState = {
  draftStart: null,
  draftEnd: null,
  enabled: false,
  activeId: null,
  segments: [],
}

function readLocalSegmentRepeatStore(): Record<string, StoredSegmentRepeat> {
  try {
    const raw = localStorage.getItem(SEGMENT_REPEAT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return normalizeSegmentRepeatStoreRecord(parsed)
  } catch {
    return {}
  }
}

function writeLocalSegmentRepeatStore(store: Record<string, StoredSegmentRepeat>) {
  try {
    localStorage.setItem(SEGMENT_REPEAT_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage failures.
  }
}

function getSegmentRepeatStateFromStore(store: Record<string, StoredSegmentRepeat>, storageKey: string): SegmentRepeatState {
  if (!storageKey) return EMPTY_SEGMENT_REPEAT

  const stored = store[storageKey]
  if (!stored || typeof stored !== 'object') {
    return EMPTY_SEGMENT_REPEAT
  }

  const draftStart = normalizeSegmentPoint(stored.draftStart ?? stored.start)
  const draftEnd = normalizeSegmentPoint(stored.draftEnd ?? stored.end)
  const storedSegments = Array.isArray(stored.segments)
    ? normalizeSegmentRepeatItems(stored.segments)
    : []
  const legacySegment = normalizeSegmentRepeatItem({
    id: 'legacy',
    start: stored.start,
    end: stored.end,
  }, 0)
  const segments = storedSegments.length > 0
    ? storedSegments
    : (legacySegment ? [legacySegment] : [])
  const activeId = typeof stored.activeId === 'string' && segments.some((segment) => segment.id === stored.activeId)
    ? stored.activeId
    : segments[0]?.id ?? null
  const enabled = Boolean(stored.enabled && activeId)

  return {
    draftStart,
    draftEnd,
    enabled,
    activeId,
    segments,
  }
}

function updateSegmentRepeatStore(
  store: Record<string, StoredSegmentRepeat>,
  storageKey: string,
  state: SegmentRepeatState
): Record<string, StoredSegmentRepeat> {
  if (!storageKey) return store

  const nextStore = { ...store }
  if (state.draftStart === null && state.draftEnd === null && state.segments.length === 0) {
    delete nextStore[storageKey]
  } else {
    const activeId = state.activeId && state.segments.some((segment) => segment.id === state.activeId)
      ? state.activeId
      : state.segments[0]?.id ?? null
    nextStore[storageKey] = {
      draftStart: state.draftStart ?? undefined,
      draftEnd: state.draftEnd ?? undefined,
      activeId,
      enabled: Boolean(state.enabled && activeId),
      segments: state.segments.map((segment) => ({
        id: segment.id,
        start: segment.start,
        end: segment.end,
      })),
    }
  }

  return nextStore
}

async function loadPreferredSegmentRepeatStore(scriptFolder?: string | null): Promise<Record<string, StoredSegmentRepeat>> {
  const localStore = readLocalSegmentRepeatStore()
  const normalizedScriptFolder = scriptFolder?.trim()
  if (!normalizedScriptFolder) {
    return localStore
  }

  try {
    const response = await window.electronAPI.readSegmentRepeatStore(normalizedScriptFolder)
    if (!response.ok) {
      return localStore
    }

    const fileStore = response.exists && response.content
      ? parseSegmentRepeatStoreFile(response.content)
      : {}
    const migrationKey = normalizeSegmentRepeatPathKey(normalizedScriptFolder)
    const migrationMap = readSegmentRepeatMigrationMap()
    if (!migrationMap[migrationKey] && hasSegmentRepeatStoreEntries(localStore)) {
      const mergedStore = {
        ...localStore,
        ...fileStore,
      }
      const writeOk = await writeSegmentRepeatStoreFile(normalizedScriptFolder, mergedStore)
      if (writeOk) {
        writeSegmentRepeatMigrationMap({
          ...migrationMap,
          [migrationKey]: true,
        })
        writeLocalSegmentRepeatStore(mergedStore)
        return mergedStore
      }
    }

    return response.exists ? fileStore : localStore
  } catch {
    return localStore
  }
}

async function persistPreferredSegmentRepeatStore(
  scriptFolder: string | null | undefined,
  store: Record<string, StoredSegmentRepeat>
): Promise<void> {
  writeLocalSegmentRepeatStore(store)

  const normalizedScriptFolder = scriptFolder?.trim()
  if (!normalizedScriptFolder) {
    return
  }

  await writeSegmentRepeatStoreFile(normalizedScriptFolder, store)
}

async function writeSegmentRepeatStoreFile(
  scriptFolder: string,
  store: Record<string, StoredSegmentRepeat>
): Promise<boolean> {
  try {
    const response = await window.electronAPI.writeSegmentRepeatStore(
      scriptFolder,
      JSON.stringify({
        version: SEGMENT_REPEAT_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        segmentsByMedia: store,
      } satisfies StoredSegmentRepeatFile, null, 2)
    )
    return response.ok
  } catch {
    return false
  }
}

function parseSegmentRepeatStoreFile(content: string): Record<string, StoredSegmentRepeat> {
  try {
    const parsed = JSON.parse(content) as StoredSegmentRepeatFile | Record<string, StoredSegmentRepeat>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'segmentsByMedia' in parsed) {
      return normalizeSegmentRepeatStoreRecord((parsed as StoredSegmentRepeatFile).segmentsByMedia)
    }

    return normalizeSegmentRepeatStoreRecord(parsed)
  } catch {
    return {}
  }
}

function normalizeSegmentRepeatStoreRecord(raw: unknown): Record<string, StoredSegmentRepeat> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }

  const next: Record<string, StoredSegmentRepeat> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!key || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    next[key] = value as StoredSegmentRepeat
  }

  return next
}

function hasSegmentRepeatStoreEntries(store: Record<string, StoredSegmentRepeat>): boolean {
  return Object.keys(store).length > 0
}

function readSegmentRepeatMigrationMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SEGMENT_REPEAT_FILE_MIGRATION_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, boolean] => typeof entry[0] === 'string' && typeof entry[1] === 'boolean')
    )
  } catch {
    return {}
  }
}

function writeSegmentRepeatMigrationMap(map: Record<string, boolean>) {
  try {
    localStorage.setItem(SEGMENT_REPEAT_FILE_MIGRATION_KEY, JSON.stringify(map))
  } catch {
    // Ignore storage failures.
  }
}

function normalizeSegmentRepeatPathKey(filePath: string): string {
  return window.electronAPI.platform === 'win32' ? filePath.toLowerCase() : filePath
}

function normalizeSegmentPoint(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function isValidSegmentRange(start: number | null, end: number | null): start is number {
  return start !== null && end !== null && end - start >= SEGMENT_REPEAT_MIN_DURATION_SECONDS
}

function normalizeSegmentRepeatItems(items: StoredSegmentRepeatItem[]): SegmentRepeatItem[] {
  const usedIds = new Set<string>()
  const segments: SegmentRepeatItem[] = []

  items.forEach((item, index) => {
    const segment = normalizeSegmentRepeatItem(item, index)
    if (!segment) return

    let id = segment.id
    while (usedIds.has(id)) {
      id = createSegmentRepeatId(segment.start, segment.end, usedIds.size)
    }
    usedIds.add(id)
    segments.push({ ...segment, id })
  })

  return sortSegmentRepeatItems(segments)
}

function normalizeSegmentRepeatItem(item: StoredSegmentRepeatItem, index: number): SegmentRepeatItem | null {
  const start = normalizeSegmentPoint(item.start)
  const end = normalizeSegmentPoint(item.end)
  if (start === null || end === null || !isValidSegmentRange(start, end)) {
    return null
  }

  return {
    id: typeof item.id === 'string' && item.id.trim().length > 0
      ? item.id
      : createSegmentRepeatId(start, end, index),
    start,
    end,
  }
}

function createSegmentRepeatId(start: number, end: number, index = Date.now()): string {
  return `seg-${Math.round(start * 1000)}-${Math.round(end * 1000)}-${index.toString(36)}`
}

function sortSegmentRepeatItems(segments: SegmentRepeatItem[]): SegmentRepeatItem[] {
  return [...segments].sort((a, b) => (
    a.start === b.start ? a.end - b.end : a.start - b.start
  ))
}

function getActiveSegmentRepeatItem(state: SegmentRepeatState): SegmentRepeatItem | null {
  if (state.activeId) {
    const active = state.segments.find((segment) => segment.id === state.activeId)
    if (active) return active
  }

  return state.segments[0] ?? null
}

function areSameMediaPath(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false
  return left.toLowerCase() === right.toLowerCase()
}

export default function VideoPlayer({
  mediaSessionKey,
  videoUrl,
  currentFilePath = null,
  mediaType,
  currentFileName,
  artworkUrl,
  actions,
  scriptSource = null,
  scriptDebugInfo = null,
  scriptFolder = '',
  scriptVariants = [],
  scriptVariantOverrideActive = false,
  onScriptVariantSelect,
  onScriptVariantReset,
  onManualScriptSelect,
  subtitleCues,
  onTimeUpdate,
  onPlay,
  onPause,
  onSeek,
  onEnded,
  mediaRef,
  playlistFiles = [],
  onPlaylistFileSelect,
  autoPlayRequestId,
  canGoToPreviousFile = false,
  onPreviousFile,
  canGoToNextFile = false,
  onNextFile,
  playbackMode,
  onPlaybackModeChange,
  loopCurrentMedia,
  onLoopCurrentMediaChange,
  playbackRate,
  onPlaybackRateChange,
  onDurationChange,
  shortcutBindings,
  shortcutsEnabled = true,
  deviceInfo,
  strokeRangeMin = 0,
  strokeRangeMax = 100,
  invertStroke = false,
  onStrokeRangeChange,
  onInvertStrokeChange,
  scriptOffset = 0,
  onScriptOffsetChange,
  onReloadScriptSource,
  onOpenDeviceSettings,
  defaultShowHeatmap = false,
  defaultShowTimeline = false,
  autoFitVideoByAspect = false,
  rememberVideoFit = false,
  videoCompatibilityMode = 'auto',
  onTryVideoCompatibilityMode,
  onAiScriptGenerated,
  timelineHeight = 64,
  timelineWindow = 10,
  speedColors = true,
  subtitleFontSize = 20,
}: VideoPlayerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [showDeviceOverlay, setShowDeviceOverlay] = useState(false)
  const [showStrokeControls, setShowStrokeControls] = useState(false)
  const [showScriptOffsetControls, setShowScriptOffsetControls] = useState(false)
  const [showPlaybackRatePopover, setShowPlaybackRatePopover] = useState(false)
  const [showSegmentRepeatControls, setShowSegmentRepeatControls] = useState(false)
  const [showAiScriptDialog, setShowAiScriptDialog] = useState(false)
  const [selectedAiScriptModelId, setSelectedAiScriptModelId] = useState<VideoMotionScriptModelId>('local-motion-accurate')
  const [aiScriptGeneration, setAiScriptGeneration] = useState<{
    running: boolean
    progress: number
    error: string | null
    savedPath: string | null
  }>({
    running: false,
    progress: 0,
    error: null,
    savedPath: null,
  })
  const [aiScriptDiagnosticsSuppressedMediaKey, setAiScriptDiagnosticsSuppressedMediaKey] = useState<string | null>(null)
  const [showHeatmap, setShowHeatmap] = useState(defaultShowHeatmap)
  const [showTimeline, setShowTimeline] = useState(defaultShowTimeline)
  const deviceOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scriptOffsetFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const strokeControlsRef = useRef<HTMLDivElement>(null)
  const playbackRateControlsRef = useRef<HTMLDivElement>(null)
  const scriptOffsetControlsRef = useRef<HTMLDivElement>(null)
  const segmentRepeatControlsRef = useRef<HTMLDivElement>(null)
  const selectedAiScriptModel = VIDEO_MOTION_SCRIPT_MODELS.find((model) => model.id === selectedAiScriptModelId)
    ?? VIDEO_MOTION_SCRIPT_MODELS[0]
  const canGenerateAiScript = Boolean(mediaType === 'video' && videoUrl && onAiScriptGenerated)
  const videoDiagnosticsMediaKey = `${videoUrl ?? ''}:${currentFileName ?? ''}`
  const handleGenerateAiScript = useCallback(async () => {
    const video = mediaRef.current
    if (!(video instanceof HTMLVideoElement) || !onAiScriptGenerated || aiScriptGeneration.running) {
      return
    }

    setAiScriptDiagnosticsSuppressedMediaKey(videoDiagnosticsMediaKey)
    setAiScriptGeneration({
      running: true,
      progress: 0,
      error: null,
      savedPath: null,
    })

    try {
      const script = await buildVideoMotionFunscript(video, currentFileName || 'Current media', {
        model: selectedAiScriptModel,
        sensitivity: 55,
        onProgress: (progress) => {
          setAiScriptGeneration((state) => ({
            ...state,
            progress,
          }))
        },
      })

      if (!script) {
        setAiScriptGeneration({
          running: false,
          progress: 0,
          error: t('player.aiScriptFailed'),
          savedPath: null,
        })
        return
      }

      const savedPath = await onAiScriptGenerated(script, selectedAiScriptModel.label)
      setAiScriptGeneration({
        running: false,
        progress: 1,
        error: null,
        savedPath,
      })
    } catch {
      setAiScriptGeneration({
        running: false,
        progress: 0,
        error: t('player.aiScriptFailed'),
        savedPath: null,
      })
    }
  }, [
    aiScriptGeneration.running,
    currentFileName,
    mediaRef,
    onAiScriptGenerated,
    selectedAiScriptModel,
    t,
    videoDiagnosticsMediaKey,
  ])
  const strokeCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedMediaStateKey = useRef<string | null>(null)
  const fullscreenFileDrawerRef = useRef<HTMLDivElement>(null)
  const fullscreenScriptOverlayRef = useRef<HTMLDivElement>(null)
  const fullscreenControlsOverlayRef = useRef<HTMLDivElement>(null)
  const fullscreenDrawerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fullscreenDrawerHoldUntilRef = useRef(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState<PlaybackDiagnosticsSnapshot | null>(null)
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false)
  const [progressPreviewTime, setProgressPreviewTime] = useState<number | null>(null)
  const [isProgressScrubbing, setIsProgressScrubbing] = useState(false)
  const [duration, setDuration] = useState(0)
  const [displayDuration, setDisplayDuration] = useState(0)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('volume')
    return saved ? parseFloat(saved) : 1
  })
  const [muted, setMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [videoFillEnabled, setVideoFillEnabled] = useState(() => rememberVideoFit ? loadVideoFitPreference() ?? false : false)
  const [videoFillMode, setVideoFillMode] = useState<VideoFillMode>(() => (
    rememberVideoFit && loadVideoFitPreference() !== null ? 'manual' : null
  ))
  const [segmentRepeat, setSegmentRepeat] = useState<SegmentRepeatState>(EMPTY_SEGMENT_REPEAT)
  const [progressThumbnail, setProgressThumbnail] = useState<ProgressThumbnailState | null>(null)
  const [showFullscreenFileDrawer, setShowFullscreenFileDrawer] = useState(false)
  const [fullscreenDrawerTab, setFullscreenDrawerTab] = useState<FullscreenDrawerTab>('files')
  const [fullscreenScriptOverlayHeight, setFullscreenScriptOverlayHeight] = useState(0)
  const [fullscreenControlsOverlayHeight, setFullscreenControlsOverlayHeight] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [showTopNav, setShowTopNav] = useState(false)
  const [showSubtitles, setShowSubtitles] = useState(subtitleCues.length > 0)
  const [scriptOffsetFeedback, setScriptOffsetFeedback] = useState<number | null>(null)
  const [scriptPathCopied, setScriptPathCopied] = useState(false)
  const scriptOffsetRef = useRef(scriptOffset)
  const scriptPathCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressThumbnailVideoRef = useRef<HTMLVideoElement>(null)
  const segmentRepeatRef = useRef(segmentRepeat)
  const segmentRepeatStoreRef = useRef<Record<string, StoredSegmentRepeat>>({})
  const segmentRepeatLoadRunId = useRef(0)
  const [strokeDraft, setStrokeDraft] = useState(() => ({
    min: strokeRangeMin,
    max: strokeRangeMax,
  }))
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diagnosticsEventsRef = useRef<PlaybackDiagnosticsEvents>(createEmptyPlaybackDiagnosticsEvents())
  const diagnosticsFramesRef = useRef<PlaybackDiagnosticsFrames>(createEmptyPlaybackDiagnosticsFrames())
  const diagnosticsBlackFrameSampleRef = useRef<PlaybackBlackFrameSample | null>(null)
  const diagnosticsCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playbackFrameRef = useRef<number | null>(null)
  const handledAutoPlayRequest = useRef(0)
  const progressScrubbingRef = useRef(false)
  const progressSeekTimeRef = useRef<number | null>(null)
  const effectiveCurrentTime = isProgressScrubbing && progressPreviewTime !== null ? progressPreviewTime : currentTime
  const currentSubtitleText = showSubtitles ? getActiveSubtitleText(subtitleCues, effectiveCurrentTime) : ''
  const firstActionTimeSeconds = actions.length > 0 ? Math.max(0, actions[0].at / 1000) : null
  const currentScriptPath = isRealScriptSource(scriptSource) ? scriptSource : null
  const scriptSourceName = scriptSource ? getFileNameFromPath(scriptSource) : null
  const scriptStatusText = actions.length === 0
    ? null
    : (
        firstActionTimeSeconds !== null && effectiveCurrentTime + 0.05 < firstActionTimeSeconds
          ? t('player.scriptStartsAt', {
              count: actions.length.toString(),
              time: formatTime(firstActionTimeSeconds),
            })
          : t('player.scriptLoaded', { count: actions.length.toString() })
      )
  const controlsVisible = showControls || !playing
  const fullscreenScriptVisible = isFullscreen && actions.length > 0 && (showHeatmap || showTimeline)
  const subtitleBottomOffset = 24 + (
    isFullscreen
      ? fullscreenScriptOverlayHeight + (controlsVisible ? fullscreenControlsOverlayHeight : 0)
      : 0
  )
  const videoClassName = getVideoClassName({
    videoFillEnabled,
    isFullscreen,
  })
  const controlsContainerClass = isFullscreen
    ? 'absolute inset-x-0 bottom-0 z-10 px-4 pb-3 pt-4'
    : 'relative flex-shrink-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-3 pt-8'
  const controlsPanelClass = isFullscreen
    ? 'rounded-2xl border border-white/14 bg-black px-3 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.6)]'
    : ''
  const mediaStateKey = `${mediaSessionKey}:${videoUrl ?? 'none'}`
  const setVideoFitInside = useCallback(() => {
    setVideoFillEnabled(false)
    setVideoFillMode('manual')

    if (rememberVideoFit) {
      saveVideoFitPreference(false)
    }
  }, [rememberVideoFit])
  const setVideoFillCrop = useCallback(() => {
    setVideoFillEnabled(true)
    setVideoFillMode('manual')

    if (rememberVideoFit) {
      saveVideoFitPreference(true)
    }
  }, [rememberVideoFit])

  useEffect(() => {
    const handleRemoteCommand = (event: Event) => {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command
      if (command !== 'toggle_fit_fill') {
        return
      }

      if (videoFillEnabled) {
        setVideoFitInside()
      } else {
        setVideoFillCrop()
      }
    }

    window.addEventListener('scriptplayer:remote-command', handleRemoteCommand)
    return () => {
      window.removeEventListener('scriptplayer:remote-command', handleRemoteCommand)
    }
  }, [setVideoFillCrop, setVideoFitInside, videoFillEnabled])
  const segmentRepeatStorageKey = currentFilePath || mediaStateKey
  const activeSegmentRepeat = getActiveSegmentRepeatItem(segmentRepeat)
  const segmentRepeatActive = Boolean(segmentRepeat.enabled && activeSegmentRepeat)
  const segmentRepeatReady = Boolean(activeSegmentRepeat)
  const hasSegmentRepeatDraft = segmentRepeat.draftStart !== null || segmentRepeat.draftEnd !== null
  const fullscreenDrawerFiles = playlistFiles
  const fullscreenDrawerHasFiles = fullscreenDrawerFiles.length > 0
  const fullscreenDrawerHasScripts = Boolean(scriptSource || scriptVariants.length > 0 || onManualScriptSelect)
  const fullscreenDrawerHasDevice = Boolean(deviceInfo || onOpenDeviceSettings)
  const fullscreenDrawerAvailable = fullscreenDrawerHasFiles || fullscreenDrawerHasScripts || fullscreenDrawerHasDevice
  const debugScriptPathCandidate = scriptDebugInfo?.sourcePath ?? null
  const debugScriptPath = isRealScriptSource(debugScriptPathCandidate) ? debugScriptPathCandidate : null
  const progressPercent = duration > 0
    ? Math.max(0, Math.min(100, (effectiveCurrentTime / duration) * 100))
    : 0
  const progressBarWrapClass = isFullscreen
    ? 'relative mb-3'
    : 'relative mb-2'
  const controlRowClass = isFullscreen
    ? 'flex items-center justify-between gap-4'
    : 'flex items-center justify-between gap-4'

  useEffect(() => {
    if (!fullscreenDrawerAvailable) return

    const activeTabAvailable = (
      (fullscreenDrawerTab === 'files' && fullscreenDrawerHasFiles)
      || (fullscreenDrawerTab === 'scripts' && fullscreenDrawerHasScripts)
      || (fullscreenDrawerTab === 'device' && fullscreenDrawerHasDevice)
    )
    if (activeTabAvailable) return

    setFullscreenDrawerTab(
      fullscreenDrawerHasFiles
        ? 'files'
        : fullscreenDrawerHasScripts
          ? 'scripts'
          : 'device'
    )
  }, [
    fullscreenDrawerAvailable,
    fullscreenDrawerHasDevice,
    fullscreenDrawerHasFiles,
    fullscreenDrawerHasScripts,
    fullscreenDrawerTab,
  ])

  const syncCurrentTimeFromMedia = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    if (progressScrubbingRef.current) return
    const nextTime = media.currentTime
    setCurrentTime((prevTime) => (Math.abs(prevTime - nextTime) >= 1 / 240 ? nextTime : prevTime))
    onTimeUpdate(nextTime)
  }, [mediaRef, onTimeUpdate])

  const syncDurationFromMedia = useCallback(() => {
    const media = mediaRef.current
    if (!media) return

    const rawDuration = media.duration
    if (Number.isFinite(rawDuration) && rawDuration > 0) {
      setDuration((prevDuration) => (Math.abs(prevDuration - rawDuration) >= 1 / 240 ? rawDuration : prevDuration))
      setDisplayDuration((prevDisplayDuration) => getStableDisplayDuration(prevDisplayDuration, rawDuration, media.currentTime))
    }

  }, [mediaRef])

  const collectDiagnosticsSnapshot = useCallback((): PlaybackDiagnosticsSnapshot => {
    const media = mediaRef.current
    const quality = getVideoPlaybackQualitySnapshot(media)
    const frames = summarizePlaybackDiagnosticsFrames(diagnosticsFramesRef.current)
    const renderer = getWebGlRendererInfo()
    const deviceMemory = (navigator as NavigatorWithDeviceMemory).deviceMemory

    return {
      capturedAt: new Date().toISOString(),
      platform: window.electronAPI?.platform || navigator.platform,
      userAgent: navigator.userAgent,
      versions: window.electronAPI?.versions ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: typeof deviceMemory === 'number' ? deviceMemory : null,
      mediaType,
      videoCompatibilityMode,
      fileName: currentFileName || '',
      hasSource: Boolean(videoUrl),
      videoWidth: media instanceof HTMLVideoElement ? media.videoWidth : 0,
      videoHeight: media instanceof HTMLVideoElement ? media.videoHeight : 0,
      duration: Number.isFinite(media?.duration) ? media?.duration ?? 0 : 0,
      currentTime: Number.isFinite(media?.currentTime) ? media?.currentTime ?? 0 : 0,
      playbackRate: media?.playbackRate ?? 1,
      readyState: media?.readyState ?? 0,
      networkState: media?.networkState ?? 0,
      paused: media?.paused ?? true,
      mediaError: getMediaErrorSnapshot(media),
      events: { ...diagnosticsEventsRef.current },
      frames,
      quality,
      renderer,
      blackFrameSample: diagnosticsBlackFrameSampleRef.current,
      actionCount: actions.length,
      subtitleCount: subtitleCues.length,
    }
  }, [actions.length, currentFileName, mediaRef, mediaType, subtitleCues.length, videoCompatibilityMode, videoUrl])

  const handleCopyDiagnostics = useCallback(async () => {
    const snapshot = collectDiagnosticsSnapshot()
    setDiagnosticsSnapshot(snapshot)

    try {
      if (window.electronAPI?.writeClipboardText) {
        await window.electronAPI.writeClipboardText(formatPlaybackDiagnostics(snapshot))
      } else {
        await navigator.clipboard.writeText(formatPlaybackDiagnostics(snapshot))
      }
      setDiagnosticsCopied(true)
      if (diagnosticsCopiedTimer.current) {
        clearTimeout(diagnosticsCopiedTimer.current)
      }
      diagnosticsCopiedTimer.current = setTimeout(() => setDiagnosticsCopied(false), 1600)
    } catch (error) {
      console.warn('[VideoPlayer] failed to copy playback diagnostics', error)
    }
  }, [collectDiagnosticsSnapshot])

  const handleTimeUpdate = useCallback(() => {
    syncCurrentTimeFromMedia()
  }, [syncCurrentTimeFromMedia])

  useEffect(() => {
    if (!videoUrl) {
      setDiagnosticsSnapshot(null)
      return
    }

    setDiagnosticsSnapshot(collectDiagnosticsSnapshot())
    const intervalId = window.setInterval(() => {
      setDiagnosticsSnapshot(collectDiagnosticsSnapshot())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [collectDiagnosticsSnapshot, videoUrl])

  useEffect(() => {
    const media = mediaRef.current
    if (!media || !videoUrl) return

    diagnosticsEventsRef.current = createEmptyPlaybackDiagnosticsEvents()
    diagnosticsFramesRef.current = createEmptyPlaybackDiagnosticsFrames()

    const increment = (key: keyof PlaybackDiagnosticsEvents) => {
      diagnosticsEventsRef.current[key] += 1
    }
    const handleWaiting = () => increment('waiting')
    const handleStalled = () => increment('stalled')
    const handleSuspend = () => increment('suspend')
    const handleError = () => increment('error')

    media.addEventListener('waiting', handleWaiting)
    media.addEventListener('stalled', handleStalled)
    media.addEventListener('suspend', handleSuspend)
    media.addEventListener('error', handleError)

    return () => {
      media.removeEventListener('waiting', handleWaiting)
      media.removeEventListener('stalled', handleStalled)
      media.removeEventListener('suspend', handleSuspend)
      media.removeEventListener('error', handleError)
    }
  }, [mediaRef, mediaStateKey, videoUrl])

  useEffect(() => {
    const media = mediaRef.current
    if (!(media instanceof HTMLVideoElement) || !videoUrl || mediaType !== 'video') {
      diagnosticsBlackFrameSampleRef.current = null
      return
    }

    let lastSampleAt = 0
    const sampleFrame = () => {
      const now = performance.now()
      if (now - lastSampleAt < 1000) return
      lastSampleAt = now
      diagnosticsBlackFrameSampleRef.current = sampleVideoBlackFrame(media)
    }

    const intervalId = window.setInterval(sampleFrame, 1500)
    media.addEventListener('loadeddata', sampleFrame)
    media.addEventListener('seeked', sampleFrame)
    media.addEventListener('timeupdate', sampleFrame)
    sampleFrame()

    return () => {
      window.clearInterval(intervalId)
      media.removeEventListener('loadeddata', sampleFrame)
      media.removeEventListener('seeked', sampleFrame)
      media.removeEventListener('timeupdate', sampleFrame)
    }
  }, [mediaRef, mediaStateKey, mediaType, videoUrl])

  useEffect(() => {
    const media = mediaRef.current as HTMLMediaElementWithVideoFrameCallback | null
    if (!media || !videoUrl || typeof media.requestVideoFrameCallback !== 'function') return

    let active = true
    let callbackId: number | null = null
    const frames = diagnosticsFramesRef.current
    frames.lastFrameWallMs = 0
    frames.lastMediaTime = 0
    frames.presentedFrames = 0

    const onFrame = (now: number, metadata: VideoFrameMetadataLike) => {
      if (!active) return

      if (frames.lastFrameWallMs > 0) {
        const wallDeltaMs = now - frames.lastFrameWallMs
        const mediaDeltaMs = Math.max(0, (metadata.mediaTime - frames.lastMediaTime) * 1000)
        pushCappedNumber(frames.wallDeltasMs, wallDeltaMs, 3600)
        if (wallDeltaMs >= 90 || mediaDeltaMs >= 90) {
          frames.largeGaps += 1
          frames.lastLargeGap = {
            atMediaTime: metadata.mediaTime,
            wallDeltaMs,
            mediaDeltaMs,
          }
        }
      }

      frames.lastFrameWallMs = now
      frames.lastMediaTime = metadata.mediaTime
      frames.presentedFrames = metadata.presentedFrames ?? frames.presentedFrames
      callbackId = media.requestVideoFrameCallback?.(onFrame) ?? null
    }

    callbackId = media.requestVideoFrameCallback(onFrame)

    return () => {
      active = false
      if (callbackId !== null && typeof media.cancelVideoFrameCallback === 'function') {
        media.cancelVideoFrameCallback(callbackId)
      }
    }
  }, [mediaRef, mediaStateKey, videoUrl])

  useEffect(() => {
    return () => {
      if (diagnosticsCopiedTimer.current) {
        clearTimeout(diagnosticsCopiedTimer.current)
      }
    }
  }, [])

  const togglePlay = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    if (media.paused) {
      void media.play()
    } else {
      media.pause()
    }
  }, [mediaRef])

  const handleSeek = useCallback(
    (time: number) => {
      const media = mediaRef.current
      if (!media) return
      media.currentTime = time
      setCurrentTime(time)
      onSeek(time)
    },
    [mediaRef, onSeek]
  )

  const clampSegmentTime = useCallback((time: number) => {
    const maxTime = duration > 0 ? duration : time
    return Math.max(0, Math.min(maxTime, Number.isFinite(time) ? time : 0))
  }, [duration])

  const commitSegmentRepeat = useCallback((next: SegmentRepeatState) => {
    setSegmentRepeat(next)
    const nextStore = updateSegmentRepeatStore(segmentRepeatStoreRef.current, segmentRepeatStorageKey, next)
    segmentRepeatStoreRef.current = nextStore
    void persistPreferredSegmentRepeatStore(scriptFolder, nextStore)
  }, [scriptFolder, segmentRepeatStorageKey])

  const setSegmentStartAtCurrentTime = useCallback(() => {
    const start = clampSegmentTime(currentTime)
    const next: SegmentRepeatState = {
      ...segmentRepeat,
      draftStart: start,
      draftEnd: segmentRepeat.draftEnd !== null && segmentRepeat.draftEnd > start
        ? segmentRepeat.draftEnd
        : null,
    }
    commitSegmentRepeat(next)
  }, [clampSegmentTime, commitSegmentRepeat, currentTime, segmentRepeat])

  const setSegmentEndAtCurrentTime = useCallback(() => {
    const end = clampSegmentTime(currentTime)
    const draftStart = segmentRepeat.draftStart

    if (!isValidSegmentRange(draftStart, end)) {
      commitSegmentRepeat({
        ...segmentRepeat,
        draftEnd: end,
      })
      return
    }

    const segment: SegmentRepeatItem = {
      id: createSegmentRepeatId(draftStart, end),
      start: draftStart,
      end,
    }
    const next: SegmentRepeatState = {
      ...segmentRepeat,
      draftEnd: end,
      enabled: true,
      activeId: segment.id,
      segments: sortSegmentRepeatItems([...segmentRepeat.segments, segment]),
    }
    commitSegmentRepeat(next)
  }, [clampSegmentTime, commitSegmentRepeat, currentTime, segmentRepeat])

  const toggleSegmentRepeat = useCallback(() => {
    const activeSegment = getActiveSegmentRepeatItem(segmentRepeat)
    if (!activeSegment) return
    commitSegmentRepeat({
      ...segmentRepeat,
      activeId: activeSegment.id,
      enabled: !segmentRepeat.enabled,
    })
  }, [commitSegmentRepeat, segmentRepeat])

  const clearSegmentRepeat = useCallback(() => {
    commitSegmentRepeat(EMPTY_SEGMENT_REPEAT)
  }, [commitSegmentRepeat])

  const selectSegmentRepeatItem = useCallback((segmentId: string) => {
    const segment = segmentRepeat.segments.find((item) => item.id === segmentId)
    if (!segment) return

    commitSegmentRepeat({
      ...segmentRepeat,
      draftStart: segment.start,
      draftEnd: segment.end,
      activeId: segment.id,
    })
  }, [commitSegmentRepeat, segmentRepeat])

  const deleteSegmentRepeatItem = useCallback((segmentId: string) => {
    const nextSegments = segmentRepeat.segments.filter((segment) => segment.id !== segmentId)
    const nextActive = segmentRepeat.activeId === segmentId
      ? nextSegments[0]?.id ?? null
      : segmentRepeat.activeId

    commitSegmentRepeat({
      ...segmentRepeat,
      activeId: nextActive,
      enabled: segmentRepeat.enabled && Boolean(nextActive),
      segments: nextSegments,
    })
  }, [commitSegmentRepeat, segmentRepeat])

  const updateProgressThumbnail = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!videoUrl || mediaType !== 'video' || duration <= 0) return

    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)))
    const time = Math.round(ratio * duration * 2) / 2
    setProgressThumbnail({
      time,
      leftPercent: ratio * 100,
    })
  }, [duration, mediaType, videoUrl])

  const hideProgressThumbnail = useCallback(() => {
    setProgressThumbnail(null)
  }, [])

  const getProgressPointerInfo = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)))
    return {
      time: Math.max(0, Math.min(duration || 0, ratio * (duration || 0))),
      leftPercent: ratio * 100,
    }
  }, [duration])

  const beginProgressScrub = useCallback((time?: number) => {
    const nextTime = time ?? currentTime
    progressScrubbingRef.current = true
    progressSeekTimeRef.current = nextTime
    setIsProgressScrubbing(true)
    setProgressPreviewTime(nextTime)
  }, [currentTime])

  const updateProgressPreview = useCallback((time: number) => {
    const clampedTime = Math.max(0, Math.min(duration || 0, time))
    progressSeekTimeRef.current = clampedTime
    setProgressPreviewTime(clampedTime)
  }, [duration])

  const seekProgressByPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const { time, leftPercent } = getProgressPointerInfo(event)
    progressSeekTimeRef.current = time
    setProgressPreviewTime(time)
    if (videoUrl && mediaType === 'video' && duration > 0) {
      setProgressThumbnail({ time: Math.round(time * 2) / 2, leftPercent })
    }
    handleSeek(time)
    return time
  }, [duration, getProgressPointerInfo, handleSeek, mediaType, videoUrl])

  const commitProgressScrub = useCallback((overrideTime?: number) => {
    if (!progressScrubbingRef.current) return

    const targetTime = Math.max(0, Math.min(duration || 0, overrideTime ?? progressSeekTimeRef.current ?? progressPreviewTime ?? currentTime))
    progressScrubbingRef.current = false
    progressSeekTimeRef.current = null
    setIsProgressScrubbing(false)
    setProgressPreviewTime(null)
    handleSeek(targetTime)
  }, [currentTime, duration, handleSeek, progressPreviewTime])

  const handleVolumeChange = useCallback((v: number) => {
    const media = mediaRef.current
    if (!media) return
    media.volume = v
    if (v > 0 && media.muted) {
      media.muted = false
    }
    setVolume(v)
    localStorage.setItem('volume', v.toString())
    if (v > 0) setMuted(false)
  }, [mediaRef])

  const toggleMute = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    media.muted = !muted
    setMuted(!muted)
  }, [mediaRef, muted])

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (document.fullscreenElement === containerRef.current) {
      document.exitFullscreen()
    } else {
      containerRef.current.requestFullscreen()
    }
  }, [])

  const skip = useCallback((seconds: number) => {
    handleSeek(Math.max(0, Math.min(duration, currentTime + seconds)))
  }, [currentTime, duration, handleSeek])

  const toggleLoopCurrentMedia = useCallback(() => {
    onLoopCurrentMediaChange(!loopCurrentMedia)
  }, [loopCurrentMedia, onLoopCurrentMediaChange])

  const toggleShufflePlayback = useCallback(() => {
    onPlaybackModeChange(playbackMode === 'shuffle' ? 'none' : 'shuffle')
  }, [onPlaybackModeChange, playbackMode])

  const adjustPlaybackRate = useCallback((delta: number) => {
    onPlaybackRateChange(clampPlaybackRate(playbackRate + delta))
  }, [onPlaybackRateChange, playbackRate])

  const showScriptOffsetFeedback = useCallback((offsetMs: number) => {
    setScriptOffsetFeedback(offsetMs)
    if (scriptOffsetFeedbackTimer.current) clearTimeout(scriptOffsetFeedbackTimer.current)
    scriptOffsetFeedbackTimer.current = setTimeout(() => {
      scriptOffsetFeedbackTimer.current = null
      setScriptOffsetFeedback(null)
    }, 1200)
  }, [])

  const setScriptOffsetValue = useCallback((offsetMs: number, showFeedback = true) => {
    if (!onScriptOffsetChange) return
    const nextOffset = clampScriptOffset(offsetMs)
    scriptOffsetRef.current = nextOffset
    onScriptOffsetChange(nextOffset)
    if (showFeedback) {
      showScriptOffsetFeedback(nextOffset)
    }
  }, [onScriptOffsetChange, showScriptOffsetFeedback])

  const adjustScriptOffset = useCallback((deltaMs: number, showFeedback = true) => {
    setScriptOffsetValue(scriptOffsetRef.current + deltaMs, showFeedback)
  }, [setScriptOffsetValue])

  const copyScriptPath = useCallback(async (scriptPath: string) => {
    const ok = await window.electronAPI.writeClipboardText(scriptPath)
    if (!ok) return

    setScriptPathCopied(true)
    if (scriptPathCopiedTimer.current) clearTimeout(scriptPathCopiedTimer.current)
    scriptPathCopiedTimer.current = setTimeout(() => {
      scriptPathCopiedTimer.current = null
      setScriptPathCopied(false)
    }, 1200)
  }, [])

  const openScriptFolder = useCallback(async (scriptPath: string) => {
    await window.electronAPI.showItemInFolder(scriptPath)
  }, [])

  const clearStrokeCommitTimer = useCallback(() => {
    if (!strokeCommitTimer.current) return
    clearTimeout(strokeCommitTimer.current)
    strokeCommitTimer.current = null
  }, [])

  const commitStrokeRange = useCallback((min: number, max: number) => {
    clearStrokeCommitTimer()
    if (!onStrokeRangeChange) return

    const nextMin = clampPercent(Math.min(min, max))
    const nextMax = clampPercent(Math.max(min, max))
    onStrokeRangeChange(nextMin, nextMax)
  }, [clearStrokeCommitTimer, onStrokeRangeChange])

  const scheduleStrokeRangeCommit = useCallback((min: number, max: number) => {
    if (!onStrokeRangeChange) return
    clearStrokeCommitTimer()
    strokeCommitTimer.current = setTimeout(() => {
      strokeCommitTimer.current = null
      onStrokeRangeChange(clampPercent(Math.min(min, max)), clampPercent(Math.max(min, max)))
    }, 140)
  }, [clearStrokeCommitTimer, onStrokeRangeChange])

  const handleStrokeMinChange = useCallback((value: number) => {
    setStrokeDraft((prev) => {
      const next = {
        min: Math.min(clampPercent(value), prev.max),
        max: prev.max,
      }
      scheduleStrokeRangeCommit(next.min, next.max)
      return next
    })
  }, [scheduleStrokeRangeCommit])

  const handleStrokeMaxChange = useCallback((value: number) => {
    setStrokeDraft((prev) => {
      const next = {
        min: prev.min,
        max: Math.max(clampPercent(value), prev.min),
      }
      scheduleStrokeRangeCommit(next.min, next.max)
      return next
    })
  }, [scheduleStrokeRangeCommit])

  const adjustStrokeRangeBySpan = useCallback((spanDelta: number) => {
    if (!onStrokeRangeChange) return

    const currentSpan = Math.max(0, strokeRangeMax - strokeRangeMin)
    const nextSpan = Math.max(0, Math.min(100, currentSpan + spanDelta))
    const center = (strokeRangeMin + strokeRangeMax) / 2
    const nextMin = clampPercent(center - (nextSpan / 2))
    const nextMax = clampPercent(center + (nextSpan / 2))

    setStrokeDraft({
      min: nextMin,
      max: nextMax,
    })
    commitStrokeRange(nextMin, nextMax)
  }, [commitStrokeRange, onStrokeRangeChange, strokeRangeMax, strokeRangeMin])

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimer.current) {
      clearTimeout(hideControlsTimer.current)
      hideControlsTimer.current = null
    }
  }, [])

  // Mouse movement for auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    clearHideControlsTimer()
    if (isFullscreen && playing) {
      hideControlsTimer.current = setTimeout(() => setShowControls(false), 2200)
    }
  }, [clearHideControlsTimer, isFullscreen, playing])

  const handleContainerMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    resetHideTimer()

    if (!isFullscreen || !fullscreenDrawerAvailable) {
      return
    }

    const drawerWidth = fullscreenFileDrawerRef.current?.getBoundingClientRect().width
      ?? FULLSCREEN_FILE_DRAWER_FALLBACK_WIDTH_PX
    const keepDrawerOpen = showFullscreenFileDrawer
      && event.clientX <= drawerWidth + 36
    setShowFullscreenFileDrawer(event.clientX <= FULLSCREEN_FILE_DRAWER_TRIGGER_PX || keepDrawerOpen)
  }, [fullscreenDrawerAvailable, isFullscreen, resetHideTimer, showFullscreenFileDrawer])

  const clearFullscreenDrawerCloseTimer = useCallback(() => {
    if (fullscreenDrawerCloseTimer.current) {
      clearTimeout(fullscreenDrawerCloseTimer.current)
      fullscreenDrawerCloseTimer.current = null
    }
  }, [])

  const holdFullscreenDrawerOpen = useCallback((durationMs = 1800) => {
    fullscreenDrawerHoldUntilRef.current = Date.now() + durationMs
    clearFullscreenDrawerCloseTimer()
    setShowFullscreenFileDrawer(true)
  }, [clearFullscreenDrawerCloseTimer])

  const scheduleFullscreenDrawerClose = useCallback((delayMs = 360) => {
    clearFullscreenDrawerCloseTimer()
    const closeWhenReady = () => {
      fullscreenDrawerCloseTimer.current = null
      const remainingHoldMs = fullscreenDrawerHoldUntilRef.current - Date.now()
      if (remainingHoldMs > 0) {
        fullscreenDrawerCloseTimer.current = setTimeout(
          closeWhenReady,
          Math.min(remainingHoldMs + 120, 1200),
        )
        return
      }
      setShowFullscreenFileDrawer(false)
    }
    fullscreenDrawerCloseTimer.current = setTimeout(closeWhenReady, delayMs)
  }, [clearFullscreenDrawerCloseTimer])

  const handleContainerMouseLeave = useCallback(() => {
    if (playing) {
      setShowControls(false)
    }
    setShowFullscreenFileDrawer(false)
  }, [playing])

  const revealTopNav = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    setShowTopNav(true)
    if (isFullscreen && playing) {
      clearHideControlsTimer()
      setShowControls(false)
    }
  }, [clearHideControlsTimer, isFullscreen, playing])

  const hideTopNav = useCallback(() => {
    setShowTopNav(false)
  }, [])

  useEffect(() => {
    if (!isFullscreen) return

    const hideTransientFullscreenUi = () => {
      setShowFullscreenFileDrawer(false)
      setShowTopNav(false)
      setShowStrokeControls(false)
      setShowScriptOffsetControls(false)
      setShowPlaybackRatePopover(false)
      setShowSegmentRepeatControls(false)
      setProgressThumbnail(null)

      if (playing) {
        clearHideControlsTimer()
        setShowControls(false)
      }
    }

    const handleWindowMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget) return
      hideTransientFullscreenUi()
    }
    const handleWindowBlur = () => hideTransientFullscreenUi()
    const handleVisibilityChange = () => {
      if (document.hidden) hideTransientFullscreenUi()
    }
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) hideTransientFullscreenUi()
    }

    window.addEventListener('mouseout', handleWindowMouseOut)
    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      window.removeEventListener('mouseout', handleWindowMouseOut)
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [clearHideControlsTimer, isFullscreen, playing])

  // Show device overlay for connection/status changes.
  const prevDeviceConnected = useRef<boolean | undefined>(undefined)
  const prevStatusText = useRef<string | undefined>(undefined)
  useEffect(() => {
    const connectionChanged = deviceInfo && prevDeviceConnected.current !== deviceInfo.connected
    const statusChanged = deviceInfo && prevStatusText.current !== (deviceInfo.statusText || '')

    if (connectionChanged || statusChanged) {
      if (deviceInfo) {
        prevDeviceConnected.current = deviceInfo.connected
        prevStatusText.current = deviceInfo.statusText || ''
      }
      setShowDeviceOverlay(true)
      if (deviceOverlayTimer.current) clearTimeout(deviceOverlayTimer.current)
      const delay = statusChanged ? 4000 : 2000
      deviceOverlayTimer.current = setTimeout(() => setShowDeviceOverlay(false), delay)
    }
  }, [deviceInfo?.connected, deviceInfo?.label, deviceInfo?.statusText])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (!isFullscreen || !playing) {
      clearHideControlsTimer()
      setShowControls(true)
      return
    }

    resetHideTimer()
    return clearHideControlsTimer
  }, [clearHideControlsTimer, isFullscreen, playing, resetHideTimer])

  useEffect(() => {
    setStrokeDraft({
      min: strokeRangeMin,
      max: strokeRangeMax,
    })
  }, [strokeRangeMax, strokeRangeMin])

  useEffect(() => {
    scriptOffsetRef.current = scriptOffset
  }, [scriptOffset])

  useEffect(() => {
    segmentRepeatRef.current = segmentRepeat
  }, [segmentRepeat])

  useEffect(() => {
    const runId = segmentRepeatLoadRunId.current + 1
    segmentRepeatLoadRunId.current = runId
    void loadPreferredSegmentRepeatStore(scriptFolder).then((store) => {
      if (segmentRepeatLoadRunId.current !== runId) return
      segmentRepeatStoreRef.current = store
      setSegmentRepeat(getSegmentRepeatStateFromStore(store, segmentRepeatStorageKey))
    })
    setProgressThumbnail(null)
    setShowFullscreenFileDrawer(false)
  }, [scriptFolder, segmentRepeatStorageKey])

  useEffect(() => {
    if (!segmentRepeatActive) return

    const media = mediaRef.current
    if (!media) return

    let frameId = 0
    let syncing = false
    const tick = () => {
      const current = segmentRepeatRef.current
      const activeSegment = getActiveSegmentRepeatItem(current)
      if (
        current.enabled
        && activeSegment
        && media.currentTime >= activeSegment.end - 0.03
      ) {
        media.currentTime = activeSegment.start
        setCurrentTime(activeSegment.start)
        if (!syncing) {
          syncing = true
          Promise.resolve(onSeek(activeSegment.start))
            .catch(() => {
              // Seek syncing errors are already surfaced by the device layer.
            })
            .finally(() => {
              syncing = false
            })
        }
      }

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [mediaRef, mediaStateKey, onSeek, segmentRepeatActive])

  useEffect(() => {
    const previewVideo = progressThumbnailVideoRef.current
    if (!previewVideo || !progressThumbnail || !videoUrl || mediaType !== 'video') return

    const applyPreviewTime = () => {
      const maxTime = Number.isFinite(previewVideo.duration) && previewVideo.duration > 0
        ? previewVideo.duration
        : progressThumbnail.time
      previewVideo.currentTime = Math.max(0, Math.min(maxTime, progressThumbnail.time))
    }

    if (previewVideo.readyState >= 1) {
      applyPreviewTime()
      return
    }

    previewVideo.addEventListener('loadedmetadata', applyPreviewTime, { once: true })
    return () => previewVideo.removeEventListener('loadedmetadata', applyPreviewTime)
  }, [mediaType, progressThumbnail, videoUrl])

  useEffect(() => {
    if (showControls) return
    setShowStrokeControls(false)
    setShowScriptOffsetControls(false)
    setShowSegmentRepeatControls(false)
  }, [showControls])

  useEffect(() => {
    if (actions.length > 0) return
    setShowStrokeControls(false)
    setShowScriptOffsetControls(false)
  }, [actions.length])

  useEffect(() => {
    if (!showStrokeControls) return

    const handlePointerDown = (event: MouseEvent) => {
      if (strokeControlsRef.current?.contains(event.target as Node)) return
      commitStrokeRange(strokeDraft.min, strokeDraft.max)
      setShowStrokeControls(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [commitStrokeRange, showStrokeControls, strokeDraft.max, strokeDraft.min])

  useEffect(() => {
    if (!showPlaybackRatePopover) return

    const handlePointerDown = (event: MouseEvent) => {
      if (playbackRateControlsRef.current?.contains(event.target as Node)) return
      setShowPlaybackRatePopover(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [showPlaybackRatePopover])

  useEffect(() => {
    if (!showScriptOffsetControls) return

    const handlePointerDown = (event: MouseEvent) => {
      if (scriptOffsetControlsRef.current?.contains(event.target as Node)) return
      setShowScriptOffsetControls(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [showScriptOffsetControls])

  useEffect(() => {
    if (!showSegmentRepeatControls) return

    const handlePointerDown = (event: MouseEvent) => {
      if (segmentRepeatControlsRef.current?.contains(event.target as Node)) return
      setShowSegmentRepeatControls(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [showSegmentRepeatControls])

  useEffect(() => {
    return () => {
      if (playbackFrameRef.current !== null) {
        cancelAnimationFrame(playbackFrameRef.current)
      }
      clearHideControlsTimer()
      clearStrokeCommitTimer()
      if (deviceOverlayTimer.current) clearTimeout(deviceOverlayTimer.current)
      if (scriptOffsetFeedbackTimer.current) clearTimeout(scriptOffsetFeedbackTimer.current)
      if (scriptPathCopiedTimer.current) clearTimeout(scriptPathCopiedTimer.current)
      if (fullscreenDrawerCloseTimer.current) clearTimeout(fullscreenDrawerCloseTimer.current)
    }
  }, [clearHideControlsTimer, clearStrokeCommitTimer])

  // Keyboard shortcuts
  useEffect(() => {
    if (!shortcutsEnabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableShortcutTarget(e.target)) return

      const action = findMatchingShortcutAction(e, shortcutBindings, PLAYER_SHORTCUT_ACTIONS)
      if (!action) return

      e.preventDefault()

      switch (action) {
        case 'playPause':
          togglePlay()
          break
        case 'seekBackward':
          skip(-5)
          break
        case 'seekForward':
          skip(5)
          break
        case 'seekBackwardLarge':
          skip(-10)
          break
        case 'seekForwardLarge':
          skip(10)
          break
        case 'previousVideo':
          void onPreviousFile?.()
          break
        case 'nextVideo':
          void onNextFile?.()
          break
        case 'goToStart':
          handleSeek(0)
          break
        case 'goToEnd':
          handleSeek(duration)
          break
        case 'setSegmentRepeatStart':
          setSegmentStartAtCurrentTime()
          break
        case 'setSegmentRepeatEnd':
          setSegmentEndAtCurrentTime()
          break
        case 'openSegmentRepeatEditor':
          setShowSegmentRepeatControls((value) => !value)
          break
        case 'volumeUp':
          handleVolumeChange(Math.min(1, volume + 0.05))
          break
        case 'volumeDown':
          handleVolumeChange(Math.max(0, volume - 0.05))
          break
        case 'toggleMute':
          toggleMute()
          break
        case 'toggleFullscreen':
          toggleFullscreen()
          break
        case 'decreaseStrokeRange':
          adjustStrokeRangeBySpan(-STROKE_RANGE_SHORTCUT_SPAN_STEP)
          break
        case 'increaseStrokeRange':
          adjustStrokeRangeBySpan(STROKE_RANGE_SHORTCUT_SPAN_STEP)
          break
        case 'decreaseScriptOffset':
          adjustScriptOffset(-SCRIPT_OFFSET_SMALL_STEP_MS)
          break
        case 'increaseScriptOffset':
          adjustScriptOffset(SCRIPT_OFFSET_SMALL_STEP_MS)
          break
        case 'resetScriptOffset':
          setScriptOffsetValue(0)
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    adjustStrokeRangeBySpan,
    adjustScriptOffset,
    duration,
    handleSeek,
    handleVolumeChange,
    onNextFile,
    onPreviousFile,
    shortcutBindings,
    shortcutsEnabled,
    skip,
    setScriptOffsetValue,
    setSegmentEndAtCurrentTime,
    setSegmentStartAtCurrentTime,
    toggleFullscreen,
    toggleMute,
    togglePlay,
    volume,
  ])

  useEffect(() => {
    onDurationChange?.(duration)
  }, [duration, onDurationChange])

  useEffect(() => {
    const media = mediaRef.current
    if (!media || !videoUrl) return
    media.volume = volume
  }, [mediaRef, mediaStateKey, videoUrl, volume])

  useEffect(() => {
    const media = mediaRef.current
    if (!media || !videoUrl) return
    media.muted = muted
  }, [mediaRef, mediaStateKey, muted, videoUrl])

  useEffect(() => {
    const media = mediaRef.current
    if (!media || !videoUrl) return
    media.defaultPlaybackRate = playbackRate
    media.playbackRate = playbackRate
  }, [mediaRef, mediaStateKey, playbackRate, videoUrl])

  useEffect(() => {
    const cancelFrame = () => {
      if (playbackFrameRef.current !== null) {
        cancelAnimationFrame(playbackFrameRef.current)
        playbackFrameRef.current = null
      }
    }

    const tick = () => {
      const media = mediaRef.current
      if (!media) {
        cancelFrame()
        return
      }

      syncCurrentTimeFromMedia()

      if (media.paused && !media.seeking) {
        playbackFrameRef.current = null
        return
      }

      playbackFrameRef.current = requestAnimationFrame(tick)
    }

    cancelFrame()

    const media = mediaRef.current
    if (!media || !videoUrl) {
      return cancelFrame
    }

    if (!media.paused || media.seeking) {
      playbackFrameRef.current = requestAnimationFrame(tick)
    } else {
      syncCurrentTimeFromMedia()
    }

    return cancelFrame
  }, [mediaRef, mediaStateKey, playing, syncCurrentTimeFromMedia, videoUrl])

  useEffect(() => {
    if (initializedMediaStateKey.current === mediaStateKey) {
      return
    }

    initializedMediaStateKey.current = mediaStateKey
    setCurrentTime(0)
    setProgressPreviewTime(null)
    setIsProgressScrubbing(false)
    progressScrubbingRef.current = false
    setDuration(0)
    setDisplayDuration(0)
    setPlaying(false)
    const rememberedVideoFit = rememberVideoFit ? loadVideoFitPreference() : null
    setVideoFillEnabled(rememberedVideoFit ?? false)
    setVideoFillMode(rememberedVideoFit === null ? null : 'manual')
    setShowControls(true)
    setShowTopNav(false)
    setShowStrokeControls(false)
    setShowPlaybackRatePopover(false)
    setShowHeatmap(defaultShowHeatmap)
    setShowTimeline(defaultShowTimeline)
  }, [defaultShowHeatmap, defaultShowTimeline, mediaStateKey, rememberVideoFit])

  useEffect(() => {
    if (rememberVideoFit && videoFillMode === 'manual') {
      saveVideoFitPreference(videoFillEnabled)
    }
  }, [rememberVideoFit, videoFillEnabled, videoFillMode])

  useEffect(() => {
    if (!videoUrl || mediaType !== 'video') return

    if (!autoFitVideoByAspect) {
      if (videoFillMode === 'auto') {
        setVideoFillEnabled(false)
        setVideoFillMode(null)
      }
      return
    }

    if (videoFillMode === 'manual') {
      return
    }

    const media = mediaRef.current
    if (!(media instanceof HTMLVideoElement)) return

    let frame: number | null = null
    const viewport = media.parentElement
    const observer = typeof ResizeObserver === 'undefined' || !viewport
      ? null
      : new ResizeObserver(() => {
          applyAutoFit()
        })

    const applyAutoFit = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }

      frame = requestAnimationFrame(() => {
        frame = null
        const shouldFit = shouldAutoFitVideoByAspect(media)
        setVideoFillEnabled(shouldFit)
        setVideoFillMode(shouldFit ? 'auto' : null)
      })
    }

    if (media.readyState >= 1) {
      applyAutoFit()
    }

    media.addEventListener('loadedmetadata', applyAutoFit)
    window.addEventListener('resize', applyAutoFit)
    observer?.observe(viewport as Element)

    return () => {
      media.removeEventListener('loadedmetadata', applyAutoFit)
      window.removeEventListener('resize', applyAutoFit)
      observer?.disconnect()
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
    }
  }, [autoFitVideoByAspect, mediaRef, mediaStateKey, mediaType, showHeatmap, showTimeline, timelineHeight, videoFillMode, videoUrl])

  useEffect(() => {
    setShowSubtitles(subtitleCues.length > 0)
  }, [subtitleCues])

  useEffect(() => {
    if (!fullscreenScriptVisible) {
      setFullscreenScriptOverlayHeight(0)
      return
    }

    const overlay = fullscreenScriptOverlayRef.current
    if (!overlay) {
      setFullscreenScriptOverlayHeight(0)
      return
    }

    const updateOverlayHeight = () => {
      setFullscreenScriptOverlayHeight(overlay.getBoundingClientRect().height)
    }

    updateOverlayHeight()
    window.addEventListener('resize', updateOverlayHeight)

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          updateOverlayHeight()
        })
    observer?.observe(overlay)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateOverlayHeight)
    }
  }, [fullscreenScriptVisible, showHeatmap, showTimeline, timelineHeight])

  useEffect(() => {
    if (!isFullscreen) {
      setFullscreenControlsOverlayHeight(0)
      return
    }

    const overlay = fullscreenControlsOverlayRef.current
    if (!overlay) {
      setFullscreenControlsOverlayHeight(0)
      return
    }

    const updateOverlayHeight = () => {
      setFullscreenControlsOverlayHeight(overlay.getBoundingClientRect().height)
    }

    updateOverlayHeight()
    window.addEventListener('resize', updateOverlayHeight)

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          updateOverlayHeight()
        })
    observer?.observe(overlay)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateOverlayHeight)
    }
  }, [isFullscreen])

  useEffect(() => {
    if (!isProgressScrubbing) return

    const handlePointerRelease = () => {
      commitProgressScrub()
    }

    window.addEventListener('pointerup', handlePointerRelease)
    window.addEventListener('pointercancel', handlePointerRelease)
    return () => {
      window.removeEventListener('pointerup', handlePointerRelease)
      window.removeEventListener('pointercancel', handlePointerRelease)
    }
  }, [commitProgressScrub, isProgressScrubbing])

  useEffect(() => {
    if (!videoUrl) return
    if (autoPlayRequestId === 0 || handledAutoPlayRequest.current === autoPlayRequestId) {
      return
    }

    const media = mediaRef.current
    if (!media) return

    handledAutoPlayRequest.current = autoPlayRequestId

    let cancelled = false
    let frame: number | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let retryIntervalId: ReturnType<typeof setInterval> | null = null

    const cleanup = () => {
      cancelled = true
      media.autoplay = false
      media.removeEventListener('loadedmetadata', handleReady)
      media.removeEventListener('loadeddata', handleReady)
      media.removeEventListener('canplay', handleReady)
      media.removeEventListener('canplaythrough', handleReady)
      media.removeEventListener('play', handleStarted)
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (retryIntervalId) {
        clearInterval(retryIntervalId)
        retryIntervalId = null
      }
    }

    const handleStarted = () => {
      cleanup()
    }

    const requestPlay = () => {
      if (cancelled || !media.paused) {
        cleanup()
        return
      }

      media.autoplay = true
      if (media.readyState === 0) {
        media.load()
      }

      const playPromise = media.play()
      if (!playPromise || typeof playPromise.then !== 'function') {
        if (!media.paused) {
          cleanup()
        }
        return
      }

      void playPromise
        .then(() => {
          cleanup()
        })
        .catch((error) => {
          console.warn('[VideoPlayer] autoplay play() failed', error)
        })
    }

    const handleReady = () => {
      requestPlay()
    }

    media.addEventListener('loadedmetadata', handleReady)
    media.addEventListener('loadeddata', handleReady)
    media.addEventListener('canplay', handleReady)
    media.addEventListener('canplaythrough', handleReady)
    media.addEventListener('play', handleStarted)

    frame = requestAnimationFrame(() => {
      requestPlay()
    })
    retryIntervalId = setInterval(() => {
      requestPlay()
    }, 250)
    timeoutId = setTimeout(() => {
      cleanup()
    }, 5000)

    return cleanup
  }, [autoPlayRequestId, mediaRef, mediaStateKey, videoUrl])

  const forceVideoDiagnosticsPrompt = Boolean(
    import.meta.env.VITE_FORCE_VIDEO_DIAGNOSTICS_PROMPT === '1' &&
    videoUrl &&
    mediaType === 'video' &&
    diagnosticsSnapshot
  )
  const videoDiagnosticsIssueKey = getVideoDiagnosticsIssueKey(diagnosticsSnapshot) ?? (
    forceVideoDiagnosticsPrompt ? 'player.videoIssueBlackFrame' : null
  )
  const suppressVideoDiagnosticsPrompt = aiScriptGeneration.running || aiScriptDiagnosticsSuppressedMediaKey === videoDiagnosticsMediaKey
  const showVideoDiagnosticsPrompt = Boolean(
    videoUrl &&
    mediaType === 'video' &&
    diagnosticsSnapshot &&
    videoDiagnosticsIssueKey &&
    !suppressVideoDiagnosticsPrompt
  )

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col bg-black relative"
      onMouseMove={handleContainerMouseMove}
      onMouseLeave={handleContainerMouseLeave}
    >
      {/* Media */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden" onClick={togglePlay}>
        {videoUrl ? (
          mediaType === 'audio' ? (
            <>
              <audio
                key={mediaStateKey}
                ref={(node) => { mediaRef.current = node }}
                src={videoUrl}
                preload="auto"
                className="hidden"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={syncDurationFromMedia}
                onDurationChange={syncDurationFromMedia}
                loop={loopCurrentMedia}
                onPlay={() => { setPlaying(true); void onPlay() }}
                onPause={() => { setPlaying(false); void onPause() }}
                onEnded={() => {
                  setPlaying(false)
                  void onPause()
                  void onEnded()
                }}
              />
              <div className="flex flex-col items-center justify-center gap-4 text-center px-6">
                {artworkUrl ? (
                  <div className="w-56 h-56 rounded-2xl overflow-hidden border border-surface-100/30 shadow-[0_20px_60px_rgba(0,0,0,0.45)] bg-surface-200/40">
                    <img
                      src={artworkUrl}
                      alt={currentFileName || 'Artwork'}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                    <Music4 size={40} className="text-accent" />
                  </div>
                )}
                <div className="space-y-1">
                  <div className="text-lg text-text-primary font-medium break-all">
                    {currentFileName || t('player.audioMode')}
                  </div>
                  <div className="text-sm text-text-muted">
                    {t('player.audioMode')}
                  </div>
                  {scriptStatusText && (
                    <div className="pt-1">
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-accent/20 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                        <Activity size={12} />
                        <span>{scriptStatusText}</span>
                      </div>
                      {scriptSourceName && (
                        <div className="mt-1 text-[11px] text-text-muted break-all">
                          {scriptSourceName}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <video
              key={mediaStateKey}
              ref={(node) => { mediaRef.current = node }}
              src={videoUrl}
              preload="auto"
              className={videoClassName}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={syncDurationFromMedia}
              onDurationChange={syncDurationFromMedia}
              loop={loopCurrentMedia}
              onPlay={() => { setPlaying(true); void onPlay() }}
              onPause={() => { setPlaying(false); void onPause() }}
              onEnded={() => {
                setPlaying(false)
                void onPause()
                void onEnded()
              }}
            />
          )
        ) : (
          <div className="text-text-muted text-sm flex flex-col items-center gap-3">
            <Play size={48} strokeWidth={1} className="text-text-muted/30" />
            <span>{t('player.noVideo')}</span>
          </div>
        )}

        {subtitleCues.length > 0 && (
          <div
            className="absolute inset-x-0 z-10 px-4 pointer-events-none transition-[bottom] duration-300 ease-out"
            style={{ bottom: subtitleBottomOffset }}
            aria-live="polite"
          >
            <div className={`mx-auto max-w-4xl text-center transition-opacity duration-200 ${currentSubtitleText ? 'opacity-100' : 'opacity-0'}`}>
              <div className="inline-block max-w-full rounded-2xl bg-black/72 px-4 py-2 backdrop-blur-sm shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                <div
                  className="text-white font-medium leading-relaxed whitespace-pre-line [text-shadow:0_1px_2px_rgba(0,0,0,0.85)]"
                  style={{ fontSize: `${subtitleFontSize}px`, lineHeight: 1.45 }}
                >
                  {currentSubtitleText || ' '}
                </div>
              </div>
            </div>
          </div>
        )}

        {canGenerateAiScript && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setShowAiScriptDialog(true)
            }}
            className="absolute right-3 top-3 z-20 rounded-lg border border-accent/35 bg-black/70 px-3 py-1.5 text-[10px] font-medium text-accent shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-colors hover:border-accent/60 hover:bg-accent/10"
          >
            {t('player.aiScriptGenerate')}
          </button>
        )}

        {showAiScriptDialog && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
            onClick={() => {
              if (!aiScriptGeneration.running) setShowAiScriptDialog(false)
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-white/10 bg-surface-200 p-4 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3">
                <div className="text-sm font-semibold text-text-primary">
                  {t('player.aiScriptTitle')}
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-text-muted">
                  {t('player.aiScriptDesc')}
                </div>
              </div>

              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                {t('player.aiScriptModel')}
              </label>
              <select
                value={selectedAiScriptModelId}
                disabled={aiScriptGeneration.running}
                onChange={(event) => {
                  setSelectedAiScriptModelId(event.target.value as VideoMotionScriptModelId)
                  setAiScriptGeneration({
                    running: false,
                    progress: 0,
                    error: null,
                    savedPath: null,
                  })
                }}
                className="mb-2 w-full rounded-lg border border-surface-100/30 bg-surface-300 px-3 py-2 text-xs text-text-primary outline-none transition-colors focus:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {VIDEO_MOTION_SCRIPT_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {t(`player.aiScriptModelLabel.${model.id}`)}
                  </option>
                ))}
              </select>
              <div className="mb-4 text-[10px] leading-relaxed text-text-muted">
                {t(`player.aiScriptModelDesc.${selectedAiScriptModel.id}`)}
              </div>

              {aiScriptGeneration.running && (
                <div className="mb-4">
                  <div className="mb-1 flex justify-between text-[10px] text-text-muted">
                    <span>{t('player.aiScriptGenerating')}</span>
                    <span>{Math.round(aiScriptGeneration.progress * 100)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-100/40">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-200"
                      style={{ width: `${Math.round(aiScriptGeneration.progress * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {aiScriptGeneration.error && (
                <div className="mb-4 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-100">
                  {aiScriptGeneration.error}
                </div>
              )}

              {aiScriptGeneration.savedPath && (
                <div className="mb-4 rounded-lg border border-green-400/25 bg-green-500/10 px-3 py-2 text-[11px] text-green-100">
                  <div>{t('player.aiScriptSaved')}</div>
                  <div className="mt-1 break-all font-mono text-[10px] text-green-100/75">
                    {aiScriptGeneration.savedPath}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={aiScriptGeneration.running}
                  onClick={() => setShowAiScriptDialog(false)}
                  className="rounded-lg border border-surface-100/30 bg-surface-300 px-3 py-2 text-xs text-text-secondary transition-colors hover:border-accent/45 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('settings.close')}
                </button>
                <button
                  type="button"
                  disabled={aiScriptGeneration.running}
                  onClick={() => void handleGenerateAiScript()}
                  className="rounded-lg border border-accent/35 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition-colors hover:border-accent/60 hover:bg-accent/15 disabled:cursor-wait disabled:opacity-60"
                >
                  {aiScriptGeneration.running ? t('player.aiScriptGenerating') : t('player.aiScriptStart')}
                </button>
              </div>
            </div>
          </div>
        )}

        {scriptDebugInfo?.enabled && (actions.length > 0 || diagnosticsSnapshot) && (
          <div className="absolute top-3 left-3 z-10 max-w-[min(34rem,calc(100%-1.5rem))] rounded-lg border border-white/10 bg-black/72 px-3 py-2 text-[10px] text-white/82 shadow-[0_12px_36px_rgba(0,0,0,0.35)] backdrop-blur-sm">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-semibold uppercase tracking-[0.18em] text-accent">
                {t('player.scriptDebug')}
              </span>
              {actions.length > 0 && (
                <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-white/70">
                  {scriptDebugInfo.sourceLabel}
                </span>
              )}
            </div>
            {actions.length > 0 && (
              <>
                <div className="truncate font-mono text-white/80">
                  {scriptDebugInfo.sourcePath || t('player.scriptDebugGenerated')}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-white/62">
                  <span>{t('player.scriptDebugAxes')}: {scriptDebugInfo.axes.length > 0 ? scriptDebugInfo.axes.join(', ') : '-'}</span>
                  <span>{t('player.scriptDebugOffset')}: {formatScriptOffset(scriptDebugInfo.offsetMs)}</span>
                  <span>{scriptDebugInfo.offsetScope}</span>
                </div>
                {debugScriptPath && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void copyScriptPath(debugScriptPath)
                      }}
                      className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[10px] text-white/72 transition-colors hover:border-accent/40 hover:text-accent"
                      title={scriptPathCopied ? t('player.scriptPathCopied') : t('player.copyScriptPath')}
                      aria-label={scriptPathCopied ? t('player.scriptPathCopied') : t('player.copyScriptPath')}
                    >
                      <Copy size={11} />
                      {scriptPathCopied ? t('player.scriptPathCopiedShort') : t('player.copyScriptPathShort')}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void openScriptFolder(debugScriptPath)
                      }}
                      className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[10px] text-white/72 transition-colors hover:border-accent/40 hover:text-accent"
                      title={t('player.openScriptFolder')}
                      aria-label={t('player.openScriptFolder')}
                    >
                      <FolderOpen size={11} />
                      {t('player.openScriptFolderShort')}
                    </button>
                    {onReloadScriptSource && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void onReloadScriptSource(debugScriptPath)
                        }}
                        className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[10px] text-white/72 transition-colors hover:border-accent/40 hover:text-accent"
                        title={t('player.reloadScriptSource')}
                        aria-label={t('player.reloadScriptSource')}
                      >
                        <RefreshCw size={11} />
                        {t('player.reloadScriptSourceShort')}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            {diagnosticsSnapshot && (
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="font-semibold uppercase tracking-[0.18em] text-accent">PLAYBACK</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleCopyDiagnostics()
                    }}
                    className="inline-flex h-6 items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[10px] text-white/72 transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    <Copy size={11} />
                    {diagnosticsCopied ? t('player.videoDiagnosticsCopied') : t('player.copyVideoDiagnostics')}
                  </button>
                </div>
                <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 font-mono text-white/62">
                  <span>Renderer</span>
                  <span className="truncate text-white/78">{diagnosticsSnapshot.renderer.renderer || 'unknown'}</span>
                  <span>GPU</span>
                  <span className={diagnosticsSnapshot.renderer.hardwareLikely === false ? 'text-amber-300' : 'text-emerald-300'}>
                    {getHardwareRendererLabel(diagnosticsSnapshot.renderer.hardwareLikely)}
                  </span>
                  <span>Video</span>
                  <span>
                    {diagnosticsSnapshot.videoWidth}x{diagnosticsSnapshot.videoHeight}
                    {' · '}
                    {formatTime(diagnosticsSnapshot.currentTime)} / {formatTime(diagnosticsSnapshot.duration)}
                  </span>
                  <span>Frames</span>
                  <span>
                    drop {formatDiagnosticInteger(diagnosticsSnapshot.quality.droppedVideoFrames)}
                    {' / '}
                    total {formatDiagnosticInteger(diagnosticsSnapshot.quality.totalVideoFrames)}
                  </span>
                  <span>Gap</span>
                  <span>
                    p95 {formatDiagnosticMs(diagnosticsSnapshot.frames.p95WallDeltaMs)}
                    {' · '}
                    max {formatDiagnosticMs(diagnosticsSnapshot.frames.maxWallDeltaMs)}
                    {' · '}
                    large {diagnosticsSnapshot.frames.largeGaps}
                  </span>
                  <span>Events</span>
                  <span>
                    waiting {diagnosticsSnapshot.events.waiting}
                    {' · '}
                    stalled {diagnosticsSnapshot.events.stalled}
                    {' · '}
                    error {diagnosticsSnapshot.events.error}
                  </span>
                  <span>Runtime</span>
                  <span>
                    Electron {diagnosticsSnapshot.versions?.electron || 'unknown'}
                    {' · '}
                    Chrome {diagnosticsSnapshot.versions?.chrome || 'unknown'}
                    {' · '}
                    {diagnosticsSnapshot.platform}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {showVideoDiagnosticsPrompt && diagnosticsSnapshot && videoDiagnosticsIssueKey && (
          <div
            className="absolute right-3 top-3 z-20 w-[min(22rem,calc(100%-1.5rem))] rounded-xl border border-amber-300/25 bg-black/78 p-3 text-xs text-white shadow-[0_16px_44px_rgba(0,0,0,0.45)] backdrop-blur-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 font-semibold text-amber-200">
              <AlertCircle size={15} />
              <span>{t('player.videoIssueDetected')}</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-white/72">
              {t(videoDiagnosticsIssueKey)}
            </p>
            <p className="mt-1 leading-relaxed text-white/52">
              {t('player.videoCompatibilityHint')}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {videoCompatibilityMode === 'auto' && onTryVideoCompatibilityMode && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void onTryVideoCompatibilityMode()
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-amber-300/30 bg-amber-300/10 px-2.5 text-[11px] text-amber-200 transition-colors hover:border-amber-300/55 hover:bg-amber-300/15"
                >
                  <RefreshCw size={12} />
                  {t('player.tryVideoCompatibilityMode')}
                </button>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  void handleCopyDiagnostics()
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2.5 text-[11px] text-white/78 transition-colors hover:border-amber-300/45 hover:text-amber-200"
              >
                <Copy size={12} />
                {diagnosticsCopied ? t('player.videoDiagnosticsCopied') : t('player.copyVideoDiagnostics')}
              </button>
            </div>
          </div>
        )}

        {scriptOffsetFeedback !== null && actions.length > 0 && (
          <div className="pointer-events-none absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-lg border border-accent/30 bg-black/78 px-4 py-2 text-center shadow-[0_12px_36px_rgba(0,0,0,0.4)] backdrop-blur-sm animate-fade-in">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
              {t('player.scriptOffset')}
            </div>
            <div className="mt-0.5 font-mono text-lg font-semibold text-white">
              {formatScriptOffset(scriptOffsetFeedback)}
            </div>
          </div>
        )}

        {/* Device connection overlay */}
        {showDeviceOverlay && deviceInfo && !scriptDebugInfo?.enabled && (
          <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 animate-fade-in">
            <div className="flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  deviceInfo.connected ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'
                }`}
              />
              <span className="text-xs text-white font-medium">
                {deviceInfo.connected ? `${deviceInfo.label} Connected` : `${deviceInfo.label} Disconnected`}
              </span>
              {deviceInfo.detail && (
                <span className="text-[10px] text-text-muted font-mono">
                  {deviceInfo.detail}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Device status badge (persistent for active work/error) */}
        {deviceInfo?.statusText && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 animate-fade-in">
            {deviceInfo.statusTone === 'busy' && (
              <>
                <Loader2 size={14} className="text-accent animate-spin" />
                <span className="text-xs text-white">
                  {deviceInfo.statusText}
                </span>
              </>
            )}
            {deviceInfo.statusTone === 'error' && (
              <>
                <AlertCircle size={14} className="text-red-400" />
                <span className="text-xs text-red-400">{deviceInfo.statusText}</span>
              </>
            )}
          </div>
        )}

        {isFullscreen && fullscreenDrawerAvailable && (
          <div
            ref={fullscreenFileDrawerRef}
            className={`absolute inset-y-0 left-0 z-30 min-w-0 overflow-hidden border-r border-white/10 bg-black/82 shadow-[18px_0_48px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-transform duration-200 ${
              showFullscreenFileDrawer ? 'translate-x-0' : '-translate-x-full'
            }`}
            style={{
              width: 'clamp(20rem, 32vw, 30rem)',
              maxWidth: 'calc(100vw - 0.75rem)',
            }}
            onClick={(event) => event.stopPropagation()}
            onFocusCapture={() => holdFullscreenDrawerOpen()}
            onPointerDownCapture={() => holdFullscreenDrawerOpen(2600)}
            onMouseEnter={() => {
              clearFullscreenDrawerCloseTimer()
              setShowFullscreenFileDrawer(true)
            }}
            onMouseLeave={() => scheduleFullscreenDrawerClose()}
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-white/10 px-3 py-3">
                <div className="min-w-0 px-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
                    {t('app.name')}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-white">
                    {currentFileName || t('player.noVideo')}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
                  {([
                    { id: 'files' as FullscreenDrawerTab, label: t('sidebar.files'), Icon: FolderOpen, enabled: fullscreenDrawerHasFiles },
                    { id: 'scripts' as FullscreenDrawerTab, label: t('sidebar.scripts'), Icon: Music4, enabled: fullscreenDrawerHasScripts },
                    { id: 'device' as FullscreenDrawerTab, label: t('sidebar.device'), Icon: SlidersHorizontal, enabled: fullscreenDrawerHasDevice },
                  ]).map(({ id, label, Icon, enabled }) => {
                    const active = fullscreenDrawerTab === id
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={!enabled}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (enabled) {
                            setFullscreenDrawerTab(id)
                          }
                        }}
                        className={`flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 text-[10px] font-medium transition-colors ${
                          active
                            ? 'bg-accent/18 text-accent'
                            : enabled
                              ? 'text-white/62 hover:bg-white/8 hover:text-white'
                              : 'cursor-not-allowed text-white/22'
                        }`}
                      >
                        <Icon size={13} className="flex-shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {fullscreenDrawerTab === 'files' && (
                <div className="min-h-0 flex-1 overflow-y-auto py-2">
                  {fullscreenDrawerFiles.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-white/42">
                      {t('sidebar.noFiles')}
                    </div>
                  ) : fullscreenDrawerFiles.map((file) => {
                    const active = areSameMediaPath(file.path, currentFilePath)
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (!active) {
                            void onPlaylistFileSelect?.(file)
                          }
                          setShowFullscreenFileDrawer(false)
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          active
                            ? 'bg-accent/12 text-white'
                            : 'text-white/66 hover:bg-white/8 hover:text-white'
                        }`}
                      >
                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-white/18'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{file.name}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-white/42">
                            {file.hasScript
                              ? `${t('sidebar.scripts')} · ${file.scriptAxes.length > 0 ? file.scriptAxes.join(', ') : 'L0'}`
                              : file.relativePath || file.path}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {fullscreenDrawerTab === 'scripts' && (
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/46">
                        {t('sidebar.scriptVariants')}
                      </div>
                      {scriptVariantOverrideActive && onScriptVariantReset && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void onScriptVariantReset()
                          }}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-white/68 transition-colors hover:border-accent/35 hover:text-accent"
                        >
                          {t('sidebar.useAutoScript')}
                        </button>
                      )}
                    </div>

                    <div
                      className="mt-2 truncate rounded-lg border border-white/8 bg-black/24 px-2.5 py-2 font-mono text-[10px] text-white/58"
                      title={currentScriptPath ?? scriptSource ?? undefined}
                    >
                      {scriptSourceName || t('sidebar.selectScript')}
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        disabled={!currentScriptPath}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (currentScriptPath) {
                            void copyScriptPath(currentScriptPath)
                          }
                        }}
                        className={`flex h-8 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] transition-colors ${
                          currentScriptPath
                            ? 'border-white/10 bg-white/5 text-white/68 hover:border-accent/35 hover:text-accent'
                            : 'cursor-not-allowed border-white/6 text-white/24'
                        }`}
                        title={scriptPathCopied ? t('player.scriptPathCopied') : t('player.copyScriptPath')}
                        aria-label={scriptPathCopied ? t('player.scriptPathCopied') : t('player.copyScriptPath')}
                      >
                        <Copy size={12} />
                        <span className="truncate">{scriptPathCopied ? t('player.scriptPathCopiedShort') : t('player.copyScriptPathShort')}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!currentScriptPath}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (currentScriptPath) {
                            void openScriptFolder(currentScriptPath)
                          }
                        }}
                        className={`flex h-8 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] transition-colors ${
                          currentScriptPath
                            ? 'border-white/10 bg-white/5 text-white/68 hover:border-accent/35 hover:text-accent'
                            : 'cursor-not-allowed border-white/6 text-white/24'
                        }`}
                        title={t('player.openScriptFolder')}
                        aria-label={t('player.openScriptFolder')}
                      >
                        <FolderOpen size={12} />
                        <span className="truncate">{t('player.openScriptFolderShort')}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!currentScriptPath || !onReloadScriptSource}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (currentScriptPath && onReloadScriptSource) {
                            void onReloadScriptSource(currentScriptPath)
                          }
                        }}
                        className={`flex h-8 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] transition-colors ${
                          currentScriptPath && onReloadScriptSource
                            ? 'border-white/10 bg-white/5 text-white/68 hover:border-accent/35 hover:text-accent'
                            : 'cursor-not-allowed border-white/6 text-white/24'
                        }`}
                        title={t('player.reloadScriptSource')}
                        aria-label={t('player.reloadScriptSource')}
                      >
                        <RefreshCw size={12} />
                        <span className="truncate">{t('player.reloadScriptSourceShort')}</span>
                      </button>
                    </div>

                    {onManualScriptSelect && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void onManualScriptSelect()
                        }}
                        className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 text-[10px] font-medium text-white/72 transition-colors hover:border-accent/35 hover:text-accent"
                      >
                        <FolderOpen size={12} />
                        <span className="truncate">{t('sidebar.selectScript')}</span>
                      </button>
                    )}
                  </div>

                  {scriptVariants.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {scriptVariants.map((variant) => {
                        const active = areSameMediaPath(variant.path, scriptSource)
                        const meta = [
                          variant.source === 'local'
                            ? t('sidebar.scriptSourceLocal')
                            : t('sidebar.scriptSourceFolder'),
                          variant.axes.length > 0 ? variant.axes.join(' / ') : 'L0',
                        ].join(' · ')

                        return (
                          <button
                            key={variant.path}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              void onScriptVariantSelect?.(variant.path)
                            }}
                            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                              active
                                ? 'border-accent/35 bg-accent/12 text-accent'
                                : 'border-white/10 bg-white/[0.035] text-white/70 hover:border-white/18 hover:bg-white/8 hover:text-white'
                            }`}
                          >
                            <div className="truncate text-xs font-medium">
                              {variant.isDefault ? t('sidebar.scriptDefaultVariant') : variant.label}
                            </div>
                            <div className={`mt-0.5 truncate text-[10px] ${active ? 'text-accent/78' : 'text-white/40'}`}>
                              {meta}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-6 text-center text-xs text-white/42">
                      {t('player.noScriptVariants')}
                    </div>
                  )}
                </div>
              )}

              {fullscreenDrawerTab === 'device' && (
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                        deviceInfo?.connected
                          ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.65)]'
                          : 'bg-red-400'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          {deviceInfo?.label || t('sidebar.device')}
                        </div>
                        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/42">
                          {deviceInfo?.connected ? t('device.connected') : t('device.disconnected')}
                        </div>
                        {deviceInfo?.detail && (
                          <div className="mt-2 rounded-lg border border-white/8 bg-black/20 px-2.5 py-2 text-xs text-white/58">
                            {deviceInfo.detail}
                          </div>
                        )}
                      </div>
                    </div>

                    {deviceInfo?.statusText && (
                      <div className={`mt-3 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                        deviceInfo.statusTone === 'error'
                          ? 'border-red-400/25 bg-red-500/10 text-red-200'
                          : 'border-accent/20 bg-accent/10 text-white/72'
                      }`}>
                        {deviceInfo.statusTone === 'busy' && <Loader2 size={13} className="animate-spin text-accent" />}
                        {deviceInfo.statusTone === 'error' && <AlertCircle size={13} className="text-red-400" />}
                        <span className="min-w-0 flex-1 truncate">{deviceInfo.statusText}</span>
                      </div>
                    )}
                  </div>

                  {onOpenDeviceSettings && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setShowFullscreenFileDrawer(false)
                        void document.exitFullscreen?.()
                        onOpenDeviceSettings()
                      }}
                      className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/76 transition-colors hover:border-accent/35 hover:bg-accent/10 hover:text-accent"
                    >
                      <SlidersHorizontal size={14} />
                      <span className="truncate">{t('settings.device')}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {mediaType === 'video' && currentFileName && (
          <div
            className="absolute inset-x-0 top-0 z-10"
            style={{ height: TOP_NAV_TRIGGER_HEIGHT_PX }}
            onMouseEnter={revealTopNav}
            onMouseMove={revealTopNav}
            onMouseLeave={hideTopNav}
          >
            <div className={`pointer-events-none absolute inset-x-0 top-3 flex justify-center px-20 transition-opacity duration-200 ${
              showTopNav ? 'opacity-100' : 'opacity-0'
            }`}>
              <div className="pointer-events-auto flex max-w-[min(72vw,760px)] items-center gap-1 rounded-xl border border-white/10 bg-black/55 px-1.5 py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-md">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!canGoToPreviousFile) return
                    void onPreviousFile?.()
                  }}
                  disabled={!canGoToPreviousFile}
                  className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-medium transition-colors ${
                    canGoToPreviousFile
                      ? 'text-white/85 hover:bg-white/8 hover:text-white'
                      : 'cursor-not-allowed text-white/25'
                  }`}
                  title={t('player.previousVideo')}
                  aria-label={t('player.previousVideo')}
                >
                  <SkipBack size={14} />
                  <span>{t('player.previousShort')}</span>
                </button>
                <div className="h-4 w-px bg-white/10" />
                <div className="min-w-0 px-2 text-xs font-medium text-white/90">
                  <span className="block truncate">{currentFileName}</span>
                </div>
                <div className="h-4 w-px bg-white/10" />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!canGoToNextFile) return
                    void onNextFile?.()
                  }}
                  disabled={!canGoToNextFile}
                  className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-medium transition-colors ${
                    canGoToNextFile
                      ? 'text-white/85 hover:bg-white/8 hover:text-white'
                      : 'cursor-not-allowed text-white/25'
                  }`}
                  title={t('player.nextVideo')}
                  aria-label={t('player.nextVideo')}
                >
                  <span>{t('player.nextShort')}</span>
                  <SkipForward size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Script timeline / heatmap */}
      {!isFullscreen && actions.length > 0 && (showHeatmap || showTimeline) && (
        <div className="flex-shrink-0 border-t border-surface-100/20">
          {showHeatmap && (
            <div className="h-8">
              <ScriptHeatmap
                key={`heatmap-inline-${mediaStateKey}`}
                actions={actions}
                duration={duration}
                currentTime={effectiveCurrentTime}
                onSeek={handleSeek}
              />
            </div>
          )}
          {showTimeline && (
            <div style={{ height: timelineHeight }}>
              <ScriptTimeline
                key={`timeline-inline-${mediaStateKey}`}
                actions={actions}
                currentTime={effectiveCurrentTime}
                duration={duration}
                onSeek={handleSeek}
                windowSize={timelineWindow}
              />
            </div>
          )}
        </div>
      )}

      {fullscreenScriptVisible && (
        <div
          ref={fullscreenScriptOverlayRef}
          className="absolute inset-x-0 z-10 px-4 transition-[bottom] duration-300 ease-out"
          style={{ bottom: controlsVisible ? fullscreenControlsOverlayHeight : 0 }}
        >
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/62 shadow-[0_14px_40px_rgba(0,0,0,0.45)]">
            {showHeatmap && (
              <div className="h-8">
                <ScriptHeatmap
                  key={`heatmap-fullscreen-${mediaStateKey}`}
                  actions={actions}
                  duration={duration}
                  currentTime={effectiveCurrentTime}
                  onSeek={handleSeek}
                />
              </div>
            )}
            {showTimeline && (
              <div style={{ height: timelineHeight }}>
                <ScriptTimeline
                  key={`timeline-fullscreen-${mediaStateKey}`}
                  actions={actions}
                  currentTime={effectiveCurrentTime}
                  duration={duration}
                  onSeek={handleSeek}
                  windowSize={timelineWindow}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        ref={fullscreenControlsOverlayRef}
        className={`${controlsContainerClass} transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className={controlsPanelClass}>
          <div
            className={progressBarWrapClass}
            onPointerMove={updateProgressThumbnail}
            onPointerLeave={hideProgressThumbnail}
          >
            {progressThumbnail && mediaType === 'video' && videoUrl && duration > 0 && (
              <div
                className="pointer-events-none absolute bottom-full z-30 mb-3 overflow-hidden rounded-xl border border-white/12 bg-black/90 shadow-[0_18px_44px_rgba(0,0,0,0.52)]"
                style={{
                  left: `${progressThumbnail.leftPercent}%`,
                  width: PROGRESS_THUMBNAIL_WIDTH_PX,
                  transform: 'translateX(-50%)',
                }}
              >
                <video
                  ref={progressThumbnailVideoRef}
                  src={videoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-24 w-full bg-black object-cover"
                />
                <div className="border-t border-white/10 px-2 py-1 text-center font-mono text-[10px] text-white/76">
                  {formatTime(progressThumbnail.time)}
                </div>
              </div>
            )}
            <div className="group relative h-5">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[#45475a] transition-[height] group-hover:h-1.5" />
              <div
                className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#cba6f7] transition-transform group-hover:scale-110"
                style={{ left: `${progressPercent}%` }}
              />
              <div
                role="slider"
                aria-valuemin={0}
                aria-valuemax={duration || 0}
                aria-valuenow={effectiveCurrentTime}
                tabIndex={0}
                className="absolute inset-0 cursor-pointer"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                  const targetTime = seekProgressByPointer(e)
                  beginProgressScrub(targetTime)
                }}
                onPointerMove={(e) => {
                  if (!progressScrubbingRef.current) return
                  e.stopPropagation()
                  e.preventDefault()
                  seekProgressByPointer(e)
                }}
                onPointerUp={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  e.currentTarget.releasePointerCapture?.(e.pointerId)
                  commitProgressScrub(seekProgressByPointer(e))
                }}
                onPointerCancel={(e) => {
                  e.stopPropagation()
                  commitProgressScrub()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault()
                    handleSeek(Math.max(0, effectiveCurrentTime - 5))
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    handleSeek(Math.min(duration || 0, effectiveCurrentTime + 5))
                  } else if (e.key === 'Home') {
                    e.preventDefault()
                    handleSeek(0)
                  } else if (e.key === 'End') {
                    e.preventDefault()
                    handleSeek(duration || 0)
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          <div className={controlRowClass}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 items-center gap-1 rounded-2xl border border-surface-100/20 bg-surface-300/25 px-1.5">
                <button
                  onClick={(e) => { e.stopPropagation(); skip(-5) }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-100/10 hover:text-text-primary transition-colors"
                  title="-5s"
                  aria-label="-5 seconds"
                >
                  <SkipBack size={18} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); togglePlay() }}
                  className="flex h-10 w-10 items-center justify-center text-text-primary hover:text-accent transition-colors"
                >
                  {playing ? <Pause size={22} /> : <Play size={22} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); skip(5) }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-100/10 hover:text-text-primary transition-colors"
                  title="+5s"
                  aria-label="+5 seconds"
                >
                  <SkipForward size={18} />
                </button>
              </div>
              <span className="inline-flex h-9 items-center text-xs leading-none text-text-secondary font-mono tabular-nums">
                {formatTime(effectiveCurrentTime)} / {formatTime(displayDuration || duration)}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleMute() }}
                  className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
                >
                  {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => { e.stopPropagation(); handleVolumeChange(parseFloat(e.target.value)) }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-20 h-1"
                />
                <div
                  ref={playbackRateControlsRef}
                  className="relative -mt-0.5 ml-0.5 flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                  title={t('player.playbackSpeed')}
                >
                  {showPlaybackRatePopover && (
                    <div className="absolute bottom-full right-0 mb-3 flex items-center gap-1 rounded-xl border border-surface-100/20 bg-surface-300/95 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                      {PLAYBACK_RATE_PRESETS.map((rate) => {
                        const active = Math.abs(playbackRate - rate) < 0.001
                        return (
                          <button
                            key={rate}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onPlaybackRateChange(rate)
                              setShowPlaybackRatePopover(false)
                            }}
                            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                              active
                                ? 'bg-accent/15 text-accent'
                                : 'text-text-secondary hover:bg-surface-100/10 hover:text-text-primary'
                            }`}
                          >
                            {formatPlaybackRate(rate)}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      adjustPlaybackRate(-PLAYBACK_RATE_STEP)
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-semibold leading-none text-text-secondary transition-colors hover:bg-surface-100/10 hover:text-text-primary"
                    aria-label="Decrease playback speed"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowPlaybackRatePopover((value) => !value)
                    }}
                    className="min-w-[3rem] rounded-md border border-surface-100/15 bg-surface-300/35 px-1.5 py-1 text-[10px] font-semibold text-text-primary transition-colors hover:bg-surface-100/10"
                    aria-label="Playback speed presets"
                  >
                    {formatPlaybackRate(playbackRate)}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      adjustPlaybackRate(PLAYBACK_RATE_STEP)
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-semibold leading-none text-text-secondary transition-colors hover:bg-surface-100/10 hover:text-text-primary"
                    aria-label="Increase playback speed"
                  >
                    +
                  </button>
                </div>

                {actions.length > 0 && onStrokeRangeChange && (
                  <div ref={strokeControlsRef} className="relative">
                    {showStrokeControls && (
                      <div
                        className="absolute bottom-full right-0 mb-3 w-80 rounded-2xl border border-surface-100/20 bg-surface-300/95 p-4 shadow-[0_28px_100px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">
                              {t('device.strokeRange')}
                            </div>
                            <div className="mt-1 text-sm font-semibold text-text-primary">
                              {strokeDraft.min}% - {strokeDraft.max}%
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              commitStrokeRange(strokeDraft.min, strokeDraft.max)
                              setShowStrokeControls(false)
                              onOpenDeviceSettings?.()
                            }}
                            className="rounded-lg border border-surface-100/20 bg-surface-200/70 px-2.5 py-1.5 text-[10px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                          >
                            {t('settings.device')}
                          </button>
                        </div>

                        <div className="mb-3 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-surface-100/20 bg-surface-200/60 px-3 py-2">
                            <div className="text-[10px] font-semibold text-text-muted">
                              {t('settings.strokeRangeMin')}
                            </div>
                            <div className="mt-1 font-mono text-lg font-semibold text-text-primary">
                              {strokeDraft.min}%
                            </div>
                          </div>
                          <div className="rounded-xl border border-surface-100/20 bg-surface-200/60 px-3 py-2">
                            <div className="text-[10px] font-semibold text-text-muted">
                              {t('settings.strokeRangeMax')}
                            </div>
                            <div className="mt-1 font-mono text-lg font-semibold text-text-primary">
                              {strokeDraft.max}%
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-xl border border-surface-100/15 bg-black/20 px-3 py-2.5">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <span className="text-xs font-medium text-text-secondary">{t('settings.strokeRangeMin')}</span>
                              <span className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-xs text-text-primary">{strokeDraft.min}%</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={strokeDraft.min}
                              onChange={(e) => {
                                e.stopPropagation()
                                handleStrokeMinChange(Number(e.target.value))
                              }}
                              onMouseUp={() => commitStrokeRange(strokeDraft.min, strokeDraft.max)}
                              onTouchEnd={() => commitStrokeRange(strokeDraft.min, strokeDraft.max)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full h-1"
                            />
                          </div>

                          <div className="rounded-xl border border-surface-100/15 bg-black/20 px-3 py-2.5">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <span className="text-xs font-medium text-text-secondary">{t('settings.strokeRangeMax')}</span>
                              <span className="rounded-md bg-black/30 px-2 py-0.5 font-mono text-xs text-text-primary">{strokeDraft.max}%</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={strokeDraft.max}
                              onChange={(e) => {
                                e.stopPropagation()
                                handleStrokeMaxChange(Number(e.target.value))
                              }}
                              onMouseUp={() => commitStrokeRange(strokeDraft.min, strokeDraft.max)}
                              onTouchEnd={() => commitStrokeRange(strokeDraft.min, strokeDraft.max)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full h-1"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onInvertStrokeChange?.(!invertStroke)
                            }}
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors ${
                              invertStroke
                                ? 'border-accent/30 bg-accent/10 text-accent'
                                : 'border-surface-100/20 text-text-secondary hover:text-text-primary'
                            }`}
                          >
                            <span>{t('settings.inverseStroke')}</span>
                            <span className="font-mono text-[10px]">{invertStroke ? 'ON' : 'OFF'}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowStrokeControls((value) => !value)
                      }}
                      className={`p-1.5 flex items-center gap-1 rounded transition-colors ${showStrokeControls ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                      title={t('device.strokeRange')}
                    >
                      <SlidersHorizontal size={16} />
                      <span className="text-[10px] font-medium">STR</span>
                    </button>
                  </div>
                )}

                {actions.length > 0 && onScriptOffsetChange && (
                  <div ref={scriptOffsetControlsRef} className="relative">
                    {showScriptOffsetControls && (
                      <div
                        className="absolute bottom-full right-0 mb-3 w-72 rounded-2xl border border-surface-100/20 bg-surface-300/95 p-4 shadow-[0_28px_100px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">
                              {t('player.scriptOffset')}
                            </div>
                            <div className="mt-1 font-mono text-xl font-semibold text-text-primary">
                              {formatScriptOffset(scriptOffset)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setScriptOffsetValue(0)
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-100/20 bg-surface-200/70 text-text-secondary transition-colors hover:text-text-primary"
                            title={t('player.resetScriptOffset')}
                            aria-label={t('player.resetScriptOffset')}
                          >
                            <RotateCcw size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                          {[
                            -SCRIPT_OFFSET_LARGE_STEP_MS,
                            -SCRIPT_OFFSET_SMALL_STEP_MS,
                            SCRIPT_OFFSET_SMALL_STEP_MS,
                            SCRIPT_OFFSET_LARGE_STEP_MS,
                          ].map((delta) => (
                            <button
                              key={delta}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                adjustScriptOffset(delta)
                              }}
                              className="rounded-lg border border-surface-100/20 bg-surface-200/60 px-2 py-2 font-mono text-[11px] font-semibold text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                            >
                              {formatScriptOffset(delta)}
                            </button>
                          ))}
                        </div>

                        <div className="mt-3 text-[10px] leading-relaxed text-text-muted">
                          {t('player.scriptOffsetDesc')}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowScriptOffsetControls((value) => !value)
                      }}
                      className={`p-1.5 flex items-center gap-1 rounded transition-colors ${
                        showScriptOffsetControls || scriptOffset !== 0
                          ? 'text-accent bg-accent/10'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                      title={t('player.scriptOffset')}
                    >
                      <Clock3 size={16} />
                      <span className="text-[10px] font-medium">{formatScriptOffset(scriptOffset)}</span>
                    </button>
                  </div>
                )}

                {videoUrl && (
                  <div ref={segmentRepeatControlsRef} className="relative">
                    {showSegmentRepeatControls && (
                      <div
                        className="absolute bottom-full right-0 mb-3 w-80 rounded-2xl border border-surface-100/20 bg-surface-300/95 p-4 shadow-[0_28px_100px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">
                              {t('player.segmentRepeatList')}
                            </div>
                            <div className="mt-1 font-mono text-sm font-semibold text-text-primary">
                              {activeSegmentRepeat
                                ? formatTime(activeSegmentRepeat.start)
                                : (segmentRepeat.draftStart !== null ? formatTime(segmentRepeat.draftStart) : '--:--')}
                              {' - '}
                              {activeSegmentRepeat
                                ? formatTime(activeSegmentRepeat.end)
                                : (segmentRepeat.draftEnd !== null ? formatTime(segmentRepeat.draftEnd) : '--:--')}
                            </div>
                          </div>
                          <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                            segmentRepeatActive ? 'bg-accent/15 text-accent' : 'bg-surface-100/10 text-text-muted'
                          }`}>
                            {segmentRepeatActive ? 'ON' : 'OFF'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSegmentStartAtCurrentTime()
                            }}
                            className="rounded-lg border border-surface-100/20 bg-surface-200/60 px-3 py-2 text-left transition-colors hover:border-accent/30 hover:bg-accent/10"
                          >
                            <span className="block font-mono text-xs font-semibold text-accent">A</span>
                            <span className="mt-1 block text-[10px] text-text-secondary">
                              {segmentRepeat.draftStart !== null ? formatTime(segmentRepeat.draftStart) : t('player.segmentRepeatSetStart')}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSegmentEndAtCurrentTime()
                            }}
                            className="rounded-lg border border-surface-100/20 bg-surface-200/60 px-3 py-2 text-left transition-colors hover:border-accent/30 hover:bg-accent/10"
                          >
                            <span className="block font-mono text-xs font-semibold text-accent">B</span>
                            <span className="mt-1 block text-[10px] text-text-secondary">
                              {segmentRepeat.draftEnd !== null ? formatTime(segmentRepeat.draftEnd) : t('player.segmentRepeatSetEnd')}
                            </span>
                          </button>
                        </div>

                        <div className="mt-3 max-h-40 space-y-1 overflow-y-auto pr-1">
                          {segmentRepeat.segments.length === 0 ? (
                            <div className="rounded-lg border border-surface-100/15 bg-surface-200/35 px-3 py-3 text-center text-[10px] text-text-muted">
                              {t('player.segmentRepeatEmpty')}
                            </div>
                          ) : (
                            segmentRepeat.segments.map((segment, index) => {
                              const selected = activeSegmentRepeat?.id === segment.id
                              return (
                                <div
                                  key={segment.id}
                                  className={`grid grid-cols-[1fr_auto] items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors ${
                                    selected
                                      ? 'border-accent/35 bg-accent/10'
                                      : 'border-surface-100/15 bg-surface-200/35'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      selectSegmentRepeatItem(segment.id)
                                    }}
                                    className="min-w-0 text-left"
                                  >
                                    <span className="block text-[10px] font-semibold text-text-muted">
                                      {String(index + 1).padStart(2, '0')}
                                      {selected ? ` · ${t('player.segmentRepeatActive')}` : ''}
                                    </span>
                                    <span className="block truncate font-mono text-xs text-text-primary">
                                      {formatTime(segment.start)} - {formatTime(segment.end)}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      deleteSegmentRepeatItem(segment.id)
                                    }}
                                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-300"
                                    title={t('player.segmentRepeatDelete')}
                                    aria-label={t('player.segmentRepeatDelete')}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              )
                            })
                          )}
                        </div>

                        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleSegmentRepeat()
                            }}
                            disabled={!segmentRepeatReady}
                            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              segmentRepeatActive
                                ? 'bg-accent/15 text-accent'
                                : 'bg-surface-100/15 text-text-secondary hover:bg-surface-100/25 hover:text-text-primary'
                            }`}
                          >
                            {t('player.segmentRepeat')}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              clearSegmentRepeat()
                            }}
                            disabled={!hasSegmentRepeatDraft && segmentRepeat.segments.length === 0}
                            className="rounded-lg border border-surface-100/20 bg-surface-200/60 px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('player.segmentRepeatClearAll')}
                          </button>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowSegmentRepeatControls((value) => !value)
                      }}
                      className={`inline-flex items-center rounded p-1.5 font-mono text-[10px] font-semibold transition-colors ${
                        showSegmentRepeatControls || segmentRepeatActive || hasSegmentRepeatDraft || segmentRepeat.segments.length > 0
                          ? 'text-accent bg-accent/10'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                      title={t('player.segmentRepeat')}
                      aria-label={t('player.segmentRepeat')}
                    >
                      AB
                      {segmentRepeat.segments.length > 0 && (
                        <span className="ml-1 rounded-sm bg-accent/15 px-1 text-[9px] leading-none">
                          {segmentRepeat.segments.length}
                        </span>
                      )}
                    </button>
                  </div>
                )}

                <button
                  onClick={(e) => { e.stopPropagation(); toggleLoopCurrentMedia() }}
                  className={`p-1.5 rounded transition-colors ${loopCurrentMedia ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                  title={t('player.repeatCurrentMedia')}
                >
                  <Repeat size={16} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleShufflePlayback() }}
                  className={`p-1.5 rounded transition-colors ${playbackMode === 'shuffle' ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                  title={t('player.shufflePlayback')}
                >
                  <Shuffle size={16} />
                </button>
                {actions.length > 0 && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowTimeline(v => !v) }}
                      className={`p-1.5 flex items-center gap-1 rounded transition-colors ${showTimeline ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                      title="Timeline"
                    >
                      <Activity size={16} />
                      <span className="text-[10px] font-medium">TL</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowHeatmap(v => !v) }}
                      className={`p-1.5 flex items-center gap-1 rounded transition-colors ${showHeatmap ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                      title="Heatmap"
                    >
                      <BarChart3 size={16} />
                      <span className="text-[10px] font-medium">HM</span>
                    </button>
                  </>
                )}
                {subtitleCues.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowSubtitles((value) => !value) }}
                    className={`p-1.5 flex items-center gap-1 rounded transition-colors ${showSubtitles ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                    title={t('player.subtitles')}
                  >
                    <Captions size={16} />
                    <span className="text-[10px] font-medium">CC</span>
                  </button>
                )}
                {mediaType === 'video' && (
                  <div className="flex items-center gap-0.5 rounded bg-surface-300/40 p-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setVideoFitInside() }}
                      className={`px-1.5 py-1 text-[10px] font-semibold tracking-wide rounded transition-colors ${!videoFillEnabled ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                      title="Fit inside video area without cropping"
                      aria-label="Fit inside video area without cropping"
                    >
                      FIT
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setVideoFillCrop() }}
                      className={`px-1.5 py-1 text-[10px] font-semibold tracking-wide rounded transition-colors ${videoFillEnabled ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                      title="Fill video area and crop if needed"
                      aria-label="Fill video area and crop if needed"
                    >
                      FILL
                    </button>
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}
                  className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
                >
                  {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getStableDisplayDuration(previousDuration: number, nextDuration: number, currentTime: number): number {
  const normalizedNextDuration = Math.ceil(nextDuration)
  const minimumVisibleDuration = Math.ceil(Math.max(0, currentTime))

  if (!Number.isFinite(normalizedNextDuration) || normalizedNextDuration <= 0) {
    return Math.max(previousDuration, minimumVisibleDuration)
  }

  return Math.max(normalizedNextDuration, minimumVisibleDuration)
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function isRealScriptSource(sourcePath: string | null): sourcePath is string {
  return Boolean(sourcePath && !sourcePath.startsWith('generated://'))
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)))
}

function clampPlaybackRate(value: number): number {
  const normalized = Number.isFinite(value) ? value : 1
  return Math.max(
    PLAYBACK_RATE_MIN,
    Math.min(
      PLAYBACK_RATE_MAX,
      Number(normalized.toFixed(2))
    )
  )
}

function clampScriptOffset(value: number): number {
  const normalized = Number.isFinite(value) ? value : 0
  return Math.max(SCRIPT_OFFSET_MIN_MS, Math.min(SCRIPT_OFFSET_MAX_MS, Math.round(normalized)))
}

function formatScriptOffset(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0)
  return `${rounded >= 0 ? '+' : ''}${rounded}ms`
}

function formatPlaybackRate(rate: number): string {
  const formatted = Number.isInteger(rate)
    ? rate.toFixed(0)
    : rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${formatted}x`
}

function getVideoClassName({
  isFullscreen,
  videoFillEnabled,
}: {
  isFullscreen: boolean
  videoFillEnabled: boolean
}): string {
  if (videoFillEnabled) {
    return `block h-full w-full object-cover ${isFullscreen ? 'object-center' : 'object-top'}`
  }

  return 'block h-full w-full object-contain'
}

function shouldAutoFitVideoByAspect(video: HTMLVideoElement): boolean {
  const videoWidth = video.videoWidth
  const videoHeight = video.videoHeight
  const viewport = video.parentElement?.getBoundingClientRect()

  if (!videoWidth || !videoHeight || !viewport || viewport.width <= 0 || viewport.height <= 0) {
    return false
  }

  const coverScale = Math.max(viewport.width / videoWidth, viewport.height / videoHeight)
  const renderedWidth = videoWidth * coverScale
  const renderedHeight = videoHeight * coverScale
  const croppedWidthRatio = Math.max(0, renderedWidth - viewport.width) / renderedWidth
  const croppedHeightRatio = Math.max(0, renderedHeight - viewport.height) / renderedHeight

  return Math.max(croppedWidthRatio, croppedHeightRatio) <= AUTO_FIT_MAX_CROP_RATIO
}

const VIDEO_FIT_PREFERENCE_STORAGE_KEY = 'scriptplayer-video-fit-enabled'
const AUTO_FIT_MAX_CROP_RATIO = 0.025

type VideoFillMode = 'manual' | 'auto' | null

function loadVideoFitPreference(): boolean | null {
  try {
    const raw = localStorage.getItem(VIDEO_FIT_PREFERENCE_STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    // Storage unavailable - ignore and use defaults
  }

  return null
}

function saveVideoFitPreference(enabled: boolean): void {
  try {
    localStorage.setItem(VIDEO_FIT_PREFERENCE_STORAGE_KEY, String(enabled))
  } catch {
    // Storage unavailable - ignore and keep current session state only
  }
}

type NavigatorWithDeviceMemory = Navigator & {
  deviceMemory?: number
}

type HTMLMediaElementWithVideoFrameCallback = HTMLMediaElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: VideoFrameMetadataLike) => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

type VideoFrameMetadataLike = {
  mediaTime: number
  presentedFrames?: number
}

type PlaybackDiagnosticsEvents = {
  waiting: number
  stalled: number
  suspend: number
  error: number
}

type PlaybackDiagnosticsFrames = {
  wallDeltasMs: number[]
  largeGaps: number
  lastFrameWallMs: number
  lastMediaTime: number
  presentedFrames: number
  lastLargeGap: {
    atMediaTime: number
    wallDeltaMs: number
    mediaDeltaMs: number
  } | null
}

type PlaybackDiagnosticsFrameSummary = {
  samples: number
  presentedFrames: number
  largeGaps: number
  p95WallDeltaMs: number | null
  maxWallDeltaMs: number | null
  lastLargeGap: PlaybackDiagnosticsFrames['lastLargeGap']
}

type PlaybackDiagnosticsQuality = {
  totalVideoFrames: number | null
  droppedVideoFrames: number | null
  corruptedVideoFrames: number | null
}

type PlaybackMediaErrorSnapshot = {
  code: number
  label: string
  message: string
}

type PlaybackBlackFrameSample = {
  sampledAt: string
  available: boolean
  reason: string
  videoWidth: number
  videoHeight: number
  sampleWidth: number
  sampleHeight: number
  averageLuma: number | null
  nonBlackRatio: number | null
}

type WebGlRendererInfo = {
  vendor: string
  renderer: string
  hardwareLikely: boolean | null
}

type PlaybackDiagnosticsSnapshot = {
  capturedAt: string
  platform: string
  userAgent: string
  versions: {
    electron: string
    chrome: string
    node: string
  } | null
  hardwareConcurrency: number | null
  deviceMemory: number | null
  mediaType: MediaType | null
  videoCompatibilityMode: string
  fileName: string
  hasSource: boolean
  videoWidth: number
  videoHeight: number
  duration: number
  currentTime: number
  playbackRate: number
  readyState: number
  networkState: number
  paused: boolean
  mediaError: PlaybackMediaErrorSnapshot | null
  events: PlaybackDiagnosticsEvents
  frames: PlaybackDiagnosticsFrameSummary
  quality: PlaybackDiagnosticsQuality
  renderer: WebGlRendererInfo
  blackFrameSample: PlaybackBlackFrameSample | null
  actionCount: number
  subtitleCount: number
}

let cachedWebGlRendererInfo: WebGlRendererInfo | null = null

function createEmptyPlaybackDiagnosticsEvents(): PlaybackDiagnosticsEvents {
  return {
    waiting: 0,
    stalled: 0,
    suspend: 0,
    error: 0,
  }
}

function createEmptyPlaybackDiagnosticsFrames(): PlaybackDiagnosticsFrames {
  return {
    wallDeltasMs: [],
    largeGaps: 0,
    lastFrameWallMs: 0,
    lastMediaTime: 0,
    presentedFrames: 0,
    lastLargeGap: null,
  }
}

function pushCappedNumber(values: number[], value: number, limit: number): void {
  values.push(value)
  if (values.length > limit) {
    values.splice(0, values.length - limit)
  }
}

function summarizePlaybackDiagnosticsFrames(frames: PlaybackDiagnosticsFrames): PlaybackDiagnosticsFrameSummary {
  const sorted = [...frames.wallDeltasMs].sort((a, b) => a - b)
  return {
    samples: sorted.length,
    presentedFrames: frames.presentedFrames,
    largeGaps: frames.largeGaps,
    p95WallDeltaMs: percentile(sorted, 0.95),
    maxWallDeltaMs: sorted.length ? sorted[sorted.length - 1] : null,
    lastLargeGap: frames.lastLargeGap,
  }
}

function percentile(sortedValues: number[], ratio: number): number | null {
  if (!sortedValues.length) return null
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(sortedValues.length * ratio)))
  return sortedValues[index]
}

function getVideoPlaybackQualitySnapshot(media: HTMLMediaElement | null): PlaybackDiagnosticsQuality {
  const video = media as (HTMLVideoElement & {
    webkitDecodedFrameCount?: number
    webkitDroppedFrameCount?: number
  }) | null
  const quality = typeof video?.getVideoPlaybackQuality === 'function'
    ? video.getVideoPlaybackQuality()
    : null

  return {
    totalVideoFrames: quality?.totalVideoFrames ?? video?.webkitDecodedFrameCount ?? null,
    droppedVideoFrames: quality?.droppedVideoFrames ?? video?.webkitDroppedFrameCount ?? null,
    corruptedVideoFrames: quality?.corruptedVideoFrames ?? null,
  }
}

function getMediaErrorSnapshot(media: HTMLMediaElement | null): PlaybackMediaErrorSnapshot | null {
  const error = media?.error
  if (!error) return null

  return {
    code: error.code,
    label: getMediaErrorLabel(error.code),
    message: error.message || '',
  }
}

function getMediaErrorLabel(code: number): string {
  switch (code) {
    case 1:
      return 'aborted'
    case 2:
      return 'network'
    case 3:
      return 'decode'
    case 4:
      return 'source-not-supported'
    default:
      return 'unknown'
  }
}

function sampleVideoBlackFrame(video: HTMLVideoElement): PlaybackBlackFrameSample {
  const videoWidth = video.videoWidth || 0
  const videoHeight = video.videoHeight || 0
  const base = {
    sampledAt: new Date().toISOString(),
    videoWidth,
    videoHeight,
    sampleWidth: 0,
    sampleHeight: 0,
    averageLuma: null,
    nonBlackRatio: null,
  }

  if (!videoWidth || !videoHeight) {
    return {
      ...base,
      available: false,
      reason: 'no-video-dimensions',
    }
  }

  if (video.readyState < 2) {
    return {
      ...base,
      available: false,
      reason: 'no-current-frame',
    }
  }

  try {
    const sampleWidth = 24
    const sampleHeight = 24
    const canvas = document.createElement('canvas')
    canvas.width = sampleWidth
    canvas.height = sampleHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      return {
        ...base,
        available: false,
        reason: 'canvas-unavailable',
      }
    }

    context.drawImage(video, 0, 0, sampleWidth, sampleHeight)
    const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data
    let lumaSum = 0
    let nonBlackPixels = 0
    const pixelCount = sampleWidth * sampleHeight

    for (let index = 0; index < data.length; index += 4) {
      const luma = (data[index] * 0.2126) + (data[index + 1] * 0.7152) + (data[index + 2] * 0.0722)
      lumaSum += luma
      if (luma > 8 || data[index + 3] < 245) {
        nonBlackPixels += 1
      }
    }

    const averageLuma = lumaSum / pixelCount
    const nonBlackRatio = nonBlackPixels / pixelCount

    return {
      sampledAt: base.sampledAt,
      available: true,
      reason: averageLuma <= 4 && nonBlackRatio <= 0.01 ? 'mostly-black-frame' : 'visible-frame',
      videoWidth,
      videoHeight,
      sampleWidth,
      sampleHeight,
      averageLuma,
      nonBlackRatio,
    }
  } catch (error) {
    return {
      ...base,
      available: false,
      reason: error instanceof Error && error.name ? error.name : 'sample-failed',
    }
  }
}

function getWebGlRendererInfo(): WebGlRendererInfo {
  if (cachedWebGlRendererInfo) {
    return cachedWebGlRendererInfo
  }

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null

  try {
    const canvas = document.createElement('canvas')
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) {
      cachedWebGlRendererInfo = {
        vendor: '',
        renderer: '',
        hardwareLikely: null,
      }
      return cachedWebGlRendererInfo
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as any
    const vendor = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) || '')
    const renderer = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '')

    cachedWebGlRendererInfo = {
      vendor,
      renderer,
      hardwareLikely: renderer ? !/swiftshader|software|llvmpipe|microsoft basic/i.test(renderer) : null,
    }
    return cachedWebGlRendererInfo
  } catch {
    cachedWebGlRendererInfo = {
      vendor: '',
      renderer: '',
      hardwareLikely: null,
    }
    return cachedWebGlRendererInfo
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

function getHardwareRendererLabel(value: boolean | null): string {
  if (value === true) return 'hardware renderer likely'
  if (value === false) return 'software renderer suspected'
  return 'unknown'
}

function getVideoDiagnosticsIssueKey(snapshot: PlaybackDiagnosticsSnapshot | null): string | null {
  if (!snapshot || snapshot.mediaType !== 'video' || !snapshot.hasSource) return null

  if (snapshot.mediaError) {
    return snapshot.mediaError.label === 'decode'
      ? 'player.videoIssueDecode'
      : 'player.videoIssueMediaError'
  }

  if (
    snapshot.readyState >= 2 &&
    snapshot.currentTime >= 1 &&
    (snapshot.videoWidth <= 0 || snapshot.videoHeight <= 0)
  ) {
    return 'player.videoIssueNoVideoFrame'
  }

  if (
    snapshot.currentTime >= 5 &&
    snapshot.blackFrameSample?.available &&
    snapshot.blackFrameSample.reason === 'mostly-black-frame'
  ) {
    return 'player.videoIssueBlackFrame'
  }

  const droppedFrames = snapshot.quality.droppedVideoFrames ?? 0
  const totalFrames = snapshot.quality.totalVideoFrames ?? 0
  const droppedFrameRatio = totalFrames > 0 ? droppedFrames / totalFrames : 0
  const maxGap = snapshot.frames.maxWallDeltaMs ?? 0
  const shouldEvaluateFrameDrops =
    !snapshot.paused &&
    snapshot.currentTime >= 5 &&
    snapshot.frames.samples >= 120 &&
    maxGap < 5000

  if (
    shouldEvaluateFrameDrops &&
    (
      snapshot.frames.largeGaps >= 18 ||
      (droppedFrames >= 30 && droppedFrameRatio >= 0.04 && maxGap >= 250)
    )
  ) {
    return 'player.videoIssueFrameDrops'
  }

  return null
}

function formatDiagnosticInteger(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString() : 'unknown'
}

function formatDiagnosticMs(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}ms` : 'unknown'
}

function formatMediaError(error: PlaybackMediaErrorSnapshot | null): string {
  if (!error) return 'none'
  return `${error.code} ${error.label}${error.message ? ` (${error.message})` : ''}`
}

function formatBlackFrameSample(sample: PlaybackBlackFrameSample | null): string {
  if (!sample) return 'none'
  if (!sample.available) {
    return `${sample.reason} (${sample.videoWidth}x${sample.videoHeight})`
  }

  return [
    sample.reason,
    `${sample.videoWidth}x${sample.videoHeight}`,
    `sample ${sample.sampleWidth}x${sample.sampleHeight}`,
    `avg luma ${sample.averageLuma?.toFixed(2) ?? 'unknown'}`,
    `non-black ${(sample.nonBlackRatio ?? 0).toFixed(3)}`,
    `at ${sample.sampledAt}`,
  ].join(', ')
}

function formatPlaybackDiagnostics(snapshot: PlaybackDiagnosticsSnapshot): string {
  return [
    'ScriptPlayer+ playback diagnostics',
    `Captured: ${snapshot.capturedAt}`,
    `Platform: ${snapshot.platform}`,
    `User agent: ${snapshot.userAgent}`,
    `Electron: ${snapshot.versions?.electron || 'unknown'}`,
    `Chrome: ${snapshot.versions?.chrome || 'unknown'}`,
    `Node: ${snapshot.versions?.node || 'unknown'}`,
    `CPU threads: ${snapshot.hardwareConcurrency ?? 'unknown'}`,
    `Device memory: ${snapshot.deviceMemory ?? 'unknown'} GB`,
    `WebGL vendor: ${snapshot.renderer.vendor || 'unknown'}`,
    `WebGL renderer: ${snapshot.renderer.renderer || 'unknown'}`,
    `Hardware renderer: ${getHardwareRendererLabel(snapshot.renderer.hardwareLikely)}`,
    `Media type: ${snapshot.mediaType}`,
    `Video compatibility mode: ${snapshot.videoCompatibilityMode}`,
    `File: ${snapshot.fileName || 'unknown'}`,
    `Video: ${snapshot.videoWidth}x${snapshot.videoHeight}`,
    `Time: ${snapshot.currentTime.toFixed(3)} / ${snapshot.duration.toFixed(3)}`,
    `Playback rate: ${snapshot.playbackRate}`,
    `Ready/network state: ${snapshot.readyState}/${snapshot.networkState}`,
    `Paused: ${snapshot.paused}`,
    `Media error: ${formatMediaError(snapshot.mediaError)}`,
    `Frames total/dropped/corrupted: ${formatDiagnosticInteger(snapshot.quality.totalVideoFrames)} / ${formatDiagnosticInteger(snapshot.quality.droppedVideoFrames)} / ${formatDiagnosticInteger(snapshot.quality.corruptedVideoFrames)}`,
    `Frame gaps samples/p95/max/large: ${snapshot.frames.samples} / ${formatDiagnosticMs(snapshot.frames.p95WallDeltaMs)} / ${formatDiagnosticMs(snapshot.frames.maxWallDeltaMs)} / ${snapshot.frames.largeGaps}`,
    `Black frame sample: ${formatBlackFrameSample(snapshot.blackFrameSample)}`,
    `Events waiting/stalled/suspend/error: ${snapshot.events.waiting} / ${snapshot.events.stalled} / ${snapshot.events.suspend} / ${snapshot.events.error}`,
    `Script actions: ${snapshot.actionCount}`,
    `Subtitles: ${snapshot.subtitleCount}`,
  ].join('\n')
}
