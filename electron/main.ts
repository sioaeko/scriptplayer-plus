import { app, BrowserWindow, ipcMain, dialog, protocol, session } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { URL, pathToFileURL } from 'url'
import { OsrSerialManager } from './osrSerial'
import { SCRIPT_AXIS_DEFINITIONS, inferAxisIdFromStem, stripKnownAxisSuffix } from '../src/services/multiaxis'
import { getVideoSubtitleMatchScore, parseSubtitleFile } from '../src/services/subtitles'
import { ScriptAxisId } from '../src/types'

const isMac = process.platform === 'darwin'
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv']
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma']
const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS]
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
const SUBTITLE_EXTS = ['.vtt', '.srt', '.txt']
const SUBTITLE_DIR_KEYWORDS = [
  'script',
  'scripts',
  'subtitle',
  'subtitles',
  'subs',
  'caption',
  'captions',
  'lyric',
  'lyrics',
  'transcript',
  'translation',
  'translated',
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
]
const MAX_SUBTITLE_SEARCH_DEPTH = 2
const MAX_SCAN_SUBTITLE_VALIDATION_CANDIDATES = 3
const MIN_SCAN_SUBTITLE_SCORE = 900
const SCAN_YIELD_INTERVAL = 25
const NATURAL_SORTER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

let mainWindow: BrowserWindow | null = null
const subtitleCandidateCache = new Map<string, string[]>()
const subtitleAnalysisCache = new Map<string, { content: string; hasCues: boolean } | null>()
const directoryEntryNameCache = new Map<string, Set<string>>()
const FUNSCRIPT_EXTS = ['.funscript', '.json']
const osrSerialManager = new OsrSerialManager((state) => {
  mainWindow?.webContents.send('osrSerial:stateChanged', state)
})

function normalizePathKey(targetPath: string): string {
  return process.platform === 'win32' ? targetPath.toLowerCase() : targetPath
}

async function getDirectoryRealPathKey(dirPath: string): Promise<string> {
  try {
    return normalizePathKey(await fs.promises.realpath(dirPath))
  } catch {
    return normalizePathKey(dirPath)
  }
}

function getDirectoryRealPathKeySync(dirPath: string): string {
  try {
    return normalizePathKey(fs.realpathSync.native(dirPath))
  } catch {
    return normalizePathKey(dirPath)
  }
}

function getDirectoryEntryNameSet(dirPath: string): Set<string> {
  const cacheKey = normalizePathKey(dirPath)
  const cached = directoryEntryNameCache.get(cacheKey)
  if (cached) {
    return cached
  }

  let names: string[]
  try {
    names = fs.readdirSync(dirPath)
  } catch {
    names = []
  }

  const collected = new Set(names.map((name) => name.toLowerCase()))
  directoryEntryNameCache.set(cacheKey, collected)
  return collected
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    backgroundColor: '#11111b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  osrSerialManager.setNotifier((state) => {
    mainWindow?.webContents.send('osrSerial:stateChanged', state)
  })
}

app.whenReady().then(() => {
  // Register protocol for local video files
  protocol.registerFileProtocol('local-video', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('local-video://', ''))
    callback({ path: filePath })
  })

  createWindow()

  // macOS: re-create window when dock icon clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())

// File dialogs
ipcMain.handle('dialog:openVideo', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Media', extensions: MEDIA_EXTS.map((ext) => ext.slice(1)) },
    ],
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openScriptFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Funscript', extensions: ['funscript', 'json'] },
    ],
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openSubtitleFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Subtitles', extensions: SUBTITLE_EXTS.map((ext) => ext.slice(1)) },
    ],
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// File system operations
ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
  try {
    const files: Array<{
      name: string
      path: string
      type: 'video' | 'audio'
      hasScript: boolean
      hasSubtitles: boolean
      modifiedAt: number
      relativePath: string
    }> = []
    let scannedEntries = 0
    const visitedDirectories = new Set<string>()

    const maybeYieldDuringScan = async () => {
      scannedEntries += 1
      if (scannedEntries % SCAN_YIELD_INTERVAL === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    const scanDir = async (dir: string, prefix: string): Promise<void> => {
      const visitKey = await getDirectoryRealPathKey(dir)
      if (visitedDirectories.has(visitKey)) {
        return
      }
      visitedDirectories.add(visitKey)

      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        await maybeYieldDuringScan()

        const fullPath = path.join(dir, entry.name)
        if (entry.isSymbolicLink()) {
          continue
        }

        if (entry.isDirectory()) {
          await scanDir(fullPath, prefix ? prefix + '/' + entry.name : entry.name)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (MEDIA_EXTS.includes(ext)) {
            let modifiedAt = 0
            try {
              modifiedAt = (await fs.promises.stat(fullPath)).mtimeMs
            } catch {
              modifiedAt = 0
            }

            const hasSubtitles = hasSubtitlesForMediaScan(fullPath)
            files.push({
              name: entry.name,
              path: fullPath,
              type: VIDEO_EXTS.includes(ext) ? 'video' : 'audio',
              hasScript: hasBundledFunscriptsForMediaScan(fullPath),
              hasSubtitles,
              modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : 0,
              relativePath: prefix ? prefix + '/' + entry.name : entry.name,
            })
          }
        }
      }
    }

    await scanDir(dirPath, '')
    return files.sort((a, b) => NATURAL_SORTER.compare(a.relativePath, b.relativePath))
  } catch {
    return []
  }
})

