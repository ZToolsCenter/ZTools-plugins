import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zipSync } from 'fflate'

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
}

export function createZip(rootDir = process.cwd()) {
  const distDir = resolve(rootDir, 'dist')
  const files = Object.fromEntries(
    listFiles(distDir).map((filePath) => [
      relative(distDir, filePath).replaceAll('\\', '/'),
      readFileSync(filePath)
    ])
  )

  writeFileSync(resolve(rootDir, 'dist.zip'), zipSync(files, { level: 9 }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createZip()
}
