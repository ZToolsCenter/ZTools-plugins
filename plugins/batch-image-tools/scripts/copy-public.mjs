import fs from 'node:fs'
import path from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git'])

export function copyPublicAssets(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return

  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue

    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)

    if (entry.isDirectory()) {
      copyPublicAssets(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