ipcMain.handle('fs:readFunscript', async (_event, videoPath: string, scriptFolder?: string) => {
  const bundle = readFunscriptBundle(videoPath, scriptFolder)
  if (!bundle?.primaryAxis) return null
  return bundle.scripts[bundle.primaryAxis] ?? null
})

ipcMain.handle('fs:readFunscriptBundle', async (_event, videoPath: string, scriptFolder?: string, preferredScriptPath?: string) => {
  return readFunscriptBundle(videoPath, scriptFolder, preferredScriptPath)
})

ipcMain.handle('fs:saveFunscript', async (_event, videoPath: string, data: string) => {
  const ext = path.extname(videoPath)
  const scriptPath = videoPath.replace(ext, '.funscript')
  try {
    fs.writeFileSync(scriptPath, data, 'utf-8')
    return true
  } catch {
    return false
  }
})

ipcMain.handle('fs:getVideoUrl', async (_event, filePath: string) => {
  // Encode reserved URL characters such as "#" in Windows file names.
  return pathToFileURL(filePath).toString()
})

ipcMain.handle('fs:findArtwork', async (_event, mediaPath: string) => {
  try {
    return findArtworkForMedia(mediaPath)
  } catch {
    return null
  }
})

ipcMain.handle('fs:readSubtitles', async (_event, mediaPath: string) => {
  try {
    return findSubtitleFilesForMedia(mediaPath)
      .map((subtitlePath) => {
        try {
          return {
            path: subtitlePath,
            content: readSubtitleContent(subtitlePath),
          }
        } catch {
          return null
        }
      })
      .filter((entry): entry is { path: string; content: string } => entry !== null)
  } catch {
    return []
  }
})

ipcMain.handle('fs:readFunscriptFile', async (_event, filePath: string) => {
  return readFunscriptJson(filePath)
})

ipcMain.handle('fs:listFunscriptVariants', async (_event, videoPath: string, scriptFolder?: string) => {
  return listFunscriptVariantsForMedia(videoPath, scriptFolder)
})

ipcMain.handle('fs:readSubtitleFile', async (_event, filePath: string) => {
  try {
    return {
      path: filePath,
      content: readSubtitleContent(filePath),
    }
  } catch {
    return null
  }
})

ipcMain.handle('osrSerial:listPorts', async () => {
  try {
    return await osrSerialManager.listPorts()
  } catch {
    return []
  }
})

ipcMain.handle('osrSerial:getState', () => {
  return osrSerialManager.getState()
})

ipcMain.handle('osrSerial:connect', async (_event, portPath: string, baudRate?: number) => {
  return osrSerialManager.connect(portPath, baudRate)
})

ipcMain.handle('osrSerial:disconnect', async () => {
  return osrSerialManager.disconnect()
})

ipcMain.handle('osrSerial:write', async (_event, command: string) => {
  return osrSerialManager.write(command)
})

// ============================================================
// NAS (WebDAV / FTP) Service
// ============================================================

const NAS_EXTS = [...MEDIA_EXTS, '.funscript']

function listFunscriptVariantsForMedia(
  mediaPath: string,
  scriptFolder?: string
): Array<{ path: string; label: string }> {
  const mediaBaseName = path.basename(mediaPath, path.extname(mediaPath))
  const baseLower = mediaBaseName.toLowerCase()
  const searchDirs = [path.dirname(mediaPath)]
  if (scriptFolder) searchDirs.push(scriptFolder)

  // Deduplicate directories so the same folder is never scanned twice
  // (e.g. when scriptFolder is the same directory as the video folder)
  const seenDirs = new Set<string>()
  const uniqueDirs = searchDirs.filter((dir) => {
    const resolved = path.resolve(dir)
    if (seenDirs.has(resolved)) return false
    seenDirs.add(resolved)
    return true
  })

  const variants: Array<{ path: string; label: string }> = []
  const seenStems = new Set<string>()

  for (const dir of uniqueDirs) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      const entryExt = path.extname(entry).toLowerCase()
      if (!FUNSCRIPT_EXTS.includes(entryExt)) continue

      const entryStem = path.basename(entry, path.extname(entry))
      const stemLower = entryStem.toLowerCase()

      // Skip if a file with the same stem was already found in a previous directory
      if (seenStems.has(stemLower)) continue

      let label: string | null = null
      if (stemLower === baseLower) {
        label = 'Default'
      } else if (
        stemLower.startsWith(baseLower)
        && stemLower.length > baseLower.length
        && !/[a-z0-9]/i.test(stemLower[baseLower.length])
      ) {
        // Strip leading separator characters (space, period, dash, underscore, etc.)
        // but preserve characters like '(' that are part of the variant name
        label = entryStem.slice(mediaBaseName.length).replace(/^[ ._\-]+/, '').trim() || 'Default'
      }

      if (label === null) continue

      seenStems.add(stemLower)
      variants.push({ path: path.join(dir, entry), label })
    }
  }

  return variants.sort((a, b) => {
    if (a.label === 'Default') return -1
    if (b.label === 'Default') return 1
    return a.label.localeCompare(b.label)
  })
}

