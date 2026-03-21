export type ButtplugConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
export type ButtplugFeatureType = 'linear' | 'rotate' | 'scalar'

export interface ButtplugFeature {
  id: string
  type: ButtplugFeatureType
  index: number
  descriptor: string
  actuatorType: string | null
  stepCount: number | null
}

export interface ButtplugLinearVector {
  index: number
  position: number
  duration: number
}

export interface ButtplugRotation {
  index: number
  speed: number
  clockwise: boolean
}

export interface ButtplugScalar {
  index: number
  scalar: number
  actuatorType: string
}

export interface ButtplugDeviceFrame {
  linear?: ButtplugLinearVector[]
  rotate?: ButtplugRotation[]
  scalar?: ButtplugScalar[]
}

export interface ButtplugSendOptions {
  rawTCode?: string | null
}

export interface ButtplugDevice {
  index: number
  name: string
  displayName: string
  messageTimingGap: number | null
  linearFeatures: ButtplugFeature[]
  rotateFeatures: ButtplugFeature[]
  scalarFeatures: ButtplugFeature[]
  rawWriteEndpoints: string[]
  rawReadEndpoints: string[]
  rawSubscribeEndpoints: string[]
  features: ButtplugFeature[]
}

type ButtplugPendingRequest = {
  resolve: (message: any) => void
  reject: (error: Error) => void
}

type ButtplugMessageEntry = Record<string, any>

const DEFAULT_SPEC_VERSION = 3
const DEFAULT_COMMAND_INTERVAL_MS = 50
const MIN_COMMAND_INTERVAL_MS = 33
const CLIENT_NAME = 'ScriptPlayerPlus'

export class ButtplugService {
  private socket: WebSocket | null = null
  private nextMessageId = 1
  private pending = new Map<number, ButtplugPendingRequest>()
  private devices = new Map<number, ButtplugDevice>()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private connectionState: ButtplugConnectionState = 'disconnected'
  private lastError: string | null = null
  private scanning = false
  private currentUrl = ''

  onConnectionChange: ((state: ButtplugConnectionState, error: string | null) => void) | null = null
  onDevicesChange: ((devices: ButtplugDevice[]) => void) | null = null
  onScanChange: ((scanning: boolean) => void) | null = null

  get isConnected() {
    return this.connectionState === 'connected' && this.socket?.readyState === WebSocket.OPEN
  }

  get serverUrl() {
    return this.currentUrl
  }

  get error() {
    return this.lastError
  }

  get scanActive() {
    return this.scanning
  }

  get devicesWithActuators() {
    return this.getSortedDevices()
  }

