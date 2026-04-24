import { Funscript, FunscriptAction } from '../types'

interface TransformActionOptions {
  strokeMin?: number
  strokeMax?: number
  invert?: boolean
  timeScale?: number
}

export function parseFunscript(data: unknown): Funscript | null {
  try {
    const script = data as Funscript
    if (!script.actions || !Array.isArray(script.actions)) return null

    // Sort actions by time
    script.actions.sort((a, b) => a.at - b.at)

    // Clamp positions to 0-100
    script.actions = script.actions.map((a) => ({
      at: a.at,
      pos: Math.max(0, Math.min(100, a.pos)),
    }))

    return script
  } catch {
    return null
  }
}

export function transformFunscriptActions(
  actions: FunscriptAction[],
  {
    strokeMin = 0,
    strokeMax = 100,
    invert = false,
    timeScale = 1,
  }: TransformActionOptions = {}
): FunscriptAction[] {
  const min = clampPosition(Math.min(strokeMin, strokeMax))
  const max = clampPosition(Math.max(strokeMin, strokeMax))
  const range = max - min
  const scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1

  return actions.map((action) => {
    const normalized = clampPosition(action.pos) / 100
    const mapped = invert ? 1 - normalized : normalized

    return {
      at: Math.max(0, action.at * scale),
      pos: clampPosition(min + mapped * range),
    }
  })
}

export function strokesPerMinuteToUnitsPerSecond(strokesPerMinute: number): number {
  const safeStrokesPerMinute = Number.isFinite(strokesPerMinute) && strokesPerMinute > 0
    ? strokesPerMinute
    : 0
  return safeStrokesPerMinute * 100 / 60
}

export function limitFunscriptMotionSpeed(
  actions: FunscriptAction[],
  maxUnitsPerSecond: number
): FunscriptAction[] {
  if (actions.length < 2 || !Number.isFinite(maxUnitsPerSecond) || maxUnitsPerSecond <= 0) {
    return actions
  }

  const limited: FunscriptAction[] = []
  let previous: FunscriptAction | null = null

  for (const action of actions) {
    const current: FunscriptAction = {
      at: Math.max(0, action.at),
      pos: clampPosition(action.pos),
    }

    if (!previous) {
      limited.push(current)
      previous = current
      continue
    }

    const deltaTimeMs = current.at - previous.at
    if (deltaTimeMs <= 0) {
      const sameTimeAction: FunscriptAction = {
        at: current.at,
        pos: previous.pos,
      }
      limited.push(sameTimeAction)
      previous = sameTimeAction
      continue
    }

    const maxDelta = maxUnitsPerSecond * deltaTimeMs / 1000
    const delta = current.pos - previous.pos
    const pos = Math.abs(delta) <= maxDelta
      ? current.pos
      : previous.pos + Math.sign(delta) * maxDelta

    const limitedAction: FunscriptAction = {
      at: current.at,
      pos: clampPosition(pos),
    }
    limited.push(limitedAction)
    previous = limitedAction
  }

  return limited
}

/** Get the interpolated position at a given time */
export function getPositionAtTime(actions: FunscriptAction[], timeMs: number): number {
  if (actions.length === 0) return 50

  // Before first action
  if (timeMs <= actions[0].at) return actions[0].pos

  // After last action
  if (timeMs >= actions[actions.length - 1].at) return actions[actions.length - 1].pos

  // Binary search for the surrounding actions
  let low = 0
  let high = actions.length - 1

  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2)
    if (actions[mid].at <= timeMs) {
      low = mid
    } else {
      high = mid
    }
  }

  const prev = actions[low]
  const next = actions[high]
  const progress = (timeMs - prev.at) / (next.at - prev.at)
  return prev.pos + (next.pos - prev.pos) * progress
}

/** Get actions within a time window for visualization */
export function getActionsInRange(
  actions: FunscriptAction[],
  startMs: number,
  endMs: number
): FunscriptAction[] {
  // Binary search for start index
  let startIdx = 0
  let low = 0
  let high = actions.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (actions[mid].at < startMs) {
      low = mid + 1
    } else {
      startIdx = mid
      high = mid - 1
    }
  }

  // Include one action before the range for line continuity
  if (startIdx > 0) startIdx--

  const result: FunscriptAction[] = []
  for (let i = startIdx; i < actions.length; i++) {
    if (actions[i].at > endMs) {
      result.push(actions[i]) // Include one after for line continuity
      break
    }
    result.push(actions[i])
  }

  return result
}

/** Calculate speed between two actions in units/sec */
export function getSpeed(a: FunscriptAction, b: FunscriptAction): number {
  const dt = Math.abs(b.at - a.at)
  if (dt === 0) return 0
  const dp = Math.abs(b.pos - a.pos)
  return (dp / dt) * 1000
}

function clampPosition(pos: number): number {
  return Math.max(0, Math.min(100, pos))
}