function hasBundledFunscriptsForMediaScan(mediaPath: string): boolean {
  const mediaDir = path.dirname(mediaPath)
  const mediaBaseName = path.basename(mediaPath, path.extname(mediaPath))
  const entryNames = getDirectoryEntryNameSet(mediaDir)

  for (const definition of SCRIPT_AXIS_DEFINITIONS) {
    for (const suffix of definition.suffixes) {
      const fileName = suffix
        ? `${mediaBaseName}.${suffix}.funscript`
        : `${mediaBaseName}.funscript`
      if (entryNames.has(fileName.toLowerCase())) {
        return true
      }
    }
  }

  return false
}

function readFunscriptBundle(
  mediaPath: string,
  scriptFolder?: string,
  preferredScriptPath?: string
): { primaryAxis: ScriptAxisId | null; scripts: Partial<Record<ScriptAxisId, unknown>>; sources: Partial<Record<ScriptAxisId, string>> } | null {
  const bundle: {
    primaryAxis: ScriptAxisId | null
    scripts: Partial<Record<ScriptAxisId, unknown>>
    sources: Partial<Record<ScriptAxisId, string>>
  } = {
    primaryAxis: null,
    scripts: {},
    sources: {},
  }
  const loadedPaths = new Set<string>()
  const mediaBaseName = path.basename(mediaPath, path.extname(mediaPath))

  if (preferredScriptPath) {
    addFunscriptToBundle(bundle, loadedPaths, preferredScriptPath, inferAxisIdFromFilePath(preferredScriptPath))
  }

  const contexts = [
    { dir: path.dirname(mediaPath), baseNames: [mediaBaseName] },
  ]

  if (scriptFolder) {
    contexts.push({ dir: scriptFolder, baseNames: [mediaBaseName] })
  }

  if (preferredScriptPath) {
    const preferredBaseName = stripKnownAxisSuffix(path.basename(preferredScriptPath, path.extname(preferredScriptPath)))
    contexts.unshift({
      dir: path.dirname(preferredScriptPath),
      baseNames: Array.from(new Set([preferredBaseName, mediaBaseName])).filter(Boolean),
    })
  }

  for (const context of contexts) {
    for (const baseName of context.baseNames) {
      addBundleCandidates(bundle, loadedPaths, context.dir, baseName)
    }
  }

  if (bundle.primaryAxis === null) {
    bundle.primaryAxis = Object.keys(bundle.scripts)[0] as ScriptAxisId | undefined ?? null
  }

  return Object.keys(bundle.scripts).length > 0 ? bundle : null
}

function addBundleCandidates(
  bundle: { primaryAxis: ScriptAxisId | null; scripts: Partial<Record<ScriptAxisId, unknown>>; sources: Partial<Record<ScriptAxisId, string>> },
  loadedPaths: Set<string>,
  dirPath: string,
  baseName: string
) {
  for (const definition of SCRIPT_AXIS_DEFINITIONS) {
    if (bundle.scripts[definition.id]) continue

    for (const suffix of definition.suffixes) {
      const fileName = suffix
        ? `${baseName}.${suffix}.funscript`
        : `${baseName}.funscript`
      const filePath = path.join(dirPath, fileName)
      if (!fs.existsSync(filePath)) continue

      addFunscriptToBundle(bundle, loadedPaths, filePath, definition.id)
      break
    }
  }
}

function addFunscriptToBundle(
  bundle: { primaryAxis: ScriptAxisId | null; scripts: Partial<Record<ScriptAxisId, unknown>>; sources: Partial<Record<ScriptAxisId, string>> },
  loadedPaths: Set<string>,
  filePath: string,
  preferredAxis: ScriptAxisId | null
) {
  if (loadedPaths.has(filePath)) return

  const parsed = readFunscriptJson(filePath)
  if (!parsed) return

  const axisId = preferredAxis ?? inferAxisIdFromFilePath(filePath) ?? 'L0'
  if (bundle.scripts[axisId]) return

  bundle.scripts[axisId] = parsed
  bundle.sources[axisId] = filePath
  bundle.primaryAxis = bundle.primaryAxis ?? axisId
  loadedPaths.add(filePath)
}

function inferAxisIdFromFilePath(filePath: string): ScriptAxisId | null {
  const stem = path.basename(filePath, path.extname(filePath))
  return inferAxisIdFromStem(stem)
}

