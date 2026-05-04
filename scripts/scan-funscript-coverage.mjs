#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv']
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma']
const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS]
const FUNSCRIPT_EXTS = ['.funscript', '.json', '.csv']
const SCRIPT_DECORATOR_SUFFIX_RE = /(?:[ _.-]+(?:ufotw|ufosa|cyclone|launch|ufo|handy))+$/i
const SCRIPT_LABEL_SUFFIX_RE = /(?:[ _.-]+funscript(?:\([^)]*\))?)$/i
const TRAILING_VARIANT_SUFFIX_RE = /(?:[ _.-]*げっぷ音緩和差分|[ _.-]*[（(][^()（）]*(?:差分|少なめ)[^()（）]*[)）])$/i

const SCRIPT_AXIS_DEFINITIONS = [
  { id: 'L0', suffixes: ['', 'stroke', 'l0'] },
  { id: 'L1', suffixes: ['surge', 'l1'] },
  { id: 'L2', suffixes: ['sway', 'l2'] },
  { id: 'R0', suffixes: ['twist', 'r0'] },
  { id: 'R1', suffixes: ['roll', 'r1'] },
  { id: 'R2', suffixes: ['pitch', 'r2'] },
  { id: 'V0', suffixes: ['vib', 'vibe', 'v0'] },
  { id: 'V1', suffixes: ['pump', 'v1'] },
  { id: 'A0', suffixes: ['valve', 'a0'] },
  { id: 'A1', suffixes: ['suck', 'suction', 'a1'] },
  { id: 'A2', suffixes: ['lube', 'a2'] },
]

const rootDir = process.argv[2]
const outputPath = process.argv[3]

if (!rootDir) {
  console.error('Usage: node scripts/scan-funscript-coverage.mjs <rootDir> [outputPath]')
  process.exit(1)
}

function normalizePathKey(targetPath) {
  return process.platform === 'win32' ? targetPath.toLowerCase() : targetPath
}

function stripKnownAxisSuffix(stem) {
  const normalizedStem = stem.trim().toLowerCase()
  for (const definition of SCRIPT_AXIS_DEFINITIONS) {
    for (const suffix of definition.suffixes) {
      if (!suffix) continue
      if (normalizedStem === suffix) return ''
      const dotted = `.${suffix}`
      if (normalizedStem.endsWith(dotted)) {
        return normalizedStem.slice(0, -dotted.length)
      }
    }
  }

  return normalizedStem
}

function inferAxisIdFromStem(stem) {
  const normalizedStem = stem.trim().toLowerCase()
  if (!normalizedStem) return 'L0'

  for (const definition of SCRIPT_AXIS_DEFINITIONS) {
    for (const suffix of definition.suffixes) {
      if (!suffix) continue
      if (normalizedStem === suffix || normalizedStem.endsWith(`.${suffix}`)) {
        return definition.id
      }
    }
  }

  return null
}

