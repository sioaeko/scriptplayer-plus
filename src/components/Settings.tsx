import { useState, useCallback, useEffect } from 'react'
import {
  Settings as SettingsIcon,
  Monitor,
  Activity,
  Play,
  Wifi,
  Keyboard,
  Info,
  X,
  FolderOpen,
} from 'lucide-react'
import { APP_VERSION } from '../constants/app'
import { AppSettings } from '../services/settings'
import { useTranslation } from '../i18n'

interface SettingsProps {
  open: boolean
  onClose: () => void
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  initialSection?: SettingsSection
}

export type SettingsSection =
  | 'general'
  | 'playback'
  | 'appearance'
  | 'timeline'
  | 'device'
  | 'shortcuts'
  | 'about'

// ── Shared primitives ────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-surface-100'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-surface-300 transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  )
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-xs text-text-primary">{label}</div>
        {description && (
          <div className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
            {description}
          </div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-text-primary mb-4">{children}</h2>
  )
}

function Divider() {
  return <div className="border-t border-surface-100/30 my-3" />
}

function formatSecondsLabel(value: number): string {
  const formatted = Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(1).replace(/\.0$/, '')
  return `${formatted}s`
}

// ── Section components ───────────────────────────────────────────────

function GeneralSection({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}) {
  const { t } = useTranslation()
  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) =>
    onChange({ ...settings, [key]: val })

  const handleBrowseFolder = async () => {
    try {
      const folderPath = await (window as any).electronAPI?.openFolder?.()
      if (folderPath) update('defaultVideoFolder', folderPath)
    } catch {}
  }

  const handleBrowseScriptFolder = async () => {
    try {
      const folderPath = await (window as any).electronAPI?.openFolder?.()
      if (folderPath) update('scriptFolder', folderPath)
    } catch {}
  }

  return (
    <div>
      <SectionHeading>{t('settings.general')}</SectionHeading>

      <FieldRow label={t('settings.language')}>
        <select
          value={settings.language}
          onChange={(e) => update('language', e.target.value)}
          className="bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none min-w-[140px]"
        >
          <option value="en">English</option>
          <option value="ko">한국어</option>
          <option value="ja">日本語</option>
          <option value="zh">中文</option>
        </select>
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.videoFolder')}
        description={settings.defaultVideoFolder || t('settings.noFolderSelected')}
      >
        <button
          onClick={handleBrowseFolder}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent rounded text-xs transition-colors"
        >
          <FolderOpen size={12} />
          {t('settings.browse')}
        </button>
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.scriptFolder')}
        description={settings.scriptFolder || t('settings.noFolderSelected')}
      >
        <button
          onClick={handleBrowseScriptFolder}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent rounded text-xs transition-colors"
        >
          <FolderOpen size={12} />
          {t('settings.browse')}
        </button>
      </FieldRow>

    </div>
  )
}

function AppearanceSection({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}) {
  const { t } = useTranslation()
  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) =>
    onChange({ ...settings, [key]: val })
  return (
    <div>
      <SectionHeading>{t('settings.appearance')}</SectionHeading>
      <FieldRow label={t('settings.theme')}>
        <select
          disabled
          value="dark"
          className="bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 outline-none min-w-[140px] opacity-60 cursor-not-allowed"
        >
          <option value="dark">{t('settings.dark')}</option>
        </select>
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.subtitleSize')}
        description={`${settings.subtitleFontSize}px`}
      >
        <input
          type="range"
          min={14}
          max={32}
          step={1}
          value={settings.subtitleFontSize}
          onChange={(e) => update('subtitleFontSize', Number(e.target.value))}
          className="w-36"
        />
      </FieldRow>
    </div>
  )
}