function readFunscriptJson(filePath: string): unknown | null {
  try {
    const ext = path.extname(filePath).toLowerCase()
    if (!FUNSCRIPT_EXTS.includes(ext)) return null
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

function findArtworkForMedia(mediaPath: string): string | null {
  const dir = path.dirname(mediaPath)
  const ext = path.extname(mediaPath)
  const baseName = path.basename(mediaPath, ext).toLowerCase()

  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return null
  }

  const images = entries
    .filter((name) => IMAGE_EXTS.includes(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))

  if (images.length === 0) return null

  const sameBase = images.find((name) => path.basename(name, path.extname(name)).toLowerCase() === baseName)
  if (sameBase) return path.join(dir, sameBase)

  const priorityKeywords = ['cover', 'folder', 'front', 'poster', 'preview', 'artwork', 'album', 'thumb']
  const scored = images
    .map((name) => {
      const stem = path.basename(name, path.extname(name)).toLowerCase()
      let score = 0

      if (stem.includes(baseName)) score += 100
      for (const keyword of priorityKeywords) {
        if (stem === keyword) score += 80
        else if (stem.startsWith(keyword) || stem.endsWith(keyword)) score += 60
        else if (stem.includes(keyword)) score += 40
      }

      return { name, score }
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  if (scored[0]?.score > 0) {
    return path.join(dir, scored[0].name)
  }

  return path.join(dir, images[0])
}

function findSubtitleFilesForMedia(mediaPath: string): string[] {
  return findSubtitleMatches(mediaPath, 'full')
}

function hasSubtitlesForMediaScan(mediaPath: string): boolean {
  return findSubtitleMatches(mediaPath, 'scan').length > 0
}

function findSubtitleMatches(mediaPath: string, mode: 'scan' | 'full'): string[] {
  const mediaDir = path.dirname(mediaPath)
  const ext = path.extname(mediaPath)
  const baseName = path.basename(mediaPath, ext).toLowerCase()
  const mediaType = VIDEO_EXTS.includes(ext.toLowerCase()) ? 'video' : 'audio'

  const rankedCandidates = collectSubtitleCandidates(mediaDir)
    .map((filePath) => {
      return {
        filePath,
        score: scoreSubtitleCandidate(filePath, mediaDir, baseName),
      }
    })
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
  const candidatesToValidate = mode === 'scan'
    ? rankedCandidates.slice(0, MAX_SCAN_SUBTITLE_VALIDATION_CANDIDATES)
    : rankedCandidates
  const matches: Array<{ filePath: string; score: number }> = []

  if (mode === 'scan') {
    return rankedCandidates
      .filter((candidate) => candidate.score >= MIN_SCAN_SUBTITLE_SCORE)
      .map(({ filePath }) => filePath)
  }

  for (const candidate of candidatesToValidate) {
    const analysis = readSubtitleAnalysis(candidate.filePath)
    if (!analysis?.hasCues) continue

    let score = candidate.score
    if (mediaType === 'video') {
      const videoScore = getVideoSubtitleMatchScore(mediaPath, {
        path: candidate.filePath,
        content: analysis.content,
      })
      if (videoScore < 0) continue
      score += videoScore
    }

    matches.push({
      filePath: candidate.filePath,
      score,
    })
  }

  return matches
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
    .map(({ filePath }) => filePath)
}

function collectSubtitleCandidates(rootDir: string): string[] {
  const cacheKey = normalizePathKey(rootDir)
  const cached = subtitleCandidateCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const results = new Set<string>()
  const visited = new Set<string>()

  const walk = (currentDir: string, depth: number, matchedKeyword: boolean) => {
    const visitKey = getDirectoryRealPathKeySync(currentDir)
    if (visited.has(visitKey)) return
    visited.add(visitKey)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (SUBTITLE_EXTS.includes(ext)) {
        results.add(path.join(currentDir, entry.name))
      }
    }

    if (depth >= MAX_SUBTITLE_SEARCH_DEPTH) return

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const nextMatchedKeyword = matchedKeyword || directoryLooksLikeSubtitle(entry.name)
      const shouldDescend = depth === 0 || nextMatchedKeyword
      if (!shouldDescend) continue
      walk(path.join(currentDir, entry.name), depth + 1, nextMatchedKeyword)
    }
  }

  walk(rootDir, 0, false)
  const collected = Array.from(results)
  subtitleCandidateCache.set(cacheKey, collected)
  return collected
}

function directoryLooksLikeSubtitle(name: string): boolean {
  const normalized = name.toLowerCase()
  return SUBTITLE_DIR_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function scoreSubtitleCandidate(filePath: string, mediaDir: string, baseName: string): number {
  const ext = path.extname(filePath).toLowerCase()
  const stem = path.basename(filePath, ext).toLowerCase()
  const fileName = path.basename(filePath).toLowerCase()
  const relativeDir = path.relative(mediaDir, path.dirname(filePath)).toLowerCase()
  const normalizedBaseName = normalizeSubtitleMatchName(baseName)
  const normalizedStem = normalizeSubtitleMatchName(stem)
  const mediaTokens = tokenizeSubtitleMatchName(normalizedBaseName)
  const subtitleTokens = tokenizeSubtitleMatchName(normalizedStem)
  const sharedTokenCount = countSharedTokens(mediaTokens, subtitleTokens)
  const hasDirectNameMatch = stem === baseName
    || normalizedStem === normalizedBaseName
    || normalizedStem.startsWith(`${normalizedBaseName}.`)
    || normalizedStem.startsWith(normalizedBaseName)
    || normalizedBaseName.startsWith(normalizedStem)
    || normalizedStem.includes(normalizedBaseName)
    || normalizedBaseName.includes(normalizedStem)
  const hasKeywordHint = directoryLooksLikeSubtitle(relativeDir)
    || fileName.includes('subtitle')
    || fileName.includes('caption')
    || fileName.includes('lyrics')
    || fileName.includes('자막')
    || fileName.includes('대본')
    || fileName.includes('번역')

  let score = 0

  if (ext === '.vtt') score += 120
  else if (ext === '.srt') score += 90
  else if (ext === '.txt') score += 60

  if (path.dirname(filePath) === mediaDir) score += 40
  if (stem === baseName) score += 1600
  else if (normalizedStem === normalizedBaseName && normalizedStem) score += 1350
  else if (stem.startsWith(`${baseName}.`) || normalizedStem.startsWith(`${normalizedBaseName}.`)) score += 1200
  else if (normalizedStem.startsWith(normalizedBaseName) || normalizedBaseName.startsWith(normalizedStem)) score += 950
  else if (normalizedStem.includes(normalizedBaseName) || normalizedBaseName.includes(normalizedStem)) score += 700

  if (sharedTokenCount > 0) {
    score += sharedTokenCount * 180
  }

  if (directoryLooksLikeSubtitle(relativeDir)) score += 180
  if (fileName.includes('subtitle') || fileName.includes('caption') || fileName.includes('lyrics')) score += 80
  if (fileName.includes('자막') || fileName.includes('대본') || fileName.includes('번역')) score += 80

  if (!hasDirectNameMatch && sharedTokenCount === 0) {
    score -= hasKeywordHint ? 120 : 600
  }

  return score
}

function normalizeSubtitleMatchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(2160p|1440p|1080p|720p|480p|x264|x265|h264|h265|hevc|av1|web[- ]?dl|blu[- ]?ray|bdrip|webrip|hdr|uhd|10bit|8bit|aac|flac|opus)\b/gi, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeSubtitleMatchName(value: string): string[] {
  return value.match(/[a-z0-9\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF]+/gi) ?? []
}

function countSharedTokens(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  return left.filter((token, index) => token.length > 1 && left.indexOf(token) === index && rightSet.has(token)).length
}

function readSubtitleContent(filePath: string): string {
  const buffer = fs.readFileSync(filePath)
  const utf8 = buffer.toString('utf-8')
  const utf8ReplacementCount = countReplacementChars(utf8)

  if (utf8ReplacementCount === 0) {
    return utf8
  }

  try {
    const eucKr = new TextDecoder('euc-kr').decode(buffer)
    if (countReplacementChars(eucKr) < utf8ReplacementCount) {
      return eucKr
    }
  } catch {}

  return utf8
}

function readSubtitleAnalysis(filePath: string): { content: string; hasCues: boolean } | null {
  if (subtitleAnalysisCache.has(filePath)) {
    return subtitleAnalysisCache.get(filePath) ?? null
  }

  try {
    const content = readSubtitleContent(filePath)
    const hasCues = parseSubtitleFile(content, filePath).length > 0
    const analysis = { content, hasCues }
    subtitleAnalysisCache.set(filePath, analysis)
    return analysis
  } catch {
    subtitleAnalysisCache.set(filePath, null)
    return null
  }
}

function countReplacementChars(value: string): number {
  return (value.match(/\uFFFD/g) ?? []).length
}

// ---- WebDAV helpers (raw HTTP) ----

function webdavRequest(
  url: string,
  method: string,
  username: string,
  password: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const mod = isHttps ? https : http

    const auth = Buffer.from(`${username}:${password}`).toString('base64')

    const reqHeaders: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      ...headers,
    }
    if (body) {
      reqHeaders['Content-Type'] = 'application/xml; charset=utf-8'
      reqHeaders['Content-Length'] = Buffer.byteLength(body).toString()
    }

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        })
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function webdavRequestRaw(
  url: string,
  method: string,
  username: string,
  password: string,
  extraHeaders: Record<string, string> = {}
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const mod = isHttps ? https : http

    const auth = Buffer.from(`${username}:${password}`).toString('base64')

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          ...extraHeaders,
        },
        rejectUnauthorized: false,
      },
      (res) => resolve(res)
    )
    req.on('error', reject)
    req.end()
  })
}

