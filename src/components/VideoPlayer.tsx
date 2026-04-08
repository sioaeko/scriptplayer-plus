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
]

interface VideoPlayerProps {
  videoUrl: string | null
  mediaType: MediaType | null
  currentFileName: string | null
  artworkUrl: string | null
  actions: FunscriptAction[]
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
  onOpenDeviceSettings?: () => void
  defaultShowHeatmap?: boolean
  defaultShowTimeline?: boolean
  timelineHeight?: number
  timelineWindow?: number
  speedColors?: boolean
  subtitleFontSize?: number
}

const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const TOP_NAV_TRIGGER_HEIGHT_PX = 84

export default function VideoPlayer({
  videoUrl,
  mediaType,
  currentFileName,
  artworkUrl,
  actions,
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
  const [showHeatmap, setShowHeatmap] = useState(defaultShowHeatmap)
  const [showTimeline, setShowTimeline] = useState(defaultShowTimeline)
  const deviceOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const strokeControlsRef = useRef<HTMLDivElement>(null)
  const strokeCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [progressPreviewTime, setProgressPreviewTime] = useState<number | null>(null)
  const [isProgressScrubbing, setIsProgressScrubbing] = useState(false)
  const [duration, setDuration] = useState(0)
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('volume')
    return saved ? parseFloat(saved) : 1
  })
  const [muted, setMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fullscreenFitEnabled, setFullscreenFitEnabled] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showTopNav, setShowTopNav] = useState(false)
  const [showSubtitles, setShowSubtitles] = useState(subtitleCues.length > 0)
  const [strokeDraft, setStrokeDraft] = useState(() => ({
    min: strokeRangeMin,
    max: strokeRangeMax,
  }))
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playbackFrameRef = useRef<number | null>(null)
  const handledAutoPlayRequest = useRef(0)
  const progressScrubbingRef = useRef(false)
  const effectiveCurrentTime = isProgressScrubbing && progressPreviewTime !== null ? progressPreviewTime : currentTime
  const currentSubtitleText = showSubtitles ? getActiveSubtitleText(subtitleCues, effectiveCurrentTime) : ''
  const isPortraitVideo = videoAspectRatio !== null && videoAspectRatio < 1
  const controlsVisible = showControls || !playing
  const scriptOverlayHeight = actions.length > 0
    ? (showHeatmap ? 32 : 0) + (showTimeline ? timelineHeight : 0)
    : 0
  const fullscreenControlsOffset = isFullscreen && controlsVisible ? 96 : 0
  const subtitleBottomOffset = 24 + (isFullscreen ? scriptOverlayHeight + fullscreenControlsOffset : 0)
  const videoClassName = getVideoClassName({
    isFullscreen,
    fullscreenFitEnabled,
    isPortraitVideo,
  })

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
    }

    if (media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0) {
      const nextAspectRatio = media.videoWidth / media.videoHeight
      setVideoAspectRatio((prevAspectRatio) => (
        prevAspectRatio === null || Math.abs(prevAspectRatio - nextAspectRatio) >= 1 / 1000
          ? nextAspectRatio
          : prevAspectRatio
      ))
    }
  }, [mediaRef])

  const handleTimeUpdate = useCallback(() => {
    syncCurrentTimeFromMedia()
  }, [syncCurrentTimeFromMedia])

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

  const toggleSequentialPlayback = useCallback(() => {
    onPlaybackModeChange(playbackMode === 'sequential' ? 'none' : 'sequential')
  }, [onPlaybackModeChange, playbackMode])

  const toggleShufflePlayback = useCallback(() => {
    onPlaybackModeChange(playbackMode === 'shuffle' ? 'none' : 'shuffle')
  }, [onPlaybackModeChange, playbackMode])

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
    if (showControls) return
    setShowStrokeControls(false)
  }, [showControls])

  useEffect(() => {
    if (actions.length > 0) return
    setShowStrokeControls(false)
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
    return () => {
      if (playbackFrameRef.current !== null) {
        cancelAnimationFrame(playbackFrameRef.current)
      }
      clearHideControlsTimer()
      clearStrokeCommitTimer()
      if (deviceOverlayTimer.current) clearTimeout(deviceOverlayTimer.current)
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
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    duration,
    handleSeek,
    handleVolumeChange,
    onNextFile,
    onPreviousFile,
    shortcutBindings,
    shortcutsEnabled,
    skip,
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
  }, [mediaRef, videoUrl, volume])

  useEffect(() => {
    const media = mediaRef.current
    if (!media || !videoUrl) return
    media.defaultPlaybackRate = playbackRate
    media.playbackRate = playbackRate
  }, [mediaRef, playbackRate, videoUrl])

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
  }, [mediaRef, playing, syncCurrentTimeFromMedia, videoUrl])

  useEffect(() => {
    setCurrentTime(0)
    setProgressPreviewTime(null)
    setIsProgressScrubbing(false)
    progressScrubbingRef.current = false
    setDuration(0)
    setVideoAspectRatio(null)
    setPlaying(false)
    setFullscreenFitEnabled(false)
    setShowControls(true)
    setShowTopNav(false)
    setShowStrokeControls(false)
    setShowHeatmap(defaultShowHeatmap)
    setShowTimeline(defaultShowTimeline)
  }, [videoUrl, defaultShowHeatmap, defaultShowTimeline])

  useEffect(() => {
    setShowSubtitles(subtitleCues.length > 0)
  }, [subtitleCues])

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

    const frame = requestAnimationFrame(() => {
      void media.play()
    })

    return () => cancelAnimationFrame(frame)
  }, [autoPlayRequestId, mediaRef, videoUrl])

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
                ref={(node) => { mediaRef.current = node }}
                src={videoUrl}
                className="hidden"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={syncDurationFromMedia}
                onDurationChange={syncDurationFromMedia}
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
                </div>
              </div>
            </>
          ) : (
            <video
              ref={(node) => { mediaRef.current = node }}
              src={videoUrl}
              className={videoClassName}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={syncDurationFromMedia}
              onDurationChange={syncDurationFromMedia}
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

        {isFullscreen && actions.length > 0 && (showHeatmap || showTimeline) && (
          <div
            className="absolute inset-x-0 z-10 border-t border-surface-100/20 bg-black/35 backdrop-blur-sm transition-[bottom] duration-300 ease-out"
            style={{ bottom: fullscreenControlsOffset }}
          >
            {showHeatmap && (
              <div className="h-8">
                <ScriptHeatmap
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

        {/* Device connection overlay */}
        {showDeviceOverlay && deviceInfo && (
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

      {/* Controls overlay */}
      <div
        className={`${isFullscreen ? 'absolute inset-x-0 bottom-0 z-10' : 'flex-shrink-0'} relative bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-3 pt-8 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Progress bar */}
        <div className="mb-2">
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

        {/* Control buttons */}
        <div className="flex items-center justify-between gap-4">
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
              {formatTime(effectiveCurrentTime)} / {formatTime(duration)}
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
              <select
              value={playbackRate.toString()}
              onChange={(e) => {
                e.stopPropagation()
                onPlaybackRateChange(parseFloat(e.target.value))
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-300/80 text-text-secondary text-[10px] px-2 py-1 rounded border border-surface-100/30 outline-none hover:text-text-primary"
              title={t('player.playbackSpeed')}
            >
              {PLAYBACK_RATE_OPTIONS.map((rate) => (
                <option key={rate} value={rate}>
                  {formatPlaybackRate(rate)}
                </option>
              ))}
              </select>
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
              <button
              onClick={(e) => { e.stopPropagation(); toggleSequentialPlayback() }}
              className={`p-1.5 rounded transition-colors ${playbackMode === 'sequential' ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary'}`}
              title={t('player.continuousPlayback')}
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
                title="FIT"
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

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)))
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
  isPortraitVideo,
}: {
  isFullscreen: boolean
  fullscreenFitEnabled: boolean
  isPortraitVideo: boolean
}): string {
  if (!isFullscreen || !fullscreenFitEnabled) {
    return 'block max-w-full max-h-full'
  }

  if (isPortraitVideo) {
    return 'block h-full w-auto max-w-none'
  }

  return 'block w-full h-auto max-h-full'
}
