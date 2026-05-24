const path = require('path')
const { execFileSync } = require('child_process')
const { updateExecutableIcon } = require('./set-icon')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') {
    const appName = `${context.packager.appInfo.productFilename}.app`
    const appPath = path.join(context.appOutDir, appName)

    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    })

    execFileSync(
      'codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', appPath],
      {
        stdio: 'inherit',
      },
    )

    return
  }

  if (context.electronPlatformName !== 'win32') {
    return
  }

  updateExecutableIcon(path.join(context.appOutDir, 'ScriptPlayerPlus.exe'))
}
