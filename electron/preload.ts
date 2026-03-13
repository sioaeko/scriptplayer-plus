import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Dialogs
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // File system
  readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
  readFunscript: (videoPath: string, scriptFolder?: string) => ipcRenderer.invoke('fs:readFunscript', videoPath, scriptFolder),
  saveFunscript: (videoPath: string, data: string) => ipcRenderer.invoke('fs:saveFunscript', videoPath, data),
  getVideoUrl: (filePath: string) => ipcRenderer.invoke('fs:getVideoUrl', filePath),
  findArtwork: (mediaPath: string) => ipcRenderer.invoke('fs:findArtwork', mediaPath),

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