function parseWebdavMultistatus(xml: string, basePath: string): Array<{ name: string; isDir: boolean; size: number }> {
  const results: Array<{ name: string; isDir: boolean; size: number }> = []

  // Split on <d:response> or <D:response> or <response>
  const responseBlocks = xml.split(/<(?:d:|D:)?response(?:\s[^>]*)?>/).slice(1)

  for (const block of responseBlocks) {
    // Extract href
    const hrefMatch = block.match(/<(?:d:|D:)?href[^>]*>([^<]+)<\/(?:d:|D:)?href>/)
    if (!hrefMatch) continue
    const href = decodeURIComponent(hrefMatch[1])

    // Skip the base directory itself
    const normalizedBase = basePath.replace(/\/$/, '')
    const normalizedHref = href.replace(/\/$/, '')
    if (normalizedHref === normalizedBase || normalizedHref === '' || normalizedHref === '/') continue

    // Check if collection (directory)
    const isDir = /<(?:d:|D:)?collection\s*\/?>/.test(block)

    // Extract displayname or derive from href
    const displayMatch = block.match(/<(?:d:|D:)?displayname[^>]*>([^<]*)<\/(?:d:|D:)?displayname>/)
    let name = displayMatch ? displayMatch[1] : ''
    if (!name) {
      // Derive from href
      const parts = href.replace(/\/$/, '').split('/')
      name = parts[parts.length - 1] || ''
      name = decodeURIComponent(name)
    }

    if (!name) continue

    // Extract content length
    const sizeMatch = block.match(/<(?:d:|D:)?getcontentlength[^>]*>(\d+)<\/(?:d:|D:)?getcontentlength>/)
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0

    // Filter: only NAS-relevant extensions or directories
    if (!isDir) {
      const ext = path.extname(name).toLowerCase()
      if (!NAS_EXTS.includes(ext)) continue
    }

    results.push({ name, isDir, size })
  }

  return results.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function joinWebdavUrl(baseUrl: string, remotePath: string): string {
  const base = baseUrl.replace(/\/$/, '')
  const p = remotePath.startsWith('/') ? remotePath : '/' + remotePath
  return base + p
}

// ---- WebDAV IPC handlers ----

ipcMain.handle('nas:webdav:connect', async (_event, url: string, username: string, password: string) => {
  try {
    const testUrl = url.replace(/\/$/, '') + '/'
    console.log('[NAS] WebDAV connect test:', testUrl)
    const res = await webdavRequest(
      testUrl,
      'PROPFIND',
      username,
      password,
      { Depth: '0' },
      '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
    )
    console.log('[NAS] WebDAV connect response:', res.status)
    return res.status >= 200 && res.status < 400
  } catch (e) {
    console.error('[NAS] WebDAV connect error:', e)
    return false
  }
})

ipcMain.handle('nas:webdav:list', async (_event, url: string, remotePath: string, username: string, password: string) => {
  try {
    const fullUrl = joinWebdavUrl(url, remotePath).replace(/\/$/, '') + '/'
    const parsed = new URL(fullUrl)

    const res = await webdavRequest(
      fullUrl,
      'PROPFIND',
      username,
      password,
      { Depth: '1' },
      '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>'
    )

    if (res.status >= 200 && res.status < 400) {
      return parseWebdavMultistatus(res.body, parsed.pathname)
    }
    return []
  } catch {
    return []
  }
})

ipcMain.handle('nas:webdav:download', async (_event, url: string, remotePath: string, username: string, password: string) => {
  try {
    const fullUrl = joinWebdavUrl(url, remotePath)
    const fileName = path.basename(remotePath)
    const tempDir = path.join(app.getPath('temp'), 'scriptplayerplus-nas')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    const localPath = path.join(tempDir, fileName)

    const res = await webdavRequestRaw(fullUrl, 'GET', username, password)

    if (!res.statusCode || res.statusCode >= 400) return null

    const ws = fs.createWriteStream(localPath)
    await new Promise<void>((resolve, reject) => {
      res.pipe(ws)
      ws.on('finish', resolve)
      ws.on('error', reject)
    })

    return localPath
  } catch {
    return null
  }
})

// ---- Local HTTP proxy for WebDAV video streaming ----

let proxyServer: http.Server | null = null
let proxyPort = 0
// Store active stream configurations keyed by token
const streamConfigs = new Map<string, { url: string; remotePath: string; username: string; password: string }>()

function ensureProxyServer(): Promise<number> {
  if (proxyServer && proxyPort) return Promise.resolve(proxyPort)

  return new Promise((resolve, reject) => {
    proxyServer = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', `http://localhost`)
      const token = reqUrl.pathname.slice(1) // strip leading /
      const config = streamConfigs.get(token)

      if (!config) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const fullUrl = joinWebdavUrl(config.url, config.remotePath)

      // Forward Range headers for seeking support
      const extraHeaders: Record<string, string> = {}
      if (req.headers.range) {
        extraHeaders['Range'] = req.headers.range
      }

      webdavRequestRaw(fullUrl, 'GET', config.username, config.password, extraHeaders)
        .then((upstream) => {
          const responseHeaders: Record<string, string | string[]> = {}
          if (upstream.headers['content-type']) responseHeaders['Content-Type'] = upstream.headers['content-type']
          if (upstream.headers['content-length']) responseHeaders['Content-Length'] = upstream.headers['content-length']
          if (upstream.headers['content-range']) responseHeaders['Content-Range'] = upstream.headers['content-range']
          if (upstream.headers['accept-ranges']) responseHeaders['Accept-Ranges'] = upstream.headers['accept-ranges']
          responseHeaders['Access-Control-Allow-Origin'] = '*'

          res.writeHead(upstream.statusCode || 200, responseHeaders)
          upstream.pipe(res)
        })
        .catch(() => {
          res.writeHead(502)
          res.end('Upstream error')
        })
    })

    proxyServer.listen(0, '127.0.0.1', () => {
      const addr = proxyServer!.address()
      if (addr && typeof addr === 'object') {
        proxyPort = addr.port
        resolve(proxyPort)
      } else {
        reject(new Error('Failed to get proxy port'))
      }
    })

    proxyServer.on('error', reject)
  })
}