function normalizeBundledScriptBaseName(baseName) {
  return stripKnownAxisSuffix(baseName)
    .replace(/^((?:track|tr)\d+)[.\s_-]+/i, '$1')
    .replace(/^([#]?\d+(?:-\d+)?)[.\s_-]+/i, '$1')
    .replace(SCRIPT_DECORATOR_SUFFIX_RE, '')
    .replace(SCRIPT_LABEL_SUFFIX_RE, '')
    .replace(TRAILING_VARIANT_SUFFIX_RE, '')
    .trim()
}

function normalizeBundledScriptFallbackKey(baseName) {
  return normalizeBundledScriptBaseName(baseName)
    .replace(/^[0-9０-９]+(?:-[0-9０-９]+)?[.\s_-]*/, '')
}

function readFunscriptJson(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase()
    if (!FUNSCRIPT_EXTS.includes(ext)) return null
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
    if (ext === '.csv') {
      return parseFunscriptCsv(content)
    }
    return JSON.parse(content)
  } catch {
    return null
  }
}

function parseFunscriptCsv(content) {
  const rows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(',').map((part) => Number(part.trim())))
    .filter((row) => row.length >= 2 && Number.isFinite(row[0]) && row.some((value, index) => index > 0 && Number.isFinite(value)))

  if (rows.length === 0) {
    return null
  }

  const positionColumnIndex = pickCsvPositionColumnIndex(rows)
  if (positionColumnIndex === null) {
    return null
  }

  const actions = rows
    .map((row) => ({
      at: Math.max(0, Math.round(row[0])),
      pos: Math.max(0, Math.min(100, Math.round(row[positionColumnIndex]))),
    }))
    .filter((action) => Number.isFinite(action.at) && Number.isFinite(action.pos))

  if (actions.length === 0) {
    return null
  }

  return {
    version: '1.0',
    inverted: false,
    range: 90,
    actions,
  }
}

function pickCsvPositionColumnIndex(rows) {
  const maxColumnCount = Math.max(...rows.map((row) => row.length))
  let bestIndex = null
  let bestScore = -1

  for (let columnIndex = 1; columnIndex < maxColumnCount; columnIndex += 1) {
    const values = rows
      .map((row) => row[columnIndex])
      .filter((value) => Number.isFinite(value))

    if (values.length === 0) continue

    const distinctCount = new Set(values.map((value) => value.toString())).size
    const nonBinaryCount = values.filter((value) => value !== 0 && value !== 1).length
    const range = Math.max(...values) - Math.min(...values)
    const score = nonBinaryCount * 100000 + distinctCount * 100 + range

    if (score > bestScore || (score === bestScore && bestIndex !== null && columnIndex > bestIndex)) {
      bestScore = score
      bestIndex = columnIndex
    }

    if (bestIndex === null) {
      bestIndex = columnIndex
    }
  }

  return bestIndex
}

function isLoadableFunscriptJson(value) {
  if (!value || typeof value !== 'object') {
    return false
  }

  const actions = value.actions
  if (!Array.isArray(actions) || actions.length === 0) {
    return false
  }

  return actions.every((action) => (
    action
    && typeof action === 'object'
    && Number.isFinite(action.at)
    && Number.isFinite(action.pos)
  ))
}

function addFunscriptToBundle(bundle, loadedPaths, filePath, preferredAxis) {
  if (loadedPaths.has(filePath)) return

  const parsed = readFunscriptJson(filePath)
  if (!isLoadableFunscriptJson(parsed)) return

  const axisId = preferredAxis ?? inferAxisIdFromStem(path.basename(filePath, path.extname(filePath))) ?? 'L0'
  if (bundle.scripts[axisId]) return

  bundle.scripts[axisId] = parsed
  bundle.sources[axisId] = filePath
  bundle.primaryAxis = bundle.primaryAxis ?? axisId
  loadedPaths.add(filePath)
}

function findDecoratedBundleCandidates(dirPath, baseName) {
  const targetBaseName = normalizeBundledScriptBaseName(baseName)
  if (!targetBaseName) {
    return {}
  }

  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return {}
  }

  const matches = new Map()
  for (const entry of entries) {
    if (!entry.isFile()) continue

    const ext = path.extname(entry.name).toLowerCase()
    if (!FUNSCRIPT_EXTS.includes(ext)) continue

    const stem = path.basename(entry.name, ext)
    if (normalizeBundledScriptBaseName(stem) !== targetBaseName) continue

    const axisId = inferAxisIdFromStem(stem) ?? 'L0'
    const filePath = path.join(dirPath, entry.name)
    if (!matches.has(axisId)) {
      matches.set(axisId, filePath)
      continue
    }

    if (matches.get(axisId) !== filePath) {
      matches.set(axisId, null)
    }
  }

  const next = {}
  for (const [axisId, filePath] of matches.entries()) {
    if (filePath) {
      next[axisId] = filePath
    }
  }
  return next
}

