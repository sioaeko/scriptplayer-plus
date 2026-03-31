import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Dialogs
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openScriptFile: () => ipcRenderer.invoke('dialog:openScriptFile'),
  openSubtitleFile: () => ipcRenderer.invoke('dialog:openSubtitleFile'),
  getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),

  // File system
  readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
  readFunscript: (videoPath: string, scriptFolder?: string) => ipcRenderer.invoke('fs:readFunscript', videoPath, scriptFolder),
  readFunscriptBundle: (videoPath: string, scriptFolder?: string, preferredScriptPath?: string) =>
    ipcRenderer.invoke('fs:readFunscriptBundle', videoPath, scriptFolder, preferredScriptPath),
  readFunscriptFile: (filePath: string) => ipcRenderer.invoke('fs:readFunscriptFile', filePath),
  saveFunscript: (videoPath: string, data: string) => ipcRenderer.invoke('fs:saveFunscript', videoPath, data),
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

  // Playlist
  dialogSavePlaylist: () => ipcRenderer.invoke('dialog:savePlaylist'),
  dialogOpenPlaylist: () => ipcRenderer.invoke('dialog:openPlaylist'),
  playlistSave: (filePath: string, entries: Array<{ path: string; name: string }>) =>
    ipcRenderer.invoke('playlist:save', filePath, entries),
  playlistLoad: (filePath: string) => ipcRenderer.invoke('playlist:load', filePath),

  // EroScripts
  eroscriptsCheckSession: () => ipcRenderer.invoke('eroscripts:checkSession'),
  eroscriptsLogin: () => ipcRenderer.invoke('eroscripts:login'),
  eroscriptsLogout: () => ipcRenderer.invoke('eroscripts:logout'),
  eroscriptsFetch: (url: string) => ipcRenderer.invoke('eroscripts:fetch', url),
  eroscriptsDownload: (url: string, scriptFolder?: string, saveName?: string) => ipcRenderer.invoke('eroscripts:download', url, scriptFolder, saveName),
  eroscriptsGetCookies: () => ipcRenderer.invoke('eroscripts:getCookies'),
})
