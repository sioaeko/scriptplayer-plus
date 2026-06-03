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
  MessageSquare,
  RotateCcw,
} from 'lucide-react'
import { APP_VERSION } from '../constants/app'
import { APP_LINKS, APP_SUPPORT_ICONS } from '../constants/links'
import { checkForUpdates, type UpdateCheckResult } from '../services/updateChecker'
import {
  AppSettings,
  MOTION_SPEED_LIMIT_MAX,
  MOTION_SPEED_LIMIT_MIN,
  MOTION_SPEED_LIMIT_PRESET_VALUES,
  MOTION_SPEED_LIMIT_PRESETS,
  MOTION_SPEED_LIMIT_STEP,
  NO_SCRIPT_RANDOM_FILL_GAP_MAX_SECONDS,
  NO_SCRIPT_RANDOM_FILL_GAP_MIN_SECONDS,
  NO_SCRIPT_RANDOM_FILL_GAP_STEP_SECONDS,
  UI_SCALE_OPTIONS,
  VIDEO_COMPATIBILITY_MODES,
} from '../services/settings'
import {
  getNoScriptStrokePatternForPreset,
  NO_SCRIPT_STROKE_MAX_SPM,
  NO_SCRIPT_STROKE_MIN_SPM,
  NO_SCRIPT_STROKE_PATTERNS,
  NO_SCRIPT_STROKE_PRESET_SPEED_RANGES,
  NO_SCRIPT_STROKE_PRESETS,
  NO_SCRIPT_STROKE_SPEED_STEP,
} from '../services/noScriptStroke'
import {
  captureShortcutBinding,
  DEFAULT_SHORTCUT_BINDINGS,
  getShortcutDisplay,
  setShortcutBinding,
  ShortcutActionId,
} from '../services/shortcuts'
import { useTranslation } from '../i18n'
import type { UpdaterState } from '../types'

interface SettingsProps {
  open: boolean
  onClose: () => void
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  autoNextPlayEnabled: boolean
  onAutoNextPlayChange: (enabled: boolean) => void
  onResetIntifaceSettings: () => void | Promise<void>
  onResetAllSettings: () => void | Promise<void>
  onDeviceTestCommand?: (command: DeviceTestCommand) => void | Promise<void>
  initialSection?: SettingsSection
}

type DeviceTestCommand = 'L0' | 'V0' | 'V1' | 'R0' | 'stop'

export type SettingsSection =
  | 'general'
  | 'playback'
  | 'appearance'
  | 'timeline'
  | 'device'
  | 'shortcuts'
  | 'recovery'
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

function formatSpeedLabel(value: number): string {
  return `${Math.round(value)} spm`
}

function getVideoCompatibilityModeLabel(mode: AppSettings['videoCompatibilityMode']): string {
  switch (mode) {
    case 'disable-gpu-video-decode':
      return 'Disable GPU video decode'
    case 'disable-hardware-acceleration':
      return 'Disable hardware acceleration'
    case 'software-renderer':
      return 'Software renderer'
    case 'auto':
    default:
      return 'Auto'
  }
}

function formatUpdaterStatus(state: UpdaterState | null): string {
  if (!state) return ''

  if (!state.autoUpdateSupported) {
    return 'Manual update mode. ZIP/portable users should download new releases from GitHub.'
  }

  switch (state.phase) {
    case 'checking':
      return 'Checking for updates...'
    case 'available':
      return state.latestVersion
        ? `Update ${state.latestVersion} is available.`
        : 'An update is available.'
    case 'downloading':
      return state.progressPercent !== null
        ? `Downloading update... ${Math.round(state.progressPercent)}%`
        : 'Downloading update...'
    case 'downloaded':
      return 'Update downloaded. Restart to install.'
    case 'error':
      return state.error || 'Update check failed.'
    case 'idle':
    default:
      if (state.updateAvailable === false) {
        return 'You are on the latest version.'
      }
      return ''
  }
}

