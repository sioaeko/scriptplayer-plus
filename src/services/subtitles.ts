import { SubtitleCue } from '../types'

const RANGE_LINE_RE = /^\[?((?:(?:\d{1,2}):)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(?:-->|~|[-–—])\s*\[?((?:(?:\d{1,2}):)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(.*)$/
const START_LINE_RE = /^(?:\d+\s*[.)-]?\s*)?\[?((?:(?:\d{1,2}):)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(.*)$/

export function parseSubtitleFile(content: string, filePath: string): SubtitleCue[] {
  const extension = getFileExtension(filePath)

  if (extension === '.vtt') return parseVtt(content)
  if (extension === '.srt') return parseSrt(content)
  if (extension === '.txt') return parseTimedText(content)

  return []
}

export function parseVtt(content: string): SubtitleCue[] {
  const blocks = normalizeContent(content).split(/\n{2,}/)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed || trimmed === 'WEBVTT') continue
    if (trimmed.startsWith('NOTE') || trimmed.startsWith('STYLE') || trimmed.startsWith('REGION')) continue

    const lines = trimmed.split('\n').map((line) => line.trimEnd())
    const timeLineIndex = lines.findIndex((line) => line.includes('-->'))
    if (timeLineIndex === -1) continue

    const [rawStart, rawEndWithSettings] = lines[timeLineIndex].split(/\s+-->\s+/)
    if (!rawStart || !rawEndWithSettings) continue

    const rawEnd = rawEndWithSettings.split(/\s+/)[0]
    const start = parseFlexibleTimestamp(rawStart)
    const end = parseFlexibleTimestamp(rawEnd)
    if (start === null || end === null || end < start) continue

    const text = sanitizeCueText(lines.slice(timeLineIndex + 1).join('\n'))
    if (!text) continue

    cues.push({ start, end, text })
  }

  return cues
}

export function parseSrt(content: string): SubtitleCue[] {
  return parseVtt(content)
}

export function parseTimedText(content: string): SubtitleCue[] {
  const lines = normalizeContent(content).split('\n')
  const cues: SubtitleCue[] = []
  let current: { start: number; end: number | null; lines: string[] } | null = null
  let matchedTimestampLines = 0

  const commitCurrent = (nextStart?: number) => {
    if (!current) return
    const text = sanitizeCueText(current.lines.join('\n'))
    if (!text) {
      current = null
      return
    }

    const explicitEnd = current.end
    const inferredEnd = typeof nextStart === 'number' && nextStart > current.start
      ? Math.max(current.start + 0.2, nextStart - 0.05)
      : current.start + inferCueDuration(text)
    const end = explicitEnd !== null ? Math.max(explicitEnd, current.start + 0.2) : inferredEnd

    cues.push({
      start: current.start,
      end,
      text,
    })
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      if (current?.end !== null) {
        commitCurrent()
      } else if (current && current.lines.length > 0) {
        current.lines.push('')
      }
      continue
    }

    const rangeMatch = line.match(RANGE_LINE_RE)
    if (rangeMatch) {
      const start = parseFlexibleTimestamp(rangeMatch[1])
      const end = parseFlexibleTimestamp(rangeMatch[2])
      if (start !== null && end !== null) {
        matchedTimestampLines += 1
        commitCurrent(start)
        current = {
          start,
          end,
          lines: rangeMatch[3] ? [rangeMatch[3]] : [],
        }
        continue
      }
    }

    const startMatch = line.match(START_LINE_RE)
    if (startMatch) {
      const start = parseFlexibleTimestamp(startMatch[1])
      if (start !== null) {
        matchedTimestampLines += 1
        commitCurrent(start)
        current = {
          start,
          end: null,
          lines: [trimInlineText(startMatch[2])].filter(Boolean),
        }
        continue
      }
    }

    if (current) {
      current.lines.push(line)
    }
  }

  commitCurrent()
  return matchedTimestampLines > 0 ? cues : []
}

export function getActiveSubtitleText(cues: SubtitleCue[], currentTime: number): string {
  return cues
    .filter((cue) => currentTime >= cue.start && currentTime <= cue.end)
    .map((cue) => cue.text)
    .join('\n')
}

function parseFlexibleTimestamp(value: string): number | null {
  const normalized = value.trim().replace(/^\[|\]$/g, '').replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length < 2 || parts.length > 3) return null

  const secondsPart = parts.pop() ?? ''
  const minutesPart = parts.pop() ?? ''
  const hoursPart = parts.pop() ?? '0'
  const secondsMatch = secondsPart.match(/^(\d{2})(?:\.(\d{1,3}))?$/)
  if (!secondsMatch) return null

  const hours = Number(hoursPart)
  const minutes = Number(minutesPart)
  const seconds = Number(secondsMatch[1])
  const milliseconds = Number((secondsMatch[2] ?? '0').padEnd(3, '0'))

  if ([hours, minutes, seconds, milliseconds].some((part) => Number.isNaN(part))) {
    return null
  }

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
}

function normalizeContent(content: string): string {
  return content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function getFileExtension(filePath: string): string {
  const match = filePath.toLowerCase().match(/(\.[^./\\]+)$/)
  return match?.[1] ?? ''
}

function trimInlineText(text: string): string {
  return text.replace(/^[:\-–—>\]\s]+/, '').trim()
}

function inferCueDuration(text: string): number {
  const denseLength = text.replace(/\s+/g, '').length
  return Math.min(8, Math.max(2.5, denseLength * 0.12))
}

function sanitizeCueText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
}
