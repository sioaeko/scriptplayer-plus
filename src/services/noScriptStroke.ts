import { Funscript, FunscriptAction } from '../types'

export interface NoScriptStrokeOptions {
  minStrokesPerMinute: number
  maxStrokesPerMinute: number
}

const MIN_STROKES_PER_MINUTE = 30
const MAX_STROKES_PER_MINUTE = 240
const MIN_HALF_STROKE_MS = 90
const MAX_HALF_STROKE_MS = 1500

export function buildNoScriptRandomFunscript(
  durationMs: number,
  seedSource: string,
  options: NoScriptStrokeOptions
): Funscript | null {
  const normalizedDurationMs = Math.max(0, Math.round(durationMs))
  if (!Number.isFinite(normalizedDurationMs) || normalizedDurationMs < 250) {
    return null
  }

  const minSpm = clampRate(Math.min(options.minStrokesPerMinute, options.maxStrokesPerMinute))
  const maxSpm = clampRate(Math.max(options.minStrokesPerMinute, options.maxStrokesPerMinute))
  const random = mulberry32(hashString(`${seedSource}|${minSpm}|${maxSpm}`))

  const actions: FunscriptAction[] = [{ at: 0, pos: 50 }]
  let nextTimeMs = 0
  let nextHigh = random() >= 0.5

  while (nextTimeMs < normalizedDurationMs) {
    const strokesPerMinute = lerp(minSpm, maxSpm, random())
    const halfStrokeMs = clampNumber(
      60000 / Math.max(strokesPerMinute * 2, 1),
      MIN_HALF_STROKE_MS,
      MAX_HALF_STROKE_MS
    )
    const durationJitter = lerp(0.88, 1.18, random())

    nextTimeMs += Math.max(MIN_HALF_STROKE_MS, Math.round(halfStrokeMs * durationJitter))

    if (random() < 0.16) {
      nextTimeMs += Math.round(lerp(80, 320, random()))
    }

    const position = nextHigh
      ? Math.round(lerp(74, 98, random()))
      : Math.round(lerp(2, 26, random()))

    const clampedTime = Math.min(nextTimeMs, normalizedDurationMs)
    const previous = actions[actions.length - 1]

    if (clampedTime > previous.at) {
      actions.push({ at: clampedTime, pos: position })
    }

    nextHigh = !nextHigh
  }

  const lastAction = actions[actions.length - 1]
  if (lastAction.at < normalizedDurationMs) {
    actions.push({
      at: normalizedDurationMs,
      pos: lastAction.pos,
    })
  }

  return {
    version: '1.0',
    inverted: false,
    range: 100,
    actions,
    metadata: {
      creator: 'ScriptPlayer+',
      description: 'Generated random stroke fallback for media without a script.',
      duration: normalizedDurationMs / 1000,
      notes: 'Synthetic random stroke track',
      title: 'Random Stroke Fallback',
      type: 'generated',
    },
  }
}

function clampRate(value: number): number {
  return clampNumber(value, MIN_STROKES_PER_MINUTE, MAX_STROKES_PER_MINUTE)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t
}

function hashString(input: string): number {
  let hash = 1779033703 ^ input.length
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353)
    hash = (hash << 13) | (hash >>> 19)
  }

  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
  return (hash ^ (hash >>> 16)) >>> 0
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6D2B79F5
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