function ShortcutCaptureButton({
  value,
  onChange,
}: {
  value: AppSettings['keyboardShortcuts'][ShortcutActionId]
  onChange: (value: AppSettings['keyboardShortcuts'][ShortcutActionId]) => void
}) {
  const { t } = useTranslation()
  const [listening, setListening] = useState(false)

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!listening) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setListening(false)
      return
    }

    const nextBinding = captureShortcutBinding(event.nativeEvent)
    if (!nextBinding) {
      if (event.key === 'Tab') {
        setListening(false)
      }
      return
    }

    onChange(nextBinding)
    setListening(false)
  }

  return (
    <button
      type="button"
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
      onKeyDown={handleKeyDown}
      className={`min-w-[150px] rounded border px-3 py-1.5 text-[10px] font-mono transition-colors ${
        listening
          ? 'border-accent/60 bg-accent/10 text-accent'
          : 'border-surface-100/30 bg-surface-300 text-text-secondary hover:text-text-primary'
      }`}
    >
      {listening ? t('settings.pressShortcut') : (getShortcutDisplay(value) || t('settings.unassigned'))}
    </button>
  )
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
  const updateVideoCompatibilityMode = (mode: AppSettings['videoCompatibilityMode']) => {
    update('videoCompatibilityMode', mode)
    void window.electronAPI?.setRuntimePreferences?.({ videoCompatibilityMode: mode })
  }
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
        label={t('settings.uiScale')}
        description={`${settings.uiScale}% • ${t('settings.uiScaleDesc')}`}
      >
        <select
          value={settings.uiScale}
          onChange={(e) => update('uiScale', Number(e.target.value) as AppSettings['uiScale'])}
          className="bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 focus:border-accent/50 outline-none min-w-[140px]"
        >
          {UI_SCALE_OPTIONS.map((scale) => (
            <option key={scale} value={scale}>
              {scale}%
            </option>
          ))}
        </select>
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.alwaysOnTop')}
        description={t('settings.alwaysOnTopDesc')}
      >
        <Toggle
          checked={settings.alwaysOnTop}
          onChange={(value) => update('alwaysOnTop', value)}
        />
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
  autoNextPlayEnabled,
  onAutoNextPlayChange,
}: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  autoNextPlayEnabled: boolean
  onAutoNextPlayChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) =>
    onChange({ ...settings, [key]: val })
  const controlsDisabled = !settings.autoSkipScriptGaps
  const randomStrokeControlsDisabled = !settings.noScriptRandomStrokeEnabled && !settings.noScriptRandomFillGapsEnabled
  const randomFillGapControlsDisabled = !settings.noScriptRandomFillGapsEnabled
  const resolvedPattern = getNoScriptStrokePatternForPreset(settings.noScriptRandomPreset, settings.noScriptRandomPattern)
  const updateRandomStrokePreset = (preset: AppSettings['noScriptRandomPreset']) => {
    if (preset === 'custom') {
      update('noScriptRandomPreset', preset)
      return
    }

    const speedRange = NO_SCRIPT_STROKE_PRESET_SPEED_RANGES[preset]
    onChange({
      ...settings,
      noScriptRandomPreset: preset,
      noScriptRandomMinSpeed: speedRange.min,
      noScriptRandomMaxSpeed: speedRange.max,
    })
  }

  return (
    <div>
      <SectionHeading>{t('settings.playback')}</SectionHeading>

      <FieldRow
        label={t('settings.autoNextPlay')}
        description={t('settings.autoNextPlayDesc')}
      >
        <Toggle
          checked={autoNextPlayEnabled}
          onChange={onAutoNextPlayChange}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.handyAutoPlayAfterSync')}
        description={t('settings.handyAutoPlayAfterSyncDesc')}
      >
        <Toggle
          checked={settings.handyAutoPlayAfterSync}
          onChange={(value) => update('handyAutoPlayAfterSync', value)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.noScriptRandomStroke')}
        description={t('settings.noScriptRandomStrokeDesc')}
      >
        <Toggle
          checked={settings.noScriptRandomStrokeEnabled}
          onChange={(value) => update('noScriptRandomStrokeEnabled', value)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.noScriptRandomFillGaps')}
        description={t('settings.noScriptRandomFillGapsDesc')}
      >
        <Toggle
          checked={settings.noScriptRandomFillGapsEnabled}
          onChange={(value) => update('noScriptRandomFillGapsEnabled', value)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.noScriptRandomFillGapMinDuration')}
        description={`${formatSecondsLabel(settings.noScriptRandomFillGapMinDuration)} • ${t('settings.noScriptRandomFillGapMinDurationDesc')}`}
      >
        <input
          type="range"
          min={NO_SCRIPT_RANDOM_FILL_GAP_MIN_SECONDS}
          max={NO_SCRIPT_RANDOM_FILL_GAP_MAX_SECONDS}
          step={NO_SCRIPT_RANDOM_FILL_GAP_STEP_SECONDS}
          disabled={randomFillGapControlsDisabled}
          value={settings.noScriptRandomFillGapMinDuration}
          onChange={(e) => update('noScriptRandomFillGapMinDuration', Number(e.target.value))}
          className={`w-36 ${randomFillGapControlsDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.noScriptRandomPreset')}
        description={t('settings.noScriptRandomPresetDesc')}
      >
        <select
          disabled={randomStrokeControlsDisabled}
          value={settings.noScriptRandomPreset}
          onChange={(e) => updateRandomStrokePreset(e.target.value as AppSettings['noScriptRandomPreset'])}
          className={`bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 outline-none min-w-[160px] ${randomStrokeControlsDisabled ? 'opacity-40 cursor-not-allowed' : 'focus:border-accent/50'}`}
        >
          {NO_SCRIPT_STROKE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {t(`settings.noScriptRandomPreset.${preset}`)}
            </option>
          ))}
        </select>
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.noScriptRandomPattern')}
        description={`${t(`settings.noScriptRandomPattern.${resolvedPattern}`)} • ${t('settings.noScriptRandomPatternDesc')}`}
      >
        <select
          disabled={randomStrokeControlsDisabled || settings.noScriptRandomPreset !== 'custom'}
          value={resolvedPattern}
          onChange={(e) => update('noScriptRandomPattern', e.target.value as AppSettings['noScriptRandomPattern'])}
          className={`bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 outline-none min-w-[160px] ${
            randomStrokeControlsDisabled || settings.noScriptRandomPreset !== 'custom'
              ? 'opacity-40 cursor-not-allowed'
              : 'focus:border-accent/50'
          }`}
        >
          {NO_SCRIPT_STROKE_PATTERNS.map((pattern) => (
            <option key={pattern} value={pattern}>
              {t(`settings.noScriptRandomPattern.${pattern}`)}
            </option>
          ))}
        </select>
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.noScriptRandomMinSpeed')}
        description={`${formatSpeedLabel(settings.noScriptRandomMinSpeed)} • ${t('settings.noScriptRandomMinSpeedDesc')}`}
      >
        <input
          type="range"
          min={NO_SCRIPT_STROKE_MIN_SPM}
          max={NO_SCRIPT_STROKE_MAX_SPM}
          step={NO_SCRIPT_STROKE_SPEED_STEP}
          disabled={randomStrokeControlsDisabled}
          value={settings.noScriptRandomMinSpeed}
          onChange={(e) => {
            const value = Number(e.target.value)
            update('noScriptRandomMinSpeed', Math.min(value, settings.noScriptRandomMaxSpeed))
          }}
          className={`w-36 ${randomStrokeControlsDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.noScriptRandomMaxSpeed')}
        description={`${formatSpeedLabel(settings.noScriptRandomMaxSpeed)} • ${t('settings.noScriptRandomMaxSpeedDesc')}`}
      >
        <input
          type="range"
          min={NO_SCRIPT_STROKE_MIN_SPM}
          max={NO_SCRIPT_STROKE_MAX_SPM}
          step={NO_SCRIPT_STROKE_SPEED_STEP}
          disabled={randomStrokeControlsDisabled}
          value={settings.noScriptRandomMaxSpeed}
          onChange={(e) => {
            const value = Number(e.target.value)
            update('noScriptRandomMaxSpeed', Math.max(value, settings.noScriptRandomMinSpeed))
          }}
          className={`w-36 ${randomStrokeControlsDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </FieldRow>

      <Divider />

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
  const updateVideoCompatibilityMode = (mode: AppSettings['videoCompatibilityMode']) => {
    update('videoCompatibilityMode', mode)
    void window.electronAPI?.setRuntimePreferences?.({ videoCompatibilityMode: mode })
  }

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

      <Divider />

      <FieldRow
        label={t('settings.autoFitVideoByAspect')}
        description={t('settings.autoFitVideoByAspectDesc')}
      >
        <Toggle
          checked={settings.autoFitVideoByAspect}
          onChange={(v) => update('autoFitVideoByAspect', v)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.rememberVideoFit')}
        description={t('settings.rememberVideoFitDesc')}
      >
        <Toggle
          checked={settings.rememberVideoFit}
          onChange={(v) => update('rememberVideoFit', v)}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.videoCompatibilityMode')}
        description={t('settings.videoCompatibilityModeDesc')}
      >
        <select
          value={settings.videoCompatibilityMode}
          onChange={(e) => updateVideoCompatibilityMode(e.target.value as AppSettings['videoCompatibilityMode'])}
          className="bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 outline-none min-w-[210px] focus:border-accent/50"
        >
          {VIDEO_COMPATIBILITY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {getVideoCompatibilityModeLabel(mode)}
            </option>
          ))}
        </select>
      </FieldRow>
    </div>
  )
}

function DeviceSection({
  settings,
  onChange,
  onDeviceTestCommand,
}: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onDeviceTestCommand?: (command: DeviceTestCommand) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const update = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) =>
    onChange({ ...settings, [key]: val })
  const motionSpeedLimitCustom = settings.motionSpeedLimitPreset === 'custom'
  const updateMotionSpeedLimitPreset = (preset: AppSettings['motionSpeedLimitPreset']) => {
    if (preset === 'off') {
      onChange({
        ...settings,
        motionSpeedLimitPreset: preset,
        motionSpeedLimitEnabled: false,
      })
      return
    }

    if (preset === 'custom') {
      onChange({
        ...settings,
        motionSpeedLimitPreset: preset,
        motionSpeedLimitEnabled: true,
      })
      return
    }

    onChange({
      ...settings,
      motionSpeedLimitPreset: preset,
      motionSpeedLimitEnabled: true,
      motionSpeedLimit: MOTION_SPEED_LIMIT_PRESET_VALUES[preset],
    })
  }

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

      <Divider />

      <FieldRow
        label={t('settings.motionSpeedLimit')}
        description={t('settings.motionSpeedLimitDesc')}
      >
        <select
          value={settings.motionSpeedLimitPreset}
          onChange={(e) => updateMotionSpeedLimitPreset(e.target.value as AppSettings['motionSpeedLimitPreset'])}
          className="bg-surface-300 text-text-primary text-xs px-3 py-1.5 rounded border border-surface-100/30 outline-none min-w-[160px] focus:border-accent/50"
        >
          {MOTION_SPEED_LIMIT_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {t(`settings.motionSpeedLimitPreset.${preset}`)}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow
        label={t('settings.motionSpeedLimitValue')}
        description={`${formatSpeedLabel(settings.motionSpeedLimit)} • ${t('settings.motionSpeedLimitValueDesc')}`}
      >
        <input
          type="range"
          min={MOTION_SPEED_LIMIT_MIN}
          max={MOTION_SPEED_LIMIT_MAX}
          step={MOTION_SPEED_LIMIT_STEP}
          disabled={!motionSpeedLimitCustom}
          value={settings.motionSpeedLimit}
          onChange={(e) => onChange({
            ...settings,
            motionSpeedLimitPreset: 'custom',
            motionSpeedLimitEnabled: true,
            motionSpeedLimit: Number(e.target.value),
          })}
          className={`w-36 ${!motionSpeedLimitCustom ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </FieldRow>

      <Divider />

      <FieldRow
        label={t('settings.showScriptDebugInfo')}
        description={t('settings.showScriptDebugInfoDesc')}
      >
        <Toggle
          checked={settings.showScriptDebugInfo}
          onChange={(v) => update('showScriptDebugInfo', v)}
        />
      </FieldRow>

      <Divider />

      <div className="rounded-lg border border-surface-100/25 bg-surface-300/45 p-3">
        <div className="text-xs font-medium text-text-primary">
          Device Test Panel
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-text-muted">
          Send a short manual command to verify the selected device output and axis mapping.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['L0', 'V0', 'V1', 'R0', 'stop'] as DeviceTestCommand[]).map((command) => (
            <button
              key={command}
              type="button"
              disabled={!onDeviceTestCommand}
              onClick={() => void onDeviceTestCommand?.(command)}
              className={`rounded border px-2.5 py-1.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                command === 'stop'
                  ? 'border-red-400/30 bg-red-500/10 text-red-200 hover:border-red-300/55'
                  : 'border-surface-100/30 bg-surface-200 text-text-secondary hover:border-accent/45 hover:text-accent'
              }`}
            >
              {command === 'stop' ? 'Stop' : command}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ShortcutsSection({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}) {
  const { t } = useTranslation()

  const shortcutGroups = [
    {
      title: t('settings.playback'),
      items: [
        { id: 'playPause' as const, action: t('settings.playPause') },
        { id: 'seekBackward' as const, action: t('settings.seekBackward5s') },
        { id: 'seekForward' as const, action: t('settings.seekForward5s') },
        { id: 'seekBackwardLarge' as const, action: t('settings.seekBackward10s') },
        { id: 'seekForwardLarge' as const, action: t('settings.seekForward10s') },
        { id: 'previousVideo' as const, action: t('settings.previousVideo') },
        { id: 'nextVideo' as const, action: t('settings.nextVideo') },
        { id: 'goToStart' as const, action: t('settings.goToStart') },
        { id: 'goToEnd' as const, action: t('settings.goToEnd') },
        { id: 'setSegmentRepeatStart' as const, action: t('settings.setSegmentRepeatStart') },
        { id: 'setSegmentRepeatEnd' as const, action: t('settings.setSegmentRepeatEnd') },
        { id: 'openSegmentRepeatEditor' as const, action: t('settings.openSegmentRepeatEditor') },
      ],
    },
    {
      title: t('settings.volume'),
      items: [
        { id: 'volumeUp' as const, action: t('settings.volumeUp') },
        { id: 'volumeDown' as const, action: t('settings.volumeDown') },
        { id: 'toggleMute' as const, action: t('settings.toggleMute') },
      ],
    },
    {
      title: t('settings.view'),
      items: [
        { id: 'toggleFullscreen' as const, action: t('settings.toggleFullscreen') },
      ],
    },
    {
      title: t('settings.device'),
      items: [
        { id: 'decreaseStrokeRange' as const, action: t('settings.decreaseStrokeRange') },
        { id: 'increaseStrokeRange' as const, action: t('settings.increaseStrokeRange') },
        { id: 'decreaseScriptOffset' as const, action: t('settings.decreaseScriptOffset') },
        { id: 'increaseScriptOffset' as const, action: t('settings.increaseScriptOffset') },
        { id: 'resetScriptOffset' as const, action: t('settings.resetScriptOffset') },
      ],
    },
    {
      title: t('settings.general'),
      items: [
        { id: 'openFolder' as const, action: t('settings.openFolder') },
        { id: 'openSettings' as const, action: t('settings.openSettings') },
      ],
    },
  ]

  const updateShortcut = (actionId: ShortcutActionId, binding: AppSettings['keyboardShortcuts'][ShortcutActionId]) => {
    onChange({
      ...settings,
      keyboardShortcuts: setShortcutBinding(settings.keyboardShortcuts, actionId, binding),
    })
  }

  return (
    <div>
      <SectionHeading>{t('settings.keyboardShortcuts')}</SectionHeading>
      <p className="mb-4 text-[10px] leading-relaxed text-text-muted">
        {t('settings.shortcutHint')}
      </p>
      <div className="space-y-5">
        {shortcutGroups.map((group) => (
          <div key={group.title}>
            <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <span className="text-xs text-text-secondary">
                    {item.action}
                  </span>
                  <div className="flex items-center gap-2">
                    <ShortcutCaptureButton
                      value={settings.keyboardShortcuts[item.id]}
                      onChange={(binding) => updateShortcut(item.id, binding)}
                    />
                    <button
                      type="button"
                      onClick={() => updateShortcut(item.id, DEFAULT_SHORTCUT_BINDINGS[item.id])}
                      className="rounded border border-surface-100/30 px-2.5 py-1.5 text-[10px] text-text-muted transition-colors hover:border-accent/40 hover:text-text-primary"
                    >
                      {t('settings.reset')}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateShortcut(item.id, null)}
                      className="rounded border border-surface-100/30 px-2.5 py-1.5 text-[10px] text-text-muted transition-colors hover:border-red-400/40 hover:text-red-300"
                    >
                      {t('settings.clear')}
                    </button>
                  </div>
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
  const [updaterState, setUpdaterState] = useState<UpdaterState | null>(null)
  const [updateCheck, setUpdateCheck] = useState<{
    checking: boolean
    result: UpdateCheckResult | null
    error: string | null
  }>({
    checking: false,
    result: null,
    error: null,
  })
  const openLink = useCallback((url: string) => {
    void window.electronAPI?.openExternal?.(url)
  }, [])
  useEffect(() => {
    let active = true
    const initialStatePromise = window.electronAPI?.updaterGetState?.()
    if (initialStatePromise) {
      void initialStatePromise.then((state) => {
        if (active) setUpdaterState(state)
      })
    }
    const unsubscribe = window.electronAPI?.updaterOnState?.((state) => {
      setUpdaterState(state)
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])
  const handleCheckForUpdates = useCallback(() => {
    setUpdateCheck((state) => ({
      ...state,
      checking: true,
      error: null,
    }))

    void checkForUpdates()
      .then((result) => {
        setUpdateCheck({
          checking: false,
          result,
          error: null,
        })
      })
      .catch((error) => {
        setUpdateCheck({
          checking: false,
          result: null,
          error: error instanceof Error ? error.message : t('settings.updateCheckFailed'),
        })
      })

    if (updaterState?.autoUpdateSupported) {
      const nativeCheckPromise = window.electronAPI?.updaterCheckForUpdates?.()
      if (nativeCheckPromise) {
        void nativeCheckPromise
          .then(setUpdaterState)
          .catch(() => {
            // The manual GitHub release check above remains the fallback.
          })
      }
    }
  }, [t, updaterState?.autoUpdateSupported])

  const handleDownloadUpdate = useCallback(() => {
    const downloadPromise = window.electronAPI?.updaterDownloadUpdate?.()
    if (downloadPromise) {
      void downloadPromise.then(setUpdaterState)
    }
  }, [])

  const handleInstallUpdate = useCallback(() => {
    const installPromise = window.electronAPI?.updaterQuitAndInstall?.()
    if (installPromise) {
      void installPromise
    }
  }, [])

  const updaterStatusText = formatUpdaterStatus(updaterState)
  const latestVersionLabel = updateCheck.result?.latestVersion
    ?? updaterState?.latestVersion
    ?? null
  const updateStatusText = updateCheck.error
    ? `${t('settings.updateCheckFailed')} ${updateCheck.error}`
    : updateCheck.result?.updateAvailable
      ? t('settings.updateAvailable', { version: updateCheck.result.latestVersion })
      : updateCheck.result
        ? t('settings.updateLatest')
        : ''

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

      <div className="mt-5 rounded-xl border border-surface-100/25 bg-surface-200/45 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-primary">
              {t('settings.updates')}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
              <span>{t('settings.currentVersion', { version: APP_VERSION })}</span>
              <span>{t('settings.latestVersion', { version: latestVersionLabel || '-' })}</span>
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-text-muted">
              {updateStatusText || updaterStatusText || t('settings.updateCheckDesc')}
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
            {(updateCheck.result || updaterState?.updateAvailable) && (
              <button
                type="button"
                onClick={() => openLink(updaterState?.releaseUrl || updateCheck.result?.releaseUrl || APP_LINKS.releases)}
                className="inline-flex h-8 items-center rounded border border-accent/35 bg-accent/10 px-3 text-xs text-accent transition-colors hover:border-accent/60 hover:bg-accent/15"
              >
                {t('settings.openRelease')}
              </button>
            )}
            {updaterState?.canDownloadUpdate && updaterState.phase === 'available' && (
              <button
                type="button"
                onClick={handleDownloadUpdate}
                className="inline-flex h-8 items-center rounded border border-accent/35 bg-accent/10 px-3 text-xs text-accent transition-colors hover:border-accent/60 hover:bg-accent/15"
              >
                {t('settings.downloadUpdate')}
              </button>
            )}
            {updaterState?.phase === 'downloaded' && (
              <button
                type="button"
                onClick={handleInstallUpdate}
                className="inline-flex h-8 items-center rounded border border-green-400/35 bg-green-500/10 px-3 text-xs text-green-200 transition-colors hover:border-green-300/55 hover:bg-green-500/15"
              >
                {t('settings.restartAndInstall')}
              </button>
            )}
            <button
              type="button"
              onClick={handleCheckForUpdates}
              disabled={updateCheck.checking || updaterState?.phase === 'checking' || updaterState?.phase === 'downloading'}
              className="inline-flex h-8 items-center rounded border border-surface-100/30 bg-surface-300 px-3 text-xs text-text-secondary transition-colors hover:border-accent/45 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateCheck.checking || updaterState?.phase === 'checking' ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openLink(APP_LINKS.feedback)}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-surface-100/30 bg-surface-300 px-3 text-xs text-text-secondary transition-colors hover:border-accent/45 hover:text-text-primary"
        >
          <MessageSquare size={13} />
          {t('settings.feedback')}
        </button>
        <button
          type="button"
          onClick={() => openLink(APP_LINKS.koFi)}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-surface-100/30 bg-surface-300 px-3 text-xs text-text-secondary transition-colors hover:border-accent/45 hover:text-text-primary"
        >
          <span className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-sm">
            <img
              src={APP_SUPPORT_ICONS.koFi}
              alt=""
              className="h-3.5 w-3.5 object-contain"
            />
          </span>
          {t('settings.supportKoFi')}
        </button>
        <button
          type="button"
          onClick={() => openLink(APP_LINKS.patreon)}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-surface-100/30 bg-surface-300 px-3 text-xs text-text-secondary transition-colors hover:border-accent/45 hover:text-text-primary"
        >
          <span className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-sm">
            <img
              src={APP_SUPPORT_ICONS.patreon}
              alt=""
              className="h-3.5 w-3.5 object-contain"
            />
          </span>
          {t('settings.supportPatreon')}
        </button>
      </div>

      <Divider />

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-text-muted">Electron</span>
          <span className="text-text-secondary font-mono">
            {window.electronAPI?.versions?.electron ?? '\u2014'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Chrome</span>
          <span className="text-text-secondary font-mono">
            {window.electronAPI?.versions?.chrome ?? '\u2014'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Node</span>
          <span className="text-text-secondary font-mono">
            {window.electronAPI?.versions?.node ?? '\u2014'}
          </span>
        </div>
      </div>
    </div>
  )
}

function RecoverySection({
  onResetIntifaceSettings,
  onResetAllSettings,
}: {
  onResetIntifaceSettings: () => void | Promise<void>
  onResetAllSettings: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [pendingAction, setPendingAction] = useState<'intiface' | 'all' | null>(null)

  const runAction = useCallback(async (
    action: 'intiface' | 'all',
    confirmMessage: string,
    callback: () => void | Promise<void>
  ) => {
    if (!window.confirm(confirmMessage)) return

    setPendingAction(action)
    try {
      await callback()
    } finally {
      setPendingAction(null)
    }
  }, [])

  return (
    <div>
      <SectionHeading>{t('settings.recovery')}</SectionHeading>

      <div className="space-y-3">
        <div className="rounded-lg border border-surface-100/25 bg-surface-300/45 p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium text-text-primary">
                {t('settings.resetIntiface')}
              </div>
              <div className="mt-1 text-[10px] leading-relaxed text-text-muted">
                {t('settings.resetIntifaceDesc')}
              </div>
            </div>
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void runAction(
                'intiface',
                t('settings.resetIntifaceConfirm'),
                onResetIntifaceSettings
              )}
              className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded border border-surface-100/30 bg-surface-200 px-3 text-xs text-text-secondary transition-colors hover:border-accent/45 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={13} />
              {pendingAction === 'intiface' ? t('settings.resetting') : t('settings.reset')}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-red-400/20 bg-red-500/5 p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium text-text-primary">
                {t('settings.resetAllSettings')}
              </div>
              <div className="mt-1 text-[10px] leading-relaxed text-text-muted">
                {t('settings.resetAllSettingsDesc')}
              </div>
            </div>
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void runAction(
                'all',
                t('settings.resetAllSettingsConfirm'),
                onResetAllSettings
              )}
              className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded border border-red-400/30 bg-red-500/10 px-3 text-xs text-red-200 transition-colors hover:border-red-300/55 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={13} />
              {pendingAction === 'all' ? t('settings.resetting') : t('settings.reset')}
            </button>
          </div>
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
  autoNextPlayEnabled,
  onAutoNextPlayChange,
  onResetIntifaceSettings,
  onResetAllSettings,
  onDeviceTestCommand,
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
    { id: 'recovery', label: t('settings.recovery'), icon: RotateCcw },
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
        return (
          <PlaybackSection
            settings={settings}
            onChange={handleChange}
            autoNextPlayEnabled={autoNextPlayEnabled}
            onAutoNextPlayChange={onAutoNextPlayChange}
          />
        )
      case 'appearance':
        return <AppearanceSection settings={settings} onChange={handleChange} />
      case 'timeline':
        return <TimelineSection settings={settings} onChange={handleChange} />
      case 'device':
        return <DeviceSection settings={settings} onChange={handleChange} onDeviceTestCommand={onDeviceTestCommand} />
      case 'shortcuts':
        return <ShortcutsSection settings={settings} onChange={handleChange} />
      case 'recovery':
        return (
          <RecoverySection
            onResetIntifaceSettings={onResetIntifaceSettings}
            onResetAllSettings={onResetAllSettings}
          />
        )
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
