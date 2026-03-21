import { useState, useMemo, useEffect, useRef } from 'react'
import { FolderOpen, Film, FileCheck, Search, RefreshCw, Wifi, WifiOff, Folder, ChevronDown, ChevronRight, Clock, X, Zap, Music4, Captions } from 'lucide-react'
import { OsrSerialPortInfo, ScriptAxisId, VideoFile } from '../types'
import { ButtplugDevice, ButtplugFeature } from '../services/buttplug'
import { getScriptAxisDefinition } from '../services/multiaxis'
import { useTranslation } from '../i18n'
import EroScriptsPanel from './EroScriptsPanel'

type DeviceProvider = 'handy' | 'buttplug' | 'serial'

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
  onManualScriptSelect: (file: VideoFile) => void | Promise<void>
  onManualSubtitleSelect: (file: VideoFile) => void | Promise<void>
  onClearManualScript: (file: VideoFile) => void | Promise<void>
  onClearManualSubtitle: (file: VideoFile) => void | Promise<void>
  manualScriptPaths: Set<string>
  manualSubtitlePaths: Set<string>
  deviceProvider: DeviceProvider
  onDeviceProviderChange: (provider: DeviceProvider) => void
  handyConnected: boolean
  onHandyConnect: (key: string) => void | Promise<void>
  onHandyDisconnect: () => void | Promise<void>
  osrSerialConnected: boolean
  osrSerialConnecting: boolean
  osrSerialPorts: OsrSerialPortInfo[]
  selectedOsrSerialPortPath: string
  onOsrSerialPortSelect: (portPath: string) => void
  onOsrSerialRefresh: () => void | Promise<void>
  onOsrSerialConnect: (portPath: string) => void | Promise<void>
  onOsrSerialDisconnect: () => void | Promise<void>
  osrSerialError?: string | null
  osrSerialUpdateRate: number
  onOsrSerialUpdateRateChange: (rate: number) => void
  buttplugConnected: boolean
  buttplugConnecting: boolean
  buttplugDevices: ButtplugDevice[]
  buttplugServerUrl: string
  onButtplugServerUrlChange: (url: string) => void
  onButtplugConnect: (url: string) => void | Promise<void>
  onButtplugDisconnect: () => void | Promise<void>
  buttplugScanning: boolean
  onButtplugScan: () => void | Promise<void>
  selectedButtplugDeviceIndex: number | null
  onButtplugDeviceSelect: (deviceIndex: number | null) => void
  buttplugError?: string | null
  buttplugFeatures: ButtplugFeature[]
  buttplugFeatureMappings: Record<string, { axisId: ScriptAxisId | ''; invert: boolean }>
  onButtplugFeatureMappingChange: (featureId: string, next: { axisId: ScriptAxisId | ''; invert: boolean }) => void
  buttplugAvailableAxes: ScriptAxisId[]
  scriptFolder?: string
}

