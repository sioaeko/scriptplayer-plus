import { FunscriptAction } from '../types'

const HANDY_API = 'https://www.handyfeeling.com/api/handy/v2'
const SCRIPT_API = 'https://scripts01.handyfeeling.com/api/script/v0'

export type HandyUploadStatus = 'idle' | 'uploading' | 'setting-up' | 'ready' | 'error'

interface HandyApiResult {
  result?: number
  error?: string
  connected?: boolean
  serverTime?: number
  url?: string
}

export class HandyService {
  private connectionKey: string = ''
  private connected: boolean = false
  private serverTimeOffset: number = 0
  private syncCount: number = 0
  private lastPing: number | null = null
  private _uploadStatus: HandyUploadStatus = 'idle'
  private _uploadError: string | null = null
  private _onStatusChange: ((status: HandyUploadStatus, error: string | null) => void) | null = null

  get isConnected() {
    return this.connected
  }

  get key() {
    return this.connectionKey
  }

  get ping() {
    return this.lastPing
  }

  get uploadStatus() {
    return this._uploadStatus
  }

  get uploadError() {
    return this._uploadError
  }

  set onStatusChange(cb: ((status: HandyUploadStatus, error: string | null) => void) | null) {
    this._onStatusChange = cb
  }

  private setUploadStatus(status: HandyUploadStatus, error: string | null = null) {
    this._uploadStatus = status
    this._uploadError = error
    this._onStatusChange?.(status, error)
  }

  private async readResponseData(response: Response): Promise<HandyApiResult> {
    const text = await response.text()
    if (!text.trim()) {
      return {}
    }

    try {
      return JSON.parse(text) as HandyApiResult
    } catch {
      return { error: text }
    }
  }

  private isSuccessfulResult(data: HandyApiResult): boolean {
    return typeof data.result !== 'number' || data.result >= 0
  }

  async connect(connectionKey: string): Promise<boolean> {
    this.connectionKey = connectionKey
    try {
      const response = await fetch(`${HANDY_API}/connected`, {
        headers: { 'X-Connection-Key': this.connectionKey },
      })
      const data = await this.readResponseData(response)
      console.log('[Handy] connect response:', data)
      this.connected = data.connected === true
      if (this.connected) {
        await this.syncServerTime()
      }
      return this.connected
    } catch (e) {
      console.error('[Handy] connect error:', e)
      this.connected = false
      return false
    }
  }

  disconnect() {
    this.connected = false
    this.connectionKey = ''
    this.setUploadStatus('idle')
  }

  private async syncServerTime(): Promise<void> {
    const trips: number[] = []
    const serverTimes: number[] = []

    for (let i = 0; i < 10; i++) {
      const sendTime = Date.now()
      try {
        const response = await fetch(`${HANDY_API}/servertime`, {
          headers: { 'X-Connection-Key': this.connectionKey },
        })
        const receiveTime = Date.now()
        const data = await this.readResponseData(response)
        if (!response.ok || !Number.isFinite(data.serverTime)) {
          continue
        }
        const roundTrip = receiveTime - sendTime
        trips.push(roundTrip)
        serverTimes.push((data.serverTime as number) - sendTime - roundTrip / 2)
      } catch {
        continue
      }
    }

    if (serverTimes.length > 0) {
      trips.sort((a, b) => a - b)
      this.lastPing = trips[Math.floor(trips.length / 2)]
      serverTimes.sort((a, b) => a - b)
      this.serverTimeOffset = serverTimes[Math.floor(serverTimes.length / 2)]
      this.syncCount++
      console.log(`[Handy] synced: ping=${this.lastPing}ms, offset=${this.serverTimeOffset}ms (${this.syncCount} syncs)`)
    }
  }

  getServerTime(): number {
    return Date.now() + this.serverTimeOffset
  }

