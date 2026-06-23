import { SubtitleCue, SubtitleFile } from '../types'

const RANGE_LINE_RE = /^\[?((?:(?:\d{1,2}):)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(?:-->|~|[-–—])\s*\[?((?:(?:\d{1,2}):)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(.*)$/
const START_LINE_RE = /^(?:\d+\s*[.)-]?\s*)?\[?((?:(?:\d{1,2}):)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(.*)$/

export function parseSubtitleFile(content: string, filePath: string): SubtitleCue[] {
  const extension = getFileExtension(filePath)

  if (extension === '.vtt') return parseVtt(content)
  if (extension === '.srt') return parseSrt(content)
  if (extension === '.ass' || extension === '.ssa') return parseAss(content)
  if (extension === '.smi' || extension === '.sami') return parseSmi(content)
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

export function parseAss(content: string): SubtitleCue[] {
  const lines = normalizeContent(content).split('\n')
  const cues: SubtitleCue[] = []
  let inEventsSection = false
  let formatFields: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^\[events\]$/i.test(line)) {
      inEventsSection = true
      continue
    }

    if (/^\[[^\]]+\]$/.test(line)) {
      inEventsSection = false
      continue
    }

    if (!inEventsSection) continue

    const formatMatch = line.match(/^Format\s*:\s*(.+)$/i)
    if (formatMatch) {
      formatFields = formatMatch[1].split(',').map((field) => field.trim().toLowerCase())
      continue
    }

    const dialogueMatch = line.match(/^Dialogue\s*:\s*(.+)$/i)
    if (!dialogueMatch) continue

    const fieldCount = Math.max(formatFields.length, 10)
    const fields = splitAssFields(dialogueMatch[1], fieldCount)
    const startIndex = formatFields.indexOf('start')
    const endIndex = formatFields.indexOf('end')
    const textIndex = formatFields.indexOf('text')
    const start = parseFlexibleTimestamp(fields[startIndex >= 0 ? startIndex : 1] ?? '')
    const end = parseFlexibleTimestamp(fields[endIndex >= 0 ? endIndex : 2] ?? '')
    if (start === null || end === null || end < start) continue

    const resolvedTextIndex = textIndex >= 0 ? textIndex : Math.min(9, fields.length - 1)
    const text = sanitizeAssCueText(fields.slice(resolvedTextIndex).join(','))
    if (!text) continue

    cues.push({ start, end, text })
  }

  return cues.sort((a, b) => a.start - b.start || a.end - b.end)
}

export function parseSmi(content: string): SubtitleCue[] {
  const normalized = normalizeContent(content)
  const syncTags: Array<{ index: number; contentStart: number; start: number }> = []
  const syncRe = /<sync\b[^>]*\bstart\s*=\s*["']?(\d+)["']?[^>]*>/gi
  let match: RegExpExecArray | null

  while ((match = syncRe.exec(normalized)) !== null) {
    syncTags.push({
      index: match.index,
      contentStart: syncRe.lastIndex,
      start: Number(match[1]) / 1000,
    })
  }

  const cues: SubtitleCue[] = []

  for (let index = 0; index < syncTags.length; index += 1) {
    const current = syncTags[index]
    const next = syncTags[index + 1]
    const segment = normalized.slice(current.contentStart, next?.index ?? normalized.length)
    const text = extractSmiCueText(segment)
    if (!text) continue

    const inferredEnd = next && next.start > current.start
      ? Math.max(current.start + 0.2, next.start - 0.05)
      : current.start + inferCueDuration(text)

    cues.push({
      start: current.start,
      end: inferredEnd,
      text,
    })
  }

  return cues
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

export function isLikelyMatchingVideoSubtitle(mediaPath: string, subtitleFile: SubtitleFile): boolean {
  return getVideoSubtitleMatchScore(mediaPath, subtitleFile) >= 0
}

export function getVideoSubtitleMatchScore(mediaPath: string, subtitleFile: SubtitleFile): number {
  const mediaInfo = buildSubtitleMatchInfo(mediaPath, '')
  const subtitleInfo = buildSubtitleMatchInfo(subtitleFile.path, subtitleFile.content)

  const mediaHasEpisode = mediaInfo.episodeKeys.length > 0
  const subtitleHasEpisode = subtitleInfo.episodeKeys.length > 0
  const sharesEpisode = hasSharedValue(mediaInfo.episodeKeys, subtitleInfo.episodeKeys)
  const sharedTitleTokens = getSharedTokens(mediaInfo.titleTokens, subtitleInfo.titleTokens)
  const sharedTitleTokenCount = sharedTitleTokens.length
  const sharedFolderTokenCount = countSharedTokens(mediaInfo.folderTokens, subtitleInfo.folderTokens)
  const sharedContextTokenCount = countSharedTokens(mediaInfo.contextTokens, subtitleInfo.contextTokens)
  const hasDirectTitleOverlap = hasOverlappingPhrase(mediaInfo.titlePhrases, subtitleInfo.titlePhrases)
  const hasDirectContextOverlap = hasOverlappingPhrase(mediaInfo.contextPhrases, subtitleInfo.contextPhrases)
  const hasTitleTokenEvidence = hasMeaningfulTitleTokenOverlap(sharedTitleTokens, mediaInfo.titleTokens, subtitleInfo.titleTokens)
  const hasStrongTitleEvidence = hasDirectTitleOverlap || hasTitleTokenEvidence || subtitleInfo.directNameHints > 0
  const hasWorkEvidence = hasStrongTitleEvidence
    || sharedFolderTokenCount > 0
    || hasDirectContextOverlap
    || sharedContextTokenCount >= 2
  const reliesOnlyOnFolderContext = !hasStrongTitleEvidence
    && sharedTitleTokenCount === 0
    && !hasDirectTitleOverlap
    && (sharedFolderTokenCount > 0 || hasDirectContextOverlap || sharedContextTokenCount >= 2)

  if (mediaHasEpisode) {
    if (!subtitleHasEpisode) return -1
    if (!sharesEpisode) return -1
  } else if (subtitleHasEpisode && !hasStrongTitleEvidence && sharedContextTokenCount < 2) {
    return -1
  }

  if (subtitleInfo.hasExplicitTitle && reliesOnlyOnFolderContext) {
    return -1
  }

  let score = 0

  if (mediaHasEpisode && sharesEpisode) score += 600
  if (hasDirectTitleOverlap) score += 380
  if (hasDirectContextOverlap && !hasDirectTitleOverlap) score += 160
  if (sharedTitleTokenCount > 0) score += sharedTitleTokenCount * 220
  if (sharedFolderTokenCount > 0) score += sharedFolderTokenCount * 140
  if (sharedContextTokenCount > sharedTitleTokenCount + sharedFolderTokenCount) {
    score += (sharedContextTokenCount - sharedTitleTokenCount - sharedFolderTokenCount) * 60
  }
  if (subtitleInfo.directNameHints > 0) score += subtitleInfo.directNameHints * 90

  if (mediaHasEpisode && sharesEpisode && subtitleInfo.isEpisodeOnly && hasWorkEvidence) {
    score += 180
  }

  if (mediaHasEpisode && sharesEpisode && !subtitleInfo.hasExplicitTitle && hasWorkEvidence) {
    score += 120
  }

  if (mediaHasEpisode && sharesEpisode && !sharesDominantScript(mediaInfo.titleTokens, subtitleInfo.titleTokens) && hasWorkEvidence) {
    score += 80
  }

  if (mediaHasEpisode) {
    if (!hasWorkEvidence && !subtitleInfo.isEpisodeOnly) return -1
    return score >= 650 ? score : -1
  }

  if (!hasStrongTitleEvidence) {
    return -1
  }

  return hasWorkEvidence ? score : -1
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

function splitAssFields(value: string, count: number): string[] {
  if (count <= 1) return [value.trim()]

  const fields: string[] = []
  let remaining = value

  for (let index = 0; index < count - 1; index += 1) {
    const commaIndex = remaining.indexOf(',')
    if (commaIndex === -1) {
      fields.push(remaining.trim())
      remaining = ''
      break
    }

    fields.push(remaining.slice(0, commaIndex).trim())
    remaining = remaining.slice(commaIndex + 1)
  }

  fields.push(remaining.trim())
  return fields
}

function sanitizeAssCueText(text: string): string {
  return sanitizeCueText(
    text
      .replace(/\{[^}]*}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
  )
}

function extractSmiCueText(segment: string): string {
  const cleaned = segment
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  const paragraphs: string[] = []
  const paragraphRe = /<p\b[^>]*>([\s\S]*?)(?=<p\b|$)/gi
  let match: RegExpExecArray | null

  while ((match = paragraphRe.exec(cleaned)) !== null) {
    paragraphs.push(match[1])
  }

  const candidates = paragraphs.length > 0 ? paragraphs : [cleaned]
  for (const candidate of candidates) {
    const text = sanitizeCueText(candidate)
    if (text) return text
  }

  return ''
}

function sanitizeCueText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) => decodeHtmlCodePoint(codePoint, 16))
    .replace(/&#(\d+);/g, (_match, codePoint) => decodeHtmlCodePoint(codePoint, 10))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
}

function decodeHtmlCodePoint(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix)
  if (!Number.isFinite(codePoint)) return ''

  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return ''
  }
}

interface SubtitleMatchInfo {
  titleTokens: string[]
  folderTokens: string[]
  contextTokens: string[]
  titlePhrases: string[]
  contextPhrases: string[]
  episodeKeys: string[]
  directNameHints: number
  hasExplicitTitle: boolean
  isEpisodeOnly: boolean
}

function buildSubtitleMatchInfo(filePath: string, content: string): SubtitleMatchInfo {
  const ext = getFileExtension(filePath)
  const fileStem = filePath.toLowerCase().endsWith(ext) ? filePath.slice(0, -ext.length) : filePath
  const fileName = fileStem.split(/[\\/]/).pop() || fileStem
  const pathSegments = filePath.split(/[\\/]+/).filter(Boolean)
  const folderNames = pathSegments.slice(Math.max(0, pathSegments.length - 3), -1)
  const headerText = extractSubtitleHeaderText(content)
  const normalizedName = normalizeSubtitleMatchText(fileName)
  const normalizedHeader = normalizeSubtitleMatchText(headerText)
  const normalizedFolders = folderNames
    .map((segment) => normalizeSubtitleMatchText(segment))
    .filter(Boolean)
  const titlePhrases = uniqueValues([
    extractTitlePhrase(normalizedName),
    extractTitlePhrase(normalizedHeader),
  ].filter(Boolean))
  const contextPhrases = uniqueValues([
    ...titlePhrases,
    ...normalizedFolders.map((value) => extractTitlePhrase(value)).filter(Boolean),
  ])
  const titleTokens = tokenizeSubtitleMatchText(titlePhrases.join(' '))
  const folderTokens = tokenizeSubtitleMatchText(normalizedFolders.join(' '))
  const contextTokens = tokenizeSubtitleMatchText(contextPhrases.join(' '))
  const episodeKeys = Array.from(new Set([
    ...extractEpisodeKeys(fileName),
    ...extractEpisodeKeys(headerText),
  ]))
  let directNameHints = 0

  if (normalizedHeader && normalizedName && (
    normalizedHeader.includes(normalizedName)
    || normalizedName.includes(normalizedHeader)
  )) {
    directNameHints += 2
  }

  if (normalizedName && normalizedFolders.some((folder) => (
    folder.includes(normalizedName)
    || normalizedName.includes(folder)
  ))) {
    directNameHints += 1
  }

  return {
    titleTokens,
    folderTokens,
    contextTokens,
    titlePhrases,
    contextPhrases,
    episodeKeys,
    directNameHints,
    hasExplicitTitle: titleTokens.length > 0,
    isEpisodeOnly: episodeKeys.length > 0 && titleTokens.length === 0,
  }
}

function extractSubtitleHeaderText(content: string): string {
  const lines = normalizeContent(content).split('\n')
  const collected: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line === 'WEBVTT') continue
    if (/^\d+$/.test(line)) continue
    if (line.includes('-->')) continue
    if (RANGE_LINE_RE.test(line) || START_LINE_RE.test(line)) continue
    if (/^(NOTE|STYLE|REGION)\b/i.test(line)) continue

    collected.push(line)
    if (collected.length >= 8) break
  }

  return collected.join(' ')
}

function normalizeSubtitleMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(2160p|1440p|1080p|720p|480p|x264|x265|h264|h265|hevc|av1|web[- ]?dl|blu[- ]?ray|bdrip|webrip|hdr|uhd|10bit|8bit|aac|flac|opus|subtitles?|captions?)\b/gi, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeSubtitleMatchText(value: string): string[] {
  return (value.match(/[a-z0-9\u3131-\u318E\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]+/gi) ?? [])
    .filter((token, index, all) => isMeaningfulMatchToken(token) && all.indexOf(token) === index)
}

function extractEpisodeKeys(value: string): string[] {
  const keys = new Set<string>()
  const normalized = value.toLowerCase()

  for (const match of normalized.matchAll(/\bs(\d{1,2})\s*[-_. ]?\s*e(\d{1,3})\b/g)) {
    keys.add(`s${Number(match[1])}e${Number(match[2])}`)
    keys.add(`e${Number(match[2])}`)
  }

  for (const match of normalized.matchAll(/\b(?:ep|episode|e)\s*[-_. ]?(\d{1,3})\b/g)) {
    keys.add(`e${Number(match[1])}`)
  }

  for (const match of normalized.matchAll(/第\s*(\d{1,3})\s*[화話话회]\b/g)) {
    keys.add(`e${Number(match[1])}`)
  }

  for (const match of normalized.matchAll(/\b(\d{1,3})\s*(?:화|話|话|회)\b/g)) {
    keys.add(`e${Number(match[1])}`)
  }

  const compact = normalizeSubtitleMatchText(value).replace(/\s+/g, ' ').trim()
  if (/^(?:episode|ep|e)?\s*\d{1,3}$/i.test(compact)) {
    const numberMatch = compact.match(/(\d{1,3})/)
    if (numberMatch) {
      keys.add(`e${Number(numberMatch[1])}`)
    }
  }

  return Array.from(keys)
}

