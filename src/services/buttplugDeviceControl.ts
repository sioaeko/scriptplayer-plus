import { FunscriptAction, ScriptAxisId } from '../types'
import { getPositionAtTime } from './funscript'
import { ButtplugDevice, ButtplugDeviceFrame, ButtplugFeature } from './buttplug'
import { getDefaultAxisValue, SCRIPT_AXIS_IDS } from './multiaxis'

export type AxisActionMap = Partial<Record<ScriptAxisId, FunscriptAction[]>>

export type ButtplugFeatureMapping = {
  axisId: ScriptAxisId | ''
  invert: boolean
}

export type ButtplugTransportCommand = {
  frame: ButtplugDeviceFrame
  rawTCode: string | null
}

const TCODE_AXIS_ORDER: ScriptAxisId[] = ['L0', 'L1', 'L2', 'R0', 'R1', 'R2', 'V0', 'V1', 'A0', 'A1', 'A2']

export function buildButtplugDeviceSignature(device: ButtplugDevice): string {
  const featureSignature = device.features
    .map((feature) => `${feature.type}:${feature.index}:${feature.descriptor}:${feature.actuatorType || ''}`)
    .join('|')
  const rawSignature = [...device.rawWriteEndpoints].sort().join(',')

  return `${device.name}|${device.displayName}|${featureSignature}|raw:${rawSignature}`
}

export function getButtplugFeatureStorageKey(deviceSignature: string, featureId: string): string {
  return `${deviceSignature}::${featureId}`
}

export function guessScriptAxisForFeature(feature: ButtplugFeature): ScriptAxisId | '' {
  const text = `${feature.descriptor} ${feature.actuatorType || ''}`.toLowerCase()

  if (feature.type === 'linear') {
    if (text.includes('stroke') || text.includes('stroker') || text.includes('thrust')) return 'L0'
    if (text.includes('surge') || text.includes('forward') || text.includes('back')) return 'L1'
    if (text.includes('sway') || text.includes('left') || text.includes('right')) return 'L2'
    if (feature.index === 0) return 'L0'
    if (feature.index === 1) return 'L1'
    if (feature.index === 2) return 'L2'
  }

  if (feature.type === 'rotate') {
    if (text.includes('twist')) return 'R0'
    if (text.includes('roll')) return 'R1'
    if (text.includes('pitch')) return 'R2'
    if (feature.index === 0) return 'R0'
    if (feature.index === 1) return 'R1'
    if (feature.index === 2) return 'R2'
  }

  if (feature.type === 'scalar') {
    if (text.includes('vibe') || text.includes('vibrate')) return feature.index === 0 ? 'V0' : 'V1'
    if (text.includes('pump')) return 'V1'
    if (text.includes('valve')) return 'A0'
    if (text.includes('suck') || text.includes('suction')) return 'A1'
    if (text.includes('lube')) return 'A2'
  }

  return ''
}

export function buildFeatureMappingsForDevice(
  device: ButtplugDevice | null,
  mappingStore: Record<string, ButtplugFeatureMapping>
): Record<string, ButtplugFeatureMapping> {
  if (!device) return {}

  const deviceSignature = buildButtplugDeviceSignature(device)
  const next: Record<string, ButtplugFeatureMapping> = {}

  for (const feature of device.features) {
    const key = getButtplugFeatureStorageKey(deviceSignature, feature.id)
    const stored = mappingStore[key]
    next[feature.id] = {
      axisId: stored?.axisId ?? guessScriptAxisForFeature(feature),
      invert: stored?.invert ?? false,
    }
  }

  return next
}

export function buildButtplugTransportCommand(
  device: ButtplugDevice,
  mappings: Record<string, ButtplugFeatureMapping>,
  actionMap: AxisActionMap,
  currentTimeMs: number,
  targetTimeMs: number,
  intervalMs: number
): ButtplugTransportCommand {
  return {
    frame: buildButtplugFrame(device, mappings, actionMap, currentTimeMs, targetTimeMs, intervalMs),
    rawTCode: buildRawTCodeCommand(device, mappings, actionMap, targetTimeMs),
  }
}

function getAxisValueAtTime(axisId: ScriptAxisId, actionMap: AxisActionMap, timeMs: number): number {
  const actions = actionMap[axisId]
  if (!actions || actions.length === 0) {
    return getDefaultAxisValue(axisId)
  }

  return getPositionAtTime(actions, timeMs) / 100
}

function applyAxisMappingValue(axisId: ScriptAxisId, value: number, invert: boolean): number {
  const safeValue = Number.isFinite(value) ? value : getDefaultAxisValue(axisId)
  return invert ? 1 - safeValue : safeValue
}

