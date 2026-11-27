import fs from 'node:fs'
import path from 'node:path'

const legacyDirs = ['dist', 'release']

for (const name of legacyDirs) {
  const target = path.resolve(name)
  if (!fs.existsSync(target)) continue

  const trash = path.resolve(`${name}_legacy_${Date.now()}`)
  try {
    fs.renameSync(target, trash)
    console.log(`Moved ${name}/ -> ${path.basename(trash)}/`)
  } catch (error) {
    console.warn(`Skip ${name}/: ${error.message}`)
  }
}
