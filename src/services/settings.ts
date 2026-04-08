import { createDefaultShortcutBindings, normalizeShortcutBindings, ShortcutBindings } from './shortcuts'
import {
  normalizeNoScriptStrokePattern,
  normalizeNoScriptStrokePreset,
  NoScriptStrokePattern,
  NoScriptStrokePreset,
} from './noScriptStroke'

export const UI_SCALE_OPTIONS = [100, 115, 125, 140, 150] as const

export type UiScaleValue = typeof UI_SCALE_OPTIONS[number]

export interface AppSettings {
  // General
  language: string // 'en' | 'ko' | 'ja' | 'zh'
  defaultVideoFolder: string
  scriptFolder: string

  // Appearance
  theme: 'dark' // only dark for now
  uiScale: UiScaleValue // percent
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
  noScriptRandomStrokeEnabled: boolean
  noScriptRandomMinSpeed: number // strokes/min, 30-240
  noScriptRandomMaxSpeed: number // strokes/min, 30-240
  noScriptRandomPreset: NoScriptStrokePreset
  noScriptRandomPattern: NoScriptStrokePattern
  autoSkipScriptGaps: boolean
  autoSkipGapMinDuration: number // seconds, 3-60
  autoSkipGapLeadIn: number // seconds, 0-5

  // Input
  keyboardShortcuts: ShortcutBindings
}

export const defaultSettings: AppSettings = createDefaultSettings()

function createDefaultSettings(): AppSettings {
  return {
    language: 'en',
    defaultVideoFolder: '',
    scriptFolder: '',
    theme: 'dark',
    uiScale: 100,
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
    noScriptRandomStrokeEnabled: false,
    noScriptRandomMinSpeed: 72,
    noScriptRandomMaxSpeed: 140,
    noScriptRandomPreset: 'natural',
    noScriptRandomPattern: 'random',
    autoSkipScriptGaps: false,
    autoSkipGapMinDuration: 10,
    autoSkipGapLeadIn: 1.5,
    keyboardShortcuts: createDefaultShortcutBindings(),
  }
}

const STORAGE_KEY = 'handycontrol-settings'

function normalizeUiScale(value: unknown): UiScaleValue {
  const requested = Number(value)
  if (!Number.isFinite(requested)) {
    return 100
  }
  const nearest = UI_SCALE_OPTIONS.reduce((best, option) => (
    Math.abs(option - requested) < Math.abs(best - requested) ? option : best
  ), UI_SCALE_OPTIONS[0])

  return nearest
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultSettings()
    const parsed = JSON.parse(raw)
    return {
      ...createDefaultSettings(),
      ...parsed,
      uiScale: normalizeUiScale((parsed as { uiScale?: unknown })?.uiScale),
      noScriptRandomPreset: normalizeNoScriptStrokePreset((parsed as { noScriptRandomPreset?: unknown })?.noScriptRandomPreset),
      noScriptRandomPattern: normalizeNoScriptStrokePattern((parsed as { noScriptRandomPattern?: unknown })?.noScriptRandomPattern),
      keyboardShortcuts: normalizeShortcutBindings((parsed as { keyboardShortcuts?: unknown })?.keyboardShortcuts),
    }
  } catch {
    return createDefaultSettings()
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage full or unavailable — silently ignore
  }
}
