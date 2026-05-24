import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  // Display
  setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),

  // System utilities
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  trashItem: (filePath: string) => ipcRenderer.invoke('shell:trashItem', filePath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  getRuntimePreferences: () => ipcRenderer.invoke('app:getRuntimePreferences'),
  setRuntimePreferences: (preferences: { videoCompatibilityMode: string }) =>
    ipcRenderer.invoke('app:setRuntimePreferences', preferences),
  onMainProcessError: (listener: (error: { source: string; message: string; recoverable: boolean }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, error: { source: string; message: string; recoverable: boolean }) => listener(error)
    ipcRenderer.on('app:mainProcessError', wrapped)
    return () => {
      ipcRenderer.removeListener('app:mainProcessError', wrapped)
    }
  },
  updaterGetState: () => ipcRenderer.invoke('updater:getState'),
  updaterCheckForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
  updaterDownloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
  updaterQuitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
  updaterOnState: (listener: (state: any) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: any) => listener(state)
    ipcRenderer.on('updater:state', wrapped)
    return () => {
      ipcRenderer.removeListener('updater:state', wrapped)
    }
  },

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', enabled),

  // Dialogs
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  openMediaFiles: () => ipcRenderer.invoke('dialog:openMediaFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openScriptFile: () => ipcRenderer.invoke('dialog:openScriptFile'),
  openSubtitleFile: () => ipcRenderer.invoke('dialog:openSubtitleFile'),
  openPlaylistFile: () => ipcRenderer.invoke('dialog:openPlaylistFile'),
  savePlaylistFile: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:savePlaylistFile', defaultName, content),
  getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),

  // File system
  readDir: (path: string, scriptFolder?: string) => ipcRenderer.invoke('fs:readDir', path, scriptFolder),
  inspectMediaFiles: (paths: string[], scriptFolder?: string) =>
    ipcRenderer.invoke('fs:inspectMediaFiles', paths, scriptFolder),
  readFunscript: (videoPath: string, scriptFolder?: string) => ipcRenderer.invoke('fs:readFunscript', videoPath, scriptFolder),
  readFunscriptBundle: (videoPath: string, scriptFolder?: string, preferredScriptPath?: string) =>
    ipcRenderer.invoke('fs:readFunscriptBundle', videoPath, scriptFolder, preferredScriptPath),
  listScriptVariants: (videoPath: string, scriptFolder?: string) =>
    ipcRenderer.invoke('fs:listScriptVariants', videoPath, scriptFolder),
  findMediaForScript: (scriptPath: string, candidateMediaPaths?: string[], preferredMediaPath?: string) =>
    ipcRenderer.invoke('fs:findMediaForScript', scriptPath, candidateMediaPaths, preferredMediaPath),
  listMediaMatchesForScript: (scriptPath: string, candidateMediaPaths?: string[], preferredMediaPath?: string) =>
    ipcRenderer.invoke('fs:listMediaMatchesForScript', scriptPath, candidateMediaPaths, preferredMediaPath),
  readFunscriptFile: (filePath: string) => ipcRenderer.invoke('fs:readFunscriptFile', filePath),
  saveFunscript: (videoPath: string, data: string) => ipcRenderer.invoke('fs:saveFunscript', videoPath, data),
  readSegmentRepeatStore: (scriptFolder: string) => ipcRenderer.invoke('fs:readSegmentRepeatStore', scriptFolder),
  writeSegmentRepeatStore: (scriptFolder: string, content: string) =>
    ipcRenderer.invoke('fs:writeSegmentRepeatStore', scriptFolder, content),
  getVideoUrl: (filePath: string) => ipcRenderer.invoke('fs:getVideoUrl', filePath),
  findArtwork: (mediaPath: string) => ipcRenderer.invoke('fs:findArtwork', mediaPath),
  readSubtitles: (mediaPath: string) => ipcRenderer.invoke('fs:readSubtitles', mediaPath),
  readSubtitleFile: (filePath: string) => ipcRenderer.invoke('fs:readSubtitleFile', filePath),

  // Direct serial / COM port
  osrSerialListPorts: () => ipcRenderer.invoke('osrSerial:listPorts'),
  osrSerialGetState: () => ipcRenderer.invoke('osrSerial:getState'),
  osrSerialConnect: (path: string, baudRate?: number) => ipcRenderer.invoke('osrSerial:connect', path, baudRate),
  osrSerialDisconnect: () => ipcRenderer.invoke('osrSerial:disconnect'),
  osrSerialWrite: (command: string) => ipcRenderer.invoke('osrSerial:write', command),
  osrSerialOnStateChange: (listener: (state: any) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: any) => listener(state)
    ipcRenderer.on('osrSerial:stateChanged', wrapped)
    return () => {
      ipcRenderer.removeListener('osrSerial:stateChanged', wrapped)
    }
  },

  // NAS operations
  nasWebdavConnect: (url: string, username: string, password: string) =>
    ipcRenderer.invoke('nas:webdav:connect', url, username, password),
  nasWebdavList: (url: string, path: string, username: string, password: string) =>
    ipcRenderer.invoke('nas:webdav:list', url, path, username, password),
  nasWebdavDownload: (url: string, remotePath: string, username: string, password: string) =>
    ipcRenderer.invoke('nas:webdav:download', url, remotePath, username, password),
  nasWebdavStreamUrl: (url: string, remotePath: string, username: string, password: string) =>
    ipcRenderer.invoke('nas:webdav:streamUrl', url, remotePath, username, password),
  nasFtpConnect: (host: string, port: number, username: string, password: string) =>
    ipcRenderer.invoke('nas:ftp:connect', host, port, username, password),
  nasFtpList: (host: string, port: number, username: string, password: string, path: string) =>
    ipcRenderer.invoke('nas:ftp:list', host, port, username, password, path),
  nasFtpDownload: (host: string, port: number, username: string, password: string, remotePath: string) =>
    ipcRenderer.invoke('nas:ftp:download', host, port, username, password, remotePath),

  // EroScripts
  eroscriptsCheckSession: () => ipcRenderer.invoke('eroscripts:checkSession'),
  eroscriptsLogin: () => ipcRenderer.invoke('eroscripts:login'),
  eroscriptsLogout: () => ipcRenderer.invoke('eroscripts:logout'),
  eroscriptsFetch: (url: string) => ipcRenderer.invoke('eroscripts:fetch', url),
  eroscriptsDownload: (url: string, scriptFolder?: string, saveName?: string) => ipcRenderer.invoke('eroscripts:download', url, scriptFolder, saveName),
  eroscriptsGetCookies: () => ipcRenderer.invoke('eroscripts:getCookies'),
})