function PlaybackSection({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}) {
  const { t } = useTranslation()
  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) =>
    onChange({ ...settings, [key]: val })
  const controlsDisabled = !settings.autoSkipScriptGaps

  return (
    <div>
      <SectionHeading>{t('settings.playback')}</SectionHeading>

      <FieldRow
        label={t('settings.autoSkipScriptGaps')}
        description={t('settings.autoSkipScriptGapsDesc')}
      >
        <Toggle
          checked={settings.autoSkipScriptGaps}
          onChange={(v) => update('autoSkipScriptGaps', v)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.autoSkipGapMinDuration')}
        description={`${formatSecondsLabel(settings.autoSkipGapMinDuration)} • ${t('settings.autoSkipGapMinDurationDesc')}`}
      >
        <input
          type="range"
          min={3}
          max={60}
          step={1}
          disabled={controlsDisabled}
          value={settings.autoSkipGapMinDuration}
          onChange={(e) => update('autoSkipGapMinDuration', Number(e.target.value))}
          className={`w-36 ${controlsDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.autoSkipGapLeadIn')}
        description={`${formatSecondsLabel(settings.autoSkipGapLeadIn)} • ${t('settings.autoSkipGapLeadInDesc')}`}
      >
        <input
          type="range"
          min={0}
          max={5}
          step={0.5}
          disabled={controlsDisabled}
          value={settings.autoSkipGapLeadIn}
          onChange={(e) => update('autoSkipGapLeadIn', Number(e.target.value))}
          className={`w-36 ${controlsDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </FieldRow>
    </div>
  )
}

function TimelineSection({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}) {
  const { t } = useTranslation()
  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) =>
    onChange({ ...settings, [key]: val })

  return (
    <div>
      <SectionHeading>{t('settings.timeline')}</SectionHeading>

      <FieldRow
        label={t('settings.scriptTimelineHeight')}
        description={`${settings.timelineHeight}px`}
      >
        <input
          type="range"
          min={40}
          max={120}
          step={4}
          value={settings.timelineHeight}
          onChange={(e) => update('timelineHeight', Number(e.target.value))}
          className="w-36"
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.visibleWindow')}
        description={`${settings.timelineWindow} seconds`}
      >
        <input
          type="range"
          min={5}
          max={30}
          step={1}
          value={settings.timelineWindow}
          onChange={(e) => update('timelineWindow', Number(e.target.value))}
          className="w-36"
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.scriptColors')}
        description={t('settings.scriptColorsDesc')}
      >
        <Toggle
          checked={settings.speedColors}
          onChange={(v) => update('speedColors', v)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.defaultShowTimeline')}
        description={t('settings.defaultShowTimelineDesc')}
      >
        <Toggle
          checked={settings.showTimelineByDefault}
          onChange={(v) => update('showTimelineByDefault', v)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.defaultShowHeatmap')}
        description={t('settings.defaultShowHeatmapDesc')}
      >
        <Toggle
          checked={settings.showHeatmapByDefault}
          onChange={(v) => update('showHeatmapByDefault', v)}
        />
      </FieldRow>
    </div>
  )
}

function DeviceSection({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}) {
  const { t } = useTranslation()
  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) =>
    onChange({ ...settings, [key]: val })

  return (
    <div>
      <SectionHeading>{t('settings.device')}</SectionHeading>

      <FieldRow
        label={t('settings.strokeRangeMin')}
        description={`${settings.strokeRangeMin}%`}
      >
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.strokeRangeMin}
          onChange={(e) => {
            const v = Number(e.target.value)
            update('strokeRangeMin', Math.min(v, settings.strokeRangeMax))
          }}
          className="w-36"
        />
      </FieldRow>

      <FieldRow
        label={t('settings.strokeRangeMax')}
        description={`${settings.strokeRangeMax}%`}
      >
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.strokeRangeMax}
          onChange={(e) => {
            const v = Number(e.target.value)
            update('strokeRangeMax', Math.max(v, settings.strokeRangeMin))
          }}
          className="w-36"
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.inverseStroke')}
        description={t('settings.inverseStrokeDesc')}
      >
        <Toggle
          checked={settings.invertStroke}
          onChange={(v) => update('invertStroke', v)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.timeOffset')}
        description={`${settings.timeOffset >= 0 ? '+' : ''}${settings.timeOffset} ms`}
      >
        <input
          type="range"
          min={-500}
          max={500}
          step={10}
          value={settings.timeOffset}
          onChange={(e) => update('timeOffset', Number(e.target.value))}
          className="w-36"
        />
      </FieldRow>
    </div>
  )
}

function ShortcutsSection() {
  const { t } = useTranslation()

  const shortcutGroups = [
    {
      title: t('settings.playback'),
      items: [
        { keys: 'Space', action: t('settings.playPause') },
        { keys: 'Left Arrow', action: t('settings.seekBackward5s') },
        { keys: 'Right Arrow', action: t('settings.seekForward5s') },
        { keys: 'Shift + Left', action: t('settings.seekBackward10s') },
        { keys: 'Shift + Right', action: t('settings.seekForward10s') },
        { keys: 'Home', action: t('settings.goToStart') },
        { keys: 'End', action: t('settings.goToEnd') },
      ],
    },
    {
      title: t('settings.volume'),
      items: [
        { keys: 'Up Arrow', action: t('settings.volumeUp') },
        { keys: 'Down Arrow', action: t('settings.volumeDown') },
        { keys: 'M', action: t('settings.toggleMute') },
      ],
    },
    {
      title: t('settings.view'),
      items: [
        { keys: 'F', action: t('settings.toggleFullscreen') },
        { keys: 'Escape', action: t('settings.exitFullscreen') },
      ],
    },
    {
      title: t('settings.general'),
      items: [
        { keys: 'Ctrl + O', action: t('settings.openFolder') },
        { keys: 'Ctrl + ,', action: t('settings.openSettings') },
      ],
    },
  ]

  return (
    <div>
      <SectionHeading>{t('settings.keyboardShortcuts')}</SectionHeading>
      <div className="space-y-5">
        {shortcutGroups.map((group) => (
          <div key={group.title}>
            <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => (
                <div
                  key={item.keys}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="text-xs text-text-secondary">
                    {item.action}
                  </span>
                  <kbd className="text-[10px] font-mono bg-surface-300 text-text-muted border border-surface-100/30 px-2 py-0.5 rounded">
                    {item.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AboutSection() {
  const { t } = useTranslation()
  return (
    <div>
      <SectionHeading>{t('settings.about')}</SectionHeading>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
          <Activity size={24} className="text-accent" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-text-primary">
              {t('app.name')}
            </div>
            <div className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold leading-none text-accent/90">
              v{APP_VERSION}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 text-xs text-text-secondary">
        <p>{t('settings.aboutDescription')}</p>
        <p className="text-text-muted">
          Built with Electron, React, and Tailwind CSS.
        </p>
      </div>

      <Divider />

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-text-muted">Electron</span>
          <span className="text-text-secondary font-mono">
            {(window as any).electronAPI?.versions?.electron ?? '\u2014'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Chrome</span>
          <span className="text-text-secondary font-mono">
            {(window as any).electronAPI?.versions?.chrome ?? '\u2014'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Node</span>
          <span className="text-text-secondary font-mono">
            {(window as any).electronAPI?.versions?.node ?? '\u2014'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────

export default function Settings({
  open,
  onClose,
  settings,
  onSettingsChange,
  initialSection = 'general',
}: SettingsProps) {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection)

  const sectionItems: { id: SettingsSection; label: string; icon: typeof SettingsIcon }[] = [
    { id: 'general', label: t('settings.general'), icon: SettingsIcon },
    { id: 'playback', label: t('settings.playback'), icon: Play },
    { id: 'appearance', label: t('settings.appearance'), icon: Monitor },
    { id: 'timeline', label: t('settings.timeline'), icon: Activity },
    { id: 'device', label: t('settings.device'), icon: Wifi },
    { id: 'shortcuts', label: t('settings.keyboardShortcuts'), icon: Keyboard },
    { id: 'about', label: t('settings.about'), icon: Info },
  ]

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    setActiveSection(initialSection)
  }, [initialSection, open])

  const handleChange = useCallback(
    (next: AppSettings) => {
      onSettingsChange(next)
    },
    [onSettingsChange]
  )

  if (!open) return null

  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSection settings={settings} onChange={handleChange} />
      case 'playback':
        return <PlaybackSection settings={settings} onChange={handleChange} />
      case 'appearance':
        return <AppearanceSection settings={settings} onChange={handleChange} />
      case 'timeline':
        return <TimelineSection settings={settings} onChange={handleChange} />
      case 'device':
        return <DeviceSection settings={settings} onChange={handleChange} />
      case 'shortcuts':
        return <ShortcutsSection />
      case 'about':
        return <AboutSection />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[720px] max-w-[90vw] h-[520px] max-h-[85vh] bg-surface-200 rounded-xl shadow-2xl border border-surface-100/20 flex overflow-hidden">
        <div className="w-48 flex-shrink-0 bg-surface-300 border-r border-surface-100/20 flex flex-col">
          <div className="px-4 pt-4 pb-3">
            <h1 className="text-sm font-semibold text-text-primary">{t('settings.title')}</h1>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            {sectionItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors mb-0.5 ${
                  activeSection === id
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-secondary hover:bg-surface-100/20 hover:text-text-primary'
                }`}
              >
                <Icon size={14} className="flex-shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-end px-4 pt-3 pb-0">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-100/30 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">{renderSection()}</div>
        </div>
      </div>
    </div>
  )
}