  async setMode(mode: number): Promise<boolean> {
    if (!this.connected) return false
    try {
      const response = await fetch(`${HANDY_API}/mode`, {
        method: 'PUT',
        headers: {
          'X-Connection-Key': this.connectionKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode }),
      })
      const data = await this.readResponseData(response)
      console.log('[Handy] setMode response:', data)
      return response.ok && this.isSuccessfulResult(data)
    } catch (e) {
      console.error('[Handy] setMode error:', e)
      return false
    }
  }

  async setHSSP(url: string): Promise<boolean> {
    if (!this.connected) return false
    try {
      this.setUploadStatus('setting-up')

      // Set HSSP mode (mode 1)
      const modeOk = await this.setMode(1)
      if (!modeOk) {
        this.setUploadStatus('error', 'Failed to set HSSP mode')
        return false
      }

      const response = await fetch(`${HANDY_API}/hssp/setup`, {
        method: 'PUT',
        headers: {
          'X-Connection-Key': this.connectionKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      })
      const data = await this.readResponseData(response)
      console.log('[Handy] setHSSP response:', data)

      if (response.ok && this.isSuccessfulResult(data)) {
        this.setUploadStatus('ready')
        return true
      } else {
        this.setUploadStatus('error', `HSSP setup failed: ${data.error || response.status}`)
        return false
      }
    } catch (e) {
      console.error('[Handy] setHSSP error:', e)
      this.setUploadStatus('error', `HSSP setup error: ${e}`)
      return false
    }
  }

  async hsspPlay(serverTime: number, startTime: number): Promise<boolean> {
    if (!this.connected) return false
    try {
      const modeOk = await this.setMode(1)
      if (!modeOk) {
        this.setUploadStatus('error', 'Failed to switch Handy to HSSP mode')
        return false
      }

      const response = await fetch(`${HANDY_API}/hssp/play`, {
        method: 'PUT',
        headers: {
          'X-Connection-Key': this.connectionKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          estimatedServerTime: serverTime + 100,
          startTime,
        }),
      })
      const data = await this.readResponseData(response)
      console.log('[Handy] hsspPlay response:', data)
      if (response.ok && this.isSuccessfulResult(data)) {
        this.setUploadStatus('ready')
        return true
      }

      this.setUploadStatus('error', `HSSP play failed: ${data.error || data.result || response.status}`)
      return false
    } catch (e) {
      console.error('[Handy] hsspPlay error:', e)
      this.setUploadStatus('error', `HSSP play error: ${e}`)
      return false
    }
  }

  async hsspStop(): Promise<boolean> {
    if (!this.connected) return false
    try {
      const response = await fetch(`${HANDY_API}/hssp/stop`, {
        method: 'PUT',
        headers: { 'X-Connection-Key': this.connectionKey },
      })
      const data = await this.readResponseData(response)
      console.log('[Handy] hsspStop response:', data, 'status:', response.status)
      return response.ok && this.isSuccessfulResult(data)
    } catch (e) {
      console.error('[Handy] hsspStop error:', e)
      return false
    }
  }

  /** Convert funscript actions to CSV for Handy upload */
  static actionsToCSV(actions: FunscriptAction[]): string {
    const lines = actions.map((a) => `${Math.round(a.at)},${Math.round(a.pos)}`)
    return '#Created by ScriptPlayer+\n' + lines.join('\n')
  }

  /** Upload script CSV to Handy script server and get URL, then set up HSSP */
  async uploadAndSetup(actions: FunscriptAction[]): Promise<string | null> {
    this.setUploadStatus('uploading')
    const csv = HandyService.actionsToCSV(actions)
    const blob = new Blob([csv], { type: 'text/csv' })
    const formData = new FormData()
    const fileName = `${Math.round(1e8 * Math.random())}.csv`
    formData.append('file', blob, fileName)

    try {
      console.log(`[Handy] uploading script (${actions.length} actions) to ${SCRIPT_API}/temp/upload ...`)
      const response = await fetch(`${SCRIPT_API}/temp/upload`, {
        method: 'POST',
        headers: { 'accept': 'application/json' },
        body: formData,
      })

      if (!response.ok) {
        const text = await response.text()
        console.error('[Handy] upload failed:', response.status, text)
        this.setUploadStatus('error', `Upload failed: ${response.status}`)
        return null
      }

      const data = await this.readResponseData(response)
      console.log('[Handy] upload response:', data)

      if (data.error) {
        console.error('[Handy] upload error response:', data.error)
        this.setUploadStatus('error', `Upload error: ${data.error}`)
        return null
      }

      const url = data.url
      if (!url) {
        console.error('[Handy] no URL in upload response:', data)
        this.setUploadStatus('error', 'No URL in upload response')
        return null
      }

      console.log('[Handy] script uploaded to:', url)

      // Now set up HSSP with the uploaded script
      const setupOk = await this.setHSSP(url)
      if (!setupOk) {
        return null // setHSSP already set error status
      }

      return url
    } catch (e) {
      console.error('[Handy] upload error:', e)
      this.setUploadStatus('error', `Upload error: ${e}`)
      return null
    }
  }
}

export const handyService = new HandyService()
