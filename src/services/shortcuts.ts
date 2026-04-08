export const SHORTCUT_ACTION_IDS = [
  'playPause',
  'seekBackward',
  'seekForward',
  'seekBackwardLarge',
  'seekForwardLarge',
  'previousVideo',
  'nextVideo',
  'goToStart',
  'goToEnd',
  'volumeUp',
  'volumeDown',
  'toggleMute',
  'toggleFullscreen',
  'openFolder',
  'openSettings',
] as const

export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number]

export interface ShortcutBinding {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export type ShortcutBindings = Record<ShortcutActionId, ShortcutBinding | null>

type ShortcutEventLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

const SHORTCUT_CODE_ALIASES: Record<string, string> = {
  Prior: 'PageUp',
  Next: 'PageDown',
}

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
  playPause: { code: 'Space', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  seekBackward: { code: 'ArrowLeft', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  seekForward: { code: 'ArrowRight', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  seekBackwardLarge: { code: 'ArrowLeft', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false },
  seekForwardLarge: { code: 'ArrowRight', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false },
  previousVideo: { code: 'PageUp', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  nextVideo: { code: 'PageDown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  goToStart: { code: 'Home', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  goToEnd: { code: 'End', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  volumeUp: { code: 'ArrowUp', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  volumeDown: { code: 'ArrowDown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  toggleMute: { code: 'KeyM', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  toggleFullscreen: { code: 'KeyF', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
  openFolder: { code: 'KeyO', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
  openSettings: { code: 'Comma', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
}

export function cloneShortcutBindings(bindings: ShortcutBindings): ShortcutBindings {
  const next = {} as ShortcutBindings

  for (const actionId of SHORTCUT_ACTION_IDS) {
    const binding = bindings[actionId]
    next[actionId] = binding ? { ...binding } : null
  }

  return next
}

export function createDefaultShortcutBindings(): ShortcutBindings {
  return cloneShortcutBindings(DEFAULT_SHORTCUT_BINDINGS)
}

export function normalizeShortcutBindings(raw: unknown): ShortcutBindings {
  const defaults = createDefaultShortcutBindings()
  if (!raw || typeof raw !== 'object') {
    return defaults
  }

  const source = raw as Record<string, unknown>
  for (const actionId of SHORTCUT_ACTION_IDS) {
    const normalized = normalizeShortcutBinding(source[actionId])
    if (normalized !== undefined) {
      defaults[actionId] = normalized
    }
  }

  return defaults
}

export function captureShortcutBinding(event: ShortcutEventLike): ShortcutBinding | null {
  const code = resolveShortcutCode(event)
  if (!code || MODIFIER_CODES.has(code) || code === 'Tab') {
    return null
  }

  return {
    code,
    ctrlKey: !!event.ctrlKey,
    altKey: !!event.altKey,
    shiftKey: !!event.shiftKey,
    metaKey: !!event.metaKey,
  }
}

export function matchShortcutEvent(event: ShortcutEventLike, binding: ShortcutBinding | null): boolean {
  if (!binding) return false

  const code = resolveShortcutCode(event)
  if (!code) return false

  return (
    code === binding.code
    && !!event.ctrlKey === binding.ctrlKey
    && !!event.altKey === binding.altKey
    && !!event.shiftKey === binding.shiftKey
    && !!event.metaKey === binding.metaKey
  )
}

export function findMatchingShortcutAction(
  event: ShortcutEventLike,
  bindings: ShortcutBindings,
  actionIds: ShortcutActionId[] = [...SHORTCUT_ACTION_IDS]
): ShortcutActionId | null {
  for (const actionId of actionIds) {
    if (matchShortcutEvent(event, bindings[actionId])) {
      return actionId
    }
  }

  return null
}

export function setShortcutBinding(
  bindings: ShortcutBindings,
  actionId: ShortcutActionId,
  binding: ShortcutBinding | null
): ShortcutBindings {
  const next = cloneShortcutBindings(bindings)

  if (binding) {
    for (const otherActionId of SHORTCUT_ACTION_IDS) {
      if (otherActionId === actionId) continue
      if (areShortcutBindingsEqual(next[otherActionId], binding)) {
        next[otherActionId] = null
      }
    }
  }

  next[actionId] = binding ? { ...binding } : null
  return next
}

export function getShortcutDisplay(binding: ShortcutBinding | null): string {
  if (!binding) return ''

  const parts: string[] = []
  if (binding.ctrlKey) parts.push('Ctrl')
  if (binding.altKey) parts.push('Alt')
  if (binding.shiftKey) parts.push('Shift')
  if (binding.metaKey) parts.push('Meta')
  parts.push(formatCodeLabel(binding.code))
  return parts.join(' + ')
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement
  )
}

function normalizeShortcutBinding(raw: unknown): ShortcutBinding | null | undefined {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object') return undefined

  const candidate = raw as Record<string, unknown>
  if (typeof candidate.code !== 'string' || candidate.code.trim().length === 0) {
    return undefined
  }

  const code = canonicalizeShortcutCode(candidate.code.trim())
  if (MODIFIER_CODES.has(code)) {
    return undefined
  }

  return {
    code,
    ctrlKey: !!candidate.ctrlKey,
    altKey: !!candidate.altKey,
    shiftKey: !!candidate.shiftKey,
    metaKey: !!candidate.metaKey,
  }
}

function resolveShortcutCode(event: Pick<KeyboardEvent, 'code' | 'key'>): string | null {
  if (typeof event.code === 'string' && event.code && event.code !== 'Unidentified') {
    return canonicalizeShortcutCode(event.code)
  }

  return keyToCode(event.key)
}

function keyToCode(key: string): string | null {
  if (!key) return null

  const aliasedKey = canonicalizeShortcutCode(key)

  if (aliasedKey !== key) {
    return aliasedKey
  }

  if (key === ' ') return 'Space'
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^\d$/.test(key)) return `Digit${key}`

  const keyMap: Record<string, string> = {
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Enter: 'Enter',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    '-': 'Minus',
    '=': 'Equal',
    ',': 'Comma',
    '.': 'Period',
    ';': 'Semicolon',
    "'": 'Quote',
    '/': 'Slash',
    '\\': 'Backslash',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '`': 'Backquote',
  }

  return keyMap[key] ?? null
}

function formatCodeLabel(code: string): string {
  const normalizedCode = canonicalizeShortcutCode(code)

  if (/^Key[A-Z]$/.test(normalizedCode)) {
    return normalizedCode.slice(3)
  }

  if (/^Digit\d$/.test(normalizedCode)) {
    return normalizedCode.slice(5)
  }

  const labels: Record<string, string> = {
    Space: 'Space',
    ArrowLeft: 'Left Arrow',
    ArrowRight: 'Right Arrow',
    ArrowUp: 'Up Arrow',
    ArrowDown: 'Down Arrow',
    Home: 'Home',
    End: 'End',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
    Enter: 'Enter',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Semicolon: ';',
    Quote: "'",
    Slash: '/',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
  }

  return labels[normalizedCode] ?? normalizedCode
}

function canonicalizeShortcutCode(code: string): string {
  return SHORTCUT_CODE_ALIASES[code] ?? code
}

function areShortcutBindingsEqual(left: ShortcutBinding | null, right: ShortcutBinding | null): boolean {
  if (!left || !right) return left === right
  return (
    left.code === right.code
    && left.ctrlKey === right.ctrlKey
    && left.altKey === right.altKey
    && left.shiftKey === right.shiftKey
    && left.metaKey === right.metaKey
  )
}
