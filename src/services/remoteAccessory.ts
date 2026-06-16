export type RemoteCommandId =
  | 'none'
  | 'play_pause'
  | 'next_video'
  | 'previous_video'
  | 'seek_forward_5s'
  | 'seek_backward_5s'
  | 'seek_forward_10s'
  | 'seek_backward_10s'
  | 'volume_up'
  | 'volume_down'
  | 'toggle_mute'
  | 'toggle_fullscreen'
  | 'toggle_fit_fill'
  | 'script_offset_plus_50'
  | 'script_offset_minus_50'
  | 'reset_script_offset'
  | 'toggle_loop'
  | 'toggle_shuffle'
  | 'open_settings'
  | 'device_stop';
export type RemoteButtonId = 'A' | 'B' | 'C'
export type RemoteInputActionId = 'click' | 'double' | 'hold'
export type RemoteKeyMappings = Record<RemoteButtonId, Record<RemoteInputActionId, RemoteCommandId>>

export interface RemoteAccessorySettings {
  deviceId: string
  deviceName: string
  pairingToken: string
  keyMappings: RemoteKeyMappings
}

export interface RemoteAccessoryState {
  supported: boolean
  connecting: boolean
  connected: boolean
  paired: boolean
  deviceName: string
  firmware: string
  pairingCode: string
  pairingTokenSaved: boolean
  batteryMv: number | null
  keyMappings: RemoteKeyMappings
  statusMessage: string
  error: string | null
}

interface RemoteStatusPayload {
  type?: string
  deviceId?: string
  name?: string
  firmware?: string
  paired?: boolean
  pairingCode?: string
  pairingToken?: string
}

interface RemoteInputPayload {
  type?: string
  button?: string
  action?: string
  defaultCommand?: string
  seq?: number
  batteryMv?: number
}

interface RemotePlaybackState {
  playing: boolean
  title: string
  positionMs: number
  durationMs: number
}

type RemoteListener = (state: RemoteAccessoryState) => void
type RemoteCommandHandler = (command: RemoteCommandId, input: RemoteInputPayload) => void | Promise<void>

const STORAGE_KEY = 'scriptplayer-plus-remote-accessory'
const SERVICE_UUID = '8fb0a870-0f7c-4c7a-81f1-5f42bc2a1000'
const INPUT_UUID = '8fb0a870-0f7c-4c7a-81f1-5f42bc2a1001'
const STATE_UUID = '8fb0a870-0f7c-4c7a-81f1-5f42bc2a1002'
const THUMBNAIL_UUID = '8fb0a870-0f7c-4c7a-81f1-5f42bc2a1003'
const CONTROL_UUID = '8fb0a870-0f7c-4c7a-81f1-5f42bc2a1004'
const REMOTE_NAME_PREFIX = 'SP+ Remote'
const THUMBNAIL_WIDTH = 96
const THUMBNAIL_HEIGHT = 54
const THUMBNAIL_DATA_BYTES_PER_PACKET = 180
const THUMBNAIL_SEND_DISPLAY_BYTE_ORDER = false
const THUMBNAIL_PACKET_DELAY_MS = 0
const BLACK_FRAME_MAX_AVERAGE_LUMA = 10
const BLACK_FRAME_MAX_LUMA_VARIANCE = 18

export const REMOTE_COMMAND_OPTIONS: Array<{ id: RemoteCommandId; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'play_pause', label: 'Play / Pause' },
  { id: 'next_video', label: 'Next video' },
  { id: 'previous_video', label: 'Previous video' },
  { id: 'seek_forward_5s', label: 'Seek +5s' },
  { id: 'seek_backward_5s', label: 'Seek -5s' },
  { id: 'seek_forward_10s', label: 'Seek +10s' },
  { id: 'seek_backward_10s', label: 'Seek -10s' },
  { id: 'volume_up', label: 'Volume up' },
  { id: 'volume_down', label: 'Volume down' },
  { id: 'toggle_mute', label: 'Mute' },
  { id: 'toggle_fullscreen', label: 'Fullscreen' },
  { id: 'toggle_fit_fill', label: 'FIT / FILL' },
  { id: 'script_offset_plus_50', label: 'Script offset +50ms' },
  { id: 'script_offset_minus_50', label: 'Script offset -50ms' },
  { id: 'reset_script_offset', label: 'Reset script offset' },
  { id: 'toggle_loop', label: 'Loop current' },
  { id: 'toggle_shuffle', label: 'Shuffle' },
  { id: 'open_settings', label: 'Open settings' },
  { id: 'device_stop', label: 'Device stop' },
]

