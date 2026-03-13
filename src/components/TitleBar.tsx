import { Minus, Square, X, Settings } from 'lucide-react'
import { useTranslation } from '../i18n'

interface TitleBarProps {
  onOpenSettings?: () => void
}

const isMac = window.electronAPI?.platform === 'darwin'

export default function TitleBar({ onOpenSettings }: TitleBarProps) {
  const { t } = useTranslation()
  return (
    <div className="titlebar-drag flex items-center justify-between bg-surface-300 h-9 px-3 border-b border-surface-100/50 flex-shrink-0">
      <div className="flex items-center gap-2" style={isMac ? { paddingLeft: 68 } : undefined}>
        <div className="w-4 h-4 rounded bg-accent flex items-center justify-center text-[8px] font-bold text-surface-300">
          S+
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary">{t('app.name')}</span>
          <span className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent/90">
            v0.1.2
          </span>
        </div>
      </div>
      <div className="titlebar-no-drag flex items-center">
        <button
          onClick={onOpenSettings}
          className="w-10 h-9 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-100/50 transition-colors"
          title="Settings (Ctrl+,)"
        >
          <Settings size={14} />
        </button>
        {!isMac && (
          <>
            <button
              onClick={() => window.electronAPI?.minimize()}
              className="w-10 h-9 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-100/50 transition-colors"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => window.electronAPI?.maximize()}
              className="w-10 h-9 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-100/50 transition-colors"
            >
              <Square size={11} />
            </button>
            <button
              onClick={() => window.electronAPI?.close()}
              className="w-10 h-9 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-red-500/80 transition-colors"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
