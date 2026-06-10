import { Funscript, FunscriptAction } from '../types'

export type VideoMotionScriptModelId = 'local-motion-fast' | 'local-motion-accurate'

export interface VideoMotionScriptModel {
  id: VideoMotionScriptModelId
  label: string
  description: string
  sampleIntervalMs: number
  width: number
  height: number
  smoothingPasses: number
}

export const VIDEO_MOTION_SCRIPT_MODELS: VideoMotionScriptModel[] = [
  {
    id: 'local-motion-accurate',
    label: 'Local Motion AI - Accurate',
    description: 'Slower local frame analysis with denser samples. Best first choice.',
    sampleIntervalMs: 300,
    width: 64,
    height: 36,
    smoothingPasses: 3,
  },
  {
    id: 'local-motion-fast',
    label: 'Local Motion AI - Fast',
    description: 'Faster local analysis with lighter samples. Good for long videos.',
    sampleIntervalMs: 600,
    width: 48,
    height: 27,
    smoothingPasses: 2,
  },
]

interface VideoMotionScriptOptions {
  model: VideoMotionScriptModel
  sensitivity: number
  onProgress?: (progress: number) => void
}

interface MotionSample {
  at: number
  score: number
}

const SEEK_TIMEOUT_MS = 2400

export async function buildVideoMotionFunscript(
  video: HTMLVideoElement,
  sourceLabel: string,
  options: VideoMotionScriptOptions
): Promise<Funscript | null> {
  const durationMs = Math.round((Number.isFinite(video.duration) ? video.duration : 0) * 1000)
  if (durationMs < 1000 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = options.model.width
  canvas.height = options.model.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return null
  }

  const originalTime = video.currentTime
  const wasPaused = video.paused
  if (!wasPaused) {
    video.pause()
  }

  const sampleTimes = buildSampleTimes(durationMs, options.model.sampleIntervalMs)
  const samples: MotionSample[] = []
  let previousFrame: Uint8ClampedArray | null = null

  try {
    for (let index = 0; index < sampleTimes.length; index += 1) {
      const timeMs = sampleTimes[index]
      await seekVideo(video, timeMs / 1000)
      context.drawImage(video, 0, 0, options.model.width, options.model.height)
      const frame = context.getImageData(0, 0, options.model.width, options.model.height).data
      if (previousFrame) {
        samples.push({
          at: timeMs,
          score: scoreFrameMotion(previousFrame, frame, options.model.width, options.model.height),
        })
      }
      previousFrame = new Uint8ClampedArray(frame)
      options.onProgress?.((index + 1) / sampleTimes.length)
    }
  } finally {
    await seekVideo(video, originalTime).catch(() => undefined)
    if (!wasPaused) {
      await video.play().catch(() => undefined)
    }
    options.onProgress?.(1)
  }

  if (samples.length < 2) {
    return null
  }

  const actions = buildActionsFromMotionSamples(samples, durationMs, options.sensitivity, options.model.smoothingPasses)
  if (actions.length < 4) {
    return null
  }

  return {
    version: '1.0',
    inverted: false,
    range: 100,
    actions,
    metadata: {
      creator: 'ScriptPlayer+',
      description: 'Generated from local video motion analysis.',
      duration: durationMs / 1000,
      notes: `Source: ${sourceLabel}; Model: ${options.model.label}; Sensitivity: ${Math.round(options.sensitivity)}; This is an experimental local generated script.`,
      title: `${sourceLabel} - AI Motion`,
      type: 'generated',
    },
  }
}

function buildSampleTimes(durationMs: number, sampleIntervalMs: number): number[] {
  const endMs = Math.max(0, durationMs - 120)
  const interval = Math.round(clampNumber(sampleIntervalMs, 250, 1500))
  const times: number[] = []
  for (let at = 0; at <= endMs; at += interval) {
    times.push(Math.round(at))
  }
  if (times.length === 0 || times[times.length - 1] !== endMs) {
    times.push(endMs)
  }
  return times
}

function scoreFrameMotion(previous: Uint8ClampedArray, current: Uint8ClampedArray, width: number, height: number): number {
  let total = 0
  let weightTotal = 0
  const centerX = (width - 1) / 2
  const centerY = (height - 1) / 2
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY) || 1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4
      const previousLuma = previous[pixel] * 0.2126 + previous[pixel + 1] * 0.7152 + previous[pixel + 2] * 0.0722
      const currentLuma = current[pixel] * 0.2126 + current[pixel + 1] * 0.7152 + current[pixel + 2] * 0.0722
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2) / maxDistance
      const centerWeight = 1.3 - distance * 0.5
      const verticalWeight = y > height * 0.18 && y < height * 0.84 ? 1.08 : 0.86
      const weight = Math.max(0.45, centerWeight * verticalWeight)
      total += Math.abs(currentLuma - previousLuma) * weight
      weightTotal += weight
    }
  }

  return weightTotal > 0 ? total / weightTotal : 0
}