const DEFAULT_KEY_MAPPINGS: RemoteKeyMappings = {
  A: {
    click: 'play_pause',
    double: 'none',
    hold: 'none',
  },
  B: {
    click: 'next_video',
    double: 'none',
    hold: 'none',
  },
  C: {
    click: 'previous_video',
    double: 'none',
    hold: 'none',
  },
}

export class RemoteAccessoryClient {
  private listeners = new Set<RemoteListener>()
  private commandHandler: RemoteCommandHandler | null = null
  private device: any = null
  private server: any = null
  private inputCharacteristic: any = null
  private stateCharacteristic: any = null
  private thumbnailCharacteristic: any = null
  private controlCharacteristic: any = null
  private nextThumbnailFrameId = 1
  private lastThumbnailId = ''
  private settings = loadRemoteAccessorySettings()
  private state: RemoteAccessoryState = {
    supported: isBluetoothSupported(),
    connecting: false,
    connected: false,
    paired: false,
    deviceName: this.settings.deviceName,
    firmware: '',
    pairingCode: '',
    pairingTokenSaved: Boolean(this.settings.pairingToken),
    batteryMv: null,
    keyMappings: this.settings.keyMappings,
    statusMessage: isBluetoothSupported()
      ? 'Remote is not connected.'
      : 'Web Bluetooth is not available in this build.',
    error: null,
  }

  getState(): RemoteAccessoryState {
    return this.state
  }

