import { app } from 'electron'
import { execFile } from 'child_process'
import { SerialPortStream } from '@serialport/stream'
import type { AutoDetectTypes } from '@serialport/bindings-cpp'
import { createRequire } from 'module'
import path from 'path'
import { promisify } from 'util'
import { OsrSerialPortInfo, OsrSerialState } from '../src/types'

const DEFAULT_BAUD_RATE = 115200
const runtimeRequire = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

type SerialPortBinding = AutoDetectTypes
type RuntimeSerialPort = SerialPortStream<SerialPortBinding>
type RawSerialPortInfo = {
  path: string
  manufacturer?: string
  serialNumber?: string
  vendorId?: string
  productId?: string
  pnpId?: string
}

let cachedBinding: SerialPortBinding | null = null

function createInitialState(): OsrSerialState {
  return {
    connectionState: 'disconnected',
    connectedPortPath: null,
    baudRate: DEFAULT_BAUD_RATE,
    error: null,
  }
}

export class OsrSerialManager {
  private port: RuntimeSerialPort | null = null
  private state: OsrSerialState = createInitialState()
  private notifyStateChange: (state: OsrSerialState) => void

  constructor(notifyStateChange?: (state: OsrSerialState) => void) {
    this.notifyStateChange = notifyStateChange ?? (() => {})
  }

  setNotifier(notifyStateChange: (state: OsrSerialState) => void) {
    this.notifyStateChange = notifyStateChange
    this.emitState()
  }

  getState(): OsrSerialState {
    return { ...this.state }
  }

  async listPorts(): Promise<OsrSerialPortInfo[]> {
    const ports = await listAvailablePorts()
    return ports
      .map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer ?? null,
        serialNumber: port.serialNumber ?? null,
        vendorId: port.vendorId ?? null,
        productId: port.productId ?? null,
        pnpId: port.pnpId ?? null,
        displayName: buildPortDisplayName(port.path, port.manufacturer ?? null, port.serialNumber ?? null),
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  }

  async connect(path: string, baudRate = DEFAULT_BAUD_RATE): Promise<OsrSerialState> {
    const targetPath = path.trim()
    if (!targetPath) {
      this.state = {
        ...this.state,
        connectionState: 'error',
        error: 'Select a serial port.',
      }
      this.emitState()
      return this.getState()
    }

    if (this.port?.isOpen && this.state.connectedPortPath === targetPath && this.state.baudRate === baudRate) {
      return this.getState()
    }

    await this.disconnect()

    this.state = {
      ...this.state,
      connectionState: 'connecting',
      connectedPortPath: targetPath,
      baudRate,
      error: null,
    }
    this.emitState()

    let port: RuntimeSerialPort
    try {
      port = new SerialPortStream({
        binding: getSerialPortBinding(),
        path: targetPath,
        baudRate,
        autoOpen: false,
      })
      await openPort(port)
    } catch (error) {
      this.state = {
        connectionState: 'error',
        connectedPortPath: null,
        baudRate,
        error: normalizeErrorMessage(error, 'Failed to open serial port.'),
      }
      this.emitState()
      return this.getState()
    }

    this.port = port
    this.attachPortEvents(port, baudRate)

    this.state = {
      connectionState: 'connected',
      connectedPortPath: targetPath,
      baudRate,
      error: null,
    }
    this.emitState()

    return this.getState()
  }

  async disconnect(): Promise<OsrSerialState> {
    const port = this.port
    this.port = null

    if (port) {
      port.removeAllListeners('error')
      port.removeAllListeners('close')
      if (port.isOpen) {
        try {
          await closePort(port)
        } catch {
          // Ignore close failures while tearing down the current connection.
        }
      }
    }

    this.state = {
      ...this.state,
      connectionState: 'disconnected',
      connectedPortPath: null,
      error: null,
    }
    this.emitState()
    return this.getState()
  }

