import { useRef, useEffect, useCallback } from 'react'
import { FunscriptAction } from '../types'
import { getActionsInRange, getSpeed } from '../services/funscript'

interface ScriptTimelineProps {
  actions: FunscriptAction[]
  currentTime: number // seconds
  duration: number // seconds
  onSeek: (time: number) => void
  windowSize?: number // seconds, default 10
}

const DEFAULT_WINDOW = 10
const COLORS = {
  bg: '#181825',
  grid: '#1e1e2e',
  line: '#cba6f7',
  lineGlow: 'rgba(203, 166, 247, 0.3)',
  dot: '#cba6f7',
  playhead: '#f38ba8',
  slow: '#a6e3a1',
  medium: '#f9e2af',
  fast: '#fab387',
  veryFast: '#f38ba8',
}

function getSpeedColor(speed: number): string {
  if (speed < 100) return COLORS.slow
  if (speed < 250) return COLORS.medium
  if (speed < 400) return COLORS.fast
  return COLORS.veryFast
}

export default function ScriptTimeline({
  actions,
  currentTime,
  duration,
  onSeek,
  windowSize = DEFAULT_WINDOW,
}: ScriptTimelineProps) {
  const WINDOW_SECONDS = windowSize
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const padding = { top: 8, bottom: 8, left: 0, right: 0 }
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
      ctx.beginPath()
      ctx.moveTo(0, y)
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

    // Get visible actions
    const visibleActions = getActionsInRange(actions, startMs, endMs)

    if (visibleActions.length >= 2) {
      // Draw speed-colored segments
      for (let i = 0; i < visibleActions.length - 1; i++) {
        const a = visibleActions[i]
        const b = visibleActions[i + 1]
        const speed = getSpeed(a, b)

        const x1 = padding.left + ((a.at - startMs) / (endMs - startMs)) * plotW
        const y1 = padding.top + plotH - (a.pos / 100) * plotH
        const x2 = padding.left + ((b.at - startMs) / (endMs - startMs)) * plotW
        const y2 = padding.top + plotH - (b.pos / 100) * plotH

        // Glow
        ctx.strokeStyle = getSpeedColor(speed)
        ctx.globalAlpha = 0.15
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()

        // Main line
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // Draw dots at action points
      for (const action of visibleActions) {
        const x = padding.left + ((action.at - startMs) / (endMs - startMs)) * plotW
        const y = padding.top + plotH - (action.pos / 100) * plotH

        ctx.fillStyle = COLORS.dot
        ctx.beginPath()
        ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (visibleActions.length === 1) {
      const action = visibleActions[0]
      const x = padding.left + ((action.at - startMs) / (endMs - startMs)) * plotW
      const y = padding.top + plotH - (action.pos / 100) * plotH

      ctx.strokeStyle = COLORS.lineGlow
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()

      ctx.strokeStyle = COLORS.line
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()

      if (x >= 0 && x <= w) {
        ctx.fillStyle = COLORS.dot
        ctx.beginPath()
        ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

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
  }, [actions, currentTime])

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