  subscribe(listener: RemoteListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setCommandHandler(handler: RemoteCommandHandler | null): void {
    this.commandHandler = handler
  }

  async connect(): Promise<void> {
    this.ensureBluetooth()
    this.patchState({ connecting: true, error: null, statusMessage: 'Searching for ScriptPlayer+ Remote...' })

    try {
      const bluetooth = getBluetooth()
      let device = await this.findSavedDevice(bluetooth)
      if (!device) {
        device = await bluetooth.requestDevice({
          filters: [{ namePrefix: REMOTE_NAME_PREFIX }],
          optionalServices: [SERVICE_UUID],
        })
      }

      await this.connectDevice(device)
    } catch (error) {
      this.patchState({
        connecting: false,
        connected: false,
        statusMessage: 'Remote connection failed.',
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  async connectSaved(): Promise<boolean> {
    if (!this.settings.deviceId || !this.settings.pairingToken || !isBluetoothSupported()) {
      return false
    }

    const bluetooth = getBluetooth()
    if (typeof bluetooth.getDevices !== 'function') {
      return false
    }

    try {
      this.patchState({ connecting: true, error: null, statusMessage: 'Restoring saved remote...' })
      const device = await this.findSavedDevice(bluetooth)
      if (!device) {
        this.patchState({
          connecting: false,
          statusMessage: 'Saved remote permission is not available. Connect manually from settings.',
        })
        return false
      }

      await this.connectDevice(device)
      return this.state.connected && this.state.paired
    } catch (error) {
      this.patchState({
        connecting: false,
        connected: false,
        paired: false,
        statusMessage: 'Saved remote restore failed.',
        error: getErrorMessage(error),
      })
      return false
    }
  }

  async pair(code: string): Promise<void> {
    const pairingCode = code.trim()
    if (!/^\d{6}$/.test(pairingCode)) {
      throw new Error('Pairing code must be 6 digits.')
    }
    if (!this.controlCharacteristic) {
      throw new Error('Remote is not connected.')
    }

    this.patchState({ error: null, statusMessage: 'Pairing remote...' })
    await this.writeControl({ type: 'pair', code: pairingCode, app: 'Scriptplayer+' })
    await this.refreshStatus()
    await this.writeKeymap()

    if (!this.state.paired) {
      throw new Error('Pairing was rejected by the remote.')
    }
  }

  async updateMapping(button: RemoteButtonId, action: RemoteInputActionId, command: RemoteCommandId): Promise<void> {
    const next = {
      ...this.settings,
      keyMappings: {
        ...this.settings.keyMappings,
        [button]: {
          ...this.settings.keyMappings[button],
          [action]: command,
        },
      },
    }
    this.settings = normalizeSettings(next)
    saveRemoteAccessorySettings(this.settings)
    this.patchState({ keyMappings: this.settings.keyMappings })
    if (this.state.connected && this.state.paired) {
      await this.writeKeymap().catch((error) => {
        this.patchState({ error: getErrorMessage(error) })
      })
    }
  }

  async forget(): Promise<void> {
    if (this.controlCharacteristic && this.state.connected) {
      await this.writeControl({ type: 'forget_pairing' }).catch(() => undefined)
    }

    await this.disconnect()
    this.settings = normalizeSettings({
      deviceId: '',
      deviceName: '',
      pairingToken: '',
      keyMappings: this.settings.keyMappings,
    })
    saveRemoteAccessorySettings(this.settings)
    this.patchState({
      paired: false,
      pairingCode: '',
      pairingTokenSaved: false,
      deviceName: '',
      firmware: '',
      statusMessage: 'Remote pairing removed.',
      error: null,
    })
  }

  async disconnect(): Promise<void> {
    this.inputCharacteristic?.removeEventListener?.('characteristicvaluechanged', this.handleInputChanged)
    this.controlCharacteristic?.removeEventListener?.('characteristicvaluechanged', this.handleControlChanged)
    await this.inputCharacteristic?.stopNotifications?.().catch?.(() => undefined)
    await this.controlCharacteristic?.stopNotifications?.().catch?.(() => undefined)

    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect()
    }

    this.device = null
    this.server = null
    this.inputCharacteristic = null
    this.stateCharacteristic = null
    this.thumbnailCharacteristic = null
    this.controlCharacteristic = null
    this.lastThumbnailId = ''
    this.patchState({
      connecting: false,
      connected: false,
      paired: false,
      statusMessage: 'Remote disconnected.',
    })
  }

  async sendPlaybackState(playback: RemotePlaybackState): Promise<void> {
    if (!this.stateCharacteristic || !this.state.connected || !this.state.paired) {
      return
    }

    await writeJson(this.stateCharacteristic, {
      playing: playback.playing,
      title: trimUtf8(toRemoteDisplayText(playback.title || 'ScriptPlayer+'), 96),
      positionMs: clampUInt32(playback.positionMs),
      durationMs: clampUInt32(playback.durationMs),
    }).catch((error) => {
      this.patchState({ error: getErrorMessage(error) })
    })
  }

  async sendVideoThumbnail(video: HTMLVideoElement, thumbnailId: string): Promise<void> {
    if (!this.thumbnailCharacteristic || !this.state.connected || !this.state.paired) {
      return
    }
    if (!thumbnailId || this.lastThumbnailId === thumbnailId) {
      return
    }

    try {
      const rgb565 = await captureVideoThumbnailRgb565(video)
      if (!rgb565) {
        return
      }
      await this.sendThumbnailRgb565(rgb565)
      this.lastThumbnailId = thumbnailId
    } catch (error) {
      this.patchState({ error: getErrorMessage(error) })
    }
  }

  async clearThumbnail(): Promise<void> {
    this.lastThumbnailId = ''
    if (!this.controlCharacteristic || !this.state.connected || !this.state.paired) {
      return
    }
    await this.writeControl({ type: 'clear_thumbnail' }).catch((error) => {
      this.patchState({ error: getErrorMessage(error) })
    })
  }

  private async findSavedDevice(bluetooth: any): Promise<any | null> {
    if (!this.settings.deviceId || typeof bluetooth.getDevices !== 'function') {
      return null
    }

    const devices = await bluetooth.getDevices()
    return devices.find((device: any) => device.id === this.settings.deviceId) ?? null
  }

  private async connectDevice(device: any): Promise<void> {
    this.device = device
    this.device.addEventListener?.('gattserverdisconnected', this.handleDisconnected)
    this.server = await device.gatt.connect()
    const service = await this.server.getPrimaryService(SERVICE_UUID)
    this.inputCharacteristic = await service.getCharacteristic(INPUT_UUID)
    this.stateCharacteristic = await service.getCharacteristic(STATE_UUID)
    this.thumbnailCharacteristic = await service.getCharacteristic(THUMBNAIL_UUID)
    this.controlCharacteristic = await service.getCharacteristic(CONTROL_UUID)
    this.lastThumbnailId = ''

    await this.inputCharacteristic.startNotifications()
    this.inputCharacteristic.addEventListener('characteristicvaluechanged', this.handleInputChanged)
    await this.controlCharacteristic.startNotifications().catch(() => undefined)
    this.controlCharacteristic.addEventListener('characteristicvaluechanged', this.handleControlChanged)

    const status = await this.readStatus()
    this.applyStatus(status)

    this.settings = normalizeSettings({
      ...this.settings,
      deviceId: device.id || this.settings.deviceId,
      deviceName: device.name || status.name || this.settings.deviceName,
    })
    saveRemoteAccessorySettings(this.settings)

    this.patchState({
      connecting: false,
      connected: true,
      deviceName: this.settings.deviceName,
      statusMessage: status.paired ? 'Remote connected.' : 'Enter the pairing code shown on the remote.',
      error: null,
    })

    if (!status.paired && this.settings.pairingToken) {
      await this.writeControl({ type: 'resume', token: this.settings.pairingToken, app: 'Scriptplayer+' })
      await this.refreshStatus()
    }

    if (this.state.paired) {
      await this.writeKeymap()
    }
  }

  private async refreshStatus(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const status = await this.readStatus()
    this.applyStatus(status)
  }

  private async readStatus(): Promise<RemoteStatusPayload> {
    if (!this.controlCharacteristic) {
      throw new Error('Control characteristic is not connected.')
    }

    const value = await this.controlCharacteristic.readValue()
    return parseJsonDataView(value)
  }

  private applyStatus(status: RemoteStatusPayload): void {
    if (status.type && status.type !== 'status') return

    const pairingToken = status.pairingToken || this.settings.pairingToken
    this.settings = normalizeSettings({
      ...this.settings,
      deviceName: status.name || this.settings.deviceName,
      pairingToken: status.paired ? pairingToken : this.settings.pairingToken,
    })
    saveRemoteAccessorySettings(this.settings)

    this.patchState({
      connected: true,
      paired: Boolean(status.paired),
      deviceName: status.name || this.settings.deviceName,
      firmware: status.firmware || this.state.firmware,
      pairingCode: status.pairingCode || '',
      pairingTokenSaved: Boolean(this.settings.pairingToken),
      statusMessage: status.paired
        ? 'Remote paired and connected.'
        : 'Enter the pairing code shown on the remote.',
      error: null,
    })
  }

  private async writeControl(payload: Record<string, unknown>): Promise<void> {
    if (!this.controlCharacteristic) {
      throw new Error('Control characteristic is not connected.')
    }
    await writeJson(this.controlCharacteristic, payload)
  }

  private async writeKeymap(): Promise<void> {
    await this.writeControl({
      type: 'keymap',
      labels: {
        A: commandLabel(this.settings.keyMappings.A.click),
        B: commandLabel(this.settings.keyMappings.B.click),
        C: commandLabel(this.settings.keyMappings.C.click),
      },
      actions: {
        A: {
          double: this.settings.keyMappings.A.double !== 'none',
          hold: this.settings.keyMappings.A.hold !== 'none',
        },
        B: {
          double: this.settings.keyMappings.B.double !== 'none',
          hold: this.settings.keyMappings.B.hold !== 'none',
        },
        C: {
          double: this.settings.keyMappings.C.double !== 'none',
          hold: this.settings.keyMappings.C.hold !== 'none',
        },
      },
    })
  }

  private async sendThumbnailRgb565(rgb565Bytes: Uint8Array): Promise<void> {
    if (!this.thumbnailCharacteristic) {
      throw new Error('Thumbnail characteristic is not connected.')
    }

    const frameId = this.nextThumbnailFrameId
    this.nextThumbnailFrameId += 1
    if (this.nextThumbnailFrameId > 255) {
      this.nextThumbnailFrameId = 1
    }

    const packets = buildRgb565ThumbnailPackets(rgb565Bytes, frameId)
    for (const packet of packets) {
      await writeBytes(this.thumbnailCharacteristic, packet)
      if (THUMBNAIL_PACKET_DELAY_MS > 0) {
        await delay(THUMBNAIL_PACKET_DELAY_MS)
      }
    }
  }

  private handleInputChanged = (event: Event) => {
    const value = (event.target as any)?.value
    if (!value) return

    try {
      const input = parseJsonDataView(value) as RemoteInputPayload
      const button = normalizeButton(input.button)
      if (!button) return
      const action = normalizeInputAction(input.action)
      if (typeof input.batteryMv === 'number') {
        this.patchState({ batteryMv: input.batteryMv })
      }

      const mappedCommand = this.settings.keyMappings[button][action]
      const fallbackCommand = normalizeCommand(input.defaultCommand)
      const command = mappedCommand || fallbackCommand
      if (command && command !== 'none') {
        void this.commandHandler?.(command, input)
      }
    } catch (error) {
      this.patchState({ error: getErrorMessage(error) })
    }
  }

  private handleControlChanged = (event: Event) => {
    const value = (event.target as any)?.value
    if (!value) return
    try {
      const status = parseJsonDataView(value) as RemoteStatusPayload
      this.applyStatus(status)
    } catch {}
  }

  private handleDisconnected = () => {
    this.patchState({
      connecting: false,
      connected: false,
      paired: false,
      statusMessage: 'Remote disconnected.',
    })
  }

  private ensureBluetooth(): void {
    if (!isBluetoothSupported()) {
      throw new Error('Web Bluetooth is not available in this build.')
    }
  }

  private patchState(patch: Partial<RemoteAccessoryState>): void {
    this.state = {
      ...this.state,
      ...patch,
    }
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

export const remoteAccessoryClient = new RemoteAccessoryClient()

function isBluetoothSupported(): boolean {
  return Boolean((navigator as any).bluetooth)
}

function getBluetooth(): any {
  return (navigator as any).bluetooth
}

function loadRemoteAccessorySettings(): RemoteAccessorySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return normalizeSettings(null)
  }
}

function saveRemoteAccessorySettings(settings: RemoteAccessorySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)))
  } catch {}
}

