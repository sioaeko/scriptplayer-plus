import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import VideoPlayer from './components/VideoPlayer'
import Settings from './components/Settings'
import { VideoFile, Funscript, FunscriptAction, MediaType, SubtitleCue, SubtitleFile } from './types'
import { parseFunscript } from './services/funscript'
import { handyService, HandyUploadStatus } from './services/handy'
import { AppSettings, loadSettings, saveSettings } from './services/settings'
import { getVideoSubtitleMatchScore, parseSubtitleFile } from './services/subtitles'
import { useTranslation } from './i18n'

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv']
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma']

function getMediaTypeFromPath(filePath: string): MediaType | null {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '')
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  return null
}

export default function App() {
  const { locale, setLocale } = useTranslation()
  const [files, setFiles] = useState<VideoFile[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [currentFileType, setCurrentFileType] = useState<MediaType | null>(null)
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null)
  const [funscript, setFunscript] = useState<Funscript | null>(null)
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([])
  const [handyConnected, setHandyConnected] = useState(false)
  const [scriptUploadUrl, setScriptUploadUrl] = useState<string | null>(null)
  const [handyUploadStatus, setHandyUploadStatus] = useState<HandyUploadStatus>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [manualScriptPaths, setManualScriptPaths] = useState<Record<string, string>>({})
  const [manualSubtitleFiles, setManualSubtitleFiles] = useState<Record<string, SubtitleFile>>({})
  const mediaRef = useRef<HTMLMediaElement | null>(null)

  const actions: FunscriptAction[] = funscript?.actions || []
  const displayFiles = useMemo(
    () => files.map((file) => ({
      ...file,
      hasScript: file.hasScript || Boolean(manualScriptPaths[file.path]),
      hasSubtitles: file.hasSubtitles || Boolean(manualSubtitleFiles[file.path]),
    })),
    [files, manualScriptPaths, manualSubtitleFiles]
  )

  // Listen for Handy upload status changes
  useEffect(() => {
    handyService.onStatusChange = (status) => {
      setHandyUploadStatus(status)
    }
    return () => { handyService.onStatusChange = null }
  }, [])

  // Sync settings language with i18n
  useEffect(() => {
    if (settings.language !== locale) {
      setLocale(settings.language)
    }
  }, [settings.language])

  const handleSettingsChange = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
  }, [])

  const loadSubtitleCues = useCallback(async (mediaPath: string, mediaType: MediaType) => {
    const manualSubtitle = manualSubtitleFiles[mediaPath]
    if (manualSubtitle) {
      return parseSubtitleFile(manualSubtitle.content, manualSubtitle.path)
    }

    const subtitleFiles = await window.electronAPI.readSubtitles(mediaPath)
    return selectSubtitleCues(mediaPath, mediaType, subtitleFiles)
  }, [manualSubtitleFiles])

  const loadScript = useCallback(async (mediaPath: string) => {
    const manualScriptPath = manualScriptPaths[mediaPath]
    if (manualScriptPath) {
      const manualScript = await window.electronAPI.readFunscriptFile(manualScriptPath)
      return manualScript ? parseFunscript(manualScript) : null
    }

    const script = await window.electronAPI.readFunscript(mediaPath, settings.scriptFolder)
    return script ? parseFunscript(script) : null
  }, [manualScriptPaths, settings.scriptFolder])


  const handleOpenFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.openFolder()
    if (!folderPath) return
    const mediaFiles = await window.electronAPI.readDir(folderPath)
    setFiles(mediaFiles)
  }, [])

  const openMediaFile = useCallback(async (filePath: string, fileType?: MediaType) => {
    const resolvedType = fileType ?? getMediaTypeFromPath(filePath)
    if (!resolvedType) return

    setCurrentFile(filePath)
    setCurrentFileType(resolvedType)
    setFunscript(null)
    setSubtitleCues([])
    setScriptUploadUrl(null)

    setArtworkUrl(null)

    const [url, nextSubtitleCues, parsed, artworkPath] = await Promise.all([
      window.electronAPI.getVideoUrl(filePath),
      loadSubtitleCues(filePath, resolvedType),
      loadScript(filePath),
      resolvedType === 'audio'
        ? window.electronAPI.findArtwork(filePath)
        : Promise.resolve<string | null>(null),
    ])

    setVideoUrl(url)
    setSubtitleCues(nextSubtitleCues)
    setFunscript(parsed)

    if (artworkPath) {
      const nextArtworkUrl = await window.electronAPI.getVideoUrl(artworkPath)
      setArtworkUrl(nextArtworkUrl)
    }

    if (parsed && handyService.isConnected) {
      uploadToHandy(parsed.actions)
    }
  }, [loadScript, loadSubtitleCues])

  const handleFileSelect = useCallback(async (file: VideoFile) => {
    await openMediaFile(file.path, file.type)
  }, [openMediaFile])

  const handleManualScriptSelect = useCallback(async (file: VideoFile) => {
    const scriptPath = await window.electronAPI.openScriptFile()
    if (!scriptPath) return

    setManualScriptPaths((prev) => ({ ...prev, [file.path]: scriptPath }))

    if (currentFile === file.path) {
      const parsed = await window.electronAPI.readFunscriptFile(scriptPath)
      const nextScript = parsed ? parseFunscript(parsed) : null
      setFunscript(nextScript)

      if (nextScript && handyService.isConnected) {
        uploadToHandy(nextScript.actions)
      } else {
        setScriptUploadUrl(null)
      }
    }
  }, [currentFile])

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
      const script = await window.electronAPI.readFunscript(file.path, settings.scriptFolder)
      const parsed = script ? parseFunscript(script) : null
      setFunscript(parsed)

      if (parsed && handyService.isConnected) {
        uploadToHandy(parsed.actions)
      } else {
        setScriptUploadUrl(null)
      }
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

  const uploadToHandy = async (scriptActions: FunscriptAction[]) => {
    const url = await handyService.uploadAndSetup(scriptActions)
    if (url) {
      setScriptUploadUrl(url)
      console.log('[App] Script uploaded and HSSP ready:', url)
    } else {
      setScriptUploadUrl(null)
      console.error('[App] Failed to upload script to Handy')
    }
  }

  const handleHandyConnect = async (key: string) => {
    const connected = await handyService.connect(key)
    setHandyConnected(connected)
    if (connected && funscript) {
      uploadToHandy(funscript.actions)
    }
  }

  const handleHandyDisconnect = () => {
    handyService.disconnect()
    setHandyConnected(false)
    setScriptUploadUrl(null)
  }

  const handlePlay = useCallback(async () => {
    if (handyService.isConnected && scriptUploadUrl) {
      const media = mediaRef.current
      if (media) {
        const serverTime = handyService.getServerTime()
        const offset = settings.timeOffset || 0
        await handyService.hsspPlay(serverTime, Math.round(media.currentTime * 1000) + offset)
      }
    }
  }, [scriptUploadUrl, settings.timeOffset])

  const handlePause = useCallback(async () => {
    if (handyService.isConnected) {
      await handyService.hsspStop()
    }
  }, [])

  const handleSeek = useCallback(
    async (time: number) => {
      if (handyService.isConnected && scriptUploadUrl) {
        const media = mediaRef.current
        if (media && !media.paused) {
          await handyService.hsspStop()
          const serverTime = handyService.getServerTime()
          const offset = settings.timeOffset || 0
          await handyService.hsspPlay(serverTime, Math.round(time * 1000) + offset)
        }
      }
    },
    [scriptUploadUrl, settings.timeOffset]
  )

  const handleTimeUpdate = useCallback((_time: number) => {}, [])

  // Keyboard shortcuts for settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Handle drag and drop
  useEffect(() => {
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      const file = files[0]
      const mediaType = getMediaTypeFromPath(file.name)
      if (mediaType) {
        const path = window.electronAPI.getDroppedFilePath(file) || (file as any).path as string
        if (path) {
          await openMediaFile(path, mediaType)
        }
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

  // Load default folder on startup
  useEffect(() => {
    if (settings.defaultVideoFolder) {
      window.electronAPI.readDir(settings.defaultVideoFolder).then(setFiles)
    }
  }, [])

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
          handyConnected={handyConnected}
          onHandyConnect={handleHandyConnect}
          onHandyDisconnect={handleHandyDisconnect}
          scriptFolder={settings.scriptFolder}
        />
        <VideoPlayer
          videoUrl={videoUrl}
          mediaType={currentFileType}
          currentFileName={currentFile ? getFileName(currentFile) : null}
          artworkUrl={artworkUrl}
          actions={actions}
          subtitleCues={subtitleCues}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          mediaRef={mediaRef}
          handyInfo={handyConnected ? { connected: true, ping: handyService.ping, uploadStatus: handyUploadStatus } : { connected: false, ping: null, uploadStatus: 'idle' as const }}
          defaultShowHeatmap={settings.showHeatmapByDefault}
          defaultShowTimeline={settings.showTimelineByDefault}
          timelineHeight={settings.timelineHeight}
          timelineWindow={settings.timelineWindow}
          speedColors={settings.speedColors}
          subtitleFontSize={settings.subtitleFontSize}
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