// Clean up proxy on app quit
app.on('before-quit', () => {
  void osrSerialManager.dispose()
  if (proxyServer) {
    proxyServer.close()
    proxyServer = null
    proxyPort = 0
  }
})

ipcMain.handle('nas:webdav:streamUrl', async (_event, url: string, remotePath: string, username: string, password: string) => {
  const port = await ensureProxyServer()
  const token = Buffer.from(`${url}|${remotePath}|${Date.now()}`).toString('base64url')
  streamConfigs.set(token, { url, remotePath, username, password })
  return `http://127.0.0.1:${port}/${token}`
})

// ---- FTP IPC handlers (using basic-ftp, gracefully optional) ----

let BasicFtp: any = null
try {
  BasicFtp = require('basic-ftp')
} catch {
  // basic-ftp not installed — FTP features will be unavailable
}

ipcMain.handle('nas:ftp:connect', async (_event, host: string, port: number, username: string, password: string) => {
  if (!BasicFtp) return false
  const client = new BasicFtp.Client()
  try {
    await client.access({ host, port, user: username, password, secure: false })
    return true
  } catch {
    return false
  } finally {
    client.close()
  }
})

ipcMain.handle('nas:ftp:list', async (_event, host: string, port: number, username: string, password: string, remotePath: string) => {
  if (!BasicFtp) return []
  const client = new BasicFtp.Client()
  try {
    await client.access({ host, port, user: username, password, secure: false })
    const list = await client.list(remotePath || '/')
    const results: Array<{ name: string; isDir: boolean; size: number }> = []

    for (const item of list) {
      const isDir = item.isDirectory || item.type === 2
      if (!isDir) {
        const ext = path.extname(item.name).toLowerCase()
        if (!NAS_EXTS.includes(ext)) continue
      }
      results.push({
        name: item.name,
        isDir: !!isDir,
        size: item.size || 0,
      })
    }

    return results.sort((a: any, b: any) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  } finally {
    client.close()
  }
})

ipcMain.handle('nas:ftp:download', async (_event, host: string, port: number, username: string, password: string, remotePath: string) => {
  if (!BasicFtp) return null
  const client = new BasicFtp.Client()
  try {
    await client.access({ host, port, user: username, password, secure: false })
    const fileName = path.basename(remotePath)
    const tempDir = path.join(app.getPath('temp'), 'scriptplayerplus-nas')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    const localPath = path.join(tempDir, fileName)

    await client.downloadTo(localPath, remotePath)
    return localPath
  } catch {
    return null
  } finally {
    client.close()
  }
})

// ============================================================
// EroScripts Browser Login
// ============================================================

const EROSCRIPTS_DOMAIN = 'discuss.eroscripts.com'
let eroScriptsCookies: string = ''

const eroCookiePath = path.join(app.getPath('userData'), 'ero-session.json')

function saveEroCookies(cookies: string, username: string) {
  try { fs.writeFileSync(eroCookiePath, JSON.stringify({ cookies, username })) } catch {}
}

function loadEroCookies(): { cookies: string; username: string } | null {
  try {
    if (fs.existsSync(eroCookiePath)) {
      return JSON.parse(fs.readFileSync(eroCookiePath, 'utf-8'))
    }
  } catch {}
  return null
}

function clearEroCookies() {
  try { if (fs.existsSync(eroCookiePath)) fs.unlinkSync(eroCookiePath) } catch {}
}

// Restore saved session on startup
const savedEro = loadEroCookies()
if (savedEro) eroScriptsCookies = savedEro.cookies

ipcMain.handle('eroscripts:checkSession', async () => {
  if (!eroScriptsCookies) return { loggedIn: false, username: '' }
  try {
    const body = await makeEroRequest(`https://${EROSCRIPTS_DOMAIN}/session/current.json`, eroScriptsCookies)
    const data = JSON.parse(body)
    if (data.current_user?.username) {
      return { loggedIn: true, username: data.current_user.username }
    }
  } catch {}
  // Session expired
  eroScriptsCookies = ''
  clearEroCookies()
  return { loggedIn: false, username: '' }
})

ipcMain.handle('eroscripts:login', async () => {
  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 900,
      height: 700,
      parent: mainWindow!,
      modal: true,
      title: 'EroScripts Login',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    loginWin.setMenuBarVisibility(false)
    loginWin.loadURL(`https://${EROSCRIPTS_DOMAIN}/login`)

    const checkInterval = setInterval(async () => {
      try {
        const cookies = await loginWin.webContents.session.cookies.get({ domain: EROSCRIPTS_DOMAIN })
        const tCookie = cookies.find(c => c.name === '_t')
        if (!tCookie) return

        clearInterval(checkInterval)

        // Build cookie string
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
        eroScriptsCookies = cookieStr

        // Fetch current user info
        try {
          const resp = await makeEroRequest(`https://${EROSCRIPTS_DOMAIN}/session/current.json`, cookieStr)
          const data = JSON.parse(resp)
          const username = data.current_user?.username || ''
          saveEroCookies(cookieStr, username)
          resolve({ success: true, username, cookies: cookieStr })
        } catch {
          saveEroCookies(cookieStr, '')
          resolve({ success: true, username: '', cookies: cookieStr })
        }

        loginWin.close()
      } catch {
        // window may have been closed
      }
    }, 1500)

    loginWin.on('closed', () => {
      clearInterval(checkInterval)
      resolve({ success: false, username: '', cookies: '' })
    })
  })
})

