import { OsrSerialConnectionState, OsrSerialPortInfo, OsrSerialState } from '../types'

const DEFAULT_BAUD_RATE = 115200

export class OsrSerialService {
  private initialized = false
  private unsubscribeStateChange: (() => void) | null = null
  private ports: OsrSerialPortInfo[] = []
  private state: OsrSerialState = {
    connectionState: 'disconnected',
    connectedPortPath: null,
    baudRate: DEFAULT_BAUD_RATE,
    error: null,
  }

  onStateChange: ((state: OsrSerialState) => void) | null = null
  onPortsChange: ((ports: OsrSerialPortInfo[]) => void) | null = null

  get connectionState(): OsrSerialConnectionState {
    return this.state.connectionState
  }

  get connected() {
    return this.state.connectionState === 'connected'
  }

  get error() {
    return this.state.error
  }

  get connectedPortPath() {
    return this.state.connectedPortPath
  }

  get baudRate() {
    return this.state.baudRate
  }

  get availablePorts() {
    return this.ports
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    this.unsubscribeStateChange = window.electronAPI.osrSerialOnStateChange((state) => {
      this.state = state
      this.onStateChange?.(state)
    })

    this.state = await window.electronAPI.osrSerialGetState()
    this.onStateChange?.(this.state)
  }

  async refreshPorts(): Promise<OsrSerialPortInfo[]> {
    await this.initialize()
    this.ports = await window.electronAPI.osrSerialListPorts()
    this.onPortsChange?.(this.ports)
    return this.ports
  }

  async connect(portPath: string, baudRate = DEFAULT_BAUD_RATE): Promise<boolean> {
    await this.initialize()
    this.state = {
      ...this.state,
      connectionState: 'connecting',
      connectedPortPath: portPath,
      baudRate,
      error: null,
    }
    this.onStateChange?.(this.state)

    try {
      const nextState = await window.electronAPI.osrSerialConnect(portPath, baudRate)
      this.state = nextState
      this.onStateChange?.(nextState)
      return nextState.connectionState === 'connected'
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to open serial port.'
      const nextState: OsrSerialState = {
        connectionState: 'error',
        connectedPortPath: null,
        baudRate,
        error: message,
      }
      this.state = nextState
      this.onStateChange?.(nextState)
      return false
    }
  }

  async disconnect(): Promise<boolean> {
    await this.initialize()
    const nextState = await window.electronAPI.osrSerialDisconnect()
    this.state = nextState
    this.onStateChange?.(nextState)
    return nextState.connectionState === 'disconnected'
  }

  async writeCommand(command: string): Promise<boolean> {
    await this.initialize()
    return window.electronAPI.osrSerialWrite(command)
  }

  dispose() {
    this.unsubscribeStateChange?.()
    this.unsubscribeStateChange = null
    this.initialized = false
  }
}

export const osrSerialService = new OsrSerialService()