function normalizeSettings(value: unknown): RemoteAccessorySettings {
  const input = value && typeof value === 'object' ? value as Partial<RemoteAccessorySettings> : {}
  const mappings = input.keyMappings && typeof input.keyMappings === 'object'
    ? input.keyMappings as Record<string, unknown>
    : {}

  return {
    deviceId: typeof input.deviceId === 'string' ? input.deviceId : '',
    deviceName: typeof input.deviceName === 'string' ? input.deviceName : '',
    pairingToken: typeof input.pairingToken === 'string' ? input.pairingToken : '',
    keyMappings: {
      A: normalizeButtonMappings(mappings.A, DEFAULT_KEY_MAPPINGS.A),
      B: normalizeButtonMappings(mappings.B, DEFAULT_KEY_MAPPINGS.B),
      C: normalizeButtonMappings(mappings.C, DEFAULT_KEY_MAPPINGS.C),
    },
  }
}

function normalizeButtonMappings(value: unknown, fallback: Record<RemoteInputActionId, RemoteCommandId>): Record<RemoteInputActionId, RemoteCommandId> {
  const legacyCommand = normalizeCommand(value)
  if (legacyCommand) {
    return {
      ...fallback,
      click: legacyCommand,
    }
  }

  const input = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  return {
    click: normalizeCommand(input.click) ?? fallback.click,
    double: normalizeCommand(input.double) ?? fallback.double,
    hold: normalizeCommand(input.hold ?? input.long) ?? fallback.hold,
  }
}

