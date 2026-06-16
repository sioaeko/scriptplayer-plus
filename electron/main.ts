import { app, BrowserWindow, ipcMain, dialog, protocol, session, shell, clipboard } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { createHash } from 'crypto'
import { URL, pathToFileURL } from 'url'
import { parseFile } from 'music-metadata'
import { OsrSerialManager } from './osrSerial'
import { SCRIPT_AXIS_DEFINITIONS, inferAxisIdFromStem, stripKnownAxisSuffix } from '../src/services/multiaxis'
import { getVideoSubtitleMatchScore, parseSubtitleFile } from '../src/services/subtitles'
import { ScriptAxisId, ScriptMediaMatchCandidate, ScriptVariantOption, VideoFile } from '../src/types'

const isMac = process.platform === 'darwin'
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv']
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma']
const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS]
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
const SUBTITLE_EXTS = ['.vtt', '.srt', '.ass', '.ssa', '.smi', '.sami', '.txt']
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
const SCRIPT_DECORATOR_SUFFIX_RE = /(?:[ _.-]+(?:ufotw|ufosa|cyclone|launch|ufo|handy))+$/i
const SCRIPT_LABEL_SUFFIX_RE = /(?:[ _.-]+funscript(?:\([^)]*\))?)$/i
const TRAILING_VARIANT_SUFFIX_RE = /(?:[ _.-]*げっぷ音緩和差分|[ _.-]*[（(][^()（）]*(?:差分|少なめ)[^()（）]*[)）])$/i
const TRAILING_VARIANT_WORD_SUFFIX_RE = /(?:[ _.-]+(?:audio|alt|alternate|variant|edit|edited|fix|fixed|sync|offset|generated|ai|motion|experimental))+$/i
const FUNSCRIPT_EXTS = ['.funscript', '.json', '.csv']
const SEGMENT_REPEAT_STORE_FILE = 'ScriptPlayerPlus.segments.json'
const EMBEDDED_ARTWORK_CACHE_DIR = 'scriptplayer-plus-audio-artwork'
const osrSerialManager = new OsrSerialManager((state) => {
  mainWindow?.webContents.send('osrSerial:stateChanged', state)
})

type VideoCompatibilityMode = 'auto' | 'disable-gpu-video-decode' | 'disable-hardware-acceleration' | 'software-renderer'

interface RuntimePreferences {
  videoCompatibilityMode: VideoCompatibilityMode
}

const RUNTIME_PREFERENCES_FILE = 'runtime-preferences.json'
const PUBLIC_RELEASES_URL = 'https://github.com/sioaeko/scriptplayer-plus/releases'
const DEFAULT_RUNTIME_PREFERENCES: RuntimePreferences = {
  videoCompatibilityMode: 'auto',
}

type UpdaterPhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
type InstallationType = 'development' | 'installer' | 'portable' | 'appimage' | 'app-bundle' | 'packaged'

interface UpdaterState {
  currentVersion: string
  phase: UpdaterPhase
  updateAvailable: boolean | null
  latestVersion: string | null
  releaseName: string | null
  releaseUrl: string
  error: string | null
  progressPercent: number | null
  autoUpdateSupported: boolean
  canDownloadUpdate: boolean
  installationType: InstallationType
}

if (!app.isPackaged) {
  const sharedUserDataPath = path.join(app.getPath('appData'), 'scriptplayer-plus')
  const targetUserDataPath = process.env.SCRIPTPLAYER_USE_DEV_PROFILE === '1'
    ? `${sharedUserDataPath}-dev`
    : sharedUserDataPath
  app.setPath('userData', targetUserDataPath)
}

let runtimePreferences = loadRuntimePreferences()
applyRuntimePreferences(runtimePreferences)
let updaterConfigured = false
let updaterState: UpdaterState = createInitialUpdaterState()

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

process.on('uncaughtException', (error) => {
  handleMainProcessError(error, 'uncaughtException')
})

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  handleMainProcessError(error, 'unhandledRejection')
})

type BundledScriptAxisIndex = Map<string, Map<string, Set<ScriptAxisId>>>
type BundledScriptLocationIndex = Map<string, Map<string, { path: string; topLevelGroup: string }>>

interface FunscriptFileEntry {
  dir: string
  name: string
  path: string
  topLevelGroup: string
}

interface BundledScriptIndex {
  locations: BundledScriptLocationIndex
  aliasLocations: BundledScriptLocationIndex
  axes: BundledScriptAxisIndex
}

interface CachedBundledScriptIndex {
  index: BundledScriptIndex
  scannedAt: number
}

function createBundledScriptIndex(): BundledScriptIndex {
  return {
    locations: new Map(),
    aliasLocations: new Map(),
    axes: new Map(),
  }
}

const scriptFolderIndexCache = new Map<string, CachedBundledScriptIndex>()
const SCRIPT_FOLDER_INDEX_CACHE_TTL_MS = 60_000

function normalizePathKey(targetPath: string): string {
  return process.platform === 'win32' ? targetPath.toLowerCase() : targetPath
}

function isLikelyNetworkPath(targetPath?: string | null): boolean {
  if (!targetPath) return false
  const trimmed = targetPath.trim()
  return trimmed.startsWith('\\\\') || trimmed.startsWith('//')
}

async function inspectMediaFilePaths(filePaths: string[], scriptFolder?: string): Promise<VideoFile[]> {
  const files: VideoFile[] = []
  const seenPaths = new Set<string>()

  for (const rawPath of filePaths) {
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      continue
    }

    const filePath = path.normalize(rawPath)
    const pathKey = normalizePathKey(filePath)
    if (seenPaths.has(pathKey)) {
      continue
    }
    seenPaths.add(pathKey)

    const ext = path.extname(filePath).toLowerCase()
    if (!MEDIA_EXTS.includes(ext)) {
      continue
    }

    let stats: fs.Stats
    try {
      stats = await fs.promises.stat(filePath)
      if (!stats.isFile()) {
        continue
      }
    } catch {
      continue
    }

    const useNetworkSafeSubtitleScan = isLikelyNetworkPath(filePath) || isLikelyNetworkPath(scriptFolder)
    const bundle = readFunscriptBundle(filePath, scriptFolder)
    const scriptAxes = SCRIPT_AXIS_DEFINITIONS
      .map((definition) => definition.id)
      .filter((axisId) => Boolean(bundle?.scripts[axisId]))
    const primaryScriptPath = bundle?.primaryAxis
      ? bundle.sources[bundle.primaryAxis]
      : undefined

    files.push({
      name: path.basename(filePath),
      path: filePath,
      type: VIDEO_EXTS.includes(ext) ? 'video' : 'audio',
      hasScript: scriptAxes.length > 0,
      autoScriptPath: primaryScriptPath,
      scriptAxes,
      hasSubtitles: useNetworkSafeSubtitleScan ? false : hasSubtitlesForMediaScan(filePath),
      modifiedAt: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0,
      relativePath: filePath.replace(/\\/g, '/'),
    })
  }

  return files.sort((a, b) => NATURAL_SORTER.compare(a.relativePath || a.path, b.relativePath || b.path))
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

function invalidateFsCachesForRoot(rootPath: string) {
  const normalizedRoot = normalizePathKey(path.resolve(rootPath))

  for (const cacheKey of Array.from(subtitleCandidateCache.keys())) {
    if (isSamePathOrChildPath(cacheKey, normalizedRoot)) {
      subtitleCandidateCache.delete(cacheKey)
    }
  }

  for (const cacheKey of Array.from(directoryEntryNameCache.keys())) {
    if (isSamePathOrChildPath(cacheKey, normalizedRoot)) {
      directoryEntryNameCache.delete(cacheKey)
    }
  }

  for (const cacheKey of Array.from(subtitleAnalysisCache.keys())) {
    if (isSamePathOrChildPath(normalizePathKey(path.resolve(cacheKey)), normalizedRoot)) {
      subtitleAnalysisCache.delete(cacheKey)
    }
  }

  for (const cacheKey of Array.from(scriptFolderIndexCache.keys())) {
    if (isSamePathOrChildPath(cacheKey, normalizedRoot) || isSamePathOrChildPath(normalizedRoot, cacheKey)) {
      scriptFolderIndexCache.delete(cacheKey)
    }
  }
}