function enhanceMotionSamples(samples: MotionSample[]): MotionSample[] {
  if (samples.length < 4) {
    return samples
  }

  const sortedScores = samples.map((sample) => sample.score).sort((a, b) => a - b)
  const noiseFloor = percentile(sortedScores, 0.18)
  const median = percentile(sortedScores, 0.5)
  const activeHigh = Math.max(noiseFloor + 0.5, percentile(sortedScores, 0.88))
  const sceneCutThreshold = Math.max(
    percentile(sortedScores, 0.98),
    activeHigh * 2.7,
    median * 6
  )

  const normalized = samples.map((sample, index) => {
    const previous = samples[index - 1]?.score ?? sample.score
    const next = samples[index + 1]?.score ?? sample.score
    const neighborAverage = (previous + next) / 2
    const isSceneCutLike = sample.score >= sceneCutThreshold && sample.score > Math.max(neighborAverage * 2.1, activeHigh * 2.2)
    const rawScore = isSceneCutLike
      ? Math.min(activeHigh, Math.max(noiseFloor, neighborAverage))
      : sample.score
    const normalizedScore = clampNumber(((rawScore - noiseFloor) / Math.max(0.001, activeHigh - noiseFloor)) * 100, 0, 100)
    return {
      at: sample.at,
      score: normalizedScore,
    }
  })

  return suppressMotionSpikes(smoothMotionSamples(normalized, 2))
}

function smoothMotionSamples(samples: MotionSample[], passes: number): MotionSample[] {
  let output = samples
  for (let pass = 0; pass < passes; pass += 1) {
    output = output.map((sample, index) => {
      const previous = output[index - 1]?.score ?? sample.score
      const next = output[index + 1]?.score ?? sample.score
      return {
        at: sample.at,
        score: (previous + sample.score * 2 + next) / 4,
      }
    })
  }
  return output
}

function suppressMotionSpikes(samples: MotionSample[]): MotionSample[] {
  if (samples.length < 3) {
    return samples
  }

  return samples.map((sample, index) => {
    const previous = samples[index - 1]?.score ?? sample.score
    const next = samples[index + 1]?.score ?? sample.score
    const neighborAverage = (previous + next) / 2
    const isolatedSpike = sample.score > 55 && neighborAverage < sample.score * 0.42
    const isolatedDrop = sample.score < 12 && neighborAverage > 42
    if (isolatedSpike || isolatedDrop) {
      return {
        at: sample.at,
        score: neighborAverage,
      }
    }
    return sample
  })
}

function buildRhythmAwareActions(samples: MotionSample[], durationMs: number, sensitivity: number): FunscriptAction[] {
  if (samples.length < 5 || durationMs < 1200) {
    return []
  }

  const sortedScores = samples.map((sample) => sample.score).sort((a, b) => a - b)
  const activeThreshold = clampNumber(
    Math.max(16, percentile(sortedScores, 0.58) * 0.72, percentile(sortedScores, 0.72) * 0.48),
    14,
    44
  )
  const segments = collectActiveMotionSegments(samples, activeThreshold)
  if (segments.length === 0) {
    return []
  }

  const sensitivityGain = lerp(0.85, 1.22, clampNumber(sensitivity, 0, 100) / 100)
  const actions: FunscriptAction[] = [{ at: 0, pos: 50 }]

  for (const segment of segments) {
    if (segment.end - segment.start < 650) {
      continue
    }

    const segmentSamples = samples.filter((sample) => sample.at >= segment.start && sample.at <= segment.end)
    if (segmentSamples.length < 2) {
      continue
    }

    const averageEnergy = segmentSamples.reduce((sum, sample) => sum + sample.score, 0) / segmentSamples.length
    const peakEnergy = Math.max(...segmentSamples.map((sample) => sample.score))
    const energy = clampNumber(((averageEnergy * 0.62 + peakEnergy * 0.38) / 100) * sensitivityGain, 0.08, 1)
    const strokeInterval = Math.round(lerp(780, 270, energy))
    const amplitude = Math.round(lerp(12, 46, energy))
    const leadIn = Math.min(220, Math.round(strokeInterval * 0.45))
    const leadOut = Math.min(260, Math.round(strokeInterval * 0.55))

    pushGeneratedAction(actions, { at: Math.max(0, segment.start - leadIn), pos: 50 }, durationMs)

    let high = true
    for (let at = segment.start; at <= segment.end; at += strokeInterval) {
      const localEnergy = getLocalMotionEnergy(samples, at, strokeInterval)
      const edgeFade = clampNumber(
        Math.min(
          (at - segment.start + strokeInterval * 0.5) / Math.max(320, strokeInterval),
          (segment.end - at + strokeInterval * 0.5) / Math.max(320, strokeInterval)
        ),
        0.42,
        1
      )
      const localAmplitude = amplitude * lerp(0.72, 1.18, localEnergy / 100) * edgeFade
      const pos = Math.round(high ? 50 + localAmplitude : 50 - localAmplitude)
      pushGeneratedAction(actions, { at, pos }, durationMs)
      high = !high
    }

    pushGeneratedAction(actions, { at: Math.min(durationMs, segment.end + leadOut), pos: 50 }, durationMs)
  }

  pushGeneratedAction(actions, { at: durationMs, pos: 50 }, durationMs)
  return cleanGeneratedActions(actions)
}