ipcMain.handle('eroscripts:logout', async () => {
  eroScriptsCookies = ''
  clearEroCookies()
  const ses = session.defaultSession
  const cookies = await ses.cookies.get({ domain: EROSCRIPTS_DOMAIN })
  for (const cookie of cookies) {
    await ses.cookies.remove(`https://${EROSCRIPTS_DOMAIN}`, cookie.name)
  }
  return true
})

ipcMain.handle('eroscripts:fetch', async (_event, url: string) => {
  try {
    const body = await makeEroRequest(url, eroScriptsCookies)
    return { ok: true, data: JSON.parse(body) }
  } catch (e) {
    return { ok: false, data: null, error: String(e) }
  }
})

ipcMain.handle('eroscripts:download', async (_event, url: string, scriptFolder?: string, saveName?: string) => {
  try {
    // Use script folder if set, otherwise temp
    const saveDir = scriptFolder || path.join(app.getPath('temp'), 'scriptplayerplus-ero')
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true })

    const fileName = saveName || decodeURIComponent(url.split('/').pop() || 'script.funscript')
    const localPath = path.join(saveDir, fileName)
    console.log('[EroScripts] Downloading to:', localPath)

    await new Promise<void>((resolve, reject) => {
      const parsed = new URL(url)
      const mod = parsed.protocol === 'https:' ? https : http

      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          Cookie: eroScriptsCookies,
        },
      }, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : `https://${EROSCRIPTS_DOMAIN}${res.headers.location}`
          // Simple one-level redirect follow
          const parsed2 = new URL(redirectUrl)
          const mod2 = parsed2.protocol === 'https:' ? https : http
          mod2.get(redirectUrl, { headers: { Cookie: eroScriptsCookies } }, (res2) => {
            const ws = fs.createWriteStream(localPath)
            res2.pipe(ws)
            ws.on('finish', resolve)
            ws.on('error', reject)
          }).on('error', reject)
          return
        }
        const ws = fs.createWriteStream(localPath)
        res.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
      })
      req.on('error', reject)
      req.end()
    })

    // If it's a funscript, read and return content
    if (localPath.endsWith('.funscript')) {
      const content = fs.readFileSync(localPath, 'utf-8')
      return { ok: true, path: localPath, content }
    }

    return { ok: true, path: localPath }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('eroscripts:getCookies', () => {
  return eroScriptsCookies
})