  async connect(inputUrl: string): Promise<boolean> {
    const candidates = getWebSocketCandidates(inputUrl)
    if (candidates.length === 0) {
      this.setConnectionState('error', 'Invalid Intiface WebSocket URL')
      return false
    }

    await this.disconnect()
    this.setConnectionState('connecting')

    let lastError = 'Unable to connect to Intiface'

    for (const url of candidates) {
      try {
        await this.connectToUrl(url)
        this.currentUrl = url
        this.setConnectionState('connected')
        return true
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    this.setConnectionState('error', lastError)
    return false
  }

  async disconnect(): Promise<void> {
    this.stopPingLoop()

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.sendWithoutTracking('StopAllDevices', {})
      } catch {
        // Ignore shutdown send failures.
      }
    }

    const socket = this.socket
    this.socket = null
    this.currentUrl = ''
    this.rejectAllPending(new Error('Disconnected'))
    this.replaceDevices([])
    this.setScanning(false)

    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.close()
      } catch {
        // Ignore close failures.
      }
    }

    this.setConnectionState('disconnected')
  }

  async refreshDevices(): Promise<ButtplugDevice[]> {
    if (!this.isConnected) return this.getSortedDevices()
    const response = await this.request('RequestDeviceList', {})
    const parsed = parseDeviceListPayload(response?.Devices)
    this.replaceDevices(parsed)
    return this.getSortedDevices()
  }

  async startScanning(): Promise<boolean> {
    if (!this.isConnected) return false
    this.setScanning(true)
    try {
      await this.request('StartScanning', {})
      return true
    } catch (error) {
      this.setScanning(false)
      this.lastError = error instanceof Error ? error.message : String(error)
      this.onConnectionChange?.(this.connectionState, this.lastError)
      return false
    }
  }

  async stopScanning(): Promise<boolean> {
    if (!this.isConnected) return false
    try {
      await this.request('StopScanning', {})
      this.setScanning(false)
      return true
    } catch {
      return false
    }
  }

  getDevice(deviceIndex: number): ButtplugDevice | null {
    return this.devices.get(deviceIndex) ?? null
  }

  getRecommendedCommandInterval(deviceIndex: number): number {
    const gap = this.devices.get(deviceIndex)?.messageTimingGap
    if (!gap || !Number.isFinite(gap) || gap <= 0) {
      return DEFAULT_COMMAND_INTERVAL_MS
    }

    return Math.max(MIN_COMMAND_INTERVAL_MS, Math.round(gap))
  }

  async stopDevice(deviceIndex: number): Promise<boolean> {
    if (!this.isConnected) return false
    try {
      await this.request('StopDeviceCmd', { DeviceIndex: deviceIndex })
      return true
    } catch {
      return false
    }
  }

  async stopAllDevices(): Promise<boolean> {
    if (!this.isConnected) return false
    try {
      await this.request('StopAllDevices', {})
      return true
    } catch {
      return false
    }
  }

  async sendDeviceFrame(deviceIndex: number, frame: ButtplugDeviceFrame, options?: ButtplugSendOptions): Promise<boolean> {
    if (!this.isConnected) return false

    const rawTCode = options?.rawTCode?.trim()
    const rawAttempted = Boolean(rawTCode)
    if (rawTCode) {
      const rawSuccess = await this.sendRawTCode(deviceIndex, rawTCode)
      if (rawSuccess) {
        return true
      }
    }

    const tasks: Promise<any>[] = []

    if (frame.linear && frame.linear.length > 0) {
      tasks.push(this.request('LinearCmd', {
        DeviceIndex: deviceIndex,
        Vectors: frame.linear.map((vector) => ({
          Index: vector.index,
          Duration: Math.max(MIN_COMMAND_INTERVAL_MS, Math.round(vector.duration)),
          Position: clamp01(vector.position),
        })),
      }))
    }

    if (frame.rotate && frame.rotate.length > 0) {
      tasks.push(this.request('RotateCmd', {
        DeviceIndex: deviceIndex,
        Rotations: frame.rotate.map((rotation) => ({
          Index: rotation.index,
          Speed: clamp01(rotation.speed),
          Clockwise: rotation.clockwise,
        })),
      }))
    }

    if (frame.scalar && frame.scalar.length > 0) {
      tasks.push(this.request('ScalarCmd', {
        DeviceIndex: deviceIndex,
        Scalars: frame.scalar.map((scalar) => ({
          Index: scalar.index,
          Scalar: clamp01(scalar.scalar),
          ActuatorType: scalar.actuatorType,
        })),
      }))
    }

    if (tasks.length === 0) {
      return !rawAttempted
    }

    try {
      await Promise.all(tasks)
      return true
    } catch {
      return false
    }
  }

  private async connectToUrl(url: string): Promise<void> {
    const socket = new WebSocket(url)
    this.socket = socket

    socket.addEventListener('message', (event) => {
      void this.handleIncoming(event.data)
    })

    socket.addEventListener('close', () => {
      if (socket !== this.socket) return
      this.stopPingLoop()
      this.rejectAllPending(new Error('Intiface connection closed'))
      this.replaceDevices([])
      this.setScanning(false)
      this.socket = null
      this.currentUrl = ''
      this.setConnectionState('disconnected')
    })

    socket.addEventListener('error', () => {
      if (socket !== this.socket) return
      this.lastError = 'Intiface WebSocket error'
    })

    await waitForSocketOpen(socket)

    try {
      const serverInfo = await this.request('RequestServerInfo', {
        ClientName: CLIENT_NAME,
        MessageVersion: DEFAULT_SPEC_VERSION,
      })

      this.startPingLoop(Number(serverInfo?.MaxPingTime) || 0)
      const deviceList = await this.request('RequestDeviceList', {})
      this.replaceDevices(parseDeviceListPayload(deviceList?.Devices))
    } catch (error) {
      if (socket === this.socket) {
        this.socket = null
      }
      try {
        socket.close()
      } catch {
        // Ignore close failures during handshake cleanup.
      }
      throw error
    }
  }

  private async handleIncoming(data: string | ArrayBuffer | Blob) {
    const text = await normalizeSocketData(data)
    let payload: ButtplugMessageEntry[]

    try {
      payload = JSON.parse(text)
    } catch {
      return
    }

    if (!Array.isArray(payload)) return

    for (const entry of payload) {
      const [messageType, messageBody] = Object.entries(entry ?? {})[0] ?? []
      if (!messageType || !messageBody) continue

      switch (messageType) {
        case 'Ok':
          this.resolvePending(messageBody.Id, messageBody)
          break
        case 'Error':
          this.rejectPending(messageBody.Id, new Error(messageBody.ErrorMessage || messageBody.Message || 'Buttplug error'))
          break
        case 'ServerInfo':
          this.resolvePending(messageBody.Id, messageBody)
          break
        case 'DeviceList':
          this.replaceDevices(parseDeviceListPayload(messageBody.Devices))
          this.resolvePending(messageBody.Id, messageBody)
          break
        case 'DeviceAdded':
          this.upsertDevice(parseDeviceInfo(messageBody))
          break
        case 'DeviceRemoved':
          this.removeDevice(messageBody.DeviceIndex)
          break
        case 'ScanningFinished':
          this.setScanning(false)
          break
        default:
          this.resolvePending(messageBody.Id, messageBody)
          break
      }
    }
  }

  private request(messageType: string, body: Record<string, unknown>): Promise<any> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Intiface is not connected'))
    }

    const id = this.nextMessageId++
    const message = {
      [messageType]: {
        Id: id,
        ...body,
      },
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.socket?.send(JSON.stringify([message]))
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private sendWithoutTracking(messageType: string, body: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

    const id = this.nextMessageId++
    const message = {
      [messageType]: {
        Id: id,
        ...body,
      },
    }

    this.socket.send(JSON.stringify([message]))
  }

  private resolvePending(id: number | undefined, message: any) {
    if (!id || !this.pending.has(id)) return
    const pending = this.pending.get(id)
    this.pending.delete(id)
    pending?.resolve(message)
  }

  private rejectPending(id: number | undefined, error: Error) {
    if (!id || !this.pending.has(id)) return
    const pending = this.pending.get(id)
    this.pending.delete(id)
    pending?.reject(error)
  }

  private rejectAllPending(error: Error) {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private replaceDevices(devices: ButtplugDevice[]) {
    this.devices.clear()
    for (const device of devices) {
      this.devices.set(device.index, device)
    }
    this.onDevicesChange?.(this.getSortedDevices())
  }

  private upsertDevice(device: ButtplugDevice | null) {
    if (!device) return
    this.devices.set(device.index, device)
    this.onDevicesChange?.(this.getSortedDevices())
  }

  private removeDevice(deviceIndex: number) {
    this.devices.delete(deviceIndex)
    this.onDevicesChange?.(this.getSortedDevices())
  }

  private getSortedDevices(): ButtplugDevice[] {
    return Array.from(this.devices.values())
      .filter((device) => device.features.length > 0 || device.rawWriteEndpoints.length > 0)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
  }

  private async sendRawTCode(deviceIndex: number, command: string): Promise<boolean> {
    const endpoint = this.getPreferredRawWriteEndpoint(deviceIndex)
    if (!endpoint) return false

    try {
      const payload = Array.from(new TextEncoder().encode(command.endsWith('\n') ? command : `${command}\n`))
      await this.request('RawWriteCmd', {
        DeviceIndex: deviceIndex,
        Endpoint: endpoint,
        Data: payload,
        WriteWithResponse: false,
      })
      return true
    } catch {
      return false
    }
  }

  private getPreferredRawWriteEndpoint(deviceIndex: number): string | null {
    const endpoints = this.devices.get(deviceIndex)?.rawWriteEndpoints ?? []
    if (endpoints.length === 0) return null

    const preferred = endpoints.find((endpoint) => endpoint.toLowerCase() === 'tx')
    return preferred ?? endpoints[0] ?? null
  }

  private setConnectionState(state: ButtplugConnectionState, error: string | null = null) {
    this.connectionState = state
    this.lastError = error
    this.onConnectionChange?.(state, error)
  }

  private setScanning(scanning: boolean) {
    this.scanning = scanning
    this.onScanChange?.(scanning)
  }

  private startPingLoop(maxPingTimeMs: number) {
    this.stopPingLoop()
    if (!maxPingTimeMs || maxPingTimeMs <= 0) return

    const intervalMs = Math.max(10, Math.floor(maxPingTimeMs / 2))
    this.pingTimer = setInterval(() => {
      if (!this.isConnected) return
      this.sendWithoutTracking('Ping', {})
    }, intervalMs)
  }

  private stopPingLoop() {
    if (!this.pingTimer) return
    clearInterval(this.pingTimer)
    this.pingTimer = null
  }
}

function parseDeviceListPayload(devices: unknown): ButtplugDevice[] {
  if (!Array.isArray(devices)) return []
  return devices
    .map(parseDeviceInfo)
    .filter((device): device is ButtplugDevice => device !== null)
}

function parseDeviceInfo(raw: any): ButtplugDevice | null {
  if (!raw || typeof raw !== 'object') return null

  const deviceMessages = raw.DeviceMessages
  const linearFeatures = parseFeatureArray('linear', deviceMessages?.LinearCmd)
  const rotateFeatures = parseFeatureArray('rotate', deviceMessages?.RotateCmd)
  const scalarFeatures = parseFeatureArray('scalar', deviceMessages?.ScalarCmd)
  const rawWriteEndpoints = parseRawEndpointArray(deviceMessages?.RawWriteCmd)
  const rawReadEndpoints = parseRawEndpointArray(deviceMessages?.RawReadCmd)
  const rawSubscribeEndpoints = parseRawEndpointArray(deviceMessages?.RawSubscribeCmd)
  const features = [...linearFeatures, ...rotateFeatures, ...scalarFeatures]

  if (features.length === 0 && rawWriteEndpoints.length === 0) return null

  return {
    index: Number(raw.DeviceIndex),
    name: String(raw.DeviceName || 'Unknown Device'),
    displayName: String(raw.DeviceDisplayName || raw.DeviceName || 'Unknown Device'),
    messageTimingGap: parseOptionalPositiveInteger(raw.DeviceMessageTimingGap),
    linearFeatures,
    rotateFeatures,
    scalarFeatures,
    rawWriteEndpoints,
    rawReadEndpoints,
    rawSubscribeEndpoints,
    features,
  }
}

function parseFeatureArray(featureType: ButtplugFeatureType, rawFeatures: unknown): ButtplugFeature[] {
  if (Array.isArray(rawFeatures)) {
    return rawFeatures.map((rawFeature, index) => createFeature(featureType, index, rawFeature))
  }

  if (rawFeatures && typeof rawFeatures === 'object' && Number.isFinite((rawFeatures as any).FeatureCount)) {
    const featureCount = Math.max(0, Math.round(Number((rawFeatures as any).FeatureCount)))
    return Array.from({ length: featureCount }, (_, index) => createFeature(featureType, index, null))
  }

  return []
}

function createFeature(featureType: ButtplugFeatureType, index: number, rawFeature: any): ButtplugFeature {
  return {
    id: `${featureType}:${index}`,
    type: featureType,
    index,
    descriptor: String(rawFeature?.FeatureDescriptor || `${featureType} ${index + 1}`),
    actuatorType: typeof rawFeature?.ActuatorType === 'string' ? rawFeature.ActuatorType : defaultActuatorType(featureType),
    stepCount: parseOptionalPositiveInteger(rawFeature?.StepCount),
  }
}

function parseRawEndpointArray(rawMessage: unknown): string[] {
  const endpoints = new Set<string>()

  if (Array.isArray(rawMessage)) {
    for (const entry of rawMessage) {
      for (const endpoint of parseRawEndpoints(entry?.Endpoints)) {
        endpoints.add(endpoint)
      }
    }
  } else if (rawMessage && typeof rawMessage === 'object') {
    for (const endpoint of parseRawEndpoints((rawMessage as any).Endpoints)) {
      endpoints.add(endpoint)
    }
  }

  return Array.from(endpoints)
}

function parseRawEndpoints(rawEndpoints: unknown): string[] {
  if (!Array.isArray(rawEndpoints)) return []
  return rawEndpoints.filter((endpoint): endpoint is string => typeof endpoint === 'string' && endpoint.length > 0)
}

function defaultActuatorType(featureType: ButtplugFeatureType): string | null {
  switch (featureType) {
    case 'linear':
      return 'Linear'
    case 'rotate':
      return 'Rotate'
    case 'scalar':
      return 'Vibrate'
    default:
      return null
  }
}

function parseOptionalPositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function getWebSocketCandidates(input: string): string[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    const normalized = parsed.toString()
    if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') {
      return [normalized]
    }

    const withButtplugPath = new URL(parsed.toString())
    withButtplugPath.pathname = '/buttplug'
    return Array.from(new Set([normalized, withButtplugPath.toString()]))
  } catch {
    return []
  }
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve()
      return
    }

    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      reject(new Error('Intiface WebSocket is not open'))
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out while connecting to Intiface'))
    }, 5000)

    const handleOpen = () => {
      cleanup()
      resolve()
    }

    const handleError = () => {
      cleanup()
      reject(new Error('Failed to open Intiface WebSocket'))
    }

    const handleClose = () => {
      cleanup()
      reject(new Error('Intiface WebSocket closed during connection'))
    }

    const cleanup = () => {
      clearTimeout(timeout)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('error', handleError)
      socket.removeEventListener('close', handleClose)
    }

    socket.addEventListener('open', handleOpen)
    socket.addEventListener('error', handleError)
    socket.addEventListener('close', handleClose)
  })
}

async function normalizeSocketData(data: string | ArrayBuffer | Blob): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof Blob) return data.text()
  return new TextDecoder().decode(data)
}

export const buttplugService = new ButtplugService()
