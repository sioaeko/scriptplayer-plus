import { Play, X, FolderOpen, Save, Plus, Trash2, Upload } from 'lucide-react'
import { PlaylistItem, VideoFile } from '../types'
import { useTranslation } from '../i18n'

interface PlaylistPanelProps {
  playlist: PlaylistItem[]
  currentFile: string | null
  filesInFolder: VideoFile[]
  onPlayItem: (path: string) => void
  onImportFromFiles: () => void
  onImportFromFolder: () => void
  onLoadPlaylist: () => void
  onSavePlaylist: () => void
  onClearPlaylist: () => void
  onRemoveItem: (index: number) => void
}

function getBasename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

export default function PlaylistPanel({
  playlist,
  currentFile,
  filesInFolder,
  onPlayItem,
  onImportFromFiles,
  onImportFromFolder,
  onLoadPlaylist,
  onSavePlaylist,
  onClearPlaylist,
  onRemoveItem,
}: PlaylistPanelProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar row 1 */}
      <div className="p-2 flex gap-1.5">
        <button
          onClick={onLoadPlaylist}
          title={t('playlist.open')}
          className="flex items-center gap-1 px-2 py-1.5 bg-surface-100/20 hover:bg-surface-100/40 text-text-secondary hover:text-text-primary rounded text-xs transition-colors"
        >
          <Upload size={12} />
          {t('playlist.open')}
        </button>
        <button
          onClick={onSavePlaylist}
          disabled={playlist.length === 0}
          title={t('playlist.save')}
          className="flex items-center gap-1 px-2 py-1.5 bg-surface-100/20 hover:bg-surface-100/40 text-text-secondary hover:text-text-primary rounded text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save size={12} />
          {t('playlist.save')}
        </button>
        {playlist.length > 0 && (
          <button
            onClick={onClearPlaylist}
            title={t('playlist.new')}
            className="flex items-center gap-1 px-2 py-1.5 bg-surface-100/20 hover:bg-red-500/20 text-text-secondary hover:text-red-400 rounded text-xs transition-colors ml-auto"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Toolbar row 2 */}
      <div className="px-2 pb-2 flex gap-1.5">
        <button
          onClick={onImportFromFiles}
          disabled={filesInFolder.length === 0}
          title={t('playlist.importFromFiles')}
          className="flex items-center gap-1 px-2 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent rounded text-xs transition-colors flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
          {t('playlist.importFromFiles')}
        </button>
        <button
          onClick={onImportFromFolder}
          title={t('playlist.importFromFolder')}
          className="flex items-center gap-1 px-2 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent rounded text-xs transition-colors flex-1"
        >
          <FolderOpen size={12} />
          {t('playlist.importFromFolder')}
        </button>
      </div>

      {/* Item count */}
      {playlist.length > 0 && (
        <div className="px-3 pb-1.5 text-[10px] text-text-muted">
          {t('playlist.items', { count: String(playlist.length) })}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1">
        {playlist.length === 0 ? (
          <div className="text-text-muted text-xs text-center py-8 px-4 whitespace-pre-line leading-relaxed">
            {t('playlist.empty')}
          </div>
        ) : (
          playlist.map((item, index) => {
            const isActive = item.path === currentFile
            const displayName = item.title || getBasename(item.path)
            return (
              <div
                key={`${item.path}-${index}`}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md mb-0.5 group transition-colors ${
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-secondary hover:bg-surface-100/30 hover:text-text-primary'
                }`}
              >
                <span className="text-[10px] text-text-muted w-5 flex-shrink-0 text-right">
                  {index + 1}
                </span>
                <button
                  onClick={() => onPlayItem(item.path)}
                  className="flex-1 text-left text-xs leading-relaxed break-all min-w-0"
                  title={item.path}
                >
                  {displayName}
                </button>
                <button
                  onClick={() => onPlayItem(item.path)}
                  className={`flex-shrink-0 p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 ${
                    isActive ? 'opacity-100 text-accent' : 'text-text-muted hover:text-text-primary'
                  }`}
                  title="Play"
                >
                  <Play size={11} />
                </button>
                <button
                  onClick={() => onRemoveItem(index)}
                  className="flex-shrink-0 p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400"
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}