import { VideoFile } from '../types'

export interface ParsedPlaylist {
  name: string
  paths: string[]
}

interface PlaylistFileItem {
  path: string
  name?: string
  type?: string
  autoScriptPath?: string
}

interface ScriptPlayerPlaylistFile {
  app: 'ScriptPlayer+'
  version: 1
  name: string
  updatedAt: string
  items: PlaylistFileItem[]
}

const PLAYLIST_EXTENSION_RE = /\.(spplaylist\.json|playlist\.json|json|m3u8?|txt)$/i

export function serializePlaylist(name: string, files: VideoFile[]): string {
  const data: ScriptPlayerPlaylistFile = {
    app: 'ScriptPlayer+',
    version: 1,
    name: name.trim() || 'ScriptPlayer+ Playlist',
    updatedAt: new Date().toISOString(),
    items: files.map((file) => ({
      path: file.path,
      name: file.name,
      type: file.type,
      autoScriptPath: file.autoScriptPath,
    })),
  }

  return `${JSON.stringify(data, null, 2)}\n`
}

export function parsePlaylistContent(content: string, sourcePath: string): ParsedPlaylist {
  const trimmed = content.trim()
  if (!trimmed) {
    return {
      name: getPlaylistNameFromPath(sourcePath),
      paths: [],
    }
  }

  const parsedJson = parseJsonPlaylist(trimmed, sourcePath)
  if (parsedJson) {
    return parsedJson
  }

  return {
    name: getPlaylistNameFromPath(sourcePath),
    paths: dedupePaths(parseM3uPlaylist(trimmed, sourcePath)),
  }
}

export function getPlaylistNameFromPath(filePath: string): string {
  const fileName = getBaseName(filePath)
  return fileName.replace(PLAYLIST_EXTENSION_RE, '').trim() || 'ScriptPlayer+ Playlist'
}

export function getPlaylistSaveFileName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return `${sanitized || 'ScriptPlayer+ Playlist'}.spplaylist.json`
}

function parseJsonPlaylist(content: string, sourcePath: string): ParsedPlaylist | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  const paths = collectJsonPlaylistPaths(parsed, sourcePath)
  const name = typeof parsed === 'object'
    && parsed !== null
    && !Array.isArray(parsed)
    && typeof (parsed as { name?: unknown }).name === 'string'
    ? (parsed as { name: string }).name.trim()
    : ''

  return {
    name: name || getPlaylistNameFromPath(sourcePath),
    paths: dedupePaths(paths),
  }
}

function collectJsonPlaylistPaths(value: unknown, sourcePath: string): string[] {
  const root = value as {
    items?: unknown
    files?: unknown
    playlist?: unknown
  } | null
  const entries = Array.isArray(value)
    ? value
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root?.files)
        ? root.files
        : Array.isArray(root?.playlist)
          ? root.playlist
          : []

  return entries
    .map((entry) => {
      if (typeof entry === 'string') {
        return resolvePlaylistPath(entry, sourcePath)
      }

      if (!entry || typeof entry !== 'object') {
        return ''
      }

      const candidate = entry as {
        path?: unknown
        filePath?: unknown
        filename?: unknown
      }
      const rawPath = candidate.path ?? candidate.filePath ?? candidate.filename
      return typeof rawPath === 'string' ? resolvePlaylistPath(rawPath, sourcePath) : ''
    })
    .filter(Boolean)
}

function parseM3uPlaylist(content: string, sourcePath: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => resolvePlaylistPath(line, sourcePath))
    .filter(Boolean)
}

function resolvePlaylistPath(rawPath: string, sourcePath: string): string {
  const value = rawPath.trim().replace(/^"(.+)"$/, '$1')
  if (!value) return ''

  const fileUrlPath = parseFileUrlPath(value, sourcePath)
  if (fileUrlPath) return fileUrlPath

  if (isAbsolutePath(value)) {
    return value
  }

  const baseDir = getDirName(sourcePath)
  if (!baseDir) return value

  const separator = baseDir.includes('\\') ? '\\' : '/'
  return `${baseDir.replace(/[\\/]+$/, '')}${separator}${value.replace(/[\\/]+/g, separator)}`
}

function parseFileUrlPath(value: string, sourcePath: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') {
      return ''
    }

    const separator = sourcePath.includes('\\') ? '\\' : '/'
    let filePath = decodeURIComponent(url.pathname)
    if (/^\/[a-zA-Z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
    return filePath.replace(/\//g, separator)
  } catch {
    return ''
  }
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value)
    || value.startsWith('\\\\')
    || value.startsWith('//')
    || value.startsWith('/')
}

function getBaseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || ''
}

function getDirName(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index >= 0 ? filePath.slice(0, index) : ''
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const path of paths) {
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
  }

  return result
}
