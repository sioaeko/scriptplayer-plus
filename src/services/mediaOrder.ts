import { PlaybackMode, VideoFile } from '../types'

export type VideoSortField = 'path' | 'name' | 'modified'
export type VideoSortDirection = 'asc' | 'desc'

export interface VideoSortState {
  field: VideoSortField
  direction: VideoSortDirection
}

export interface VideoFileGroup {
  folder: string
  files: VideoFile[]
}

export const DEFAULT_VIDEO_SORT: VideoSortState = {
  field: 'path',
  direction: 'asc',
}

const NATURAL_SORTER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function getRelativePathLabel(file: VideoFile): string {
  return file.relativePath || file.name
}

function getFolderLabel(file: VideoFile): string {
  const relativePath = getRelativePathLabel(file)
  const lastSlash = relativePath.lastIndexOf('/')
  return lastSlash >= 0 ? relativePath.substring(0, lastSlash) : ''
}

function compareLabels(a: string, b: string): number {
  return NATURAL_SORTER.compare(a, b)
}

function compareRelativePaths(a: VideoFile, b: VideoFile): number {
  return compareLabels(getRelativePathLabel(a), getRelativePathLabel(b))
}

function compareNames(a: VideoFile, b: VideoFile): number {
  const byName = compareLabels(a.name, b.name)
  if (byName !== 0) return byName
  return compareRelativePaths(a, b)
}

function compareModifiedDates(a: VideoFile, b: VideoFile): number {
  const byModifiedAt = (a.modifiedAt || 0) - (b.modifiedAt || 0)
  if (byModifiedAt !== 0) return byModifiedAt
  return compareRelativePaths(a, b)
}

function applyDirection(value: number, direction: VideoSortDirection): number {
  return direction === 'desc' ? -value : value
}

function compareFiles(a: VideoFile, b: VideoFile, sort: VideoSortState): number {
  const primaryComparison = sort.field === 'modified'
    ? compareModifiedDates(a, b)
    : sort.field === 'name'
      ? compareNames(a, b)
      : compareRelativePaths(a, b)

  if (primaryComparison !== 0) {
    return applyDirection(primaryComparison, sort.direction)
  }

  return applyDirection(compareRelativePaths(a, b), sort.direction)
}

export function groupVideoFiles(files: VideoFile[], sort: VideoSortState): VideoFileGroup[] {
  if (sort.field !== 'path') {
    return [{
      folder: '',
      files: [...files].sort((a, b) => compareFiles(a, b, sort)),
    }]
  }

  const grouped = new Map<string, VideoFile[]>()

  for (const file of files) {
    const folder = getFolderLabel(file)
    const group = grouped.get(folder)
    if (group) {
      group.push(file)
      continue
    }

    grouped.set(folder, [file])
  }

  const groups = Array.from(grouped.entries()).map(([folder, folderFiles]) => ({
    folder,
    files: [...folderFiles].sort((a, b) => compareFiles(a, b, sort)),
  }))

  groups.sort((a, b) => applyDirection(compareLabels(a.folder, b.folder), sort.direction))

  return groups
}

export function orderVideoFiles(files: VideoFile[], sort: VideoSortState): VideoFile[] {
  return groupVideoFiles(files, sort).flatMap((group) => group.files)
}

export function getAdjacentVideoFile(
  files: VideoFile[],
  currentFile: string | null,
  direction: 'next' | 'previous' = 'next'
): VideoFile | null {
  if (!currentFile || files.length === 0) {
    return null
  }

  const currentIndex = files.findIndex((file) => file.path === currentFile)
  if (currentIndex < 0) {
    return null
  }

  const delta = direction === 'next' ? 1 : -1
  const nextIndex = currentIndex + delta
  if (nextIndex < 0 || nextIndex >= files.length) {
    return null
  }

  return files[nextIndex] ?? null
}

export function getNextPlaybackFile(
  files: VideoFile[],
  currentFile: string | null,
  playbackMode: PlaybackMode
): VideoFile | null {
  if (playbackMode === 'none' || !currentFile || files.length === 0) {
    return null
  }

  if (playbackMode === 'sequential') {
    return getAdjacentVideoFile(files, currentFile, 'next')
  }

  if (files.length === 1) {
    return null
  }

  const candidates = files.filter((file) => file.path !== currentFile)
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null
}