function buildButtplugFrame(
  device: ButtplugDevice,
  mappings: Record<string, ButtplugFeatureMapping>,
  actionMap: AxisActionMap,
  currentTimeMs: number,
  targetTimeMs: number,
  intervalMs: number
): ButtplugDeviceFrame {
  const frame: ButtplugDeviceFrame = {
    linear: [],
    rotate: [],
    scalar: [],
  }

  for (const feature of device.features) {
    const mapping = mappings[feature.id]
    const mappedAxisId = mapping?.axisId

    if (!mappedAxisId) {
      if (feature.type === 'linear') {
        frame.linear?.push({ index: feature.index, position: 0.5, duration: intervalMs })
      } else if (feature.type === 'rotate') {
        frame.rotate?.push({ index: feature.index, speed: 0, clockwise: true })
      } else if (feature.type === 'scalar' && feature.actuatorType) {
        frame.scalar?.push({ index: feature.index, scalar: 0, actuatorType: feature.actuatorType })
      }
      continue
    }

    const currentValue = applyAxisMappingValue(
      mappedAxisId,
      getAxisValueAtTime(mappedAxisId, actionMap, currentTimeMs),
      mapping?.invert ?? false
    )
    const targetValue = applyAxisMappingValue(
      mappedAxisId,
      getAxisValueAtTime(mappedAxisId, actionMap, targetTimeMs),
      mapping?.invert ?? false
    )

    if (feature.type === 'linear') {
      frame.linear?.push({ index: feature.index, position: targetValue, duration: intervalMs })
      continue
    }

    if (feature.type === 'rotate') {
      const delta = targetValue - currentValue
      frame.rotate?.push({
        index: feature.index,
        speed: Math.min(1, Math.abs(delta) * 1000 / Math.max(intervalMs, 1)),
        clockwise: delta >= 0,
      })
      continue
    }

    if (feature.type === 'scalar' && feature.actuatorType) {
      frame.scalar?.push({ index: feature.index, scalar: targetValue, actuatorType: feature.actuatorType })
    }
  }

  return {
    linear: frame.linear && frame.linear.length > 0 ? frame.linear : undefined,
    rotate: frame.rotate && frame.rotate.length > 0 ? frame.rotate : undefined,
    scalar: frame.scalar && frame.scalar.length > 0 ? frame.scalar : undefined,
  }
}

function buildRawTCodeCommand(
  device: ButtplugDevice,
  mappings: Record<string, ButtplugFeatureMapping>,
  actionMap: AxisActionMap,
  timeMs: number
): string | null {
  if (device.rawWriteEndpoints.length === 0) return null

  const axisIds = collectRawTCodeAxisIds(actionMap, mappings)
  if (!shouldPreferRawTCode(axisIds)) return null

  const inversionByAxis = deriveAxisInversionMap(mappings)
  const segments = axisIds.map((axisId) => buildTCodeAxisCommand(
    axisId,
    applyAxisMappingValue(
      axisId,
      getAxisValueAtTime(axisId, actionMap, timeMs),
      inversionByAxis[axisId] ?? false
    )
  ))

  return segments.length > 0 ? segments.join(' ') : null
}

function collectRawTCodeAxisIds(
  actionMap: AxisActionMap,
  mappings: Record<string, ButtplugFeatureMapping>
): ScriptAxisId[] {
  const axisIds = new Set<ScriptAxisId>()

  for (const axisId of SCRIPT_AXIS_IDS) {
    if (actionMap[axisId]?.length) {
      axisIds.add(axisId)
    }
  }

  for (const mapping of Object.values(mappings)) {
    if (mapping.axisId) {
      axisIds.add(mapping.axisId)
    }
  }

  return TCODE_AXIS_ORDER.filter((axisId) => axisIds.has(axisId))
}

function shouldPreferRawTCode(axisIds: ScriptAxisId[]): boolean {
  if (axisIds.length >= 2) return true
  return axisIds.some((axisId) => axisId !== 'L0' && axisId !== 'V0')
}

function deriveAxisInversionMap(
  mappings: Record<string, ButtplugFeatureMapping>
): Partial<Record<ScriptAxisId, boolean>> {
  const inversionByAxis = new Map<ScriptAxisId, boolean>()
  const conflicts = new Set<ScriptAxisId>()

  for (const mapping of Object.values(mappings)) {
    if (!mapping.axisId) continue

    const existing = inversionByAxis.get(mapping.axisId)
    if (existing === undefined) {
      inversionByAxis.set(mapping.axisId, mapping.invert)
      continue
    }

    if (existing !== mapping.invert) {
      conflicts.add(mapping.axisId)
    }
  }

  const next: Partial<Record<ScriptAxisId, boolean>> = {}
  for (const axisId of TCODE_AXIS_ORDER) {
    if (conflicts.has(axisId)) continue
    const invert = inversionByAxis.get(axisId)
    if (invert !== undefined) {
      next[axisId] = invert
    }
  }

  return next
}

function buildTCodeAxisCommand(axisId: ScriptAxisId, value: number): string {
  return `${axisId}${formatTCodeMagnitude(value)}`
}

function formatTCodeMagnitude(value: number): string {
  const clamped = Math.max(0, Math.min(0.9999, Number.isFinite(value) ? value : 0))
  const scaled = Math.min(9999, Math.max(0, Math.round(clamped * 10000)))
  return scaled.toString().padStart(4, '0')
}