function addBundleCandidates(bundle, loadedPaths, dirPath, baseName) {
  const decoratedCandidates = findDecoratedBundleCandidates(dirPath, baseName)

  for (const definition of SCRIPT_AXIS_DEFINITIONS) {
    if (bundle.scripts[definition.id]) continue

    for (const suffix of definition.suffixes) {
      let matched = false

      for (const ext of FUNSCRIPT_EXTS) {
        const fileName = suffix
          ? `${baseName}.${suffix}${ext}`
          : `${baseName}${ext}`
        const filePath = path.join(dirPath, fileName)
        if (!fs.existsSync(filePath)) continue

        addFunscriptToBundle(bundle, loadedPaths, filePath, definition.id)
        matched = true
        break
      }

      if (matched) {
        break
      }
    }

    const decoratedCandidate = decoratedCandidates[definition.id]
    if (decoratedCandidate) {
      addFunscriptToBundle(bundle, loadedPaths, decoratedCandidate, definition.id)
    }
  }
}

function readFunscriptBundle(mediaPath, scriptFolder, preferredScriptPath) {
  const bundle = {
    primaryAxis: null,
    scripts: {},
    sources: {},
  }

  const loadedPaths = new Set()
  const mediaBaseName = path.basename(mediaPath, path.extname(mediaPath))

  if (preferredScriptPath) {
    addFunscriptToBundle(bundle, loadedPaths, preferredScriptPath, inferAxisIdFromStem(path.basename(preferredScriptPath, path.extname(preferredScriptPath))))
  }

  const contexts = [
    { dir: path.dirname(mediaPath), baseNames: [mediaBaseName] },
  ]

  if (scriptFolder) {
    contexts.push({ dir: scriptFolder, baseNames: [mediaBaseName] })
  }

  if (preferredScriptPath) {
    const preferredBaseName = normalizeBundledScriptBaseName(path.basename(preferredScriptPath, path.extname(preferredScriptPath)))
    contexts.unshift({
      dir: path.dirname(preferredScriptPath),
      baseNames: Array.from(new Set([preferredBaseName, mediaBaseName])).filter(Boolean),
    })
  }

  for (const context of contexts) {
    for (const baseName of context.baseNames) {
      addBundleCandidates(bundle, loadedPaths, context.dir, baseName)
    }
  }

  if (bundle.primaryAxis === null) {
    bundle.primaryAxis = Object.keys(bundle.scripts)[0] ?? null
  }

  return Object.keys(bundle.scripts).length > 0 ? bundle : null
}

function pickUniqueBundledScriptCandidate(mediaPath, mediaTopLevelGroup, restrictByTopLevelGroup, candidateLocations) {
  if (!candidateLocations || candidateLocations.size !== 1) {
    return null
  }

  const [candidateDir, candidate] = Array.from(candidateLocations.entries())[0]
  if (normalizePathKey(candidateDir) === normalizePathKey(path.dirname(mediaPath))) {
    return null
  }

  if (restrictByTopLevelGroup && mediaTopLevelGroup && candidate.topLevelGroup !== mediaTopLevelGroup) {
    return null
  }

  return candidate.path
}

function findUniqueBundledScriptFallback(mediaPath, mediaTopLevelGroup, restrictByTopLevelGroup, bundledScriptLocations, bundledScriptAliasLocations) {
  const mediaBaseName = normalizeBundledScriptBaseName(path.basename(mediaPath, path.extname(mediaPath)))
  const candidateLocations = bundledScriptLocations.get(mediaBaseName)
  const exactCandidate = pickUniqueBundledScriptCandidate(mediaPath, mediaTopLevelGroup, restrictByTopLevelGroup, candidateLocations)
  if (exactCandidate) {
    return exactCandidate
  }

  const mediaAlias = normalizeBundledScriptFallbackKey(mediaBaseName)
  if (!mediaAlias) {
    return null
  }

  return pickUniqueBundledScriptCandidate(mediaPath, mediaTopLevelGroup, restrictByTopLevelGroup, bundledScriptAliasLocations.get(mediaAlias))
}