  async write(command: string): Promise<boolean> {
    const port = this.port
    if (!port || !port.isOpen) {
      this.state = {
        ...this.state,
        connectionState: 'error',
        error: 'Serial port is not connected.',
      }
      this.emitState()
      return false
    }

    const payload = command.endsWith('\n') ? command : `${command}\n`

    try {
      await writeAndDrain(port, Buffer.from(payload, 'ascii'))
      if (this.state.connectionState !== 'connected') {
        this.state = {
          ...this.state,
          connectionState: 'connected',
          error: null,
        }
        this.emitState()
      }
      return true
    } catch (error) {
      this.state = {
        ...this.state,
        connectionState: 'error',
        error: normalizeErrorMessage(error, 'Failed to write to serial port.'),
      }
      this.emitState()
      return false
    }
  }

  async dispose(): Promise<void> {
    await this.disconnect()
  }

  private attachPortEvents(port: RuntimeSerialPort, baudRate: number) {
    port.on('error', (error) => {
      if (port !== this.port) return
      this.state = {
        connectionState: 'error',
        connectedPortPath: port.path,
        baudRate,
        error: normalizeErrorMessage(error, 'Serial port error.'),
      }
      this.emitState()
    })

    port.on('close', () => {
      if (port !== this.port) return
      const wasActive = this.state.connectionState === 'connected' || this.state.connectionState === 'connecting'
      this.port = null
      this.state = {
        connectionState: 'disconnected',
        connectedPortPath: null,
        baudRate,
        error: wasActive ? 'Serial port closed unexpectedly.' : null,
      }
      this.emitState()
    })
  }

  private emitState() {
    this.notifyStateChange(this.getState())
  }
}

function getSerialPortBinding(): SerialPortBinding {
  if (cachedBinding) {
    return cachedBinding
  }

  const bindingsModule = app.isPackaged
    ? runtimeRequire(
        path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          '@serialport',
          'bindings-cpp',
          'dist',
          'index.js',
        ),
      )
    : runtimeRequire('@serialport/bindings-cpp')

  cachedBinding = (bindingsModule as { autoDetect: () => SerialPortBinding }).autoDetect()
  return cachedBinding
}

async function listAvailablePorts(): Promise<RawSerialPortInfo[]> {
  const portMap = new Map<string, RawSerialPortInfo>()

  try {
    const ports = await getSerialPortBinding().list()
    for (const port of ports) {
      portMap.set(port.path, {
        path: port.path,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
        vendorId: port.vendorId,
        productId: port.productId,
        pnpId: port.pnpId,
      })
    }
  } catch {
    // Keep going and try platform-specific fallbacks below.
  }

  if (process.platform === 'win32') {
    for (const port of await listWindowsRegistryPorts()) {
      const existing = portMap.get(port.path)
      portMap.set(port.path, {
        path: port.path,
        manufacturer: existing?.manufacturer ?? port.manufacturer,
        serialNumber: existing?.serialNumber ?? port.serialNumber,
        vendorId: existing?.vendorId ?? port.vendorId,
        productId: existing?.productId ?? port.productId,
        pnpId: existing?.pnpId ?? port.pnpId,
      })
    }
  }

  return Array.from(portMap.values())
}

async function listWindowsRegistryPorts(): Promise<RawSerialPortInfo[]> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'])
    return stdout
      .split(/\r?\n/)
      .map(parseWindowsRegistryPortLine)
      .filter((port): port is RawSerialPortInfo => port !== null)
  } catch {
    return []
  }
}

function parseWindowsRegistryPortLine(line: string): RawSerialPortInfo | null {
  const match = line.match(/\bREG_SZ\b\s+(COM\d+)\s*$/i)
  if (!match) return null
  return {
    path: match[1].toUpperCase(),
  }
}

function buildPortDisplayName(path: string, manufacturer: string | null, serialNumber: string | null): string {
  const detail = manufacturer || serialNumber
  return detail ? `${path} (${detail})` : path
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function openPort(port: RuntimeSerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    port.open((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function closePort(port: RuntimeSerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    port.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function writeAndDrain(port: RuntimeSerialPort, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    port.write(payload, (writeError) => {
      if (writeError) {
        reject(writeError)
        return
      }

      port.drain((drainError) => {
        if (drainError) {
          reject(drainError)
          return
        }
        resolve()
      })
    })
  })
}