function countSharedTokens(left: string[], right: string[]): number {
  return getSharedTokens(left, right).length
}

function getSharedTokens(left: string[], right: string[]): string[] {
  if (left.length === 0 || right.length === 0) return []
  const rightSet = new Set(right)
  return left.filter((token) => rightSet.has(token))
}

function hasMeaningfulTitleTokenOverlap(sharedTokens: string[], mediaTokens: string[], subtitleTokens: string[]): boolean {
  if (sharedTokens.length >= 2) {
    return true
  }

  if (sharedTokens.length !== 1) {
    return false
  }

  const [token] = sharedTokens
  if (!token) {
    return false
  }

  const mediaHasOnlyThisTitle = mediaTokens.length === 1
  const subtitleHasOnlyThisTitle = subtitleTokens.length === 1
  const tokenIsSpecific = token.length >= 5 || /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(token)
  return tokenIsSpecific && (mediaHasOnlyThisTitle || subtitleHasOnlyThisTitle)
}

function hasSharedValue(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false
  const rightSet = new Set(right)
  return left.some((value) => rightSet.has(value))
}

function sharesDominantScript(left: string[], right: string[]): boolean {
  const leftScripts = new Set(left.map(detectTokenScript).filter(Boolean))
  const rightScripts = new Set(right.map(detectTokenScript).filter(Boolean))
  if (leftScripts.size === 0 || rightScripts.size === 0) return false
  return Array.from(leftScripts).some((script) => rightScripts.has(script))
}

