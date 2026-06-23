import { useRef, useEffect, useCallback } from 'react'
import { FunscriptAction, ScriptAxisId } from '../types'
import { getActionsInRange, getSpeed } from '../services/funscript'

export interface ScriptTimelineAxisSeries {
  axisId: ScriptAxisId
  actions: FunscriptAction[]
}

interface ScriptTimelineProps {
  actions: FunscriptAction[]
  axisSeries?: ScriptTimelineAxisSeries[]
  currentTime: number // seconds
  duration: number // seconds
  onSeek: (time: number) => void
  windowSize?: number // seconds, default 10
}

const DEFAULT_WINDOW = 10
const COLORS = {
  bg: '#181825',
  grid: '#45475a',
  gridStrong: '#6c7086',
  line: '#cba6f7',
  lineGlow: 'rgba(203, 166, 247, 0.3)',
  dot: '#cba6f7',
  playhead: '#f38ba8',
  slow: '#a6e3a1',
  medium: '#f9e2af',
  fast: '#fab387',
  veryFast: '#f38ba8',
}

const AXIS_COLORS: Record<ScriptAxisId, { line: string; glow: string; dot: string }> = {
  L0: { line: '#cba6f7', glow: 'rgba(203, 166, 247, 0.22)', dot: '#cba6f7' },
  L1: { line: '#89b4fa', glow: 'rgba(137, 180, 250, 0.20)', dot: '#89b4fa' },
  L2: { line: '#94e2d5', glow: 'rgba(148, 226, 213, 0.18)', dot: '#94e2d5' },
  R0: { line: '#f38ba8', glow: 'rgba(243, 139, 168, 0.20)', dot: '#f38ba8' },
  R1: { line: '#fab387', glow: 'rgba(250, 179, 135, 0.18)', dot: '#fab387' },
  R2: { line: '#a6e3a1', glow: 'rgba(166, 227, 161, 0.18)', dot: '#a6e3a1' },
  V0: { line: '#f9e2af', glow: 'rgba(249, 226, 175, 0.18)', dot: '#f9e2af' },
  V1: { line: '#eba0ac', glow: 'rgba(235, 160, 172, 0.18)', dot: '#eba0ac' },
  A0: { line: '#74c7ec', glow: 'rgba(116, 199, 236, 0.18)', dot: '#74c7ec' },
  A1: { line: '#b4befe', glow: 'rgba(180, 190, 254, 0.18)', dot: '#b4befe' },
  A2: { line: '#f5c2e7', glow: 'rgba(245, 194, 231, 0.18)', dot: '#f5c2e7' },
}

function getSpeedColor(speed: number): string {
  if (speed < 100) return COLORS.slow
  if (speed < 250) return COLORS.medium
  if (speed < 400) return COLORS.fast
  return COLORS.veryFast
}