function collectActiveMotionSegments(samples: MotionSample[], threshold: number): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = []
  let start: number | null = null
  let lastActive = 0
  const bridgeGapMs = 950

  for (const sample of samples) {
    if (sample.score >= threshold) {
      if (start === null) {
        start = sample.at
      }
      lastActive = sample.at
      continue
    }

    if (start !== null && sample.at - lastActive > bridgeGapMs) {
      segments.push({ start, end: lastActive })
      start = null
    }
  }

  if (start !== null) {
    segments.push({ start, end: lastActive })
  }

  return segments
}

function getLocalMotionEnergy(samples: MotionSample[], at: number, windowMs: number): number {
  const halfWindow = Math.max(180, windowMs * 0.55)
  const nearby = samples.filter((sample) => Math.abs(sample.at - at) <= halfWindow)
  if (nearby.length === 0) {
    return 0
  }
  return nearby.reduce((sum, sample) => sum + sample.score, 0) / nearby.length
}

function pushGeneratedAction(actions: FunscriptAction[], action: FunscriptAction, durationMs: number): void {
  const next = {
    at: Math.round(clampNumber(action.at, 0, durationMs)),
    pos: Math.round(clampNumber(action.pos, 0, 100)),
  }
  const previous = actions[actions.length - 1]
  if (previous && next.at - previous.at < 85) {
    previous.pos = next.pos
    return
  }
  if (previous && previous.pos === next.pos && next.at - previous.at < 220) {
    return
  }
  actions.push(next)
}

function cleanGeneratedActions(actions: FunscriptAction[]): FunscriptAction[] {
  const sorted = [...actions].sort((a, b) => a.at - b.at)
  const cleaned: FunscriptAction[] = []
  for (const action of sorted) {
    const previous = cleaned[cleaned.length - 1]
    if (previous && previous.at === action.at) {
      previous.pos = action.pos
      continue
    }
    if (previous && previous.pos === action.pos && action.at - previous.at < 180) {
      continue
    }
    cleaned.push(action)
  }
  return cleaned
}

function buildActionsFromMotionSamples(
  samples: MotionSample[],
  durationMs: number,
  sensitivity: number,
  smoothingPasses: number
): FunscriptAction[] {
  let smoothed = samples
  for (let pass = 0; pass < smoothingPasses; pass += 1) {
    smoothed = smoothScores(smoothed)
  }

  smoothed = enhanceMotionSamples(smoothed)
  const rhythmAwareActions = buildRhythmAwareActions(smoothed, durationMs, sensitivity)
  if (rhythmAwareActions.length >= 4) {
    return rhythmAwareActions
  }

  const sortedScores = smoothed.map((sample) => sample.score).sort((a, b) => a - b)
  const low = percentile(sortedScores, 0.18)
  const high = Math.max(low + 0.5, percentile(sortedScores, 0.92))
  const sensitivityGain = lerp(0.7, 1.5, clampNumber(sensitivity, 0, 100) / 100)
  const actions: FunscriptAction[] = [{ at: 0, pos: 50 }]
  let nextHigh = true
  let previousPos = 50

  for (const sample of smoothed) {
    const motion = clampNumber((sample.score - low) / (high - low), 0, 1)
    const shapedMotion = clampNumber(Math.pow(motion, 0.78) * sensitivityGain, 0, 1)
    const amplitude = lerp(8, 46, shapedMotion)
    const target = nextHigh ? 50 + amplitude : 50 - amplitude
    const pos = Math.round(clampNumber(previousPos * 0.28 + target * 0.72, 2, 98))
    const last = actions[actions.length - 1]

    if (sample.at - last.at >= 150 && Math.abs(pos - last.pos) >= 3) {
      actions.push({ at: sample.at, pos })
      previousPos = pos
      nextHigh = !nextHigh
    }
  }

  const last = actions[actions.length - 1]
  if (last.at < durationMs) {
    actions.push({ at: durationMs, pos: last.pos })
  }

  return actions
}

function smoothScores(samples: MotionSample[]): MotionSample[] {
  return samples.map((sample, index) => {
    const previous = samples[Math.max(0, index - 1)].score
    const next = samples[Math.min(samples.length - 1, index + 1)].score
    return {
      at: sample.at,
      score: previous * 0.22 + sample.score * 0.56 + next * 0.22,
    }
  })
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0
  const index = clampNumber((sortedValues.length - 1) * percentileValue, 0, sortedValues.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sortedValues[lower]
  return lerp(sortedValues[lower], sortedValues[upper], index - lower)
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = clampNumber(time, 0, Math.max(0, Number.isFinite(video.duration) ? video.duration : time))

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
    }
    const handleSeeked = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Video seek failed during motion analysis.'))
    }

    timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error('Video seek timed out during motion analysis.'))
    }, SEEK_TIMEOUT_MS)

    video.addEventListener('seeked', handleSeeked, { once: true })
    video.addEventListener('error', handleError, { once: true })

    if (Math.abs(video.currentTime - target) < 0.03) {
      cleanup()
      resolve()
      return
    }

    video.currentTime = target
  })
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t
}