function collectDirScriptInfo(dirPath) {
  let entries = []
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return { scriptFiles: [], invalidScriptFiles: [], decoratedByBase: new Map(), exactByBase: new Map() }
  }

  const scriptFiles = []
  const invalidScriptFiles = []
  const decoratedByBase = new Map()
  const exactByBase = new Map()

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!FUNSCRIPT_EXTS.includes(ext)) continue

    const fullPath = path.join(dirPath, entry.name)
    const stem = path.basename(entry.name, ext)
    const normalizedBase = normalizeBundledScriptBaseName(stem)
    const rawBase = path.basename(entry.name, ext)
    const parsed = readFunscriptJson(fullPath)
    const isLoadable = isLoadableFunscriptJson(parsed)
    const record = {
      path: fullPath,
      name: entry.name,
      stem,
      normalizedBase,
      rawBase,
      isLoadable,
      axisId: inferAxisIdFromStem(stem) ?? 'L0',
      actionCount: isLoadable ? parsed.actions.length : 0,
    }

    scriptFiles.push(record)
    if (!isLoadable) {
      invalidScriptFiles.push(record)
    }

    if (!exactByBase.has(rawBase)) {
      exactByBase.set(rawBase, [])
    }
    exactByBase.get(rawBase).push(record)

    if (!decoratedByBase.has(normalizedBase)) {
      decoratedByBase.set(normalizedBase, [])
    }
    decoratedByBase.get(normalizedBase).push(record)
  }

  return { scriptFiles, invalidScriptFiles, decoratedByBase, exactByBase }
}

function relativeTopLevel(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean)
  return segments[0] ?? '.'
}

const pendingMediaFiles = []
const bundledScriptLocations = new Map()
const bundledScriptAliasLocations = new Map()
const visitedDirectories = new Set()
const directoryScriptInfoCache = new Map()

function scanDir(dir, prefix) {
  const visitKey = normalizePathKey(fs.realpathSync.native(dir))
  if (visitedDirectories.has(visitKey)) {
    return
  }
  visitedDirectories.add(visitKey)

  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      continue
    }

    if (entry.isDirectory()) {
      scanDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (FUNSCRIPT_EXTS.includes(ext)) {
        const scriptBaseName = normalizeBundledScriptBaseName(path.basename(entry.name, ext))
        if (scriptBaseName) {
          let locationMap = bundledScriptLocations.get(scriptBaseName)
          if (!locationMap) {
            locationMap = new Map()
            bundledScriptLocations.set(scriptBaseName, locationMap)
          }
          const topLevelGroup = prefix.split('/')[0] ?? ''
          if (!locationMap.has(dir)) {
            locationMap.set(dir, { path: fullPath, topLevelGroup })
          }

          const scriptAlias = normalizeBundledScriptFallbackKey(scriptBaseName)
          if (scriptAlias && scriptAlias !== scriptBaseName) {
            let aliasLocationMap = bundledScriptAliasLocations.get(scriptAlias)
            if (!aliasLocationMap) {
              aliasLocationMap = new Map()
              bundledScriptAliasLocations.set(scriptAlias, aliasLocationMap)
            }
            if (!aliasLocationMap.has(dir)) {
              aliasLocationMap.set(dir, { path: fullPath, topLevelGroup })
            }
          }
        }
      }

      if (MEDIA_EXTS.includes(ext)) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        pendingMediaFiles.push({
          name: entry.name,
          path: fullPath,
          relativePath,
          topLevelGroup: prefix.split('/')[0] ?? '',
          topLevelDir: relativeTopLevel(relativePath),
          type: VIDEO_EXTS.includes(ext) ? 'video' : 'audio',
        })
      }
    }
  }
}