interface FileContextMenuState {
  file: VideoFile
  x: number
  y: number
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
  onManualScriptSelect,
  onManualSubtitleSelect,
  onClearManualScript,
  onClearManualSubtitle,
  manualScriptPaths,
  manualSubtitlePaths,
  deviceProvider,
  onDeviceProviderChange,
  handyConnected,
  onHandyConnect,
  onHandyDisconnect,
  osrSerialConnected,
  osrSerialConnecting,
  osrSerialPorts,
  selectedOsrSerialPortPath,
  onOsrSerialPortSelect,
  onOsrSerialRefresh,
  onOsrSerialConnect,
  onOsrSerialDisconnect,
  osrSerialError,
  osrSerialUpdateRate,
  onOsrSerialUpdateRateChange,
  buttplugConnected,
  buttplugConnecting,
  buttplugDevices,
  buttplugServerUrl,
  onButtplugServerUrlChange,
  onButtplugConnect,
  onButtplugDisconnect,
  buttplugScanning,
  onButtplugScan,
  selectedButtplugDeviceIndex,
  onButtplugDeviceSelect,
  buttplugError,
  buttplugFeatures,
  buttplugFeatureMappings,
  onButtplugFeatureMappingChange,
  buttplugAvailableAxes,
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
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)
  const autoConnectAttempted = useRef(false)

  const filteredFiles = files.filter((f) =>
    (f.relativePath || f.name).toLowerCase().includes(filter.toLowerCase())
  )

  const folderGroups = useMemo(() => groupByFolder(filteredFiles), [filteredFiles])
  const hasSubfolders = folderGroups.length > 1 || (folderGroups.length === 1 && folderGroups[0].folder !== '')
  const activeDeviceConnected = deviceProvider === 'handy'
    ? handyConnected
    : (deviceProvider === 'serial' ? osrSerialConnected : buttplugConnected)
  const selectedButtplugDevice = useMemo(
    () => buttplugDevices.find((device) => device.index === selectedButtplugDeviceIndex) ?? null,
    [buttplugDevices, selectedButtplugDeviceIndex]
  )
  const selectedOsrSerialPort = useMemo(
    () => osrSerialPorts.find((port) => port.path === selectedOsrSerialPortPath) ?? null,
    [osrSerialPorts, selectedOsrSerialPortPath]
  )
  const selectedOsrSerialPortValue = useMemo(
    () => (osrSerialPorts.some((port) => port.path === selectedOsrSerialPortPath) ? selectedOsrSerialPortPath : ''),
    [osrSerialPorts, selectedOsrSerialPortPath]
  )
  const availableAxisOptions = useMemo(
    () => buttplugAvailableAxes.map((axisId) => ({
      id: axisId,
      label: `${axisId} ${getScriptAxisDefinition(axisId).description}`,
    })),
    [buttplugAvailableAxes]
  )

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
    try {
      setConnecting(true)
      setHandyKey(k)
      localStorage.setItem('handyKey', k)
      await onHandyConnect(k)
      const updated = addToHandyHistory(k)
      setHandyHistory(updated)
    } finally {
      setConnecting(false)
    }
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

  useEffect(() => {
    if (deviceProvider !== 'handy') {
      autoConnectAttempted.current = false
    }
  }, [deviceProvider])

  useEffect(() => {
    if (
      deviceProvider !== 'handy'
      || !autoConnect
      || handyConnected
      || handyHistory.length === 0
      || autoConnectAttempted.current
    ) {
      return
    }

    autoConnectAttempted.current = true
    void handleConnect(handyHistory[0].key)
  }, [autoConnect, deviceProvider, handyConnected, handyHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!contextMenu) return

    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('blur', closeMenu)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('blur', closeMenu)
    }
  }, [contextMenu])

  const tabs = [
    { id: 'files' as const, icon: Film, label: t('sidebar.files') },
    { id: 'search' as const, icon: Search, label: t('sidebar.scripts') },
    { id: 'device' as const, icon: activeDeviceConnected ? Wifi : WifiOff, label: t('sidebar.device') },
  ]

  const handleFileContextMenu = (event: React.MouseEvent<HTMLButtonElement>, file: VideoFile) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      file,
      x: event.clientX,
      y: event.clientY,
    })
  }

  const renderFileItem = (file: VideoFile) => (
    <button
      key={file.path}
      onClick={() => onFileSelect(file)}
      onContextMenu={(event) => handleFileContextMenu(event, file)}
      className={`w-full text-left px-3 py-2 rounded-md text-xs flex items-start gap-2 transition-colors mb-0.5 ${
        currentFile === file.path
          ? 'bg-accent/15 text-accent'
          : 'text-text-secondary hover:bg-surface-100/30 hover:text-text-primary'
      }`}
    >
      {file.type === 'audio'
        ? <Music4 size={14} className="flex-shrink-0 mt-0.5" />
        : <Film size={14} className="flex-shrink-0 mt-0.5" />}
      <span className="break-all leading-relaxed flex-1 min-w-0">{file.name}</span>
      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
        {file.hasSubtitles && <Captions size={14} className="text-sky-400" />}
        {file.hasScript && <FileCheck size={14} className="text-green-400" />}
      </div>
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
              <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                {t('device.provider')}
              </label>
              <select
                value={deviceProvider}
                onChange={(event) => onDeviceProviderChange(event.target.value as DeviceProvider)}
                className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none"
              >
                <option value="handy">{t('device.providerHandy')}</option>
                <option value="serial">{t('device.providerSerial')}</option>
                <option value="buttplug">{t('device.providerIntiface')}</option>
              </select>
            </div>

            {deviceProvider === 'handy' ? (
              <>
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
              </>
            ) : deviceProvider === 'serial' ? (
              <>
                <div>
                  <h3 className="text-xs font-medium text-text-primary mb-2">{t('device.serial')}</h3>
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        osrSerialConnected ? 'bg-green-400' : 'bg-text-muted'
                      }`}
                    />
                    <span className="text-xs text-text-secondary">
                      {osrSerialConnected ? t('device.connected') : t('device.disconnected')}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                      {t('device.serialPort')}
                    </label>
                    <select
                      value={selectedOsrSerialPortValue}
                      onChange={(event) => onOsrSerialPortSelect(event.target.value)}
                      className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none"
                    >
                      {osrSerialPorts.length === 0 ? (
                        <option value="">{t('device.noSerialPorts')}</option>
                      ) : (
                        osrSerialPorts.map((port) => (
                          <option key={port.path} value={port.path}>
                            {port.displayName}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <button
                    onClick={onOsrSerialRefresh}
                    className="self-end px-3 py-2 text-xs bg-surface-100/20 text-text-secondary hover:bg-surface-100/30 rounded transition-colors flex items-center gap-2"
                  >
                    <RefreshCw size={12} />
                    {t('device.refresh')}
                  </button>
                </div>

                <div>
                  <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                    {t('device.updateRate')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={5}
                      max={200}
                      step={1}
                      value={osrSerialUpdateRate}
                      onChange={(event) => onOsrSerialUpdateRateChange(Number(event.target.value))}
                      className="flex-1"
                    />
                    <input
                      type="number"
                      min={5}
                      max={200}
                      step={1}
                      value={osrSerialUpdateRate}
                      onChange={(event) => onOsrSerialUpdateRateChange(Number(event.target.value))}
                      className="w-20 bg-surface-300 text-text-primary text-xs px-2 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none"
                    />
                    <span className="text-[10px] text-text-muted">Hz</span>
                  </div>
                </div>

                {selectedOsrSerialPort && (
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    {[
                      selectedOsrSerialPort.manufacturer,
                      selectedOsrSerialPort.serialNumber,
                      selectedOsrSerialPort.vendorId && selectedOsrSerialPort.productId
                        ? `${selectedOsrSerialPort.vendorId}:${selectedOsrSerialPort.productId}`
                        : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}

                {osrSerialConnected ? (
                  <button
                    onClick={onOsrSerialDisconnect}
                    className="w-full py-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                  >
                    {t('device.disconnect')}
                  </button>
                ) : (
                  <button
                    onClick={() => onOsrSerialConnect(selectedOsrSerialPortValue)}
                    disabled={osrSerialConnecting || !selectedOsrSerialPortValue}
                    className="w-full py-2 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {osrSerialConnecting ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" />
                        {t('device.connecting')}
                      </>
                    ) : (
                      t('device.connect')
                    )}
                  </button>
                )}

                {osrSerialError && (
                  <p className="text-[10px] text-red-400 leading-relaxed">
                    {osrSerialError}
                  </p>
                )}

                <p className="text-[10px] text-text-muted leading-relaxed">
                  {t('device.serialHint')}
                </p>
              </>
            ) : (
              <>
                <div>
                  <h3 className="text-xs font-medium text-text-primary mb-2">{t('device.intiface')}</h3>
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        buttplugConnected ? 'bg-green-400' : 'bg-text-muted'
                      }`}
                    />
                    <span className="text-xs text-text-secondary">
                      {buttplugConnected ? t('device.connected') : t('device.disconnected')}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                    {t('device.intifaceServer')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('device.enterIntifaceServer')}
                    value={buttplugServerUrl}
                    onChange={(event) => onButtplugServerUrlChange(event.target.value)}
                    className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none placeholder:text-text-muted font-mono"
                  />
                </div>
                {buttplugConnected ? (
                  <button
                    onClick={onButtplugDisconnect}
                    className="w-full py-2 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                  >
                    {t('device.disconnect')}
                  </button>
                ) : (
                  <button
                    onClick={() => onButtplugConnect(buttplugServerUrl)}
                    disabled={buttplugConnecting || !buttplugServerUrl.trim()}
                    className="w-full py-2 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {buttplugConnecting ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" />
                        {t('device.connecting')}
                      </>
                    ) : (
                      t('device.connect')
                    )}
                  </button>
                )}

                <button
                  onClick={onButtplugScan}
                  disabled={!buttplugConnected || buttplugScanning}
                  className="w-full py-2 text-xs bg-surface-100/20 text-text-secondary hover:bg-surface-100/30 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {buttplugScanning ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      {t('device.scanning')}
                    </>
                  ) : (
                    t('device.scan')
                  )}
                </button>

                <div>
                  <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
                    {t('device.linearDevice')}
                  </label>
                  <select
                    value={selectedButtplugDevice ? selectedButtplugDevice.index.toString() : ''}
                    onChange={(event) => onButtplugDeviceSelect(event.target.value ? Number(event.target.value) : null)}
                    disabled={!buttplugConnected || buttplugDevices.length === 0}
                    className="w-full bg-surface-300 text-text-primary text-xs px-3 py-2 rounded border border-surface-100/30 focus:border-accent/50 outline-none disabled:opacity-40"
                  >
                    {buttplugDevices.length === 0 ? (
                      <option value="">{t('device.noLinearDevices')}</option>
                    ) : (
                      buttplugDevices.map((device) => (
                        <option key={device.index} value={device.index}>
                          {`${device.displayName} (${device.features.length})`}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {selectedButtplugDevice && (
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    {selectedButtplugDevice.features.map((feature) => feature.descriptor).join(', ')}
                  </p>
                )}

                {selectedButtplugDevice && buttplugFeatures.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-[10px] text-text-muted uppercase tracking-wider block">
                      {t('device.axisMapping')}
                    </label>
                    {buttplugFeatures.map((feature) => {
                      const mapping = buttplugFeatureMappings[feature.id] || { axisId: '', invert: false }
                      return (
                        <div key={feature.id} className="rounded border border-surface-100/30 bg-surface-300/60 p-2 space-y-2">
                          <div className="text-[10px] text-text-secondary">
                            {feature.descriptor}
                          </div>
                          <div className="flex gap-2">
                            <select
                              value={mapping.axisId}
                              onChange={(event) => onButtplugFeatureMappingChange(feature.id, {
                                ...mapping,
                                axisId: event.target.value as ScriptAxisId | '',
                              })}
                              className="flex-1 bg-surface-300 text-text-primary text-xs px-2 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none"
                            >
                              <option value="">{t('device.unmapped')}</option>
                              {availableAxisOptions.map((axis) => (
                                <option key={axis.id} value={axis.id}>
                                  {axis.label}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => onButtplugFeatureMappingChange(feature.id, {
                                ...mapping,
                                invert: !mapping.invert,
                              })}
                              className={`px-2 py-1.5 rounded text-[10px] transition-colors ${
                                mapping.invert
                                  ? 'bg-accent/15 text-accent'
                                  : 'bg-surface-100/20 text-text-muted hover:bg-surface-100/30'
                              }`}
                            >
                              {t('device.invertAxis')}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {buttplugError && (
                  <p className="text-[10px] text-red-400 leading-relaxed">
                    {buttplugError}
                  </p>
                )}

                <p className="text-[10px] text-text-muted leading-relaxed">
                  {t('device.intifaceHint')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 min-w-48 overflow-hidden rounded-lg border border-surface-100/40 bg-surface-200 shadow-2xl"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 220),
            top: Math.min(contextMenu.y, window.innerHeight - 180),
          }}
        >
          <button
            onClick={() => {
              setContextMenu(null)
              onManualScriptSelect(contextMenu.file)
            }}
            className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
          >
            {t('sidebar.selectScript')}
          </button>
          <button
            onClick={() => {
              setContextMenu(null)
              onManualSubtitleSelect(contextMenu.file)
            }}
            className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
          >
            {t('sidebar.selectSubtitle')}
          </button>
          {manualScriptPaths.has(contextMenu.file.path) && (
            <button
              onClick={() => {
                setContextMenu(null)
                onClearManualScript(contextMenu.file)
              }}
              className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
            >
              {t('sidebar.clearManualScript')}
            </button>
          )}
          {manualSubtitlePaths.has(contextMenu.file.path) && (
            <button
              onClick={() => {
                setContextMenu(null)
                onClearManualSubtitle(contextMenu.file)
              }}
              className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-100/30 hover:text-text-primary transition-colors"
            >
              {t('sidebar.clearManualSubtitle')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || ''
}
