import { Funscript, FunscriptAction } from '../types'

export const NO_SCRIPT_STROKE_PATTERNS = ['random', 'steady', 'wave', 'burst', 'tease'] as const
export type NoScriptStrokePattern = (typeof NO_SCRIPT_STROKE_PATTERNS)[number]

export const NO_SCRIPT_STROKE_PRESETS = ['natural', 'gentle', 'intense', 'edging', 'custom'] as const
export type NoScriptStrokePreset = (typeof NO_SCRIPT_STROKE_PRESETS)[number]

export interface NoScriptStrokeOptions {
  minStrokesPerMinute: number
  maxStrokesPerMinute: number
  preset: NoScriptStrokePreset
  pattern: NoScriptStrokePattern
}

interface NoScriptStrokeProfile {
  pattern: NoScriptStrokePattern
  speedBiasExponent: number
  minSpan: number
  maxSpan: number
  jitterMin: number
  jitterMax: number
  pauseChance: number
  pauseMinMs: number
  pauseMaxMs: number
  holdChance: number
  holdMinMs: number
  holdMaxMs: number
  waveCycleMinSteps: number
  waveCycleMaxSteps: number
  burstChance: number
  burstMinSteps: number
  burstMaxSteps: number
  burstSpeedMultiplier: number
  burstSpanMultiplier: number
  teaseMidpointChance: number
}

const MIN_STROKES_PER_MINUTE = 30
const MAX_STROKES_PER_MINUTE = 240
const MIN_HALF_STROKE_MS = 90
const MAX_HALF_STROKE_MS = 1500

export function normalizeNoScriptStrokePreset(raw: unknown): NoScriptStrokePreset {
  return typeof raw === 'string' && NO_SCRIPT_STROKE_PRESETS.includes(raw as NoScriptStrokePreset)
    ? raw as NoScriptStrokePreset
    : 'natural'
}

export function normalizeNoScriptStrokePattern(raw: unknown): NoScriptStrokePattern {
  return typeof raw === 'string' && NO_SCRIPT_STROKE_PATTERNS.includes(raw as NoScriptStrokePattern)
    ? raw as NoScriptStrokePattern
    : 'random'
}