function extractTitlePhrase(value: string): string {
  return value
    .replace(/\bs\d{1,2}\s*e\d{1,3}\b/gi, ' ')
    .replace(/\b(?:ep|episode|e)\s*[-_. ]?\d{1,3}\b/gi, ' ')
    .replace(/第\s*\d{1,3}\s*[화話话회]/g, ' ')
    .replace(/\b\d{1,3}\s*(?:화|話|话|회)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasOverlappingPhrase(left: string[], right: string[]): boolean {
  for (const leftValue of left) {
    for (const rightValue of right) {
      if (!leftValue || !rightValue) continue
      if (leftValue === rightValue) return true
      if (leftValue.length >= 6 && rightValue.includes(leftValue)) return true
      if (rightValue.length >= 6 && leftValue.includes(rightValue)) return true
    }
  }

  return false
}

function isMeaningfulMatchToken(token: string): boolean {
  if (token.length <= 1) return false
  if (/^\d+$/.test(token)) return false
  if (/^s\d+e\d+$/.test(token)) return false
  if (/^(?:ep|episode|e)\d+$/.test(token)) return false

  return ![
    'subtitle',
    'subtitles',
    'subs',
    'caption',
    'captions',
    'lyrics',
    'lyric',
    'script',
    'scripts',
    'translation',
    'translated',
    'transcript',
    '자막',
    '대본',
    '번역',
    '스크립트',
    '가사',
    '字幕',
    '翻译',
    '翻譯',
    '脚本',
    '歌詞',
    '歌词',
  ].includes(token)
}

function uniqueValues(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function detectTokenScript(token: string): string | null {
  if (/[a-z]/i.test(token)) return 'latin'
  if (/[\uAC00-\uD7A3\u3131-\u318E]/.test(token)) return 'hangul'
  if (/[\u3040-\u30FF]/.test(token)) return 'kana'
  if (/[\u4E00-\u9FFF]/.test(token)) return 'han'
  return null
}
