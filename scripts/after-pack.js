const path = require('path')
const { updateExecutableIcon } = require('./set-icon')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  updateExecutableIcon(path.join(context.appOutDir, 'ScriptPlayerPlus.exe'))
}
