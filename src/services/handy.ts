import { FunscriptAction } from '../types'

const HANDY_API = 'https://www.handyfeeling.com/api/handy/v2'
const SCRIPT_UPLOAD_HOST = 'scripts01.handyfeeling.com'
const SCRIPT_API = `https://${SCRIPT_UPLOAD_HOST}/api/script/v0`
const HSSP_PLAY_MIN_LEAD_MS = 150
const HSSP_PLAY_RETRY_DELAY_MS = 200
const HSSP_MODE_TIMEOUT_MS = 6000
const HSSP_SETUP_TIMEOUT_MS = 7000
const HSSP_PLAY_TIMEOUT_MS = 5000
const HSSP_STOP_TIMEOUT_MS = 1500
const SCRIPT_UPLOAD_TIMEOUT_MS = 30000

const formatUploadError = (error: unknown): string => {
  const detail = error instanceof Error ? error.message : String(error)

  if (/failed to fetch/i.test(detail)) {
    return `Upload error: Could not reach Handy upload server (${SCRIPT_UPLOAD_HOST}). Check VPN, firewall, DNS, or network connection.`
  }

  return `Upload error: ${detail}`
}

export type HandyUploadStatus = 'idle' | 'uploading' | 'setting-up' | 'ready' | 'error'

interface HandyApiResult {
  result?: number
  error?: string
  connected?: boolean
  serverTime?: number
  url?: string
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

class HandyRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HandyRequestTimeoutError'
  }
}

function createTimeoutSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort()
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  if (parentSignal?.aborted) {
    controller.abort()
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeoutId)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
  }
}

export class HandyService {
  private connectionKey: string = ''
  private connected: boolean = false
  private currentMode: number | null = null
  private serverTimeOffset: number = 0
  private syncCount: number = 0
  private lastPing: number | null = null
  private _uploadStatus: HandyUploadStatus = 'idle'
  private _uploadError: string | null = null
  private _onStatusChange: ((status: HandyUploadStatus, error: string | null) => void) | null = null
  private uploadController: AbortController | null = null
  private playController: AbortController | null = null

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

  private isAbortError(error: unknown): boolean {
    return (error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof Error && error.name === 'AbortError')
  }

  private isTimeoutError(error: unknown): boolean {
    return error instanceof HandyRequestTimeoutError
  }

  private replaceController(kind: 'upload' | 'play'): AbortSignal {
    const controller = new AbortController()

    if (kind === 'upload') {
      this.uploadController?.abort()
      this.uploadController = controller
    } else {
      this.playController?.abort()
      this.playController = controller
    }

    return controller.signal
  }

  private clearController(kind: 'upload' | 'play', signal: AbortSignal) {
    if (kind === 'upload') {
      if (this.uploadController?.signal === signal) {
        this.uploadController = null
      }
      return
    }

    if (this.playController?.signal === signal) {
      this.playController = null
    }
  }

  cancelPendingRequests(options?: { resetUploadStatus?: boolean }) {
    this.uploadController?.abort()
    this.uploadController = null
    this.cancelPendingPlay()

    if (options?.resetUploadStatus !== false && (this._uploadStatus === 'uploading' || this._uploadStatus === 'setting-up')) {
      this.setUploadStatus('idle')
    }
  }

