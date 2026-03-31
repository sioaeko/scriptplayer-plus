import { Film, Music4, ChevronUp, ChevronDown, Trash2, FolderPlus, Save, FolderOpen, ListVideo } from 'lucide-react'
import { VideoFile } from '../types'
import { useTranslation } from '../i18n'

interface PlaylistPanelProps {
  playlist: VideoFile[]
  playlistIndex: number
  onItemSelect: (file: VideoFile, index: number) => void
  onRemove: (index: number) => void
  onClear: () => void
  onMove: (index: number, direction: 'up' | 'down') => void
  onAddFolder: () => void
  onSave: () => void
  onLoad: () => void
}

export default function PlaylistPanel({
  playlist,
  playlistIndex,
  onItemSelect,
  onRemove,
  onClear,
  onMove,
  onAddFolder,
  onSave,
  onLoad,
}: PlaylistPanelProps) {
  const { t } = useTranslation()
  const isEmpty = playlist.length === 0

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="p-2 flex gap-1.5 flex-wrap border-b border-surface-100/30">
        <button
          onClick={onAddFolder}
          title={t('playlist.addFolder')}
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-accent/10 hover:bg-accent/20 text-accent rounded transition-colors"
        >
          <FolderPlus size={12} />
          {t('playlist.addFolder')}
        </button>
        <button
          onClick={onLoad}
          title={t('playlist.load')}
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-100/30 hover:bg-surface-100/50 text-text-secondary hover:text-text-primary rounded transition-colors"
        >
          <FolderOpen size={12} />
          {t('playlist.load')}
        </button>
        <button
          onClick={onSave}
          disabled={isEmpty}
          title={t('playlist.save')}
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-100/30 hover:bg-surface-100/50 text-text-secondary hover:text-text-primary rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save size={12} />
          {t('playlist.save')}
        </button>
        <button
          onClick={onClear}
          disabled={isEmpty}
          title={t('playlist.clear')}
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
        >
          <Trash2 size={12} />
          {t('playlist.clear')}
        </button>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4 text-center">
          <ListVideo size={32} className="text-text-muted/40" />
          <p className="text-text-muted text-xs leading-relaxed">
            {t('playlist.empty')}
          </p>
        </div>
      )}

      {/* List */}
      {!isEmpty && (
        <div className="flex-1 overflow-y-auto px-1 py-1">
          {playlist.map((file, index) => (
            <div
              key={`${file.path}-${index}`}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md mb-0.5 group ${
                index === playlistIndex
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-secondary hover:bg-surface-100/30'
              }`}
            >
              {/* Position number */}
              <span className="text-[10px] w-5 text-right flex-shrink-0 text-text-muted tabular-nums">
                {index + 1}
              </span>

              {/* Media type icon */}
              {file.type === 'audio'
                ? <Music4 size={12} className="flex-shrink-0" />
                : <Film size={12} className="flex-shrink-0" />}

              {/* File name — click to play */}
              <button
                onClick={() => onItemSelect(file, index)}
                className="flex-1 text-left text-xs truncate min-w-0 hover:underline"
                title={file.name}
              >
                {file.name}
              </button>

              {/* Action buttons — reveal on hover */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button
                  onClick={() => onMove(index, 'up')}
                  disabled={index === 0}
                  className="p-0.5 hover:text-text-primary disabled:opacity-30 transition-colors"
                  title="Move up"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  onClick={() => onMove(index, 'down')}
                  disabled={index === playlist.length - 1}
                  className="p-0.5 hover:text-text-primary disabled:opacity-30 transition-colors"
                  title="Move down"
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  onClick={() => onRemove(index)}
                  className="p-0.5 hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}