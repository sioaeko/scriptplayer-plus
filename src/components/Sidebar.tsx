import { useState, useMemo, useEffect } from 'react'
import { FolderOpen, Film, FileCheck, Search, RefreshCw, Wifi, WifiOff, Folder, ChevronDown, ChevronRight, Clock, X, Zap, Music4 } from 'lucide-react'
import { VideoFile } from '../types'
import { useTranslation } from '../i18n'
import EroScriptsPanel from './EroScriptsPanel'

interface HandyHistoryEntry {
  key: string
  label: string
  lastUsed: number
}

function loadHandyHistory(): HandyHistoryEntry[] {
  try {
    const raw = localStorage.getItem('handyHistory')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveHandyHistory(history: HandyHistoryEntry[]) {
  localStorage.setItem('handyHistory', JSON.stringify(history.slice(0, 5)))
}

function addToHandyHistory(key: string) {
  const history = loadHandyHistory()
  const existing = history.find(h => h.key === key)
  const label = existing?.label || `Handy ${key.slice(0, 4)}...`
  const updated = [
    { key, label, lastUsed: Date.now() },
    ...history.filter(h => h.key !== key),
  ].slice(0, 5)
  saveHandyHistory(updated)
  return updated
}

function getAutoConnect(): boolean {
  return localStorage.getItem('handyAutoConnect') === 'true'
}

function setAutoConnect(v: boolean) {
  localStorage.setItem('handyAutoConnect', v ? 'true' : 'false')
}

interface SidebarProps {
  files: VideoFile[]
  currentFile: string | null
  onFileSelect: (file: VideoFile) => void
  onOpenFolder: () => void
  handyConnected: boolean
  onHandyConnect: (key: string) => void
  onHandyDisconnect: () => void
  scriptFolder?: string
}

interface FolderGroup {
  folder: string
  files: VideoFile[]
}

function groupByFolder(files: VideoFile[]): FolderGroup[] {
  const map = new Map<string, VideoFile[]>()
  for (const file of files) {
    const rel = file.relativePath || file.name
    const lastSlash = rel.lastIndexOf('/')
    const folder = lastSlash >= 0 ? rel.substring(0, lastSlash) : ''
    if (!map.has(folder)) map.set(folder, [])
    map.get(folder)!.push(file)
  }
  const groups: FolderGroup[] = []
  for (const [folder, folderFiles] of map) {
    groups.push({ folder, files: folderFiles })
  }
  groups.sort((a, b) => a.folder.localeCompare(b.folder))
  return groups
}

export default function Sidebar({
  files,
  currentFile,
  onFileSelect,
  onOpenFolder,
  handyConnected,
  onHandyConnect,
  onHandyDisconnect,
  scriptFolder,
}: SidebarProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'files' | 'search' | 'device'>('files')
  const [filter, setFilter] = useState('')
  const [handyKey, setHandyKey] = useState(() => localStorage.getItem('handyKey') || '')
  const [connecting, setConnecting] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [handyHistory, setHandyHistory] = useState<HandyHistoryEntry[]>(loadHandyHistory)
  const [autoConnect, setAutoConnectState] = useState(getAutoConnect)

  const filteredFiles = files.filter((f) =>
    (f.relativePath || f.name).toLowerCase().includes(filter.toLowerCase())
  )

  const folderGroups = useMemo(() => groupByFolder(filteredFiles), [filteredFiles])
  const hasSubfolders = folderGroups.length > 1 || (folderGroups.length === 1 && folderGroups[0].folder !== '')

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  const handleConnect = async (key?: string) => {
    const k = (key || handyKey).trim()
    if (!k) return
    setConnecting(true)
    setHandyKey(k)
    localStorage.setItem('handyKey', k)
    await onHandyConnect(k)
    setConnecting(false)
    const updated = addToHandyHistory(k)
    setHandyHistory(updated)
  }

  const handleRemoveHistory = (key: string) => {
    const updated = handyHistory.filter(h => h.key !== key)
    saveHandyHistory(updated)
    setHandyHistory(updated)
  }

  const handleAutoConnectToggle = () => {
    const next = !autoConnect
    setAutoConnectState(next)
    setAutoConnect(next)
  }

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect && !handyConnected && handyHistory.length > 0) {
      const lastKey = handyHistory[0].key
      handleConnect(lastKey)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [
    { id: 'files' as const, icon: Film, label: t('sidebar.files') },
    { id: 'search' as const, icon: Search, label: t('sidebar.scripts') },
    { id: 'device' as const, icon: handyConnected ? Wifi : WifiOff, label: t('sidebar.device') },
  ]

  const renderFileItem = (file: VideoFile) => (
    <button
      key={file.path}
      onClick={() => onFileSelect(file)}
      className={`w-full text-left px-3 py-2 rounded-md text-xs flex items-start gap-2 transition-colors mb-0.5 ${
        currentFile === file.path
          ? 'bg-accent/15 text-accent'
          : 'text-text-secondary hover:bg-surface-100/30 hover:text-text-primary'
      }`}
    >
      {file.hasScript ? (
        <FileCheck size={14} className="flex-shrink-0 mt-0.5 text-green-400" />
      ) : (
        file.type === 'audio'
          ? <Music4 size={14} className="flex-shrink-0 mt-0.5" />
          : <Film size={14} className="flex-shrink-0 mt-0.5" />
      )}
      <span className="break-all leading-relaxed">{file.name}</span>
    </button>
  )

  return (
    <div className="w-72 flex-shrink-0 bg-surface-200 border-r border-surface-100/30 flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-surface-100/30">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2.5 flex flex-col items-center gap-1 text-[10px] transition-colors ${
              tab === id
                ? 'text-accent border-b-2 border-accent bg-surface-100/20'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'files' && (
          <>
            <div className="p-2 flex gap-2">
              <button
                onClick={onOpenFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent rounded text-xs transition-colors flex-1"
              >
                <FolderOpen size={14} />
                {t('sidebar.openFolder')}
              </button>
            </div>
            <div className="px-2 pb-2">
              <input
                type="text"
                placeholder={t('sidebar.filterFiles')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none placeholder:text-text-muted"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-1">
              {filteredFiles.length === 0 ? (
                <div className="text-text-muted text-xs text-center py-8">
                  {files.length === 0 ? t('sidebar.noFiles') : t('sidebar.noMatch')}
                </div>
              ) : hasSubfolders ? (
                folderGroups.map((group) => {
                  const isCollapsed = collapsedFolders.has(group.folder)
                  const folderName = group.folder || '/'
                  return (
                    <div key={group.folder} className="mb-1">
                      <button
                        onClick={() => toggleFolder(group.folder)}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                      >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <Folder size={12} className="text-accent/50" />
                        <span className="truncate font-medium">{folderName}</span>
                        <span className="ml-auto text-text-muted/50">{group.files.length}</span>
                      </button>
                      {!isCollapsed && (
                        <div className="ml-2">
                          {group.files.map(renderFileItem)}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                filteredFiles.map(renderFileItem)
              )}
            </div>
          </>
        )}

        {tab === 'search' && (
          <EroScriptsPanel
            currentVideoName={currentFile ? getFileName(currentFile) : null}
            scriptFolder={scriptFolder}
          />
        )}

        {tab === 'device' && (
          <div className="p-3 space-y-4">
            <div>
              <h3 className="text-xs font-medium text-text-primary mb-2">{t('device.theHandy')}</h3>
              <div className="flex items-center gap-2 mb-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    handyConnected ? 'bg-green-400' : 'bg-text-muted'
                  }`}
                />
                <span className="text-xs text-text-secondary">
                  {handyConnected ? t('device.connected') : t('device.disconnected')}
                </span>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                {t('device.connectionKey')}
              </label>
              <input
                type="text"
                placeholder={t('device.enterKey')}
                value={handyKey}
                onChange={(e) => setHandyKey(e.target.value)}
                className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none placeholder:text-text-muted font-mono"
              />
            </div>
            {handyConnected ? (
              <button
                onClick={onHandyDisconnect}
                className="w-full py-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded transition-colors"
              >
                {t('device.disconnect')}
              </button>
            ) : (
              <button
                onClick={() => handleConnect()}
                disabled={connecting || !handyKey.trim()}
                className="w-full py-2 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {connecting ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" />
                    {t('device.connecting')}
                  </>
                ) : (
                  t('device.connect')
                )}
              </button>
            )}

            {/* Auto-connect toggle */}
            <button
              onClick={handleAutoConnectToggle}
              className={`w-full py-2 text-xs rounded transition-colors flex items-center justify-center gap-2 ${
                autoConnect
                  ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                  : 'bg-surface-100/20 text-text-muted hover:bg-surface-100/30'
              }`}
            >
              <Zap size={12} />
              {autoConnect ? t('device.autoConnectOn') : t('device.autoConnectOff')}
            </button>

            {/* Recent connections */}
            {handyHistory.length > 0 && !handyConnected && (
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-wider flex items-center gap-1 mb-1.5">
                  <Clock size={10} />
                  {t('device.recentKeys')}
                </label>
                <div className="space-y-1">
                  {handyHistory.map((entry) => (
                    <div key={entry.key} className="flex items-center gap-1">
                      <button
                        onClick={() => handleConnect(entry.key)}
                        disabled={connecting}
                        className="flex-1 text-left px-2 py-1.5 text-xs font-mono text-text-secondary bg-surface-300 hover:bg-surface-100/30 rounded transition-colors truncate disabled:opacity-40"
                      >
                        {entry.key}
                      </button>
                      <button
                        onClick={() => handleRemoveHistory(entry.key)}
                        className="p-1 text-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-text-muted leading-relaxed">
              {t('device.getKey')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || ''
}
