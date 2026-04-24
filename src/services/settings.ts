import { createDefaultShortcutBindings, normalizeShortcutBindings, ShortcutBindings } from './shortcuts'
import {
  normalizeNoScriptStrokePattern,
  normalizeNoScriptStrokePreset,
  NoScriptStrokePattern,
  NoScriptStrokePreset,
} from './noScriptStroke'

export const UI_SCALE_OPTIONS = [100, 115, 125, 140, 150] as const
export const MOTION_SPEED_LIMIT_MIN = 60
export const MOTION_SPEED_LIMIT_MAX = 360
export const MOTION_SPEED_LIMIT_STEP = 10
export const MOTION_SPEED_LIMIT_PRESETS = ['off', 'gentle', 'balanced', 'strong', 'custom'] as const
export const MOTION_SPEED_LIMIT_PRESET_VALUES: Record<Exclude<MotionSpeedLimitPreset, 'off' | 'custom'>, number> = {
  gentle: 160,
  balanced: 240,
  strong: 320,
}

export type UiScaleValue = typeof UI_SCALE_OPTIONS[number]
export type MotionSpeedLimitPreset = typeof MOTION_SPEED_LIMIT_PRESETS[number]

export interface AppSettings {
  // General
  language: string // 'en' | 'ko' | 'ja' | 'zh'
  defaultVideoFolder: string
  scriptFolder: string

  // Appearance
  theme: 'dark' // only dark for now
  alwaysOnTop: boolean
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
  motionSpeedLimitPreset: MotionSpeedLimitPreset
  motionSpeedLimitEnabled: boolean
  motionSpeedLimit: number // strokes/min, 60-360
  showScriptDebugInfo: boolean

  // Playback
  handyAutoPlayAfterSync: boolean
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
    alwaysOnTop: false,
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
    timeOffset: -200,
    motionSpeedLimitPreset: 'off',
    motionSpeedLimitEnabled: false,
    motionSpeedLimit: 240,
    showScriptDebugInfo: false,
    handyAutoPlayAfterSync: true,
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

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

function normalizeMotionSpeedLimit(value: unknown): number {
  const requested = Number(value)
  if (!Number.isFinite(requested)) {
    return createDefaultSettings().motionSpeedLimit
  }

  const stepped = Math.round(requested / MOTION_SPEED_LIMIT_STEP) * MOTION_SPEED_LIMIT_STEP
  return clampNumber(stepped, MOTION_SPEED_LIMIT_MIN, MOTION_SPEED_LIMIT_MAX)
}

function normalizeMotionSpeedLimitPreset(value: unknown): MotionSpeedLimitPreset | null {
  return MOTION_SPEED_LIMIT_PRESETS.includes(value as MotionSpeedLimitPreset)
    ? value as MotionSpeedLimitPreset
    : null
}

function inferMotionSpeedLimitPreset(enabled: boolean, limit: number): MotionSpeedLimitPreset {
  if (!enabled) {
    return 'off'
  }

  for (const [preset, presetLimit] of Object.entries(MOTION_SPEED_LIMIT_PRESET_VALUES)) {
    if (limit === presetLimit) {
      return preset as MotionSpeedLimitPreset
    }
  }

  return 'custom'
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultSettings()
    const parsed = JSON.parse(raw)
    const defaults = createDefaultSettings()
    const motionSpeedLimit = normalizeMotionSpeedLimit((parsed as { motionSpeedLimit?: unknown })?.motionSpeedLimit)
    const motionSpeedLimitEnabled = Boolean((parsed as { motionSpeedLimitEnabled?: unknown })?.motionSpeedLimitEnabled ?? defaults.motionSpeedLimitEnabled)
    const storedMotionSpeedLimitPreset = normalizeMotionSpeedLimitPreset((parsed as { motionSpeedLimitPreset?: unknown })?.motionSpeedLimitPreset)
    const motionSpeedLimitPreset = storedMotionSpeedLimitPreset ?? inferMotionSpeedLimitPreset(motionSpeedLimitEnabled, motionSpeedLimit)
    return {
      ...defaults,
      ...parsed,
      uiScale: normalizeUiScale((parsed as { uiScale?: unknown })?.uiScale),
      motionSpeedLimitPreset,
      motionSpeedLimitEnabled: motionSpeedLimitPreset !== 'off',
      motionSpeedLimit: motionSpeedLimitPreset in MOTION_SPEED_LIMIT_PRESET_VALUES
        ? MOTION_SPEED_LIMIT_PRESET_VALUES[motionSpeedLimitPreset as keyof typeof MOTION_SPEED_LIMIT_PRESET_VALUES]
        : motionSpeedLimit,
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
