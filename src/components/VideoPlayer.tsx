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
} from 'lucide-react'
import { FunscriptAction, MediaType, PlaybackMode, SubtitleCue } from '../types'
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

interface DeviceOverlayInfo {
  connected: boolean
  label: string
  detail?: string | null
  statusText?: string | null
  statusTone?: 'busy' | 'error' | null
}

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
  mediaType: MediaType | null
  currentFileName: string | null
  artworkUrl: string | null
  actions: FunscriptAction[]
  scriptSource?: string | null
  scriptDebugInfo?: ScriptDebugInfo | null
  subtitleCues: SubtitleCue[]
  onTimeUpdate: (time: number) => void
  onPlay: () => void | Promise<void>
  onPause: () => void | Promise<void>
  onSeek: (time: number) => void | Promise<void>
  onEnded: () => void | Promise<void>
  mediaRef: React.MutableRefObject<HTMLMediaElement | null>
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

export default function VideoPlayer({
  mediaSessionKey,
  videoUrl,
  mediaType,
  currentFileName,
  artworkUrl,
  actions,
  scriptSource = null,
  scriptDebugInfo = null,
  subtitleCues,
  onTimeUpdate,
  onPlay,
  onPause,
  onSeek,
  onEnded,
  mediaRef,
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
  const [showHeatmap, setShowHeatmap] = useState(defaultShowHeatmap)
  const [showTimeline, setShowTimeline] = useState(defaultShowTimeline)
  const deviceOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scriptOffsetFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const strokeControlsRef = useRef<HTMLDivElement>(null)
  const playbackRateControlsRef = useRef<HTMLDivElement>(null)
  const scriptOffsetControlsRef = useRef<HTMLDivElement>(null)
  const strokeCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoRevealedScriptKey = useRef<string | null>(null)
  const initializedMediaStateKey = useRef<string | null>(null)
  const fullscreenScriptOverlayRef = useRef<HTMLDivElement>(null)
  const fullscreenControlsOverlayRef = useRef<HTMLDivElement>(null)
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
  const [fullscreenFitEnabled, setFullscreenFitEnabled] = useState(false)
  const [fullscreenScriptOverlayHeight, setFullscreenScriptOverlayHeight] = useState(0)
  const [fullscreenControlsOverlayHeight, setFullscreenControlsOverlayHeight] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [showTopNav, setShowTopNav] = useState(false)
  const [showSubtitles, setShowSubtitles] = useState(subtitleCues.length > 0)
  const [scriptOffsetFeedback, setScriptOffsetFeedback] = useState<number | null>(null)
  const [scriptPathCopied, setScriptPathCopied] = useState(false)
  const scriptOffsetRef = useRef(scriptOffset)
  const scriptPathCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [strokeDraft, setStrokeDraft] = useState(() => ({
    min: strokeRangeMin,
    max: strokeRangeMax,
  }))
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diagnosticsEventsRef = useRef<PlaybackDiagnosticsEvents>(createEmptyPlaybackDiagnosticsEvents())
  const diagnosticsFramesRef = useRef<PlaybackDiagnosticsFrames>(createEmptyPlaybackDiagnosticsFrames())
  const diagnosticsCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playbackFrameRef = useRef<number | null>(null)
  const handledAutoPlayRequest = useRef(0)
  const progressScrubbingRef = useRef(false)
  const effectiveCurrentTime = isProgressScrubbing && progressPreviewTime !== null ? progressPreviewTime : currentTime
  const currentSubtitleText = showSubtitles ? getActiveSubtitleText(subtitleCues, effectiveCurrentTime) : ''
  const firstActionTimeSeconds = actions.length > 0 ? Math.max(0, actions[0].at / 1000) : null
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
    isFullscreen,
    fullscreenFitEnabled,
  })
  const controlsContainerClass = isFullscreen
    ? 'absolute inset-x-0 bottom-0 z-10 px-4 pb-3 pt-4'
    : 'relative flex-shrink-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-3 pt-8'
  const controlsPanelClass = isFullscreen
    ? 'rounded-2xl border border-white/14 bg-black px-3 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.6)]'
    : ''
  const mediaStateKey = `${mediaSessionKey}:${videoUrl ?? 'none'}`
  const debugScriptPathCandidate = scriptDebugInfo?.sourcePath ?? null
  const debugScriptPath = isRealScriptSource(debugScriptPathCandidate) ? debugScriptPathCandidate : null
  const progressBarWrapClass = isFullscreen
    ? 'mb-3'
    : 'mb-2'
  const controlRowClass = isFullscreen
    ? 'flex items-center justify-between gap-4'
    : 'flex items-center justify-between gap-4'

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
      events: { ...diagnosticsEventsRef.current },
      frames,
      quality,
      renderer,
      actionCount: actions.length,
      subtitleCount: subtitleCues.length,
    }
  }, [actions.length, currentFileName, mediaRef, mediaType, subtitleCues.length, videoUrl])

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

  const beginProgressScrub = useCallback(() => {
    progressScrubbingRef.current = true
    setIsProgressScrubbing(true)
    setProgressPreviewTime(currentTime)
  }, [currentTime])

  const updateProgressPreview = useCallback((time: number) => {
    const clampedTime = Math.max(0, Math.min(duration || 0, time))
    setProgressPreviewTime(clampedTime)
  }, [duration])

  const commitProgressScrub = useCallback((overrideTime?: number) => {
    if (!progressScrubbingRef.current) return

    const targetTime = Math.max(0, Math.min(duration || 0, overrideTime ?? progressPreviewTime ?? currentTime))
    progressScrubbingRef.current = false
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
    if (!isFullscreen) {
      setFullscreenFitEnabled(false)
    }
  }, [isFullscreen])

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
    if (showControls) return
    setShowStrokeControls(false)
    setShowScriptOffsetControls(false)
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
    return () => {
      if (playbackFrameRef.current !== null) {
        cancelAnimationFrame(playbackFrameRef.current)
      }
      clearHideControlsTimer()
      clearStrokeCommitTimer()
      if (deviceOverlayTimer.current) clearTimeout(deviceOverlayTimer.current)
      if (scriptOffsetFeedbackTimer.current) clearTimeout(scriptOffsetFeedbackTimer.current)
      if (scriptPathCopiedTimer.current) clearTimeout(scriptPathCopiedTimer.current)
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
    setFullscreenFitEnabled(false)
    setShowControls(true)
    setShowTopNav(false)
    setShowStrokeControls(false)
    setShowPlaybackRatePopover(false)
    setShowHeatmap(defaultShowHeatmap)
    setShowTimeline(defaultShowTimeline)
  }, [defaultShowHeatmap, defaultShowTimeline, mediaStateKey])

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

  useEffect(() => {
    if (!videoUrl || actions.length === 0 || showHeatmap || showTimeline) {
      return
    }

    if (autoRevealedScriptKey.current === mediaStateKey) {
      return
    }

    autoRevealedScriptKey.current = mediaStateKey
    setShowTimeline(true)
  }, [actions.length, mediaStateKey, showHeatmap, showTimeline, videoUrl])

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col bg-black relative"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => playing && setShowControls(false)}
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
                    {diagnosticsCopied ? '복사됨' : '진단 복사'}
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
          <div className={progressBarWrapClass}>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={effectiveCurrentTime}
              onPointerDown={(e) => {
                e.stopPropagation()
                beginProgressScrub()
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                commitProgressScrub(parseFloat((e.target as HTMLInputElement).value))
              }}
              onChange={(e) => {
                const nextTime = parseFloat(e.target.value)
                if (progressScrubbingRef.current) {
                  updateProgressPreview(nextTime)
                  return
                }
                handleSeek(nextTime)
              }}
              onBlur={() => commitProgressScrub()}
              className="w-full h-1"
              onClick={(e) => e.stopPropagation()}
            />
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
                {mediaType === 'video' && isFullscreen && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setFullscreenFitEnabled((value) => !value) }}
                    className={`p-1.5 flex items-center gap-1 rounded transition-colors ${fullscreenFitEnabled ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
                    title="Fill screen"
                    aria-label="Fill screen"
                  >
                    <span className="text-[10px] font-semibold tracking-wide">FIT</span>
                  </button>
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
  fullscreenFitEnabled,
}: {
  isFullscreen: boolean
  fullscreenFitEnabled: boolean
}): string {
  if (isFullscreen && fullscreenFitEnabled) {
    return 'block h-full w-full object-cover'
  }

  return 'block max-w-full max-h-full object-contain'
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
  events: PlaybackDiagnosticsEvents
  frames: PlaybackDiagnosticsFrameSummary
  quality: PlaybackDiagnosticsQuality
  renderer: WebGlRendererInfo
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
  if (value === true) return '하드웨어 렌더러로 보임'
  if (value === false) return '소프트웨어 렌더러 의심'
  return '확인 불가'
}

function formatDiagnosticInteger(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString() : 'unknown'
}

function formatDiagnosticMs(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}ms` : 'unknown'
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
    `File: ${snapshot.fileName || 'unknown'}`,
    `Video: ${snapshot.videoWidth}x${snapshot.videoHeight}`,
    `Time: ${snapshot.currentTime.toFixed(3)} / ${snapshot.duration.toFixed(3)}`,
    `Playback rate: ${snapshot.playbackRate}`,
    `Ready/network state: ${snapshot.readyState}/${snapshot.networkState}`,
    `Paused: ${snapshot.paused}`,
    `Frames total/dropped/corrupted: ${formatDiagnosticInteger(snapshot.quality.totalVideoFrames)} / ${formatDiagnosticInteger(snapshot.quality.droppedVideoFrames)} / ${formatDiagnosticInteger(snapshot.quality.corruptedVideoFrames)}`,
    `Frame gaps samples/p95/max/large: ${snapshot.frames.samples} / ${formatDiagnosticMs(snapshot.frames.p95WallDeltaMs)} / ${formatDiagnosticMs(snapshot.frames.maxWallDeltaMs)} / ${snapshot.frames.largeGaps}`,
    `Events waiting/stalled/suspend/error: ${snapshot.events.waiting} / ${snapshot.events.stalled} / ${snapshot.events.suspend} / ${snapshot.events.error}`,
    `Script actions: ${snapshot.actionCount}`,
    `Subtitles: ${snapshot.subtitleCount}`,
  ].join('\n')
}
