import { ScriptAxisId } from '../types'
import { ButtplugDevice, ButtplugDeviceFrame, ButtplugFeature } from './buttplug'
import { getScriptAxisDefinition, SCRIPT_AXIS_IDS } from './multiaxis'
import {
  applyAxisMappingValue,
  AxisActionMap,
  buildTCodeAxisCommand as formatTCodeAxisCommand,
  getAxisValueAtTime,
  TCODE_AXIS_ORDER,
} from './tcode'

export type ButtplugFeatureMapping = {
  axisId: ScriptAxisId | ''
  invert: boolean
}

export type ButtplugTransportCommand = {
  frame: ButtplugDeviceFrame
  rawTCode: string | null
}

export type { AxisActionMap } from './tcode'

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

export function isButtplugFeatureAxisCompatible(feature: ButtplugFeature, axisId: ScriptAxisId): boolean {
  const axisKind = getScriptAxisDefinition(axisId).kind
  return feature.type === axisKind
}

export function getCompatibleButtplugAxisIds(feature: ButtplugFeature, axisIds: ScriptAxisId[]): ScriptAxisId[] {
  return axisIds.filter((axisId) => isButtplugFeatureAxisCompatible(feature, axisId))
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
    const axisId = stored?.axisId ?? guessScriptAxisForFeature(feature)
    next[feature.id] = {
      axisId: axisId && isButtplugFeatureAxisCompatible(feature, axisId) ? axisId : '',
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

    if (
      !mappedAxisId
      || !isButtplugFeatureAxisCompatible(feature, mappedAxisId)
      || !hasAxisActions(actionMap, mappedAxisId)
    ) {
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
    if (mapping.axisId && hasAxisActions(actionMap, mapping.axisId)) {
      axisIds.add(mapping.axisId)
    }
  }

  return TCODE_AXIS_ORDER.filter((axisId) => axisIds.has(axisId))
}

function hasAxisActions(actionMap: AxisActionMap, axisId: ScriptAxisId): boolean {
  return Boolean(actionMap[axisId]?.length)
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
  return formatTCodeAxisCommand(axisId, value)
}