export default function ScriptTimeline({
  actions,
  axisSeries,
  currentTime,
  duration,
  onSeek,
  windowSize = DEFAULT_WINDOW,
}: ScriptTimelineProps) {
  const WINDOW_SECONDS = windowSize
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasSizeRef = useRef({ width: 0, height: 0, dpr: 0 })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const backingWidth = Math.max(1, Math.round(rect.width * dpr))
    const backingHeight = Math.max(1, Math.round(rect.height * dpr))
    const currentSize = canvasSizeRef.current
    if (
      currentSize.width !== backingWidth
      || currentSize.height !== backingHeight
      || currentSize.dpr !== dpr
    ) {
      canvas.width = backingWidth
      canvas.height = backingHeight
      canvasSizeRef.current = { width: backingWidth, height: backingHeight, dpr }
    }

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const w = rect.width
    const h = rect.height
    const series = normalizeTimelineSeries(axisSeries, actions)
    const multiAxis = series.length > 1
    const padding = { top: 8, bottom: 12, left: multiAxis ? 36 : 0, right: 0 }
    const plotW = w - padding.left - padding.right
    const plotH = h - padding.top - padding.bottom

    // Clear
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, w, h)

    const currentMs = currentTime * 1000
    const halfWindow = (WINDOW_SECONDS * 1000) / 2
    const startMs = currentMs - halfWindow
    const endMs = currentMs + halfWindow

    // Grid lines
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotH * i) / 4
      ctx.strokeStyle = i === 0 || i === 2 || i === 4 ? COLORS.gridStrong : COLORS.grid
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    // Time markers
    const startSec = Math.floor(startMs / 1000)
    const endSec = Math.ceil(endMs / 1000)
    ctx.fillStyle = '#313244'
    ctx.font = '9px system-ui'
    ctx.textAlign = 'center'
    for (let s = startSec; s <= endSec; s++) {
      if (s < 0) continue
      const x = padding.left + ((s * 1000 - startMs) / (endMs - startMs)) * plotW
      if (x >= 0 && x <= w) {
        ctx.fillText(formatTime(s), x, h - 1)
        ctx.strokeStyle = COLORS.grid
        ctx.beginPath()
        ctx.moveTo(x, padding.top)
        ctx.lineTo(x, padding.top + plotH)
        ctx.stroke()
      }
    }

    const laneGap = multiAxis ? 6 : 0
    const laneHeight = multiAxis ? Math.max(18, (plotH - laneGap * (series.length - 1)) / series.length) : plotH

    series.forEach((entry, index) => {
      const axisColors = AXIS_COLORS[entry.axisId]
      const laneTop = multiAxis
        ? padding.top + index * (laneHeight + laneGap)
        : padding.top
      const laneBottom = laneTop + laneHeight
      const laneCenter = laneTop + laneHeight / 2
      const visibleActions = getActionsInRange(entry.actions, startMs, endMs)

      if (multiAxis) {
        ctx.fillStyle = 'rgba(30, 30, 46, 0.55)'
        ctx.fillRect(0, laneTop, w, laneHeight)
        ctx.strokeStyle = COLORS.gridStrong
        ctx.globalAlpha = 0.65
        ctx.beginPath()
        ctx.moveTo(padding.left, laneCenter)
        ctx.lineTo(w, laneCenter)
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.fillStyle = axisColors.line
        ctx.font = '10px system-ui'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(entry.axisId, 8, laneCenter)
      }

      if (visibleActions.length >= 2) {
        for (let i = 0; i < visibleActions.length - 1; i++) {
          const a = visibleActions[i]
          const b = visibleActions[i + 1]
          const speed = getSpeed(a, b)

          const x1 = padding.left + ((a.at - startMs) / (endMs - startMs)) * plotW
          const y1 = laneBottom - (a.pos / 100) * laneHeight
          const x2 = padding.left + ((b.at - startMs) / (endMs - startMs)) * plotW
          const y2 = laneBottom - (b.pos / 100) * laneHeight

          ctx.strokeStyle = multiAxis ? axisColors.glow : getSpeedColor(speed)
          ctx.globalAlpha = multiAxis ? 1 : 0.15
          ctx.lineWidth = multiAxis ? 5 : 6
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()

          ctx.strokeStyle = multiAxis ? axisColors.line : getSpeedColor(speed)
          ctx.globalAlpha = 0.92
          ctx.lineWidth = multiAxis ? 1.8 : 2
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
          ctx.globalAlpha = 1
        }

        for (const action of visibleActions) {
          const x = padding.left + ((action.at - startMs) / (endMs - startMs)) * plotW
          const y = laneBottom - (action.pos / 100) * laneHeight

          ctx.fillStyle = multiAxis ? axisColors.dot : COLORS.dot
          ctx.beginPath()
          ctx.arc(x, y, multiAxis ? 2.4 : 3, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (visibleActions.length === 1) {
        const action = visibleActions[0]
        const x = padding.left + ((action.at - startMs) / (endMs - startMs)) * plotW
        const y = laneBottom - (action.pos / 100) * laneHeight

        ctx.strokeStyle = multiAxis ? axisColors.glow : COLORS.lineGlow
        ctx.lineWidth = multiAxis ? 5 : 6
        ctx.beginPath()
        ctx.moveTo(padding.left, y)
        ctx.lineTo(w, y)
        ctx.stroke()

        ctx.strokeStyle = multiAxis ? axisColors.line : COLORS.line
        ctx.lineWidth = multiAxis ? 1.8 : 2
        ctx.beginPath()
        ctx.moveTo(padding.left, y)
        ctx.lineTo(w, y)
        ctx.stroke()

        if (x >= padding.left && x <= w) {
          ctx.fillStyle = multiAxis ? axisColors.dot : COLORS.dot
          ctx.beginPath()
          ctx.arc(x, y, multiAxis ? 2.4 : 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    })

    // Playhead
    const playheadX = w / 2
    ctx.strokeStyle = COLORS.playhead
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(playheadX, 0)
    ctx.lineTo(playheadX, h)
    ctx.stroke()
    ctx.setLineDash([])

    // Playhead glow
    const gradient = ctx.createLinearGradient(playheadX - 20, 0, playheadX + 20, 0)
    gradient.addColorStop(0, 'transparent')
    gradient.addColorStop(0.5, 'rgba(243, 139, 168, 0.08)')
    gradient.addColorStop(1, 'transparent')
    ctx.fillStyle = gradient
    ctx.fillRect(playheadX - 20, 0, 40, h)
  }, [actions, axisSeries, currentTime, windowSize])

  useEffect(() => {
    const frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [draw])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => draw())
    observer.observe(container)
    return () => observer.disconnect()
  }, [draw])

  const handleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const ratio = x / rect.width
    const halfWindow = WINDOW_SECONDS / 2
    const clickTime = currentTime - halfWindow + ratio * WINDOW_SECONDS
    onSeek(Math.max(0, Math.min(duration, clickTime)))
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full cursor-pointer"
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: 'block' }}
      />
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function normalizeTimelineSeries(
  axisSeries: ScriptTimelineAxisSeries[] | undefined,
  fallbackActions: FunscriptAction[]
): ScriptTimelineAxisSeries[] {
  const explicitSeries = axisSeries
    ?.filter((entry) => entry.actions.length > 0)
    .slice(0, 6)

  if (explicitSeries && explicitSeries.length > 0) {
    return explicitSeries
  }

  return fallbackActions.length > 0 ? [{ axisId: 'L0', actions: fallbackActions }] : []
}