// Playlist operations
ipcMain.handle('playlist:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [{ name: 'Playlist', extensions: ['m3u8', 'm3u'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null

  const filePath = result.filePaths[0]
  const dir = path.dirname(filePath)

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/)
    const items: { path: string; title: string; duration: number }[] = []
    let pendingDuration = -1
    let pendingTitle = ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === '#EXTM3U') continue
      if (trimmed.startsWith('#EXTINF:')) {
        const rest = trimmed.slice(8)
        const commaIdx = rest.indexOf(',')
        if (commaIdx >= 0) {
          pendingDuration = parseFloat(rest.slice(0, commaIdx)) || -1
          pendingTitle = rest.slice(commaIdx + 1).trim()
        } else {
          pendingDuration = parseFloat(rest) || -1
          pendingTitle = ''
        }
      } else if (!trimmed.startsWith('#')) {
        const resolved = path.isAbsolute(trimmed) ? trimmed : path.join(dir, trimmed)
        items.push({
          path: resolved,
          title: pendingTitle || path.basename(resolved),
          duration: pendingDuration,
        })
        pendingDuration = -1
        pendingTitle = ''
      }
    }
    return items
  } catch {
    return null
  }
})

ipcMain.handle('playlist:saveDialog', async (_event, defaultName?: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName || 'playlist.m3u8',
    filters: [{ name: 'Playlist', extensions: ['m3u8'] }],
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
})

ipcMain.handle('playlist:write', async (_event, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  } catch {
    return false
  }
})

function makeEroRequest(url: string, cookies: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : http

    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Cookie: cookies,
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.on('error', reject)
    req.end()
  })
}
