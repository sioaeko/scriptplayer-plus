import { useRef, useEffect, useCallback } from 'react'
import { FunscriptAction } from '../types'
import { getSpeed } from '../services/funscript'

interface ScriptHeatmapProps {
  actions: FunscriptAction[]
  duration: number // seconds
  currentTime: number // seconds
  onSeek: (time: number) => void
}

const COLORS = [
  [30, 144, 30],    // slow - green
  [160, 200, 50],   // medium-slow - yellow-green
  [240, 200, 50],   // medium - yellow
  [245, 160, 50],   // medium-fast - orange
  [240, 80, 50],    // fast - red-orange
  [200, 30, 60],    // very fast - deep red
  [160, 20, 100],   // extreme - purple-red
]

function speedToColor(speed: number): string {
  // Map speed (0-500+) to color index
  const t = Math.min(speed / 400, 1)
  const idx = t * (COLORS.length - 1)
  const low = Math.floor(idx)
  const high = Math.min(low + 1, COLORS.length - 1)
  const frac = idx - low
  const r = Math.round(COLORS[low][0] + (COLORS[high][0] - COLORS[low][0]) * frac)
  const g = Math.round(COLORS[low][1] + (COLORS[high][1] - COLORS[low][1]) * frac)
  const b = Math.round(COLORS[low][2] + (COLORS[high][2] - COLORS[low][2]) * frac)
  return `rgb(${r},${g},${b})`
}

export default function ScriptHeatmap({
  actions,
  duration,
  currentTime,
  onSeek,
}: ScriptHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const baseCanvasStateRef = useRef<{
    widthPx: number
    heightPx: number
    duration: number
    actionsRef: FunscriptAction[]
  } | null>(null)

  const renderBaseCanvas = useCallback(() => {
    const container = containerRef.current
    if (!container) return null

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const widthPx = Math.max(1, Math.round(rect.width * dpr))
    const heightPx = Math.max(1, Math.round(rect.height * dpr))
    const durationMs = duration * 1000

    const baseCanvas = baseCanvasRef.current ?? document.createElement('canvas')
    baseCanvasRef.current = baseCanvas
    const shouldRedrawBase = (() => {
      const previousState = baseCanvasStateRef.current
      if (!previousState) return true
      return previousState.widthPx !== widthPx
        || previousState.heightPx !== heightPx
        || previousState.duration !== duration
        || previousState.actionsRef !== actions
    })()

    if (shouldRedrawBase) {
      baseCanvas.width = widthPx
      baseCanvas.height = heightPx

      const ctx = baseCanvas.getContext('2d')
      if (!ctx) return null

      ctx.clearRect(0, 0, widthPx, heightPx)
      ctx.fillStyle = '#11111b'
      ctx.fillRect(0, 0, widthPx, heightPx)

      if (actions.length >= 2 && duration > 0) {
        const barWidthPx = Math.max(1, Math.round(widthPx / 200))
        const segmentCount = Math.max(1, Math.floor(widthPx / barWidthPx))
        const segmentMs = durationMs / segmentCount

        for (let i = 0; i < segmentCount; i++) {
          const segStart = i * segmentMs
          const segEnd = segStart + segmentMs

          let totalSpeed = 0
          let count = 0
          for (let j = 0; j < actions.length - 1; j++) {
            const a = actions[j]
            const b = actions[j + 1]
            if (b.at < segStart || a.at > segEnd) continue
            totalSpeed += getSpeed(a, b)
            count++
          }

          if (count > 0) {
            const avgSpeed = totalSpeed / count
            ctx.fillStyle = speedToColor(avgSpeed)
          } else {
            ctx.fillStyle = '#1e1e2e'
          }

          const x = i * barWidthPx
          ctx.fillRect(x, 0, Math.max(1, barWidthPx), heightPx)
        }
      }

      baseCanvasStateRef.current = {
        widthPx,
        heightPx,
        duration,
        actionsRef: actions,
      }
    }

    return { baseCanvas, dpr }
  }, [actions, duration])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const prepared = renderBaseCanvas()
    if (!canvas || !prepared) return

    const { baseCanvas, dpr } = prepared
    const widthPx = baseCanvas.width
    const heightPx = baseCanvas.height
    canvas.width = widthPx
    canvas.height = heightPx

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, widthPx, heightPx)
    ctx.drawImage(baseCanvas, 0, 0)

    if (duration <= 0) return

    const posX = (currentTime / duration) * widthPx
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillRect(posX - dpr, 0, Math.max(2, dpr * 2), heightPx)

    const glowRadius = Math.max(8, dpr * 8)
    const glow = ctx.createLinearGradient(posX - glowRadius, 0, posX + glowRadius, 0)
    glow.addColorStop(0, 'transparent')
    glow.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)')
    glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow
    ctx.fillRect(posX - glowRadius, 0, glowRadius * 2, heightPx)
  }, [currentTime, duration, renderBaseCanvas])

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
    if (!rect || duration <= 0) return
    const x = e.clientX - rect.left
    const time = (x / rect.width) * duration
    onSeek(Math.max(0, Math.min(duration, time)))
  }

  return (
    <div ref={containerRef} className="w-full h-full cursor-pointer" onClick={handleClick}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  )
}
