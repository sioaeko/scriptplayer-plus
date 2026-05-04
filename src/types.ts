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

export interface ScriptVariantOption {
  path: string
  label: string
  axes: ScriptAxisId[]
  source: 'local' | 'scriptFolder'
  isDefault: boolean
}

export interface ScriptMediaMatchCandidate {
  path: string
  score: number
  sourcePriority: number
}

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
  autoScriptPath?: string
  scriptAxes: ScriptAxisId[]
  hasSubtitles: boolean
  modifiedAt: number
  relativePath?: string
}

export interface HandyStatus {
  connected: boolean
  firmware: string
  mode: number
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
      writeClipboardText: (text: string) => Promise<boolean>
      showItemInFolder: (filePath: string) => Promise<boolean>
      openExternal: (url: string) => Promise<boolean>
      minimize: () => void
      maximize: () => void
      close: () => void
      setAlwaysOnTop: (enabled: boolean) => Promise<boolean>
      openVideo: () => Promise<string | null>
      openMediaFiles: () => Promise<string[]>
      openFolder: () => Promise<string | null>
      openScriptFile: () => Promise<string | null>
      openSubtitleFile: () => Promise<string | null>
      openPlaylistFile: () => Promise<{ path: string; content: string } | null>
      savePlaylistFile: (defaultName: string, content: string) => Promise<string | null>
      getDroppedFilePath: (file: File) => string
      readDir: (path: string, scriptFolder?: string) => Promise<VideoFile[]>
      inspectMediaFiles: (paths: string[], scriptFolder?: string) => Promise<VideoFile[]>
      readFunscript: (videoPath: string, scriptFolder?: string) => Promise<Funscript | null>
      readFunscriptBundle: (videoPath: string, scriptFolder?: string, preferredScriptPath?: string) => Promise<FunscriptBundle | null>
      listScriptVariants: (videoPath: string, scriptFolder?: string) => Promise<ScriptVariantOption[]>
      findMediaForScript: (
        scriptPath: string,
        candidateMediaPaths?: string[],
        preferredMediaPath?: string
      ) => Promise<string | null>
      listMediaMatchesForScript: (
        scriptPath: string,
        candidateMediaPaths?: string[],
        preferredMediaPath?: string
      ) => Promise<ScriptMediaMatchCandidate[]>
      readFunscriptFile: (filePath: string) => Promise<Funscript | null>
      saveFunscript: (videoPath: string, data: string) => Promise<boolean>
      readSegmentRepeatStore: (scriptFolder: string) => Promise<{ ok: boolean; exists: boolean; path?: string; content?: string; error?: string }>
      writeSegmentRepeatStore: (scriptFolder: string, content: string) => Promise<{ ok: boolean; path?: string; error?: string }>
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
    }
  }
}
