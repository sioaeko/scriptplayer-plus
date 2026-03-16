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

export type MediaType = 'video' | 'audio'

export interface VideoFile {
  name: string
  path: string
  type: MediaType
  hasScript: boolean
  hasSubtitles: boolean
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

declare global {
  interface Window {
    electronAPI: {
      platform: string
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
      readFunscriptFile: (filePath: string) => Promise<Funscript | null>
      saveFunscript: (videoPath: string, data: string) => Promise<boolean>
      getVideoUrl: (filePath: string) => Promise<string>
      findArtwork: (mediaPath: string) => Promise<string | null>
      readSubtitles: (mediaPath: string) => Promise<SubtitleFile[]>
      readSubtitleFile: (filePath: string) => Promise<SubtitleFile | null>

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
