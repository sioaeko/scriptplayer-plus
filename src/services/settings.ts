export interface AppSettings {
  // General
  language: string // 'en' | 'ko' | 'ja' | 'zh'
  defaultVideoFolder: string
  scriptFolder: string

  // Appearance
  theme: 'dark' // only dark for now
  subtitleFontSize: number // px, 14-32

  // Timeline
  showHeatmapByDefault: boolean
  showTimelineByDefault: boolean
  timelineHeight: number // px, 40-120
  timelineWindow: number // seconds, 5-30
  speedColors: boolean

  // Device
  strokeRangeMin: number // 0-100
  strokeRangeMax: number // 0-100
  invertStroke: boolean
  timeOffset: number // ms, -500 to 500

  // Playback
  autoSkipScriptGaps: boolean
  autoSkipGapMinDuration: number // seconds, 3-60
  autoSkipGapLeadIn: number // seconds, 0-5
}

export const defaultSettings: AppSettings = {
  language: 'en',
  defaultVideoFolder: '',
  scriptFolder: '',
  theme: 'dark',
  subtitleFontSize: 20,
  showHeatmapByDefault: false,
  showTimelineByDefault: false,
  timelineHeight: 64,
  timelineWindow: 10,
  speedColors: true,
  strokeRangeMin: 0,
  strokeRangeMax: 100,
  invertStroke: false,
  timeOffset: 0,
  autoSkipScriptGaps: false,
  autoSkipGapMinDuration: 10,
  autoSkipGapLeadIn: 1.5,
}

const STORAGE_KEY = 'handycontrol-settings'

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultSettings }
    const parsed = JSON.parse(raw)
    return { ...defaultSettings, ...parsed }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage full or unavailable — silently ignore
  }
}
