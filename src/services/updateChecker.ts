import { APP_VERSION } from '../constants/app'
import { APP_LINKS } from '../constants/links'

const LATEST_RELEASE_API = 'https://api.github.com/repos/sioaeko/scriptplayer-plus/releases/latest'

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseUrl: string
  updateAvailable: boolean
}

interface GitHubReleaseResponse {
  tag_name?: string
  name?: string
  html_url?: string
}

export async function checkForUpdates(options: { signal?: AbortSignal } = {}): Promise<UpdateCheckResult> {
  const response = await fetch(LATEST_RELEASE_API, {
    signal: options.signal,
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    throw new Error(`Update check failed: ${response.status}`)
  }

  const release = await response.json() as GitHubReleaseResponse
  const latestVersion = normalizeVersionLabel(release.tag_name || release.name || '')

  if (!latestVersion) {
    throw new Error('Update check failed: missing release version')
  }

  return {
    currentVersion: APP_VERSION,
    latestVersion,
    releaseName: release.name || `v${latestVersion}`,
    releaseUrl: release.html_url || APP_LINKS.releases,
    updateAvailable: isVersionNewer(latestVersion, APP_VERSION),
  }
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const candidateParts = parseVersionParts(candidate)
  const currentParts = parseVersionParts(current)
  const length = Math.max(candidateParts.length, currentParts.length)

  for (let index = 0; index < length; index += 1) {
    const candidatePart = candidateParts[index] ?? 0
    const currentPart = currentParts[index] ?? 0

    if (candidatePart > currentPart) return true
    if (candidatePart < currentPart) return false
  }

  return false
}

function normalizeVersionLabel(value: string): string {
  return value.trim().replace(/^v/i, '')
}

function parseVersionParts(value: string): number[] {
  return normalizeVersionLabel(value)
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))
}