export function getNoScriptStrokePatternForPreset(
  preset: NoScriptStrokePreset,
  customPattern: NoScriptStrokePattern = 'random'
): NoScriptStrokePattern {
  switch (preset) {
    case 'gentle':
      return 'steady'
    case 'intense':
      return 'burst'
    case 'edging':
      return 'tease'
    case 'custom':
      return customPattern
    case 'natural':
    default:
      return 'random'
  }
}

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
  const preset = normalizeNoScriptStrokePreset(options.preset)
  const pattern = getNoScriptStrokePatternForPreset(preset, normalizeNoScriptStrokePattern(options.pattern))
  const profile = resolveNoScriptStrokeProfile(preset, pattern)
  const random = mulberry32(hashString(`${seedSource}|${minSpm}|${maxSpm}|${preset}|${pattern}`))

  const actions: FunscriptAction[] = [{ at: 0, pos: 50 }]
  let nextTimeMs = 0
  let nextHigh = random() >= 0.5
  let stepIndex = 0
  let activeBurstSteps = 0
  let steadyAnchorSpm = lerp(minSpm, maxSpm, sampleBiasedUnit(random, profile.speedBiasExponent))
  let waveCycleSteps = randomInt(profile.waveCycleMinSteps, profile.waveCycleMaxSteps, random)

  while (nextTimeMs < normalizedDurationMs) {
    let strokesPerMinute = lerp(minSpm, maxSpm, sampleBiasedUnit(random, profile.speedBiasExponent))
    let span = lerp(profile.minSpan, profile.maxSpan, random())
    let durationJitter = lerp(profile.jitterMin, profile.jitterMax, random())
    let pauseChance = profile.pauseChance
    let holdChance = profile.holdChance

    switch (profile.pattern) {
      case 'steady':
        if (stepIndex === 0 || stepIndex % 6 === 0) {
          const targetRate = lerp(minSpm, maxSpm, sampleBiasedUnit(random, profile.speedBiasExponent))
          steadyAnchorSpm = clampRate(lerp(steadyAnchorSpm, targetRate, stepIndex === 0 ? 1 : 0.35))
        }
        strokesPerMinute = clampRate(steadyAnchorSpm * lerp(0.97, 1.03, random()))
        span = clampNumber(span * lerp(0.92, 1.04, random()), 10, 48)
        durationJitter = lerp(0.97, 1.04, random())
        pauseChance *= 0.4
        break
      case 'wave': {
        const cycleIndex = stepIndex % Math.max(waveCycleSteps, 1)
        const waveProgress = cycleIndex / Math.max(waveCycleSteps - 1, 1)
        const waveShape = (1 - Math.cos(waveProgress * Math.PI * 2)) / 2
        const waveT = clampNumber(0.12 + waveShape * 0.78 + random() * 0.1, 0, 1)
        strokesPerMinute = lerp(minSpm, maxSpm, waveT)
        span = lerp(profile.minSpan, profile.maxSpan, clampNumber(waveShape * 0.84 + random() * 0.16, 0, 1))
        durationJitter = lerp(0.94, 1.08, random())
        pauseChance *= 0.7

        if ((stepIndex + 1) % Math.max(waveCycleSteps, 1) === 0) {
          waveCycleSteps = randomInt(profile.waveCycleMinSteps, profile.waveCycleMaxSteps, random)
        }
        break
      }
      case 'burst': {
        if (activeBurstSteps <= 0 && random() < profile.burstChance) {
          activeBurstSteps = randomInt(profile.burstMinSteps, profile.burstMaxSteps, random)
        }

        if (activeBurstSteps > 0) {
          strokesPerMinute = clampRate(strokesPerMinute * profile.burstSpeedMultiplier)
          span = clampNumber(span * profile.burstSpanMultiplier, 10, 48)
          durationJitter = lerp(0.86, 1.05, random())
          pauseChance *= 0.25
          holdChance *= 0.4
          activeBurstSteps -= 1
        } else {
          durationJitter = lerp(0.92, 1.12, random())
        }
        break
      }
      case 'tease':
        strokesPerMinute = lerp(minSpm, maxSpm, sampleBiasedUnit(random, profile.speedBiasExponent * 1.35))
        span = lerp(profile.minSpan, profile.maxSpan, Math.pow(random(), 1.45))
        if (random() < profile.teaseMidpointChance) {
          span *= lerp(0.35, 0.75, random())
        }
        durationJitter = lerp(0.96, 1.18, random())
        pauseChance *= 1.15
        holdChance *= 1.25
        break
      case 'random':
      default:
        break
    }

    strokesPerMinute = clampNumber(strokesPerMinute, minSpm, maxSpm)
    const fastestActiveHalfStrokeMs = 60000 / Math.max(maxSpm * 2, 1)
    const slowestActiveHalfStrokeMs = 60000 / Math.max(minSpm * 2, 1)
    const halfStrokeMs = clampNumber(
      (60000 / Math.max(strokesPerMinute * 2, 1)) * durationJitter,
      Math.max(MIN_HALF_STROKE_MS, fastestActiveHalfStrokeMs),
      Math.min(MAX_HALF_STROKE_MS, slowestActiveHalfStrokeMs)
    )

    nextTimeMs += Math.round(halfStrokeMs)

    const edgeNoise = lerp(-2.5, 2.5, random())
    const position = nextHigh
      ? clampNumber(50 + span + edgeNoise, 52, 98)
      : clampNumber(50 - span + edgeNoise, 2, 48)

    pushAction(actions, Math.min(nextTimeMs, normalizedDurationMs), position)

    if (random() < holdChance) {
      const holdDurationMs = Math.round(lerp(profile.holdMinMs, profile.holdMaxMs, random()))
      nextTimeMs += holdDurationMs
      pushAction(actions, Math.min(nextTimeMs, normalizedDurationMs), position)
    }

    if (random() < pauseChance) {
      nextTimeMs += Math.round(lerp(profile.pauseMinMs, profile.pauseMaxMs, random()))
    }

    nextHigh = !nextHigh
    stepIndex += 1
  }

  const lastAction = actions[actions.length - 1]
  if (lastAction.at < normalizedDurationMs) {
    actions.push({
      at: normalizedDurationMs,
      pos: lastAction.pos,
    })
  }

  const presetLabel = preset === 'custom' ? `Custom ${pattern}` : preset

  return {
    version: '1.0',
    inverted: false,
    range: 100,
    actions,
    metadata: {
      creator: 'ScriptPlayer+',
      description: `Generated ${presetLabel} fallback stroke track for media without a script.`,
      duration: normalizedDurationMs / 1000,
      notes: `Preset: ${preset}; Pattern: ${pattern}`,
      title: `${capitalizeWords(presetLabel)} Stroke Fallback`,
      type: 'generated',
    },
  }
}