function isSamePathOrChildPath(targetPath: string, rootPath: string): boolean {
  if (targetPath === rootPath) {
    return true
  }

  const normalizedRoot = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`
  return targetPath.startsWith(normalizedRoot)
}

function getRuntimePreferencesPath(): string {
  return path.join(app.getPath('userData'), RUNTIME_PREFERENCES_FILE)
}

function normalizeVideoCompatibilityMode(value: unknown): VideoCompatibilityMode {
  switch (value) {
    case 'disable-gpu-video-decode':
    case 'disable-hardware-acceleration':
    case 'software-renderer':
      return value
    default:
      return 'auto'
  }
}

function normalizeRuntimePreferences(value: unknown): RuntimePreferences {
  const input = value && typeof value === 'object'
    ? value as Partial<RuntimePreferences>
    : {}

  return {
    videoCompatibilityMode: normalizeVideoCompatibilityMode(input.videoCompatibilityMode),
  }
}

function loadRuntimePreferences(): RuntimePreferences {
  try {
    const raw = fs.readFileSync(getRuntimePreferencesPath(), 'utf8')
    return normalizeRuntimePreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_RUNTIME_PREFERENCES
  }
}

function saveRuntimePreferences(preferences: RuntimePreferences): RuntimePreferences {
  const normalized = normalizeRuntimePreferences(preferences)
  fs.mkdirSync(path.dirname(getRuntimePreferencesPath()), { recursive: true })
  fs.writeFileSync(getRuntimePreferencesPath(), JSON.stringify(normalized, null, 2))
  runtimePreferences = normalized
  return normalized
}

function applyRuntimePreferences(preferences: RuntimePreferences): void {
  switch (preferences.videoCompatibilityMode) {
    case 'disable-gpu-video-decode':
      app.commandLine.appendSwitch('disable-accelerated-video-decode')
      break
    case 'disable-hardware-acceleration':
      app.disableHardwareAcceleration()
      app.commandLine.appendSwitch('disable-accelerated-video-decode')
      break
    case 'software-renderer':
      app.disableHardwareAcceleration()
      app.commandLine.appendSwitch('disable-gpu')
      app.commandLine.appendSwitch('disable-accelerated-video-decode')
      break
    case 'auto':
    default:
      break
  }
}

function handleMainProcessError(error: Error, source: string): void {
  const message = error?.message || String(error)
  const stack = error?.stack || message
  console.error(`[main:${source}]`, stack)

  mainWindow?.webContents.send('app:mainProcessError', {
    source,
    message,
    recoverable: /GetOverlappedResult|Operation aborted|Writing to COM port/i.test(message),
  })
}

function createInitialUpdaterState(): UpdaterState {
  const installationType = detectInstallationType()
  const autoUpdateSupported = isAutoUpdateSupported(installationType)

  return {
    currentVersion: app.getVersion(),
    phase: 'idle',
    updateAvailable: null,
    latestVersion: null,
    releaseName: null,
    releaseUrl: `${PUBLIC_RELEASES_URL}/latest`,
    error: null,
    progressPercent: null,
    autoUpdateSupported,
    canDownloadUpdate: autoUpdateSupported,
    installationType,
  }
}

function detectInstallationType(): InstallationType {
  if (!app.isPackaged) {
    return 'development'
  }

  if (process.platform === 'linux') {
    return process.env.APPIMAGE ? 'appimage' : 'packaged'
  }

  if (process.platform === 'darwin') {
    return 'app-bundle'
  }

  if (process.platform === 'win32') {
    const exePath = app.getPath('exe').toLowerCase()
    const localPrograms = path.join(app.getPath('home'), 'AppData', 'Local', 'Programs').toLowerCase()
    const programFiles = (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase()
    const programFilesX86 = (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase()

    if (exePath.startsWith(localPrograms) || exePath.startsWith(programFiles) || exePath.startsWith(programFilesX86)) {
      return 'installer'
    }

    return 'portable'
  }

  return 'packaged'
}

function isAutoUpdateSupported(installationType: InstallationType): boolean {
  if (!app.isPackaged) return false
  if (installationType === 'development' || installationType === 'portable' || installationType === 'packaged') return false
  return true
}

function configureAutoUpdater(): void {
  if (updaterConfigured) return
  updaterConfigured = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    setUpdaterState({
      phase: 'checking',
      error: null,
      progressPercent: null,
    })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdaterState({
      phase: 'available',
      updateAvailable: true,
      latestVersion: info.version || null,
      releaseName: info.releaseName || `v${info.version}`,
      releaseUrl: `${PUBLIC_RELEASES_URL}/tag/v${info.version}`,
      error: null,
      progressPercent: null,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setUpdaterState({
      phase: 'idle',
      updateAvailable: false,
      latestVersion: info.version || app.getVersion(),
      releaseName: info.releaseName || `v${info.version || app.getVersion()}`,
      releaseUrl: `${PUBLIC_RELEASES_URL}/latest`,
      error: null,
      progressPercent: null,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setUpdaterState({
      phase: 'downloading',
      progressPercent: Number.isFinite(progress.percent) ? progress.percent : null,
      error: null,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setUpdaterState({
      phase: 'downloaded',
      updateAvailable: true,
      latestVersion: info.version || updaterState.latestVersion,
      releaseName: info.releaseName || updaterState.releaseName,
      releaseUrl: `${PUBLIC_RELEASES_URL}/tag/v${info.version || updaterState.latestVersion}`,
      progressPercent: 100,
      error: null,
    })
  })

  autoUpdater.on('error', (error) => {
    setUpdaterState({
      phase: 'error',
      error: error instanceof Error && error.message ? error.message : String(error),
      progressPercent: null,
    })
  })
}

function setUpdaterState(patch: Partial<UpdaterState>): UpdaterState {
  const installationType = detectInstallationType()
  const autoUpdateSupported = isAutoUpdateSupported(installationType)

  updaterState = {
    ...updaterState,
    ...patch,
    currentVersion: app.getVersion(),
    installationType,
    autoUpdateSupported,
    canDownloadUpdate: autoUpdateSupported && (patch.updateAvailable ?? updaterState.updateAvailable) === true,
  }
  mainWindow?.webContents.send('updater:state', updaterState)
  return updaterState
}

function getUpdaterUnavailableState(message: string): UpdaterState {
  return setUpdaterState({
    phase: 'error',
    error: message,
    progressPercent: null,
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 800,
    minWidth: 1280,
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
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173' : '')
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl).catch(() => {
      if (!mainWindow) return
      void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  osrSerialManager.setNotifier((state) => {
    mainWindow?.webContents.send('osrSerial:stateChanged', state)
  })

  configureBluetoothRemoteSupport(mainWindow)
}

function configureBluetoothRemoteSupport(window: BrowserWindow): void {
  const ses = window.webContents.session
  let bluetoothSelectCallback: ((deviceId: string) => void) | null = null
  let bluetoothSelectTimer: NodeJS.Timeout | null = null

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const permissionName = String(permission)
    if (permissionName === 'bluetooth' || permissionName === 'bluetoothScanning') {
      callback(true)
      return
    }
    callback(false)
  })

  window.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault()
    bluetoothSelectCallback ??= callback
    const remote = deviceList.find((device) => (device.deviceName || '').startsWith('SP+ Remote'))
    if (remote) {
      if (bluetoothSelectTimer) {
        clearTimeout(bluetoothSelectTimer)
        bluetoothSelectTimer = null
      }
      bluetoothSelectCallback?.(remote.deviceId)
      bluetoothSelectCallback = null
      return
    }

    if (!bluetoothSelectTimer) {
      bluetoothSelectTimer = setTimeout(() => {
        bluetoothSelectCallback?.('')
        bluetoothSelectCallback = null
        bluetoothSelectTimer = null
      }, 8000)
    }
  })
}

app.whenReady().then(() => {
  configureAutoUpdater()

  // Register protocol for local video files
  protocol.registerFileProtocol('local-video', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('local-video://', ''))
    callback({ path: filePath })
  })

  createWindow()

  if (updaterState.autoUpdateSupported) {
    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch(() => {
        // The updater state is updated by the error event.
      })
    }, 10000)
  }

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
ipcMain.handle('window:setAlwaysOnTop', (_event, enabled: boolean) => {
  mainWindow?.setAlwaysOnTop(Boolean(enabled))
  return mainWindow?.isAlwaysOnTop() ?? false
})

ipcMain.handle('app:getRuntimePreferences', () => runtimePreferences)

ipcMain.handle('app:setRuntimePreferences', (_event, preferences: RuntimePreferences) => (
  saveRuntimePreferences(preferences)
))

ipcMain.handle('updater:getState', () => updaterState)

ipcMain.handle('updater:checkForUpdates', async () => {
  if (!updaterState.autoUpdateSupported) {
    return getUpdaterUnavailableState('Automatic install is not available for this build. Please use the release page.')
  }

  configureAutoUpdater()
  await autoUpdater.checkForUpdates()
  return updaterState
})

ipcMain.handle('updater:downloadUpdate', async () => {
  if (!updaterState.canDownloadUpdate) {
    return getUpdaterUnavailableState('Automatic download is not available for this build. Please use the release page.')
  }

  configureAutoUpdater()
  setUpdaterState({ phase: 'downloading', error: null, progressPercent: 0 })
  await autoUpdater.downloadUpdate()
  return updaterState
})

ipcMain.handle('updater:quitAndInstall', () => {
  if (updaterState.phase !== 'downloaded') {
    return false
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true)
  })
  return true
})

ipcMain.handle('clipboard:writeText', async (_event, text: string) => {
  if (typeof text !== 'string') return false
  clipboard.writeText(text)
  return true
})

ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return false
  }

  if (!fs.existsSync(filePath)) {
    return false
  }

  shell.showItemInFolder(filePath)
  return true
})

ipcMain.handle('shell:trashItem', async (_event, filePath: string) => {
  try {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      return false
    }

    if (!fs.existsSync(filePath)) {
      return false
    }

    await shell.trashItem(filePath)
    invalidateFsCachesForRoot(path.dirname(filePath))
    return true
  } catch {
    return false
  }
})

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  try {
    if (typeof url !== 'string' || url.trim().length === 0) {
      return false
    }

    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false
    }

    await shell.openExternal(parsed.toString())
    return true
  } catch {
    return false
  }
})

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

ipcMain.handle('dialog:openMediaFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: MEDIA_EXTS.map((ext) => ext.slice(1)) },
    ],
  })
  if (result.canceled) return []
  return result.filePaths
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
      { name: 'Funscript', extensions: ['funscript', 'json', 'csv'] },
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

ipcMain.handle('dialog:openPlaylistFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Playlist', extensions: ['json', 'm3u', 'm3u8', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled) return null

  const filePath = result.filePaths[0]
  try {
    return {
      path: filePath,
      content: await fs.promises.readFile(filePath, 'utf-8'),
    }
  } catch {
    return null
  }
})

ipcMain.handle('dialog:savePlaylistFile', async (_event, defaultName: string, content: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName || 'ScriptPlayer+ Playlist.spplaylist.json',
    filters: [
      { name: 'ScriptPlayer+ Playlist', extensions: ['json'] },
      { name: 'JSON', extensions: ['json'] },
    ],
  })
  if (result.canceled || !result.filePath) return null

  try {
    await fs.promises.writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  } catch {
    return null
  }
})

// File system operations
ipcMain.handle('fs:readDir', async (_event, dirPath: string, scriptFolder?: string) => {
  try {
    const useNetworkSafeScan = isLikelyNetworkPath(dirPath) || isLikelyNetworkPath(scriptFolder)
    invalidateFsCachesForRoot(dirPath)

    const files: Array<{
      name: string
      path: string
      type: 'video' | 'audio'
      hasScript: boolean
      autoScriptPath?: string
      scriptAxes: ScriptAxisId[]
      hasSubtitles: boolean
      modifiedAt: number
      relativePath: string
    }> = []
    const pendingMediaFiles: Array<{
      name: string
      path: string
      type: 'video' | 'audio'
      hasSubtitles: boolean
      modifiedAt: number
      relativePath: string
      topLevelGroup: string
    }> = []
    const bundledScriptIndex = createBundledScriptIndex()
    let scriptFolderIndex = createBundledScriptIndex()
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

      directoryEntryNameCache.set(
        normalizePathKey(dir),
        new Set(entries.map((entry) => entry.name.toLowerCase()))
      )

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
          if (FUNSCRIPT_EXTS.includes(ext)) {
            indexBundledScriptFile(
              bundledScriptIndex,
              dir,
              prefix.split('/')[0] ?? '',
              entry.name,
              fullPath
            )
          }

          if (MEDIA_EXTS.includes(ext)) {
            let modifiedAt = 0
            try {
              modifiedAt = (await fs.promises.stat(fullPath)).mtimeMs
            } catch {
              modifiedAt = 0
            }

            const hasSubtitles = useNetworkSafeScan ? false : hasSubtitlesForMediaScan(fullPath)
            pendingMediaFiles.push({
              name: entry.name,
              path: fullPath,
              type: VIDEO_EXTS.includes(ext) ? 'video' : 'audio',
              hasSubtitles,
              modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : 0,
              relativePath: prefix ? prefix + '/' + entry.name : entry.name,
              topLevelGroup: prefix.split('/')[0] ?? '',
            })
          }
        }
      }
    }

    await scanDir(dirPath, '')

    if (scriptFolder && normalizePathKey(scriptFolder) !== normalizePathKey(dirPath)) {
      scriptFolderIndex = await getCachedScriptFolderIndex(scriptFolder, maybeYieldDuringScan)
    }

    const hasRootLevelMedia = pendingMediaFiles.some((mediaFile) => !mediaFile.relativePath.includes('/'))
    const distinctTopLevelMediaGroups = new Set(
      pendingMediaFiles
        .map((mediaFile) => mediaFile.topLevelGroup)
        .filter(Boolean)
    ).size
    const restrictFallbackByTopLevelGroup = !hasRootLevelMedia && distinctTopLevelMediaGroups > 1

    for (const mediaFile of pendingMediaFiles) {
      await maybeYieldDuringScan()

      const hasLocalBundle = hasBundledScriptCandidateInDirectory(mediaFile.path, bundledScriptIndex.locations)
      const bundledFallbackScriptPath = hasLocalBundle
        ? null
        : findUniqueBundledScriptFallback(
          mediaFile.path,
          mediaFile.topLevelGroup,
          restrictFallbackByTopLevelGroup,
          bundledScriptIndex.locations,
          bundledScriptIndex.aliasLocations
        )
      const scriptFolderFallbackPath = hasLocalBundle || !scriptFolder || normalizePathKey(scriptFolder) === normalizePathKey(path.dirname(mediaFile.path))
        ? null
        : findUniqueBundledScriptFallback(
          mediaFile.path,
          '',
          false,
          scriptFolderIndex.locations,
          scriptFolderIndex.aliasLocations
        )
      const fallbackScriptPath = bundledFallbackScriptPath ?? scriptFolderFallbackPath
      const candidateDirs = [path.dirname(mediaFile.path)]
      if (scriptFolder && normalizePathKey(scriptFolder) !== normalizePathKey(path.dirname(mediaFile.path))) {
        candidateDirs.push(scriptFolder)
      }
      const scriptAxes = collectMediaScanScriptAxes(
        mediaFile.path,
        candidateDirs,
        [fallbackScriptPath],
        [bundledScriptIndex.axes, scriptFolderIndex.axes]
      )

      files.push({
        ...mediaFile,
        hasScript: hasLocalBundle || Boolean(bundledFallbackScriptPath) || Boolean(scriptFolderFallbackPath),
        autoScriptPath: fallbackScriptPath ?? undefined,
        scriptAxes,
      })
    }

    return files.sort((a, b) => NATURAL_SORTER.compare(a.relativePath, b.relativePath))
  } catch {
    return []
  }
})

ipcMain.handle('fs:inspectMediaFiles', async (_event, filePaths: string[], scriptFolder?: string) => {
  try {
    if (!Array.isArray(filePaths)) {
      return []
    }

    return inspectMediaFilePaths(filePaths, scriptFolder)
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

ipcMain.handle('fs:listScriptVariants', async (_event, videoPath: string, scriptFolder?: string) => {
  return listScriptVariants(videoPath, scriptFolder)
})

ipcMain.handle(
  'fs:findMediaForScript',
  async (_event, scriptPath: string, candidateMediaPaths?: string[], preferredMediaPath?: string) => {
    return findMediaForScript(scriptPath, candidateMediaPaths, preferredMediaPath)
  }
)

ipcMain.handle(
  'fs:listMediaMatchesForScript',
  async (_event, scriptPath: string, candidateMediaPaths?: string[], preferredMediaPath?: string) => {
    return listMediaMatchesForScript(scriptPath, candidateMediaPaths, preferredMediaPath)
  }
)

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

function getSegmentRepeatStorePath(scriptFolder: string): string | null {
  if (!scriptFolder || typeof scriptFolder !== 'string') {
    return null
  }

  const resolvedFolder = path.resolve(scriptFolder)
  return path.join(resolvedFolder, SEGMENT_REPEAT_STORE_FILE)
}

ipcMain.handle('fs:readSegmentRepeatStore', async (_event, scriptFolder: string) => {
  const filePath = getSegmentRepeatStorePath(scriptFolder)
  if (!filePath) {
    return { ok: false, exists: false, error: 'Invalid script folder' }
  }

  try {
    await fs.promises.access(path.dirname(filePath), fs.constants.R_OK | fs.constants.W_OK)
  } catch {
    return { ok: false, exists: false, path: filePath, error: 'Script folder is not accessible' }
  }

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8')
    return { ok: true, exists: true, path: filePath, content }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: true, exists: false, path: filePath }
    }
    return { ok: false, exists: false, path: filePath, error: String(error) }
  }
})

ipcMain.handle('fs:writeSegmentRepeatStore', async (_event, scriptFolder: string, content: string) => {
  const filePath = getSegmentRepeatStorePath(scriptFolder)
  if (!filePath) {
    return { ok: false, error: 'Invalid script folder' }
  }

  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, content, 'utf-8')
    return { ok: true, path: filePath }
  } catch (error) {
    return { ok: false, path: filePath, error: String(error) }
  }
})

ipcMain.handle('fs:getVideoUrl', async (_event, filePath: string) => {
  // Encode reserved URL characters such as "#" in Windows file names.
  return pathToFileURL(filePath).toString()
})

ipcMain.handle('fs:findArtwork', async (_event, mediaPath: string, rootHint?: string) => {
  try {
    return await findArtworkForMedia(mediaPath, rootHint)
  } catch {
    return null
  }
})

ipcMain.handle('fs:readSubtitles', async (_event, mediaPath: string) => {
  try {
    if (isLikelyNetworkPath(mediaPath)) {
      return []
    }

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

const NAS_EXTS = [...MEDIA_EXTS, ...FUNSCRIPT_EXTS]

function findUniqueBundledScriptFallback(
  mediaPath: string,
  mediaTopLevelGroup: string,
  restrictByTopLevelGroup: boolean,
  bundledScriptLocations: Map<string, Map<string, { path: string; topLevelGroup: string }>>,
  bundledScriptAliasLocations: Map<string, Map<string, { path: string; topLevelGroup: string }>>
): string | null {
  const mediaBaseName = normalizeBundledScriptBaseName(path.basename(mediaPath, path.extname(mediaPath)))
  const candidateLocations = bundledScriptLocations.get(mediaBaseName)
  const exactCandidate = pickUniqueBundledScriptCandidate(
    mediaPath,
    mediaTopLevelGroup,
    restrictByTopLevelGroup,
    candidateLocations
  )
  if (exactCandidate) {
    return exactCandidate
  }

  const mediaAlias = normalizeBundledScriptFallbackKey(mediaBaseName)
  if (!mediaAlias) {
    return null
  }

  return pickUniqueBundledScriptCandidate(
    mediaPath,
    mediaTopLevelGroup,
    restrictByTopLevelGroup,
    bundledScriptAliasLocations.get(mediaAlias)
  )
}

function hasBundledScriptCandidateInDirectory(
  mediaPath: string,
  bundledScriptLocations: Map<string, Map<string, { path: string; topLevelGroup: string }>>
): boolean {
  const mediaBaseName = normalizeBundledScriptBaseName(path.basename(mediaPath, path.extname(mediaPath)))
  if (!mediaBaseName) {
    return false
  }

  const candidateLocations = bundledScriptLocations.get(mediaBaseName)
  if (!candidateLocations) {
    return false
  }

  const mediaDirKey = normalizePathKey(path.dirname(mediaPath))
  for (const candidateDir of candidateLocations.keys()) {
    if (normalizePathKey(candidateDir) === mediaDirKey) {
      return true
    }
  }

  return false
}

function collectIndexedBundledScriptAxes(
  bundledScriptAxes: BundledScriptAxisIndex,
  dirPath: string,
  baseName: string
): ScriptAxisId[] {
  const normalizedBaseName = normalizeBundledScriptBaseName(baseName)
  if (!normalizedBaseName) {
    return []
  }

  const dirAxisMap = bundledScriptAxes.get(normalizedBaseName)
  if (!dirAxisMap) {
    return []
  }

  const axes = dirAxisMap.get(normalizePathKey(dirPath))
  if (!axes || axes.size === 0) {
    return []
  }

  return SCRIPT_AXIS_DEFINITIONS
    .map((definition) => definition.id)
    .filter((axisId) => axes.has(axisId))
}

function collectMediaScanScriptAxes(
  mediaPath: string,
  candidateDirs: string[],
  fallbackScriptPaths: Array<string | null | undefined>,
  bundledScriptAxesIndexes: BundledScriptAxisIndex[]
): ScriptAxisId[] {
  const axisIds = new Set<ScriptAxisId>()
  const mediaBaseName = path.basename(mediaPath, path.extname(mediaPath))

  for (const dirPath of candidateDirs) {
    for (const bundledScriptAxes of bundledScriptAxesIndexes) {
      for (const axisId of collectIndexedBundledScriptAxes(bundledScriptAxes, dirPath, mediaBaseName)) {
        axisIds.add(axisId)
      }
    }
  }

  for (const fallbackScriptPath of fallbackScriptPaths) {
    if (!fallbackScriptPath) {
      continue
    }

    const fallbackDir = path.dirname(fallbackScriptPath)
    const fallbackStem = stripKnownAxisSuffixPreserveCase(path.basename(fallbackScriptPath, path.extname(fallbackScriptPath)))
    const fallbackAxisId = inferAxisIdFromFilePath(fallbackScriptPath)
    if (fallbackAxisId) {
      axisIds.add(fallbackAxisId)
    }

    for (const baseName of [fallbackStem, mediaBaseName]) {
      for (const bundledScriptAxes of bundledScriptAxesIndexes) {
        for (const axisId of collectIndexedBundledScriptAxes(bundledScriptAxes, fallbackDir, baseName)) {
          axisIds.add(axisId)
        }
      }
    }
  }

  return SCRIPT_AXIS_DEFINITIONS
    .map((definition) => definition.id)
    .filter((axisId) => axisIds.has(axisId))
}

function pickUniqueBundledScriptCandidate(
  mediaPath: string,
  mediaTopLevelGroup: string,
  restrictByTopLevelGroup: boolean,
  candidateLocations?: Map<string, { path: string; topLevelGroup: string }>
): string | null {
  if (!candidateLocations || candidateLocations.size !== 1) {
    return null
  }

  const [[candidateDir, candidate]] = Array.from(candidateLocations.entries())
  if (normalizePathKey(candidateDir) === normalizePathKey(path.dirname(mediaPath))) {
    return null
  }

  if (restrictByTopLevelGroup && mediaTopLevelGroup && candidate.topLevelGroup !== mediaTopLevelGroup) {
    return null
  }

  return candidate.path
}

function normalizeBundledScriptFallbackKey(baseName: string): string {
  return normalizeBundledScriptBaseName(baseName)
    .replace(/^[0-9０-９]+(?:-[0-9０-９]+)?[.\s_-]*/, '')
}

function normalizeBundledScriptBaseName(baseName: string): string {
  return stripKnownAxisSuffix(baseName)
    .replace(/^((?:track|tr)\d+)[.\s_-]+/i, '$1')
    .replace(/^([#]?\d+(?:-\d+)?)[.\s_-]+/i, '$1')
    .replace(SCRIPT_DECORATOR_SUFFIX_RE, '')
    .replace(SCRIPT_LABEL_SUFFIX_RE, '')
    .replace(TRAILING_VARIANT_SUFFIX_RE, '')
    .trim()
    .toLowerCase()
}

function stripKnownAxisSuffixPreserveCase(stem: string): string {
  const trimmedStem = stem.trim()
  const normalizedStem = trimmedStem.toLowerCase()

  for (const definition of SCRIPT_AXIS_DEFINITIONS) {
    for (const suffix of definition.suffixes) {
      if (!suffix) continue
      if (normalizedStem === suffix) return ''

      const dottedSuffix = `.${suffix}`
      if (normalizedStem.endsWith(dottedSuffix)) {
        return trimmedStem.slice(0, -dottedSuffix.length).trimEnd()
      }
    }
  }

  return trimmedStem
}

function getFunscriptExtPriority(filePath: string): number {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.funscript') return 0
  if (ext === '.json') return 1
  if (ext === '.csv') return 2
  return 99
}

function shouldPreferVariantPath(candidatePath: string, currentPath: string): boolean {
  const candidatePriority = getFunscriptExtPriority(candidatePath)
  const currentPriority = getFunscriptExtPriority(currentPath)
  if (candidatePriority !== currentPriority) {
    return candidatePriority < currentPriority
  }

  return NATURAL_SORTER.compare(path.basename(candidatePath), path.basename(currentPath)) < 0
}

function upsertBundledScriptLocation(
  index: BundledScriptLocationIndex,
  baseName: string,
  dirPath: string,
  candidate: { path: string; topLevelGroup: string }
) {
  let locationMap = index.get(baseName)
  if (!locationMap) {
    locationMap = new Map<string, { path: string; topLevelGroup: string }>()
    index.set(baseName, locationMap)
  }

  const current = locationMap.get(dirPath)
  if (!current || shouldPreferVariantPath(candidate.path, current.path)) {
    locationMap.set(dirPath, candidate)
  }
}

function addBundledScriptAxis(index: BundledScriptAxisIndex, baseName: string, dirPath: string, axisId: ScriptAxisId) {
  let dirAxisMap = index.get(baseName)
  if (!dirAxisMap) {
    dirAxisMap = new Map<string, Set<ScriptAxisId>>()
    index.set(baseName, dirAxisMap)
  }

  const normalizedDir = normalizePathKey(dirPath)
  let axes = dirAxisMap.get(normalizedDir)
  if (!axes) {
    axes = new Set<ScriptAxisId>()
    dirAxisMap.set(normalizedDir, axes)
  }

  axes.add(axisId)
}

function indexBundledScriptFile(
  scriptIndex: BundledScriptIndex,
  dirPath: string,
  topLevelGroup: string,
  entryName: string,
  fullPath: string
) {
  const ext = path.extname(entryName).toLowerCase()
  if (!FUNSCRIPT_EXTS.includes(ext)) {
    return
  }

  const stem = path.basename(entryName, ext)
  const matchKeys = buildBundledScriptMatchKeys(stem)
  if (matchKeys.length === 0) {
    return
  }

  const axisId = inferAxisIdFromStem(stem) ?? 'L0'
  const candidate = { path: fullPath, topLevelGroup }

  for (const matchKey of matchKeys) {
    upsertBundledScriptLocation(scriptIndex.locations, matchKey, dirPath, candidate)

    const scriptAlias = normalizeBundledScriptFallbackKey(matchKey)
    if (scriptAlias && scriptAlias !== matchKey) {
      upsertBundledScriptLocation(scriptIndex.aliasLocations, scriptAlias, dirPath, candidate)
    }

    addBundledScriptAxis(scriptIndex.axes, matchKey, dirPath, axisId)
  }
}

function listFunscriptFileEntries(rootDir: string, recursive: boolean): FunscriptFileEntry[] {
  const results: FunscriptFileEntry[] = []
  const visitedDirectories = new Set<string>()
  const stack: Array<{ dir: string; prefix: string }> = [{ dir: rootDir, prefix: '' }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    const visitKey = getDirectoryRealPathKeySync(current.dir)
    if (visitedDirectories.has(visitKey)) {
      continue
    }
    visitedDirectories.add(visitKey)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }

    directoryEntryNameCache.set(
      normalizePathKey(current.dir),
      new Set(entries.map((entry) => entry.name.toLowerCase()))
    )

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const fullPath = path.join(current.dir, entry.name)
      if (entry.isDirectory()) {
        if (recursive) {
          stack.push({
            dir: fullPath,
            prefix: current.prefix ? `${current.prefix}/${entry.name}` : entry.name,
          })
        }
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const ext = path.extname(entry.name).toLowerCase()
      if (!FUNSCRIPT_EXTS.includes(ext)) {
        continue
      }

      results.push({
        dir: current.dir,
        name: entry.name,
        path: fullPath,
        topLevelGroup: current.prefix.split('/')[0] ?? '',
      })
    }
  }

  return results
}

async function getCachedScriptFolderIndex(
  scriptFolder: string,
  maybeYieldDuringScan?: () => Promise<void>
): Promise<BundledScriptIndex> {
  const cacheKey = normalizePathKey(path.resolve(scriptFolder))
  const cached = scriptFolderIndexCache.get(cacheKey)
  const now = Date.now()
  if (cached && now - cached.scannedAt < SCRIPT_FOLDER_INDEX_CACHE_TTL_MS) {
    return cached.index
  }

  const index = createBundledScriptIndex()
  const visitedScriptFolderDirs = new Set<string>()

  const scanScriptFolderDir = async (dir: string, prefix: string): Promise<void> => {
    const visitKey = await getDirectoryRealPathKey(dir)
    if (visitedScriptFolderDirs.has(visitKey)) {
      return
    }
    visitedScriptFolderDirs.add(visitKey)

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    directoryEntryNameCache.set(
      normalizePathKey(dir),
      new Set(entries.map((entry) => entry.name.toLowerCase()))
    )

    for (const entry of entries) {
      await maybeYieldDuringScan?.()
      const fullPath = path.join(dir, entry.name)

      if (entry.isSymbolicLink()) {
        continue
      }

      if (entry.isDirectory()) {
        await scanScriptFolderDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      indexBundledScriptFile(
        index,
        dir,
        prefix.split('/')[0] ?? '',
        entry.name,
        fullPath
      )
    }
  }

  await scanScriptFolderDir(scriptFolder, '')
  scriptFolderIndexCache.set(cacheKey, { index, scannedAt: now })
  return index
}

function buildScriptVariantLabel(mediaBaseName: string, bundleStem: string): string {
  const trimmedBundleStem = bundleStem.trim()
  if (!trimmedBundleStem) {
    return ''
  }

  if (trimmedBundleStem.localeCompare(mediaBaseName, undefined, { sensitivity: 'accent' }) === 0) {
    return ''
  }

  const escapedBaseName = mediaBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const suffixMatch = trimmedBundleStem.match(new RegExp(`^${escapedBaseName}[ _.-]*(.+)$`, 'i'))
  if (suffixMatch?.[1]) {
    return unwrapVariantLabel(suffixMatch[1].trim())
  }

  return unwrapVariantLabel(trimmedBundleStem)
}

function unwrapVariantLabel(label: string): string {
  const trimmedLabel = label.trim()
  const bracketedMatch = trimmedLabel.match(/^[([{（【]\s*(.+?)\s*[\])}）】]$/)
  return bracketedMatch?.[1]?.trim() || trimmedLabel
}

function stripTrailingVariantQualifier(stem: string): string {
  let nextStem = stem.trim()

  while (true) {
    const stripped = nextStem.replace(/[ _.-]*[\[(（【][^()[\]（）【】]+[\])）】]\s*$/, '').trim()
    if (!stripped || stripped === nextStem) {
      return nextStem
    }
    nextStem = stripped
  }
}

function stripTrailingVariantWordSuffix(stem: string): string {
  return stem.trim().replace(TRAILING_VARIANT_WORD_SUFFIX_RE, '').trim()
}

function buildBundledScriptMatchKeys(stem: string): string[] {
  const trimmedStem = stem.trim()
  if (!trimmedStem) {
    return []
  }

  const axisStrippedStem = stripKnownAxisSuffixPreserveCase(trimmedStem) || trimmedStem
  const candidates = new Set<string>()

  for (const candidate of [
    trimmedStem,
    axisStrippedStem,
    stripTrailingVariantQualifier(axisStrippedStem),
    stripTrailingVariantWordSuffix(axisStrippedStem),
    stripTrailingVariantWordSuffix(stripTrailingVariantQualifier(axisStrippedStem)),
  ]) {
    const normalized = normalizeBundledScriptBaseName(candidate)
    if (normalized) {
      candidates.add(normalized)
    }
  }

  return Array.from(candidates)
}

function matchesScriptVariantMediaBaseName(stem: string, normalizedMediaBaseName: string): boolean {
  return buildBundledScriptMatchKeys(stem).includes(normalizedMediaBaseName)
}

function getScriptVariantDirectoryBundleStem(
  entry: { dir: string; topLevelGroup: string },
  normalizedMediaBaseName: string,
  mediaBaseName: string
): string | null {
  const dirBaseName = path.basename(entry.dir)

  if (dirBaseName && matchesScriptVariantMediaBaseName(dirBaseName, normalizedMediaBaseName)) {
    return mediaBaseName
  }

  if (entry.topLevelGroup && matchesScriptVariantMediaBaseName(entry.topLevelGroup, normalizedMediaBaseName)) {
    return dirBaseName || mediaBaseName
  }

  return null
}

function listScriptVariants(mediaPath: string, scriptFolder?: string): ScriptVariantOption[] {
  const mediaBaseName = path.basename(mediaPath, path.extname(mediaPath))
  const normalizedMediaBaseName = normalizeBundledScriptBaseName(mediaBaseName)
  if (!normalizedMediaBaseName) {
    return []
  }

  const mediaDir = path.dirname(mediaPath)
  const contexts: Array<{ dir: string; source: ScriptVariantOption['source']; recursive: boolean }> = [
    { dir: mediaDir, source: 'local', recursive: false },
  ]

  if (scriptFolder && normalizePathKey(scriptFolder) !== normalizePathKey(mediaDir)) {
    contexts.push({ dir: scriptFolder, source: 'scriptFolder', recursive: true })
  }

  const groupedVariants = new Map<string, {
    bundleStem: string
    source: ScriptVariantOption['source']
    axisPaths: Map<ScriptAxisId, string>
  }>()

  for (const context of contexts) {
    for (const entry of listFunscriptFileEntries(context.dir, context.recursive)) {
      const ext = path.extname(entry.name).toLowerCase()
      const stem = path.basename(entry.name, ext)
      const directStemMatch = matchesScriptVariantMediaBaseName(stem, normalizedMediaBaseName)
      const directoryBundleStem = context.source === 'scriptFolder'
        ? getScriptVariantDirectoryBundleStem(entry, normalizedMediaBaseName, mediaBaseName)
        : null
      if (!directStemMatch && !directoryBundleStem) continue

      const strippedBundleStem = stripKnownAxisSuffixPreserveCase(stem)
      const bundleStem = directoryBundleStem && !directStemMatch
        ? directoryBundleStem
        : (strippedBundleStem || directoryBundleStem || stem)
      const dirKey = getDirectoryRealPathKeySync(entry.dir)
      const variantKey = `${dirKey}::${normalizePathKey(bundleStem)}`
      const axisId = inferAxisIdFromStem(stem) ?? 'L0'
      const filePath = entry.path

      let variant = groupedVariants.get(variantKey)
      if (!variant) {
        variant = {
          bundleStem,
          source: context.source,
          axisPaths: new Map<ScriptAxisId, string>(),
        }
        groupedVariants.set(variantKey, variant)
      }

      const currentPath = variant.axisPaths.get(axisId)
      if (!currentPath || shouldPreferVariantPath(filePath, currentPath)) {
        variant.axisPaths.set(axisId, filePath)
      }
    }
  }

  const variants = Array.from(groupedVariants.values())
    .map((variant) => {
      const axes = SCRIPT_AXIS_DEFINITIONS
        .map((definition) => definition.id)
        .filter((axisId) => variant.axisPaths.has(axisId))
      if (axes.length === 0) {
        return null
      }

      const primaryPath = variant.axisPaths.get('L0') ?? variant.axisPaths.get(axes[0]) ?? null
      if (!primaryPath) {
        return null
      }

      return {
        path: primaryPath,
        label: buildScriptVariantLabel(mediaBaseName, variant.bundleStem),
        axes,
        source: variant.source,
        isDefault: variant.bundleStem.localeCompare(mediaBaseName, undefined, { sensitivity: 'accent' }) === 0,
      } satisfies ScriptVariantOption
    })
    .filter((variant): variant is ScriptVariantOption => variant !== null)

  variants.sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1
    }

    if (a.source !== b.source) {
      return a.source === 'local' ? -1 : 1
    }

    const labelComparison = NATURAL_SORTER.compare(a.label || mediaBaseName, b.label || mediaBaseName)
    if (labelComparison !== 0) {
      return labelComparison
    }

    return NATURAL_SORTER.compare(a.path, b.path)
  })

  return variants
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

  if (preferredScriptPath) {
    addScriptPathBundle(bundle, loadedPaths, preferredScriptPath)
    if (Object.keys(bundle.scripts).length > 0) {
      if (bundle.primaryAxis === null) {
        bundle.primaryAxis = Object.keys(bundle.scripts)[0] as ScriptAxisId | undefined ?? null
      }
      return bundle
    }
  }

  const mediaBaseName = path.basename(mediaPath, path.extname(mediaPath))
  const contexts = [
    { dir: path.dirname(mediaPath), baseNames: [mediaBaseName] },
  ]

  if (scriptFolder) {
    contexts.push({ dir: scriptFolder, baseNames: [mediaBaseName] })
  }

  for (const context of contexts) {
    for (const baseName of context.baseNames) {
      addBundleCandidates(bundle, loadedPaths, context.dir, baseName)
    }
  }

  if (Object.keys(bundle.scripts).length === 0) {
    const firstVariant = listScriptVariants(mediaPath, scriptFolder)[0]
    if (firstVariant) {
      addScriptPathBundle(bundle, loadedPaths, firstVariant.path)
    }
  }

  if (bundle.primaryAxis === null) {
    bundle.primaryAxis = Object.keys(bundle.scripts)[0] as ScriptAxisId | undefined ?? null
  }

  return Object.keys(bundle.scripts).length > 0 ? bundle : null
}

function addScriptPathBundle(
  bundle: { primaryAxis: ScriptAxisId | null; scripts: Partial<Record<ScriptAxisId, unknown>>; sources: Partial<Record<ScriptAxisId, string>> },
  loadedPaths: Set<string>,
  scriptPath: string
) {
  addFunscriptToBundle(bundle, loadedPaths, scriptPath, inferAxisIdFromFilePath(scriptPath))

  const bundleStem = stripKnownAxisSuffixPreserveCase(path.basename(scriptPath, path.extname(scriptPath)))
  if (bundleStem) {
    addBundleCandidates(bundle, loadedPaths, path.dirname(scriptPath), bundleStem)
  }
}

function addBundleCandidates(
  bundle: { primaryAxis: ScriptAxisId | null; scripts: Partial<Record<ScriptAxisId, unknown>>; sources: Partial<Record<ScriptAxisId, string>> },
  loadedPaths: Set<string>,
  dirPath: string,
  baseName: string
) {
  const decoratedCandidates = findDecoratedBundleCandidates(dirPath, baseName)

  for (const definition of SCRIPT_AXIS_DEFINITIONS) {
    if (bundle.scripts[definition.id]) continue

    for (const suffix of definition.suffixes) {
      let matched = false

      for (const ext of FUNSCRIPT_EXTS) {
        const fileName = suffix
          ? `${baseName}.${suffix}${ext}`
          : `${baseName}${ext}`
        const filePath = path.join(dirPath, fileName)
        if (!fs.existsSync(filePath)) continue

        addFunscriptToBundle(bundle, loadedPaths, filePath, definition.id)
        matched = true
        break
      }

      if (matched) {
        break
      }
    }

    const decoratedCandidate = decoratedCandidates[definition.id]
    if (decoratedCandidate) {
      addFunscriptToBundle(bundle, loadedPaths, decoratedCandidate, definition.id)
    }
  }
}

function findDecoratedBundleCandidates(
  dirPath: string,
  baseName: string
): Partial<Record<ScriptAxisId, string>> {
  const targetBaseName = normalizeBundledScriptBaseName(baseName)
  if (!targetBaseName) {
    return {}
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return {}
  }

  const matches = new Map<ScriptAxisId, string | null>()
  for (const entry of entries) {
    if (!entry.isFile()) continue

    const ext = path.extname(entry.name).toLowerCase()
    if (!FUNSCRIPT_EXTS.includes(ext)) continue

    const stem = path.basename(entry.name, ext)
    if (normalizeBundledScriptBaseName(stem) !== targetBaseName) continue

    const axisId = inferAxisIdFromStem(stem) ?? 'L0'
    const filePath = path.join(dirPath, entry.name)
    if (!matches.has(axisId)) {
      matches.set(axisId, filePath)
      continue
    }

    if (matches.get(axisId) !== filePath) {
      matches.set(axisId, null)
    }
  }

  const next: Partial<Record<ScriptAxisId, string>> = {}
  for (const [axisId, filePath] of matches.entries()) {
    if (filePath) {
      next[axisId] = filePath
    }
  }
  return next
}

function addFunscriptToBundle(
  bundle: { primaryAxis: ScriptAxisId | null; scripts: Partial<Record<ScriptAxisId, unknown>>; sources: Partial<Record<ScriptAxisId, string>> },
  loadedPaths: Set<string>,
  filePath: string,
  preferredAxis: ScriptAxisId | null
) {
  if (loadedPaths.has(filePath)) return

  const parsed = readFunscriptJson(filePath)
  if (!isLoadableFunscriptJson(parsed)) return

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

function hasVariantBoundary(value: string, index: number): boolean {
  const nextChar = value.charAt(index)
  return nextChar === '' || /[.\s_\-([{（【]/.test(nextChar)
}

function buildScriptMediaBaseNameCandidates(scriptPath: string): string[] {
  const ext = path.extname(scriptPath).toLowerCase()
  if (!FUNSCRIPT_EXTS.includes(ext)) {
    return []
  }

  const candidates = new Set<string>()
  let currentStem = stripKnownAxisSuffixPreserveCase(path.basename(scriptPath, ext))
  if (!currentStem) {
    currentStem = path.basename(scriptPath, ext)
  }

  while (currentStem) {
    for (const matchKey of buildBundledScriptMatchKeys(currentStem)) {
      candidates.add(matchKey)
    }

    const stripped = stripTrailingVariantQualifier(currentStem)
    if (!stripped || stripped === currentStem) {
      break
    }
    currentStem = stripped
  }

  return Array.from(candidates)
}

function getMediaMatchScore(mediaBaseName: string, scriptBaseNames: string[]): number {
  let bestScore = -1

  for (const scriptBaseName of scriptBaseNames) {
    if (!scriptBaseName || !mediaBaseName) {
      continue
    }

    if (mediaBaseName === scriptBaseName) {
      bestScore = Math.max(bestScore, 300)
      continue
    }

    if (scriptBaseName.startsWith(mediaBaseName) && hasVariantBoundary(scriptBaseName, mediaBaseName.length)) {
      bestScore = Math.max(bestScore, 200)
      continue
    }

    if (mediaBaseName.startsWith(scriptBaseName) && hasVariantBoundary(mediaBaseName, scriptBaseName.length)) {
      bestScore = Math.max(bestScore, 100)
    }
  }

  return bestScore
}

function collectMediaPathMatches(
  scriptBaseNames: string[],
  mediaPaths: string[],
  sourcePriority = 0
): Array<{ path: string; score: number; sourcePriority: number }> {
  const matches: Array<{ path: string; score: number; sourcePriority: number }> = []
  const seenPaths = new Set<string>()

  for (const mediaPath of mediaPaths) {
    if (typeof mediaPath !== 'string' || mediaPath.length === 0) {
      continue
    }

    const normalizedMediaPath = normalizePathKey(mediaPath)
    if (seenPaths.has(normalizedMediaPath)) {
      continue
    }
    seenPaths.add(normalizedMediaPath)

    const ext = path.extname(mediaPath).toLowerCase()
    if (!MEDIA_EXTS.includes(ext)) continue

    const mediaBaseName = normalizeBundledScriptBaseName(path.basename(mediaPath, ext))
    const score = getMediaMatchScore(mediaBaseName, scriptBaseNames)
    if (score < 0) continue

    matches.push({
      path: mediaPath,
      score,
      sourcePriority,
    })
  }

  matches.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score
    }

    if (a.sourcePriority !== b.sourcePriority) {
      return b.sourcePriority - a.sourcePriority
    }

    return NATURAL_SORTER.compare(path.basename(a.path), path.basename(b.path))
  })

  return matches
}

function listMediaPathsInDirectory(dirPath: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const mediaPaths: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue

    const ext = path.extname(entry.name).toLowerCase()
    if (!MEDIA_EXTS.includes(ext)) continue

    mediaPaths.push(path.join(dirPath, entry.name))
  }

  return mediaPaths
}

function listMediaMatchesForScript(
  scriptPath: string,
  candidateMediaPaths?: string[],
  preferredMediaPath?: string
): ScriptMediaMatchCandidate[] {
  const scriptBaseNames = buildScriptMediaBaseNameCandidates(scriptPath)
  if (scriptBaseNames.length === 0) {
    return []
  }

  const scriptDir = path.dirname(scriptPath)
  const rankedMatches = [
    ...collectMediaPathMatches(scriptBaseNames, listMediaPathsInDirectory(scriptDir), 2),
    ...collectMediaPathMatches(scriptBaseNames, preferredMediaPath ? [preferredMediaPath] : [], 1),
    ...collectMediaPathMatches(scriptBaseNames, Array.isArray(candidateMediaPaths) ? candidateMediaPaths : [], 0),
  ]

  if (rankedMatches.length === 0) {
    return []
  }

  const dedupedMatches = new Map<string, ScriptMediaMatchCandidate>()
  for (const match of rankedMatches) {
    const key = normalizePathKey(match.path)
    const current = dedupedMatches.get(key)
    if (
      !current
      || match.score > current.score
      || (match.score === current.score && match.sourcePriority > current.sourcePriority)
    ) {
      dedupedMatches.set(key, match)
    }
  }

  return Array.from(dedupedMatches.values())
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score
      }

      if (a.sourcePriority !== b.sourcePriority) {
        return b.sourcePriority - a.sourcePriority
      }

      return NATURAL_SORTER.compare(path.basename(a.path), path.basename(b.path))
    })
}

function findMediaForScript(
  scriptPath: string,
  candidateMediaPaths?: string[],
  preferredMediaPath?: string
): string | null {
  const sortedMatches = listMediaMatchesForScript(scriptPath, candidateMediaPaths, preferredMediaPath)

  const bestMatch = sortedMatches[0]
  if (!bestMatch) {
    return null
  }

  const isAmbiguousTopMatch = sortedMatches.some((match, index) => (
    index > 0
    && match.score === bestMatch.score
    && match.sourcePriority === bestMatch.sourcePriority
  ))
  if (isAmbiguousTopMatch) {
    return null
  }

  return bestMatch.path
}

function readFunscriptJson(filePath: string): unknown | null {
  try {
    const ext = path.extname(filePath).toLowerCase()
    if (!FUNSCRIPT_EXTS.includes(ext)) return null
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
    if (ext === '.csv') {
      return parseFunscriptCsv(content)
    }
    return JSON.parse(content)
  } catch {
    return null
  }
}

function parseFunscriptCsv(content: string): {
  version: string
  inverted: boolean
  range: number
  actions: Array<{ at: number; pos: number }>
} | null {
  const rows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(',').map((part) => Number(part.trim())))
    .filter((row) => row.length >= 2 && Number.isFinite(row[0]) && row.some((value, index) => index > 0 && Number.isFinite(value)))

  if (rows.length === 0) {
    return null
  }

  const positionColumnIndex = pickCsvPositionColumnIndex(rows)
  if (positionColumnIndex === null) {
    return null
  }

  const actions = rows
    .map((row) => ({
      at: Math.max(0, Math.round(row[0])),
      pos: Math.max(0, Math.min(100, Math.round(row[positionColumnIndex]))),
    }))
    .filter((action) => Number.isFinite(action.at) && Number.isFinite(action.pos))

  if (actions.length === 0) {
    return null
  }

  return {
    version: '1.0',
    inverted: false,
    range: 90,
    actions,
  }
}

function pickCsvPositionColumnIndex(rows: number[][]): number | null {
  const maxColumnCount = Math.max(...rows.map((row) => row.length))
  let bestIndex: number | null = null
  let bestScore = -1

  for (let columnIndex = 1; columnIndex < maxColumnCount; columnIndex += 1) {
    const values = rows
      .map((row) => row[columnIndex])
      .filter((value) => Number.isFinite(value))

    if (values.length === 0) continue

    const distinctCount = new Set(values.map((value) => value.toString())).size
    const nonBinaryCount = values.filter((value) => value !== 0 && value !== 1).length
    const range = Math.max(...values) - Math.min(...values)
    const score = nonBinaryCount * 100000 + distinctCount * 100 + range

    if (score > bestScore || (score === bestScore && bestIndex !== null && columnIndex > bestIndex)) {
      bestScore = score
      bestIndex = columnIndex
    }

    if (bestIndex === null) {
      bestIndex = columnIndex
    }
  }

  return bestIndex
}

function isLoadableFunscriptJson(value: unknown): value is { actions: Array<{ at: number; pos: number }> } {
  if (!value || typeof value !== 'object') {
    return false
  }

  const actions = (value as { actions?: unknown }).actions
  if (!Array.isArray(actions) || actions.length === 0) {
    return false
  }

  return actions.every((action) => (
    action
    && typeof action === 'object'
    && Number.isFinite((action as { at?: unknown }).at)
    && Number.isFinite((action as { pos?: unknown }).pos)
  ))
}

async function findArtworkForMedia(mediaPath: string, rootHint?: string): Promise<string | null> {
  const sidecarArtworkPath = findSidecarArtworkForMedia(mediaPath, rootHint)
  if (sidecarArtworkPath) {
    return sidecarArtworkPath
  }

  const embeddedArtworkPath = await extractEmbeddedArtworkForMedia(mediaPath)
  if (embeddedArtworkPath) {
    return embeddedArtworkPath
  }

  return null
}

async function extractEmbeddedArtworkForMedia(mediaPath: string): Promise<string | null> {
  if (!AUDIO_EXTS.includes(path.extname(mediaPath).toLowerCase())) {
    return null
  }

  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(mediaPath)
  } catch {
    return null
  }

  try {
    const metadata = await parseFile(mediaPath, {
      duration: false,
      skipCovers: false,
      skipPostHeaders: true,
    })
    const picture = pickEmbeddedArtwork(metadata.common.picture)
    if (!picture?.data?.length) {
      return null
    }

    const ext = getArtworkExtensionFromMime(picture.format)
    const cacheDir = path.join(app.getPath('userData'), EMBEDDED_ARTWORK_CACHE_DIR)
    await fs.promises.mkdir(cacheDir, { recursive: true })

    const cacheKey = createHash('sha1')
      .update(mediaPath)
      .update('\0')
      .update(String(stats.mtimeMs))
      .update('\0')
      .update(String(stats.size))
      .digest('hex')
    const filePath = path.join(cacheDir, `${cacheKey}${ext}`)

    try {
      await fs.promises.access(filePath, fs.constants.R_OK)
      return filePath
    } catch {
      // Cache miss, write below.
    }

    await fs.promises.writeFile(filePath, Buffer.from(picture.data))
    return filePath
  } catch {
    return null
  }
}

function pickEmbeddedArtwork(
  pictures: Array<{ format?: string; type?: string; data: Uint8Array }> | undefined
): { format?: string; type?: string; data: Uint8Array } | null {
  if (!pictures || pictures.length === 0) {
    return null
  }

  return pictures.find((picture) => /front|cover/i.test(picture.type || ''))
    ?? pictures.find((picture) => /^image\//i.test(picture.format || ''))
    ?? pictures[0]
    ?? null
}

function getArtworkExtensionFromMime(mime?: string): string {
  const normalized = (mime || '').toLowerCase()
  if (normalized.includes('png')) return '.png'
  if (normalized.includes('webp')) return '.webp'
  if (normalized.includes('gif')) return '.gif'
  if (normalized.includes('bmp')) return '.bmp'
  return '.jpg'
}

type ArtworkCandidate = {
  path: string
  score: number
}

const EXACT_ARTWORK_NAMES = new Set([
  'cover',
  'folder',
  'front',
  'thumb',
  'thumbnail',
  'jacket',
  'index',
  'poster',
])
const COVER_ARTWORK_TOKENS = [
  ...EXACT_ARTWORK_NAMES,
  'package',
  'artwork',
]
const PREFERRED_ARTWORK_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const IGNORED_ARTWORK_TOKENS = ['삣삐', '띳띠', '뭐하고놀까요']
const artworkLookupCache = new Map<string, string | null>()

function findSidecarArtworkForMedia(mediaPath: string, rootHint?: string): string | null {
  const cacheKey = `${normalizePathKey(mediaPath)}::${rootHint ? normalizePathKey(rootHint) : ''}`
  if (artworkLookupCache.has(cacheKey)) {
    return artworkLookupCache.get(cacheKey) ?? null
  }
  const searchDirs = getArtworkSearchDirectories(mediaPath, rootHint)

  for (const dir of searchDirs) {
    const artworkPath = findBestArtworkInDirectory(mediaPath, dir, false)
    if (artworkPath) {
      artworkLookupCache.set(cacheKey, artworkPath)
      return artworkPath
    }
  }

  for (const dir of searchDirs) {
    const artworkPath = findBestArtworkInDirectory(mediaPath, dir, true)
    if (artworkPath) {
      artworkLookupCache.set(cacheKey, artworkPath)
      return artworkPath
    }
  }

  const workRoot = inferArtworkWorkRoot(mediaPath, rootHint)
  if (workRoot) {
    const workRootArtworkPath = findBestArtworkInTree(workRoot)
    if (workRootArtworkPath) {
      artworkLookupCache.set(cacheKey, workRootArtworkPath)
      return workRootArtworkPath
    }
  }

  artworkLookupCache.set(cacheKey, null)
  return null
}

function inferArtworkWorkRoot(mediaPath: string, rootHint?: string): string | null {
  const mediaDir = path.dirname(mediaPath)
  const normalizedRoot = normalizeArtworkRootHint(mediaPath, rootHint)
  const ancestors = getAncestorDirectories(mediaDir, normalizedRoot, 16)
  const rjWorkRoot = ancestors.find((dir) => looksLikeRjWorkFolder(path.basename(dir)))
  if (rjWorkRoot) {
    return rjWorkRoot
  }

  if (normalizedRoot) {
    const relative = path.relative(normalizedRoot, mediaDir)
    if (!relative || relative === '.') {
      return normalizedRoot
    }

    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      const firstPart = relative.split(/[\\/]+/).filter(Boolean)[0]
      if (!firstPart || isArtworkContainerDirectory(firstPart)) {
        return normalizedRoot
      }
      return path.join(normalizedRoot, firstPart)
    }
  }

  let currentDir = mediaDir
  let steps = 0
  while (isArtworkContainerDirectory(path.basename(currentDir)) && steps < 5) {
    const parent = path.dirname(currentDir)
    if (!parent || parent === currentDir) {
      break
    }
    currentDir = parent
    steps += 1
  }
  return currentDir
}

function getAncestorDirectories(startDir: string, stopDir: string | null, maxSteps: number): string[] {
  const results: string[] = []
  let currentDir = startDir
  let steps = 0

  while (currentDir && steps <= maxSteps) {
    appendUniquePath(results, currentDir)
    if (stopDir && normalizePathKey(currentDir) === normalizePathKey(stopDir)) {
      break
    }

    const parent = path.dirname(currentDir)
    if (!parent || parent === currentDir) {
      break
    }
    currentDir = parent
    steps += 1
  }

  return results
}

function looksLikeRjWorkFolder(name: string): boolean {
  return /\b(?:RJ|VJ|BJ)\s*\d{5,9}\b/i.test(name)
}

function isArtworkContainerDirectory(name: string): boolean {
  const normalized = normalizeArtworkRuleName(name)
  return normalized === 'mp3'
    || normalized === 'wav'
    || normalized === 'flac'
    || normalized === 'ogg'
    || normalized === 'aac'
    || normalized === 'opus'
    || normalized === 'm4a'
    || normalized === 'audio'
    || normalized === 'audios'
    || normalized === 'sound'
    || normalized === 'sounds'
    || normalized === 'img'
    || normalized === 'image'
    || normalized === 'images'
    || normalized === 'picture'
    || normalized === 'pictures'
    || /^(cd|disc|disk)\d*$/.test(normalized)
}

function findBestArtworkInTree(rootDir: string): string | null {
  return findBestArtworkCandidateInTree(rootDir, 0)?.path ?? null
}

function findBestArtworkCandidateInTree(dir: string, depth: number): ArtworkCandidate | null {
  if (depth > 5) {
    return null
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return null
  }

  let bestCover: ArtworkCandidate | null = null
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    const score = artworkCoverScore(entry.name, depth)
    if (score === Number.NEGATIVE_INFINITY) {
      continue
    }

    bestCover = selectBetterArtworkCandidate(bestCover, {
      path: path.join(dir, entry.name),
      score,
    })
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue
    }

    bestCover = selectBetterArtworkCandidate(
      bestCover,
      findBestArtworkCandidateInTree(path.join(dir, entry.name), depth + 1)
    )
  }

  return bestCover
}

function selectBetterArtworkCandidate(current: ArtworkCandidate | null, candidate: ArtworkCandidate | null): ArtworkCandidate | null {
  if (!current) return candidate
  if (!candidate) return current
  return candidate.score > current.score ? candidate : current
}

function artworkCoverScore(fileName: string, depth: number): number {
  const extension = path.extname(fileName).toLowerCase()
  if (!IMAGE_EXTS.includes(extension)) {
    return Number.NEGATIVE_INFINITY
  }

  const stem = normalizeArtworkRuleName(path.basename(fileName, extension))
  if (!stem || IGNORED_ARTWORK_TOKENS.some((token) => stem.includes(token))) {
    return Number.NEGATIVE_INFINITY
  }

  const looksLikeCoverName = EXACT_ARTWORK_NAMES.has(stem)
    || COVER_ARTWORK_TOKENS.some((token) => stem.includes(token))
  if (extension === '.gif' && !looksLikeCoverName) {
    return Number.NEGATIVE_INFINITY
  }

  let score = 20
  if (EXACT_ARTWORK_NAMES.has(stem)) {
    score += 120
  } else if (COVER_ARTWORK_TOKENS.some((token) => stem.includes(token))) {
    score += 80
  }

  if (PREFERRED_ARTWORK_EXTS.has(extension)) {
    score += 10
  } else if (extension === '.gif') {
    score -= 200
  }

  score -= depth * 12
  return score
}

function normalizeArtworkRuleName(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function getArtworkSearchDirectories(mediaPath: string, rootHint?: string): string[] {
  const results: string[] = []
  const mediaDir = path.dirname(mediaPath)
  const normalizedRoot = normalizeArtworkRootHint(mediaPath, rootHint)
  let currentDir = mediaDir
  let steps = 0
  const maxAncestorSteps = normalizedRoot ? 16 : 4

  while (currentDir && steps <= maxAncestorSteps) {
    const key = normalizePathKey(currentDir)
    if (!results.some((dir) => normalizePathKey(dir) === key)) {
      results.push(currentDir)
    }

    if (normalizedRoot && normalizePathKey(currentDir) === normalizePathKey(normalizedRoot)) {
      break
    }

    const parent = path.dirname(currentDir)
    if (!parent || parent === currentDir) {
      break
    }
    currentDir = parent
    steps += 1
  }

  if (normalizedRoot && !results.some((dir) => normalizePathKey(dir) === normalizePathKey(normalizedRoot))) {
    results.push(normalizedRoot)
  }

  return expandArtworkSearchDirectories(results)
}

function expandArtworkSearchDirectories(baseDirs: string[]): string[] {
  const results: string[] = []
  const artworkSubdirs = [
    'cover',
    'covers',
    'artwork',
    'artworks',
    'image',
    'images',
    'img',
    'imgs',
    'jacket',
    'jackets',
    'package',
    'packages',
    'thumbnail',
    'thumbnails',
    'thumb',
    'thumbs',
  ]

  for (const dir of baseDirs) {
    appendUniquePath(results, dir)

    for (const subdirName of artworkSubdirs) {
      const candidateDir = path.join(dir, subdirName)
      try {
        if (fs.statSync(candidateDir).isDirectory()) {
          appendUniquePath(results, candidateDir)
        }
      } catch {
        // Optional artwork subfolder does not exist.
      }
    }
  }

  return results
}

function appendUniquePath(results: string[], filePath: string): void {
  const key = normalizePathKey(filePath)
  if (!results.some((entry) => normalizePathKey(entry) === key)) {
    results.push(filePath)
  }
}

function normalizeArtworkRootHint(mediaPath: string, rootHint?: string): string | null {
  if (!rootHint || typeof rootHint !== 'string') {
    return null
  }

  try {
    const resolvedMediaPath = path.resolve(mediaPath)
    const resolvedRoot = path.resolve(rootHint)
    const relative = path.relative(resolvedRoot, resolvedMediaPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null
    }
    return resolvedRoot
  } catch {
    return null
  }
}

function findBestArtworkInDirectory(mediaPath: string, dir: string, allowFallback: boolean): string | null {
  const ext = path.extname(mediaPath)
  const baseName = path.basename(mediaPath, ext).toLowerCase()
  const dirBaseName = path.basename(dir).toLowerCase()
  const normalizedBaseName = normalizeArtworkMatchText(baseName)
  const normalizedDirBaseName = normalizeArtworkMatchText(dirBaseName)

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

  const priorityKeywords = [
    'main',
    'cover',
    'folder',
    'front',
    'poster',
    'preview',
    'artwork',
    'album',
    'thumb',
    'thumbnail',
    'jacket',
    'package',
    'work',
    'title',
    '表紙',
    'ジャケット',
    'パッケージ',
    'サムネ',
    'メイン',
    '画像',
  ]
  const scored = images
    .map((name) => {
      const stem = path.basename(name, path.extname(name)).toLowerCase()
      const normalizedStem = normalizeArtworkMatchText(stem)
      let score = 0

      if (normalizedStem === normalizedBaseName) score += 140
      if (normalizedStem === normalizedDirBaseName) score += 130
      if (stem.includes(baseName)) score += 100
      if (normalizedBaseName && normalizedStem.includes(normalizedBaseName)) score += 100
      if (normalizedDirBaseName && normalizedStem.includes(normalizedDirBaseName)) score += 90
      if (normalizedDirBaseName && normalizedDirBaseName.includes(normalizedStem)) score += 50
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

  if (!allowFallback) {
    return null
  }

  return path.join(dir, pickRepresentativeArtworkImage(dir, images))
}

function pickRepresentativeArtworkImage(dir: string, images: string[]): string {
  if (images.length === 1) {
    return images[0]
  }

  return images
    .map((name) => {
      const filePath = path.join(dir, name)
      const stem = path.basename(name, path.extname(name)).toLowerCase()
      const normalizedStem = normalizeArtworkMatchText(stem)
      let size = 0
      try {
        size = fs.statSync(filePath).size
      } catch {
        size = 0
      }

      let score = 0
      if (normalizedStem && !/\d/.test(normalizedStem)) score += 20
      if (/^(main|cover|folder|front|poster|jacket|package|title|work)$/i.test(stem)) score += 70
      if (/^(img_)?main|cover|folder|front|jacket|package|title|表紙|ジャケット|パッケージ|メイン/.test(stem)) score += 45
      if (/sample|screenshot|screen|scene|preview|thumb|ss\d*|cg\d*|サンプル|スクショ/.test(stem)) score -= 35
      if (/^\d+$/.test(normalizedStem)) score -= 25
      score += Math.min(25, Math.log10(Math.max(size, 1)) * 4)

      return { name, score, size }
    })
    .sort((a, b) => b.score - a.score || b.size - a.size || a.name.localeCompare(b.name))[0]?.name ?? images[0]
}

function normalizeArtworkMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/rj\s*0*(\d+)/gi, 'rj$1')
    .replace(/[^a-z0-9가-힣ぁ-んァ-ヶ一-龯]+/g, '')
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
  else if (ext === '.ass' || ext === '.ssa') score += 85
  else if (ext === '.smi' || ext === '.sami') score += 80
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
