import { PlaylistItem } from '../types'

export function serializeM3U8(items: PlaylistItem[]): string {
  const lines: string[] = ['#EXTM3U', '']
  for (const item of items) {
    const dur = Number.isFinite(item.duration) && item.duration >= 0
      ? Math.round(item.duration)
      : -1
    lines.push(`#EXTINF:${dur},${item.title}`)
    lines.push(item.path)
    lines.push('')
  }
  return lines.join('\n')
}