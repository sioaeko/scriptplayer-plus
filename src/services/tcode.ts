import { FunscriptAction, ScriptAxisId } from '../types'
import { getPositionAtTime } from './funscript'
import { getDefaultAxisValue } from './multiaxis'

export type AxisActionMap = Partial<Record<ScriptAxisId, FunscriptAction[]>>

export const TCODE_AXIS_ORDER: ScriptAxisId[] = ['L0', 'L1', 'L2', 'R0', 'R1', 'R2', 'V0', 'V1', 'A0', 'A1', 'A2']
export const OSR_SERIAL_AXIS_ORDER: ScriptAxisId[] = ['L0', 'L1', 'L2', 'R0', 'R1', 'R2']

export interface TCodeAxisOutputOptions {
  invert?: boolean
  min?: number
  max?: number
}

export function getAxisValueAtTime(axisId: ScriptAxisId, actionMap: AxisActionMap, timeMs: number): number {
  const actions = actionMap[axisId]
  if (!actions || actions.length === 0) {
    return getDefaultAxisValue(axisId)
  }

  return getPositionAtTime(actions, timeMs) / 100
}

export function applyAxisMappingValue(
  axisId: ScriptAxisId,
  value: number,
  invertOrOptions: boolean | TCodeAxisOutputOptions = false
): number {
  const safeValue = Number.isFinite(value) ? value : getDefaultAxisValue(axisId)
  const options = typeof invertOrOptions === 'boolean'
    ? { invert: invertOrOptions }
    : invertOrOptions
  const mappedValue = options.invert ? 1 - safeValue : safeValue
  const min = clampPercent(options.min ?? 0)
  const max = clampPercent(options.max ?? 100)
  const rangeMin = Math.min(min, max)
  const rangeMax = Math.max(min, max)

  return (rangeMin + mappedValue * (rangeMax - rangeMin)) / 100
}

export function formatTCodeMagnitude(value: number): string {
  const clamped = Math.max(0, Math.min(0.9999, Number.isFinite(value) ? value : 0))
  const scaled = Math.min(9999, Math.max(0, Math.round(clamped * 10000)))
  return scaled.toString().padStart(4, '0')
}

export function buildTCodeAxisCommand(axisId: ScriptAxisId, value: number): string {
  return `${axisId}${formatTCodeMagnitude(value)}`
}

export function buildTCodeCommand(
  actionMap: AxisActionMap,
  timeMs: number,
  options?: {
    axisIds?: ScriptAxisId[]
    invertByAxis?: Partial<Record<ScriptAxisId, boolean>>
    axisOutputOptions?: Partial<Record<ScriptAxisId, TCodeAxisOutputOptions>>
    commandJoiner?: string
    intervalMs?: number
  }
): string | null {
  const axisIds = options?.axisIds ?? TCODE_AXIS_ORDER
  const invertByAxis = options?.invertByAxis ?? {}
  const axisOutputOptions = options?.axisOutputOptions ?? {}
  const commandJoiner = options?.commandJoiner ?? ' '
  const intervalSuffix = Number.isFinite(options?.intervalMs)
    ? `I${Math.max(0, Math.round(options?.intervalMs ?? 0))}`
    : ''

  if (axisIds.length === 0) return null

  const segments = axisIds.map((axisId) => buildTCodeAxisCommand(
    axisId,
    applyAxisMappingValue(
      axisId,
      getAxisValueAtTime(axisId, actionMap, timeMs),
      {
        ...axisOutputOptions[axisId],
        invert: axisOutputOptions[axisId]?.invert ?? invertByAxis[axisId] ?? false,
      }
    )
  ))

  return segments.length > 0 ? `${segments.join(commandJoiner)}${intervalSuffix}` : null
}

export function buildDefaultTCodeCommand(
  axisIds: ScriptAxisId[] = TCODE_AXIS_ORDER,
  options?: {
    invertByAxis?: Partial<Record<ScriptAxisId, boolean>>
    axisOutputOptions?: Partial<Record<ScriptAxisId, TCodeAxisOutputOptions>>
    commandJoiner?: string
    intervalMs?: number
  }
): string | null {
  return buildTCodeCommand({}, 0, {
    ...options,
    axisIds,
  })
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}