function resolveNoScriptStrokeProfile(
  preset: NoScriptStrokePreset,
  pattern: NoScriptStrokePattern
): NoScriptStrokeProfile {
  switch (preset) {
    case 'gentle':
      return {
        pattern: 'steady',
        speedBiasExponent: 1.3,
        minSpan: 14,
        maxSpan: 30,
        jitterMin: 0.96,
        jitterMax: 1.08,
        pauseChance: 0.08,
        pauseMinMs: 80,
        pauseMaxMs: 220,
        holdChance: 0.18,
        holdMinMs: 140,
        holdMaxMs: 420,
        waveCycleMinSteps: 8,
        waveCycleMaxSteps: 14,
        burstChance: 0.1,
        burstMinSteps: 2,
        burstMaxSteps: 4,
        burstSpeedMultiplier: 1.2,
        burstSpanMultiplier: 1.1,
        teaseMidpointChance: 0.12,
      }
    case 'intense':
      return {
        pattern: 'burst',
        speedBiasExponent: 0.85,
        minSpan: 28,
        maxSpan: 48,
        jitterMin: 0.86,
        jitterMax: 1.12,
        pauseChance: 0.04,
        pauseMinMs: 40,
        pauseMaxMs: 160,
        holdChance: 0.03,
        holdMinMs: 60,
        holdMaxMs: 180,
        waveCycleMinSteps: 6,
        waveCycleMaxSteps: 10,
        burstChance: 0.24,
        burstMinSteps: 3,
        burstMaxSteps: 6,
        burstSpeedMultiplier: 1.42,
        burstSpanMultiplier: 1.2,
        teaseMidpointChance: 0.06,
      }
    case 'edging':
      return {
        pattern: 'tease',
        speedBiasExponent: 1.5,
        minSpan: 12,
        maxSpan: 36,
        jitterMin: 0.92,
        jitterMax: 1.18,
        pauseChance: 0.18,
        pauseMinMs: 120,
        pauseMaxMs: 360,
        holdChance: 0.24,
        holdMinMs: 220,
        holdMaxMs: 620,
        waveCycleMinSteps: 8,
        waveCycleMaxSteps: 16,
        burstChance: 0.06,
        burstMinSteps: 2,
        burstMaxSteps: 4,
        burstSpeedMultiplier: 1.2,
        burstSpanMultiplier: 1.05,
        teaseMidpointChance: 0.28,
      }
    case 'custom':
      return buildCustomNoScriptStrokeProfile(pattern)
    case 'natural':
    default:
      return {
        pattern: 'random',
        speedBiasExponent: 1,
        minSpan: 20,
        maxSpan: 46,
        jitterMin: 0.88,
        jitterMax: 1.18,
        pauseChance: 0.16,
        pauseMinMs: 80,
        pauseMaxMs: 320,
        holdChance: 0.04,
        holdMinMs: 120,
        holdMaxMs: 280,
        waveCycleMinSteps: 7,
        waveCycleMaxSteps: 14,
        burstChance: 0.16,
        burstMinSteps: 2,
        burstMaxSteps: 5,
        burstSpeedMultiplier: 1.3,
        burstSpanMultiplier: 1.15,
        teaseMidpointChance: 0.14,
      }
  }
}

function buildCustomNoScriptStrokeProfile(pattern: NoScriptStrokePattern): NoScriptStrokeProfile {
  const base: NoScriptStrokeProfile = {
    pattern,
    speedBiasExponent: 1,
    minSpan: 18,
    maxSpan: 42,
    jitterMin: 0.9,
    jitterMax: 1.14,
    pauseChance: 0.12,
    pauseMinMs: 80,
    pauseMaxMs: 260,
    holdChance: 0.08,
    holdMinMs: 120,
    holdMaxMs: 300,
    waveCycleMinSteps: 6,
    waveCycleMaxSteps: 12,
    burstChance: 0.16,
    burstMinSteps: 2,
    burstMaxSteps: 5,
    burstSpeedMultiplier: 1.32,
    burstSpanMultiplier: 1.12,
    teaseMidpointChance: 0.16,
  }

  switch (pattern) {
    case 'steady':
      return {
        ...base,
        speedBiasExponent: 1.15,
        minSpan: 16,
        maxSpan: 34,
        jitterMin: 0.96,
        jitterMax: 1.06,
        pauseChance: 0.06,
        holdChance: 0.14,
      }
    case 'wave':
      return {
        ...base,
        minSpan: 18,
        maxSpan: 44,
        jitterMin: 0.94,
        jitterMax: 1.08,
        pauseChance: 0.08,
        holdChance: 0.1,
        waveCycleMinSteps: 7,
        waveCycleMaxSteps: 15,
      }
    case 'burst':
      return {
        ...base,
        speedBiasExponent: 0.92,
        minSpan: 24,
        maxSpan: 48,
        jitterMin: 0.86,
        jitterMax: 1.1,
        pauseChance: 0.05,
        holdChance: 0.04,
        burstChance: 0.22,
        burstSpeedMultiplier: 1.4,
        burstSpanMultiplier: 1.18,
      }
    case 'tease':
      return {
        ...base,
        speedBiasExponent: 1.45,
        minSpan: 12,
        maxSpan: 38,
        jitterMin: 0.94,
        jitterMax: 1.18,
        pauseChance: 0.16,
        holdChance: 0.2,
        holdMinMs: 220,
        holdMaxMs: 520,
        teaseMidpointChance: 0.26,
      }
    case 'random':
    default:
      return base
  }
}

function pushAction(actions: FunscriptAction[], timeMs: number, position: number) {
  const clampedTime = Math.max(0, Math.round(timeMs))
  const previous = actions[actions.length - 1]
  if (clampedTime <= previous.at) {
    return
  }

  actions.push({
    at: clampedTime,
    pos: Math.round(clampNumber(position, 0, 100)),
  })
}

function sampleBiasedUnit(random: () => number, exponent: number): number {
  return Math.pow(random(), clampNumber(exponent, 0.35, 2.5))
}

function randomInt(min: number, max: number, random: () => number): number {
  const clampedMin = Math.max(0, Math.round(Math.min(min, max)))
  const clampedMax = Math.max(clampedMin, Math.round(Math.max(min, max)))
  return clampedMin + Math.floor(random() * (clampedMax - clampedMin + 1))
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

function capitalizeWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
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