function getDirectoryScriptInfo(dirPath) {
  const cacheKey = normalizePathKey(dirPath)
  if (!directoryScriptInfoCache.has(cacheKey)) {
    directoryScriptInfoCache.set(cacheKey, collectDirScriptInfo(dirPath))
  }
  return directoryScriptInfoCache.get(cacheKey)
}

scanDir(rootDir, '')

const hasRootLevelMedia = pendingMediaFiles.some((mediaFile) => !mediaFile.relativePath.includes('/'))
const distinctTopLevelMediaGroups = new Set(
  pendingMediaFiles
    .map((mediaFile) => mediaFile.topLevelGroup)
    .filter(Boolean)
).size
const restrictFallbackByTopLevelGroup = !hasRootLevelMedia && distinctTopLevelMediaGroups > 1

const results = []
const folderSummary = new Map()

for (const mediaFile of pendingMediaFiles) {
  const localBundle = readFunscriptBundle(mediaFile.path)
  const fallbackScriptPath = localBundle
    ? null
    : findUniqueBundledScriptFallback(
      mediaFile.path,
      mediaFile.topLevelGroup,
      restrictFallbackByTopLevelGroup,
      bundledScriptLocations,
      bundledScriptAliasLocations
    )
  const fallbackBundle = !localBundle && fallbackScriptPath
    ? readFunscriptBundle(mediaFile.path, undefined, fallbackScriptPath)
    : null
  const recognizedBundle = localBundle ?? fallbackBundle
  const mediaDir = path.dirname(mediaFile.path)
  const mediaBaseName = path.basename(mediaFile.path, path.extname(mediaFile.path))
  const normalizedBaseName = normalizeBundledScriptBaseName(mediaBaseName)
  const aliasKey = normalizeBundledScriptFallbackKey(normalizedBaseName)
  const dirInfo = getDirectoryScriptInfo(mediaDir)
  const exactMatches = dirInfo.exactByBase.get(mediaBaseName) ?? []
  const decoratedMatches = dirInfo.decoratedByBase.get(normalizedBaseName) ?? []
  const exactInvalidMatches = exactMatches.filter((script) => !script.isLoadable)
  const decoratedInvalidMatches = decoratedMatches.filter((script) => !script.isLoadable)
  const globalExactCandidates = bundledScriptLocations.get(normalizedBaseName)
  const globalAliasCandidates = aliasKey ? bundledScriptAliasLocations.get(aliasKey) : undefined

  let classification
  if (localBundle) {
    classification = 'recognized-local'
  } else if (fallbackBundle) {
    classification = 'recognized-fallback'
  } else if (exactInvalidMatches.length > 0) {
    classification = 'invalid-exact-script'
  } else if (decoratedInvalidMatches.length > 0) {
    classification = 'invalid-decorated-script'
  } else if ((globalExactCandidates?.size ?? 0) > 1 || (globalAliasCandidates?.size ?? 0) > 1) {
    classification = 'ambiguous-fallback'
  } else if (dirInfo.scriptFiles.length > 0) {
    classification = 'same-dir-scripts-unmatched'
  } else {
    classification = 'no-scripts-nearby'
  }

  const result = {
    mediaPath: mediaFile.path,
    relativePath: mediaFile.relativePath,
    topLevelDir: mediaFile.topLevelDir,
    mediaType: mediaFile.type,
    recognized: Boolean(recognizedBundle),
    classification,
    localRecognized: Boolean(localBundle),
    fallbackRecognized: Boolean(fallbackBundle),
    primaryAxis: recognizedBundle?.primaryAxis ?? null,
    primarySource: recognizedBundle?.primaryAxis ? (recognizedBundle.sources[recognizedBundle.primaryAxis] ?? null) : null,
    sameDirScriptCount: dirInfo.scriptFiles.length,
    exactMatchCount: exactMatches.length,
    decoratedMatchCount: decoratedMatches.length,
    invalidExactScripts: exactInvalidMatches.map((script) => script.name),
    invalidDecoratedScripts: decoratedInvalidMatches.map((script) => script.name),
    sameDirScripts: dirInfo.scriptFiles.map((script) => script.name),
    decoratedMatches: decoratedMatches.map((script) => script.name),
    globalExactCandidateCount: globalExactCandidates?.size ?? 0,
    globalAliasCandidateCount: globalAliasCandidates?.size ?? 0,
    fallbackScriptPath: fallbackScriptPath ?? null,
  }
  results.push(result)

  const folderEntry = folderSummary.get(mediaFile.topLevelDir) ?? {
    topLevelDir: mediaFile.topLevelDir,
    mediaCount: 0,
    recognizedCount: 0,
    suspiciousCount: 0,
    ambiguousCount: 0,
    invalidCount: 0,
    noScriptCount: 0,
    examples: [],
  }
  folderEntry.mediaCount += 1
  if (result.recognized) {
    folderEntry.recognizedCount += 1
  } else if (classification === 'same-dir-scripts-unmatched') {
    folderEntry.suspiciousCount += 1
    if (folderEntry.examples.length < 5) folderEntry.examples.push(result.relativePath)
  } else if (classification === 'ambiguous-fallback') {
    folderEntry.ambiguousCount += 1
    if (folderEntry.examples.length < 5) folderEntry.examples.push(result.relativePath)
  } else if (classification === 'invalid-exact-script' || classification === 'invalid-decorated-script') {
    folderEntry.invalidCount += 1
    if (folderEntry.examples.length < 5) folderEntry.examples.push(result.relativePath)
  } else {
    folderEntry.noScriptCount += 1
  }
  folderSummary.set(mediaFile.topLevelDir, folderEntry)
}

