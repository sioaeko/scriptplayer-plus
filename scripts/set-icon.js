const fs = require('fs')
const path = require('path')
const ResEdit = require('resedit')

const pkg = require('../package.json')

function normalizeVersion(version) {
  const parts = String(version).split('.').map((part) => Number.parseInt(part, 10) || 0)
  while (parts.length < 4) parts.push(0)
  return parts.slice(0, 4).join('.')
}

function updateExecutableIcon(exePath) {
  const ico = path.join(__dirname, '..', 'public', 'icon.ico')

  if (!fs.existsSync(exePath)) {
    console.log('[set-icon] exe not found:', exePath)
    return false
  }

  const version = normalizeVersion(pkg.version)
  const lang = 1033
  const codepage = 1200

  console.log('[set-icon] Updating executable resources for', exePath)

  const exeData = fs.readFileSync(exePath)
  const executable = ResEdit.NtExecutable.from(exeData)
  const resources = ResEdit.NtExecutableResource.from(executable)
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(ico))
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)
  const versionInfos = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    iconGroups[0]?.id ?? 101,
    iconGroups[0]?.lang ?? lang,
    iconFile.icons.map((item) => item.data)
  )

  const versionInfo = versionInfos[0] ?? ResEdit.Resource.VersionInfo.createEmpty()
  versionInfo.lang = versionInfo.lang || lang
  versionInfo.setFileVersion(version, lang)
  versionInfo.setProductVersion(version, lang)
  versionInfo.setStringValues(
    { lang, codepage },
    {
      CompanyName: 'ScriptPlayerPlus',
      FileDescription: pkg.description,
      FileVersion: version,
      InternalName: pkg.build.productName,
      OriginalFilename: 'ScriptPlayerPlus.exe',
      ProductName: pkg.build.productName,
      ProductVersion: version,
    }
  )
  versionInfo.outputToResourceEntries(resources.entries)

  resources.outputResource(executable)
  const outputPath = `${exePath}.tmp`
  fs.writeFileSync(outputPath, Buffer.from(executable.generate()))
  fs.renameSync(outputPath, exePath)

  console.log('[set-icon] Done!')
  return true
}

if (require.main === module) {
  const outputDir = process.argv[2] || process.env.BUILD_OUTPUT_DIR || 'release'
  updateExecutableIcon(path.join(__dirname, '..', outputDir, 'win-unpacked', 'ScriptPlayerPlus.exe'))
}

module.exports = {
  updateExecutableIcon,
}