  cancelPendingPlay() {
    this.playController?.abort()
    this.playController = null
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
      this.currentMode = null
      if (this.connected) {
        await this.syncServerTime()
      }
      return this.connected
    } catch (e) {
      console.error('[Handy] connect error:', e)
      this.connected = false
      this.currentMode = null
      return false
    }
  }

  disconnect() {
    this.cancelPendingRequests()
    this.connected = false
    this.currentMode = null
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

  getRecommendedPlayLeadMs(extraLeadMs = 0): number {
    const halfPing = Number.isFinite(this.lastPing) ? Math.round((this.lastPing ?? 0) / 2) : 0
    return Math.max(HSSP_PLAY_MIN_LEAD_MS, halfPing + 80 + Math.max(0, Math.round(extraLeadMs)))
  }

  async setMode(mode: number, signal?: AbortSignal): Promise<boolean> {
    if (!this.connected) return false
    const request = createTimeoutSignal(signal, HSSP_MODE_TIMEOUT_MS)
    try {
      const response = await fetch(`${HANDY_API}/mode`, {
        method: 'PUT',
        signal: request.signal,
        headers: {
          'X-Connection-Key': this.connectionKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode }),
      })
      const data = await this.readResponseData(response)
      console.log('[Handy] setMode response:', data)
      const ok = response.ok && this.isSuccessfulResult(data)
      if (ok) {
        this.currentMode = mode
      }
      return ok
    } catch (e) {
      if (request.timedOut()) {
        console.warn('[Handy] setMode timed out')
        return false
      }
      if (this.isAbortError(e) || signal?.aborted) {
        return false
      }
      console.error('[Handy] setMode error:', e)
      return false
    } finally {
      request.cleanup()
    }
  }

  async setHSSP(url: string, signal?: AbortSignal): Promise<boolean> {
    if (!this.connected) return false
    try {
      this.setUploadStatus('setting-up')

      // Set HSSP mode (mode 1)
      const modeOk = await this.setMode(1, signal)
      if (signal?.aborted) {
        return false
      }
      if (!modeOk) {
        this.setUploadStatus('error', 'Failed to set HSSP mode')
        return false
      }

      const { response, data } = await (async () => {
        const request = createTimeoutSignal(signal, HSSP_SETUP_TIMEOUT_MS)
        try {
          const response = await fetch(`${HANDY_API}/hssp/setup`, {
            method: 'PUT',
            signal: request.signal,
            headers: {
              'X-Connection-Key': this.connectionKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url }),
          })
          return { response, data: await this.readResponseData(response) }
        } catch (e) {
          if (request.timedOut()) {
            throw new HandyRequestTimeoutError('HSSP setup timed out')
          }
          throw e
        } finally {
          request.cleanup()
        }
      })()
      console.log('[Handy] setHSSP response:', data)

      if (signal?.aborted) {
        return false
      }

      if (response.ok && this.isSuccessfulResult(data)) {
        this.setUploadStatus('ready')
        return true
      } else {
        this.setUploadStatus('error', `HSSP setup failed: ${data.error || response.status}`)
        return false
      }
    } catch (e) {
      if (this.isTimeoutError(e)) {
        console.warn('[Handy] setHSSP timed out')
        this.setUploadStatus('error', e instanceof Error ? e.message : 'HSSP setup timed out')
        return false
      }
      if (this.isAbortError(e) || signal?.aborted) {
        return false
      }
      console.error('[Handy] setHSSP error:', e)
      this.setUploadStatus('error', `HSSP setup error: ${e}`)
      return false
    }
  }

  async hsspPlay(serverTime: number, startTime: number, options?: { leadMs?: number }): Promise<boolean> {
    if (!this.connected) return false
    const signal = this.replaceController('play')
    try {
      if (this.currentMode !== 1) {
        const modeOk = await this.setMode(1, signal)
        if (signal.aborted) {
          return false
        }
        if (!modeOk) {
          this.setUploadStatus('error', 'Failed to switch Handy to HSSP mode')
          return false
        }
      }

      const attemptPlay = async (estimatedServerTime: number) => {
        const leadMs = Number.isFinite(options?.leadMs)
          ? Math.max(0, Math.round(options?.leadMs ?? 0))
          : this.getRecommendedPlayLeadMs()
        const payload = {
          estimatedServerTime: Math.max(0, Math.round(estimatedServerTime + leadMs)),
          startTime: Math.max(0, Math.round(startTime)),
        }
        const request = createTimeoutSignal(signal, HSSP_PLAY_TIMEOUT_MS)
        try {
          const response = await fetch(`${HANDY_API}/hssp/play`, {
            method: 'PUT',
            signal: request.signal,
            headers: {
              'X-Connection-Key': this.connectionKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          })
          const data = await this.readResponseData(response)
          return { response, data, payload }
        } catch (e) {
          if (request.timedOut()) {
            throw new HandyRequestTimeoutError('HSSP play timed out')
          }
          throw e
        } finally {
          request.cleanup()
        }
      }

      let { response, data, payload } = await attemptPlay(serverTime)
      console.log('[Handy] hsspPlay response:', data, 'status:', response.status, 'payload:', payload)

      if (signal.aborted) {
        return false
      }

      if (!response.ok && response.status === 400) {
        await this.syncServerTime()
        await wait(HSSP_PLAY_RETRY_DELAY_MS)
        ;({ response, data, payload } = await attemptPlay(this.getServerTime()))
        console.log('[Handy] hsspPlay retry response:', data, 'status:', response.status, 'payload:', payload)
      }

      if (signal.aborted) {
        return false
      }

      if (response.ok && this.isSuccessfulResult(data)) {
        this.setUploadStatus('ready')
        return true
      }

      this.setUploadStatus('error', `HSSP play failed: ${data.error || data.result || response.status}`)
      return false
    } catch (e) {
      if (this.isTimeoutError(e)) {
        console.warn('[Handy] hsspPlay timed out')
        this.setUploadStatus('error', e instanceof Error ? e.message : 'HSSP play timed out')
        return false
      }
      if (this.isAbortError(e) || signal.aborted) {
        return false
      }
      console.error('[Handy] hsspPlay error:', e)
      this.setUploadStatus('error', `HSSP play error: ${e}`)
      return false
    } finally {
      this.clearController('play', signal)
    }
  }

  async hsspStop(options?: { timeoutMs?: number }): Promise<boolean> {
    if (!this.connected) return false
    this.cancelPendingPlay()
    const controller = new AbortController()
    const timeoutMs = Number.isFinite(options?.timeoutMs)
      ? Math.max(250, Math.round(options?.timeoutMs ?? HSSP_STOP_TIMEOUT_MS))
      : HSSP_STOP_TIMEOUT_MS
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${HANDY_API}/hssp/stop`, {
        method: 'PUT',
        signal: controller.signal,
        headers: { 'X-Connection-Key': this.connectionKey },
      })
      const data = await this.readResponseData(response)
      console.log('[Handy] hsspStop response:', data, 'status:', response.status)
      return response.ok && this.isSuccessfulResult(data)
    } catch (e) {
      if (this.isAbortError(e)) {
        console.warn('[Handy] hsspStop timed out')
        return false
      }
      console.error('[Handy] hsspStop error:', e)
      return false
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /** Convert funscript actions to CSV for Handy upload */
  static actionsToCSV(actions: FunscriptAction[]): string {
    const normalizedActions = HandyService.normalizeActionsForUpload(actions)
    const lines = normalizedActions.map((a) => `${Math.round(a.at)},${Math.round(a.pos)}`)
    return '#Created by ScriptPlayer+\n' + lines.join('\n')
  }

  private static normalizeActionsForUpload(actions: FunscriptAction[]): FunscriptAction[] {
    if (actions.length === 0) {
      return actions
    }

    const firstAction = actions[0]
    if (!Number.isFinite(firstAction.at) || firstAction.at <= 0) {
      return actions
    }

    // Local playback holds the first known position before the first timestamp.
    // Prepend that same position at 0ms so Handy HSSP doesn't appear to skip the intro.
    return [{ at: 0, pos: firstAction.pos }, ...actions]
  }

  /** Upload script CSV to Handy script server and get URL, then set up HSSP */
  async uploadAndSetup(actions: FunscriptAction[]): Promise<string | null> {
    const signal = this.replaceController('upload')
    this.setUploadStatus('uploading')
    const csv = HandyService.actionsToCSV(actions)
    const blob = new Blob([csv], { type: 'text/csv' })
    const formData = new FormData()
    const fileName = `${Math.round(1e8 * Math.random())}.csv`
    formData.append('file', blob, fileName)

    try {
      console.log(`[Handy] uploading script (${actions.length} actions) to ${SCRIPT_API}/temp/upload ...`)
      const uploadRequest = createTimeoutSignal(signal, SCRIPT_UPLOAD_TIMEOUT_MS)
      const response = await (async () => {
        try {
          return await fetch(`${SCRIPT_API}/temp/upload`, {
            method: 'POST',
            signal: uploadRequest.signal,
            headers: { 'accept': 'application/json' },
            body: formData,
          })
        } catch (e) {
          if (uploadRequest.timedOut()) {
            throw new HandyRequestTimeoutError('Script upload timed out')
          }
          throw e
        } finally {
          uploadRequest.cleanup()
        }
      })()

      if (signal.aborted) {
        return null
      }

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
      const setupOk = await this.setHSSP(url, signal)
      if (!setupOk) {
        return null // setHSSP already set error status
      }

      return url
    } catch (e) {
      if (this.isTimeoutError(e)) {
        console.error('[Handy] upload timed out:', e)
        this.setUploadStatus('error', e instanceof Error ? e.message : 'Script upload timed out')
        return null
      }
      if (this.isAbortError(e) || signal.aborted) {
        return null
      }
      console.error('[Handy] upload error:', e)
      this.setUploadStatus('error', formatUploadError(e))
      return null
    } finally {
      this.clearController('upload', signal)
    }
  }
}

export const handyService = new HandyService()