const scan = {
  rootDir: path.resolve(rootDir),
  scannedAt: new Date().toISOString(),
  totals: {
    directories: visitedDirectories.size,
    mediaFiles: results.length,
    recognized: results.filter((item) => item.recognized).length,
    recognizedLocal: results.filter((item) => item.classification === 'recognized-local').length,
    recognizedFallback: results.filter((item) => item.classification === 'recognized-fallback').length,
    sameDirScriptsUnmatched: results.filter((item) => item.classification === 'same-dir-scripts-unmatched').length,
    ambiguousFallback: results.filter((item) => item.classification === 'ambiguous-fallback').length,
    invalidScripts: results.filter((item) => item.classification === 'invalid-exact-script' || item.classification === 'invalid-decorated-script').length,
    noScriptsNearby: results.filter((item) => item.classification === 'no-scripts-nearby').length,
  },
  folderSummary: Array.from(folderSummary.values())
    .sort((a, b) => (
      b.suspiciousCount - a.suspiciousCount
      || b.ambiguousCount - a.ambiguousCount
      || b.invalidCount - a.invalidCount
      || a.topLevelDir.localeCompare(b.topLevelDir)
    )),
  suspiciousMedia: results
    .filter((item) => item.classification === 'same-dir-scripts-unmatched')
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  ambiguousMedia: results
    .filter((item) => item.classification === 'ambiguous-fallback')
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  invalidMedia: results
    .filter((item) => item.classification === 'invalid-exact-script' || item.classification === 'invalid-decorated-script')
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  unrecognizedMedia: results
    .filter((item) => !item.recognized)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
}

const serialized = JSON.stringify(scan, null, 2)
if (outputPath) {
  fs.writeFileSync(outputPath, serialized, 'utf-8')
  console.log(JSON.stringify({
    outputPath: path.resolve(outputPath),
    totals: scan.totals,
    topSuspiciousFolders: scan.folderSummary.slice(0, 10),
  }, null, 2))
} else {
  console.log(serialized)
}