function normalizeButton(value: unknown): 'A' | 'B' | 'C' | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return normalized === 'A' || normalized === 'B' || normalized === 'C' ? normalized : null
}

function normalizeInputAction(value: unknown): RemoteInputActionId {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  switch (normalized) {
    case 'long':
    case 'hold':
    case 'held':
    case 'long_press':
      return 'hold'
    case 'double':
    case 'double_click':
    case 'dblclick':
      return 'double'
    case 'click':
    default:
      return 'click'
  }
}

function normalizeCommand(value: unknown): RemoteCommandId | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  switch (normalized) {
    case 'none':
    case 'play_pause':
    case 'next_video':
    case 'previous_video':
    case 'seek_forward_5s':
    case 'seek_backward_5s':
    case 'seek_forward_10s':
    case 'seek_backward_10s':
    case 'volume_up':
    case 'volume_down':
    case 'toggle_mute':
    case 'toggle_fullscreen':
    case 'toggle_fit_fill':
    case 'script_offset_plus_50':
    case 'script_offset_minus_50':
    case 'reset_script_offset':
    case 'toggle_loop':
    case 'toggle_shuffle':
    case 'open_settings':
    case 'device_stop':
      return normalized as RemoteCommandId
    default:
      return null
  }
}

function commandLabel(command: RemoteCommandId): string {
  return REMOTE_COMMAND_OPTIONS.find((option) => option.id === command)?.label ?? command
}

