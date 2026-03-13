import { useState, useRef, useCallback, useEffect } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import VideoPlayer from './components/VideoPlayer'
import Settings from './components/Settings'
import { VideoFile, Funscript, FunscriptAction, MediaType } from './types'
import { parseFunscript } from './services/funscript'
import { handyService, HandyUploadStatus } from './services/handy'
import { AppSettings, loadSettings, saveSettings } from './services/settings'
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
  const [handyConnected, setHandyConnected] = useState(false)
  const [scriptUploadUrl, setScriptUploadUrl] = useState<string | null>(null)
  const [handyUploadStatus, setHandyUploadStatus] = useState<HandyUploadStatus>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const mediaRef = useRef<HTMLMediaElement | null>(null)

  const actions: FunscriptAction[] = funscript?.actions || []

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

    const url = await window.electronAPI.getVideoUrl(filePath)
    setVideoUrl(url)
    setArtworkUrl(null)

    if (resolvedType === 'audio') {
      const artworkPath = await window.electronAPI.findArtwork(filePath)
      if (artworkPath) {
        const nextArtworkUrl = await window.electronAPI.getVideoUrl(artworkPath)
        setArtworkUrl(nextArtworkUrl)
      }
    }

    const script = await window.electronAPI.readFunscript(filePath, settings.scriptFolder)
    const parsed = script ? parseFunscript(script) : null
    setFunscript(parsed)
    setScriptUploadUrl(null)

    if (parsed && handyService.isConnected) {
      uploadToHandy(parsed.actions)
    }
  }, [settings.scriptFolder])

  const handleFileSelect = useCallback(async (file: VideoFile) => {
    await openMediaFile(file.path, file.type)
  }, [openMediaFile])

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
        const path = (file as any).path as string
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
          files={files}
          currentFile={currentFile}
          onFileSelect={handleFileSelect}
          onOpenFolder={handleOpenFolder}
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
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          mediaRef={mediaRef}
          handyInfo={handyConnected ? { connected: true, ping: handyService.ping, uploadStatus: handyUploadStatus } : { connected: false, ping: null, uploadStatus: 'idle' as const }}
          timelineHeight={settings.timelineHeight}
          timelineWindow={settings.timelineWindow}
          speedColors={settings.speedColors}
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
