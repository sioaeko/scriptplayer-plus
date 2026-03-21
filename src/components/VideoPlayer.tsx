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
} from 'lucide-react'
import { FunscriptAction, MediaType, PlaybackMode, SubtitleCue } from '../types'
import { useTranslation } from '../i18n'
import { getActiveSubtitleText } from '../services/subtitles'
import ScriptTimeline from './ScriptTimeline'
import ScriptHeatmap from './ScriptHeatmap'

interface DeviceOverlayInfo {
  connected: boolean
  label: string
  detail?: string | null
  statusText?: string | null
  statusTone?: 'busy' | 'error' | null
}

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
  playbackMode: PlaybackMode
  onPlaybackModeChange: (mode: PlaybackMode) => void
  playbackRate: number
  onPlaybackRateChange: (rate: number) => void
  deviceInfo?: DeviceOverlayInfo | null
  defaultShowHeatmap?: boolean
  defaultShowTimeline?: boolean
  timelineHeight?: number
  timelineWindow?: number
  speedColors?: boolean
  subtitleFontSize?: number
}

const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

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
  playbackMode,
  onPlaybackModeChange,
  playbackRate,
  onPlaybackRateChange,
  deviceInfo,
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
  const [showHeatmap, setShowHeatmap] = useState(defaultShowHeatmap)
  const [showTimeline, setShowTimeline] = useState(defaultShowTimeline)
  const deviceOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
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
  const [showSubtitles, setShowSubtitles] = useState(subtitleCues.length > 0)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playbackFrameRef = useRef<number | null>(null)
  const handledAutoPlayRequest = useRef(0)
  const currentSubtitleText = showSubtitles ? getActiveSubtitleText(subtitleCues, currentTime) : ''
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
    const nextTime = media.currentTime
    setCurrentTime((prevTime) => (Math.abs(prevTime - nextTime) >= 1 / 240 ? nextTime : prevTime))
    onTimeUpdate(nextTime)
  }, [mediaRef, onTimeUpdate])

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
    return () => {
      if (playbackFrameRef.current !== null) {
        cancelAnimationFrame(playbackFrameRef.current)
      }
      clearHideControlsTimer()
      if (deviceOverlayTimer.current) clearTimeout(deviceOverlayTimer.current)
    }
  }, [clearHideControlsTimer])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          skip(e.shiftKey ? -10 : -5)
          break
        case 'ArrowRight':
          e.preventDefault()
          skip(e.shiftKey ? 10 : 5)
          break
        case 'ArrowUp':
          e.preventDefault()
          handleVolumeChange(Math.min(1, volume + 0.05))
          break
        case 'ArrowDown':
          e.preventDefault()
          handleVolumeChange(Math.max(0, volume - 0.05))
          break
        case 'f':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'm':
          e.preventDefault()
          toggleMute()
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleVolumeChange, skip, toggleFullscreen, toggleMute, togglePlay, volume])

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
    setDuration(0)
    setVideoAspectRatio(null)
    setPlaying(false)
    setFullscreenFitEnabled(false)
    setShowControls(true)
    setShowSubtitles(subtitleCues.length > 0)
    setShowHeatmap(defaultShowHeatmap)
    setShowTimeline(defaultShowTimeline)
  }, [videoUrl, subtitleCues, defaultShowHeatmap, defaultShowTimeline])

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
                onLoadedMetadata={() => {
                  const media = mediaRef.current
                  if (media) setDuration(media.duration)
                }}
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
              onLoadedMetadata={() => {
                const media = mediaRef.current
                if (media) {
                  setDuration(media.duration)
                  if (media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0) {
                    setVideoAspectRatio(media.videoWidth / media.videoHeight)
                  }
                }
              }}
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
                  currentTime={currentTime}
                  onSeek={handleSeek}
                />
              </div>
            )}
            {showTimeline && (
              <div style={{ height: timelineHeight }}>
                <ScriptTimeline
                  actions={actions}
                  currentTime={currentTime}
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
      </div>

      {/* Script timeline / heatmap */}
      {!isFullscreen && actions.length > 0 && (showHeatmap || showTimeline) && (
        <div className="flex-shrink-0 border-t border-surface-100/20">
          {showHeatmap && (
            <div className="h-8">
              <ScriptHeatmap
                actions={actions}
                duration={duration}
                currentTime={currentTime}
                onSeek={handleSeek}
              />
            </div>
          )}
          {showTimeline && (
            <div style={{ height: timelineHeight }}>
              <ScriptTimeline
                actions={actions}
                currentTime={currentTime}
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
        className={`${isFullscreen ? 'absolute inset-x-0 bottom-0 z-10' : 'flex-shrink-0'} bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-3 pt-8 transition-opacity duration-300 ${
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
            value={currentTime}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            className="w-full h-1"
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); skip(-5) }}
              className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); togglePlay() }}
              className="p-2 text-text-primary hover:text-accent transition-colors"
            >
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); skip(5) }}
              className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
            >
              <SkipForward size={18} />
            </button>
            <span className="text-xs text-text-secondary ml-2 font-mono tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

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