function toRemoteDisplayText(value: string): string {
  const source = value
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!source) {
    return 'ScriptPlayer+'
  }
  return source
}

function parseJsonDataView(value: DataView): any {
  return JSON.parse(new TextDecoder().decode(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)))
}

async function writeJson(characteristic: any, payload: Record<string, unknown>): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  await writeBytes(characteristic, bytes)
}

async function writeBytes(characteristic: any, bytes: Uint8Array): Promise<void> {
  if (typeof characteristic.writeValueWithoutResponse === 'function') {
    await characteristic.writeValueWithoutResponse(bytes)
    return
  }
  await characteristic.writeValue(bytes)
}

async function captureVideoThumbnailRgb565(video: HTMLVideoElement): Promise<Uint8Array | null> {
  if (video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < 2) {
    return null
  }

  const activeFrame = captureVideoFrameRgb565(video)
  return activeFrame
}

function captureVideoFrameRgb565(video: HTMLVideoElement): Uint8Array | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < 2) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = THUMBNAIL_WIDTH
  canvas.height = THUMBNAIL_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return null
  }

  const sourceAspect = video.videoWidth / video.videoHeight
  const targetAspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT
  let sx = 0
  let sy = 0
  let sw = video.videoWidth
  let sh = video.videoHeight

  if (sourceAspect > targetAspect) {
    sw = Math.round(video.videoHeight * targetAspect)
    sx = Math.floor((video.videoWidth - sw) / 2)
  } else if (sourceAspect < targetAspect) {
    sh = Math.round(video.videoWidth / targetAspect)
    sy = Math.floor((video.videoHeight - sh) / 2)
  }

  context.drawImage(video, sx, sy, sw, sh, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
  const rgba = context.getImageData(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT).data
  const output = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 2)

  for (let inputOffset = 0, outputOffset = 0; inputOffset < rgba.length; inputOffset += 4, outputOffset += 2) {
    const r = rgba[inputOffset]
    const g = rgba[inputOffset + 1]
    const b = rgba[inputOffset + 2]
    const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
    if (THUMBNAIL_SEND_DISPLAY_BYTE_ORDER) {
      output[outputOffset] = rgb565 >> 8
      output[outputOffset + 1] = rgb565 & 0xFF
    } else {
      output[outputOffset] = rgb565 & 0xFF
      output[outputOffset + 1] = rgb565 >> 8
    }
  }

  return output
}

function getThumbnailCandidateTimes(source: HTMLVideoElement, probe: HTMLVideoElement): number[] {
  const duration = Number.isFinite(probe.duration) && probe.duration > 0
    ? probe.duration
    : Number.isFinite(source.duration) && source.duration > 0
      ? source.duration
      : 0
  if (duration <= 0) {
    return [0]
  }

  const current = Number.isFinite(source.currentTime) ? source.currentTime : 0
  const rawTimes = [
    current,
    Math.min(Math.max(1, duration * 0.08), Math.max(0, duration - 0.25)),
    Math.min(Math.max(3, duration * 0.18), Math.max(0, duration - 0.25)),
    duration * 0.35,
    duration * 0.5,
  ]

  const seen = new Set<number>()
  const times: number[] = []
  for (const rawTime of rawTimes) {
    const time = Math.max(0, Math.min(duration - 0.05, rawTime))
    const rounded = Math.round(time * 10) / 10
    if (!seen.has(rounded)) {
      seen.add(rounded)
      times.push(rounded)
    }
  }

  return times.length > 0 ? times : [0]
}

function readRgb565Pixel(buffer: Uint8Array, offset: number): number {
  return THUMBNAIL_SEND_DISPLAY_BYTE_ORDER
    ? (buffer[offset] << 8) | buffer[offset + 1]
    : buffer[offset] | (buffer[offset + 1] << 8)
}

