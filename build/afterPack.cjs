const { execSync } = require('child_process')
const path = require('path')

// Re-sign the entire .app bundle with a consistent ad-hoc identity
// so all binaries share the same (empty) Team ID. Without this,
// electron-builder's per-binary signing produces mismatched Team IDs
// and macOS refuses to load Electron Framework at launch.
exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  console.log(`[afterPack] Re-signing ${appPath}`)
  execSync(`/usr/bin/codesign --force --deep --sign - '${appPath}'`, { stdio: 'inherit' })
}
