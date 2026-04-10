export interface FunscriptAction {
  at: number  // milliseconds
  pos: number // 0-100
}

export interface Funscript {
  version: string
  inverted: boolean
  range: number
  actions: FunscriptAction[]
  metadata?: {
    creator?: string
    description?: string
    duration?: number
    license?: string
    notes?: string
    performers?: string[]
    script_url?: string
    tags?: string[]
    title?: string
    type?: string
    video_url?: string
  }
}

export type ScriptAxisId = 'L0' | 'L1' | 'L2' | 'R0' | 'R1' | 'R2' | 'V0' | 'V1' | 'A0' | 'A1' | 'A2'

export interface FunscriptBundle {
  primaryAxis: ScriptAxisId | null
  scripts: Partial<Record<ScriptAxisId, Funscript>>
  sources: Partial<Record<ScriptAxisId, string>>
}

export type MediaType = 'video' | 'audio'
export type PlaybackMode = 'none' | 'sequential' | 'shuffle'

export interface VideoFile {
  name: string
  path: string
  type: MediaType
  hasScript: boolean
  hasSubtitles: boolean
  modifiedAt: number
  relativePath?: string
}

export interface HandyStatus {
  connected: boolean
  firmware: string
  mode: number
}

export interface PlaylistItem {
  path: string
  title: string
  duration: number
}

export interface EroScriptResult {
  title: string
  url: string
  creator: string
  date: string
}

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

export interface SubtitleFile {
  path: string
  content: string
}

export type OsrSerialConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface OsrSerialPortInfo {
  path: string
  displayName: string
  manufacturer: string | null
  serialNumber: string | null
  vendorId: string | null
  productId: string | null
  pnpId: string | null
}

export interface OsrSerialState {
  connectionState: OsrSerialConnectionState
  connectedPortPath: string | null
  baudRate: number
  error: string | null
}

declare global {
  interface Window {
    electronAPI: {
      platform: string
      versions: {
        electron: string
        chrome: string
        node: string
      }
      setZoomFactor: (factor: number) => void
      minimize: () => void
      maximize: () => void
      close: () => void
      openVideo: () => Promise<string | null>
      openFolder: () => Promise<string | null>
      openScriptFile: () => Promise<string | null>
      openSubtitleFile: () => Promise<string | null>
      getDroppedFilePath: (file: File) => string
      readDir: (path: string) => Promise<VideoFile[]>
      readFunscript: (videoPath: string, scriptFolder?: string) => Promise<Funscript | null>
      readFunscriptBundle: (videoPath: string, scriptFolder?: string, preferredScriptPath?: string) => Promise<FunscriptBundle | null>
      readFunscriptFile: (filePath: string) => Promise<Funscript | null>
      listFunscriptVariants: (videoPath: string, scriptFolder?: string) => Promise<Array<{ path: string; label: string }>>
      saveFunscript: (videoPath: string, data: string) => Promise<boolean>
      getVideoUrl: (filePath: string) => Promise<string>
      findArtwork: (mediaPath: string) => Promise<string | null>
      readSubtitles: (mediaPath: string) => Promise<SubtitleFile[]>
      readSubtitleFile: (filePath: string) => Promise<SubtitleFile | null>

      // Direct serial / COM port
      osrSerialListPorts: () => Promise<OsrSerialPortInfo[]>
      osrSerialGetState: () => Promise<OsrSerialState>
      osrSerialConnect: (path: string, baudRate?: number) => Promise<OsrSerialState>
      osrSerialDisconnect: () => Promise<OsrSerialState>
      osrSerialWrite: (command: string) => Promise<boolean>
      osrSerialOnStateChange: (listener: (state: OsrSerialState) => void) => () => void

      // EroScripts
      eroscriptsCheckSession: () => Promise<{ loggedIn: boolean; username: string }>
      eroscriptsLogin: () => Promise<{ success: boolean; username: string; cookies: string }>
      eroscriptsLogout: () => Promise<boolean>
      eroscriptsFetch: (url: string) => Promise<{ ok: boolean; data: any; error?: string }>
      eroscriptsDownload: (url: string, scriptFolder?: string, saveName?: string) => Promise<{ ok: boolean; path?: string; content?: string; error?: string }>
      eroscriptsGetCookies: () => Promise<string>

      // Playlist
      playlistOpen: () => Promise<PlaylistItem[] | null>
      playlistSaveDialog: (defaultName?: string) => Promise<string | null>
      playlistWrite: (filePath: string, content: string) => Promise<boolean>
    }
  }
}
