import { FileSearch, X } from 'lucide-react'
import { useTranslation } from '../i18n'

interface ScriptMatchDialogItem {
  path: string
  title: string
  subtitle: string
  badge: string
}

interface ScriptMatchDialogProps {
  open: boolean
  scriptName: string | null
  items: ScriptMatchDialogItem[]
  onSelect: (mediaPath: string) => void | Promise<void>
  onClose: () => void
}

export default function ScriptMatchDialog({
  open,
  scriptName,
  items,
  onSelect,
  onClose,
}: ScriptMatchDialogProps) {
  const { t } = useTranslation()

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[560px] max-w-[92vw] rounded-2xl border border-surface-100/20 bg-surface-200 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-surface-100/20 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-accent">
              <FileSearch size={16} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                {t('scriptMatch.title')}
              </span>
            </div>
            <div className="truncate text-sm font-semibold text-text-primary">
              {scriptName || t('scriptMatch.unknownScript')}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-text-muted">
              {t('scriptMatch.description')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-100/30 hover:text-text-primary"
            aria-label={t('scriptMatch.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[52vh] space-y-2 overflow-y-auto px-4 py-4">
          {items.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => void onSelect(item.path)}
              className="w-full rounded-xl border border-surface-100/30 bg-surface-300/70 px-3 py-3 text-left transition-colors hover:border-accent/40 hover:bg-accent/10"
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="truncate text-sm font-medium text-text-primary">
                  {item.title}
                </div>
                <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent/90">
                  {item.badge}
                </span>
              </div>
              <div className="truncate text-[11px] text-text-muted">
                {item.subtitle}
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end border-t border-surface-100/20 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-surface-100/30 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            {t('scriptMatch.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