function isMostlyBlackRgb565(rgb565Bytes: Uint8Array): boolean {
  let totalLuma = 0
  let totalLumaSquared = 0
  const pixelCount = rgb565Bytes.length / 2
  if (pixelCount <= 0) {
    return true
  }

  for (let offset = 0; offset < rgb565Bytes.length; offset += 2) {
    const value = readRgb565Pixel(rgb565Bytes, offset)
    const r = (value >> 11) & 0x1F
    const g = (value >> 5) & 0x3F
    const b = value & 0x1F
    const r8 = (r << 3) | (r >> 2)
    const g8 = (g << 2) | (g >> 4)
    const b8 = (b << 3) | (b >> 2)
    const luma = 0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8
    totalLuma += luma
    totalLumaSquared += luma * luma
  }

  const average = totalLuma / pixelCount
  const variance = totalLumaSquared / pixelCount - average * average
  return average <= BLACK_FRAME_MAX_AVERAGE_LUMA && variance <= BLACK_FRAME_MAX_LUMA_VARIANCE
}

function waitForVideoMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve()
  }

  video.load()
  return waitForVideoEvent(video, 'loadedmetadata', timeoutMs, () => video.readyState >= 1)
}

function waitForVideoReadableFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 2) {
    return nextFrame()
  }

  return waitForVideoEvent(video, 'loadeddata', timeoutMs, () => video.readyState >= 2)
    .then(() => nextFrame())
}

function seekVideo(video: HTMLVideoElement, time: number, timeoutMs: number): Promise<void> {
  const target = Math.max(0, time)
  if (Number.isFinite(video.duration) && video.duration > 0) {
    video.currentTime = Math.min(target, Math.max(0, video.duration - 0.05))
  } else {
    video.currentTime = target
  }

  if (Math.abs(video.currentTime - target) < 0.05 && video.readyState >= 2 && !video.seeking) {
    return nextFrame()
  }

  return waitForVideoEvent(video, 'seeked', timeoutMs, () => !video.seeking)
    .then(() => nextFrame())
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: string,
  timeoutMs: number,
  isReady: () => boolean,
): Promise<void> {
  if (isReady()) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let timeout: number | undefined
    const cleanup = () => {
      if (timeout !== undefined) {
        window.clearTimeout(timeout)
      }
      video.removeEventListener(eventName, handleReady)
      video.removeEventListener('error', handleError)
    }
    const handleReady = () => {
      if (!isReady()) return
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Video thumbnail probe failed.'))
    }

    timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Video thumbnail probe timed out.'))
    }, timeoutMs)

    video.addEventListener(eventName, handleReady)
    video.addEventListener('error', handleError)
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildRgb565ThumbnailPackets(rgb565Bytes: Uint8Array, frameId: number): Uint8Array[] {
  if (rgb565Bytes.length !== THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 2) {
    throw new Error('RGB565 byte length does not match thumbnail dimensions.')
  }

  const packets: Uint8Array[] = []
  const start = new Uint8Array(9)
  start[0] = 0x01
  start[1] = frameId
  start[2] = THUMBNAIL_WIDTH
  start[3] = THUMBNAIL_HEIGHT
  start[4] = 0x01
  writeLe32(start, 5, rgb565Bytes.length)
  packets.push(start)

  for (let offset = 0; offset < rgb565Bytes.length; offset += THUMBNAIL_DATA_BYTES_PER_PACKET) {
    const chunk = rgb565Bytes.subarray(offset, offset + THUMBNAIL_DATA_BYTES_PER_PACKET)
    const packet = new Uint8Array(6 + chunk.length)
    packet[0] = 0x02
    packet[1] = frameId
    writeLe32(packet, 2, offset)
    packet.set(chunk, 6)
    packets.push(packet)
  }

  packets.push(new Uint8Array([0x03, frameId]))
  return packets
}

function writeLe32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >> 8) & 0xFF
  buffer[offset + 2] = (value >> 16) & 0xFF
  buffer[offset + 3] = (value >> 24) & 0xFF
}

function trimUtf8(value: string, maxBytes: number): string {
  let output = ''
  let used = 0
  for (const char of value) {
    const bytes = new TextEncoder().encode(char).length
    if (used + bytes > maxBytes) break
    output += char
    used += bytes
  }
  return output
}

function clampUInt32(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(0xFFFFFFFF, Math.round(value)))
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
