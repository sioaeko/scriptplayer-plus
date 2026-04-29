import { ScriptAxisId } from '../types'
import { OSR_SERIAL_AXIS_ORDER, TCodeAxisOutputOptions } from './tcode'

export type OsrSerialProfile = 'funosrPro' | 'sr1' | 'sr6' | 'custom'

export interface OsrSerialAxisConfig {
  enabled: boolean
  invert: boolean
  min: number
  max: number
}

export type OsrSerialAxisConfigMap = Partial<Record<ScriptAxisId, OsrSerialAxisConfig>>

export const OSR_SERIAL_PROFILES: OsrSerialProfile[] = ['funosrPro', 'sr6', 'sr1', 'custom']

export function normalizeOsrSerialProfile(value: unknown): OsrSerialProfile {
  return value === 'funosrPro' || value === 'sr1' || value === 'custom' ? value : 'sr6'
}

export function createDefaultOsrSerialAxisConfigs(): OsrSerialAxisConfigMap {
  return OSR_SERIAL_AXIS_ORDER.reduce((next, axisId) => {
    next[axisId] = {
      enabled: true,
      invert: false,
      min: 0,
      max: 100,
    }
    return next
  }, {} as OsrSerialAxisConfigMap)
}

export function normalizeOsrSerialAxisConfigs(raw: unknown): OsrSerialAxisConfigMap {
  const defaults = createDefaultOsrSerialAxisConfigs()
  if (!raw || typeof raw !== 'object') {
    return defaults
  }

  const source = raw as Partial<Record<ScriptAxisId, Partial<OsrSerialAxisConfig>>>
  for (const axisId of OSR_SERIAL_AXIS_ORDER) {
    const config = source[axisId]
    if (!config || typeof config !== 'object') {
      continue
    }

    defaults[axisId] = {
      enabled: typeof config.enabled === 'boolean' ? config.enabled : defaults[axisId]?.enabled ?? true,
      invert: typeof config.invert === 'boolean' ? config.invert : defaults[axisId]?.invert ?? false,
      min: clampPercent(typeof config.min === 'number' ? config.min : defaults[axisId]?.min ?? 0),
      max: clampPercent(typeof config.max === 'number' ? config.max : defaults[axisId]?.max ?? 100),
    }
  }

  return defaults
}

export function getOsrSerialProfileAxisIds(
  profile: OsrSerialProfile,
  configs: OsrSerialAxisConfigMap
): ScriptAxisId[] {
  if (profile === 'sr1') {
    return ['L0']
  }

  if (profile === 'funosrPro' || profile === 'sr6') {
    return [...OSR_SERIAL_AXIS_ORDER]
  }

  const enabledAxes = OSR_SERIAL_AXIS_ORDER.filter((axisId) => configs[axisId]?.enabled)
  return enabledAxes.length > 0 ? enabledAxes : ['L0']
}

export function getOsrSerialTCodeAxisOptions(
  configs: OsrSerialAxisConfigMap
): Partial<Record<ScriptAxisId, TCodeAxisOutputOptions>> {
  const options: Partial<Record<ScriptAxisId, TCodeAxisOutputOptions>> = {}

  for (const axisId of OSR_SERIAL_AXIS_ORDER) {
    const config = configs[axisId] ?? { enabled: true, invert: false, min: 0, max: 100 }
    options[axisId] = {
      invert: config.invert,
      min: config.min,
      max: config.max,
    }
  }

  return options
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0))
}
